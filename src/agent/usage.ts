import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { estimateRequestCost, formatUsd, type Price } from "./models.ts";

/**
 * Spend accounting for the line under the prompt
 * (`$0.12 session · $0.48 today · opus-5.5 · gateway`).
 *
 * Each response's reported usage is priced once: the provider's own `cost`
 * when it sends one (OpenRouter, the AI Gateway), otherwise tokens × the
 * models.dev price. Session spend lives in memory; today's spend comes from
 * `~/.config/dawg/usage.json`, a small per-day ledger shared by every window.
 * Writes take an exclusive lock file and replace the ledger atomically.
 */
export type UsageReport = Readonly<{
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd?: number;
}>;

/** USD for one response; undefined when neither cost nor price is known. */
export function priceUsage(
  usage: UsageReport,
  price: Price | undefined,
): number | undefined {
  if (usage.costUsd !== undefined) return usage.costUsd;
  if (!price) return undefined;
  return estimateRequestCost(price, usage);
}

export type DayTotal = Readonly<{
  usd: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}>;
export type Ledger = Readonly<{
  version: 1;
  days: Readonly<Record<string, DayTotal>>;
}>;

/** Days kept in the ledger; older ones are pruned on write. */
export const LEDGER_DAYS = 31;
const MAX_LEDGER_BYTES = 64 * 1024;
const LOCK_STALE_MS = 10_000;

/** Local calendar day, `2026-10-06`. */
export function dayKey(at: Date = new Date()): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

function finite(value: unknown, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, max)
    : 0;
}

export function parseLedger(value: unknown): Ledger {
  const days: Record<string, DayTotal> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const raw = (value as { days?: unknown }).days;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw))
      for (const [key, total] of Object.entries(raw)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        if (typeof total !== "object" || total === null) continue;
        const row = total as Record<string, unknown>;
        days[key] = {
          usd: finite(row.usd, 1e6),
          requests: Math.floor(finite(row.requests, 1e9)),
          inputTokens: Math.floor(finite(row.inputTokens, 1e13)),
          outputTokens: Math.floor(finite(row.outputTokens, 1e13)),
        };
      }
  }
  return { version: 1, days: prune(days) };
}

function prune(days: Record<string, DayTotal>): Record<string, DayTotal> {
  const keys = Object.keys(days).sort().slice(-LEDGER_DAYS);
  return Object.fromEntries(keys.map((key) => [key, days[key]!]));
}

export function addToLedger(
  ledger: Ledger,
  day: string,
  usd: number,
  usage: UsageReport,
): Ledger {
  const current = ledger.days[day] ?? {
    usd: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  return {
    version: 1,
    days: prune({
      ...ledger.days,
      [day]: {
        usd: current.usd + usd,
        requests: current.requests + 1,
        inputTokens: current.inputTokens + usage.inputTokens,
        outputTokens: current.outputTokens + usage.outputTokens,
      },
    }),
  };
}

export async function readLedger(dir: string): Promise<Ledger> {
  const path = join(dir, "usage.json");
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_LEDGER_BYTES) return parseLedger({});
    return parseLedger(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return parseLedger({});
  }
}

async function withLock<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const lock = join(dir, "usage.json.lock");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS)
        await rm(lock, { force: true });
      else if (attempt > 50) throw new Error("usage ledger is locked");
      else await Bun.sleep(20);
    }
  }
  try {
    return await run();
  } finally {
    await rm(lock, { force: true });
  }
}

/** Add one priced response to today's total; returns the updated ledger. */
export async function recordUsage(
  dir: string,
  usd: number,
  usage: UsageReport,
  at: Date = new Date(),
): Promise<Ledger> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return withLock(dir, async () => {
    const next = addToLedger(await readLedger(dir), dayKey(at), usd, usage);
    const path = join(dir, "usage.json");
    const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(next)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    return next;
  });
}

/** In-memory session totals plus the shared daily ledger. */
export class SpendMeter {
  sessionUsd = 0;
  todayUsd = 0;
  /** True once any response could not be priced. */
  unpriced = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Load today's total from the ledger (other windows count too). */
  async load(): Promise<void> {
    const ledger = await readLedger(this.dir);
    this.todayUsd = ledger.days[dayKey(this.now())]?.usd ?? 0;
  }

  /** Account one response. Ledger writes are serialized and best-effort. */
  add(usage: UsageReport, price: Price | undefined): number | undefined {
    const usd = priceUsage(usage, price);
    if (usd === undefined) {
      this.unpriced = true;
      return undefined;
    }
    this.sessionUsd += usd;
    this.todayUsd += usd;
    this.chain = this.chain
      .then(() => recordUsage(this.dir, usd, usage, this.now()))
      .then((ledger) => {
        const today = ledger.days[dayKey(this.now())]?.usd;
        if (today !== undefined) this.todayUsd = today;
      })
      .catch(() => undefined);
    return usd;
  }

  /** Account a dollar amount with no tokens (billed web searches). */
  addUsd(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.sessionUsd += usd;
    this.todayUsd += usd;
    const usage: UsageReport = {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: usd,
    };
    this.chain = this.chain
      .then(() => recordUsage(this.dir, usd, usage, this.now()))
      .then((ledger) => {
        const today = ledger.days[dayKey(this.now())]?.usd;
        if (today !== undefined) this.todayUsd = today;
      })
      .catch(() => undefined);
  }

  /** Wait for pending ledger writes (tests, exit). */
  flush(): Promise<unknown> {
    return this.chain;
  }
}

/**
 * The spend line: `$0.12 session · $0.48 today · opus-5.5 · gateway`;
 * `subscription · sonnet · claude`; `no model · dawg login`. Narrow widths
 * drop the today total, then the session total, then the provider.
 */
export function spendLine(
  options: {
    kind: "api" | "subscription" | "offline";
    model?: string;
    provider?: string;
    sessionUsd?: number;
    todayUsd?: number;
  },
  width = 120,
): string {
  if (options.kind === "offline") return "no model · dawg login";
  const tail = [options.model, options.provider].filter(Boolean) as string[];
  const money =
    options.kind === "subscription"
      ? ["subscription"]
      : [
          `${formatUsd(options.sessionUsd ?? 0)} session`,
          `${formatUsd(options.todayUsd ?? 0)} today`,
        ];
  const candidates = [
    [...money, ...tail],
    [money[0]!, ...tail],
    [money[0]!, ...tail.slice(0, 1)],
    tail.slice(0, 1),
  ];
  for (const parts of candidates) {
    const line = parts.join(" · ");
    if (line.length <= width) return line;
  }
  return "";
}

/**
 * The agent's web options for a provider selection: the turn's own gateway
 * or OpenRouter key powers paid search, and billed searches land in the
 * same spend meter (and daily ledger) as model responses.
 */
export function webHostFor(
  selection: Readonly<{ kind: string; apiKey?: string }>,
  meter: Pick<SpendMeter, "addUsd">,
  onChange: () => void = () => {},
): {
  gatewayApiKey?: string;
  openRouterApiKey?: string;
  onSpend: (spend: Readonly<{ usd: number }>) => void;
} {
  return {
    ...(selection.kind === "gateway" && selection.apiKey
      ? { gatewayApiKey: selection.apiKey }
      : {}),
    ...(selection.kind === "openrouter" && selection.apiKey
      ? { openRouterApiKey: selection.apiKey }
      : {}),
    onSpend: (spend) => {
      meter.addUsd(spend.usd);
      onChange();
    },
  };
}

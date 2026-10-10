import { hostname } from "node:os";
import { defaultAuthEnv } from "./credentials.ts";
import {
  authStatus,
  isLogoutTarget,
  logout,
  modelChoices,
  saveModelChoice,
  type LoginIO,
} from "./login.ts";
import { systemRunner, type CommandRunner } from "./runner.ts";
import { audioStatusLine } from "../audio/engine.ts";
import {
  providerLabel,
  selectProvider,
  type ProviderSelection,
} from "../agent/provider.ts";
import { parseLoginArgs } from "./cli.ts";

/**
 * `/logout [provider]` and `/auth [--check]` inside the TUI: they print only,
 * so they run without leaving the screen and return their lines as cards.
 * `/login` hands the terminal to the shell flow instead (see main.ts).
 */
export async function tuiAuthCommand(
  command: string,
  runner: CommandRunner = systemRunner,
): Promise<string[]> {
  const lines: string[] = [];
  const io: LoginIO = {
    interactive: false,
    print: (line) => void lines.push(line),
    ask: async () => "",
    readSecret: async () => "",
  };
  const deps = { auth: defaultAuthEnv(runner), io, hostname: hostname() };
  const [name, ...rest] = command.trim().split(/\s+/);
  try {
    if (/^\/logout$/i.test(name ?? "")) {
      const target = rest[0];
      if (target !== undefined && !isLogoutTarget(target))
        lines.push("usage · /logout [gateway|openrouter|codex|claude|xcb]");
      else await logout(deps, target);
    } else if (/^\/auth$/i.test(name ?? ""))
      lines.push(
        ...(await authStatus(deps, {
          verify: rest.includes("--check"),
        })),
        audioStatusLine(),
      );
    else lines.push(`unknown auth command: ${(name ?? "").slice(0, 20)}`);
  } catch (error) {
    lines.push(
      `auth failed · ${error instanceof Error ? error.message : String(error)} · dawg login in a shell`,
    );
  }
  return lines.map((line) => line.slice(0, 240));
}

/** Validate `/login …` arguments before suspending the screen. */
export function tuiLoginArgs(command: string) {
  return parseLoginArgs(command.trim().split(/\s+/).slice(1));
}

export type ModelPickerItem = Readonly<{
  label: string;
  value: string;
  detail: string;
  current: boolean;
}>;

/**
 * `/model` picker rows for the active provider, valued as the follow-up
 * `/model <id>` command that saves the choice.
 */
export async function modelPickerItems(
  selection: ProviderSelection,
  runner: CommandRunner = systemRunner,
): Promise<ModelPickerItem[]> {
  const rows = await modelChoices({ auth: defaultAuthEnv(runner) }, selection);
  return rows.map((row) => ({
    label: row.label,
    detail: `${row.group} · ${row.detail}`,
    current: row.current,
    value: `/model ${row.value}`,
  }));
}

/**
 * `/model <value>`: save for the active provider; returns the receipt and
 * whether it worked, so the caller shows a refusal as one (never a ✓).
 */
export async function tuiSetModel(
  value: string,
  runner: CommandRunner = systemRunner,
  auth = defaultAuthEnv(runner),
): Promise<{ readonly ok: boolean; readonly text: string }> {
  const selection = await selectProvider(auth);
  if (selection.kind === "offline")
    return { ok: false, text: `model · unavailable: ${selection.reason}` };
  try {
    return {
      ok: true,
      text: `model · ${await saveModelChoice(auth, selection, value)}`,
    };
  } catch (error) {
    const rows = await modelPickerItems(selection, runner).catch(() => []);
    return {
      ok: false,
      text: `model · ${error instanceof Error ? error.message : String(error)}; try ${rows
        .slice(0, 8)
        .map((row) => row.label)
        .join(", ")} · current ${providerLabel(selection)}`,
    };
  }
}

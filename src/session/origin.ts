import type { SessionPort } from "./port.ts";
import type { SessionEvent, SessionRecord } from "./store.ts";

/**
 * Remembers the events this window wrote, so the "synced" card shows only
 * for revisions that came from another client (design C12). Session events
 * carry no writer id, so the tracker records the id of the event each of
 * this window's appends produced, and holds a decision while a write is in
 * flight (a watcher update can land before the append resolves).
 */
export class OwnWrites {
  private readonly ids = new Set<string>();
  private inflight = 0;
  private waiters: (() => void)[] = [];

  /** Wraps one append: records the event it produced. */
  public async track<T>(
    write: Promise<SessionRecord<T>>,
  ): Promise<SessionRecord<T>> {
    this.inflight++;
    try {
      const record = await write;
      const last = record.events[record.events.length - 1];
      if (last) this.remember(last.id);
      return record;
    } finally {
      this.inflight--;
      if (this.inflight === 0) {
        const waiters = this.waiters;
        this.waiters = [];
        for (const wake of waiters) wake();
      }
    }
  }

  public remember(id: string): void {
    this.ids.add(id);
    // Bounded: only recent ids matter for the next watcher update.
    if (this.ids.size > 512) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
  }

  public isOwn(id: string): boolean {
    return this.ids.has(id);
  }

  /** Resolves once no append from this window is in flight. */
  public settled(): Promise<void> {
    if (this.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Patches a port's append methods in place so every write it commits is
   * tracked. Idempotent per port.
   */
  public attach<T>(port: SessionPort<T>): void {
    const marked = port as SessionPort<T> & { [TRACKED]?: true };
    if (marked[TRACKED]) return;
    marked[TRACKED] = true;
    const append = port.append.bind(port);
    const appendOperations = port.appendOperations.bind(port);
    port.append = (...args) => this.track(append(...args));
    port.appendOperations = (...args) => this.track(appendOperations(...args));
  }
}

const TRACKED = Symbol("dawg.ownWrites");

/** Events in `latest` past `fromRevision` that this window did not write. */
export function foreignEvents(
  latest: Pick<SessionRecord<unknown>, "events">,
  fromRevision: number,
  own: Pick<OwnWrites, "isOwn">,
): SessionEvent[] {
  return latest.events.filter(
    (event) => event.revision > fromRevision && !own.isOwn(event.id),
  );
}

/**
 * Names the other window for the sync card: `window 2` when exactly one
 * other client is present (numbered by its place in the presence list),
 * else `another window`.
 */
export function otherWindowName(
  clients: readonly { clientId: string }[],
  selfId: string,
): string {
  const others = clients
    .map((client, index) => ({ client, index }))
    .filter(({ client }) => client.clientId !== selfId);
  // A list without this window (file presence) numbers it as window 1.
  const offset = others.length === clients.length ? 2 : 1;
  if (others.length === 1) return `window ${others[0]!.index + offset}`;
  return "another window";
}

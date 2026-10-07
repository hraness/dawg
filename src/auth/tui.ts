import { hostname } from "node:os";
import { defaultAuthEnv } from "./credentials.ts";
import { authStatus, login, logout, type LoginIO } from "./login.ts";
import { systemRunner, type CommandRunner } from "./runner.ts";
import type { GatewayModel } from "../agent/gateway.ts";
import { audioStatusLine } from "../audio/engine.ts";

/**
 * `/login [--xcb]`, `/logout` and `/auth` inside the TUI. The terminal is in
 * raw mode, so there is no hidden input or `vercel login` handoff here: those
 * flows tell the user to run `track login` in a shell instead.
 */
export async function tuiAuthCommand(
  command: string,
  gatewayModel: GatewayModel,
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
    if (/^\/logout$/i.test(name ?? "")) await logout(deps);
    else if (/^\/auth$/i.test(name ?? ""))
      lines.push(
        ...(await authStatus(deps, {
          verify: rest.includes("--check"),
          gatewayModel,
        })),
        audioStatusLine(),
      );
    else if (rest.includes("--xcb")) await login("xcb", deps);
    else if (rest.includes("--key"))
      lines.push(
        "Paste a key from a shell: `track login --key` (input is hidden there).",
      );
    else await login("gateway", deps);
  } catch (error) {
    lines.push(
      `auth failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return lines.map((line) => line.slice(0, 240));
}

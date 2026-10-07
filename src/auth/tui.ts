import { hostname } from "node:os";
import { defaultAuthEnv } from "./credentials.ts";
import {
  authStatus,
  listXcbChoices,
  login,
  logout,
  type LoginIO,
} from "./login.ts";
import { systemRunner, type CommandRunner } from "./runner.ts";
import type { GatewayModel } from "../agent/gateway.ts";
import { audioStatusLine } from "../audio/engine.ts";

/**
 * `/login [--xcb]`, `/logout` and `/auth` inside the TUI. The terminal is in
 * raw mode, so there is no hidden input or `vercel login` handoff here: those
 * flows tell the user to run `dawg login` in a shell instead.
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
    else if (rest.includes("--xcb")) {
      const account = flagValue(rest, "--account");
      const model = flagValue(rest, "--model");
      await login(
        "xcb",
        deps,
        account && model ? { xcb: { account, model } } : {},
      );
    } else if (rest.includes("--key"))
      lines.push(
        "Paste a key from a shell: `dawg login --key` (input is hidden there).",
      );
    else await login("gateway", deps);
  } catch (error) {
    lines.push(
      `auth failed · ${error instanceof Error ? error.message : String(error)} · dawg login in a shell`,
    );
  }
  return lines.map((line) => line.slice(0, 240));
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export type XcbPickerItem = Readonly<{ label: string; value: string }>;

/**
 * Picker rows for `/login --xcb`: one per usable account and model, valued as
 * the follow-up command that saves it. Undefined when xcb is missing or
 * unreadable (the plain login path then prints the guidance).
 */
export async function xcbPickerItems(
  runner: CommandRunner = systemRunner,
): Promise<XcbPickerItem[] | undefined> {
  const choices = await listXcbChoices(defaultAuthEnv(runner));
  return choices?.map(({ account, model }) => ({
    label: [
      account.label,
      account.provider,
      model.label === model.key ? model.key : `${model.label} (${model.key})`,
      ...(account.admission === "pending" ? ["admits on first use"] : []),
    ].join(" · "),
    value: `/login --xcb --account ${account.id} --model ${model.key}`,
  }));
}

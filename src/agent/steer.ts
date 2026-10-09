/**
 * Enter during an agent turn: a typed command that parses locally (a music
 * edit, transport, a mix change) runs at once beside the turn, so it never
 * waits on the model; anything else steers the turn. Slash commands keep
 * steering off: most of them change the session (provider, resume, model)
 * under the running turn.
 */
export function routeDuringTurn(
  text: string,
  parsesLocally: (text: string) => boolean,
): "local" | "steer" {
  const value = text.trim();
  if (value === "" || value.startsWith("/")) return "steer";
  return parsesLocally(value) ? "local" : "steer";
}

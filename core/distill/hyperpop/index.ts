/**
 * Hyperpop, distilled: the song sheet a small model writes, its schema,
 * validator, critic and compiler, and the generate loop around them. Add a
 * demo to `DEMO_SOURCES` in extract.ts and it becomes an example the model
 * learns from.
 */
export { compileSheet } from "./compile.ts";
export { critique, type Critique } from "./critic.ts";
export { DEMO_SOURCES, extractSheet } from "./extract.ts";
export {
  generateSong,
  parseReply,
  type Generated,
  type Round,
  type SheetModel,
} from "./generate.ts";
export { LIBRARY } from "./library.ts";
export {
  exampleSheets,
  messages,
  PLAYBOOK,
  type ChatMessage,
} from "./prompt.ts";
export { sheetSchema } from "./schema.ts";
export { validateSheet, type SongSheet } from "./sheet.ts";

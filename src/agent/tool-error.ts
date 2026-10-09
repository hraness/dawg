/**
 * The tool-argument error, in its own module so tool files that `tools.ts`
 * spreads (voice-tools.ts) can throw it without an import cycle.
 */

/** A model-supplied argument that the tool refused; never mutates the score. */
export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgumentError";
  }
}

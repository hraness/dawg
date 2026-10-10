/**
 * The package version, read from package.json by a static JSON import so
 * `bun build --compile` embeds it: a runtime read relative to
 * import.meta.url finds nothing inside a compiled binary.
 */
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

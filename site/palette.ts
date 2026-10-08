/**
 * dawg studio rides on the design-kit's Paper palette (see app/dawg-studio.css).
 * The pre-paint bootstrap and the React provider must adopt the same controller.
 */
export const siteDefaultPalette = Object.freeze({
  palette: "paper",
  mode: "system",
} as const);

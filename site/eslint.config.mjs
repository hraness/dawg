import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  // build-theme-bootstrap emits this minified bundle from checked source.
  globalIgnores([
    ".next/**",
    "out/**",
    "next-env.d.ts",
    "public/theme-bootstrap.js",
  ]),
]);

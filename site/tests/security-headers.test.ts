import { describe, expect, test } from "bun:test";

import nextConfig from "../next.config";
import { securityHeaders } from "../security-headers";

const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value ?? "";

describe("security headers", () => {
  test("next config applies them to every route", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules?.[0]?.source).toBe("/:path*");
    expect(rules?.[0]?.headers.map((h) => h.key).sort()).toEqual(
      securityHeaders.map((h) => h.key).sort(),
    );
  });

  test("the policy blocks framing, plugins and base-tag injection", () => {
    const csp = header("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  test("transport and sniffing headers are set", () => {
    expect(header("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});

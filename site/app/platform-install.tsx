"use client";

import {
  PlatformInstall,
  type PlatformInstallTarget,
} from "@hraness/design-kit/react";
import { useEffect, useRef } from "react";

import { captureInstallCopied } from "./site-analytics";

const alternatives = [
  { label: "npm", command: "npm i -g @hraness/dawg", shell: "Terminal" },
  { label: "Bun", command: "bun add -g @hraness/dawg", shell: "Terminal" },
] as const;

function platforms(installCommand: string): PlatformInstallTarget[] {
  return [
    {
      id: "macos",
      command: installCommand,
      shell: "Terminal",
      note: "Needs Bun 1.3.14+",
      alternatives,
    },
    {
      id: "linux",
      command: installCommand,
      shell: "Terminal",
      note: "Needs Bun 1.3.14+",
      alternatives,
    },
  ];
}

function methodOf(button: Element): "curl" | "bun" | "other" {
  const text =
    button.parentElement?.closest("[data-copy-state]")?.querySelector("pre")?.textContent ??
    "";
  if (text.startsWith("curl ")) return "curl";
  if (text.startsWith("bun ")) return "bun";
  return "other";
}

/**
 * The design kit's install tabs. A successful copy records which method was
 * copied, never the text.
 */
export function DawgPlatformInstall({
  installCommand,
}: Readonly<{ installCommand: string }>) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const button = record.target;
        if (
          button instanceof Element &&
          button.matches("button.hraness-platform-install__copy") &&
          record.oldValue !== "copied" &&
          button.getAttribute("data-copy-state") === "copied"
        )
          captureInstallCopied(methodOf(button));
      }
    });
    observer.observe(root.current, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-copy-state"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="dawg-install">
      <PlatformInstall
        label="Install dawg"
        platforms={platforms(installCommand)}
      />
    </div>
  );
}

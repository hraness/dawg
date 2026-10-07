"use client";

import { CopyButton } from "@hraness/ui";
import { captureInstallCopied } from "./site-analytics";

/** Shell prompts are shown for reading and dropped when copying. */
function copyText(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/^\$ /u, ""))
    .join("\n");
}

/** A copyable shell block. Copying an install command records which method, never the text. */
export function CodeBlock({
  code,
  label = "Terminal",
  copy = true,
}: Readonly<{ code: string; label?: string; copy?: boolean }>) {
  const value = copyText(code);
  return (
    <div className="dawg-code">
      <div className="dawg-code__bar">
        <span>{label}</span>
        {copy ? (
          <CopyButton
            className="dawg-code__copy"
            value={value}
            onCopySuccess={() => {
              if (value.startsWith("curl ")) captureInstallCopied("curl");
              else if (value.startsWith("bun add -g"))
                captureInstallCopied("bun");
              else if (value.startsWith("git clone"))
                captureInstallCopied("other");
            }}
          />
        ) : null}
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

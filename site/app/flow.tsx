import type { ReactNode } from "react";

/**
 * The mechanism, as four cells on one strong rule: one local session, the
 * windows on it, the prompt and the agent, and sound out. Every line is from
 * README.md or DAWG.md.
 */
export function Flow({
  steps,
}: Readonly<{
  steps: readonly { title: string; body: ReactNode; code?: string }[];
}>) {
  return (
    <ol className="dawg-flow">
      {steps.map((step, index) => (
        <li key={step.title} className="dawg-flow__cell" data-clip={index + 1}>
          <p className="dawg-eyebrow">
            <span className="dawg-flow__chip" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>{" "}
            {step.title}
          </p>
          <p className="dawg-flow__body">{step.body}</p>
          {step.code === undefined ? null : (
            <code className="dawg-flow__code">{step.code}</code>
          )}
          {index < steps.length - 1 ? (
            <span className="dawg-flow__arrow" aria-hidden="true">
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

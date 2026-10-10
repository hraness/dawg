import { SyntaxCode } from "@hraness/design-kit/react/server";
import Link from "next/link";
import type { ReactNode } from "react";

import { type DocMark, NOTE_MARKS, SECTION_MARKS } from "./doc-marks";

/** A doc mark before a heading or note; the words beside it say the same. */
function Mark({ mark }: Readonly<{ mark: DocMark }>) {
  return (
    <span className={`dawg-mark dawg-mark--${mark.role}`} aria-hidden="true">
      {mark.mark}
    </span>
  );
}

/**
 * A small renderer for the Markdown that CHANGELOG.md and the TUI guides use:
 * headings, paragraphs, bullet and numbered lists, tables, fenced code,
 * inline code, bold and links. It renders text as React children, never as
 * raw HTML. Only https links and links to other guides become anchors; a
 * guide link is `other-guide.md` or `guides/path/other-guide.md`.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/gu;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] !== undefined) out.push(<code key={key}>{match[1]}</code>);
    else if (match[2] !== undefined)
      out.push(<strong key={key}>{inline(match[2], key)}</strong>);
    else if (match[3] !== undefined && match[4] !== undefined) {
      const href = match[4];
      const guide = href.match(
        /^(?:\.\.?\/)*(?:[\w-]+\/)*([a-z0-9][a-z0-9-]*)\.md(#[\w-]+)?$/u,
      );
      out.push(
        /^https:\/\//u.test(href) ? (
          <a key={key} href={href}>
            {inline(match[3], key)}
          </a>
        ) : guide !== null ? (
          <Link key={key} href={`/docs/${guide[1]!}${guide[2] ?? ""}`}>
            {inline(match[3], key)}
          </Link>
        ) : (
          <span key={key}>{inline(match[3], key)}</span>
        ),
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function Markdown({
  source,
  headingOffset = 0,
  marks = false,
}: Readonly<{
  source: string;
  headingOffset?: number;
  /** Guide pages: the TUI's section and note marks (app/doc-marks.ts). */
  marks?: boolean;
}>) {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = line.match(/^```([\w-]*)/u);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```"))
        body.push(lines[i++]!);
      i += 1;
      const language = fence[1] === "" ? "text" : fence[1]!;
      blocks.push(
        <pre key={key++} className="dawg-pre" tabIndex={0}>
          <SyntaxCode
            code={body.join("\n")}
            language={language}
            styles="classes"
          />
        </pre>,
      );
      continue;
    }
    if (/^\|.*\|\s*$/u.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/u.test(lines[i]!)) {
        const cells = lines[i]!.trim()
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) rows.push(cells);
        i += 1;
      }
      const [head, ...body] = rows;
      const tableKey = key++;
      blocks.push(
        <div key={tableKey} className="dawg-table-wrap" tabIndex={0}>
          <table className="dawg-table">
            {head === undefined ? null : (
              <thead>
                <tr>
                  {head.map((cell, n) => (
                    <th key={n} scope="col">
                      {inline(cell, `t${tableKey}-h${n}`)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, n) => (
                    <td key={n}>{inline(cell, `t${tableKey}-${r}-${n}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\d+\.\s+/u.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^(\d+\.\s+|\s{2,}\S)/u.test(lines[i]!)) {
        const current = lines[i]!;
        if (/^\d+\.\s+/u.test(current))
          items.push(current.replace(/^\d+\.\s+/u, ""));
        else items[items.length - 1] += ` ${current.trim()}`;
        i += 1;
      }
      const listKey = key++;
      blocks.push(
        <ol key={listKey}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `o${listKey}-${n}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/u);
    if (heading) {
      const level = Math.min(6, heading[1]!.length + headingOffset);
      const Tag = `h${level}` as "h2";
      const mark = marks ? SECTION_MARKS[heading[2]!] : undefined;
      blocks.push(
        <Tag key={key++} id={slugify(heading[2]!)}>
          {mark === undefined ? null : <Mark mark={mark} />}
          {inline(heading[2]!, `h${key}`)}
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (/^[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^([-*]\s+|\s{2,}\S)/u.test(lines[i]!)) {
        const current = lines[i]!;
        if (/^[-*]\s+/u.test(current))
          items.push(current.replace(/^[-*]\s+/u, ""));
        else items[items.length - 1] += ` ${current.trim()}`;
        i += 1;
      }
      const listKey = key++;
      blocks.push(
        <ul key={listKey}>
          {items.map((item, n) => {
            const note = marks
              ? item.match(/^(Tip|Careful): /u)?.[1]
              : undefined;
            if (note === undefined)
              return <li key={n}>{inline(item, `l${listKey}-${n}`)}</li>;
            const mark = NOTE_MARKS[note as keyof typeof NOTE_MARKS];
            return (
              <li key={n} className={`dawg-note dawg-note--${mark.role}`}>
                <Mark mark={mark} />
                {inline(item, `l${listKey}-${n}`)}
              </li>
            );
          })}
        </ul>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,6}\s|```|[-*]\s|\d+\.\s|\|)/u.test(lines[i]!)
    )
      para.push(lines[i++]!.trim());
    const paraKey = key++;
    blocks.push(<p key={paraKey}>{inline(para.join(" "), `p${paraKey}`)}</p>);
  }
  return <>{blocks}</>;
}

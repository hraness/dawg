import type { ReactNode } from "react";

/**
 * A small renderer for the Markdown CHANGELOG.md uses: headings, paragraphs,
 * bullet lists, fenced code, inline code, bold and links. It renders text as
 * React children, never as raw HTML, and only https links become anchors.
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
      out.push(
        /^https:\/\//u.test(href) ? (
          <a key={key} href={href}>
            {inline(match[3], key)}
          </a>
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
}: Readonly<{ source: string; headingOffset?: number }>) {
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
    const fence = line.match(/^```(\w*)/u);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```"))
        body.push(lines[i++]!);
      i += 1;
      blocks.push(
        <pre key={key++} className="dawg-pre" tabIndex={0}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/u);
    if (heading) {
      const level = Math.min(6, heading[1]!.length + headingOffset);
      const Tag = `h${level}` as "h2";
      blocks.push(
        <Tag key={key++} id={slugify(heading[2]!)}>
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
          {items.map((item, n) => (
            <li key={n}>{inline(item, `l${listKey}-${n}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,6}\s|```|[-*]\s)/u.test(lines[i]!)
    )
      para.push(lines[i++]!.trim());
    const paraKey = key++;
    blocks.push(<p key={paraKey}>{inline(para.join(" "), `p${paraKey}`)}</p>);
  }
  return <>{blocks}</>;
}

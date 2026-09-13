import type { ReactNode } from "react";

/**
 * A small, dependency-free renderer for the import report's Markdown: headings, paragraphs, bullet
 * lists, pipe tables, and inline **bold**, _italic_ and `code`. Nothing else is needed for the report,
 * and nothing is interpreted as HTML.
 */

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(
        <code key={`${key}-${i++}`} className="bg-muted rounded px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={`${key}-${i++}`}>{tok.slice(1, -1)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let escaped = false;
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const ch of body) {
    if (escaped) {
      cur += ch;
      escaped = false;
    } else if (ch === "\\") escaped = true;
    else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = (heading[1] as string).length;
      const content = inline(heading[2] as string, `h${k}`);
      const cls = [
        "text-xl font-semibold tracking-tight mt-2",
        "text-lg font-semibold mt-8",
        "text-base font-semibold mt-6",
        "text-sm font-semibold mt-4",
      ][level - 1];
      blocks.push(
        level === 1 ? (
          <h1 key={k++} className={cls}>
            {content}
          </h1>
        ) : level === 2 ? (
          <h2 key={k++} className={cls}>
            {content}
          </h2>
        ) : level === 3 ? (
          <h3 key={k++} className={cls}>
            {content}
          </h3>
        ) : (
          <h4 key={k++} className={cls}>
            {content}
          </h4>
        ),
      );
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith("|"))
        rows.push(lines[i++] as string);
      const header = splitRow(rows[0] as string);
      const body = rows.slice(1).filter((r) => !/^\|?\s*:?-{2,}/.test(r.trim()));
      const align =
        rows[1] && /-/.test(rows[1])
          ? splitRow(rows[1]).map((c) =>
              c.endsWith(":") && !c.startsWith(":")
                ? "right"
                : c.startsWith(":") && c.endsWith(":")
                  ? "center"
                  : "left",
            )
          : header.map(() => "left");
      blocks.push(
        <div key={k++} className="my-3 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {header.map((h, j) => (
                  <th
                    key={j}
                    className={`px-2 py-1.5 text-xs font-medium ${align[j] === "right" ? "text-right" : align[j] === "center" ? "text-center" : "text-left"}`}
                  >
                    {inline(h, `th${k}-${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => {
                const cells = splitRow(r);
                return (
                  <tr key={ri} className="border-t">
                    {cells.map((c, j) => (
                      <td
                        key={j}
                        className={`px-2 py-1 align-top ${align[j] === "right" ? "tabular text-right" : align[j] === "center" ? "text-center" : "text-left"}`}
                      >
                        {inline(c, `td${k}-${ri}-${j}`)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] as string))
        items.push((lines[i++] as string).replace(/^\s*[-*]\s+/, ""));
      blocks.push(
        <ul key={k++} className="my-2 list-disc space-y-1 pl-6 text-sm">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li${k}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() !== "" &&
      !/^(#{1,4})\s/.test(lines[i] as string) &&
      !(lines[i] as string).trim().startsWith("|") &&
      !/^\s*[-*]\s+/.test(lines[i] as string)
    )
      para.push(lines[i++] as string);
    blocks.push(
      <p key={k++} className="my-2 text-sm leading-6">
        {inline(para.join(" "), `p${k}`)}
      </p>,
    );
  }
  return <div className="max-w-none">{blocks}</div>;
}

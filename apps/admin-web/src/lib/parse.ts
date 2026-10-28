/** Duration parser ported from the artifact: "1:30", "1.5", "1,5h 20m", "45m". */
export function parseDuration(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  let m = v.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = v.match(/^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (m && (m[1] || m[2])) {
    return Math.round(
      parseFloat((m[1] ?? "0").replace(",", ".")) * 60 + Number(m[2] ?? 0)
    );
  }
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null;
}

/** Price/number parser ported from the artifact ("489.000", "1,5"). */
export function parseNum(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseFloat(
    value
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(\D|$))/g, "")
      .replace(",", ".")
  );
  return Number.isFinite(n) ? n : null;
}

/** Textarea lines ⇄ string[] (artifact stored pros/cons one per line). */
export const linesOf = (t: string): string[] =>
  t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
export const toLines = (xs: string[]): string => xs.join("\n");

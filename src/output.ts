/**
 * Table formatting helper for CLI output.
 */

export function printTable(
  headers: string[],
  rows: string[][],
): void {
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  // Header
  const headerLine = headers
    .map((h, i) => h.padEnd(widths[i]))
    .join("  ");
  console.log(`  ${headerLine}`);
  console.log(`  ${widths.map((w) => "─".repeat(w)).join("  ")}`);

  // Rows
  for (const row of rows) {
    const line = row.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  ");
    console.log(`  ${line}`);
  }
}

export interface TableOptions {
  /** Max total line width (e.g. process.stdout.columns) */
  maxWidth?: number;
  /** Column indices that flex (shrink/expand) to fill remaining space */
  flexColumns?: number[];
}

/**
 * Format a table as a string. Returns the formatted output.
 * Pass headers=null to omit the header row and separator.
 */
export function formatTable(
  headers: string[] | null,
  rows: string[][],
  options?: TableOptions,
): string {
  if (rows.length === 0) return "  (none)\n";

  const numCols = (headers ?? rows[0]).length;
  const maxWidth = options?.maxWidth;
  const flexCols = new Set(options?.flexColumns ?? []);

  // Calculate natural widths
  const widths = Array.from({ length: numCols }, (_, i) => {
    const headerLen = headers ? headers[i].length : 0;
    const maxCell = Math.max(0, ...rows.map((r) => (r[i] ?? "").length));
    return Math.max(headerLen, maxCell);
  });

  // Constrain flex columns to fit within maxWidth
  if (flexCols.size > 0 && maxWidth != null) {
    const indent = 2;
    const gaps = (numCols - 1) * 2;
    const fixedWidth = widths.reduce(
      (sum, w, i) => sum + (flexCols.has(i) ? 0 : w),
      0,
    );
    const available = maxWidth - indent - gaps - fixedWidth;

    if (available > 0) {
      // Sort flex columns by natural width so narrow ones keep their size
      const flexArr = [...flexCols].sort((a, b) => widths[a] - widths[b]);
      let remaining = available;
      let unsettled = flexArr.length;

      for (const i of flexArr) {
        const share = Math.floor(remaining / unsettled);
        if (widths[i] <= share) {
          remaining -= widths[i];
        } else {
          widths[i] = share;
          remaining -= share;
        }
        unsettled--;
      }
    } else {
      for (const i of flexCols) {
        widths[i] = 0;
      }
    }
  }

  const truncate = (s: string, w: number): string => {
    if (w <= 0) return "";
    if (s.length <= w) return s.padEnd(w);
    if (w <= 3) return s.slice(0, w);
    return s.slice(0, w - 3) + "...";
  };

  const formatRow = (cells: string[]): string => {
    const parts: string[] = [];
    for (let i = 0; i < numCols; i++) {
      if (widths[i] <= 0) continue;
      parts.push(truncate(cells[i] ?? "", widths[i]));
    }
    return `  ${parts.join("  ")}`;
  };

  const lines: string[] = [];

  if (headers) {
    lines.push(formatRow(headers));
    const sepParts: string[] = [];
    for (let i = 0; i < numCols; i++) {
      if (widths[i] <= 0) continue;
      sepParts.push("─".repeat(widths[i]));
    }
    lines.push(`  ${sepParts.join("  ")}`);
  }

  for (const row of rows) {
    lines.push(formatRow(row));
  }

  return lines.join("\n") + "\n";
}

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

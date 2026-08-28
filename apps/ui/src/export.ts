function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown): void {
  downloadFile(`${filename}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export function downloadCsv(filename: string, rows: Array<object>): void {
  downloadFile(`${filename}.csv`, toCsv(rows as Array<Record<string, unknown>>), 'text/csv');
}

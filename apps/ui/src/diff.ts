export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

const MAX_LINES = 1500;

/** Pretty-prints JSON so structurally equal bodies diff cleanly; other text is kept as is. */
export function normalizeForDiff(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Line diff (longest common subsequence). Falls back to whole-block replace when huge. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      (lcs[i] as number[])[j] =
        a[i] === b[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] as string });
      i += 1;
      j += 1;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      out.push({ type: 'del', text: a[i] as string });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j] as string });
      j += 1;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] as string });
  while (j < m) out.push({ type: 'add', text: b[j++] as string });
  return out;
}

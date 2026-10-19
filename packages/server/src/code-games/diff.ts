/** Une ligne de comparaison : inchangée (' '), ajoutée (+), retirée (-), ou masque d'un passage inchangé (…). */
export type DiffLine = { kind: ' ' | '+' | '-' | '…'; text: string };

/** Nombre maximal de modifications calculées exactement. Au-delà, le milieu est montré comme remplacé en bloc. */
const MAX_EDITS = 2000;

/**
 * Différence ligne à ligne entre deux versions d'un fichier (plus longue suite commune). Les lignes
 * identiques en tête et en queue sont écartées d'abord : une petite correction coûte donc peu.
 */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const same = (text: string): DiffLine => ({ kind: ' ', text });
  return [
    ...before.slice(0, head).map(same),
    ...middle(before.slice(head, before.length - tail), after.slice(head, after.length - tail)),
    ...before.slice(before.length - tail).map(same),
  ];
}

function middle(a: string[], b: string[]): DiffLine[] {
  if (a.length === 0 && b.length === 0) return [];
  const trace = shortestEdit(a, b);
  if (!trace)
    return [...a.map((text) => ({ kind: '-' as const, text })), ...b.map((text) => ({ kind: '+' as const, text }))];
  return backtrack(trace, a, b);
}

/**
 * Algorithme de Myers : le coût dépend du nombre de modifications, pas de la taille des fichiers. Une petite
 * correction dans un bundle de plusieurs milliers de lignes se calcule donc vite. Renvoie la trace des
 * itérations, ou null si les modifications dépassent MAX_EDITS.
 */
function shortestEdit(a: string[], b: string[]): Int32Array[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    // Copie de la partie de `v` utile à cette itération (k de -d-1 à d+1).
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!);
      let x = down ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return trace;
    }
  }
  return null;
}

/** Reconstitue les lignes à partir de la trace de Myers, dans l'ordre du texte. */
function backtrack(trace: Int32Array[], a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!;
    const at = (k: number) => v[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ kind: ' ', text: a[x - 1]! });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ kind: '+', text: b[prevY]! });
      else out.push({ kind: '-', text: a[prevX]! });
    }
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

/**
 * Ne garde que les lignes modifiées et `context` lignes de part et d'autre, pour la revue.
 * Les passages inchangés masqués sont remplacés par une ligne « … ».
 */
export function changedHunks(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === ' ') return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let gap = lines.length > 0 && !keep[0];
  lines.forEach((line, index) => {
    if (!keep[index]) {
      gap = true;
      return;
    }
    if (gap) out.push({ kind: '…', text: '' });
    gap = false;
    out.push(line);
  });
  return out;
}

/** Nombre de lignes ajoutées et retirées. */
export function countChanges(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === '+') added++;
    if (line.kind === '-') removed++;
  }
  return { added, removed };
}

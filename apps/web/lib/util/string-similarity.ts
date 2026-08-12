// Small pure-function name-similarity helper (2026-08-12, Phase 28) — used to
// suggest an Empcode↔employee match on the Admin device-mapping screen.
// Deliberately simple (normalized Levenshtein distance): no existing fuzzy-
// match utility in the repo, and TeamOffice names are short single tokens or
// "First Last" pairs, not free text, so nothing more elaborate is warranted.

/** Case/whitespace-insensitive normalization before comparing. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** Similarity in [0, 1] — 1 is an exact match (after normalization), 0 is
 *  completely dissimilar. Based on normalized Levenshtein distance. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length === 0 && nb.length === 0) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  const distance = levenshtein(na, nb);
  return 1 - distance / maxLen;
}

/** Given a candidate name and a list of (id, name) options, return the best
 *  match sorted by descending similarity. Empty input → empty output. */
export function bestNameMatches<T extends { name: string }>(
  candidate: string,
  options: T[],
  limit = 3,
): (T & { similarity: number })[] {
  return options
    .map((o) => ({ ...o, similarity: nameSimilarity(candidate, o.name) }))
    .sort((x, y) => y.similarity - x.similarity)
    .slice(0, limit);
}

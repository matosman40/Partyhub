import type { CardEntry, CardFamily } from './card-games.js';

/**
 * Import CSV des cartes à texte : une ligne = un type de carte, la première ligne donne les colonnes.
 * Colonnes reconnues, en français ou en anglais, sans tenir compte de la casse :
 *   id · nom | label · symbole | symbol · famille | family · texte | text · nombre | count ·
 *   points · paire | pair · rang | rank
 * Séparateur : virgule ou point-virgule, détecté sur la première ligne. Guillemets doubles acceptés
 * (« "" » pour un guillemet). Chaque erreur indique le numéro de ligne.
 */

export const CARD_CSV_MAX_ROWS = 200;
export const CARD_CSV_MAX_CHARS = 200_000;

const COLUMN_NAMES: Record<string, string> = {
  id: 'id',
  nom: 'label',
  label: 'label',
  symbole: 'symbol',
  symbol: 'symbol',
  famille: 'family',
  family: 'family',
  texte: 'text',
  text: 'text',
  nombre: 'count',
  count: 'count',
  points: 'points',
  paire: 'pair',
  pair: 'pair',
  rang: 'rank',
  rank: 'rank',
};

const ID_PATTERN = /^[a-z0-9-]{1,16}$/;

export type CardCsvResult = { ok: true; cards: CardEntry[] } | { ok: false; error: string };

/** Séparateur de la première ligne : le point-virgule si la ligne en compte plus que de virgules. */
function detectSeparator(text: string): ',' | ';' {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

/** Découpe le texte en lignes de cellules. Les lignes vides sont gardées, pour que les numéros restent justes. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const sep = detectSeparator(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const isBlank = (row: string[]) => row.every((c) => c.trim() === '');

/**
 * Transforme un CSV en types de cartes. `families` : familles de la définition (la première sert par
 * défaut). `taken` : identifiants déjà utilisés par les cartes saisies à la main.
 */
export function cardsFromCsv(
  text: string,
  families: readonly Pick<CardFamily, 'id'>[],
  taken: ReadonlySet<string> = new Set(),
): CardCsvResult {
  if (text.length > CARD_CSV_MAX_CHARS) return { ok: false, error: 'Fichier CSV trop volumineux (200 Ko au plus).' };
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((r) => !isBlank(r));
  if (headerIndex < 0) return { ok: false, error: 'Le fichier CSV est vide.' };

  const header = rows[headerIndex]!.map((h) => h.trim().toLowerCase());
  const unknown = header.filter((h) => h !== '' && !(h in COLUMN_NAMES));
  if (unknown.length > 0) {
    return { ok: false, error: `Colonne inconnue dans le CSV : « ${unknown[0]} ».` };
  }
  const columns = header.map((h) => (h === '' ? null : COLUMN_NAMES[h]!));
  if (!columns.includes('label') && !columns.includes('text')) {
    return { ok: false, error: 'Le CSV doit avoir une colonne « nom » ou « texte ».' };
  }
  const defaultFamily = families[0]?.id;
  if (!defaultFamily) return { ok: false, error: 'Définissez d’abord au moins une famille.' };

  const cards: CardEntry[] = [];
  const ids = new Set<string>(taken);
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (isBlank(row)) continue;
    const line = r + 1;
    const field = (name: string): string => {
      const idx = columns.indexOf(name);
      return idx >= 0 ? (row[idx] ?? '').trim() : '';
    };
    if (cards.length >= CARD_CSV_MAX_ROWS) {
      return { ok: false, error: `Le CSV dépasse ${CARD_CSV_MAX_ROWS} cartes.` };
    }

    const label = field('label');
    const textValue = field('text');
    if (!label && !textValue) return { ok: false, error: `Ligne ${line} : un nom ou un texte est requis.` };
    if (label.length > 24) return { ok: false, error: `Ligne ${line} : le nom dépasse 24 caractères.` };
    if (textValue.length > 240) return { ok: false, error: `Ligne ${line} : le texte dépasse 240 caractères.` };

    const family = field('family') || defaultFamily;
    if (!families.some((f) => f.id === family)) {
      return { ok: false, error: `Ligne ${line} : famille « ${family} » inconnue.` };
    }

    const countText = field('count');
    const count = countText === '' ? 1 : Number(countText);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      return { ok: false, error: `Ligne ${line} : le nombre doit être un entier de 1 à 20.` };
    }
    const pointsText = field('points');
    const points = pointsText === '' ? 0 : Number(pointsText);
    if (!Number.isInteger(points) || points < 0 || points > 100) {
      return { ok: false, error: `Ligne ${line} : les points doivent être un entier de 0 à 100.` };
    }
    const rankText = field('rank');
    const rank = rankText === '' ? undefined : Number(rankText);
    if (rank !== undefined && (!Number.isInteger(rank) || rank < 0 || rank > 999)) {
      return { ok: false, error: `Ligne ${line} : le rang doit être un entier de 0 à 999.` };
    }
    const pair = field('pair');
    if (pair.length > 40) return { ok: false, error: `Ligne ${line} : la paire dépasse 40 caractères.` };

    const id = field('id') || `t${line}`;
    if (!ID_PATTERN.test(id)) {
      return { ok: false, error: `Ligne ${line} : identifiant « ${id} » invalide (minuscules, chiffres, tirets).` };
    }
    if (ids.has(id)) return { ok: false, error: `Ligne ${line} : identifiant « ${id} » déjà utilisé.` };
    ids.add(id);

    // Le symbole central : celui du CSV, sinon les premiers caractères du nom, sinon un point d’interrogation.
    const symbol = Array.from(field('symbol') || label || '?')
      .slice(0, 4)
      .join('');

    cards.push({
      id,
      label,
      symbol,
      family,
      effect: 'none',
      count,
      points,
      ...(textValue ? { text: textValue } : {}),
      ...(rank !== undefined ? { rank } : {}),
      ...(pair ? { pair } : {}),
    });
  }
  if (cards.length === 0) return { ok: false, error: 'Le CSV ne contient aucune carte.' };
  return { ok: true, cards };
}

/**
 * Ajoute les cartes d’un champ `csv` à la définition, puis retire ce champ. Accepte une définition seule
 * ou un fichier d’export (`definition` à l’intérieur). Sans champ `csv`, renvoie la valeur inchangée.
 */
export function mergeCardCsv(input: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: true, value: input };
  const wrapper = input as Record<string, unknown>;
  const inner =
    wrapper.definition && typeof wrapper.definition === 'object'
      ? (wrapper.definition as Record<string, unknown>)
      : wrapper;
  if (inner.csv === undefined) return { ok: true, value: input };
  if (typeof inner.csv !== 'string') return { ok: false, error: 'Le champ csv doit être un texte.' };

  const families = Array.isArray(inner.families)
    ? inner.families.filter((f): f is { id: string } => !!f && typeof (f as { id?: unknown }).id === 'string')
    : [];
  const existing = Array.isArray(inner.cards) ? inner.cards : [];
  const taken = new Set(existing.map((c) => (c && typeof c === 'object' ? String((c as { id?: unknown }).id) : '')));
  const parsed = cardsFromCsv(inner.csv, families, taken);
  if (!parsed.ok) return parsed;

  const { csv: _csv, ...rest } = inner;
  const merged = { ...rest, cards: [...existing, ...parsed.cards] };
  return { ok: true, value: wrapper.definition ? { ...wrapper, definition: merged } : merged };
}

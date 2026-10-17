import { z } from 'zod';

/**
 * Mots-clés proposés à tour de rôle : chaque joueur en donne quelques-uns, et l'IA s'en sert comme thème.
 * Ce module ne connaît aucun jeu : il découpe la saisie et gère l'ordre de passage. Le minuteur de chaque tour
 * reste au moteur du jeu, qui l'arme et le relance avec `ctx.schedule`.
 */

export const KEYWORDS_MAX = 5;
export const KEYWORD_MAX_LENGTH = 24;
export const KEYWORD_INPUT_MAX = 160;
export const TOPIC_SECONDS_DEFAULT = 30;

export const keywordsPayloadSchema = z.object({ words: z.string().max(KEYWORD_INPUT_MAX) });

/** Mots-clés proposés par les robots (mode test), quand leur tour arrive. */
export const BOT_KEYWORDS = [
  'Espace, planètes',
  'Cuisine, fromage',
  'Football, stade',
  'Musique, guitare',
  'Animaux, savane',
  'Histoire, Rome',
  'Océan, baleines',
];

/**
 * Découpe une saisie libre (virgules, points-virgules, retours à la ligne) en mots-clés propres et uniques.
 * Les caractères de contrôle sont retirés, la casse est ignorée pour les doublons, et le nombre est borné.
 */
/** Remplace les caractères de contrôle (tabulations comprises) par des espaces. */
function stripControls(text: string): string {
  return Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');
}

export function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]+/)) {
    // Coupé par caractères et non par unités de code : un emoji n'est jamais coupé en deux.
    const word = Array.from(stripControls(raw).replace(/\s+/g, ' ').trim())
      .slice(0, KEYWORD_MAX_LENGTH)
      .join('')
      .trim();
    if (!word) continue;
    const key = word.toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length === KEYWORDS_MAX) break;
  }
  return out;
}

export interface KeywordTurns {
  /** Ordre de passage : identifiants des joueurs au lancement de la phase. */
  order: string[];
  /** Rang du joueur dont c'est le tour. Égal à `order.length` quand tous les tours sont passés. */
  turn: number;
  /** Mots-clés proposés, par joueur. Un joueur absent ou passé n'apparaît pas. */
  entries: Record<string, string[]>;
  /** Fin du tour en cours (horloge serveur), 0 quand il n'y en a plus. */
  endsAt: number;
}

/** Premier tour jouable à partir de `from` : les joueurs déconnectés sont sautés sans bloquer la phase. */
function playableFrom(order: string[], from: number, connected: string[]): number {
  let turn = from;
  while (turn < order.length && !connected.includes(order[turn]!)) turn++;
  return turn;
}

function atTurn(t: KeywordTurns, turn: number, now: number, seconds: number): KeywordTurns {
  const active = turn < t.order.length;
  return { ...t, turn, endsAt: active ? now + seconds * 1000 : 0 };
}

export function openKeywordTurns(order: string[], now: number, seconds: number, connected: string[]): KeywordTurns {
  const base: KeywordTurns = { order, turn: 0, entries: {}, endsAt: 0 };
  return atTurn(base, playableFrom(order, 0, connected), now, seconds);
}

export function turnPlayer(t: KeywordTurns): string | null {
  return t.turn < t.order.length ? (t.order[t.turn] ?? null) : null;
}

export function turnsDone(t: KeywordTurns): boolean {
  return t.turn >= t.order.length;
}

/** Enregistre les mots-clés du joueur dont c'est le tour, puis passe au suivant. */
export function submitKeywords(
  t: KeywordTurns,
  words: string[],
  now: number,
  seconds: number,
  connected: string[],
): KeywordTurns {
  const id = turnPlayer(t);
  if (!id) return t;
  const entries = { ...t.entries, [id]: words };
  return passTurn({ ...t, entries }, now, seconds, connected);
}

/** Passe le tour en cours sans mot-clé (temps écoulé, joueur parti). */
export function passTurn(t: KeywordTurns, now: number, seconds: number, connected: string[]): KeywordTurns {
  const next = playableFrom(t.order, t.turn + 1, connected);
  return atTurn(t, next, now, seconds);
}

/** Thèmes utilisables, dans l'ordre de passage : seulement les joueurs qui ont donné au moins un mot-clé. */
export function keywordThemes(
  t: KeywordTurns,
  names: Record<string, string>,
): Array<{ id: string; name: string; keywords: string[] }> {
  return t.order
    .filter((id) => (t.entries[id]?.length ?? 0) > 0)
    .map((id) => ({ id, name: names[id] ?? '?', keywords: t.entries[id] ?? [] }));
}

/**
 * Jeux qui publient les informations communes à la salle : le classement (`ranking`) et la liste
 * « qui n’a pas encore répondu » (`pending`). Sur un téléphone, sans écran principal, ces informations
 * remplacent celles de l’écran commun. Les autres jeux gardent leur affichage : leurs champs ont
 * parfois un autre sens.
 */
export const PENDING_LIST_GAMES: ReadonlySet<string> = new Set([
  'quiz-party',
  'phrases-trous',
  'association',
  'plutot-qui',
  'imposteur',
  'plus-ou-moins',
  'micro-defis',
  'gags-en-rafale',
  'funambule',
  'imite-moi',
  'aventure-ia',
]);

/** Nombre de rangs affichés sur le téléphone. */
export const RANKING_SHOWN = 5;

/** Noms des joueurs que la salle attend encore, lus dans la vue publique. Vide si rien à afficher. */
export function pendingNames(gameId: string, publicState: unknown): string[] {
  if (!PENDING_LIST_GAMES.has(gameId)) return [];
  const pending = (publicState as { pending?: unknown } | null | undefined)?.pending;
  if (!Array.isArray(pending)) return [];
  return pending.filter((n): n is string => typeof n === 'string' && n.length > 0);
}

export interface RankLine {
  rank: number;
  name: string;
  points: number;
}

/** Les premiers rangs du classement public, sous une forme simple. Vide si le jeu n’en publie pas. */
export function rankingLines(gameId: string, publicState: unknown): RankLine[] {
  if (!PENDING_LIST_GAMES.has(gameId)) return [];
  const ranking = (publicState as { ranking?: unknown } | null | undefined)?.ranking;
  if (!Array.isArray(ranking)) return [];
  const lines: RankLine[] = [];
  for (const entry of ranking) {
    const e = entry as { name?: unknown; points?: unknown; rank?: unknown };
    if (typeof e?.name !== 'string' || typeof e.points !== 'number') continue;
    lines.push({ rank: typeof e.rank === 'number' ? e.rank : lines.length + 1, name: e.name, points: e.points });
  }
  return lines.slice(0, RANKING_SHOWN);
}

/** Bandeau sur le téléphone : classement et joueurs attendus, uniquement quand il y a quelque chose à dire. */
export function PendingNotice({ gameId, publicState }: { gameId: string; publicState: unknown }) {
  const names = pendingNames(gameId, publicState);
  const ranks = rankingLines(gameId, publicState);
  if (names.length === 0 && ranks.length === 0) return null;
  return (
    <section className="common-info muted small" aria-label="Informations de la salle">
      {ranks.length > 0 && (
        <p className="ranking-line">
          Classement : {ranks.map((r) => `${r.rank}. ${r.name} ${r.points} pt${r.points > 1 ? 's' : ''}`).join(' · ')}
        </p>
      )}
      {names.length > 0 && (
        <p className="pending-notice" role="status" aria-live="polite">
          En attente : {names.join(', ')}
        </p>
      )}
    </section>
  );
}

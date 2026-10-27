/**
 * Jeux dont la vue publique donne la liste « qui n’a pas encore répondu » (champ `pending`, tableau de noms).
 * Les autres jeux gardent leur affichage : le champ `pending` y a parfois un autre sens.
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

/** Noms des joueurs que la salle attend encore, lus dans la vue publique. Vide si rien à afficher. */
export function pendingNames(gameId: string, publicState: unknown): string[] {
  if (!PENDING_LIST_GAMES.has(gameId)) return [];
  const pending = (publicState as { pending?: unknown } | null | undefined)?.pending;
  if (!Array.isArray(pending)) return [];
  return pending.filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/** Bandeau sur le téléphone : « En attente : … », uniquement quand des joueurs sont attendus. */
export function PendingNotice({ gameId, publicState }: { gameId: string; publicState: unknown }) {
  const names = pendingNames(gameId, publicState);
  if (names.length === 0) return null;
  return (
    <p className="muted small pending-notice" role="status" aria-live="polite">
      En attente : {names.join(', ')}
    </p>
  );
}

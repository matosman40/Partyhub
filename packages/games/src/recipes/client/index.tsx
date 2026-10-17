import type { ComponentType } from 'react';
import type { ScreenBlock } from '@partyhub/shared';
import type { GameClientViews, HostViewProps, PlayerViewProps, SettingsProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { PhoneBlock, TvBlock } from './blocks.js';

/**
 * Vues communes à toutes les recettes (paquets de format 3). Chaque paquet a sa propre disposition, décrite
 * par le serveur : ces vues n'ont aucun réglage à proposer, les règles viennent du paquet.
 */

/** Pas de réglage côté écran principal : les règles sont celles du paquet. */
const RecipeSettings: ComponentType<SettingsProps> = () => null;

function RecipeHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;
  if (pub.phase === 'pret') return <WaitingScreen title="En attente du lancement…" />;
  if (pub.phase === 'generation') {
    return <WaitingScreen title="L’IA écrit les consignes…" text={pub.notice ?? undefined} />;
  }

  const pending: string[] = host?.pending ?? [];
  const blocks: ScreenBlock[] = pub.layout?.tv ?? [];
  return (
    <section className="game-host fade-in" key={`${pub.phase}-${pub.round}`}>
      {blocks.map((block, i) => (
        <TvBlock key={`${i}-${block}`} block={block} pub={pub} remaining={remaining} pending={pending} />
      ))}
      {pub.notice && pub.phase !== 'generation' && <p className="muted">{pub.notice}</p>}
    </section>
  );
}

function RecipePlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;
  if (pub.phase === 'pret') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }
  if (pub.phase === 'generation') return <WaitingScreen title="Le jeu prépare les consignes…" />;
  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;

  const blocks: ScreenBlock[] = pub.layout?.joueur ?? [];
  return (
    <section className="player-game fade-in">
      {blocks.map((block, i) => (
        <PhoneBlock key={`${i}-${block}`} block={block} pub={pub} remaining={remaining} me={me} send={send} />
      ))}
    </section>
  );
}

export const recipeViews: GameClientViews = {
  Settings: RecipeSettings,
  Host: RecipeHost,
  Player: RecipePlayer,
};

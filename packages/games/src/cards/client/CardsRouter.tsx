import type { HostViewProps, PlayerViewProps } from '../../client/types.js';
import { CardsHost } from './CardsHost.js';
import { CardsPlayer } from './CardsPlayer.js';
import { MemoryHost } from './MemoryHost.js';
import { MemoryPlayer } from './MemoryPlayer.js';
import { RaceHost } from './RaceHost.js';
import { RacePlayer } from './RacePlayer.js';
import { TrickHost } from './TrickHost.js';
import { TrickPlayer } from './TrickPlayer.js';

/**
 * Chaque mécanique de carte a ses propres vues ; l'état public indique laquelle utiliser.
 * Les jeux à la défausse (sans `kind`) gardent les vues historiques.
 */
const kindOf = (publicState: unknown): string | undefined => (publicState as { kind?: string } | null)?.kind;

export function CardsHostView(props: HostViewProps) {
  switch (kindOf(props.publicState)) {
    case 'memory':
      return <MemoryHost {...props} />;
    case 'race':
      return <RaceHost {...props} />;
    case 'trick':
      return <TrickHost {...props} />;
    default:
      return <CardsHost {...props} />;
  }
}

export function CardsPlayerView(props: PlayerViewProps) {
  switch (kindOf(props.publicState)) {
    case 'memory':
      return <MemoryPlayer {...props} />;
    case 'race':
      return <RacePlayer {...props} />;
    case 'trick':
      return <TrickPlayer {...props} />;
    default:
      return <CardsPlayer {...props} />;
  }
}

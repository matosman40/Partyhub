import { useMemo } from 'react';
import type { EtatGrille, PublicPlayer, ThemeId } from '@partyhub/shared';
import { GrilleView, type GrilleApparence } from '@partyhub/games/client';
import { PlayerAvatar } from './PlayerAvatar.js';

/**
 * Apparence de chaque joueur sur le plateau en grille : son personnage (profil), à défaut son avatar.
 * Les étiquettes reprennent celles du salon (vous, prêt, robot).
 */
export function apparencesGrille(players: PublicPlayer[], me?: string): Record<string, GrilleApparence> {
  const apparences: Record<string, GrilleApparence> = {};
  for (const p of players) {
    const tags = [p.id === me ? 'vous' : null, p.ready ? 'prêt' : null, p.bot ? 'robot' : null].filter(
      (t): t is string => t !== null,
    );
    apparences[p.id] = {
      name: p.name,
      character: p.avatar.character ?? null,
      avatar: p.avatar.character ? undefined : <PlayerAvatar avatar={p.avatar} name={p.name} size="md" />,
      mine: p.id === me,
      away: !p.connected,
      tags,
    };
  }
  return apparences;
}

/** Le plateau en grille du salon de test, tel qu’il est affiché sur l’écran principal ou un téléphone. */
export function LobbyGrille({
  etat,
  players,
  me,
  label,
  theme,
  className,
}: {
  etat: EtatGrille;
  players: PublicPlayer[];
  me?: string;
  label: string;
  theme?: ThemeId;
  className?: string;
}) {
  const apparences = useMemo(() => apparencesGrille(players, me), [players, me]);
  return <GrilleView etat={etat} apparences={apparences} label={label} theme={theme} className={className} />;
}

import type { CharacterMood, LobbyMood, LobbyPosition, PublicPlayer } from '@partyhub/shared';
import { defaultLobbyPosition, LOBBY_MOOD_INFO, LOBBY_MOODS } from '@partyhub/shared';
import { Plateau, type PlateauFigure } from '@partyhub/games/client';
import { PlayerAvatar } from './PlayerAvatar.js';
import type { LobbyEmote } from './useLobbyMoods.js';

/**
 * Le salon est un plateau : chaque joueur y a son personnage, avec sa pose et son émotion en bulle.
 * Le plateau lui-même (décor, déplacements, bulles) est dans `@partyhub/games/client`.
 */
export function LobbyPlateau({
  players,
  poses,
  emotes,
  positions = {},
  me,
  onMove,
  label,
}: {
  players: PublicPlayer[];
  /** Pose de chaque personnage, par identifiant (émotions et saluts d'arrivée). */
  poses: Record<string, CharacterMood>;
  /** Émotions en bulle, par identifiant. */
  emotes: Record<string, LobbyEmote>;
  /** Dernières places diffusées (plus fraîches que la vue de la salle), par identifiant. */
  positions?: Record<string, LobbyPosition>;
  /** Identifiant du joueur de cet appareil (absent sur l'écran principal). */
  me?: string;
  onMove?: (position: LobbyPosition) => void;
  label: string;
}) {
  const count = players.length;
  const figures: PlateauFigure[] = players.map((p, i) => {
    const emote = emotes[p.id];
    const tags = [p.id === me ? 'vous' : null, p.ready ? 'prêt' : null, p.bot ? 'robot' : null].filter(
      (t): t is string => t !== null,
    );
    return {
      id: p.id,
      name: p.name,
      position: positions[p.id] ?? p.position ?? defaultLobbyPosition(i, count),
      character: p.avatar.character ?? null,
      avatar: p.avatar.character ? undefined : <PlayerAvatar avatar={p.avatar} name={p.name} size="md" />,
      mood: poses[p.id],
      bubble: emote ? { emoji: LOBBY_MOOD_INFO[emote.mood].emoji, key: emote.id } : null,
      mine: !!onMove && p.id === me,
      away: !p.connected,
      tags,
    };
  });
  return (
    <Plateau
      figures={figures}
      onMove={onMove}
      label={label}
      emptyText="En attente des premiers joueurs…"
      className="lobby-plateau"
    />
  );
}

/**
 * Salon épuré (téléphone, tous les jeux) : la tête de chaque joueur, son pseudo et ses étiquettes.
 * Pas de décor ni de déplacement : le plateau reste réservé au plateau de test.
 */
export function LobbyHeads({
  players,
  me,
  emotes,
}: {
  players: PublicPlayer[];
  /** Identifiant du joueur de cet appareil. */
  me?: string;
  emotes: Record<string, LobbyEmote>;
}) {
  if (players.length === 0) {
    return <p className="lobby-heads-empty muted small">En attente des premiers joueurs…</p>;
  }
  return (
    <ul className="lobby-heads" aria-label="Joueurs de la salle">
      {players.map((p) => {
        const emote = emotes[p.id];
        const isMe = p.id === me;
        const tags = [isMe ? 'vous' : null, p.ready ? 'prêt' : null, p.bot ? 'robot' : null].filter(
          (t): t is string => t !== null,
        );
        return (
          <li key={p.id} className={`lobby-head${p.connected ? '' : ' is-away'}${isMe ? ' is-me' : ''}`}>
            <span className="lobby-head-face">
              <PlayerAvatar avatar={p.avatar} name={p.name} size="md" highlight={isMe} />
              {emote && (
                <span className="lobby-head-emote" aria-hidden="true">
                  {LOBBY_MOOD_INFO[emote.mood].emoji}
                </span>
              )}
            </span>
            <span className="lobby-head-name">{p.name}</span>
            {tags.map((t) => (
              <span key={t} className={`lobby-head-tag${t === 'prêt' ? ' is-ready' : ''}`}>
                {t}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/** Boutons d'émotion : un tap montre l'émotion à toute la salle. */
export function LobbyMoodBar({ onPick }: { onPick: (mood: LobbyMood) => void }) {
  return (
    <div className="lobby-moods" role="group" aria-label="Émotions de votre personnage">
      {LOBBY_MOODS.map((mood) => (
        <button key={mood} type="button" className="lobby-mood-btn" onClick={() => onPick(mood)}>
          <span aria-hidden="true">{LOBBY_MOOD_INFO[mood].emoji}</span>
          <span>{LOBBY_MOOD_INFO[mood].label}</span>
        </button>
      ))}
    </div>
  );
}

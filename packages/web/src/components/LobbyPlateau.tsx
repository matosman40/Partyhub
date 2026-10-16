import type { CharacterMood, LobbyMoodChoice, LobbyPosition, PublicPlayer } from '@partyhub/shared';
import {
  defaultLobbyPosition,
  LOBBY_FACE_INFO,
  LOBBY_FACES,
  LOBBY_MOOD_INFO,
  LOBBY_MOODS,
  lobbyEmoteEmoji,
} from '@partyhub/shared';
import { Plateau, type PlateauFigure } from '@partyhub/games/client';
import { PlayerAvatar } from './PlayerAvatar.js';
import { poseOf, type LobbyEmote } from './useLobbyMoods.js';

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
      face: emote?.face ?? undefined,
      bubble: emote ? { emoji: lobbyEmoteEmoji(emote), key: emote.id } : null,
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
  size = 'md',
}: {
  players: PublicPlayer[];
  /** Identifiant du joueur de cet appareil. */
  me?: string;
  emotes: Record<string, LobbyEmote>;
  /** Grand sur l'écran principal : les visages doivent se lire de loin. */
  size?: 'md' | 'lg';
}) {
  if (players.length === 0) {
    return <p className="lobby-heads-empty muted small">En attente des premiers joueurs…</p>;
  }
  return (
    <ul className={`lobby-heads${size === 'lg' ? ' is-large' : ''}`} aria-label="Joueurs de la salle">
      {players.map((p) => {
        const emote = emotes[p.id];
        const isMe = p.id === me;
        const tags = [isMe ? 'vous' : null, p.ready ? 'prêt' : null, p.bot ? 'robot' : null].filter(
          (t): t is string => t !== null,
        );
        return (
          <li key={p.id} className={`lobby-head${p.connected ? '' : ' is-away'}${isMe ? ' is-me' : ''}`}>
            <span className="lobby-head-face">
              <PlayerAvatar
                avatar={p.avatar}
                name={p.name}
                size={size}
                highlight={isMe}
                mood={emote ? poseOf(emote) : undefined}
                face={emote?.face ?? undefined}
              />
              {emote && (
                <span className="lobby-head-emote" aria-hidden="true">
                  {lobbyEmoteEmoji(emote)}
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

/**
 * Boutons d'émotion : une attitude (le corps bouge) ou un visage (l'expression change), pendant quelques
 * secondes, pour toute la salle. Le visage habituel revient ensuite.
 */
export function LobbyMoodBar({ onPick }: { onPick: (choice: LobbyMoodChoice) => void }) {
  return (
    <div className="lobby-moods">
      <div className="lobby-mood-row" role="group" aria-label="Attitudes de votre personnage">
        {LOBBY_MOODS.map((mood) => (
          <button key={mood} type="button" className="lobby-mood-btn" onClick={() => onPick({ mood })}>
            <span aria-hidden="true">{LOBBY_MOOD_INFO[mood].emoji}</span>
            <span>{LOBBY_MOOD_INFO[mood].label}</span>
          </button>
        ))}
      </div>
      <div className="lobby-mood-row lobby-faces" role="group" aria-label="Visages de votre personnage">
        {LOBBY_FACES.map((face) => (
          <button
            key={face}
            type="button"
            className="lobby-mood-btn lobby-face-btn"
            aria-label={LOBBY_FACE_INFO[face].label}
            onClick={() => onPick({ face })}
          >
            <span aria-hidden="true">{LOBBY_FACE_INFO[face].emoji}</span>
            <span aria-hidden="true">{LOBBY_FACE_INFO[face].label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

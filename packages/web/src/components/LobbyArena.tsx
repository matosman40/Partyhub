import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  clampLobbyPosition,
  defaultLobbyPosition,
  LOBBY_MOOD_INFO,
  LOBBY_MOODS,
  type CharacterMood,
  type LobbyMood,
  type LobbyPosition,
  type PublicPlayer,
} from '@partyhub/shared';
import { Character } from '@partyhub/games/client';
import { PlayerAvatar } from './PlayerAvatar.js';

/** Pas du clavier, en fraction de la zone. */
const KEY_STEP = 0.04;
/** Intervalle minimal entre deux envois pendant un glissement (le serveur accepte 30 par seconde). */
const SEND_EVERY_MS = 120;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Zone du salon : chaque personnage à sa place, avec son émotion en bulle.
 * Sur un téléphone, le sien se glisse au doigt ou se déplace aux flèches du clavier.
 * Sur l'écran principal, la zone est seulement affichée (pas de `onMove`).
 */
export function LobbyArena({
  players,
  moods,
  me,
  onMove,
}: {
  players: PublicPlayer[];
  moods: Record<string, CharacterMood>;
  me?: string;
  onMove?: (position: LobbyPosition) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastSent = useRef(0);
  // Position locale de son propre personnage, pendant et juste après un glissement.
  const [mine, setMine] = useState<LobbyPosition | null>(null);

  const count = players.length;
  const myIndex = players.findIndex((p) => p.id === me);
  const myServer = myIndex >= 0 ? players[myIndex]?.position : null;

  // Quand le serveur a rattrapé la position envoyée, la position locale n'est plus utile.
  useEffect(() => {
    if (!dragging.current) setMine(null);
  }, [myServer?.x, myServer?.y]);

  function toArea(clientX: number, clientY: number): LobbyPosition | null {
    const box = areaRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return clampLobbyPosition({ x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height });
  }

  function send(position: LobbyPosition, force = false) {
    if (!onMove) return;
    const now = performance.now();
    if (!force && now - lastSent.current < SEND_EVERY_MS) return;
    lastSent.current = now;
    onMove(position);
  }

  function onPointerDown(e: PointerEvent<HTMLLIElement>) {
    if (!onMove || e.button > 0) return;
    const p = toArea(e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setMine(p);
    send(p, true);
  }

  function onPointerMove(e: PointerEvent<HTMLLIElement>) {
    if (!dragging.current) return;
    const p = toArea(e.clientX, e.clientY);
    if (!p) return;
    setMine(p);
    send(p);
  }

  function onPointerUp(e: PointerEvent<HTMLLIElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    const p = toArea(e.clientX, e.clientY);
    if (p) {
      setMine(p);
      send(p, true);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    const delta = ARROWS[e.key];
    if (!onMove || !delta || myIndex < 0) return;
    e.preventDefault();
    const current = mine ?? myServer ?? defaultLobbyPosition(myIndex, count);
    const p = clampLobbyPosition({
      x: current.x + delta[0] * KEY_STEP,
      y: current.y + delta[1] * KEY_STEP,
    });
    setMine(p);
    send(p, true);
  }

  return (
    <div className="lobby-arena" ref={areaRef}>
      <ol className="lobby-stage-list" aria-label={`Personnages du salon : ${count} joueur(s)`}>
        {players.map((p, i) => {
          const own = p.id === me && !!onMove;
          const at = own && mine ? mine : (p.position ?? defaultLobbyPosition(i, count));
          const mood = moods[p.id];
          const classes = ['lobby-figure'];
          if (own) classes.push('is-own');
          if (own && mine) classes.push('is-dragging');
          if (!p.connected) classes.push('is-away');
          return (
            <li
              key={p.id}
              className={classes.join(' ')}
              style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
              tabIndex={own ? 0 : undefined}
              role={own ? 'button' : undefined}
              aria-label={own ? `${p.name} (vous) : flèches pour vous déplacer` : p.name}
              onPointerDown={own ? onPointerDown : undefined}
              onPointerMove={own ? onPointerMove : undefined}
              onPointerUp={own ? onPointerUp : undefined}
              onPointerCancel={own ? onPointerUp : undefined}
              onKeyDown={own ? onKeyDown : undefined}
            >
              {mood && mood in LOBBY_MOOD_INFO && (
                <span className="lobby-bubble" aria-hidden="true">
                  {LOBBY_MOOD_INFO[mood as LobbyMood].emoji}
                </span>
              )}
              {p.avatar.character ? (
                <Character spec={p.avatar.character} mood={mood ?? 'idle'} framing="bust" />
              ) : (
                <PlayerAvatar avatar={p.avatar} name={p.name} size="md" />
              )}
              <span className="lobby-name">{p.name}</span>
              {p.ready && <span className="lobby-tag">prêt</span>}
              {p.bot && <span className="lobby-tag">robot</span>}
            </li>
          );
        })}
      </ol>
      {count === 0 && <p className="stage-empty">En attente des premiers joueurs…</p>}
    </div>
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

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clampLobbyPosition, type CharacterMood, type CharacterSpec, type LobbyPosition } from '@partyhub/shared';
import { Character } from './character.js';
import { PrairieScene } from './plateau-scene.js';

/**
 * Plateau : une zone où chaque personnage a sa place, se déplace et prend une émotion en bulle.
 * C'est la base du salon et de tout jeu qui met des joueurs sur un plan.
 *
 * - Sur le plateau de son appareil, le personnage « à moi » se glisse au doigt, se place d'un
 *   tap sur un endroit libre, ou se déplace aux flèches du clavier.
 * - Les autres personnages glissent doucement vers la place que le serveur annonce.
 * - Un personnage plus bas sur le plateau est plus proche, donc un peu plus grand et devant.
 * Les positions sont des fractions (0 à 1) : le plateau garde son format, quelle que soit la taille d'écran.
 */

/** Pas du clavier, en fraction de la zone. */
export const PLATEAU_KEY_STEP = 0.04;
/** Intervalle minimal entre deux envois pendant un glissement (le serveur accepte 30 par seconde). */
const SEND_EVERY_MS = 120;
/** Au-delà de ce délai, une position locale non confirmée par le serveur est abandonnée. */
const LOCAL_TIMEOUT_MS = 1500;
/** Un tap plus court que ce déplacement (en pixels) est un tap, pas un défilement. */
const TAP_SLOP_PX = 10;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface PlateauFigure {
  id: string;
  name: string;
  position: LobbyPosition;
  /** Personnage dessiné ou importé. Absent : `avatar` est affiché à la place. */
  character?: CharacterSpec | null;
  avatar?: ReactNode;
  /** Attitude du personnage (pose). */
  mood?: CharacterMood;
  /** Bulle au-dessus de la tête. La clé relance son apparition quand une même émotion revient. */
  bubble?: { emoji: string; key: string } | null;
  /** Le personnage de cet appareil : il est déplaçable. */
  mine?: boolean;
  away?: boolean;
  tags?: string[];
}

export interface PlateauProps {
  figures: PlateauFigure[];
  /** Déplacement de son propre personnage. Absent : le plateau est seulement affiché. */
  onMove?: (position: LobbyPosition) => void;
  /** Nom du plateau pour les lecteurs d'écran. */
  label: string;
  emptyText?: string;
  className?: string;
}

export function Plateau({ figures, onMove, label, emptyText, className }: PlateauProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastSent = useRef(0);
  const tapStart = useRef<{ x: number; y: number } | null>(null);
  // Position locale de son propre personnage, pendant et juste après un déplacement.
  const [mine, setMine] = useState<LobbyPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const own = figures.find((f) => f.mine);
  const ownX = own?.position.x;
  const ownY = own?.position.y;

  // Le serveur a rattrapé la position envoyée : la place locale n'est plus utile.
  useEffect(() => {
    if (dragging.current || !mine || ownX === undefined || ownY === undefined) return;
    if (Math.abs(ownX - mine.x) < 0.004 && Math.abs(ownY - mine.y) < 0.004) setMine(null);
  }, [ownX, ownY, mine]);

  // Sans confirmation du serveur (refus, débit), la place locale revient à celle du serveur.
  useEffect(() => {
    if (!mine || isDragging) return;
    const timer = window.setTimeout(() => setMine(null), LOCAL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [mine, isDragging]);

  function toBoard(clientX: number, clientY: number): LobbyPosition | null {
    const box = boardRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return clampLobbyPosition({ x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height });
  }

  function commit(p: LobbyPosition, force = false) {
    setMine(p);
    if (!onMove) return;
    const now = performance.now();
    if (!force && now - lastSent.current < SEND_EVERY_MS) return;
    lastSent.current = now;
    onMove(p);
  }

  // Fond du plateau : un tap envoie le personnage à cet endroit (un défilement, non).
  function onBoardDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button > 0) return;
    tapStart.current = { x: e.clientX, y: e.clientY };
  }

  function onBoardUp(e: PointerEvent<HTMLDivElement>) {
    const start = tapStart.current;
    tapStart.current = null;
    if (!start || dragging.current) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return;
    const p = toBoard(e.clientX, e.clientY);
    if (p) commit(p, true);
  }

  function onFigureDown(e: PointerEvent<HTMLLIElement>) {
    if (!onMove || e.button > 0) return;
    const p = toBoard(e.clientX, e.clientY);
    if (!p) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setIsDragging(true);
    commit(p, true);
  }

  function onFigureMove(e: PointerEvent<HTMLLIElement>) {
    if (!dragging.current) return;
    const p = toBoard(e.clientX, e.clientY);
    if (p) commit(p);
  }

  function onFigureUp(e: PointerEvent<HTMLLIElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    const p = toBoard(e.clientX, e.clientY);
    if (p) commit(p, true);
  }

  function onFigureKey(e: KeyboardEvent<HTMLLIElement>, base: LobbyPosition) {
    const delta = ARROWS[e.key];
    if (!onMove || !delta) return;
    e.preventDefault();
    commit(clampLobbyPosition({ x: base.x + delta[0] * PLATEAU_KEY_STEP, y: base.y + delta[1] * PLATEAU_KEY_STEP }));
  }

  function onFigureKeyUp(e: KeyboardEvent<HTMLLIElement>) {
    // Le dernier pas d'une série de flèches est toujours envoyé, même si le débit l'a retenu.
    if (!onMove || !ARROWS[e.key] || !mine) return;
    onMove(mine);
  }

  return (
    <div
      className={`plateau${className ? ` ${className}` : ''}`}
      ref={boardRef}
      role="group"
      aria-label={label}
      onPointerDown={onMove ? onBoardDown : undefined}
      onPointerUp={onMove ? onBoardUp : undefined}
      onPointerCancel={
        onMove
          ? () => {
              tapStart.current = null;
            }
          : undefined
      }
    >
      <PrairieScene />
      <ol className="plateau-figures">
        {figures.map((f) => {
          const interactive = !!onMove && !!f.mine;
          const at = interactive && mine ? mine : f.position;
          return (
            <FigureView
              key={f.id}
              figure={f}
              at={at}
              interactive={interactive}
              dragging={interactive && isDragging}
              onDown={interactive ? onFigureDown : undefined}
              onMove={interactive ? onFigureMove : undefined}
              onUp={interactive ? onFigureUp : undefined}
              onKey={interactive ? (e) => onFigureKey(e, mine ?? f.position) : undefined}
              onKeyUp={interactive ? onFigureKeyUp : undefined}
            />
          );
        })}
      </ol>
      {figures.length === 0 && emptyText && <p className="plateau-empty">{emptyText}</p>}
    </div>
  );
}

interface FigureViewProps {
  figure: PlateauFigure;
  at: LobbyPosition;
  interactive: boolean;
  dragging: boolean;
  onDown?: (e: PointerEvent<HTMLLIElement>) => void;
  onMove?: (e: PointerEvent<HTMLLIElement>) => void;
  onUp?: (e: PointerEvent<HTMLLIElement>) => void;
  onKey?: (e: KeyboardEvent<HTMLLIElement>) => void;
  onKeyUp?: (e: KeyboardEvent<HTMLLIElement>) => void;
}

/**
 * Un personnage sur le plateau. Son orientation suit son dernier déplacement, et chaque pas
 * fait un petit rebond (animation ponctuelle, désactivée si le système réduit les animations).
 */
function FigureView({ figure, at, interactive, dragging, onDown, onMove, onUp, onKey, onKeyUp }: FigureViewProps) {
  const bob = useRef<HTMLDivElement>(null);
  // État dérivé des déplacements : orientation et numéro du pas, mis à jour quand la place change.
  const [seen, setSeen] = useState({ x: at.x, y: at.y, facing: 1 as 1 | -1, step: 0 });
  let facing = seen.facing;
  let step = seen.step;
  if (at.x !== seen.x || at.y !== seen.y) {
    const dx = at.x - seen.x;
    if (Math.abs(dx) > 0.002) facing = dx < 0 ? -1 : 1;
    step = seen.step + 1;
    setSeen({ x: at.x, y: at.y, facing, step });
  }

  useEffect(() => {
    const el = bob.current;
    if (!el || step === 0) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const anim = el.animate(
      [
        { transform: 'translateY(0) rotate(0deg)' },
        { transform: 'translateY(-7%) rotate(-3deg)', offset: 0.45 },
        { transform: 'translateY(0) rotate(0deg)' },
      ],
      { duration: 460, easing: 'ease-in-out' },
    );
    return () => anim.cancel();
  }, [step]);

  const classes = ['plateau-figure'];
  if (interactive) classes.push('is-own');
  if (dragging) classes.push('is-dragging');
  if (figure.away) classes.push('is-away');
  const bubble = figure.bubble;

  return (
    <li
      className={classes.join(' ')}
      style={{
        left: `${at.x * 100}%`,
        top: `${at.y * 100}%`,
        // Plus bas sur le plateau, plus proche : le personnage est un peu plus grand et passe devant.
        zIndex: Math.round(at.y * 1000) + (interactive ? 1 : 0),
        ['--scale' as string]: 0.8 + 0.4 * at.y,
      }}
      tabIndex={interactive ? 0 : undefined}
      // Un élément de liste ne peut pas être un bouton : le rôle se décrit autrement.
      aria-roledescription={interactive ? 'personnage déplaçable' : undefined}
      aria-label={
        interactive ? `${figure.name} (vous) : glissez-le, touchez le plateau ou utilisez les flèches` : figure.name
      }
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
      onKeyUp={onKeyUp}
    >
      {bubble && (
        <span key={bubble.key} className="plateau-bubble" aria-hidden="true">
          {bubble.emoji}
        </span>
      )}
      <div className="plateau-face" style={{ transform: `scaleX(${facing})` }}>
        <div className="plateau-bob" ref={bob}>
          {figure.character ? (
            <Character spec={figure.character} mood={figure.mood ?? 'idle'} framing="full" />
          ) : (
            figure.avatar
          )}
        </div>
      </div>
      <span className="plateau-label">
        <span className="plateau-name">{figure.name}</span>
        {figure.tags?.map((t) => (
          <span key={t} className="plateau-tag">
            {t}
          </span>
        ))}
      </span>
    </li>
  );
}

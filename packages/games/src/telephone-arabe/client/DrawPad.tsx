import { useRef, useState, type PointerEvent } from 'react';
import { DRAWING_MAX_POINTS, DRAWING_MAX_POINTS_PER_STROKE, DRAWING_MAX_STROKES, DRAWING_SIZE } from '../info.js';
import type { Point, Stroke } from '../module.js';
import { Drawing } from './Drawing.js';

interface DrawPadProps {
  disabled: boolean;
  onSubmit: (strokes: Stroke[]) => void;
}

const countPoints = (strokes: Stroke[]) => strokes.reduce((n, stroke) => n + stroke.length, 0);
const clamp = (v: number) => Math.min(DRAWING_SIZE, Math.max(0, Math.round(v)));

/** Position du doigt sur la grille du dessin ; null tant que la feuille n’a pas de taille à l’écran. */
function gridPoint(surface: HTMLElement, clientX: number, clientY: number): Point | null {
  const rect = surface.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return [
    clamp(((clientX - rect.left) / rect.width) * DRAWING_SIZE),
    clamp(((clientY - rect.top) / rect.height) * DRAWING_SIZE),
  ];
}

/** Ajoute un point au trait en cours, sans doublon et sous les limites que le serveur accepte. */
function appendPoint(strokes: Stroke[], p: Point): Stroke[] {
  const last = strokes[strokes.length - 1];
  if (!last || last.length >= DRAWING_MAX_POINTS_PER_STROKE || countPoints(strokes) >= DRAWING_MAX_POINTS) {
    return strokes;
  }
  const previous = last[last.length - 1]!;
  if (previous[0] === p[0] && previous[1] === p[1]) return strokes;
  return [...strokes.slice(0, -1), [...last, p]];
}

/** Feuille de dessin au doigt : des traits, annulables, sans couleur ni outil. */
export function DrawPad({ disabled, onSubmit }: DrawPadProps) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // Vrai entre l’appui et le relâchement du doigt : seuls les mouvements pendant l’appui tracent.
  const drawing = useRef(false);
  const empty = strokes.length === 0;

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const p = gridPoint(e.currentTarget, e.clientX, e.clientY);
    if (!p || strokes.length >= DRAWING_MAX_STROKES || countPoints(strokes) >= DRAWING_MAX_POINTS) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    setStrokes((prev) => [...prev, [p]]);
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (!drawing.current) return;
    const p = gridPoint(e.currentTarget, e.clientX, e.clientY);
    if (p) setStrokes((prev) => appendPoint(prev, p));
  }

  function onUp() {
    drawing.current = false;
  }

  return (
    <div className="draw-pad">
      <div
        className="draw-surface"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
      >
        <Drawing strokes={strokes} label="Votre dessin" />
      </div>
      <div className="draw-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={disabled || empty}
          onClick={() => setStrokes((prev) => prev.slice(0, -1))}
        >
          Annuler le dernier trait
        </button>
        <button type="button" className="btn ghost" disabled={disabled || empty} onClick={() => setStrokes([])}>
          Tout effacer
        </button>
      </div>
      <button type="button" className="btn primary big" disabled={disabled || empty} onClick={() => onSubmit(strokes)}>
        Envoyer le dessin
      </button>
    </div>
  );
}

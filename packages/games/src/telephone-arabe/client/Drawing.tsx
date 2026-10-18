import type { Stroke } from '../module.js';
import { DRAWING_SIZE } from '../info.js';

/** Dessin en lecture seule : les traits, sur une feuille claire, sans rien de plus. */
export function Drawing({ strokes, label = 'Dessin' }: { strokes: Stroke[] | null; label?: string }) {
  return (
    <svg className="drawing" viewBox={`0 0 ${DRAWING_SIZE} ${DRAWING_SIZE}`} role="img" aria-label={label}>
      <rect width={DRAWING_SIZE} height={DRAWING_SIZE} className="drawing-paper" />
      {(strokes ?? []).map((stroke, i) =>
        stroke.length === 1 ? (
          <circle key={i} cx={stroke[0]![0]} cy={stroke[0]![1]} r={11} className="drawing-ink" />
        ) : (
          <polyline
            key={i}
            points={stroke.map(([x, y]) => `${x},${y}`).join(' ')}
            className="drawing-ink"
            fill="none"
          />
        ),
      )}
    </svg>
  );
}

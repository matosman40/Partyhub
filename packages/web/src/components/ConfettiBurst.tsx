import type { CSSProperties } from 'react';

const COLORS = ['var(--ink-rose)', 'var(--ink-ultramarine)', 'var(--ink-yellow)', 'var(--ink-paper)'] as const;
const PARTICLES = Array.from({ length: 32 }, (_, index) => {
  const angle = (index / 32) * Math.PI * 2;
  const distance = 90 + (index % 4) * 18;
  return {
    x: Math.round(Math.cos(angle) * distance),
    y: Math.round(Math.sin(angle) * distance - 28),
    turn: (index % 2 === 0 ? 1 : -1) * (150 + (index % 5) * 42),
    color: COLORS[index % COLORS.length] ?? COLORS[0],
    delay: `${(index % 6) * 18}ms`,
  };
});

/** Éclat de confettis léger, relancé en changeant la valeur de `trigger`. */
export function ConfettiBurst({ trigger }: { trigger: boolean | number }) {
  const active = typeof trigger === 'number' ? trigger > 0 : trigger;
  if (!active) return null;

  return (
    <span key={String(trigger)} className="confetti-burst" aria-hidden="true">
      {PARTICLES.map((piece, index) => (
        <span
          key={index}
          className="confetti-burst__piece"
          style={
            {
              '--confetti-x': `${piece.x}px`,
              '--confetti-y': `${piece.y}px`,
              '--confetti-turn': `${piece.turn}deg`,
              '--confetti-color': piece.color,
              '--confetti-delay': piece.delay,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

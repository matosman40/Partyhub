import { useContext, type CSSProperties } from 'react';
import { defaultCharacterFor, type CharacterMood } from '@partyhub/shared';
import { AvatarsContext } from '../../client/avatar-context.js';
import { Character } from '../../client/character.js';

/**
 * Scène de la banquise, commune à l'écran principal et au téléphone. Tout est en DOM et en CSS.
 *
 * Vue en plongée, légèrement de face : la banquise est une surface vue d'en haut, avec sa face
 * avant (la falaise) et ses trous d'eau. Les personnages restent debout, dressés sur la glace,
 * et leur ombre au sol dit leur hauteur quand ils sautent. Une colonne de glace vaut `--u`
 * (1/21 de la scène) ; la profondeur de la surface est `--fh`. Le jeu ne bouge qu'en largeur :
 * la profondeur n'est qu'un effet visuel, à la même hauteur pour tous.
 */

export interface BanquiseBodyView {
  playerId: string;
  name: string;
  color: number;
  x: number | null;
  y: number;
  alive: boolean;
  grounded: boolean;
  facing: -1 | 1;
  pushing: boolean;
  pushed: boolean;
  won: boolean;
}

export interface BanquiseView {
  phase: string;
  level: number;
  levelCount: number;
  levelName: string;
  levelHint: string;
  width: number;
  ice: string;
  bodies: BanquiseBodyView[];
  wind: { phase: 'calm' | 'warning' | 'gust'; dir: -1 | 1; strength: number; until: number } | null;
  erodeAt: number | null;
  winners: Array<{ playerId: string; name: string }>;
  winnerName: string | null;
  fallen: Array<{ playerId: string; name: string }>;
  now: number;
  endsAt: number;
  durationMs: number;
  ranking: Array<{ playerId: string; name: string; points: number; rank: number }>;
  history: Array<{ level: number; levelName: string; winnerNames: string[] }>;
}

/** Flocons décoratifs, placés de façon fixe (pas de hasard au rendu). */
const FLAKES = Array.from({ length: 22 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  animationDelay: `${((i * 0.53) % 5).toFixed(2)}s`,
  animationDuration: `${(6 + ((i * 7) % 5)).toFixed(1)}s`,
  width: `${2 + (i % 3)}px`,
  height: `${2 + (i % 3)}px`,
}));

/** Étoiles de la nuit polaire, en haut de la scène. */
const STARS = Array.from({ length: 16 }, (_, i) => {
  const size = `${(1 + (i % 3) * 0.7).toFixed(1)}px`;
  return {
    left: `${(i * 61) % 97}%`,
    top: `${(i * 23) % 44}%`,
    width: size,
    height: size,
    animationDelay: `${((i * 0.37) % 3).toFixed(2)}s`,
  };
});

/** Icebergs à l'horizon : position et taille en colonnes (`--w`, `--h`). */
const BERGS = [
  { left: '6%', w: '4.2', h: '1.6' },
  { left: '24%', w: '2.6', h: '0.9' },
  { left: '71%', w: '5.4', h: '2.1' },
  { left: '88%', w: '3.1', h: '1.1' },
];

/** Traînées du vent, dans le ciel. */
const STREAKS = [
  { top: '18%', animationDelay: '0s' },
  { top: '34%', animationDelay: '0.35s' },
  { top: '50%', animationDelay: '0.7s' },
  { top: '26%', animationDelay: '0.5s' },
  { top: '42%', animationDelay: '0.2s' },
];

/**
 * Détails d'une colonne de glace : fissure et sa hauteur sur la surface, bord avant un peu
 * plus bas ou plus haut. Valeurs déterministes, pour que la scène ne change pas d'une image à l'autre.
 */
function floeShape(col: number) {
  return {
    near: (((col * 37) % 11) / 11) * 0.12,
    rot: ((col * 29) % 41) - 20,
    crack: 14 + ((col * 17) % 60),
    at: 0.2 + (((col * 13) % 7) / 7) * 0.7,
  };
}

function moodOf(b: BanquiseBodyView, phase: string): CharacterMood {
  if (b.won && (phase === 'level-over' || phase === 'final')) return 'dance';
  if (b.pushed) return 'sad';
  if (b.pushing) return 'wave';
  if (!b.grounded) return 'joy';
  return 'idle';
}

function windText(wind: NonNullable<BanquiseView['wind']>): string {
  const side = wind.dir > 0 ? 'vers la droite' : 'vers la gauche';
  if (wind.phase === 'warning') return `Rafale ${side} dans un instant`;
  return `Vent ${side}`;
}

/** Variable CSS personnalisée, typée pour React. */
const cssVar = (name: string, value: string | number): CSSProperties => ({ [name]: value }) as CSSProperties;

export function BanquiseStage({ view, youId, label }: { view: BanquiseView; youId?: string; label: string }) {
  const avatars = useContext(AvatarsContext);
  const wind = view.wind && view.wind.phase !== 'calm' ? view.wind : null;
  const cls = ['ban-stage', `is-${view.phase}`, wind ? `wind-${wind.phase}` : ''].filter(Boolean).join(' ');

  return (
    <div className={cls} role="img" aria-label={label}>
      <div className="ban-sky" aria-hidden="true">
        <span className="ban-aurora" />
        {STARS.map((s, i) => (
          <span key={i} className="ban-star" style={s} />
        ))}
      </div>
      <div className="ban-bergs" aria-hidden="true">
        {BERGS.map((b, i) => (
          <span key={i} className="ban-berg" style={{ left: b.left, ...cssVar('--w', b.w), ...cssVar('--h', b.h) }} />
        ))}
      </div>
      <div className="ban-sea" aria-hidden="true" />

      <div className="ban-floe" aria-hidden="true" />
      {view.ice.split('').map((cell, col) => {
        const shape = floeShape(col);
        if (cell !== 'i') {
          return (
            <span
              key={`hole-${col}`}
              className="ban-hole"
              aria-hidden="true"
              style={{ left: `calc(${col} * var(--u))` }}
            />
          );
        }
        return (
          <span key={`ice-${col}`} aria-hidden="true">
            <span className="ban-cliff" style={{ left: `calc(${col} * var(--u))`, ...cssVar('--near', shape.near) }} />
            <span
              className="ban-crack"
              style={{
                left: `calc((${col} + ${shape.crack / 100}) * var(--u))`,
                bottom: `calc(var(--fb) + var(--fh) * ${shape.at.toFixed(2)})`,
                ...cssVar('--rot', `${shape.rot}deg`),
              }}
            />
          </span>
        );
      })}

      {view.bodies.map((b) => {
        if (b.x === null || !b.alive) return null;
        const shadowLift = Math.max(0, b.y);
        return (
          <span
            key={`shadow-${b.playerId}`}
            className="ban-shadow"
            aria-hidden="true"
            style={{ left: `calc(${b.x} * var(--u))`, ...cssVar('--lift', shadowLift.toFixed(2)) }}
          />
        );
      })}

      {view.bodies.map((b) => {
        if (b.x === null) return null;
        if (!b.alive) {
          return (
            <span
              key={`splash-${b.playerId}`}
              className="ban-splash"
              aria-hidden="true"
              style={{ left: `calc(${b.x} * var(--u))` }}
            />
          );
        }
        const known = avatars[b.name];
        const spec = known?.character ?? defaultCharacterFor(b.name);
        const isYou = b.playerId === youId;
        return (
          <div
            key={b.playerId}
            className={`ban-actor${isYou ? ' is-you' : ''}${!b.grounded ? ' is-airborne' : ''}${b.y < -0.05 ? ' is-falling' : ''}`}
            style={{
              left: `calc(${b.x} * var(--u))`,
              bottom: `calc(var(--feet) + ${b.y.toFixed(3)} * var(--u))`,
            }}
          >
            <span className="ban-name">{isYou ? 'Vous' : b.name}</span>
            <span className="ban-body">
              <Character spec={spec} mood={moodOf(b, view.phase)} framing="full" />
            </span>
          </div>
        );
      })}

      <div className="ban-fx" aria-hidden="true">
        {FLAKES.map((f, i) => (
          <span key={i} className="ban-flake" style={f} />
        ))}
        {wind?.phase === 'gust' && (
          <div className="ban-streaks" style={cssVar('--dir', wind.dir)}>
            {STREAKS.map((s, i) => (
              <span key={i} className="ban-streak" style={s} />
            ))}
          </div>
        )}
      </div>

      {view.wind && view.wind.phase !== 'calm' && (
        <div className={`ban-wind is-${view.wind.phase}`} aria-live="polite">
          <span aria-hidden="true">{view.wind.dir > 0 ? '→' : '←'}</span> {windText(view.wind)}
        </div>
      )}
    </div>
  );
}

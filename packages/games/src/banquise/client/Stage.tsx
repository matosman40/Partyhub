import { useContext } from 'react';
import { defaultCharacterFor, type CharacterMood } from '@partyhub/shared';
import { AvatarsContext } from '../../client/avatar-context.js';
import { Character } from '../../client/character.js';

/**
 * Scène de la banquise, commune à l'écran principal et au téléphone. Tout est en DOM et en CSS :
 * une colonne de glace vaut `--u` (un centième de la largeur, 1/21 de la scène). Les personnages
 * prennent leur personnage du profil, avec son look s'il est illustré.
 */

/** Hauteur de la surface de la glace, en colonnes, depuis le bas de la scène. */
export const ICE_TOP = 3.2;

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
const FLAKES = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  animationDelay: `${((i * 0.53) % 5).toFixed(2)}s`,
  animationDuration: `${(5 + ((i * 7) % 4)).toFixed(1)}s`,
  width: `${2 + (i % 3)}px`,
  height: `${2 + (i % 3)}px`,
}));

const STREAKS = [
  { top: '18%', animationDelay: '0s' },
  { top: '34%', animationDelay: '0.35s' },
  { top: '50%', animationDelay: '0.7s' },
  { top: '26%', animationDelay: '0.5s' },
  { top: '42%', animationDelay: '0.2s' },
];

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

export function BanquiseStage({ view, youId, label }: { view: BanquiseView; youId?: string; label: string }) {
  const avatars = useContext(AvatarsContext);
  const wind = view.wind && view.wind.phase !== 'calm' ? view.wind : null;
  const cls = ['ban-stage', `is-${view.phase}`, wind ? `wind-${wind.phase}` : ''].filter(Boolean).join(' ');

  return (
    <div className={cls} role="img" aria-label={label}>
      <div className="ban-sky" aria-hidden="true">
        {FLAKES.map((f, i) => (
          <span key={i} className="ban-flake" style={f} />
        ))}
        {wind?.phase === 'gust' && (
          <div className="ban-streaks" style={{ ['--dir' as string]: wind.dir }}>
            {STREAKS.map((s, i) => (
              <span key={i} className="ban-streak" style={s} />
            ))}
          </div>
        )}
      </div>
      <div className="ban-water" aria-hidden="true" />

      {view.ice.split('').map((cell, col) =>
        cell === 'i' ? (
          <span
            key={`ice-${col}`}
            className="ban-ice"
            aria-hidden="true"
            style={{
              left: `calc(${col} * var(--u))`,
              height: `calc(${1 + ((col * 7) % 5) * 0.05} * var(--u))`,
            }}
          />
        ) : null,
      )}

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
              bottom: `calc(${ICE_TOP + b.y} * var(--u))`,
            }}
          >
            <span className="ban-name">{isYou ? 'Vous' : b.name}</span>
            <span className="ban-body">
              <Character spec={spec} mood={moodOf(b, view.phase)} framing="full" />
            </span>
          </div>
        );
      })}

      {view.wind && view.wind.phase !== 'calm' && (
        <div className={`ban-wind is-${view.wind.phase}`} aria-live="polite">
          <span aria-hidden="true">{view.wind.dir > 0 ? '→' : '←'}</span> {windText(view.wind)}
        </div>
      )}
    </div>
  );
}

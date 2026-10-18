import { useContext, useId } from 'react';
import { defaultCharacterFor, type CharacterMood, type CharacterSpec } from '@partyhub/shared';
import { AvatarsContext } from '../../client/avatar-context.js';
import { Character } from '../../client/character.js';
import type { Side } from '../rules.js';
import { SIDE_COLORS } from './types.js';

interface AthleteProps {
  side: Side;
  name: string;
  mood: CharacterMood;
  /** Le joueur défend encore son côté : sa raquette est visible et le suit. */
  active: boolean;
  /** Joueur éliminé : personnage grisé, sans raquette. */
  out: boolean;
  rootRef: (el: HTMLDivElement | null) => void;
  racketRef: (el: HTMLSpanElement | null) => void;
}

/**
 * Un joueur sur le terrain : son personnage (celui de son avatar, sinon celui que son pseudo donne), son nom et sa
 * raquette. La position, l’échelle et l’angle de la raquette sont posés à chaque image par l’écran principal.
 */
export function Athlete({ side, name, mood, active, out, rootRef, racketRef }: AthleteProps) {
  const known = useContext(AvatarsContext)[name];
  const spec: CharacterSpec = known?.character ?? defaultCharacterFor(name);
  const color = SIDE_COLORS[side];
  return (
    <div ref={rootRef} className={`tennis-athlete${out ? ' is-out' : ''}`}>
      <span className="tennis-tag" style={{ borderColor: color }}>
        {name}
      </span>
      <Character spec={spec} mood={mood} framing="full" label={name} />
      <span ref={racketRef} className={`tennis-bat${active ? '' : ' is-hidden'}`} style={{ color }}>
        <Racket />
      </span>
    </div>
  );
}

/** Raquette vue de face, tête vers le haut ; le manche est en bas, là où la main la tient. */
export function Racket() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox="0 0 40 100" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`r${id}`}>
          <ellipse cx="20" cy="30" rx="15.5" ry="25.5" />
        </clipPath>
      </defs>
      <ellipse cx="20" cy="30" rx="16.5" ry="26.5" fill="rgba(255,255,255,0.22)" stroke="#1a1030" strokeWidth="6" />
      <g clipPath={`url(#r${id})`} stroke="#ffffff" strokeWidth="1.4" opacity="0.7">
        {[8, 14, 20, 26, 32].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="60" />
        ))}
        {[12, 20, 28, 36, 44].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="40" y2={y} />
        ))}
      </g>
      <ellipse cx="20" cy="30" rx="16.5" ry="26.5" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M17 56 L18 64 L22 64 L23 56 Z" fill="#1a1030" />
      <rect x="16.5" y="63" width="7" height="34" rx="3.5" fill="currentColor" stroke="#1a1030" strokeWidth="3" />
      <rect x="15" y="88" width="10" height="9" rx="3" fill="#1a1030" />
    </svg>
  );
}

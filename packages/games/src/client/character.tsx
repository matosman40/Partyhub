import { useId } from 'react';
import {
  CHARACTER_EXPRESSIONS,
  characterColors,
  resolveLook,
  type CharacterExpression,
  type CharacterMood,
  type CharacterSpec,
} from '@partyhub/shared';
import { usePackInfo } from './character-packs.js';
import { PackFigure } from './character-pack-figure.js';

/**
 * Personnage dessiné en SVG, d’après le rig validé : un corps articulé (bras, jambes, tête)
 * dont la pose change avec l’humeur. Le trait noir est un trait plus épais posé sous la couleur.
 * Aucune donnée libre n’arrive ici : tout passe par les index validés de `CharacterSpec`.
 */

const INK = '#1a1030';
const SHOE = '#1a1030';
const CX = 110;

type Pair = readonly [number, number];

interface Pose {
  /** Angles (degrés) du bras gauche / droit : épaule puis avant-bras, depuis la verticale. */
  L: Pair;
  R: Pair;
  /** Angles des jambes gauche / droite : cuisse puis mollet. */
  LL: Pair;
  RL: Pair;
  tilt: number;
  bounce: number;
  eyes: 'open' | 'happy' | 'sad' | 'wink';
  brow: 'happy' | 'sad' | 'neutral';
  mouth: 'shout' | 'frown' | 'grin' | 'smile';
  look: Pair;
  wave?: boolean;
  sparkles?: boolean;
}

/** Visage de chaque expression du profil (au repos). « calme » reprend le visage de l’attitude de repos. */
const EXPRESSION_FACE: Record<CharacterExpression, Pick<Pose, 'eyes' | 'brow' | 'mouth'>> = {
  calme: { eyes: 'open', brow: 'neutral', mouth: 'smile' },
  souriant: { eyes: 'open', brow: 'happy', mouth: 'grin' },
  rieur: { eyes: 'happy', brow: 'happy', mouth: 'shout' },
  clin: { eyes: 'wink', brow: 'happy', mouth: 'grin' },
  triste: { eyes: 'sad', brow: 'sad', mouth: 'frown' },
  etonne: { eyes: 'open', brow: 'neutral', mouth: 'shout' },
};

/**
 * Visage à montrer : celui qui est demandé (émotion du salon), sinon l’expression du profil.
 * L’expression du profil ne se voit qu’au repos : une attitude (joie, danse…) garde son visage.
 */
export function faceOf(
  spec: CharacterSpec,
  mood: CharacterMood,
  face?: CharacterExpression,
): CharacterExpression | undefined {
  if (face) return face;
  if (mood !== 'idle' || spec.expression === undefined) return undefined;
  return CHARACTER_EXPRESSIONS[spec.expression];
}

/** Une humeur par moment de jeu : idle au repos, joy, sad, wave (main levée), dance. */
const POSES: Record<CharacterMood, Pose> = {
  idle: {
    L: [-22, -10],
    R: [22, 10],
    LL: [-4, -2],
    RL: [4, 2],
    tilt: 0,
    bounce: 0,
    eyes: 'open',
    brow: 'neutral',
    mouth: 'smile',
    look: [0, 0],
  },
  joy: {
    L: [-155, -170],
    R: [155, 170],
    LL: [-14, -6],
    RL: [14, 6],
    tilt: -6,
    bounce: -10,
    eyes: 'happy',
    brow: 'happy',
    mouth: 'shout',
    look: [0, -4],
    sparkles: true,
  },
  sad: {
    L: [-18, -8],
    R: [18, 8],
    LL: [-4, -2],
    RL: [4, 2],
    tilt: 14,
    bounce: 6,
    eyes: 'sad',
    brow: 'sad',
    mouth: 'frown',
    look: [0, 4],
  },
  wave: {
    L: [-22, -12],
    R: [128, 168],
    LL: [-6, -4],
    RL: [6, 4],
    tilt: -4,
    bounce: 0,
    eyes: 'open',
    brow: 'happy',
    mouth: 'grin',
    look: [2, -2],
    wave: true,
  },
  dance: {
    L: [-70, -125],
    R: [40, 12],
    LL: [-22, -6],
    RL: [26, 4],
    tilt: 8,
    bounce: -4,
    eyes: 'wink',
    brow: 'happy',
    mouth: 'grin',
    look: [0, -2],
  },
};

const rad = (deg: number) => (deg * Math.PI) / 180;
const f = (n: number) => n.toFixed(1);

/** Deux segments articulés : renvoie le tracé et la position de l’extrémité. */
function limb(x0: number, y0: number, a1: number, l1: number, a2: number, l2: number) {
  const x1 = x0 + l1 * Math.sin(rad(a1));
  const y1 = y0 + l1 * Math.cos(rad(a1));
  const x2 = x1 + l2 * Math.sin(rad(a2));
  const y2 = y1 + l2 * Math.cos(rad(a2));
  return { d: `M${f(x0)} ${f(y0)} L${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`, end: [x2, y2] as const };
}

/** Membre dessiné : trait noir épais dessous, couleur par-dessus. */
function Limb({ d, color, width }: { d: string; color: string; width: number }) {
  return (
    <>
      <path d={d} stroke={INK} strokeWidth={width + 8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function Eye({ x, y, kind, look }: { x: number; y: number; kind: 'open' | 'happy' | 'sad' | 'wink'; look: Pair }) {
  if (kind === 'open') {
    return (
      <>
        <circle cx={x} cy={y} r={15} fill="#fff" stroke={INK} strokeWidth={3.5} />
        <circle cx={x + look[0]} cy={y + look[1]} r={8} fill={INK} />
        <circle cx={x + look[0] + 3} cy={y + look[1] - 3} r={3} fill="#fff" />
      </>
    );
  }
  if (kind === 'happy') {
    return (
      <path
        d={`M${x - 14} ${y + 4} Q${x} ${y - 14} ${x + 14} ${y + 4}`}
        stroke={INK}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  if (kind === 'wink') {
    return (
      <path
        d={`M${x - 14} ${y} Q${x} ${y - 12} ${x + 14} ${y}`}
        stroke={INK}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  return (
    <>
      <circle cx={x} cy={y} r={13} fill="#fff" stroke={INK} strokeWidth={3.5} />
      <circle cx={x} cy={y + 3} r={7} fill={INK} />
    </>
  );
}

/** Paupière (triste) : posée sur le haut de l'œil, de la couleur de la peau. */
function Lid({ x, y, skin }: { x: number; y: number; skin: string }) {
  return (
    <path
      d={`M${x - 16} ${y - 6} Q${x} ${y - 20} ${x + 16} ${y - 6} L${x + 16} ${y - 14} L${x - 16} ${y - 14}Z`}
      fill={skin}
      stroke={INK}
      strokeWidth={3}
      strokeLinejoin="round"
    />
  );
}

function Mouth({ cx, cy, kind }: { cx: number; cy: number; kind: Pose['mouth'] }) {
  if (kind === 'grin') {
    return (
      <>
        <path
          d={`M${cx - 26} ${cy - 4} Q${cx} ${cy + 30} ${cx + 26} ${cy - 4} Z`}
          fill={INK}
          stroke={INK}
          strokeWidth={4}
          strokeLinejoin="round"
        />
        <path d={`M${cx - 18} ${cy} L${cx + 18} ${cy} L${cx + 15} ${cy + 8} L${cx - 15} ${cy + 8}Z`} fill="#fff" />
      </>
    );
  }
  if (kind === 'shout') {
    return (
      <>
        <ellipse cx={cx} cy={cy + 8} rx={15} ry={18} fill={INK} />
        <ellipse cx={cx} cy={cy + 18} rx={8} ry={6} fill="#ff7a8f" />
      </>
    );
  }
  if (kind === 'smile') {
    return (
      <path
        d={`M${cx - 20} ${cy} Q${cx} ${cy + 18} ${cx + 20} ${cy}`}
        stroke={INK}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  return (
    <path
      d={`M${cx - 18} ${cy + 12} Q${cx} ${cy - 6} ${cx + 18} ${cy + 12}`}
      stroke={INK}
      strokeWidth={5}
      fill="none"
      strokeLinecap="round"
    />
  );
}

function Brows({ left, right, y, kind }: { left: number; right: number; y: number; kind: Pose['brow'] }) {
  const stroke = { stroke: INK, strokeWidth: 5, fill: 'none', strokeLinecap: 'round' as const };
  if (kind === 'happy') {
    return (
      <>
        <path d={`M${left - 14} ${y + 2} Q${left} ${y - 12} ${left + 14} ${y - 2}`} {...stroke} />
        <path d={`M${right - 14} ${y - 2} Q${right} ${y - 12} ${right + 14} ${y + 2}`} {...stroke} />
      </>
    );
  }
  if (kind === 'sad') {
    return (
      <>
        <path d={`M${left - 14} ${y - 6} L${left + 12} ${y + 4}`} stroke={INK} strokeWidth={5} strokeLinecap="round" />
        <path
          d={`M${right + 14} ${y - 6} L${right - 12} ${y + 4}`}
          stroke={INK}
          strokeWidth={5}
          strokeLinecap="round"
        />
      </>
    );
  }
  return (
    <>
      <path d={`M${left - 14} ${y} L${left + 14} ${y - 3}`} stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <path d={`M${right - 14} ${y - 3} L${right + 14} ${y}`} stroke={INK} strokeWidth={5} strokeLinecap="round" />
    </>
  );
}

/** Cheveux : dessinés au-dessus de la tête (ou derrière, pour les boucles). */
function Hair({ style, color, hy }: { style: string; color: string; hy: number }) {
  const common = { fill: color, stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const };
  const cap = `M${CX - 50} ${hy - 2} Q${CX - 52} ${hy - 56} ${CX} ${hy - 54} Q${CX + 52} ${hy - 56} ${CX + 50} ${hy - 2} Q${CX + 30} ${hy - 26} ${CX} ${hy - 30} Q${CX - 30} ${hy - 26} ${CX - 50} ${hy - 2}Z`;
  switch (style) {
    case 'short':
      return <path d={cap} {...common} />;
    case 'bob':
      return (
        <>
          <path
            d={`M${CX - 50} ${hy - 4} L${CX - 58} ${hy + 34} L${CX - 36} ${hy + 34} Q${CX - 44} ${hy + 10} ${CX - 44} ${hy - 4}Z`}
            {...common}
          />
          <path
            d={`M${CX + 50} ${hy - 4} L${CX + 58} ${hy + 34} L${CX + 36} ${hy + 34} Q${CX + 44} ${hy + 10} ${CX + 44} ${hy - 4}Z`}
            {...common}
          />
          <path d={cap} {...common} />
        </>
      );
    case 'spiky':
      return (
        <>
          <path d={`M${CX - 46} ${hy - 28} L${CX - 40} ${hy - 74} L${CX - 18} ${hy - 46}Z`} {...common} />
          <path d={`M${CX - 18} ${hy - 46} L${CX + 2} ${hy - 82} L${CX + 22} ${hy - 46}Z`} {...common} />
          <path d={`M${CX + 22} ${hy - 46} L${CX + 44} ${hy - 74} L${CX + 46} ${hy - 28}Z`} {...common} />
        </>
      );
    case 'bun':
      return (
        <>
          <circle cx={CX} cy={hy - 62} r={16} {...common} />
          <path d={cap} {...common} />
        </>
      );
    default:
      return null;
  }
}

/** Accessoires : posés sur la tête (ou sur le visage, pour les lunettes). */
function Accessory({ kind, hy, ex, ey }: { kind: string; hy: number; ex: [number, number]; ey: number }) {
  const ink = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'party':
      return (
        <>
          <path d={`M${CX - 22} ${hy - 44} L${CX + 2} ${hy - 94} L${CX + 22} ${hy - 44}Z`} fill="#ff3d8b" {...ink} />
          <circle cx={CX + 2} cy={hy - 94} r={8} fill="#ffe27a" stroke={INK} strokeWidth={3} />
        </>
      );
    case 'crown':
      return (
        <path
          d={`M${CX - 40} ${hy - 40} L${CX - 44} ${hy - 68} L${CX - 22} ${hy - 52} L${CX} ${hy - 76} L${CX + 22} ${hy - 52} L${CX + 44} ${hy - 68} L${CX + 40} ${hy - 40}Z`}
          fill="#ffc83d"
          {...ink}
        />
      );
    case 'cap':
      return (
        <>
          <path
            d={`M${CX - 50} ${hy - 14} Q${CX - 48} ${hy - 56} ${CX} ${hy - 54} Q${CX + 48} ${hy - 56} ${CX + 50} ${hy - 14}Z`}
            fill="#8b5cff"
            {...ink}
          />
          <path
            d={`M${CX + 14} ${hy - 22} Q${CX + 62} ${hy - 26} ${CX + 62} ${hy - 10} Q${CX + 40} ${hy - 12} ${CX + 14} ${hy - 14}Z`}
            fill="#8b5cff"
            {...ink}
          />
        </>
      );
    case 'glasses':
      return (
        <>
          <circle cx={ex[0]} cy={ey} r={19} fill="none" stroke={INK} strokeWidth={4} />
          <circle cx={ex[1]} cy={ey} r={19} fill="none" stroke={INK} strokeWidth={4} />
          <path d={`M${ex[0] + 19} ${ey} L${ex[1] - 19} ${ey}`} stroke={INK} strokeWidth={4} />
        </>
      );
    case 'headphones':
      return (
        <>
          <path
            d={`M${CX - 54} ${hy + 4} Q${CX - 56} ${hy - 66} ${CX} ${hy - 64} Q${CX + 56} ${hy - 66} ${CX + 54} ${hy + 4}`}
            stroke={INK}
            strokeWidth={12}
            fill="none"
          />
          <path
            d={`M${CX - 54} ${hy + 4} Q${CX - 56} ${hy - 66} ${CX} ${hy - 64} Q${CX + 56} ${hy - 66} ${CX + 54} ${hy + 4}`}
            stroke="#ff3d8b"
            strokeWidth={5}
            fill="none"
          />
          <circle cx={CX - 54} cy={hy + 8} r={14} fill="#ff3d8b" {...ink} />
          <circle cx={CX + 54} cy={hy + 8} r={14} fill="#ff3d8b" {...ink} />
        </>
      );
    case 'bow':
      return (
        <>
          <path d={`M${CX + 40} ${hy - 44} L${CX + 70} ${hy - 60} L${CX + 70} ${hy - 28}Z`} fill="#ff3d8b" {...ink} />
          <path d={`M${CX + 40} ${hy - 44} L${CX + 10} ${hy - 60} L${CX + 10} ${hy - 28}Z`} fill="#ff3d8b" {...ink} />
          <circle cx={CX + 40} cy={hy - 44} r={6} fill="#ffe27a" stroke={INK} strokeWidth={3} />
        </>
      );
    case 'flower':
      return (
        <>
          {[0, 1, 2, 3, 4].map((k) => {
            const a = rad(k * 72);
            return (
              <circle
                key={k}
                cx={CX + 44 + 8 * Math.cos(a)}
                cy={hy - 42 + 8 * Math.sin(a)}
                r={7}
                fill="#fff"
                stroke={INK}
                strokeWidth={3}
              />
            );
          })}
          <circle cx={CX + 44} cy={hy - 42} r={6} fill="#ffc83d" stroke={INK} strokeWidth={3} />
        </>
      );
    default:
      return null;
  }
}

function Star({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x} ${y - 9} L${x + 3} ${y - 3} L${x + 9} ${y} L${x + 3} ${y + 3} L${x} ${y + 9} L${x - 3} ${y + 3} L${x - 9} ${y} L${x - 3} ${y - 3}Z`}
      fill="#ffe27a"
      stroke={INK}
      strokeWidth={2}
    />
  );
}

export interface CharacterProps {
  spec: CharacterSpec;
  mood?: CharacterMood;
  /** Visage demandé pour un instant (émotion du salon). Absent : l’expression du profil, au repos. */
  face?: CharacterExpression;
  /** `bust` : tête et buste, pour les bulles d’avatar. `full` : personnage entier. */
  framing?: 'full' | 'bust';
  /** Texte alternatif ; absent, le personnage est décoratif. */
  label?: string;
  className?: string;
}

const FRAMES = {
  full: { viewBox: '-20 -44 260 340', ratio: 340 / 260 },
  bust: { viewBox: '10 -46 200 200', ratio: 1 },
} as const;

/** Personnage dessiné (listes fermées). Le point d’entrée public est `Character`, qui gère aussi les packs. */
function DrawnCharacter({ spec, mood = 'idle', framing = 'full', label, className, face }: CharacterProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const c = characterColors(spec);
  const key = faceOf(spec, mood, face);
  const P = key ? { ...POSES[mood], ...EXPRESSION_FACE[key] } : POSES[mood];
  const bob = P.bounce;
  const hy = 62 + bob;
  const frame = FRAMES[framing];
  const body = c.body;
  const ex: [number, number] = [CX - 24, CX + 24];
  const ey = hy - 4;
  const leftEye = P.eyes === 'wink' ? 'open' : P.eyes;

  const shoulderL = [CX - 34, 118 + bob] as const;
  const shoulderR = [CX + 34, 118 + bob] as const;
  const hipL = [CX - 14, 186 + bob] as const;
  const hipR = [CX + 14, 186 + bob] as const;

  const legL = limb(hipL[0], hipL[1], P.LL[0], 58, P.LL[1], 54);
  const legR = limb(hipR[0], hipR[1], P.RL[0], 58, P.RL[1], 54);
  const armL = limb(shoulderL[0], shoulderL[1], P.L[0], 52, P.L[1], 48);
  const armR = limb(shoulderR[0], shoulderR[1], P.R[0], 52, P.R[1], 48);

  const gradId = `g${uid}`;
  const headId = `h${uid}`;
  const hatchId = `t${uid}`;

  return (
    <svg
      className={`chara chara--${mood}${className ? ` ${className}` : ''}`}
      viewBox={frame.viewBox}
      style={{ width: '100%', height: 'auto', display: 'block', aspectRatio: `${1 / frame.ratio}` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(body, 1.2)} />
          <stop offset=".55" stopColor={body} />
          <stop offset="1" stopColor={shade(body, 0.72)} />
        </linearGradient>
        <radialGradient id={headId} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor={shade(c.skin, 1.12)} />
          <stop offset=".7" stopColor={c.skin} />
          <stop offset="1" stopColor={shade(c.skin, 0.8)} />
        </radialGradient>
        <pattern id={hatchId} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <line x1="0" y1="0" x2="0" y2="9" stroke={INK} strokeWidth={2.5} opacity={0.35} />
        </pattern>
      </defs>

      {/* ombre au sol (plein cadre seulement) */}
      {framing === 'full' && <ellipse cx={CX} cy={268} rx={54} ry={8} fill="rgba(0,0,0,.3)" />}

      {/* jambes, puis bras : sous le torse */}
      {framing === 'full' && (
        <>
          <Limb d={legL.d} color={body} width={26} />
          <Limb d={legR.d} color={body} width={26} />
          <ellipse cx={legL.end[0]} cy={legL.end[1] + 8} rx={19} ry={11} fill={SHOE} stroke={INK} strokeWidth={3.5} />
          <ellipse cx={legR.end[0]} cy={legR.end[1] + 8} rx={19} ry={11} fill={SHOE} stroke={INK} strokeWidth={3.5} />
        </>
      )}
      <Limb d={armL.d} color={body} width={22} />
      <Limb d={armR.d} color={body} width={22} />

      {/* torse */}
      <rect
        x={CX - 44}
        y={106 + bob}
        width={88}
        height={104}
        rx={40}
        fill={`url(#${gradId})`}
        stroke={INK}
        strokeWidth={4}
      />
      <rect x={CX - 44} y={106 + bob} width={88} height={104} rx={40} fill={`url(#${hatchId})`} />
      <path
        d={`M${CX - 18} ${138 + bob} Q${CX} ${150 + bob} ${CX + 18} ${138 + bob}`}
        stroke={INK}
        strokeWidth={3}
        fill="none"
        opacity={0.5}
      />

      {/* cheveux bouclés : derrière la tête */}
      {c.hairStyle === 'curly' &&
        [-120, -80, -40, 0, 40, 80, 120].map((deg) => {
          const a = rad(deg);
          return (
            <circle
              key={deg}
              cx={CX + 54 * Math.sin(a)}
              cy={hy + 54 * Math.cos(a) - 4}
              r={15}
              fill={c.hair}
              stroke={INK}
              strokeWidth={4}
            />
          );
        })}

      {/* tête, en rotation selon l’humeur */}
      <g transform={`rotate(${P.tilt} ${CX} ${hy + 40})`}>
        <circle cx={CX} cy={hy} r={50} fill={`url(#${headId})`} stroke={INK} strokeWidth={4} />
        <circle cx={CX} cy={hy} r={50} fill={`url(#${hatchId})`} />
        <ellipse
          cx={CX - 18}
          cy={hy - 26}
          rx={10}
          ry={6}
          fill="#fff"
          opacity={0.4}
          transform={`rotate(-25 ${CX - 18} ${hy - 26})`}
        />

        <Hair style={c.hairStyle} color={c.hair} hy={hy} />
        <Brows left={ex[0]} right={ex[1]} y={hy - 26} kind={P.brow} />

        <Eye x={ex[0]} y={ey} kind={leftEye} look={P.look} />
        <Eye x={ex[1]} y={ey} kind={P.eyes === 'wink' ? 'wink' : P.eyes} look={P.look} />
        {P.eyes === 'sad' && <Lid x={ex[0]} y={ey} skin={c.skin} />}
        {P.eyes === 'sad' && <Lid x={ex[1]} y={ey} skin={c.skin} />}
        {P.eyes === 'sad' && (
          <path
            d={`M${ex[0] - 20} ${ey + 22} Q${ex[0] - 26} ${ey + 36} ${ex[0] - 20} ${ey + 42} Q${ex[0] - 14} ${ey + 36} ${ex[0] - 20} ${ey + 22}Z`}
            fill="#5ad0ff"
            stroke={INK}
            strokeWidth={2.5}
          />
        )}

        <ellipse cx={CX - 40} cy={hy + 14} rx={9} ry={6} fill="#ff7a8f" opacity={0.6} />
        <ellipse cx={CX + 40} cy={hy + 14} rx={9} ry={6} fill="#ff7a8f" opacity={0.6} />
        <Mouth cx={CX} cy={hy + 22} kind={P.mouth} />

        <Accessory kind={c.accessory} hy={hy} ex={ex} ey={ey} />
      </g>

      {/* mains : sur les bras */}
      <circle cx={armL.end[0]} cy={armL.end[1]} r={13} fill={c.skin} stroke={INK} strokeWidth={3.5} />
      <circle cx={armR.end[0]} cy={armR.end[1]} r={13} fill={c.skin} stroke={INK} strokeWidth={3.5} />

      {P.wave && (
        <g className="chara-wave">
          {[22, 36].map((r, k) => (
            <path
              key={r}
              d={`M${f(armR.end[0] + 14 + k * 6)} ${f(armR.end[1] - 18 - k * 4)} Q${f(armR.end[0] + r + 14 + k * 6)} ${f(armR.end[1] - 4)} ${f(armR.end[0] + 14 + k * 6)} ${f(armR.end[1] + 12)}`}
              stroke={INK}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
          ))}
        </g>
      )}

      {P.sparkles && (
        <>
          <Star x={18} y={40} />
          <Star x={200} y={60} />
          <Star x={24} y={200} />
          <Star x={196} y={190} />
        </>
      )}
    </svg>
  );
}

/** Éclaircit ou assombrit une couleur hexadécimale (facteur multiplicatif). */
function shade(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const c = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * factor)));
  return `#${[c(0), c(2), c(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Personnage affiché partout (avatars, éditeur, vues de jeu). Si le joueur a choisi un pack de sprites
 * déjà chargé, son sprite est montré ; sinon le personnage dessiné.
 */
export function Character(props: CharacterProps) {
  const pack = usePackInfo(props.spec.pack);
  const look = pack ? resolveLook(pack, props.spec.look) : null;
  if (pack && look) {
    return (
      <PackFigure
        pack={pack}
        look={look}
        mood={props.mood}
        face={faceOf(props.spec, props.mood ?? 'idle', props.face)}
        framing={props.framing}
        label={props.label}
        className={props.className}
      />
    );
  }
  return <DrawnCharacter {...props} />;
}

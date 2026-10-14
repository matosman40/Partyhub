import { useId } from 'react';
import { WILD_FAMILY, type CardBack, type CardEntry, type CardGameDefinition, type CardTheme } from '@partyhub/shared';
import { assetFontFamily } from './fonts.js';

/**
 * Rendu vectoriel des cartes. Tout est dessiné en SVG (aucune image externe) :
 * les cartes restent nettes sur les téléphones à forte densité comme sur les
 * écrans de salon, et chaque thème reçoit son propre décor.
 *
 * Chaque SVG déclare ses dégradés avec un identifiant unique (useId) : plusieurs
 * cartes peuvent ainsi cohabiter sur une même page sans conflit.
 */

const VIEW_W = 200;
const VIEW_H = 280;
const WILD_COLOURS = ['#ff4d5a', '#ffc83d', '#3fd27a', '#3f8cff'];

function channels(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** Mélange une couleur avec une autre (t entre 0 et 1). */
function mix(hex: string, other: string, t: number): string {
  const a = channels(hex);
  const b = channels(other);
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const lighten = (hex: string, t: number) => mix(hex, '#ffffff', t);
const darken = (hex: string, t: number) => mix(hex, '#000000', t);

export interface CardFaceProps {
  def: CardGameDefinition;
  /** Carte à afficher. Absente : dos de carte. */
  entry?: CardEntry;
  /** Force le dos de carte (pioche). */
  back?: boolean;
  /** Pour les lecteurs d'écran. */
  label?: string;
}

export function CardFace({ def, entry, back, label }: CardFaceProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const theme: CardTheme = def.theme;
  const showBack = back || !entry;

  return (
    <svg
      className={`pcard pcard-${theme}${showBack ? ' is-back' : ''}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      style={def.fontAssetId ? { fontFamily: `${assetFontFamily(def.fontAssetId)}, sans-serif` } : undefined}
      role="img"
      aria-label={showBack ? 'Dos de carte' : label ?? entry?.label ?? 'Carte'}
    >
      {showBack ? (
        def.back ? <CustomBack back={def.back} uid={uid} /> : <Back theme={theme} uid={uid} />
      ) : (
        <Front def={def} entry={entry!} theme={theme} uid={uid} />
      )}
    </svg>
  );
}

interface LayerProps {
  theme: CardTheme;
  uid: string;
}

function Front({ def, entry, theme, uid }: LayerProps & { def: CardGameDefinition; entry: CardEntry }) {
  const family = def.families.find((f) => f.id === entry.family);
  const isWild = entry.family === WILD_FAMILY || !family;
  const base = family?.color ?? '#ffffff';
  const wildPalette = def.families.slice(0, 4).map((f) => f.color);
  const palette = wildPalette.length === 4 ? wildPalette : WILD_COLOURS;
  const useGlyph = entry.effect === 'skip' || entry.effect === 'reverse' || entry.effect === 'wild';
  const symbol = entry.symbol;
  const count = Array.from(symbol).length;
  const bigSize = count === 1 ? 108 : count === 2 ? 86 : 64;
  const cornerSize = count === 1 ? 32 : 22;
  const showLabel = entry.effect !== 'none' && entry.label.length > 0;

  if (theme === 'coco') {
    return (
      <CocoFront
        uid={uid}
        base={isWild ? palette[0]! : base}
        symbol={symbol}
        bigSize={bigSize}
        cornerSize={cornerSize}
        label={showLabel ? entry.label : ''}
        glyph={useGlyph ? entry.effect : null}
        palette={palette}
        isWild={isWild}
      />
    );
  }

  if (theme === 'classique') {
    return (
      <ClassiqueFront
        uid={uid}
        base={base}
        symbol={symbol}
        bigSize={count <= 2 ? 96 : 62}
        cornerSize={count === 1 ? 30 : 20}
        label={showLabel ? entry.label : ''}
        glyph={null}
        palette={palette}
        isWild={isWild}
      />
    );
  }

  if (theme === 'nuit') {
    return (
      <NuitFront
        uid={uid}
        base={isWild ? palette[0]! : base}
        symbol={symbol}
        bigSize={bigSize}
        cornerSize={cornerSize}
        label={showLabel ? entry.label : ''}
        glyph={useGlyph ? entry.effect : null}
        palette={palette}
        isWild={isWild}
      />
    );
  }

  return (
    <ArcadeFront
      uid={uid}
      base={isWild ? palette[0]! : base}
      symbol={symbol}
      bigSize={bigSize}
      cornerSize={cornerSize}
      label={showLabel ? entry.label : ''}
      glyph={useGlyph ? entry.effect : null}
      palette={palette}
      isWild={isWild}
    />
  );
}

interface FrontProps {
  uid: string;
  base: string;
  symbol: string;
  bigSize: number;
  cornerSize: number;
  label: string;
  glyph: string | null;
  palette: string[];
  isWild: boolean;
}

/** Glyphe vectoriel pour les effets : évite de dépendre des polices pour ⊘ ⇄ ✦. */
function Glyph({ kind, palette, stroke, cx = 100, cy = 140, r = 46 }: {
  kind: string;
  palette: string[];
  stroke: string;
  cx?: number;
  cy?: number;
  r?: number;
}) {
  if (kind === 'skip') {
    const d = r * 0.7;
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={r * 0.28} />
        <line x1={cx - d} y1={cy + d} x2={cx + d} y2={cy - d} stroke={stroke} strokeWidth={r * 0.28} strokeLinecap="round" />
      </g>
    );
  }
  if (kind === 'reverse') {
    return (
      <g fill="none" stroke={stroke} strokeWidth={r * 0.24} strokeLinecap="round" strokeLinejoin="round">
        <path d={`M ${cx - r} ${cy - r * 0.35} A ${r} ${r} 0 0 1 ${cx + r * 0.9} ${cy - r * 0.55}`} />
        <path d={`M ${cx + r * 0.62} ${cy - r * 0.98} L ${cx + r * 0.95} ${cy - r * 0.5} L ${cx + r * 0.32} ${cy - r * 0.42}`} />
        <path d={`M ${cx + r} ${cy + r * 0.35} A ${r} ${r} 0 0 1 ${cx - r * 0.9} ${cy + r * 0.55}`} />
        <path d={`M ${cx - r * 0.62} ${cy + r * 0.98} L ${cx - r * 0.95} ${cy + r * 0.5} L ${cx - r * 0.32} ${cy + r * 0.42}`} />
      </g>
    );
  }
  // Joker : quatre quartiers aux couleurs du jeu.
  const [c0, c1, c2, c3] = palette as [string, string, string, string];
  return (
    <g>
      <path d={`M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`} fill={c0} />
      <path d={`M ${cx} ${cy} L ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy + r} Z`} fill={c1} />
      <path d={`M ${cx} ${cy} L ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx - r} ${cy} Z`} fill={c2} />
      <path d={`M ${cx} ${cy} L ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy - r} Z`} fill={c3} />
      <circle cx={cx} cy={cy} r={r * 0.22} fill="#ffffff" />
    </g>
  );
}

function Corner({ symbol, size, x, y, fill, font }: {
  symbol: string;
  size: number;
  x: number;
  y: number;
  fill: string;
  font: string;
}) {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} style={{ fontFamily: font }} textAnchor="middle" dominantBaseline="central">
      {symbol}
    </text>
  );
}

function ArcadeFront({ uid, base, symbol, bigSize, cornerSize, label, glyph, palette, isWild }: FrontProps) {
  const bg = `g${uid}`;
  const med = `m${uid}`;
  const shine = `s${uid}`;
  const top = lighten(base, 0.18);
  const bottom = darken(base, 0.32);
  const ink = isWild ? '#ffffff' : base;
  return (
    <>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <radialGradient id={med} cx="0.5" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#efe9ff" />
        </radialGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${bg})`} />
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${shine})`} />
      <rect x="13" y="13" width="174" height="254" rx="17" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="3" />
      <ellipse cx="100" cy="140" rx="66" ry="100" transform="rotate(-18 100 140)" fill={`url(#${med})`} stroke={darken(base, 0.1)} strokeOpacity="0.25" strokeWidth="2" />
      {glyph ? (
        <Glyph kind={glyph} palette={palette} stroke={ink} />
      ) : (
        <text x="100" y="140" fontSize={bigSize} fill={darken(base, 0.45)} fillOpacity="0.25" transform="translate(3 5)" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--display)' }}>
          {symbol}
        </text>
      )}
      {!glyph && (
        <text x="100" y="140" fontSize={bigSize} fill={ink} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--display)' }}>
          {symbol}
        </text>
      )}
      {label && (
        <text x="100" y="214" fontSize="15" fill={darken(base, 0.2)} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--ui)', fontWeight: 800 }}>
          {label}
        </text>
      )}
      <Corner symbol={symbol} size={cornerSize} x={34} y={46} fill="#ffffff" font="var(--display)" />
      <g transform="rotate(180 100 140)">
        <Corner symbol={symbol} size={cornerSize} x={34} y={46} fill="#ffffff" font="var(--display)" />
      </g>
    </>
  );
}

function CocoFront({ uid, base, symbol, bigSize, cornerSize, label, glyph, palette, isWild }: FrontProps) {
  const bg = `c${uid}`;
  const disc = `d${uid}`;
  const dots = `p${uid}`;
  const ink = darken(base, 0.45);
  return (
    <>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff9ec" />
          <stop offset="1" stopColor="#f2e0bd" />
        </linearGradient>
        <radialGradient id={disc} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor={lighten(base, 0.25)} />
          <stop offset="1" stopColor={darken(base, 0.15)} />
        </radialGradient>
        <pattern id={dots} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="1.6" fill="#b88a55" fillOpacity="0.22" />
        </pattern>
      </defs>
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${bg})`} stroke="#e2c58f" strokeWidth="3" />
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${dots})`} />
      <ellipse cx="100" cy="140" rx="80" ry="114" fill={`url(#${disc})`} />
      <ellipse cx="100" cy="140" rx="80" ry="114" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="2" />
      <circle cx="100" cy="140" r="56" fill="#fffdf7" stroke={base} strokeWidth="6" />
      {glyph ? (
        <Glyph kind={glyph} palette={palette} stroke={ink} r={38} />
      ) : (
        <text x="100" y="142" fontSize={bigSize * 0.82} fill={ink} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--display)' }}>
          {symbol}
        </text>
      )}
      {label && (
        <text x="100" y="222" fontSize="14" fill="#ffffff" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--ui)', fontWeight: 800 }}>
          {label}
        </text>
      )}
      <Corner symbol={symbol} size={cornerSize} x={34} y={46} fill={isWild ? '#8b5e3c' : base} font="var(--display)" />
      <g transform="rotate(180 100 140)">
        <Corner symbol={symbol} size={cornerSize} x={34} y={46} fill={isWild ? '#8b5e3c' : base} font="var(--display)" />
      </g>
    </>
  );
}

function NuitFront({ uid, base, symbol, bigSize, cornerSize, label, glyph, palette, isWild }: FrontProps) {
  const bg = `n${uid}`;
  const glow = `f${uid}`;
  const grid = `g${uid}`;
  const neon = isWild ? '#ffffff' : base;
  return (
    <>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f1650" />
          <stop offset="1" stopColor="#07051a" />
        </linearGradient>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id={grid} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${bg})`} />
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${grid})`} />
      <rect x="10" y="10" width="180" height="260" rx="20" fill="none" stroke={neon} strokeWidth="3" filter={`url(#${glow})`} />
      <ellipse cx="100" cy="140" rx="66" ry="100" fill="#0c0830" stroke={neon} strokeWidth="3" filter={`url(#${glow})`} />
      {glyph ? (
        <g filter={`url(#${glow})`}>
          <Glyph kind={glyph} palette={palette} stroke={neon} />
        </g>
      ) : (
        <text x="100" y="140" fontSize={bigSize} fill={neon} textAnchor="middle" dominantBaseline="central" filter={`url(#${glow})`} style={{ fontFamily: 'var(--display)' }}>
          {symbol}
        </text>
      )}
      {label && (
        <text x="100" y="216" fontSize="14" fill={neon} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--ui)', fontWeight: 800 }}>
          {label}
        </text>
      )}
      <Corner symbol={symbol} size={cornerSize} x={34} y={46} fill={neon} font="var(--display)" />
      <g transform="rotate(180 100 140)">
        <Corner symbol={symbol} size={cornerSize} x={34} y={46} fill={neon} font="var(--display)" />
      </g>
    </>
  );
}

function ClassiqueFront({ uid, base, symbol, bigSize, cornerSize, label, isWild }: FrontProps) {
  const paper = `p${uid}`;
  const ink = isWild ? '#16162e' : base;
  return (
    <>
      <defs>
        <linearGradient id={paper} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f3f1ea" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="192" height="272" rx="14" fill={`url(#${paper})`} stroke="#d4cfc2" strokeWidth="2" />
      <rect x="12" y="12" width="176" height="256" rx="9" fill="none" stroke={base} strokeOpacity="0.18" strokeWidth="1.5" />
      <text x="100" y="142" fontSize={bigSize} fill={ink} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--display)' }}>
        {symbol}
      </text>
      {label && (
        <text x="100" y="222" fontSize="13" fill="#6b6a7a" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--ui)', fontWeight: 700 }}>
          {label}
        </text>
      )}
      <Corner symbol={symbol} size={cornerSize} x={30} y={34} fill={isWild ? '#16162e' : base} font="var(--display)" />
      <g transform="rotate(180 100 140)">
        <Corner symbol={symbol} size={cornerSize} x={30} y={34} fill={isWild ? '#16162e' : base} font="var(--display)" />
      </g>
    </>
  );
}

/** Dos personnalisé par le créateur du jeu : couleur, texte et image de la médiathèque. */
function CustomBack({ back, uid }: { back: CardBack; uid: string }) {
  const color = back.color ?? '#1d2a5c';
  const clip = `cb${uid}`;
  const label = back.label ?? '';
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <rect x="8" y="8" width="184" height="264" rx="16" />
        </clipPath>
      </defs>
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="22" fill={darken(color, 0.45)} />
      <g clipPath={`url(#${clip})`}>
        <rect x="8" y="8" width="184" height="264" fill={color} />
        {back.imageAssetId && (
          <image
            href={`/api/assets/${back.imageAssetId}`}
            x="8"
            y="8"
            width="184"
            height="264"
            preserveAspectRatio="xMidYMid slice"
          />
        )}
      </g>
      <rect
        x="14"
        y="14"
        width="172"
        height="252"
        rx="12"
        fill="none"
        stroke={lighten(color, 0.5)}
        strokeOpacity="0.8"
        strokeWidth="2"
      />
      {label && (
        <text
          x="100"
          y="140"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={label.length > 8 ? 22 : 30}
          fontWeight="800"
          fill="#ffffff"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="4"
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </>
  );
}

function Back({ theme, uid }: LayerProps) {
  const pat = `b${uid}`;
  const fill = `k${uid}`;
  if (theme === 'classique') {
    return (
      <>
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1d2a5c" />
            <stop offset="1" stopColor="#0c1330" />
          </linearGradient>
          <pattern id={pat} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="16" fill="#ffffff" fillOpacity="0.07" />
          </pattern>
        </defs>
        <rect x="4" y="4" width="192" height="272" rx="14" fill={`url(#${fill})`} />
        <rect x="4" y="4" width="192" height="272" rx="14" fill={`url(#${pat})`} />
        <rect x="14" y="14" width="172" height="252" rx="10" fill="none" stroke="#e7c873" strokeWidth="3" />
        <ellipse cx="100" cy="140" rx="54" ry="84" fill="none" stroke="#e7c873" strokeWidth="2.5" />
        <text x="100" y="142" fontSize="40" fill="#e7c873" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--display)' }}>
          ♛
        </text>
      </>
    );
  }

  if (theme === 'coco') {
    return (
      <>
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff9ec" />
            <stop offset="1" stopColor="#f0d9ac" />
          </linearGradient>
          <pattern id={pat} width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="11" cy="11" r="4" fill="#8b5e3c" fillOpacity="0.16" />
          </pattern>
        </defs>
        <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${fill})`} stroke="#e2c58f" strokeWidth="3" />
        <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${pat})`} />
        <circle cx="100" cy="140" r="58" fill="#8b5e3c" />
        <circle cx="100" cy="140" r="58" fill="none" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="4" />
        <circle cx="84" cy="122" r="12" fill="#ffffff" fillOpacity="0.28" />
      </>
    );
  }
  if (theme === 'nuit') {
    return (
      <>
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1f1650" />
            <stop offset="1" stopColor="#07051a" />
          </linearGradient>
          <pattern id={pat} width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#3ff5e0" strokeOpacity="0.18" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${fill})`} />
        <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${pat})`} />
        <rect x="14" y="14" width="172" height="252" rx="18" fill="none" stroke="#3ff5e0" strokeWidth="3" />
        <polygon points="100,80 160,140 100,200 40,140" fill="none" stroke="#ff3d8b" strokeWidth="4" />
        <polygon points="100,104 136,140 100,176 64,140" fill="#8b5cff" fillOpacity="0.4" />
      </>
    );
  }
  return (
    <>
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff3d8b" />
          <stop offset="1" stopColor="#8b5cff" />
        </linearGradient>
        <pattern id={pat} width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="9" cy="9" r="2" fill="#ffffff" fillOpacity="0.2" />
        </pattern>
      </defs>
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${fill})`} />
      <rect x="4" y="4" width="192" height="272" rx="24" fill={`url(#${pat})`} />
      <rect x="13" y="13" width="174" height="254" rx="17" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="3" />
      <ellipse cx="100" cy="140" rx="60" ry="92" transform="rotate(-18 100 140)" fill="#ffc83d" />
      <text x="100" y="140" fontSize="46" fill="#2a1a00" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: 'var(--display)' }}>
        PH
      </text>
    </>
  );
}

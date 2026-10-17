import { useId } from 'react';

/**
 * Décor du plateau, en coordonnées 1600 × 1000 : la zone du plateau a toujours ce format, donc les
 * positions des personnages (en fractions) et le décor restent alignés à toutes les tailles d’écran.
 * Un seul thème pour l’instant (« prairie ») ; un jeu peut en fournir d’autres plus tard.
 */

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

interface Dot {
  x: number;
  y: number;
  r: number;
  color: string;
}

const FLOWER_COLORS = ['#ffffff', '#ffd23f', '#ff8fb1', '#b9a4ff', '#ff9f43'];

// Tirage fixe (graine constante) : le décor ne change jamais d’un rendu à l’autre.
const FLOWERS: Dot[] = (() => {
  const rnd = seeded(20261015);
  return Array.from({ length: 64 }, () => ({
    x: 40 + rnd() * 1520,
    y: 40 + rnd() * 920,
    r: 5 + rnd() * 4,
    color: FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)] ?? '#ffffff',
  }));
})();

const TUFTS: { x: number; y: number }[] = (() => {
  const rnd = seeded(7331);
  return Array.from({ length: 90 }, () => ({ x: rnd() * 1600, y: rnd() * 1000 }));
})();

function Tree({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={0} cy={62} rx={74} ry={18} fill="rgba(20,60,20,.22)" />
      <rect x={-13} y={6} width={26} height={66} rx={7} fill="#8a5a33" />
      <circle cx={-40} cy={8} r={54} fill="#3a8f47" />
      <circle cx={42} cy={6} r={56} fill="#3f9d4c" />
      <circle cx={0} cy={-22} r={72} fill="#4aaa55" />
      <circle cx={-16} cy={-48} r={28} fill="#86dc7e" opacity={0.55} />
    </g>
  );
}

function Bush({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={0} cy={26} rx={46} ry={11} fill="rgba(20,60,20,.2)" />
      <circle cx={-18} cy={6} r={26} fill="#3f9d4c" />
      <circle cx={16} cy={2} r={30} fill="#4aaa55" />
      <circle cx={-2} cy={-12} r={20} fill="#86dc7e" opacity={0.5} />
    </g>
  );
}

export function PrairieScene() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const grass = `grass${uid}`;
  const mow = `mow${uid}`;
  const pond = `pond${uid}`;
  const rock = `rock${uid}`;
  const vignette = `vig${uid}`;
  const sun = `sun${uid}`;
  return (
    <svg className="plateau-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={grass} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9be27c" />
          <stop offset="1" stopColor="#5cb35a" />
        </linearGradient>
        <pattern id={mow} width="160" height="1000" patternUnits="userSpaceOnUse">
          <rect width="80" height="1000" fill="#ffffff" opacity={0.06} />
        </pattern>
        <radialGradient id={pond} cx=".42" cy=".38" r=".7">
          <stop offset="0" stopColor="#c8f4ff" />
          <stop offset=".45" stopColor="#58c4f0" />
          <stop offset="1" stopColor="#2c86c4" />
        </radialGradient>
        <radialGradient id={rock} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#d9dde6" />
          <stop offset="1" stopColor="#7d8594" />
        </radialGradient>
        <radialGradient id={vignette} cx=".5" cy=".5" r=".75">
          <stop offset=".6" stopColor="#0b2a14" stopOpacity="0" />
          <stop offset="1" stopColor="#0b2a14" stopOpacity=".38" />
        </radialGradient>
        <radialGradient id={sun} cx=".92" cy=".05" r=".6">
          <stop offset="0" stopColor="#fff6c2" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff6c2" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="1600" height="1000" fill={`url(#${grass})`} />
      <rect width="1600" height="1000" fill={`url(#${mow})`} />

      {TUFTS.map((t, i) => (
        <path
          key={`t${i}`}
          d={`M${t.x} ${t.y} l-5 -14 M${t.x} ${t.y} l0 -18 M${t.x} ${t.y} l6 -13`}
          stroke="#3f8f45"
          strokeWidth={2.4}
          strokeLinecap="round"
          opacity={0.7}
        />
      ))}

      {FLOWERS.map((f, i) => (
        <g key={`f${i}`}>
          <circle cx={f.x} cy={f.y} r={f.r + 2} fill="#2f7a3a" opacity={0.25} />
          <circle cx={f.x} cy={f.y} r={f.r} fill={f.color} />
          <circle cx={f.x} cy={f.y} r={f.r * 0.35} fill="#ffe27a" />
        </g>
      ))}

      {/* Chemin de terre : bordure sombre, puis sable clair. */}
      <path
        d="M-40 760 C 260 690, 380 900, 720 820 S 1180 640, 1640 700"
        fill="none"
        stroke="#b98a52"
        strokeWidth={124}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M-40 760 C 260 690, 380 900, 720 820 S 1180 640, 1640 700"
        fill="none"
        stroke="#ecd09a"
        strokeWidth={104}
        strokeLinecap="round"
      />

      {/* Mare, avec ses reflets qui ondulent. */}
      <ellipse cx={1190} cy={300} rx={250} ry={150} fill="#2c6f9c" opacity={0.35} transform="translate(0 12)" />
      <ellipse cx={1190} cy={300} rx={250} ry={150} fill={`url(#${pond})`} />
      <ellipse cx={1120} cy={262} rx={70} ry={14} fill="#ffffff" opacity={0.5} />
      <ellipse
        className="plateau-ripple"
        cx={1250}
        cy={340}
        rx={58}
        ry={11}
        fill="none"
        stroke="#ffffff"
        strokeWidth={3}
      />
      <ellipse
        className="plateau-ripple plateau-ripple-late"
        cx={1110}
        cy={330}
        rx={40}
        ry={8}
        fill="none"
        stroke="#ffffff"
        strokeWidth={2.5}
      />
      <g>
        <ellipse cx={1010} cy={420} rx={34} ry={22} fill={`url(#${rock})`} />
        <ellipse cx={1046} cy={436} rx={22} ry={14} fill={`url(#${rock})`} />
      </g>

      <Bush x={560} y={170} s={1} />
      <Bush x={1400} y={480} s={0.9} />
      <Bush x={230} y={600} s={0.85} />
      <Tree x={140} y={190} s={1.15} />
      <Tree x={700} y={110} s={0.8} />
      <Tree x={1450} y={160} s={1} />
      <Tree x={1500} y={760} s={1.2} />
      <Tree x={110} y={840} s={0.95} />

      <rect width="1600" height="1000" fill={`url(#${sun})`} />
      <rect width="1600" height="1000" fill={`url(#${vignette})`} />
    </svg>
  );
}

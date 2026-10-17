import type { ReactNode } from 'react';
import { hashText } from '@partyhub/shared';
import { logoFor } from './gameLogos.js';

/**
 * Décor de fond de chaque jeu : une scène dessinée en SVG, dans les couleurs du jeu.
 * Chaque décor est déterministe (même jeu, même image) et se rogne (xMidYMid slice) à toutes les
 * proportions. Les jeux sans décor dessiné reçoivent l'un des décors génériques, choisi par identifiant.
 */

const W = 1600;
const H = 900;

interface Ctx {
  /** Dégradé du ciel, du haut vers le bas. */
  a: string;
  b: string;
  fill: string;
  edge: string;
  ink: string;
  /** Générateur pseudo-aléatoire seedé : même jeu, même décor. */
  r: () => number;
}

type Scene = (c: Ctx) => ReactNode;

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const span = (r: () => number, min: number, max: number) => min + (max - min) * r();

const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)] ?? items[0]!;

/** Points d'une étoile à quatre branches, centrée sur (x, y). */
const sparkle = (x: number, y: number, s: number) =>
  `M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`;

/** Points d'une étoile à cinq branches. */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(angle)).toFixed(1)},${(cy + rad * Math.sin(angle)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function Ridge({
  c,
  base,
  amp,
  color,
  opacity = 1,
}: {
  c: Ctx;
  base: number;
  amp: number;
  color: string;
  opacity?: number;
}) {
  const k1 = span(c.r, 0.0014, 0.0032);
  const k2 = span(c.r, 0.004, 0.008);
  const p1 = c.r() * Math.PI * 2;
  const p2 = c.r() * Math.PI * 2;
  let d = `M0 ${H} L0 ${base}`;
  for (let x = 40; x <= W; x += 40) {
    const y = base - amp * (0.6 * Math.sin(x * k1 + p1) + 0.4 * Math.sin(x * k2 + p2));
    d += ` L${x} ${y.toFixed(1)}`;
  }
  d += ` L${W} ${H} Z`;
  return <path d={d} fill={color} opacity={opacity} />;
}

function Pines({
  c,
  base,
  count,
  minH,
  maxH,
  color,
  opacity = 1,
}: {
  c: Ctx;
  base: number;
  count: number;
  minH: number;
  maxH: number;
  color: string;
  opacity?: number;
}) {
  const trees: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = span(c.r, -20, W + 20);
    const h = span(c.r, minH, maxH);
    const w = h * 0.42;
    const top = base - h;
    const tier = top + h * 0.45;
    trees.push(
      <path
        key={i}
        d={`M${x} ${top} L${x - w * 0.3} ${tier} L${x - w * 0.15} ${tier} L${x - w / 2} ${base} L${x + w / 2} ${base} L${x + w * 0.15} ${tier} L${x + w * 0.3} ${tier} Z`}
      />,
    );
  }
  return (
    <g fill={color} opacity={opacity}>
      {trees}
    </g>
  );
}

function Stars({ c, count, maxY, color = '#ffffff' }: { c: Ctx; count: number; maxY: number; color?: string }) {
  const dots: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    dots.push(
      <circle
        key={i}
        cx={span(c.r, 0, W)}
        cy={span(c.r, 0, maxY)}
        r={span(c.r, 1, 3.2)}
        fill={color}
        opacity={span(c.r, 0.4, 0.95)}
      />,
    );
  }
  return <g>{dots}</g>;
}

function Moon({ cx, cy, r, color, craters }: { cx: number; cy: number; r: number; color: string; craters: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 2} fill={color} opacity={0.08} />
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.2} r={r * 0.22} fill={craters} opacity={0.2} />
      <circle cx={cx + r * 0.3} cy={cy + r * 0.3} r={r * 0.15} fill={craters} opacity={0.2} />
      <circle cx={cx + r * 0.1} cy={cy - r * 0.45} r={r * 0.1} fill={craters} opacity={0.2} />
    </g>
  );
}

function Skyline({
  c,
  base,
  minH,
  maxH,
  color,
  windows,
  opacity = 1,
}: {
  c: Ctx;
  base: number;
  minH: number;
  maxH: number;
  color: string;
  windows?: string;
  opacity?: number;
}) {
  const parts: ReactNode[] = [];
  let x = -20;
  while (x < W) {
    const w = span(c.r, 70, 150);
    const h = span(c.r, minH, maxH);
    parts.push(
      <rect key={`b${x}`} x={x} y={base - h} width={w} height={h + (H - base)} fill={color} opacity={opacity} />,
    );
    if (windows) {
      for (let wy = base - h + 24; wy < base - 18; wy += 34) {
        for (let wx = x + 14; wx < x + w - 14; wx += 26) {
          if (c.r() > 0.72) {
            parts.push(
              <rect key={`w${x}-${wx}-${wy}`} x={wx} y={wy} width={10} height={14} fill={windows} opacity={0.85} />,
            );
          }
        }
      }
    }
    x += w + span(c.r, 0, 6);
  }
  return <g>{parts}</g>;
}

/** Rideau à franges, tiré depuis le bord A vers le bord B. */
function Curtain({
  a,
  b,
  bottom,
  color,
  folds,
  opacity = 1,
}: {
  a: number;
  b: number;
  bottom: number;
  color: string;
  folds: number;
  opacity?: number;
}) {
  const n = 4;
  let d = `M${a} 0 L${b} 0 L${b} ${bottom}`;
  for (let k = 0; k < n; k++) {
    const xs = b + ((a - b) * k) / n;
    const xe = b + ((a - b) * (k + 1)) / n;
    d += ` Q${(xs + xe) / 2} ${bottom + 70} ${xe} ${bottom}`;
  }
  d += ' Z';
  const lines: ReactNode[] = [];
  for (let j = 1; j <= folds; j++) {
    const x = b + ((a - b) * j) / (folds + 1);
    lines.push(<line key={j} x1={x} y1={0} x2={x} y2={bottom} />);
  }
  return (
    <g>
      <path d={d} fill={color} opacity={opacity} />
      <g stroke="#000" strokeWidth={6} opacity={0.18} strokeLinecap="round">
        {lines}
      </g>
    </g>
  );
}

function Houses({
  c,
  base,
  count,
  color,
  windows,
}: {
  c: Ctx;
  base: number;
  count: number;
  color: string;
  windows: string;
}) {
  const parts: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const w = span(c.r, 90, 150);
    const h = span(c.r, 90, 170);
    const x = span(c.r, -40, W - 60);
    const roofY = base - h - h * 0.45;
    parts.push(<rect key={`h${i}`} x={x} y={base - h} width={w} height={h} fill={color} />);
    parts.push(
      <path
        key={`r${i}`}
        d={`M${x - 12} ${base - h} L${x + w / 2} ${roofY} L${x + w + 12} ${base - h} Z`}
        fill={color}
      />,
    );
    if (c.r() > 0.35) {
      parts.push(
        <rect key={`d${i}`} x={x + w * 0.4} y={base - 46} width={w * 0.2} height={46} fill={windows} opacity={0.9} />,
      );
    }
    if (c.r() > 0.2) {
      parts.push(
        <rect
          key={`w${i}`}
          x={x + w * 0.14}
          y={base - h * 0.7}
          width={w * 0.2}
          height={w * 0.2}
          fill={windows}
          opacity={0.85}
        />,
      );
    }
  }
  return <g>{parts}</g>;
}

/** Chaque décor : fond, puis plans successifs du lointain vers le premier plan. */
const quizParty: Scene = (c) => (
  <>
    {[300, 800, 1300].map((x, i) => (
      <polygon
        key={x}
        points={`${x - 30},-10 ${x + 30},-10 ${x + 170 + i * 20},${H * 0.8} ${x - 170 - i * 20},${H * 0.8}`}
        fill={c.fill}
        opacity={0.13}
      />
    ))}
    <rect y={H * 0.78} width={W} height={H * 0.22} fill="#000" opacity={0.32} />
    {Array.from({ length: 21 }, (_, i) => (
      <circle key={i} cx={i * 80} cy={H * 0.78} r={7} fill={i % 2 ? c.edge : c.fill} />
    ))}
    {Array.from({ length: 36 }, (_, i) => {
      const x = span(c.r, 0, W);
      const y = span(c.r, 60, H * 0.7);
      const rot = span(c.r, 0, 180);
      return (
        <rect
          key={i}
          x={x}
          y={y}
          width={14}
          height={8}
          fill={i % 2 ? c.fill : c.edge}
          opacity={0.7}
          transform={`rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})`}
        />
      );
    })}
    <Curtain a={0} b={250} bottom={H * 0.62} color={c.edge} folds={3} opacity={0.82} />
    <Curtain a={W} b={W - 250} bottom={H * 0.62} color={c.edge} folds={3} opacity={0.82} />
  </>
);

const bombes: Scene = (c) => (
  <>
    <circle cx={W * 0.5} cy={H * 0.95} r={900} fill={c.edge} opacity={0.16} />
    <Skyline c={c} base={H * 0.78} minH={120} maxH={360} color="#000" windows={c.edge} opacity={0.62} />
    <path
      d="M1300 650 C1320 560 1380 500 1460 470"
      fill="none"
      stroke={c.edge}
      strokeWidth={12}
      strokeLinecap="round"
    />
    {Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return (
        <line
          key={i}
          x1={1460 + Math.cos(a) * 34}
          y1={470 + Math.sin(a) * 34}
          x2={1460 + Math.cos(a) * 70}
          y2={470 + Math.sin(a) * 70}
          stroke={i % 2 ? c.fill : c.edge}
          strokeWidth={5}
          strokeLinecap="round"
        />
      );
    })}
    <circle cx={1460} cy={470} r={24} fill={c.fill} />
    <circle cx={1300} cy={745} r={95} fill="#14110f" stroke={c.ink} strokeWidth={10} />
    <circle cx={1270} cy={715} r={22} fill="#ffffff" opacity={0.22} />
    <rect x={1287} y={640} width={26} height={34} fill={c.fill} />
  </>
);

const imposteur: Scene = (c) => (
  <>
    <Stars c={c} count={60} maxY={H * 0.4} color="#cfffff" />
    <Ridge c={c} base={H * 0.6} amp={90} color="#0c2c3a" />
    <Pines c={c} base={H * 0.7} count={26} minH={120} maxH={260} color="#082330" />
    <rect y={H * 0.6} width={W} height={160} fill="#bfefff" opacity={0.1} />
    <Ridge c={c} base={H * 0.82} amp={60} color="#041820" />
    <Pines c={c} base={H * 0.9} count={14} minH={160} maxH={300} color="#020d12" />
    <circle cx={1180} cy={600} r={150} fill={c.edge} opacity={0.12} />
    <line x1={1180} y1={626} x2={1180} y2={700} stroke={c.ink} strokeWidth={8} strokeLinecap="round" />
    <circle cx={1180} cy={610} r={26} fill={c.fill} />
  </>
);

const aventure: Scene = (c) => (
  <>
    <Stars c={c} count={70} maxY={H * 0.45} />
    <Moon cx={330} cy={220} r={110} color={c.fill} craters={c.ink} />
    <Ridge c={c} base={H * 0.66} amp={110} color="#14361f" />
    <Pines c={c} base={H * 0.74} count={18} minH={110} maxH={220} color="#0b2214" />
    <rect x={1040} y={H * 0.42} width={60} height={H * 0.44} fill="#0b1d12" />
    <rect x={1300} y={H * 0.42} width={60} height={H * 0.44} fill="#0b1d12" />
    <rect x={1080} y={H * 0.5} width={260} height={H * 0.36} fill="#0b1d12" />
    <polygon points="1040,378 1070,300 1100,378" fill="#0b1d12" />
    <polygon points="1300,378 1330,300 1360,378" fill="#0b1d12" />
    <circle cx={1210} cy={560} r={70} fill={c.edge} opacity={0.2} />
    <rect x={1204} y={520} width={12} height={40} fill={c.fill} />
    <Ridge c={c} base={H * 0.88} amp={40} color="#06140b" />
  </>
);

const loups: Scene = (c) => (
  <>
    <Stars c={c} count={90} maxY={H * 0.55} />
    <Moon cx={1240} cy={210} r={130} color={c.fill} craters={c.ink} />
    <Ridge c={c} base={H * 0.7} amp={60} color="#0d1a44" />
    <Houses c={c} base={H * 0.78} count={9} color="#070d24" windows={c.fill} />
    <Ridge c={c} base={H * 0.86} amp={30} color="#040814" />
    <Pines c={c} base={H * 0.92} count={10} minH={120} maxH={240} color="#02040c" />
  </>
);

const plusOuMoins: Scene = (c) => {
  const cx = 800;
  const cy = 900;
  const R = 560;
  const at = (deg: number, len = R) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + len * Math.cos(rad), cy - len * Math.sin(rad)] as const;
  };
  const [x120, y120] = at(120);
  const [x60, y60] = at(60);
  const [needleX, needleY] = at(80, 480);
  return (
    <>
      <Ridge c={c} base={H * 0.66} amp={70} color="#0c4a32" opacity={0.9} />
      <Ridge c={c} base={H * 0.8} amp={40} color="#07311f" />
      <path d={`M240 ${cy} A ${R} ${R} 0 0 1 1360 ${cy}`} fill="none" stroke={c.ink} strokeWidth={70} opacity={0.35} />
      <path d={`M240 ${cy} A ${R} ${R} 0 0 1 ${x120} ${y120}`} fill="none" stroke={c.edge} strokeWidth={56} />
      <path d={`M${x120} ${y120} A ${R} ${R} 0 0 1 ${x60} ${y60}`} fill="none" stroke={c.fill} strokeWidth={56} />
      <path d={`M${x60} ${y60} A ${R} ${R} 0 0 1 1360 ${cy}`} fill="none" stroke={c.edge} strokeWidth={56} />
      {Array.from({ length: 9 }, (_, i) => {
        const [x1, y1] = at(180 - i * 22.5, 440);
        const [x2, y2] = at(180 - i * 22.5, 500);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.fill} strokeWidth={6} opacity={0.7} />;
      })}
      <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={c.ink} strokeWidth={16} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={26} fill={c.fill} stroke={c.ink} strokeWidth={8} />
      <polygon points="300,190 360,260 325,260 325,330 275,330 275,260 240,260" fill={c.fill} opacity={0.9} />
      <polygon points="1300,400 1360,330 1325,330 1325,260 1275,260 1275,330 1240,330" fill={c.edge} opacity={0.9} />
    </>
  );
};

const plutotQui: Scene = (c) => (
  <>
    <circle cx={800} cy={520} r={250} fill={c.fill} opacity={0.92} />
    {[0, 1, 2, 3, 4].map((k) => (
      <rect key={k} x={500} y={430 + k * 60} width={600} height={10} fill={c.a} />
    ))}
    <Ridge c={c} base={620} amp={40} color={c.edge} opacity={0.45} />
    <Ridge c={c} base={700} amp={50} color={c.edge} opacity={0.6} />
    <Ridge c={c} base={780} amp={30} color={c.ink} opacity={0.35} />
    {(
      [
        [170, 0.9],
        [420, 1.05],
        [800, 1.15],
        [1180, 1.05],
        [1430, 0.9],
      ] as [number, number][]
    ).map(([x, s], i) => (
      <g key={i} fill={c.ink} opacity={0.8}>
        <circle cx={x} cy={H - 230 * s} r={52 * s} />
        <ellipse cx={x} cy={H} rx={110 * s} ry={170 * s} />
      </g>
    ))}
  </>
);

const president: Scene = (c) => (
  <>
    {[0, 1, 2, 3, 4, 5].map((i) => {
      const x = 160 + i * 260;
      return (
        <g key={i}>
          <rect x={x} y={160} width={60} height={H * 0.7 - 160} fill="#000" opacity={0.22} />
          <rect x={x - 16} y={140} width={92} height={24} fill={c.ink} opacity={0.4} />
        </g>
      );
    })}
    <polygon points={`800,0 600,${H * 0.8} 1000,${H * 0.8}`} fill={c.fill} opacity={0.12} />
    <Curtain a={0} b={200} bottom={H * 0.6} color={c.ink} folds={2} opacity={0.5} />
    <Curtain a={W} b={W - 200} bottom={H * 0.6} color={c.ink} folds={2} opacity={0.5} />
    <polygon points={`620,${H} 980,${H} 860,${H * 0.7} 740,${H * 0.7}`} fill={c.edge} opacity={0.8} />
    <rect x={720} y={560} width={160} height={170} fill={c.fill} />
    <rect x={700} y={540} width={200} height={26} fill={c.fill} />
    <circle cx={800} cy={620} r={34} fill={c.ink} opacity={0.25} />
    {[300, 1300].map((x, i) => (
      <g key={x}>
        <rect x={x} y={300} width={8} height={H * 0.7 - 300} fill={c.ink} opacity={0.6} />
        <polygon points={`${x + 8},300 ${x + 120},340 ${x + 8},380`} fill={i ? c.fill : c.edge} />
      </g>
    ))}
    <rect y={H * 0.7} width={W} height={H * 0.3} fill="#000" opacity={0.35} />
  </>
);

const promoteur: Scene = (c) => (
  <>
    <circle cx={1260} cy={600} r={260} fill={c.edge} opacity={0.12} />
    <circle cx={1260} cy={600} r={170} fill={c.edge} opacity={0.85} />
    <Skyline c={c} base={H * 0.7} minH={180} maxH={430} color="#06142a" windows={c.fill} />
    <rect x={380} y={170} width={22} height={H * 0.72 - 170} fill={c.fill} opacity={0.9} />
    <rect x={230} y={170} width={420} height={16} fill={c.fill} opacity={0.9} />
    <rect x={230} y={170} width={60} height={60} fill={c.ink} opacity={0.8} />
    <line x1={470} y1={186} x2={470} y2={330} stroke={c.fill} strokeWidth={4} />
    <rect x={452} y={330} width={36} height={36} fill={c.edge} />
    <Skyline c={c} base={H * 0.82} minH={90} maxH={260} color="#020a18" windows={c.fill} />
  </>
);

const rami51: Scene = (c) => (
  <>
    <ellipse cx={800} cy={980} rx={1250} ry={560} fill={c.a} opacity={0.55} />
    <ellipse cx={800} cy={980} rx={1250} ry={560} fill="none" stroke={c.ink} strokeWidth={36} opacity={0.5} />
    {[0, 1, 2, 3, 4].map((k) => (
      <circle key={`a${k}`} cx={760} cy={800 - k * 18} r={60} fill={c.fill} stroke={c.ink} strokeWidth={8} />
    ))}
    {[0, 1, 2, 3].map((k) => (
      <circle key={`b${k}`} cx={860} cy={800 - k * 18} r={60} fill={c.edge} stroke={c.ink} strokeWidth={8} />
    ))}
    {[-1, 0, 1].map((i) => (
      <g key={`l${i}`} transform={`translate(330 820) rotate(${-18 + (i + 1) * 12})`}>
        <rect x={-110} y={-150} width={220} height={300} rx={22} fill="#fbf7ef" stroke={c.ink} strokeWidth={8} />
        <polygon points="0,-60 40,-20 0,20 -40,-20" fill={c.edge} />
      </g>
    ))}
    {[-1, 0, 1].map((i) => (
      <g key={`r${i}`} transform={`translate(1270 820) rotate(${18 - (i + 1) * 12})`}>
        <rect x={-110} y={-150} width={220} height={300} rx={22} fill="#fbf7ef" stroke={c.ink} strokeWidth={8} />
        <circle cx={0} cy={-20} r={34} fill={c.fill} />
      </g>
    ))}
  </>
);

const reflexe: Scene = (c) => (
  <>
    <circle cx={800} cy={430} r={700} fill={c.fill} opacity={0.12} />
    {Array.from({ length: 60 }, (_, i) => {
      const angle = (i / 60) * Math.PI * 2 + span(c.r, -0.02, 0.02);
      const len = span(c.r, 500, 1000);
      return (
        <line
          key={i}
          x1={800}
          y1={430}
          x2={800 + Math.cos(angle) * len}
          y2={430 + Math.sin(angle) * len}
          stroke={i % 2 ? c.fill : c.edge}
          strokeWidth={span(c.r, 3, 12)}
          opacity={span(c.r, 0.15, 0.5)}
        />
      );
    })}
    {[180, 340, 520].map((r) => (
      <circle key={r} cx={800} cy={430} r={r} fill="none" stroke={c.edge} strokeWidth={6} opacity={0.25} />
    ))}
    <polygon points="1260,140 1190,270 1240,270 1200,400 1300,240 1248,240 1290,140" fill={c.fill} />
  </>
);

const tarot: Scene = (c) => {
  const pts = Array.from({ length: 7 }, (_, i): [number, number] => [
    300 + ((i * 173) % 1000) + span(c.r, -40, 40),
    120 + ((i * 97) % 400) + span(c.r, -30, 30),
  ]);
  return (
    <>
      <Stars c={c} count={140} maxY={H * 0.8} />
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={c.edge}
        strokeWidth={3}
        opacity={0.5}
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={5} fill={c.fill} />
      ))}
      <Moon cx={1280} cy={190} r={80} color={c.fill} craters={c.ink} />
      <path d="M560 900 V520 Q800 230 1040 520 V900" fill="none" stroke={c.fill} strokeWidth={6} opacity={0.45} />
      <polygon points={starPoints(800, 430, 60, 26)} fill={c.fill} opacity={0.9} />
      <ellipse cx={800} cy={900} rx={900} ry={160} fill={c.edge} opacity={0.25} />
    </>
  );
};

const association: Scene = (c) => (
  <>
    <Ridge c={c} base={640} amp={50} color="#0f7d75" opacity={0.8} />
    <Ridge c={c} base={760} amp={40} color="#0a5a55" />
    {Array.from({ length: 9 }, (_, i) => {
      const x = span(c.r, 120, 1480);
      const y = span(c.r, 90, 520);
      const w = span(c.r, 160, 280);
      const h = span(c.r, 90, 130);
      const color = pick(c.r, [c.fill, '#ffffff', c.edge]);
      return (
        <g key={i} opacity={0.92}>
          <rect x={x} y={y} width={w} height={h} rx={46} fill={color} />
          <path d={`M${x + 40} ${y + h} L${x + 60} ${y + h + 36} L${x + 90} ${y + h} Z`} fill={color} />
          {[0, 1, 2].map((k) => (
            <circle key={k} cx={x + 46 + k * 34} cy={y + h / 2} r={9} fill={c.ink} opacity={0.35} />
          ))}
        </g>
      );
    })}
    {Array.from({ length: 6 }, (_, i) => (
      <path
        key={i}
        d={sparkle(span(c.r, 80, 1520), span(c.r, 60, 700), span(c.r, 14, 26))}
        fill="#ffffff"
        opacity={0.8}
      />
    ))}
  </>
);

/** Banquise : mer froide, banquise en plaques et quelques flocons. */
const banquise: Scene = (c) => {
  const floes = Array.from({ length: 6 }, (_, i) => {
    const x = 60 + i * 260 + span(c.r, -40, 40);
    const w = span(c.r, 170, 280);
    const y = span(c.r, 700, 735);
    const lift = span(c.r, 22, 40);
    return (
      <path
        key={i}
        d={`M${x} ${y} L${x + w * 0.14} ${y - lift} L${x + w * 0.78} ${y - lift - 6} L${x + w} ${y} Z`}
        fill="#eaf8ff"
        stroke={c.edge}
        strokeWidth={4}
        strokeLinejoin="round"
      />
    );
  });
  return (
    <>
      <Stars c={c} count={40} maxY={420} />
      <Ridge c={c} base={640} amp={60} color="#bfe6ff" opacity={0.55} />
      <rect x={0} y={700} width={W} height={H - 700} fill="#0d4f78" />
      <path
        d="M0 728 Q100 712 200 728 T400 728 T600 728 T800 728 T1000 728 T1200 728 T1400 728 T1600 728 V770 H0 Z"
        fill="#1d6f9c"
        opacity={0.7}
      />
      {floes}
      {Array.from({ length: 14 }, (_, i) => (
        <circle
          key={i}
          cx={span(c.r, 0, W)}
          cy={span(c.r, 80, 600)}
          r={span(c.r, 2, 5)}
          fill="#ffffff"
          opacity={0.85}
        />
      ))}
      {Array.from({ length: 4 }, (_, i) => (
        <path
          key={i}
          d={sparkle(span(c.r, 120, 1480), span(c.r, 90, 380), span(c.r, 14, 24))}
          fill="#ffffff"
          opacity={0.8}
        />
      ))}
    </>
  );
};

/** Table de poker : tapis vert, jetons autour, cartes au centre. */
const poker: Scene = (c) => (
  <>
    <Stars c={c} count={60} maxY={H * 0.5} />
    <ellipse cx={800} cy={470} rx={640} ry={330} fill={c.ink} opacity={0.35} />
    <ellipse cx={800} cy={460} rx={600} ry={300} fill={c.a} opacity={0.9} />
    <ellipse cx={800} cy={460} rx={560} ry={265} fill="none" stroke={c.fill} strokeWidth={6} opacity={0.35} />
    {Array.from({ length: 16 }, (_, i) => {
      const angle = (i * Math.PI) / 8;
      const x = 800 + Math.cos(angle) * 660;
      const y = 460 + Math.sin(angle) * 350;
      return <circle key={i} cx={x} cy={y} r={span(c.r, 26, 40)} fill={i % 2 ? c.edge : c.fill} opacity={0.55} />;
    })}
    {[-1, 0, 1].map((i) => (
      <rect
        key={i}
        x={800 + i * 70 - 46}
        y={400 - (i === 0 ? 10 : 0)}
        width={92}
        height={130}
        rx={12}
        fill={c.fill}
        opacity={0.8}
        transform={`rotate(${i * 8} ${800 + i * 70} 465)`}
      />
    ))}
  </>
);

/** Décors génériques, pour les jeux sans décor dessiné (paquets, cartes, plateau, solo). */
/** Funambule : un chapiteau au crépuscule, deux projecteurs, un rideau rayé en haut et le public en bas. */
const funambule: Scene = (c) => {
  const cols = 16;
  const drape: ReactNode[] = [];
  for (let i = 0; i < cols; i++) {
    const x0 = (i * W) / cols;
    const x1 = ((i + 1) * W) / cols;
    drape.push(
      <path
        key={i}
        d={`M${x0} 0 L${x1} 0 L${x1} 120 Q${(x0 + x1) / 2} 176 ${x0} 120 Z`}
        fill={i % 2 ? c.fill : c.edge}
        opacity={0.2}
      />,
    );
  }
  const crowd: ReactNode[] = [];
  for (let i = 0; i < 34; i++) {
    const x = span(c.r, -20, W + 20);
    const r = span(c.r, 34, 58);
    const base = H - span(c.r, 0, 70);
    crowd.push(<circle key={`h${i}`} cx={x} cy={base - r * 2.1} r={r} />);
    crowd.push(<ellipse key={`b${i}`} cx={x} cy={base + r * 0.6} rx={r * 1.7} ry={r * 1.6} />);
  }
  return (
    <>
      <path d={`M0 0 L${W * 0.42} ${H * 0.96} L${W * 0.18} ${H * 0.96} Z`} fill={c.fill} opacity={0.07} />
      <path d={`M${W} 0 L${W * 0.58} ${H * 0.96} L${W * 0.82} ${H * 0.96} Z`} fill={c.fill} opacity={0.07} />
      <g>{drape}</g>
      <Stars c={c} count={36} maxY={H * 0.5} color={c.fill} />
      <g fill="#000" opacity={0.42}>
        {crowd}
      </g>
    </>
  );
};

/** Micro-Défis : une borne d'arcade au coucher du soleil, grille en perspective et soleil en halos. */
const microDefis: Scene = (c) => {
  const horizon = H * 0.6;
  const cx = W / 2;
  const grid: ReactNode[] = [];
  for (let i = -14; i <= 14; i++) {
    grid.push(<line key={`v${i}`} x1={cx + i * 8} y1={horizon} x2={cx + i * 260} y2={H} />);
  }
  for (let k = 1; k <= 9; k++) {
    const y = horizon + (H - horizon) * (k / 9) ** 2;
    grid.push(<line key={`h${k}`} x1={0} y1={y} x2={W} y2={y} />);
  }
  return (
    <>
      <Stars c={c} count={60} maxY={horizon - 60} />
      <circle cx={cx} cy={horizon} r={380} fill={c.fill} opacity={0.06} />
      <circle cx={cx} cy={horizon} r={270} fill={c.fill} opacity={0.1} />
      <circle cx={cx} cy={horizon} r={170} fill={c.fill} opacity={0.16} />
      <rect x={0} y={horizon} width={W} height={H - horizon} fill="#000" opacity={0.25} />
      <g stroke={c.edge} strokeWidth={3} opacity={0.32}>
        {grid}
      </g>
    </>
  );
};

/** Phrases à trous : des lignes à compléter au centre, des cartes éparpillées sous la phrase. */
const phrasesTrous: Scene = (c) => (
  <>
    <rect y={H * 0.8} width={W} height={H * 0.2} fill="#000" opacity={0.3} />
    {Array.from({ length: 4 }, (_, i) => (
      <line
        key={i}
        x1={W * 0.18}
        x2={W * 0.82}
        y1={H * (0.26 + i * 0.13)}
        y2={H * (0.26 + i * 0.13)}
        stroke={c.edge}
        strokeWidth={6}
        strokeDasharray="36 22"
        opacity={0.45}
      />
    ))}
    {Array.from({ length: 14 }, (_, i) => {
      const x = span(c.r, 60, W - 60);
      const y = span(c.r, H * 0.62, H * 0.9);
      const rot = span(c.r, -25, 25);
      return (
        <rect
          key={i}
          x={x}
          y={y}
          width={120}
          height={160}
          rx={18}
          fill={i % 2 ? c.fill : c.edge}
          opacity={0.22}
          transform={`rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})`}
        />
      );
    })}
  </>
);

const FALLBACK: Scene[] = [plutotQui, tarot, association, promoteur];

const SCENES: Record<string, Scene> = {
  'quiz-party': quizParty,
  'phrases-trous': phrasesTrous,
  'bombes-party': bombes,
  banquise,
  imposteur,
  'aventure-ia': aventure,
  'loups-village': loups,
  'plus-ou-moins': plusOuMoins,
  'plutot-qui': plutotQui,
  president,
  promoteur,
  'rami-51': rami51,
  reflexe,
  tarot,
  association,
  'poker-texas': poker,
  funambule,
  'micro-defis': microDefis,
};

/** Fond de scène du jeu, en SVG. À placer en premier enfant d'un conteneur positionné. */
export function GameScene({ gameId, name, className }: { gameId: string; name: string; className?: string }) {
  const spec = logoFor(gameId, name);
  const seed = hashText(gameId);
  const scene = SCENES[gameId] ?? FALLBACK[seed % FALLBACK.length]!;
  const skyId = `sky-${gameId.replace(/[^a-z0-9]/gi, '')}`;
  const ctx: Ctx = {
    a: spec.sky[0],
    b: spec.sky[1],
    fill: spec.fill,
    edge: spec.edge,
    ink: spec.ink,
    r: seeded(seed),
  };
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ctx.a} />
          <stop offset="1" stopColor={ctx.b} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${skyId})`} />
      {scene(ctx)}
    </svg>
  );
}

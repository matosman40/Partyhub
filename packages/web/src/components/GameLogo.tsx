import type { CSSProperties, ReactNode } from 'react';
import { logoFor, type LogoMark, type LogoSpec } from './gameLogos.js';

/**
 * Logo d’un jeu : titre en lettres épaisses avec relief, et une marque propre au jeu.
 * Le dessin est un SVG : il reste net à toutes les tailles et le texte n’est jamais déformé.
 */

const W = 640;
const H = 260;
const CX = W / 2;
const CY = H / 2;

/** Taille de police qui fait tenir un texte dans une largeur donnée (estimation, sans mesure). */
function fitSize(text: string, maxSize: number, maxWidth: number): number {
  const estimated = Math.max(1, text.length) * 0.56;
  return Math.min(maxSize, maxWidth / estimated);
}

function Mark({ mark, spec }: { mark: LogoMark; spec: LogoSpec }): ReactNode {
  const shape = { fill: spec.edge, stroke: spec.ink, strokeWidth: 9, strokeLinejoin: 'round' as const };
  switch (mark) {
    case 'bubble':
      return (
        <g>
          <path
            d="M 46 44 H 594 A 34 34 0 0 1 628 78 V 178 A 34 34 0 0 1 594 212 H 290 L 214 244 L 226 212 H 46 A 34 34 0 0 1 12 178 V 78 A 34 34 0 0 1 46 44 Z"
            {...shape}
          />
          <circle cx={596} cy={46} r={30} fill={spec.fill} stroke={spec.ink} strokeWidth={8} />
          <text
            x={596}
            y={58}
            textAnchor="middle"
            fontSize={40}
            fill={spec.ink}
            style={{ fontFamily: 'var(--display)' }}
          >
            ?
          </text>
        </g>
      );
    case 'fuse':
      return (
        <g fill="none" strokeLinecap="round">
          <path d="M 24 226 Q 190 262 320 220 T 616 196" stroke={spec.ink} strokeWidth={22} />
          <path d="M 24 226 Q 190 262 320 220 T 616 196" stroke={spec.edge} strokeWidth={9} strokeDasharray="2 14" />
          <circle cx={618} cy={190} r={22} fill={spec.fill} stroke={spec.ink} strokeWidth={8} />
          <circle cx={618} cy={190} r={8} fill="#fff" />
        </g>
      );
    case 'lens':
      return (
        <g>
          <circle cx={560} cy={78} r={50} fill="none" stroke={spec.ink} strokeWidth={22} />
          <circle cx={560} cy={78} r={50} fill="none" stroke={spec.edge} strokeWidth={10} />
          <path d="M 522 116 L 478 160" stroke={spec.ink} strokeWidth={24} strokeLinecap="round" />
          <path d="M 522 116 L 478 160" stroke={spec.edge} strokeWidth={10} strokeLinecap="round" />
        </g>
      );
    case 'moon':
      return (
        <g>
          <path d="M 120 36 A 62 62 0 1 0 120 160 A 48 48 0 1 1 120 36 Z" {...shape} />
          {[
            [520, 52],
            [572, 118],
            [480, 150],
          ].map(([x, y], i) => (
            <path
              key={i}
              d={`M ${x} ${y - 16} L ${x + 5} ${y - 5} L ${x + 16} ${y} L ${x + 5} ${y + 5} L ${x} ${y + 16} L ${x - 5} ${y + 5} L ${x - 16} ${y} L ${x - 5} ${y - 5} Z`}
              fill={spec.fill}
              stroke={spec.ink}
              strokeWidth={5}
            />
          ))}
        </g>
      );
    case 'arrows':
      return (
        <g>
          <polygon points="84,30 136,96 106,96 106,160 62,160 62,96 32,96" {...shape} />
          <polygon points="556,230 504,164 534,164 534,100 578,100 578,164 608,164" {...shape} />
        </g>
      );
    case 'crown':
      return (
        <g>
          <path d="M 200 96 L 236 36 L 280 84 L 320 22 L 360 84 L 404 36 L 440 96 Z" {...shape} />
          <rect x={200} y={96} width={240} height={22} rx={6} {...shape} />
        </g>
      );
    case 'skyline': {
      const blocks: [number, number, number][] = [
        [30, 196, 74],
        [112, 178, 62],
        [182, 206, 52],
        [452, 188, 70],
        [530, 202, 80],
      ];
      return (
        <g>
          {blocks.map(([x, y, w], i) => (
            <g key={i}>
              <rect x={x} y={y} width={w} height={240 - y} rx={6} {...shape} />
              <rect x={x + 14} y={y + 16} width={12} height={12} fill={spec.ink} />
              <rect x={x + w - 26} y={y + 16} width={12} height={12} fill={spec.ink} />
            </g>
          ))}
        </g>
      );
    }
    case 'deck':
      return (
        <g>
          {[-16, 0, 16].map((deg, i) => (
            <rect
              key={i}
              x={CX - 92}
              y={CY - 118}
              width={184}
              height={236}
              rx={20}
              fill={i === 1 ? '#ffffff' : spec.edge}
              stroke={spec.ink}
              strokeWidth={9}
              transform={`rotate(${deg} ${CX} ${CY})`}
            />
          ))}
        </g>
      );
    case 'bolt':
      return (
        <g>
          <polygon points="150,22 74,146 128,146 96,246 190,112 136,112 168,22" {...shape} />
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M ${500 + i * 22} ${60 + i * 46} L ${600 + i * 6} ${60 + i * 46}`}
              stroke={spec.edge}
              strokeWidth={12}
              strokeLinecap="round"
            />
          ))}
        </g>
      );
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 16; i++) {
        const r = i % 2 === 0 ? 150 : 100;
        const a = (Math.PI * i) / 8 - Math.PI / 2;
        pts.push(`${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`);
      }
      return <polygon points={pts.join(' ')} {...shape} opacity={0.9} />;
    }
    case 'duo':
      return (
        <g opacity={0.92}>
          <circle cx={216} cy={CY} r={112} {...shape} />
          <circle cx={424} cy={CY} r={112} {...shape} />
        </g>
      );
    case 'frame':
      return (
        <g fill="none">
          <rect x={18} y={14} width={W - 36} height={H - 28} rx={30} stroke={spec.edge} strokeWidth={8} />
          <rect
            x={34}
            y={30}
            width={W - 68}
            height={H - 60}
            rx={22}
            stroke={spec.edge}
            strokeWidth={3}
            strokeDasharray="10 10"
          />
        </g>
      );
  }
}

export function GameLogo({ gameId, name, className }: { gameId: string; name: string; className?: string }) {
  const spec = logoFor(gameId, name);
  const [first, second] = spec.lines;
  const two = second !== undefined && second !== '';
  const size1 = fitSize(first, two ? 150 : 170, 560);
  const size2 = two ? Math.min(size1 * 0.62, fitSize(second, 150, 470)) : 0;
  // Bloc du titre centré verticalement : on mesure la hauteur comme la somme des deux lignes.
  const blockH = size1 * 0.8 + (two ? size2 * 0.95 : 0);
  const baseline1 = CY - blockH / 2 + size1 * 0.8;
  const baseline2 = baseline1 + size2 * 0.95;

  const lineStyle: CSSProperties = { fontFamily: 'var(--display)', letterSpacing: '0.01em' };
  // Relief : copies décalées vers le bas, dans la couleur de l’encre, sous le titre.
  const title = (text: string, y: number, size: number) => (
    <g key={`${text}-${y}`}>
      {[14, 10, 6].map((dy) => (
        <text
          key={dy}
          x={CX}
          y={y + dy}
          textAnchor="middle"
          fontSize={size}
          fill={spec.ink}
          stroke={spec.ink}
          strokeWidth={14}
          strokeLinejoin="round"
          style={lineStyle}
        >
          {text}
        </text>
      ))}
      <text
        x={CX}
        y={y}
        textAnchor="middle"
        fontSize={size}
        fill={spec.fill}
        stroke={spec.ink}
        strokeWidth={14}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={lineStyle}
      >
        {text}
      </text>
    </g>
  );

  return (
    <svg
      className={`game-logo${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={name}
      focusable="false"
    >
      <g transform={`rotate(${spec.tilt} ${CX} ${CY})`}>
        <Mark mark={spec.mark} spec={spec} />
        {title(first, baseline1, size1)}
        {two && title(second, baseline2, size2)}
      </g>
    </svg>
  );
}

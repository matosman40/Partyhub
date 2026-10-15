import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AvatarsContext } from '../../client/avatar-context.js';
import { useCharacterPacks } from '../../client/character-packs.js';
import { drawSkin, packSkinFor, skinReady, type PackSkin } from '../../bombes-party/client/skins.js';
import { SPRITE_H } from '../../bombes-party/client/sprites.js';
import { actorLeft, boardLayout, drawBoard, drawShadow, drawSpriteActor, groundY } from './board.js';

/**
 * Scène de la banquise, commune à l'écran principal et au téléphone. Le plan est dessiné sur canvas
 * comme les niveaux 3D de Bomberman (vue de trois quarts, plaques avec leur face avant). Les personnages
 * sont les sprites de couleur de Bomberman, ou le personnage importé quand le joueur en a choisi un.
 * Les noms et l'éclaboussure restent en HTML, posés aux mêmes coordonnées que le canvas.
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

/** Traînées du vent, par-dessus le plan. */
const STREAKS = [
  { top: '18%', animationDelay: '0s' },
  { top: '34%', animationDelay: '0.35s' },
  { top: '50%', animationDelay: '0.7s' },
  { top: '26%', animationDelay: '0.5s' },
  { top: '42%', animationDelay: '0.2s' },
];

/** Variable CSS personnalisée, typée pour React. */
const cssVar = (name: string, value: string | number): CSSProperties => ({ [name]: value }) as CSSProperties;

function windText(wind: NonNullable<BanquiseView['wind']>): string {
  const side = wind.dir > 0 ? 'vers la droite' : 'vers la gauche';
  if (wind.phase === 'warning') return `Rafale ${side} dans un instant`;
  return `Vent ${side}`;
}

interface Shown {
  x: number;
  y: number;
  walkUntil: number;
}

export function BanquiseStage({ view, youId, label }: { view: BanquiseView; youId?: string; label: string }) {
  const avatars = useContext(AvatarsContext);
  const { packs } = useCharacterPacks();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markers = useRef(new Map<string, HTMLDivElement>());
  const shown = useRef(new Map<string, Shown>());
  const [cssWidth, setCssWidth] = useState(360);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setCssWidth(Math.max(200, Math.round(el.clientWidth || 360)));
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setCssWidth(Math.max(200, Math.round(w)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const L = useMemo(() => boardLayout(cssWidth), [cssWidth]);

  // Personnage importé de chaque joueur (par identifiant), lu par la boucle d'affichage.
  const skins = useMemo(() => {
    const map = new Map<string, PackSkin>();
    for (const b of view.bodies) {
      const skin = packSkinFor(avatars[b.name]?.character, packs);
      if (skin) map.set(b.playerId, skin);
    }
    return map;
  }, [view.bodies, avatars, packs]);

  const viewRef = useRef(view);
  viewRef.current = view;
  const layoutRef = useRef(L);
  layoutRef.current = L;
  const skinsRef = useRef(skins);
  skinsRef.current = skins;

  // Boucle d'affichage : la position suit le serveur en douceur, et les marqueurs HTML suivent le canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const v = viewRef.current;
      const LL = layoutRef.current;
      const dpr = window.devicePixelRatio || 1;
      const bw = Math.round(LL.width * dpr);
      const bh = Math.round(LL.height * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const ctx = canvas.getContext('2d');
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (ctx) {
        drawBoard(ctx, LL, v.ice, reduced ? 0 : now, dpr);
        const alive = v.bodies.filter((b) => b.x !== null && b.alive);
        const placed: Array<{ b: BanquiseBodyView; s: Shown; walking: boolean; step: number }> = [];
        for (const b of alive) {
          const target = b.x as number;
          let s = shown.current.get(b.playerId);
          if (!s) {
            s = { x: target, y: b.y, walkUntil: 0 };
            shown.current.set(b.playerId, s);
          }
          const k = reduced ? 1 : 1 - Math.exp(-dt * 22);
          const prevX = s.x;
          s.x += (target - s.x) * k;
          s.y += (b.y - s.y) * k;
          if (Math.abs(s.x - prevX) > 0.002) s.walkUntil = now + 160;
          placed.push({ b, s, walking: now < s.walkUntil, step: Math.floor(now / 140) % 2 });
        }
        for (const p of placed) {
          drawShadow(ctx, LL, {
            x: p.s.x,
            lift: Math.max(0, p.s.y),
            colorIndex: p.b.color,
            facing: p.b.facing,
            walking: p.walking,
            step: p.step,
          });
        }
        for (const p of placed) {
          const skin = skinsRef.current.get(p.b.playerId);
          const a = {
            x: p.s.x,
            lift: p.s.y,
            colorIndex: p.b.color,
            facing: p.b.facing,
            walking: p.walking,
            step: p.step,
          };
          if (skin && skinReady(skin)) {
            const bounce = p.walking && p.step ? LL.S : 0;
            const bottom = groundY(LL) - p.s.y * LL.T - bounce;
            drawSkin(ctx, skin, actorLeft(LL, p.s.x), bottom, (SPRITE_H + 1) * LL.S, p.b.facing < 0);
          } else {
            drawSpriteActor(ctx, LL, a);
          }
          const el = markers.current.get(p.b.playerId);
          if (el) {
            el.style.left = `${actorLeft(LL, p.s.x)}px`;
            el.style.top = `${groundY(LL) - p.s.y * LL.T}px`;
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const wind = view.wind && view.wind.phase !== 'calm' ? view.wind : null;
  const cls = ['ban-stage', `is-${view.phase}`, wind ? `wind-${wind.phase}` : ''].filter(Boolean).join(' ');
  const groundPx = groundY(L);

  return (
    <div
      ref={rootRef}
      className={cls}
      role="img"
      aria-label={label}
      style={{
        height: L.height,
        ...cssVar('--tile', `${L.T}px`),
        ...cssVar('--sprite-h', `${SPRITE_H * L.S}px`),
      }}
    >
      <canvas ref={canvasRef} className="ban-canvas" style={{ width: L.width, height: L.height }} aria-hidden="true" />

      {view.bodies.map((b) => {
        if (b.x === null) return null;
        if (!b.alive) {
          return (
            <span
              key={`splash-${b.playerId}`}
              className="ban-splash"
              aria-hidden="true"
              style={{ left: actorLeft(L, b.x), top: groundPx }}
            />
          );
        }
        const isYou = b.playerId === youId;
        return (
          <div
            key={b.playerId}
            ref={(el) => {
              if (el) markers.current.set(b.playerId, el);
              else markers.current.delete(b.playerId);
            }}
            className={`ban-actor${isYou ? ' is-you' : ''}${!b.grounded ? ' is-airborne' : ''}${b.y < -0.05 ? ' is-falling' : ''}`}
          >
            <span className="ban-name">{isYou ? 'Vous' : b.name}</span>
          </div>
        );
      })}

      <div className="ban-fx" aria-hidden="true">
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

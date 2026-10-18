import { useContext, useEffect, useMemo, useRef } from 'react';
import { play, type Sfx } from '../../client/audio.js';
import { AvatarsContext } from '../../client/avatar-context.js';
import { useCharacterPacks } from '../../client/character-packs.js';
import { packSkinFor, type PackSkin } from './skins.js';
import { diffEvents, type FxEvent } from './events.js';
import {
  burstParticles,
  cellOrigin,
  drawScene,
  frameFor,
  PLAYER_COLORS,
  textParticle,
  updateParticles,
  type BoardView,
  type Layout,
  type Particle,
} from './render.js';

/**
 * Plateau animé : canvas redessiné à chaque image, sons et particules déclenchés
 * par les événements reconstitués depuis les vues. Respecte la réduction de mouvement.
 */

const SOUND: Partial<Record<FxEvent['type'], Sfx>> = {
  place: 'place',
  blast: 'explode',
  crate: 'crate',
  die: 'die',
  pickup: 'pickup',
  hit: 'hit',
};

function playEvent(ev: FxEvent): void {
  if (ev.type === 'phase') {
    if (ev.phase === 'play') play('start');
    else if (ev.phase === 'round-over' && ev.winner) play('win');
    else if (ev.phase === 'final') play('final');
    return;
  }
  const sfx = SOUND[ev.type];
  if (sfx) play(sfx);
}

function spawnEvent(ev: FxEvent, L: Layout, list: Particle[], reduced: boolean): void {
  const n = (count: number) => (reduced ? Math.ceil(count / 3) : count);
  const center = (x: number, y: number) => {
    const o = cellOrigin(L, x, y);
    return { cx: o.x + L.T / 2, cy: o.y + L.tileD / 2 };
  };
  switch (ev.type) {
    case 'place': {
      const { cx, cy } = center(ev.x, ev.y);
      burstParticles(list, cx, cy, 'smoke', n(6), 'rgba(236,235,227,0.5)', 40, L.T * 0.25, 0.7);
      break;
    }
    case 'blast':
      for (const c of ev.cells) {
        const { cx, cy } = center(c.x, c.y);
        burstParticles(list, cx, cy, 'spark', n(7), '#ffe066', 180, 3, 0.45);
        burstParticles(list, cx, cy, 'spark', n(3), '#ff7a1a', 120, 2.5, 0.35);
      }
      for (const c of ev.cells.slice(0, 1)) {
        const { cx, cy } = center(c.x, c.y);
        burstParticles(list, cx, cy, 'ring', 1, '#ffe066', 0, L.T * 1.1, 0.35);
      }
      break;
    case 'crate': {
      const { cx, cy } = center(ev.x, ev.y);
      burstParticles(list, cx, cy, 'dust', n(12), '#f4cc86', 150, 3, 0.6);
      burstParticles(list, cx, cy, 'dust', n(6), '#b56d2d', 110, 2.5, 0.5);
      break;
    }
    case 'die': {
      const { cx, cy } = center(ev.x, ev.y);
      const color = PLAYER_COLORS[ev.color % PLAYER_COLORS.length] ?? '#ff4f8b';
      burstParticles(list, cx, cy, 'spark', n(32), color, 260, 4, 0.9);
      burstParticles(list, cx, cy, 'ring', 1, color, 0, L.T * 1.4, 0.5);
      textParticle(list, cx, cy - L.T * 0.5, 'KO', color, Math.round(L.T * 0.8), 1.2);
      break;
    }
    case 'score': {
      const { cx, cy } = center(ev.x, ev.y);
      const color = PLAYER_COLORS[ev.color % PLAYER_COLORS.length] ?? '#ffd23f';
      burstParticles(list, cx, cy, 'spark', n(24), '#ffd23f', 240, 3, 0.8);
      burstParticles(list, cx, cy, 'ring', 1, '#ffd23f', 0, L.T * 1.2, 0.5);
      textParticle(list, cx, cy - L.T * 0.8, ev.text, color, Math.round(L.T * 0.9), 1.6);
      break;
    }
    case 'slide': {
      const { cx, cy } = center(ev.x, ev.y);
      burstParticles(list, cx, cy, 'dust', n(5), 'rgba(236,235,227,0.6)', 60, 2.5, 0.35);
      break;
    }
    case 'hit': {
      const { cx, cy } = center(ev.x, ev.y);
      const color = PLAYER_COLORS[ev.color % PLAYER_COLORS.length] ?? '#ff4f8b';
      burstParticles(list, cx, cy, 'dust', n(14), color, 140, 3, 0.6);
      break;
    }
    case 'pickup': {
      const { cx, cy } = center(ev.x, ev.y);
      burstParticles(list, cx, cy, 'ring', 1, '#ecebe3', 0, L.T * 0.8, 0.4);
      burstParticles(list, cx, cy, 'spark', n(12), '#ffd23f', 200, 3, 0.5);
      break;
    }
    case 'phase':
      break;
  }
}

function shake(canvas: HTMLCanvasElement | null): void {
  const box = canvas?.parentElement;
  if (!box) return;
  box.classList.remove('shake');
  void box.offsetWidth;
  box.classList.add('shake');
  window.setTimeout(() => box.classList.remove('shake'), 320);
}

export function BoardCanvas({
  view,
  label = 'Plateau de jeu',
  sound = true,
  celebrate = 0,
  focus = null,
}: {
  view: BoardView;
  label?: string;
  sound?: boolean;
  /** Incrémenter pour lancer une pluie de confettis (fin de manche). */
  celebrate?: number;
  /**
   * Case suivie par la caméra (le personnage du téléphone). Sans lui, le niveau entier est affiché.
   */
  focus?: { x: number; y: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const viewRef = useRef<BoardView>(view);
  const prevRef = useRef<BoardView | null>(null);
  const particles = useRef<Particle[]>([]);
  const reduced = useRef(false);
  const lastCelebrate = useRef(0);

  // Personnage importé de chaque joueur, par identifiant. La boucle d’affichage lit la valeur courante.
  const avatars = useContext(AvatarsContext);
  const { packs } = useCharacterPacks();
  const skins = useMemo(() => {
    const map = new Map<string, PackSkin>();
    for (const u of view.units) {
      const skin = packSkinFor(avatars[u.name]?.character, packs);
      if (skin) map.set(u.playerId, skin);
    }
    return map;
  }, [view.units, avatars, packs]);
  const skinsRef = useRef(skins);
  skinsRef.current = skins;

  useEffect(() => {
    reduced.current = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    viewRef.current = view;
    const prev = prevRef.current;
    prevRef.current = view;
    if (!prev) return;
    const canvas = canvasRef.current;
    const L = frameFor(canvas?.clientWidth || 360, view.width, view.height, focusRef.current).L;
    for (const ev of diffEvents(prev, view)) {
      if (sound) playEvent(ev);
      spawnEvent(ev, L, particles.current, reduced.current);
      if (ev.type === 'blast' && !reduced.current) shake(canvas);
    }
  }, [view, sound]);

  useEffect(() => {
    if (celebrate === lastCelebrate.current) return;
    lastCelebrate.current = celebrate;
    if (celebrate <= 0) return;
    const canvas = canvasRef.current;
    const v = viewRef.current;
    const L = frameFor(canvas?.clientWidth || 360, v.width, v.height, focusRef.current).L;
    const colors =['#ff4f8b', '#5eead4', '#ffd23f', '#ecebe3', '#3247e0'];
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 200 + Math.random() * 380;
      particles.current.push({
        kind: 'confetti',
        x: L.width / 2 + (Math.random() - 0.5) * L.width * 0.3,
        y: L.height * 0.35,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 300,
        life: 2.6 + Math.random() * 1.4,
        max: 4,
        color: colors[i % colors.length] ?? '#ffd23f',
        size: 8 + Math.random() * 6,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
  }, [celebrate]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const drawFrame = (now: number) => {
      const canvas = canvasRef.current;
      const v = viewRef.current;
      if (!canvas || !v) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 360;
      const f = frameFor(cssW, v.width, v.height, focusRef.current);
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(f.viewH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      canvas.style.height = `${f.viewH}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dt = Math.min(0.05, (now - last) / 1000);
      updateParticles(particles.current, dt);
      const opts = { now, particles: particles.current, dpr, skins: skinsRef.current };
      if (f.camera) {
        // Caméra : seule la fenêtre du téléphone est dessinée, décalée sur le personnage.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, cssW, f.viewH);
        ctx.clip();
        ctx.translate(-f.camX, -f.camY);
        drawScene(ctx, f.L, v, opts);
        ctx.restore();
      } else {
        drawScene(ctx, f.L, v, opts);
      }
    };
    let reported = false;
    const frame = (now: number) => {
      // L’image suivante est planifiée avant de dessiner : une erreur de dessin ne fige jamais le plateau.
      raf = requestAnimationFrame(frame);
      try {
        drawFrame(now);
      } catch (err) {
        if (!reported) {
          reported = true;
          console.error('Plateau : erreur de dessin', err);
        }
      }
      last = now;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="board-canvas"
      style={{ width: '100%', display: 'block' }}
    />
  );
}

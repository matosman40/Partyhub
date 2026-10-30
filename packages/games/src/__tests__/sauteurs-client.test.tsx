import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PIXEL_PALETTE, PIXEL_TRANSPARENT, type CharacterSpec } from '@partyhub/shared';
import { createWorld, step } from '../sauteurs/engine.js';
import { LEVELS } from '../sauteurs/levels.js';
import { allArt, fromRows, slime } from '../sauteurs/client/art.js';
import {
  TILE_PX,
  clampCamera,
  computeCamera,
  easeCamera,
  followSet,
  indicatorFor,
  scaleBounds,
} from '../sauteurs/client/camera.js';
import {
  countdownLabel,
  formatSeconds,
  formatTicks,
  hudLayout,
  liveRanking,
  shortName,
} from '../sauteurs/client/hud.js';
import {
  KeyboardState,
  SENSOR_FRESH_MS,
  controlsToSample,
  keyRole,
  mergeInputs,
  sampleToInput,
} from '../sauteurs/client/input.js';
import { Particles } from '../sauteurs/client/particles.js';
import { SpriteCache, chooseSprite, footRow, halveBitmap, makeSprite, spriteKey } from '../sauteurs/client/sprites.js';
import { FixedStepper, MAX_STEPS_PER_FRAME, STEP_MS } from '../sauteurs/client/stepper.js';
import { racersFor } from '../sauteurs/client/RaceView.js';
import { SauteursHost, podiumPose, poseFor } from '../sauteurs/client/HostScreen.js';
import { SauteursPlayer } from '../sauteurs/client/PlayerScreen.js';
import type { SauteursPub } from '../sauteurs/client/types.js';

const SPEC: CharacterSpec = { body: 1, skin: 2, hair: 3, hairColor: 2, accessory: 4 };

describe('commandes : capteur -> PlayerInput', () => {
  it('lit x et energy avec les seuils de la spécification', () => {
    const at = 1000;
    expect(sampleToInput({ x: 1, y: 0, energy: 0, at }, at)).toEqual({ left: false, right: true, jump: false });
    expect(sampleToInput({ x: -1, y: 0, energy: 1, at }, at)).toEqual({ left: true, right: false, jump: true });
    expect(sampleToInput({ x: 0.5, y: 0, energy: 0.5, at }, at)).toEqual({ left: false, right: false, jump: false });
    expect(sampleToInput({ x: 0.51, y: 0, energy: 0.51, at }, at)).toEqual({ left: false, right: true, jump: true });
  });

  it('ignore un échantillon absent ou périmé', () => {
    expect(sampleToInput(undefined, 0)).toEqual({ left: false, right: false, jump: false });
    const old = { x: 1, y: 0, energy: 1, at: 0 };
    expect(sampleToInput(old, SENSOR_FRESH_MS - 1).right).toBe(true);
    expect(sampleToInput(old, SENSOR_FRESH_MS + 1)).toEqual({ left: false, right: false, jump: false });
  });

  it('réutilise l’objet de sortie (aucune allocation dans la boucle)', () => {
    const out = { left: true, right: true, jump: true };
    expect(sampleToInput(undefined, 0, out)).toBe(out);
    expect(out).toEqual({ left: false, right: false, jump: false });
  });

  it('les boutons du téléphone donnent l’échantillon attendu', () => {
    expect(controlsToSample({ left: false, right: false, jump: false })).toEqual({ x: 0, y: 0, energy: 0 });
    expect(controlsToSample({ left: false, right: true, jump: true })).toEqual({ x: 1, y: 0, energy: 1 });
    expect(controlsToSample({ left: true, right: false, jump: false })).toEqual({ x: -1, y: 0, energy: 0 });
    expect(controlsToSample({ left: true, right: true, jump: false }).x).toBe(0);
  });

  it('fusionne téléphone et clavier ; deux directions opposées s’annulent', () => {
    const out = { left: false, right: false, jump: false };
    mergeInputs({ left: false, right: true, jump: false }, { left: false, right: false, jump: true }, out);
    expect(out).toEqual({ left: false, right: true, jump: true });
    mergeInputs({ left: true, right: false, jump: false }, { left: false, right: true, jump: false }, out);
    expect(out.left || out.right).toBe(false);
  });

  it('clavier : flèches, WASD et espace', () => {
    expect(keyRole('ArrowLeft')).toBe('left');
    expect(keyRole('KeyD')).toBe('right');
    expect(keyRole('Space')).toBe('jump');
    expect(keyRole('KeyP')).toBeNull();
    const kb = new KeyboardState();
    const out = { left: false, right: false, jump: false };
    expect(kb.set('ArrowRight', true)).toBe(true);
    expect(kb.set('Space', true)).toBe(true);
    expect(kb.set('KeyP', true)).toBe(false);
    expect(kb.read(out)).toEqual({ left: false, right: true, jump: true });
    kb.set('ArrowLeft', true);
    expect(kb.read(out).right).toBe(false);
    kb.reset();
    expect(kb.read(out)).toEqual({ left: false, right: false, jump: false });
  });
});

describe('caméra', () => {
  const view = { viewW: 1920, viewH: 1080, levelW: 190, levelH: 18 };

  it('choisit des agrandissements entiers, bornés par la largeur d’écran', () => {
    expect(scaleBounds(1920)).toEqual({ min: 2, max: 5 });
    expect(scaleBounds(1280)).toEqual({ min: 1, max: 3 });
    expect(scaleBounds(100)).toEqual({ min: 1, max: 1 });
  });

  it('un seul coureur : zoom maximal, centré sur lui', () => {
    const p = { x: 50, y: 12 };
    const cam = computeCamera({ ...view, points: [p], leader: p, scale: 2 });
    expect(Number.isInteger(cam.scale)).toBe(true);
    expect(cam.scale).toBeGreaterThanOrEqual(4);
    expect(cam.cx).toBeCloseTo(50, 5);
  });

  it('plusieurs coureurs proches : tous à l’image', () => {
    const pts = [
      { x: 50, y: 12 },
      { x: 58, y: 10 },
      { x: 54, y: 12 },
    ];
    const cam = computeCamera({ ...view, points: pts, leader: pts[1]!, scale: 3 });
    const halfW = view.viewW / (TILE_PX * cam.scale) / 2;
    for (const p of pts) expect(Math.abs(p.x - cam.cx)).toBeLessThan(halfW);
  });

  it('dézoome tout de suite quand le peloton s’étire, et n’oscille pas à la limite', () => {
    const near = [
      { x: 50, y: 12 },
      { x: 56, y: 12 },
    ];
    const far = [
      { x: 50, y: 12 },
      { x: 90, y: 12 },
    ];
    const a = computeCamera({ ...view, points: near, leader: near[1]!, scale: 5 });
    const b = computeCamera({ ...view, points: far, leader: far[1]!, scale: a.scale });
    expect(b.scale).toBeLessThan(a.scale);
    // À la limite : une fois dézoomé, il faut un surplus de place pour regrimper.
    const edge = [
      { x: 50, y: 12 },
      { x: 50 + (1920 / (TILE_PX * 4) - 6) - 0.5, y: 12 },
    ];
    const stays = computeCamera({ ...view, points: edge, leader: edge[1]!, scale: 3 });
    expect(stays.scale).toBe(3);
  });

  it('s’ils sont trop loin, suit le premier et reste dans le niveau', () => {
    const pts = [
      { x: 5, y: 12 },
      { x: 150, y: 12 },
    ];
    const cam = computeCamera({ ...view, points: pts, leader: pts[1]!, scale: 2 });
    expect(cam.scale).toBe(2);
    expect(cam.cx).toBeGreaterThan(140);
    const tilesW = view.viewW / (TILE_PX * cam.scale);
    expect(cam.cx + tilesW / 2).toBeLessThanOrEqual(view.levelW + 1e-9);
  });

  it('ne laisse jamais voir au-delà des bords du niveau, et pose un niveau court en bas', () => {
    const c = clampCamera({ scale: 3, cx: 0, cy: 0 }, 1920, 1080, 190, 18);
    expect(c.cx).toBeCloseTo(1920 / (TILE_PX * 3) / 2, 5);
    const small = clampCamera({ scale: 2, cx: 5, cy: 5 }, 1920, 1080, 20, 10);
    expect(small.cx).toBe(10);
    expect(small.cy).toBeCloseTo(10 - 1080 / (TILE_PX * 2) / 2, 5);
  });

  it('suit les coureurs en course, sinon tous ; le premier est le plus à droite', () => {
    const set = followSet([
      { x: 10, y: 1, finished: false },
      { x: 30, y: 1, finished: true },
      { x: 20, y: 1, finished: false },
    ]);
    expect(set.points).toHaveLength(2);
    expect(set.leader?.x).toBe(20);
    expect(followSet([{ x: 5, y: 0, finished: true }]).leader?.x).toBe(5);
    expect(followSet([]).leader).toBeNull();
  });

  it('lisse le mouvement sans toucher à l’agrandissement', () => {
    const next = easeCamera({ scale: 3, cx: 0, cy: 0 }, { scale: 3, cx: 10, cy: 10 });
    expect(next.cx).toBeGreaterThan(0);
    expect(next.cx).toBeLessThan(10);
    expect(easeCamera({ scale: 3, cx: 0, cy: 0 }, { scale: 4, cx: 10, cy: 10 })).toEqual({ scale: 4, cx: 10, cy: 10 });
  });

  it('indicateurs hors champ : sur le bord, côté du coureur ; rien s’il est visible', () => {
    const cam = { scale: 3, cx: 100, cy: 10 };
    expect(indicatorFor({ x: 100, y: 10.5 }, cam, 1920, 1080, 60)).toBeNull();
    const right = indicatorFor({ x: 160, y: 10 }, cam, 1920, 1080, 60)!;
    expect(right.side).toBe('right');
    expect(right.x).toBeCloseTo(1860, 0);
    const left = indicatorFor({ x: 40, y: 10 }, cam, 1920, 1080, 60)!;
    expect(left.side).toBe('left');
    expect(left.x).toBeCloseTo(60, 0);
    expect(Math.hypot(left.dx, left.dy)).toBeCloseTo(1, 5);
    const down = indicatorFor({ x: 100, y: 40 }, cam, 1920, 1080, 60)!;
    expect(down.side).toBe('bottom');
    expect(down.y).toBeLessThanOrEqual(1020 + 1e-6);
  });
});

describe('interface (mise en page)', () => {
  it('texte de 28 px à 1080 p, proportionnel ensuite, jamais sous 16 px', () => {
    expect(hudLayout(1920, 1080, 8).font).toBe(28);
    expect(hudLayout(3840, 2160, 8).font).toBe(56);
    expect(hudLayout(320, 180, 8).font).toBe(16);
  });

  it('le classement de 8 joueurs tient dans l’écran, à droite, sans toucher le chronomètre', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [3840, 2160],
    ] as const) {
      const l = hudLayout(w, h, 8);
      expect(l.ranking.y + l.ranking.h).toBeLessThan(h);
      expect(l.ranking.x + l.ranking.w).toBeLessThanOrEqual(w);
      const timerRight = l.timer.cx + l.font * 4.5;
      expect(l.ranking.x).toBeGreaterThan(timerRight);
    }
    expect(hudLayout(1920, 1080, 3).ranking.h).toBeLessThan(hudLayout(1920, 1080, 8).ranking.h);
  });

  it('formate le temps', () => {
    expect(formatTicks(0)).toBe('0:00.0');
    expect(formatTicks(60 * 62 + 30)).toBe('1:02.5');
    expect(formatSeconds(63)).toBe('1,1 s');
  });

  it('classement en direct : arrivés dans l’ordre, puis par avancée', () => {
    const rows = liveRanking([
      { id: 'a', x: 10, finished: false, rank: null },
      { id: 'b', x: 99, finished: true, rank: 2 },
      { id: 'c', x: 50, finished: false, rank: null },
      { id: 'd', x: 98, finished: true, rank: 1 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('compte à rebours 3-2-1-GO synchronisé sur le départ', () => {
    expect(countdownLabel(3000)).toBe('3');
    expect(countdownLabel(2001)).toBe('3');
    expect(countdownLabel(2000)).toBe('2');
    expect(countdownLabel(1000)).toBe('1');
    expect(countdownLabel(1)).toBe('1');
    expect(countdownLabel(0)).toBe('GO !');
    expect(countdownLabel(-899)).toBe('GO !');
    expect(countdownLabel(-900)).toBeNull();
  });

  it('raccourcit les noms trop longs', () => {
    expect(shortName('Ana')).toBe('Ana');
    expect(shortName('Maximilienne-Sophie', 10)).toHaveLength(10);
    expect(shortName('Maximilienne-Sophie', 10).endsWith('…')).toBe(true);
  });
});

describe('sprites', () => {
  it('choisit l’image selon l’animation du moteur', () => {
    expect(chooseSprite('idle', 3)).toEqual({ kind: 'walk', frame: 0 });
    expect(chooseSprite('jump', 3)).toEqual({ kind: 'pose', pose: 'joie' });
    expect(chooseSprite('fall', 3)).toEqual({ kind: 'pose', pose: 'joie' });
    expect(chooseSprite('hurt', 3)).toEqual({ kind: 'pose', pose: 'defaite' });
    expect(chooseSprite('win', 3)).toEqual({ kind: 'pose', pose: 'victoire' });
    const seen = new Set<number>();
    for (let x = 0; x < 6; x += 0.05) {
      const c = chooseSprite('run', x);
      if (c.kind === 'walk') seen.add(c.frame);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('réduit un bitmap de moitié en gardant le contour', () => {
    const b = { width: 4, height: 4, pixels: new Uint8Array(16).fill(PIXEL_TRANSPARENT) };
    b.pixels[0] = 0;
    b.pixels[1] = 5;
    b.pixels[4] = 5;
    b.pixels[5] = 5;
    b.pixels[15] = 3; // un seul pixel opaque dans son bloc : disparaît
    const h = halveBitmap(b);
    expect([h.width, h.height]).toEqual([2, 2]);
    expect(h.pixels[0]).toBe(5);
    expect(h.pixels[3]).toBe(PIXEL_TRANSPARENT);
    b.pixels[5] = 0;
    expect(halveBitmap(b).pixels[0]).toBe(0);
  });

  it('un coureur réduit fait environ la taille de sa boîte, pieds en bas', () => {
    for (const choice of [
      { kind: 'walk', frame: 0 },
      { kind: 'walk', frame: 2 },
      { kind: 'pose', pose: 'joie' },
      { kind: 'pose', pose: 'defaite' },
    ] as const) {
      const art = makeSprite(SPEC, choice, false);
      expect(art.bitmap.width).toBe(16);
      expect(art.foot).toBeGreaterThan(8);
      expect(art.foot).toBe(footRow(art.bitmap));
      // Aucun pixel hors palette.
      for (const c of art.bitmap.pixels) expect(c === PIXEL_TRANSPARENT || c < PIXEL_PALETTE.length).toBe(true);
    }
    const right = makeSprite(SPEC, { kind: 'walk', frame: 1 }, false).bitmap;
    const left = makeSprite(SPEC, { kind: 'walk', frame: 1 }, true).bitmap;
    expect(left.pixels).not.toEqual(right.pixels);
  });

  it('cache : une image n’est fabriquée qu’une fois, et le cache est borné', () => {
    const cache = new SpriteCache<number>(3);
    let made = 0;
    const make = () => ++made;
    const key = spriteKey('spec', { kind: 'walk', frame: 1 }, true);
    expect(cache.get(key, make)).toBe(1);
    expect(cache.get(key, make)).toBe(1);
    expect(made).toBe(1);
    expect([cache.hits, cache.misses]).toEqual([1, 1]);
    for (let i = 0; i < 6; i++) cache.get(`k${i}`, make);
    expect(cache.size).toBe(3);
    expect(spriteKey('s', { kind: 'pose', pose: 'joie' }, true)).toBe(
      spriteKey('s', { kind: 'pose', pose: 'joie' }, false),
    );
    expect(spriteKey('s', { kind: 'walk', frame: 0 }, true)).not.toBe(
      spriteKey('s', { kind: 'walk', frame: 0 }, false),
    );
  });
});

describe('dessins du jeu', () => {
  it('chaque dessin n’utilise que les 16 couleurs de la palette (ou le transparent)', () => {
    const art = allArt();
    expect(art.length).toBeGreaterThan(40);
    for (const { name, bitmap } of art) {
      expect(bitmap.pixels.length, name).toBe(bitmap.width * bitmap.height);
      for (const c of bitmap.pixels) {
        if (c !== PIXEL_TRANSPARENT) expect(c, name).toBeLessThan(PIXEL_PALETTE.length);
      }
    }
  });

  it('les tuiles font 16 × 16 et les créatures ne sont pas vides', () => {
    for (const { name, bitmap } of allArt()) {
      if (name.includes('fond')) continue;
      if (name === 'soleil' || name === 'etincelle') continue;
      expect([bitmap.width, bitmap.height], name).toEqual([16, 16]);
    }
    for (const f of [0, 1] as const) {
      const s = slime(f);
      expect(s.pixels.some((c) => c !== PIXEL_TRANSPARENT)).toBe(true);
    }
  });

  it('un dessin en texte garde la même largeur à chaque ligne', () => {
    const p = fromRows(['k.', '.w']);
    expect([p.width, p.height]).toEqual([2, 2]);
    expect(Array.from(p.pixels)).toEqual([0, PIXEL_TRANSPARENT, PIXEL_TRANSPARENT, 1]);
  });

  it('les décors sont déterministes', () => {
    const a = allArt().find((x) => x.name === 'grotte-fond-0')!;
    const b = allArt().find((x) => x.name === 'grotte-fond-0')!;
    expect(Array.from(a.bitmap.pixels)).toEqual(Array.from(b.bitmap.pixels));
  });
});

describe('boucle à pas fixe et particules', () => {
  it('convertit des durées d’image variables en pas de 1/60 s', () => {
    const s = new FixedStepper();
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += s.push(1000 / 60);
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
    const slow = new FixedStepper();
    let n = 0;
    for (let i = 0; i < 30; i++) n += slow.push(1000 / 30);
    expect(n).toBeGreaterThanOrEqual(59);
  });

  it('plafonne le rattrapage après une longue pause', () => {
    const s = new FixedStepper();
    expect(s.push(10_000)).toBe(MAX_STEPS_PER_FRAME);
    expect(s.alpha).toBeLessThan(1);
    expect(s.push(STEP_MS * 0.4)).toBeLessThanOrEqual(1);
  });

  it('les particules vivent puis s’éteignent, sans dépasser le tampon', () => {
    const p = new Particles(4);
    for (let i = 0; i < 10; i++) p.spawn(0, 0, 1, 0, 3, 1);
    expect(p.alive).toBeLessThanOrEqual(4);
    let seen = 0;
    p.each(() => seen++);
    expect(seen).toBe(4);
    for (let i = 0; i < 4; i++) p.update();
    expect(p.alive).toBe(0);
  });
});

describe('moteur lu par l’écran', () => {
  it('le monde expose tout ce que le rendeur lit', () => {
    const w = createWorld(LEVELS[0]!, ['a', 'b']);
    const before = w.players[0]!.x;
    step(w, { a: { left: false, right: true, jump: false } });
    expect(w.players[0]!.x).toBeGreaterThan(before);
    expect(Array.isArray(w.events)).toBe(true);
    expect(w.coins.length).toBeGreaterThan(0);
    expect(w.players[0]!.coinTaken).toHaveLength(w.coins.length);
    expect(w.level.theme).toBe('prairie');
  });
});

const PUB: SauteursPub = {
  phase: 'ready',
  step: 1,
  levelCount: 3,
  levelIndex: null,
  level: null,
  countdownMs: 3000,
  startedAt: 0,
  endsAt: 0,
  betweenEndsAt: 0,
  players: [
    { id: 'p1', name: 'Ana', left: false },
    { id: 'p2', name: 'Bob', left: true },
  ],
  pending: [],
  submitted: [],
  arrivalOrder: [],
  levelResults: null,
  levelPoints: [],
  points: { p1: 120, p2: 40 },
  ranking: [
    { playerId: 'p1', name: 'Ana', points: 120, rank: 1 },
    { playerId: 'p2', name: 'Bob', points: 40, rank: 2 },
  ],
};

describe('écrans (rendu statique)', () => {
  it('salon : titre, joueurs présents et consigne', () => {
    const html = renderToStaticMarkup(<SauteursHost publicState={PUB} hostState={null} now={0} />);
    expect(html).toContain('Course des sauteurs');
    expect(html).toContain('Ana');
    expect(html).not.toContain('Bob');
    expect(html).toContain('<canvas');
  });

  it('course : un conteneur avec son canvas nommé, plein écran seulement pour la télé', () => {
    const pub = {
      ...PUB,
      phase: 'playing' as const,
      levelIndex: 0,
      startedAt: 1000,
      level: { id: 'prairie', name: 'Prairie', theme: 'prairie' as const, timeLimit: 90 },
    };
    const tv = renderToStaticMarkup(
      <SauteursHost publicState={pub} hostState={null} now={0} onAction={async () => ({ ok: true })} />,
    );
    expect(tv).toContain('sau-race is-tv');
    expect(tv).toContain('data-phase="playing"');
    expect(tv).toContain('role="img"');
    expect(tv).toContain('Course des sauteurs, niveau 1 sur 3');
    const spectator = renderToStaticMarkup(<SauteursHost publicState={pub} hostState={null} now={0} />);
    expect(spectator).toContain('is-embedded');
  });

  it('bilan : poses de victoire et de défaite, temps et points', () => {
    const pub: SauteursPub = {
      ...PUB,
      phase: 'between',
      levelResults: [
        { playerId: 'p1', name: 'Ana', finishTick: 3600, coins: 4, deaths: 1, rank: 1, points: 110 },
        { playerId: 'p2', name: 'Bob', finishTick: null, coins: 0, deaths: 3, rank: null, points: 0 },
      ],
    };
    const html = renderToStaticMarkup(<SauteursHost publicState={pub} hostState={null} now={0} />);
    expect(html).toContain('Niveau 1 sur 3 terminé');
    expect(html).toContain('Ana : arrivé 1e');
    expect(html).toContain('Bob : pas arrivé');
    expect(html).toContain('60,0 s');
    expect(html).toContain('pas arrivé');
    expect(html).toContain('+110');
  });

  it('poses du bilan et du podium : victoire au premier, joie aux arrivés, défaite aux autres', () => {
    const row = { playerId: 'a', name: 'A', coins: 0, deaths: 0, points: 0 };
    expect(poseFor({ ...row, finishTick: 100, rank: 1 })).toBe('victoire');
    expect(poseFor({ ...row, finishTick: 200, rank: 2 })).toBe('joie');
    expect(poseFor({ ...row, finishTick: null, rank: null })).toBe('defaite');
    expect([1, 2, 3, 4].map(podiumPose)).toEqual(['victoire', 'joie', 'joie', 'defaite']);
  });

  it('podium final', () => {
    const html = renderToStaticMarkup(
      <SauteursHost publicState={{ ...PUB, phase: 'final' }} hostState={null} now={0} />,
    );
    expect(html).toContain('Podium');
    expect(html).toContain('aria-label="Ana, 1er"');
    expect(html).toContain('120 pts');
  });

  it('manette : trois boutons nommés, zones de 64 px au moins, sprite du joueur', () => {
    const pub: SauteursPub = {
      ...PUB,
      phase: 'playing',
      levelIndex: 0,
      startedAt: 0,
      level: { id: 'prairie', name: 'Prairie', theme: 'prairie', timeLimit: 90 },
    };
    const html = renderToStaticMarkup(
      <SauteursPlayer
        publicState={pub}
        playerState={{ submitted: false, mine: null, points: 120, racing: true }}
        playerId="p1"
        now={0}
        send={async () => ({ ok: true })}
      />,
    );
    expect(html).toContain('aria-label="Courir à gauche"');
    expect(html).toContain('aria-label="Courir à droite"');
    expect(html).toContain('aria-label="Sauter (maintenir pour sauter plus haut)"');
    expect(html).toContain('Votre coureur');
    expect(html).toContain('120 pts');
    expect(html).toContain('Prairie');
  });

  it('manette hors course : attente, bilan personnel, fin', () => {
    const wait = renderToStaticMarkup(
      <SauteursPlayer publicState={PUB} playerState={null} playerId="p1" now={0} send={async () => ({ ok: true })} />,
    );
    expect(wait).toContain('Préparez-vous');
    expect(wait).not.toContain('Sauter');
    const between = renderToStaticMarkup(
      <SauteursPlayer
        publicState={{ ...PUB, phase: 'between' }}
        playerState={{
          submitted: true,
          mine: { finishTick: 3000, coins: 2, deaths: 0, rank: 1, points: 110 },
          points: 110,
          racing: false,
        }}
        playerId="p1"
        now={0}
        send={async () => ({ ok: true })}
      />,
    );
    expect(between).toContain('Arrivé 1er');
    expect(between).toContain('+110');
  });

  it('les coureurs viennent de la liste attendue par le serveur, avec leur personnage', () => {
    const racers = racersFor(
      PUB,
      { pending: [], pendingIds: [], expected: ['p2', 'p1', 'inconnu'], levelIndex: 0 },
      {
        Ana: { character: SPEC },
      },
    );
    expect(racers.map((r) => r.id)).toEqual(['p2', 'p1']);
    expect(racers[1]!.spec).toEqual(SPEC);
    expect(racers[0]!.spec).toBeTruthy();
    const fallback = racersFor({ ...PUB, players: PUB.players.map((p) => ({ ...p, left: false })) }, null, {});
    expect(fallback.map((r) => r.id)).toEqual(['p1', 'p2']);
  });
});

import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { HEIGHT, WIDTH, bombesParty, type BombesPartyState, type Bomb, type Unit } from '../bombes-party/module.js';
import { makeCtx, must } from './aventure-helpers.js';

/**
 * Plateau de type Bomberman : une grille de murs et de caisses, des personnages qui s’y déplacent
 * pas à pas, et des expressions sur place (danser, sourire). Ces tests suivent un personnage sur
 * le plateau, à travers les obstacles, puis vérifient les expressions et leur fin.
 */

const OPEN = Array.from({ length: HEIGHT }, (_, y) =>
  Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? '#' : '.')).join(
    '',
  ),
);

/** Remplace une case de la grille : `c` est le caractère (`#` mur, `x` caisse, `.` sol). */
function poser(grid: string[], x: number, y: number, c: string): string[] {
  return grid.map((row, yy) => (yy === y ? row.slice(0, x) + c + row.slice(x + 1) : row));
}

const ANA: PlayerRef = { id: 'a', name: 'Ana' };
const LEO: PlayerRef = { id: 'b', name: 'Léo' };

function unit(x: number, y: number, extra: Partial<Unit> = {}): Unit {
  return {
    x,
    y,
    alive: true,
    range: 2,
    maxBombs: 1,
    speed: 0,
    mount: null,
    facing: 'right',
    lastMoveAt: 0,
    carrying: null,
    lastRideAt: -1e9,
    emote: null,
    emoteUntil: 0,
    lastEmoteAt: -1e9,
    ...extra,
  };
}

function bomb(id: string, x: number, y: number): Bomb {
  return { id, x, y, owner: 'b', range: 2, endsAt: 1_000_000 + 2500 };
}

function playing(over: Partial<BombesPartyState> = {}): BombesPartyState {
  return {
    phase: 'play',
    settings: { rounds: 1 },
    round: 0,
    total: 1,
    grid: OPEN,
    players: { a: 'Ana', b: 'Léo' },
    points: { a: 0, b: 0 },
    units: { a: unit(1, 1), b: unit(WIDTH - 2, HEIGHT - 2) },
    bombs: [],
    flames: [],
    powerups: [],
    winnerId: null,
    endsAt: 0,
    seq: 0,
    ...over,
  };
}

/**
 * Horloge qu’on fait avancer à la main, et qui garde la trace des minuteurs demandés.
 * Un pas ne revient qu’après le délai minimal du jeu : chaque action avance donc de 300 ms.
 */
function horloge(debut = 1_000_000) {
  let t = debut;
  const minuteurs: Array<{ key: string; ms: number }> = [];
  const ctx: GameContext = {
    ...makeCtx(),
    now: () => t,
    schedule: (key: string, ms: number) => {
      minuteurs.push({ key, ms });
    },
  };
  return {
    ctx,
    minuteurs,
    avance(ms: number) {
      t += ms;
    },
  };
}

/** Un pas dans une direction, après 300 ms. Le pas doit aboutir ou être refusé sans erreur. */
function pas(s: BombesPartyState, h: ReturnType<typeof horloge>, id: PlayerRef, dir: string): BombesPartyState {
  h.avance(300);
  return must(bombesParty.handleAction!(s, id, 'move', { dir }, h.ctx));
}

describe('plateau bomberman : déplacement à travers la grille', () => {
  it('un personnage traverse un couloir, et les caisses, les murs et les bombes l’arrêtent', () => {
    // Caisse en (3, 1) : elle ferme la rangée du haut. Mur en (10, 3). Bombe en (9, 4).
    let grid = poser(OPEN, 3, 1, 'x');
    grid = poser(grid, 10, 3, '#');
    const h = horloge();
    let s = playing({ grid, bombs: [bomb('b1', 9, 4)], units: { a: unit(1, 1), b: unit(WIDTH - 2, HEIGHT - 2) } });

    s = pas(s, h, ANA, 'right');
    expect(s.units.a).toMatchObject({ x: 2, y: 1 });

    // La caisse arrête le pas : Ana reste en (2, 1) et tourne vers la caisse.
    s = pas(s, h, ANA, 'right');
    expect(s.units.a).toMatchObject({ x: 2, y: 1, facing: 'right' });

    s = pas(s, h, ANA, 'down');
    s = pas(s, h, ANA, 'down');
    expect(s.units.a).toMatchObject({ x: 2, y: 3 });

    // Sept pas vers la droite : le mur en (10, 3) s’arrête à (9, 3).
    for (let i = 0; i < 9; i++) s = pas(s, h, ANA, 'right');
    expect(s.units.a).toMatchObject({ x: 9, y: 3 });

    // La bombe en (9, 4) bloque le passage vers le bas, sans la pousser.
    s = pas(s, h, ANA, 'down');
    expect(s.units.a).toMatchObject({ x: 9, y: 3 });
    expect(s.bombs[0]).toMatchObject({ x: 9, y: 4 });
  });

  it('un long trajet traverse tout le plateau, du coin haut-gauche au coin bas-droit', () => {
    const h = horloge();
    let s = playing({ units: { a: unit(1, 1), b: unit(WIDTH - 2, HEIGHT - 2) } });
    for (let i = 0; i < WIDTH - 3; i++) s = pas(s, h, ANA, 'right');
    for (let i = 0; i < HEIGHT - 3; i++) s = pas(s, h, ANA, 'down');
    expect(s.units.a).toMatchObject({ x: WIDTH - 2, y: HEIGHT - 2 });
  });

  it('un pas pris trop tôt après le précédent est ignoré, sans erreur', () => {
    const h = horloge();
    let s = playing({});
    s = pas(s, h, ANA, 'right');
    // Pas immédiat : le personnage reste en place.
    s = must(bombesParty.handleAction!(s, ANA, 'move', { dir: 'right' }, h.ctx));
    expect(s.units.a).toMatchObject({ x: 2, y: 1 });
  });
});

describe('expressions sur place : danser et sourire', () => {
  it('danser et sourire sont des actions du plateau, et le téléphone les envoie comme les autres gestes', () => {
    expect(Object.keys(bombesParty.actions ?? {})).toEqual(expect.arrayContaining(['dance', 'smile']));
  });

  it('danser s’affiche sur le personnage, reste sur place, puis s’arrête seul après sa durée', () => {
    const h = horloge();
    const s = must(bombesParty.handleAction!(playing({}), ANA, 'dance', undefined, h.ctx));
    expect(s.units.a).toMatchObject({ x: 1, y: 1, emote: 'dance' });
    expect(h.minuteurs).toContainEqual({ key: 'emote:a', ms: 2400 });

    // Le minuteur arrive à son terme : l’expression s’arrête.
    h.avance(2400);
    const fin = bombesParty.onTimer!(s, 'emote:a', h.ctx);
    expect(fin.units.a?.emote).toBeNull();
  });

  it('sourire s’affiche, et le téléphone le voit dans sa vue privée', () => {
    const h = horloge();
    const s = must(bombesParty.handleAction!(playing({}), ANA, 'smile', undefined, h.ctx));
    expect(s.units.a?.emote).toBe('smile');
    expect(h.minuteurs).toContainEqual({ key: 'emote:a', ms: 1600 });
    expect(bombesParty.getPlayerState!(s, 'a')).toMatchObject({ emote: 'smile' });
    // Sur le plateau visible par tous, l’expression figure aussi.
    const vue = bombesParty.getPublicState!(s);
    expect(vue.units.find((u) => u.playerId === 'a')).toMatchObject({ emote: 'smile' });
  });

  it('une expression répétée trop vite est ignorée, sans changer la durée', () => {
    const h = horloge();
    const premiere = must(bombesParty.handleAction!(playing({}), ANA, 'dance', undefined, h.ctx));
    h.avance(100);
    const seconde = must(bombesParty.handleAction!(premiere, ANA, 'smile', undefined, h.ctx));
    expect(seconde.units.a).toMatchObject({ emote: 'dance', emoteUntil: premiere.units.a?.emoteUntil });
  });

  it('un pas interrompt l’expression en cours', () => {
    const h = horloge();
    let s = must(bombesParty.handleAction!(playing({}), ANA, 'dance', undefined, h.ctx));
    s = pas(s, h, ANA, 'right');
    expect(s.units.a).toMatchObject({ x: 2, y: 1, emote: null });
  });

  it('une expression plus récente n’est pas coupée par le minuteur de la précédente', () => {
    const h = horloge();
    let s = must(bombesParty.handleAction!(playing({}), ANA, 'dance', undefined, h.ctx));
    h.avance(700);
    s = must(bombesParty.handleAction!(s, ANA, 'smile', undefined, h.ctx));
    // Le minuteur de la danse arrive trop tôt pour le sourire : il reprogramme la fin au bon moment.
    h.minuteurs.length = 0;
    h.avance(1000);
    const encore = bombesParty.onTimer!(s, 'emote:a', h.ctx);
    expect(encore.units.a?.emote).toBe('smile');
    expect(h.minuteurs).toContainEqual({ key: 'emote:a', ms: expect.any(Number) });
  });

  it('une expression est refusée hors partie et pour un personnage éliminé', () => {
    const h = horloge();
    const prete = playing({ phase: 'ready' });
    expect(bombesParty.handleAction!(prete, ANA, 'dance', undefined, h.ctx).ok).toBe(false);

    const mort = playing({ units: { a: unit(1, 1, { alive: false }), b: unit(WIDTH - 2, HEIGHT - 2) } });
    expect(bombesParty.handleAction!(mort, ANA, 'smile', undefined, h.ctx).ok).toBe(false);
  });

  it('l’expression de Léo ne touche pas celle d’Ana', () => {
    const h = horloge();
    const s = must(bombesParty.handleAction!(playing({}), ANA, 'dance', undefined, h.ctx));
    expect(s.units.b?.emote ?? null).toBeNull();
    const avecLeo = must(bombesParty.handleAction!(s, LEO, 'smile', undefined, h.ctx));
    expect(avecLeo.units.a?.emote).toBe('dance');
    expect(avecLeo.units.b?.emote).toBe('smile');
  });
});

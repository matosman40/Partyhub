import { describe, expect, it } from 'vitest';
import type { PlayerRef } from '@partyhub/shared';
import { HEIGHT, WIDTH, bombesParty, type BombesPartyState, type Bomb, type Unit } from '../bombes-party/module.js';
import { makeCtx, must, PLAYERS } from './aventure-helpers.js';

/** Plateau vide entouré de murs : aucune caisse, aucun hasard. */
const OPEN = Array.from({ length: HEIGHT }, (_, y) =>
  Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? '#' : '.')).join(
    '',
  ),
);

const ANA: PlayerRef = { id: 'a', name: 'Ana' };

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

function bomb(id: string, x: number, y: number, owner = 'b'): Bomb {
  return { id, x, y, owner, range: 2, endsAt: 1_000_000 + 2500 };
}

/** Une manche en cours, avec les personnages et les bombes donnés. */
function playing(over: Partial<BombesPartyState>): BombesPartyState {
  return {
    phase: 'play',
    settings: { rounds: 1 },
    round: 0,
    total: 1,
    grid: OPEN,
    players: { a: 'Ana', b: 'Léo' },
    points: { a: 0, b: 0 },
    units: { a: unit(1, 1, { mount: 'kangaroo' }), b: unit(5, 5) },
    bombs: [],
    flames: [],
    powerups: [],
    winnerId: null,
    endsAt: 0,
    seq: 0,
    ...over,
  };
}

const ctx = makeCtx();

describe('kangourou monté', () => {
  it('soulève la bombe devant lui, et la bombe suit son porteur quand il avance', () => {
    let s = playing({ bombs: [bomb('b1', 2, 1)] });
    s = must(bombesParty.handleAction!(s, ANA, 'lift', undefined, ctx));
    expect(s.units.a?.carrying).toBe('b1');
    expect(s.bombs[0]).toMatchObject({ x: 1, y: 1 });

    s = must(bombesParty.handleAction!(s, ANA, 'move', { dir: 'right' }, ctx));
    expect(s.units.a).toMatchObject({ x: 2, y: 1, carrying: 'b1' });
    expect(s.bombs[0]).toMatchObject({ x: 2, y: 1 });
  });

  it('lance la bombe portée jusqu’à trois cases devant, puis la laisse tomber', () => {
    let s = playing({
      bombs: [bomb('b1', 1, 1)],
      units: { a: unit(1, 1, { mount: 'kangaroo', carrying: 'b1' }), b: unit(9, 9) },
    });
    s = must(bombesParty.handleAction!(s, ANA, 'throw', undefined, ctx));
    expect(s.units.a?.carrying).toBeNull();
    expect(s.bombs[0]).toMatchObject({ x: 4, y: 1 });
  });

  it('une caisse arrête la bombe lancée', () => {
    const grid = OPEN.map((row, y) => (y === 1 ? row.slice(0, 3) + 'x' + row.slice(4) : row));
    let s = playing({
      grid,
      bombs: [bomb('b1', 1, 1)],
      units: { a: unit(1, 1, { mount: 'kangaroo', carrying: 'b1' }), b: unit(9, 9) },
    });
    s = must(bombesParty.handleAction!(s, ANA, 'throw', undefined, ctx));
    expect(s.bombs[0]).toMatchObject({ x: 2, y: 1 });
  });

  it('frapper fait glisser la bombe jusqu’à quatre cases, sans traverser un personnage', () => {
    // Léo se tient en (5, 1) : la bombe glisse de (2, 1) à (4, 1).
    let s = playing({ bombs: [bomb('b1', 2, 1)], units: { a: unit(1, 1, { mount: 'kangaroo' }), b: unit(5, 1) } });
    s = must(bombesParty.handleAction!(s, ANA, 'kick', undefined, ctx));
    expect(s.bombs[0]).toMatchObject({ x: 4, y: 1 });
  });

  it('un geste sans bombe devant soi est refusé, et sans kangourou aussi', () => {
    const noBomb = playing({});
    expect(bombesParty.handleAction!(noBomb, ANA, 'lift', undefined, ctx).ok).toBe(false);

    const onFoot = playing({ units: { a: unit(1, 1), b: unit(9, 9) }, bombs: [bomb('b1', 2, 1)] });
    expect(bombesParty.handleAction!(onFoot, ANA, 'lift', undefined, ctx).ok).toBe(false);
    expect(bombesParty.handleAction!(onFoot, ANA, 'kick', undefined, ctx).ok).toBe(false);
  });

  it('une bombe ne se pousse plus en marchant : elle bloque le pas', () => {
    const s = playing({ bombs: [bomb('b1', 2, 1)] });
    const next = must(bombesParty.handleAction!(s, ANA, 'move', { dir: 'right' }, ctx));
    expect(next.units.a).toMatchObject({ x: 1, y: 1 });
    expect(next.bombs[0]).toMatchObject({ x: 2, y: 1 });
  });

  it('un coup de flamme absorbé par le kangourou fait tomber la bombe portée, sur place', () => {
    // Ana porte la bombe b2 en (1, 1) ; b1 explose en (2, 1) et touche Ana.
    let s = playing({
      bombs: [bomb('b1', 2, 1), bomb('b2', 1, 1, 'a')],
      units: { a: unit(1, 1, { mount: 'kangaroo', carrying: 'b2' }), b: unit(9, 9) },
    });
    s = bombesParty.onTimer!(s, 'bomb:b1', ctx);
    expect(s.units.a).toMatchObject({ alive: true, mount: null, carrying: null });
  });

  it('les kangourous sauvages apparaissent au début de chaque manche, hors des coins de départ', () => {
    const started = must(bombesParty.start!(bombesParty.initialize!({}, PLAYERS, ctx), ctx));
    const wild = started.powerups.filter((p) => p.kind === 'kangaroo');
    expect(wild).toHaveLength(2);
    const corners = [
      [1, 1],
      [WIDTH - 2, 1],
      [1, HEIGHT - 2],
      [WIDTH - 2, HEIGHT - 2],
    ];
    for (const p of wild) {
      expect(started.grid[p.y]?.[p.x]).toBe('.');
      for (const [cx, cy] of corners) {
        expect(Math.abs(p.x - cx!) + Math.abs(p.y - cy!)).toBeGreaterThan(2);
      }
    }
  });

  it('le téléphone reçoit les gestes possibles, et seul le kangourou monté propose les trois', () => {
    const s = playing({ bombs: [bomb('b1', 2, 1)] });
    expect(bombesParty.getPlayerState!(s, 'a')).toMatchObject({
      ride: { lift: true, kick: true, throw: false },
    });
    expect(bombesParty.getPlayerState!(s, 'b').ride).toMatchObject({ lift: false, kick: false, throw: false });
  });
});

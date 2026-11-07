import { describe, expect, it } from 'vitest';
import { MAX_POINTS, SCALE_KM, distanceKm, photoMystere, pointsFor, type PhotoState } from '../photo-mystere/module.js';
import { PHOTOS } from '../photo-mystere/photos.js';
import { A, B, C, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

const PARIS = { lat: 48.8566, lon: 2.3522 };
const LONDRES = { lat: 51.5074, lon: -0.1278 };

describe('distance et points', () => {
  it('mesure Paris–Londres à environ 344 km', () => {
    expect(distanceKm(PARIS, LONDRES)).toBeGreaterThan(335);
    expect(distanceKm(PARIS, LONDRES)).toBeLessThan(352);
  });

  it('donne le maximum pile sur la bonne place, puis décroît', () => {
    expect(pointsFor(0)).toBe(MAX_POINTS);
    expect(pointsFor(100)).toBeGreaterThan(pointsFor(1000));
    expect(pointsFor(1000)).toBeGreaterThan(pointsFor(5000));
    expect(pointsFor(SCALE_KM)).toBeGreaterThan(1800);
    expect(pointsFor(SCALE_KM)).toBeLessThan(1900);
  });

  it('reste positif et ne dépasse jamais le maximum, même loin', () => {
    expect(pointsFor(20_000)).toBeGreaterThanOrEqual(0);
    expect(pointsFor(20_000)).toBeLessThanOrEqual(MAX_POINTS);
  });
});

describe('banque de photos', () => {
  it('chaque photo a des coordonnées, une licence et un auteur', () => {
    expect(PHOTOS.length).toBeGreaterThanOrEqual(20);
    for (const p of PHOTOS) {
      expect(p.file, p.id).toMatch(/^\/photo-mystere\/.+\.jpg$/);
      expect(p.credit, p.id).not.toBe('');
      expect(p.license, p.id).not.toMatch(/NC|ND/);
    }
  });
});

describe('déroulé d’une partie', () => {
  function setup(rounds = 2) {
    const h = harness({ connected: [A.id, B.id, C.id] });
    let s = photoMystere.initialize({ rounds, guessSeconds: 60, enDirect: false }, [A, B, C], h.ctx);
    s = must(photoMystere.start(s, h.ctx));
    return { h, s };
  }

  it('demarre en phase de devinette, sans rien révéler', () => {
    const { s } = setup();
    expect(s.phase).toBe('guess');
    const pub = photoMystere.getPublicState(s) as Record<string, unknown>;
    expect(pub.answer).toBeNull();
    expect(pub.placements).toEqual([]);
    expect(pub.photo).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain(PHOTOS.find((p) => p.id === s.photos[0]!.id)!.place);
  });

  it('ne montre pas les points des autres joueurs pendant la devinette', () => {
    const { h, s } = setup();
    const r = photoMystere.handleAction(s, A, 'place', { lat: 48.8, lon: 2.3 }, h.ctx);
    const after = must(r);
    expect(after.phase).toBe('guess');
    const viewB = photoMystere.getPlayerState(after, B.id) as { myPin: unknown; placed: boolean };
    expect(viewB.myPin).toBeNull();
    expect(viewB.placed).toBe(false);
    const pub = photoMystere.getPublicState(after) as { placedCount: number; playerCount: number };
    expect(pub.placedCount).toBe(1);
    expect(pub.playerCount).toBe(3);
  });

  it('révèle quand tous les joueurs ont placé, et attribue les points selon la distance', () => {
    const { h, s } = setup();
    const target = { lat: s.photos[0]!.lat, lon: s.photos[0]!.lon };
    let st: PhotoState = s;
    st = must(photoMystere.handleAction(st, A, 'place', target, h.ctx));
    st = must(photoMystere.handleAction(st, B, 'place', { lat: target.lat + 20, lon: target.lon }, h.ctx));
    expect(st.phase).toBe('guess');
    st = must(photoMystere.handleAction(st, C, 'place', { lat: -target.lat, lon: target.lon + 90 }, h.ctx));
    expect(st.phase).toBe('reveal');
    expect(st.points[A.id]).toBe(MAX_POINTS);
    expect(st.points[B.id]).toBeGreaterThan(st.points[C.id]!);
    expect(st.rounds[0]!.placements[C.id]!.km).toBeGreaterThan(1000);
  });

  it('le minuteur révèle la manche et les absents ne marquent rien', () => {
    const { h, s } = setup();
    const target = { lat: s.photos[0]!.lat, lon: s.photos[0]!.lon };
    let st = must(photoMystere.handleAction(s, A, 'place', target, h.ctx));
    st = photoMystere.onTimer(st, 'guess-timeout', h.ctx);
    expect(st.phase).toBe('reveal');
    expect(st.points[B.id] ?? 0).toBe(0);
    expect(st.rounds[0]!.placements[B.id]!.km).toBeNull();
    const pub = photoMystere.getPublicState(st) as { answer: { place: string } | null };
    expect(pub.answer?.place).toBeTruthy();
  });

  it('enchaîne les manches puis termine la partie', () => {
    const { h, s } = setup(2);
    let st = s;
    st = photoMystere.onTimer(st, 'guess-timeout', h.ctx);
    st = photoMystere.onTimer(st, 'reveal-next', h.ctx);
    expect(st.phase).toBe('guess');
    expect(st.index).toBe(1);
    st = photoMystere.onTimer(st, 'guess-timeout', h.ctx);
    st = photoMystere.onTimer(st, 'reveal-next', h.ctx);
    expect(st.phase).toBe('final');
    expect(photoMystere.isFinished(st)).toBe(true);
    expect(st.rounds.length).toBe(2);
  });

  it('refuse une action hors devinette ou d’un inconnu', () => {
    const { h, s } = setup();
    const unknown = { id: 'x', name: 'Inconnu' };
    expect(photoMystere.handleAction(s, unknown, 'place', { lat: 0, lon: 0 }, h.ctx).ok).toBe(false);
    expect(photoMystere.handleAction(s, A, 'autre', {}, h.ctx).ok).toBe(false);
    const ready = photoMystere.initialize({ rounds: 1, guessSeconds: 60, enDirect: false }, [A], h.ctx);
    expect(photoMystere.handleAction(ready, A, 'place', { lat: 0, lon: 0 }, h.ctx).ok).toBe(false);
  });
});

describe('photos tirées en direct', () => {
  const neuve = {
    id: 'wd-Q1',
    place: 'mont Song',
    country: 'Chine',
    lat: 34.48,
    lon: 113.04,
    file: '/api/images-ouvertes?u=https%3A%2F%2Fupload.wikimedia.org%2Fx.jpg',
    credit: 'Auteur',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:X.jpg',
  };

  function lancer(rounds = 3) {
    const h = harness({ connected: [A.id, B.id] });
    const s = photoMystere.initialize({ rounds, guessSeconds: 60 }, [A, B], h.ctx);
    return { h, s: must(photoMystere.start(s, h.ctx)) };
  }

  it('passe par la préparation et demande un travail hors moteur', () => {
    const { s } = lancer();
    expect(s.phase).toBe('preparation');
    expect(s.direct).toBe('attente');
    expect(photoMystere.pendingJob?.(s)).toEqual({
      id: 'photos-en-direct',
      kind: 'photos-en-direct',
      input: { nombre: 3 },
    });
    expect(photoMystere.getPublicState(s).photo).toBeNull();
  });

  it('place les photos neuves en premier, et complète avec la banque locale', () => {
    const { h, s } = lancer(3);
    const next = photoMystere.completeJob!(s, 'photos-en-direct', { ok: true, value: [neuve] }, h.ctx);
    expect(next.phase).toBe('guess');
    expect(next.direct).toBe('pret');
    expect(next.photos).toHaveLength(3);
    expect(next.photos[0]?.place).toBe('Mont Song');
    expect(next.photos.slice(1).every((p) => PHOTOS.some((l) => l.id === p.id))).toBe(true);
    expect(photoMystere.pendingJob?.(next)).toBeNull();
  });

  it('reprend avec la banque locale si le réseau échoue ou si la réponse est invalide', () => {
    const { h, s } = lancer(2);
    const echec = photoMystere.completeJob!(s, 'photos-en-direct', { ok: false, error: 'délai dépassé' }, h.ctx);
    expect(echec.phase).toBe('guess');
    expect(echec.direct).toBe('secours');
    expect(echec.photos).toHaveLength(2);
    const invalide = photoMystere.completeJob!(s, 'photos-en-direct', { ok: true, value: [{ id: 'x' }] }, h.ctx);
    expect(invalide.direct).toBe('secours');
  });

  it('ignore un résultat qui arrive hors de la préparation', () => {
    const { h, s } = lancer();
    const pret = photoMystere.completeJob!(s, 'photos-en-direct', { ok: true, value: [neuve] }, h.ctx);
    expect(photoMystere.completeJob!(pret, 'photos-en-direct', { ok: true, value: [] }, h.ctx)).toBe(pret);
  });
});

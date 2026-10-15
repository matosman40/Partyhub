import { describe, expect, it } from 'vitest';
import { MODES, MODE_BY_ID, type ModeId } from '../boum/modes.js';
import { drawModes, eligibleModes, type CountValid } from '../boum/pool.js';
import { closestPoints, detectorPoints, quickPoints, rankStandings } from '../boum/scoring.js';

/** Générateur déterministe (mulberry32) : mêmes tirages à chaque exécution. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** BOUM ! : tirage des manches, éligibilité des modes, barèmes. */

const plenty: CountValid = () => 100;
const none: CountValid = () => 0;

describe('Éligibilité', () => {
  it('exclut le pack Humour noir quand il n’est pas activé', () => {
    const ids = eligibleModes({ players: 4, pack: false, corse: false }, plenty).map((m) => m.id);
    expect(ids.sort()).toEqual([
      'combien',
      'devine_chanson',
      'galerie_theme',
      'grimace',
      'le_mot_secret',
      'mime_metier',
      'ou_est_ce',
      'photo_defi',
      'reponse_rapide',
    ]);
  });

  it('exclut un mode dont la banque validée est insuffisante ou vide', () => {
    const onlyQuestions: CountValid = (type) => (type === 'question' ? 50 : 0);
    // « Vrai ou faux » n'a pas de banque : les joueurs écrivent, il reste tirable.
    expect(eligibleModes({ players: 4, pack: true, corse: false }, onlyQuestions).map((m) => m.id)).toEqual([
      'reponse_rapide',
      'vrai_ou_faux',
    ]);
    expect(eligibleModes({ players: 4, pack: true, corse: false }, none).map((m) => m.id)).toEqual(['vrai_ou_faux']);
  });

  it('exige au moins 3 joueurs pour le détecteur de mauvaise foi', () => {
    const two = eligibleModes({ players: 2, pack: true, corse: false }, plenty).map((m) => m.id);
    const three = eligibleModes({ players: 3, pack: true, corse: false }, plenty).map((m) => m.id);
    expect(two).not.toContain('detecteur');
    expect(three).toContain('detecteur');
  });

  it('exige 8 cartes réponse validées pour Main sale', () => {
    const fewCards: CountValid = (type) => (type === 'carte_reponse' ? 7 : 50);
    expect(eligibleModes({ players: 4, pack: true, corse: false }, fewCards).map((m) => m.id)).not.toContain(
      'main_sale',
    );
  });

  it('compte les niveaux corsé et limite selon la salle', () => {
    const seen: string[][] = [];
    const spy: CountValid = (_type, levels) => {
      seen.push([...levels]);
      return 100;
    };
    eligibleModes({ players: 4, pack: true, corse: true }, spy);
    expect(seen.some((levels) => levels.join(',') === 'doux,corse,limite')).toBe(true);
    seen.length = 0;
    eligibleModes({ players: 4, pack: false, corse: false }, spy);
    expect(seen.every((levels) => levels.join(',') === 'doux')).toBe(true);
  });
});

describe('Tirage des manches', () => {
  const all = MODES.map((m) => m.id);
  const eligibleAll = MODES.filter((m) => all.includes(m.id));

  it('tire le nombre de manches demandé', () => {
    expect(drawModes(eligibleAll, 5, mulberry32(1))).toHaveLength(5);
  });

  it('ne répète aucun mode tant que le pool éligible n’est pas épuisé', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const drawn = drawModes(eligibleAll, eligibleAll.length, mulberry32(seed));
      expect(new Set(drawn).size).toBe(eligibleAll.length);
    }
  });

  it('recharge le pool une fois épuisé', () => {
    const two = MODES.filter((m) => m.id === 'combien' || m.id === 'reponse_rapide');
    const drawn = drawModes(two, 5, mulberry32(3));
    expect(drawn).toHaveLength(5);
    expect(drawn.slice(0, 2).sort()).toEqual(['combien', 'reponse_rapide']);
  });

  it('alterne deux familles différentes quand il n’y a que deux modes de familles différentes', () => {
    const pair = [MODE_BY_ID.combien, MODE_BY_ID.main_sale];
    for (let seed = 1; seed <= 40; seed++) {
      const drawn = drawModes(pair, 5, mulberry32(seed));
      for (let i = 1; i < drawn.length; i++) {
        expect(MODE_BY_ID[drawn[i] as ModeId].family).not.toBe(MODE_BY_ID[drawn[i - 1] as ModeId].family);
      }
    }
  });

  it('couvre toutes les familles disponibles sur une partie de cinq manches', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const drawn = drawModes(MODES, 5, mulberry32(seed));
      const families = new Set(drawn.map((id) => MODE_BY_ID[id].family));
      expect(families.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('ne tire rien quand aucun mode n’est éligible', () => {
    expect(drawModes([], 5, mulberry32(1))).toEqual([]);
  });
});

describe('Barèmes', () => {
  it('Réponse rapide : 100, 70, 50, 30, puis rien', () => {
    expect(quickPoints(['a', 'b', 'c', 'd', 'e'])).toEqual({ a: 100, b: 70, c: 50, d: 30, e: 0 });
  });

  it('Combien ? : le plus proche 100, second 50, troisième 25', () => {
    const points = closestPoints(
      [
        { id: 'a', value: 40 },
        { id: 'b', value: 10 },
        { id: 'c', value: 25 },
        { id: 'd', value: 90 },
      ],
      42,
    );
    expect(points).toEqual({ a: 100, c: 50, b: 25, d: 0 });
  });

  it('Combien ? : à égalité, chacun reçoit le plus haut score des places partagées', () => {
    // Distances : 1, 3, 3 : B et C partagent les places 2 et 3, donc 50 chacun.
    const points = closestPoints(
      [
        { id: 'a', value: 11 },
        { id: 'b', value: 7 },
        { id: 'c', value: 13 },
      ],
      10,
    );
    expect(points).toEqual({ a: 100, b: 50, c: 50 });
  });

  it('Détecteur : moyenne des notes × 20, sans note 0, le plaideur ne compte pas', () => {
    expect(detectorPoints([5, 5, 5])).toBe(100);
    expect(detectorPoints([1, 2])).toBe(30);
    expect(detectorPoints([])).toBe(0);
    expect(detectorPoints([4, 3])).toBe(70);
  });

  it('Classement : à égalité de points, le plus de 5 étoiles passe devant', () => {
    const ranked = rankStandings([
      { id: 'a', name: 'Ana', points: 100, fiveStars: 1 },
      { id: 'b', name: 'Léo', points: 100, fiveStars: 3 },
      { id: 'c', name: 'Max', points: 50, fiveStars: 9 },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(['Léo', 'Ana', 'Max']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

import { describe, expect, it } from 'vitest';
import { sortHandByValue } from '../cards/client/common.js';
import { cartesCouleurs } from '../cards/presets.js';
import { sortHandByRank } from '../president/rules.js';

/**
 * Tri de la main par grandeur, pour l'affichage seulement : la liste reçue n'est pas modifiée.
 */
const card = (entry: string, uid = entry) => ({ uid, entry });

describe('Main triée par grandeur : jeu de cartes personnalisé', () => {
  it('range les chiffres du plus petit au plus grand, puis les actions et les jokers par points', () => {
    // Identifiants du paquet « Couleurs & chiffres » : rXX = rouge, j = jaune, v = vert, b = bleu.
    const hand = [card('wd4'), card('rsk'), card('r7'), card('j3'), card('b0'), card('v3'), card('wk'), card('rp2')];
    const sorted = sortHandByValue(cartesCouleurs, hand).map((c) => c.entry);
    expect(sorted).toEqual(['b0', 'j3', 'v3', 'r7', 'rsk', 'rp2', 'wk', 'wd4']);
  });

  it('ne modifie pas la main reçue', () => {
    const hand = [card('r7'), card('b0')];
    sortHandByValue(cartesCouleurs, hand);
    expect(hand.map((c) => c.entry)).toEqual(['r7', 'b0']);
  });

  it('garde les uid de chaque carte', () => {
    const hand = [card('r9', 'uid-1'), card('r2', 'uid-2')];
    expect(sortHandByValue(cartesCouleurs, hand)).toEqual([
      { uid: 'uid-2', entry: 'r2' },
      { uid: 'uid-1', entry: 'r9' },
    ]);
  });

  it('place une carte inconnue en dernier', () => {
    const hand = [card('inconnue'), card('r1')];
    expect(sortHandByValue(cartesCouleurs, hand).map((c) => c.entry)).toEqual(['r1', 'inconnue']);
  });
});

describe('Main triée par rang : Président', () => {
  it('range du plus faible (3) au plus fort (2), à rang égal par couleur', () => {
    // 3 de cœur avant 3 de trèfle, comme dans le paquet ; le 2 de pique est la carte la plus forte.
    const hand = [card('2s'), card('js'), card('3c'), card('10d'), card('3h')];
    expect(sortHandByRank(hand).map((c) => c.entry)).toEqual(['3h', '3c', '10d', 'js', '2s']);
  });

  it('ne modifie pas la main reçue', () => {
    const hand = [card('2s'), card('3h')];
    sortHandByRank(hand);
    expect(hand.map((c) => c.entry)).toEqual(['2s', '3h']);
  });
});

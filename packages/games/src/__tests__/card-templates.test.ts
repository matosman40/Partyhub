import { describe, expect, it } from 'vitest';
import { WILD_FAMILY, cardGameDefinitionSchema } from '@partyhub/shared';
import { cardGameTemplates } from '../cards/templates.js';
import { createCardGame } from '../cards/engine.js';

/** Chaque modèle livré doit être une définition valide, jouable telle quelle. */
describe('Modèles de jeux de cartes', () => {
  it('fournit des modèles aux identifiants uniques', () => {
    const ids = cardGameTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });

  for (const template of cardGameTemplates) {
    it(`« ${template.title} » est valide et se lance`, () => {
      const parsed = cardGameDefinitionSchema.safeParse(template.definition);
      expect(parsed.success, parsed.success ? '' : parsed.error.issues.map((i) => i.message).join(' / ')).toBe(true);
      const mod = createCardGame(template.definition, { id: `custom-${template.id}` });
      expect(mod.manifest.name).toBe(template.definition.name);
      // Autant de joueurs que la règle l'exige : le tarot en demande 3.
      const count = template.definition.rules.minPlayers;
      const players = Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Joueur ${i + 1}` }));
      const ctx = {
        now: () => 0,
        schedule: () => {},
        cancel: () => {},
        random: () => 0.31,
        connectedPlayerIds: () => players.map((p) => p.id),
      };
      const initial = mod.initialize(mod.defaultSettings, players, ctx);
      expect(mod.start(initial, ctx).ok).toBe(true);
    });
  }

  it('le jeu de 52 cartes contient 52 cartes distinctes, quatre couleurs', () => {
    const deck = cardGameTemplates.find((t) => t.id === 'jeu-52')!.definition;
    expect(deck.cards.reduce((n, c) => n + c.count, 0)).toBe(52);
    expect(deck.families).toHaveLength(4);
  });

  it('le tarot compte 78 cartes, dont 22 atouts', () => {
    const tarot = cardGameTemplates.find((t) => t.id === 'tarot')!.definition;
    expect(tarot.cards.reduce((n, c) => n + c.count, 0)).toBe(78);
    expect(tarot.cards.filter((c) => c.family === 'atout').reduce((n, c) => n + c.count, 0)).toBe(22);
  });

  it('les mémos ont des paires complètes', () => {
    for (const id of ['memo-animaux', 'memo-capitales']) {
      const def = cardGameTemplates.find((t) => t.id === id)!.definition;
      expect(def.rules.mechanic).toBe('memory');
      expect(def.cards.reduce((n, c) => n + c.count, 0) % 2).toBe(0);
    }
  });

  it('la ressemblance a assez de cartes pour distribuer et poser une carte au centre', () => {
    const def = cardGameTemplates.find((t) => t.id === 'ressemblance')!.definition;
    const total = def.cards.reduce((n, c) => n + c.count, 0);
    expect(def.rules.mechanic).toBe('race');
    expect(def.rules.matchOn).toBe('either');
    expect(total).toBeGreaterThanOrEqual(def.rules.maxPlayers * def.rules.handSize + 1);
    expect(total).toBeLessThanOrEqual(120);
    expect(def.cards.every((c) => c.effect === 'none' && c.family !== WILD_FAMILY)).toBe(true);
  });

  it('les plis se distribuent exactement, sans effet ni joker, et comptent 120 points', () => {
    const def = cardGameTemplates.find((t) => t.id === 'plis')!.definition;
    const total = def.cards.reduce((n, c) => n + c.count, 0);
    expect(def.rules.mechanic).toBe('trick');
    expect(total).toBe(32);
    expect(total).toBeGreaterThanOrEqual(def.rules.maxPlayers * def.rules.handSize);
    expect(def.rules.trump).toBeUndefined();
    expect(def.cards.every((c) => c.effect === 'none' && c.family !== WILD_FAMILY)).toBe(true);
    expect(def.cards.reduce((n, c) => n + c.count * c.points, 0)).toBe(120);
  });
});

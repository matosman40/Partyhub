import { describe, expect, it } from 'vitest';
import {
  CHARACTER_ACCESSORIES,
  CHARACTER_BODY_COLORS,
  CHARACTER_HAIR_COLORS,
  CHARACTER_HAIR_STYLES,
  CHARACTER_SKIN_TONES,
  characterColors,
  characterSchema,
  defaultCharacterFor,
} from '../characters.js';

const valid = { body: 0, skin: 0, hair: 0, hairColor: 0, accessory: 0 };

describe('Personnages : valeurs par défaut', () => {
  it('sont toujours valides et déterministes pour un même pseudo', () => {
    for (const name of ['Ana', 'Léo', '', 'a'.repeat(40), 'Zoé 🎉']) {
      const spec = defaultCharacterFor(name);
      expect(characterSchema.safeParse(spec).success).toBe(true);
      expect(defaultCharacterFor(name)).toEqual(spec);
    }
  });

  it('varient d’un pseudo à l’autre (pas tous identiques)', () => {
    const names = Array.from({ length: 60 }, (_, i) => `joueur${i}`);
    const distinct = new Set(names.map((n) => JSON.stringify(defaultCharacterFor(n))));
    expect(distinct.size).toBeGreaterThan(30);
  });

  it('utilisent toutes les couleurs de corps possibles sur un échantillon', () => {
    const bodies = new Set(Array.from({ length: 200 }, (_, i) => defaultCharacterFor(`p${i}`).body));
    expect(bodies.size).toBe(CHARACTER_BODY_COLORS.length);
  });
});

describe('Personnages : validation', () => {
  it('accepte un personnage dans les listes', () => {
    expect(characterSchema.safeParse(valid).success).toBe(true);
    const last = {
      body: CHARACTER_BODY_COLORS.length - 1,
      skin: CHARACTER_SKIN_TONES.length - 1,
      hair: CHARACTER_HAIR_STYLES.length - 1,
      hairColor: CHARACTER_HAIR_COLORS.length - 1,
      accessory: CHARACTER_ACCESSORIES.length - 1,
    };
    expect(characterSchema.safeParse(last).success).toBe(true);
  });

  it('refuse une valeur hors liste, négative, décimale ou absente', () => {
    expect(characterSchema.safeParse({ ...valid, body: CHARACTER_BODY_COLORS.length }).success).toBe(false);
    expect(characterSchema.safeParse({ ...valid, skin: -1 }).success).toBe(false);
    expect(characterSchema.safeParse({ ...valid, hair: 1.5 }).success).toBe(false);
    expect(characterSchema.safeParse({ ...valid, accessory: '2' }).success).toBe(false);
    const { hairColor: _omit, ...partial } = valid;
    expect(characterSchema.safeParse(partial).success).toBe(false);
  });

  it('n’accepte pas une couleur libre : seul un index est stocké', () => {
    expect(characterSchema.safeParse({ ...valid, body: '#ff0000' }).success).toBe(false);
  });
});

describe('Personnages : couleurs réelles', () => {
  it('résolvent les index en couleurs et styles', () => {
    const colors = characterColors({ body: 1, skin: 2, hair: 3, hairColor: 4, accessory: 5 });
    expect(colors.body).toBe(CHARACTER_BODY_COLORS[1]);
    expect(colors.skin).toBe(CHARACTER_SKIN_TONES[2]);
    expect(colors.hairStyle).toBe(CHARACTER_HAIR_STYLES[3]);
    expect(colors.hair).toBe(CHARACTER_HAIR_COLORS[4]);
    expect(colors.accessory).toBe(CHARACTER_ACCESSORIES[5]);
  });
});

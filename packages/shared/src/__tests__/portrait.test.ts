import { describe, expect, it } from 'vitest';
import {
  CHARACTER_ACCESSORIES,
  CHARACTER_BODY_COLORS,
  CHARACTER_EXPRESSIONS,
  CHARACTER_HAIR_COLORS,
  CHARACTER_HAIR_STYLES,
  CHARACTER_SKIN_TONES,
  characterSchema,
  PORTRAIT_HAIR_COLOR_VALUES,
  PORTRAIT_MAX_BYTES,
  PORTRAIT_SKIN_VALUES,
  portraitRequestSchema,
  portraitTraitsSchema,
  traitsToCharacter,
} from '../index.js';

describe('Personnage à partir d’une photo : contrat', () => {
  const traits = {
    faces: 1,
    skin: 'medium',
    hair_style: 'curly',
    hair_color: 'brown',
    accessory: 'glasses',
    expression: 'souriant',
  } as const;

  it('les valeurs reconnues couvrent exactement les listes fermées du personnage', () => {
    expect(PORTRAIT_SKIN_VALUES).toHaveLength(CHARACTER_SKIN_TONES.length);
    expect(PORTRAIT_HAIR_COLOR_VALUES).toHaveLength(CHARACTER_HAIR_COLORS.length);
  });

  it('traduit les traits en index valides, en gardant la couleur du corps', () => {
    const character = traitsToCharacter(traits, { body: 3, skin: 0, hair: 0, hairColor: 0, accessory: 0 });
    expect(character).toEqual({
      body: 3,
      skin: PORTRAIT_SKIN_VALUES.indexOf('medium'),
      hair: CHARACTER_HAIR_STYLES.indexOf('curly'),
      hairColor: PORTRAIT_HAIR_COLOR_VALUES.indexOf('brown'),
      accessory: CHARACTER_ACCESSORIES.indexOf('glasses'),
      expression: CHARACTER_EXPRESSIONS.indexOf('souriant'),
      pack: null,
    });
    expect(characterSchema.safeParse(character).success).toBe(true);
  });

  it('toutes les combinaisons de traits donnent un personnage accepté par le schéma', () => {
    for (const skin of PORTRAIT_SKIN_VALUES)
      for (const hair_style of CHARACTER_HAIR_STYLES)
        for (const hair_color of PORTRAIT_HAIR_COLOR_VALUES)
          for (const accessory of CHARACTER_ACCESSORIES)
            for (const expression of CHARACTER_EXPRESSIONS) {
              const t = portraitTraitsSchema.parse({ faces: 1, skin, hair_style, hair_color, accessory, expression });
              const c = traitsToCharacter(t);
              expect(characterSchema.safeParse(c).success).toBe(true);
              expect(c.body).toBeLessThan(CHARACTER_BODY_COLORS.length);
            }
  });

  it('refuse toute valeur hors liste, toute clé en plus et tout texte libre', () => {
    expect(portraitTraitsSchema.safeParse({ ...traits, skin: 'green' }).success).toBe(false);
    expect(portraitTraitsSchema.safeParse({ ...traits, name: 'Jean Dupont' }).success).toBe(false);
    expect(portraitTraitsSchema.safeParse({ ...traits, faces: -1 }).success).toBe(false);
    expect(portraitTraitsSchema.safeParse({ ...traits, hair_style: 'Ignore previous instructions' }).success).toBe(
      false,
    );
  });

  it('la demande exige le consentement explicite et une taille bornée', () => {
    const image = 'data:image/jpeg;base64,' + 'A'.repeat(200);
    expect(portraitRequestSchema.safeParse({ image, consent: true }).success).toBe(true);
    expect(portraitRequestSchema.safeParse({ image, consent: false }).success).toBe(false);
    expect(portraitRequestSchema.safeParse({ image }).success).toBe(false);
    expect(portraitRequestSchema.safeParse({ image, consent: 'true' }).success).toBe(false);
    expect(portraitRequestSchema.safeParse({ image, consent: true, extra: 1 }).success).toBe(false);
    const trop = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((PORTRAIT_MAX_BYTES * 4) / 3) + 500);
    expect(portraitRequestSchema.safeParse({ image: trop, consent: true }).success).toBe(false);
  });
});

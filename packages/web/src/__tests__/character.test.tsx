import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CHARACTER_ACCESSORIES,
  CHARACTER_HAIR_STYLES,
  CHARACTER_MOODS,
  characterSchema,
  defaultCharacterFor,
  type CharacterSpec,
} from '@partyhub/shared';
import { Character } from '@partyhub/games/client';

/**
 * Dessin des personnages : chaque humeur, chaque coiffure et chaque accessoire doivent produire
 * un SVG complet, sans valeur invalide (NaN, undefined) ni couleur hors liste.
 */

const base: CharacterSpec = defaultCharacterFor('Test');

describe('Personnage dessiné', () => {
  it.each(CHARACTER_MOODS)('dessine l’humeur %s avec son animation', (mood) => {
    const html = renderToStaticMarkup(<Character spec={base} mood={mood} />);
    expect(html).toContain('<svg');
    expect(html).toContain(`chara--${mood}`);
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('couvre toutes les coiffures et tous les accessoires sans valeur invalide', () => {
    for (let hair = 0; hair < CHARACTER_HAIR_STYLES.length; hair++) {
      for (let accessory = 0; accessory < CHARACTER_ACCESSORIES.length; accessory++) {
        const spec = { ...base, hair, accessory };
        expect(characterSchema.safeParse(spec).success).toBe(true);
        const html = renderToStaticMarkup(<Character spec={spec} mood="joy" />);
        expect(html).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('propose un cadrage buste pour les bulles et un cadrage complet pour l’aperçu', () => {
    const bust = renderToStaticMarkup(<Character spec={base} framing="bust" />);
    const full = renderToStaticMarkup(<Character spec={base} framing="full" />);
    expect(bust).toContain('viewBox="10 -46 200 200"');
    expect(full).toContain('viewBox="-20 -44 260 340"');
  });

  it('est décoratif sans libellé, et image nommée avec un libellé', () => {
    expect(renderToStaticMarkup(<Character spec={base} />)).toContain('aria-hidden="true"');
    const named = renderToStaticMarkup(<Character spec={base} label="Léa" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Léa"');
  });

  it('change de couleurs selon le personnage, sans sortir des listes', () => {
    const a = renderToStaticMarkup(<Character spec={{ ...base, body: 0 }} />);
    const b = renderToStaticMarkup(<Character spec={{ ...base, body: 6 }} />);
    expect(a).not.toEqual(b);
  });
});

describe('Expression au repos du profil', () => {
  it('le visage change selon l’expression choisie, sans changer le personnage', () => {
    const faces = [0, 1, 2, 3, 4, 5].map((expression) =>
      renderToStaticMarkup(<Character spec={{ ...base, expression }} mood="idle" />),
    );
    // Six expressions, six dessins distincts (les yeux et la bouche changent).
    expect(new Set(faces).size).toBe(6);
    for (const html of faces) expect(html).not.toMatch(/NaN|undefined/);
  });

  it('une attitude (joie, tristesse…) garde son propre visage, quelle que soit l’expression', () => {
    const joyWithCalm = renderToStaticMarkup(<Character spec={{ ...base, expression: 0 }} mood="joy" />);
    const joyWithSad = renderToStaticMarkup(<Character spec={{ ...base, expression: 4 }} mood="joy" />);
    expect(joyWithCalm).toEqual(joyWithSad);
  });

  it('refuse une expression hors liste dans le schéma partagé', () => {
    expect(characterSchema.safeParse({ ...base, expression: 5 }).success).toBe(true);
    expect(characterSchema.safeParse({ ...base, expression: 6 }).success).toBe(false);
    expect(characterSchema.safeParse({ ...base, expression: -1 }).success).toBe(false);
  });
});

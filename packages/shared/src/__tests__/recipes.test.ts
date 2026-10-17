import { describe, expect, it } from 'vitest';
import {
  BLOCK_RULES,
  DEFAULT_SCREENS,
  RECIPE_IDS,
  SCREEN_BLOCKS,
  recipeDefinitionSchema,
  resolveRules,
  resolveScreen,
} from '../recipes.js';

const base = {
  recipe: 'vote-sur-consigne',
  name: 'Le plus…',
  consignes: ['Le plus bizarre', 'Le plus rapide'],
};

function issuesOf(value: unknown): string[] {
  const parsed = recipeDefinitionSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`);
}

describe('définition d’une recette (format 3)', () => {
  it('une définition minimale est valide, et prend ses règles par défaut', () => {
    const def = recipeDefinitionSchema.parse(base);
    expect(def.recipe).toBe('vote-sur-consigne');
    expect(resolveRules(def)).toEqual({ manches: 5, ecriture: 40, vote: 25, pointsParVote: 100, motMax: 24 });
    expect(def.icon).toBe('💭');
  });

  it('refuse toute clé inconnue, à chaque niveau (pas de champ ignoré en silence)', () => {
    expect(issuesOf({ ...base, script: 'alert(1)' }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, rules: { manches: 2, bonus: true } }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, ai: { theme: 'années 80', mot: 'x' } }).length).toBeGreaterThan(0);
  });

  it('refuse une recette inconnue, et un jeu sans consigne', () => {
    expect(issuesOf({ ...base, recipe: 'inconnue' }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, consignes: [] }).length).toBeGreaterThan(0);
  });

  it('borne les règles', () => {
    expect(issuesOf({ ...base, rules: { manches: 11 } }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, rules: { ecriture: 5 } }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, rules: { motMax: 60 } }).length).toBeGreaterThan(0);
  });

  it('accepte une disposition d’écran valide et la reprend', () => {
    const def = recipeDefinitionSchema.parse({
      ...base,
      ecrans: {
        tv: { ecriture: ['titre', 'consigne', 'attente'] },
        joueur: { ecriture: ['consigne', 'saisie-texte'] },
      },
    });
    expect(resolveScreen(def, 'tv', 'ecriture')).toEqual(['titre', 'consigne', 'attente']);
    expect(resolveScreen(def, 'joueur', 'ecriture')).toEqual(['consigne', 'saisie-texte']);
    // Phase non décrite : la disposition par défaut s'applique.
    expect(resolveScreen(def, 'tv', 'resultat')).toEqual(DEFAULT_SCREENS.tv.resultat);
  });

  it('refuse un bloc de téléphone sur l’écran principal, avec son chemin', () => {
    const issues = issuesOf({ ...base, ecrans: { tv: { ecriture: ['saisie-texte'] } } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('ecrans.tv.ecriture.0');
    expect(issues[0]).toContain('ne s’affiche pas sur l’écran principal');
  });

  it('refuse un bloc hors de sa phase', () => {
    const issues = issuesOf({ ...base, ecrans: { joueur: { resultat: ['saisie-texte'] } } });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).toContain('ne s’affiche pas pendant la phase « resultat »');
  });

  it('refuse un bloc qui n’existe pas dans la liste fermée (photo, capteur…)', () => {
    expect(issuesOf({ ...base, ecrans: { joueur: { ecriture: ['photo'] } } }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, ecrans: { tv: { ecriture: ['capteur-secousse'] } } }).length).toBeGreaterThan(0);
  });

  it('accepte les besoins d’appareils déclarés, et refuse les autres', () => {
    expect(issuesOf({ ...base, appareils: { mouvement: 'facultatif' } })).toEqual([]);
    expect(issuesOf({ ...base, appareils: { mouvement: 'peut-être' } }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, appareils: { gyroscope: 'requis' } }).length).toBeGreaterThan(0);
  });

  it('les consignes de l’IA gardent un thème court et un nombre borné', () => {
    expect(issuesOf({ ...base, ai: { theme: 'x' } }).length).toBeGreaterThan(0);
    expect(issuesOf({ ...base, ai: { theme: 'années 80', nombre: 50 } }).length).toBeGreaterThan(0);
    const def = recipeDefinitionSchema.parse({ ...base, ai: { theme: 'années 80' } });
    expect(def.ai?.nombre).toBe(6);
  });
});

describe('vocabulaire fermé', () => {
  it('chaque bloc a une règle de placement', () => {
    for (const block of SCREEN_BLOCKS) {
      expect(BLOCK_RULES[block].roles.length).toBeGreaterThan(0);
      expect(BLOCK_RULES[block].phases.length).toBeGreaterThan(0);
    }
  });

  it('la disposition par défaut ne contient que des blocs permis à sa place', () => {
    for (const role of ['tv', 'joueur'] as const) {
      for (const [phase, blocks] of Object.entries(DEFAULT_SCREENS[role])) {
        for (const block of blocks ?? []) {
          expect(BLOCK_RULES[block].roles).toContain(role);
          expect(BLOCK_RULES[block].phases).toContain(phase);
        }
      }
    }
  });

  it('une seule recette est connue pour l’instant', () => {
    expect(RECIPE_IDS).toEqual(['vote-sur-consigne']);
  });
});

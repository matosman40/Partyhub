import { z } from 'zod';

/**
 * Recettes du format .phgame 3 : des règles déclaratives qu'un moteur connu exécute, sans code de paquet.
 * Chaque recette a un nom fixe ; ses règles, ses textes et ses écrans viennent du paquet. Le vocabulaire
 * (recettes, phases, blocs d'écran) est fermé et versionné : ajouter une valeur = nouvelle version du moteur.
 * Voir docs/PHGAME.md (format 3) et claude/architecture-jeux-importables.md.
 */

/** Recettes connues du moteur. */
export const RECIPE_IDS = ['vote-sur-consigne'] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

/** Phases d'une partie : avant le départ, génération IA, écriture, vote, révélation, fin. */
export const RECIPE_PHASES = ['pret', 'generation', 'ecriture', 'vote', 'resultat', 'final'] as const;
export type RecipePhase = (typeof RECIPE_PHASES)[number];

/** Écrans qui reçoivent une disposition : l'écran principal (salon) et le téléphone du joueur. */
export const SCREEN_ROLES = ['tv', 'joueur'] as const;
export type ScreenRole = (typeof SCREEN_ROLES)[number];

/**
 * Blocs d'écran, liste fermée. Les blocs de capteurs, de photo, de son ou de cartes ne sont pas
 * encore disponibles : ils seront ajoutés avec les recettes qui en ont besoin.
 */
export const SCREEN_BLOCKS = [
  'titre',
  'consigne',
  'minuteur',
  'attente',
  'saisie-texte',
  'vote',
  'resultat',
  'classement',
] as const;
export type ScreenBlock = (typeof SCREEN_BLOCKS)[number];

/** Où chaque bloc peut apparaître : rôle et phase. Un bloc hors de ces listes fait refuser le paquet. */
export const BLOCK_RULES: Record<ScreenBlock, { roles: readonly ScreenRole[]; phases: readonly RecipePhase[] }> = {
  titre: { roles: SCREEN_ROLES, phases: RECIPE_PHASES },
  consigne: { roles: SCREEN_ROLES, phases: ['ecriture', 'vote', 'resultat'] },
  minuteur: { roles: SCREEN_ROLES, phases: ['ecriture', 'vote'] },
  attente: { roles: SCREEN_ROLES, phases: ['ecriture', 'vote'] },
  'saisie-texte': { roles: ['joueur'], phases: ['ecriture'] },
  vote: { roles: SCREEN_ROLES, phases: ['vote'] },
  resultat: { roles: SCREEN_ROLES, phases: ['resultat'] },
  classement: { roles: SCREEN_ROLES, phases: ['resultat', 'final'] },
};

/** Disposition par défaut, utilisée quand le paquet ne décrit pas un écran. */
export const DEFAULT_SCREENS: Record<ScreenRole, Partial<Record<RecipePhase, ScreenBlock[]>>> = {
  tv: {
    pret: ['titre'],
    generation: ['titre'],
    ecriture: ['consigne', 'minuteur', 'attente'],
    vote: ['consigne', 'vote', 'minuteur'],
    resultat: ['consigne', 'resultat'],
    final: ['titre', 'classement'],
  },
  joueur: {
    pret: ['titre'],
    generation: ['titre'],
    ecriture: ['consigne', 'saisie-texte', 'minuteur'],
    vote: ['consigne', 'vote', 'minuteur'],
    resultat: ['resultat'],
    final: ['classement'],
  },
};

/** Besoins d'appareils déclarés par le paquet. Déclarés et validés ; les recettes actuelles n'en utilisent aucun. */
export const DEVICE_NEEDS = ['requis', 'facultatif'] as const;
export const appareilsSchema = z
  .object({
    camera: z.enum(DEVICE_NEEDS).optional(),
    micro: z.enum(DEVICE_NEEDS).optional(),
    mouvement: z.enum(DEVICE_NEEDS).optional(),
    vibreur: z.enum(DEVICE_NEEDS).optional(),
    qr: z.enum(DEVICE_NEEDS).optional(),
  })
  .strict();

const phaseListSchema = z.array(z.enum(SCREEN_BLOCKS)).max(8, 'Au plus 8 blocs par phase.');

const screenLayoutSchema = z
  .object({
    pret: phaseListSchema.optional(),
    generation: phaseListSchema.optional(),
    ecriture: phaseListSchema.optional(),
    vote: phaseListSchema.optional(),
    resultat: phaseListSchema.optional(),
    final: phaseListSchema.optional(),
  })
  .strict();

export const screensSchema = z
  .object({
    tv: screenLayoutSchema.optional(),
    joueur: screenLayoutSchema.optional(),
  })
  .strict();

export const recipeRulesSchema = z
  .object({
    /** Nombre de manches (au plus, selon le nombre de consignes disponibles). */
    manches: z.number().int().min(1).max(10).default(5),
    /** Temps d'écriture, en secondes. */
    ecriture: z.number().int().min(10).max(120).default(40),
    /** Temps de vote, en secondes. */
    vote: z.number().int().min(10).max(60).default(25),
    /** Points par vote reçu, pour l'auteur du mot. */
    pointsParVote: z.number().int().min(0).max(500).default(100),
    /** Longueur maximale d'un mot proposé. */
    motMax: z.number().int().min(4).max(40).default(24),
  })
  .strict();

/** Génération de consignes par l'IA. Sans fournisseur, le jeu prend les consignes du paquet. */
export const recipeAiSchema = z
  .object({
    /** Thème donné à l'IA (texte de l'auteur, jamais une saisie des joueurs). */
    theme: z.string().trim().min(2, 'Le thème compte au moins 2 caractères.').max(80),
    /** Nombre de consignes demandées. */
    nombre: z.number().int().min(3).max(12).default(6),
    /** Modèle de consigne utilisateur : {{theme}} et {{nombre}} sont remplacés. */
    consigne: z.string().trim().min(10).max(400).optional(),
  })
  .strict();

export const voteSurConsigneSchema = z
  .object({
    recipe: z.literal('vote-sur-consigne'),
    name: z.string().trim().min(3, 'Le nom doit compter au moins 3 caractères.').max(40),
    description: z.string().trim().max(200).default(''),
    icon: z.string().trim().min(1).max(8).default('💭'),
    rules: recipeRulesSchema.optional(),
    /** Consignes du paquet : liste complète, utilisée seule ou en repli de l'IA. */
    consignes: z.array(z.string().trim().min(3).max(90)).min(1, 'Ajoutez au moins une consigne.').max(100),
    ai: recipeAiSchema.optional(),
    ecrans: screensSchema.optional(),
    appareils: appareilsSchema.optional(),
  })
  .strict();

/**
 * Définition d'une recette. Les blocs de chaque écran sont vérifiés contre BLOCK_RULES : un bloc de
 * téléphone sur l'écran principal, ou un bloc hors de sa phase, fait refuser le paquet avec son chemin exact.
 */
export const recipeDefinitionSchema = z
  .discriminatedUnion('recipe', [voteSurConsigneSchema])
  .superRefine((def, ctx) => {
    const screens = def.ecrans;
    if (!screens) return;
    for (const role of SCREEN_ROLES) {
      const layout = screens[role];
      if (!layout) continue;
      for (const phase of RECIPE_PHASES) {
        const blocks = layout[phase];
        if (!blocks) continue;
        blocks.forEach((block, index) => {
          const rule = BLOCK_RULES[block];
          const where = role === 'tv' ? 'l’écran principal' : 'le téléphone';
          if (!rule.roles.includes(role)) {
            ctx.addIssue({
              code: 'custom',
              path: ['ecrans', role, phase, index],
              message: `Le bloc « ${block} » ne s’affiche pas sur ${where}.`,
            });
          } else if (!rule.phases.includes(phase)) {
            ctx.addIssue({
              code: 'custom',
              path: ['ecrans', role, phase, index],
              message: `Le bloc « ${block} » ne s’affiche pas pendant la phase « ${phase} ».`,
            });
          }
        });
      }
    }
  });

export type RecipeDefinition = z.infer<typeof recipeDefinitionSchema>;
export type RecipeRules = z.output<typeof recipeRulesSchema>;

/** Règles d'une recette, avec les valeurs par défaut quand le paquet n'en donne pas. */
export function resolveRules(definition: RecipeDefinition): RecipeRules {
  return recipeRulesSchema.parse(definition.rules ?? {});
}

/** Blocs à afficher pour un écran et une phase : la disposition du paquet, sinon la disposition par défaut. */
export function resolveScreen(definition: RecipeDefinition, role: ScreenRole, phase: RecipePhase): ScreenBlock[] {
  const custom = definition.ecrans?.[role]?.[phase];
  return custom ?? DEFAULT_SCREENS[role][phase] ?? [];
}

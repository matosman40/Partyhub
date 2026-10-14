import { z } from 'zod';

/**
 * Définition d'un jeu de cartes. Un jeu de cartes est une donnée : les jeux
 * intégrés (« Couleurs & chiffres », « Blanc-manger coco ») et ceux créés dans
 * l'administration utilisent exactement le même format et le même moteur.
 */

export const CARD_THEMES = ['arcade', 'coco', 'nuit', 'classique'] as const;
export type CardTheme = (typeof CARD_THEMES)[number];

/**
 * Effet d'une carte :
 * - none : aucun effet ;
 * - skip : le joueur suivant passe son tour ;
 * - reverse : le sens de jeu s'inverse (à deux, agit comme un passe) ;
 * - draw2 / draw4 : le joueur suivant pioche 2 ou 4 cartes et passe ;
 * - wild : le joueur choisit la famille active.
 */
export const CARD_EFFECTS = ['none', 'skip', 'reverse', 'draw2', 'draw4', 'wild'] as const;
export type CardEffect = (typeof CARD_EFFECTS)[number];

/** Famille réservée aux cartes « joker » (effets wild / draw4). */
export const WILD_FAMILY = 'wild';

/** Comment une carte peut être jouée sur la défausse. */
export const MATCH_MODES = ['family', 'symbol', 'either'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

const idSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,16}$/, 'Identifiant : minuscules, chiffres et tirets (16 caractères max).');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #rrggbb.');

export const cardFamilySchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1, 'Nom de famille requis.').max(20),
  color: hexColor,
});

export const cardEntrySchema = z.object({
  id: idSchema,
  /** Nom court affiché sous le symbole (« Passe », « Joker »…). */
  label: z.string().trim().max(24),
  /** Symbole central : chiffre, texte court ou emoji. */
  symbol: z.string().trim().min(1, 'Symbole requis.').max(4),
  /** Identifiant de famille, ou « wild ». */
  family: z.string().min(1).max(16),
  effect: z.enum(CARD_EFFECTS),
  /** Nombre d'exemplaires dans le paquet. */
  count: z.number().int().min(1).max(20),
  /** Valeur en points si la carte reste en main en fin de manche. */
  points: z.number().int().min(0).max(100),
});

export const cardRulesSchema = z.object({
  minPlayers: z.number().int().min(2).max(8),
  maxPlayers: z.number().int().min(2).max(8),
  handSize: z.number().int().min(3).max(10),
  matchOn: z.enum(MATCH_MODES),
  targetScore: z.number().int().min(50).max(2000),
  turnSeconds: z.number().int().min(0).max(60),
});

export const cardNoticeSchema = z.object({
  goal: z.string().trim().min(1).max(300),
  steps: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  tips: z.array(z.string().trim().min(1).max(300)).max(6),
});

/**
 * Dos de carte personnalisé. Absent = dos du thème graphique.
 * `color` : couleur de fond. `label` : texte centré. `imageAssetId` : image de la médiathèque
 * (les paquets .phgame ne peuvent pas la référencer : leurs ressources sont dans leur archive).
 */
export const cardBackSchema = z.object({
  color: hexColor.optional(),
  label: z.string().trim().max(16).optional(),
  imageAssetId: z.string().regex(/^[0-9a-f]{32}$/, 'Image du dos invalide.').optional(),
});

export const cardGameBaseSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court.').max(40),
  description: z.string().trim().min(1).max(160),
  icon: z.string().trim().min(1).max(8),
  theme: z.enum(CARD_THEMES),
  families: z.array(cardFamilySchema).min(1).max(8),
  cards: z.array(cardEntrySchema).min(1).max(60),
  rules: cardRulesSchema,
  notice: cardNoticeSchema,
  back: cardBackSchema.optional(),
});

export const cardGameDefinitionSchema = cardGameBaseSchema.superRefine((def, ctx) => {
  const familyIds = new Set<string>();
  for (const [i, f] of def.families.entries()) {
    if (familyIds.has(f.id)) {
      ctx.addIssue({ code: 'custom', path: ['families', i, 'id'], message: `Famille « ${f.id} » en double.` });
    }
    if (f.id === WILD_FAMILY) {
      ctx.addIssue({ code: 'custom', path: ['families', i, 'id'], message: '« wild » est réservé.' });
    }
    familyIds.add(f.id);
  }

  const cardIds = new Set<string>();
  let deckSize = 0;
  for (const [i, c] of def.cards.entries()) {
    deckSize += c.count;
    if (cardIds.has(c.id)) {
      ctx.addIssue({ code: 'custom', path: ['cards', i, 'id'], message: `Carte « ${c.id} » en double.` });
    }
    cardIds.add(c.id);

    const isWild = c.family === WILD_FAMILY;
    if (!isWild && !familyIds.has(c.family)) {
      ctx.addIssue({ code: 'custom', path: ['cards', i, 'family'], message: `Famille inconnue pour « ${c.label || c.symbol} ».` });
    }
    if (isWild !== (c.effect === 'wild' || c.effect === 'draw4')) {
      ctx.addIssue({
        code: 'custom',
        path: ['cards', i, 'effect'],
        message: 'Les cartes joker doivent avoir la famille « wild » et un effet joker (+4 ou choix).',
      });
    }
  }

  const { minPlayers, maxPlayers, handSize } = def.rules;
  if (minPlayers > maxPlayers) {
    ctx.addIssue({ code: 'custom', path: ['rules', 'minPlayers'], message: 'Le minimum dépasse le maximum.' });
  }
  if (deckSize < maxPlayers * handSize + 5) {
    ctx.addIssue({
      code: 'custom',
      path: ['cards'],
      message: `Il faut au moins ${maxPlayers * handSize + 5} cartes pour distribuer ${maxPlayers} joueurs à ${handSize} cartes.`,
    });
  }
});

export type CardFamily = z.infer<typeof cardFamilySchema>;
export type CardEntry = z.infer<typeof cardEntrySchema>;
export type CardRules = z.infer<typeof cardRulesSchema>;
export type CardGameDefinition = z.infer<typeof cardGameDefinitionSchema>;
export type CardBack = z.infer<typeof cardBackSchema>;

/** Réglages qu'un hôte peut modifier dans le salon, pour tout jeu de cartes. */
export function cardSettingsSchema(defaults: { targetScore: number; turnSeconds: number }) {
  return z.object({
    targetScore: z.number().int().min(50).max(2000).default(defaults.targetScore),
    turnSeconds: z.number().int().min(0).max(60).default(defaults.turnSeconds),
  });
}

export type CardSettings = z.infer<ReturnType<typeof cardSettingsSchema>>;

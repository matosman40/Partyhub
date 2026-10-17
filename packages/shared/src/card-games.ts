import { z } from 'zod';

/**
 * Définition d’un jeu de cartes. Un jeu de cartes est une donnée : les jeux
 * intégrés (« Couleurs & chiffres », « Blanc-manger coco ») et ceux créés dans
 * l’administration utilisent exactement le même format et le même moteur.
 */

export const CARD_THEMES = ['arcade', 'coco', 'nuit', 'classique'] as const;
export type CardTheme = (typeof CARD_THEMES)[number];

/**
 * Effet d’une carte :
 * - none : aucun effet ;
 * - skip : le joueur suivant passe son tour ;
 * - reverse : le sens de jeu s’inverse (à deux, agit comme un passe) ;
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
  /** Nombre d’exemplaires dans le paquet. */
  count: z.number().int().min(1).max(20),
  /** Valeur en points si la carte reste en main en fin de manche (au mémo : points de la paire trouvée). */
  points: z.number().int().min(0).max(100),
  /** Texte imprimé sur la carte : phrases, questions, mots (jeux à texte). */
  text: z.string().trim().max(240).optional(),
  /** Rang d’ordre de grandeur, pour trier la main. Absent : on prend le chiffre du symbole, puis les points. */
  rank: z.number().int().min(0).max(999).optional(),
  /**
   * Paire (mémo) : deux cartes de même paire forment une paire. Absent : la paire est l’identifiant
   * de la carte, donc deux exemplaires de la même carte (count 2) forment une paire.
   */
  pair: z.string().trim().min(1).max(40).optional(),
});

/**
 * Mécanique du jeu. « shedding » : se débarrasser de ses cartes (défaut, règles de la défausse).
 * « memory » : cartes cachées, on retourne deux cartes par tour pour trouver les paires.
 */
export const CARD_MECHANICS = ['shedding', 'memory', 'race', 'trick'] as const;
export type CardMechanic = (typeof CARD_MECHANICS)[number];

/** Au mémo, nombre maximal de cartes sur le plateau (un écran de téléphone en tient environ 60). */
export const MEMORY_MAX_CARDS = 60;

/** Plafond d’exemplaires pour la ressemblance et les plis, pour garder une table lisible. */
export const RACE_TRICK_MAX_CARDS = 120;

export const cardRulesSchema = z.object({
  minPlayers: z.number().int().min(2).max(8),
  maxPlayers: z.number().int().min(2).max(8),
  /** Taille de main (shedding). Ignorée au mémo. */
  handSize: z.number().int().min(3).max(10),
  /** Comment une carte se pose (shedding). Ignoré au mémo. */
  matchOn: z.enum(MATCH_MODES),
  targetScore: z.number().int().min(50).max(2000),
  turnSeconds: z.number().int().min(0).max(60),
  /** Mécanique (absent : shedding, comme les définitions précédentes). */
  mechanic: z.enum(CARD_MECHANICS).optional(),
  /** Atout (plis) : famille qui bat les autres couleurs. Absent : pas d’atout. */
  trump: z.string().trim().min(1).max(16).optional(),
});

export const cardNoticeSchema = z.object({
  goal: z.string().trim().min(1).max(300),
  steps: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  tips: z.array(z.string().trim().min(1).max(300)).max(6),
});

/** Polices livrées avec l’application : pas de fichier à envoyer pour les utiliser. */
export const CARD_FONT_PRESETS = ['lisible', 'symboles', 'titre'] as const;
export type CardFontPreset = (typeof CARD_FONT_PRESETS)[number];

/** Motifs du dos de carte, dessinés en SVG (aucune image à envoyer). */
export const CARD_BACK_PATTERNS = ['uni', 'rayures', 'pois', 'losanges', 'quadrillage'] as const;
export type CardBackPattern = (typeof CARD_BACK_PATTERNS)[number];

/**
 * Dos de carte personnalisé. Absent = dos du thème graphique.
 * `color` : couleur de fond. `label` : texte centré. `imageAssetId` : image de la médiathèque
 * (les paquets .phgame ne peuvent pas la référencer : leurs ressources sont dans leur archive).
 */
export const cardBackSchema = z.object({
  color: hexColor.optional(),
  label: z.string().trim().max(16).optional(),
  imageAssetId: z
    .string()
    .regex(/^[0-9a-f]{32}$/, 'Image du dos invalide.')
    .optional(),
  /** Motif dessiné sur la couleur de fond. Ignoré quand une image est choisie. */
  pattern: z.enum(CARD_BACK_PATTERNS).optional(),
});

export const cardGameBaseSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court.').max(40),
  description: z.string().trim().min(1).max(160),
  icon: z.string().trim().min(1).max(8),
  theme: z.enum(CARD_THEMES),
  families: z.array(cardFamilySchema).min(1).max(8),
  /** Types de cartes (pas les exemplaires) : 200 au plus, pour les jeux à texte alimentés par CSV. */
  cards: z.array(cardEntrySchema).min(1).max(200),
  rules: cardRulesSchema,
  notice: cardNoticeSchema,
  back: cardBackSchema.optional(),
  /** Police de la médiathèque utilisée pour les textes des cartes. Absent = police du thème. */
  fontAssetId: z
    .string()
    .regex(/^[0-9a-f]{32}$/, 'Police invalide.')
    .optional(),
  /** Police livrée avec l’application. Ignorée quand une police de la médiathèque est choisie. */
  fontPreset: z.enum(CARD_FONT_PRESETS).optional(),
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
      ctx.addIssue({
        code: 'custom',
        path: ['cards', i, 'family'],
        message: `Famille inconnue pour « ${c.label || c.symbol} ».`,
      });
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

  // L’atout n’existe qu’aux plis : ailleurs, il ne ferait que tromper l’administrateur.
  if (def.rules.trump !== undefined && def.rules.mechanic !== 'trick') {
    ctx.addIssue({
      code: 'custom',
      path: ['rules', 'trump'],
      message: 'Seule la mécanique « plis » accepte un atout.',
    });
  }

  if (def.rules.mechanic === 'race' || def.rules.mechanic === 'trick') {
    // Ressemblance et plis : pas d’effets ni de jokers, un atout éventuel, et assez de cartes pour distribuer.
    const race = def.rules.mechanic === 'race';
    for (const [i, c] of def.cards.entries()) {
      if (c.effect !== 'none' || c.family === WILD_FAMILY) {
        ctx.addIssue({
          code: 'custom',
          path: ['cards', i, 'effect'],
          message: `Cette mécanique n’utilise ni effet ni joker : « ${c.label || c.symbol} » doit être sans effet.`,
        });
      }
    }
    if (!race && def.rules.trump !== undefined && !familyIds.has(def.rules.trump)) {
      ctx.addIssue({
        code: 'custom',
        path: ['rules', 'trump'],
        message: `L’atout « ${def.rules.trump} » n’est pas une famille du jeu.`,
      });
    }
    const needed = race ? maxPlayers * handSize + 1 : maxPlayers * handSize;
    if (deckSize < needed) {
      ctx.addIssue({
        code: 'custom',
        path: ['cards'],
        message: `Il faut au moins ${needed} cartes pour distribuer ${maxPlayers} joueurs à ${handSize} cartes${race ? ' et poser une carte au centre' : ''} (${deckSize} actuellement).`,
      });
    }
    if (deckSize > RACE_TRICK_MAX_CARDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['cards'],
        message: `Au plus ${RACE_TRICK_MAX_CARDS} cartes pour cette mécanique (${deckSize} actuellement).`,
      });
    }
    return;
  }

  if (def.rules.mechanic === 'memory') {
    // Au mémo, pas de main à distribuer : il faut seulement des paires complètes.
    const groups = new Map<string, number>();
    for (const [i, c] of def.cards.entries()) {
      if (c.effect !== 'none' || c.family === WILD_FAMILY) {
        ctx.addIssue({
          code: 'custom',
          path: ['cards', i, 'effect'],
          message: `Au mémo, la carte « ${c.label || c.symbol} » n’a ni effet ni joker.`,
        });
      }
      // Même espace de clés que le moteur : une étiquette ne se confond jamais avec un identifiant.
      const key = c.pair !== undefined ? `pair:${c.pair}` : `id:${c.id}`;
      groups.set(key, (groups.get(key) ?? 0) + c.count);
    }
    for (const [key, n] of groups) {
      if (n !== 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['cards'],
          message: `La paire « ${key.replace(/^(pair|id):/, '')} » compte ${n} carte(s) : il en faut exactement 2.`,
        });
      }
    }
    if (deckSize < 4 || deckSize > MEMORY_MAX_CARDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['cards'],
        message: `Au mémo, il faut entre 4 et ${MEMORY_MAX_CARDS} cartes (${deckSize} actuellement).`,
      });
    }
    return;
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

/** Réglages qu’un hôte peut modifier dans le salon, pour tout jeu de cartes. */
export function cardSettingsSchema(defaults: { targetScore: number; turnSeconds: number }) {
  return z.object({
    targetScore: z.number().int().min(50).max(2000).default(defaults.targetScore),
    turnSeconds: z.number().int().min(0).max(60).default(defaults.turnSeconds),
  });
}

export type CardSettings = z.infer<ReturnType<typeof cardSettingsSchema>>;

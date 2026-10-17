import { z } from 'zod';

/**
 * Jeux de questions à partir de médias : « Devine le film », « Devine la chanson »…
 * Un extrait est une vidéo YouTube (identifiant, début, durée) ou un fichier de la
 * médiathèque. Le joueur tape la réponse sur son téléphone. Comme les jeux de cartes,
 * c’est une donnée : les jeux intégrés et ceux créés dans l’administration suivent
 * le même format et le même moteur.
 */

export const MEDIA_KINDS = ['film', 'musique', 'extrait'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  film: 'Devine le film',
  musique: 'Devine la chanson',
  extrait: 'Devine l’extrait',
};

/** Question posée aux joueurs, selon le type de jeu. */
export const MEDIA_KIND_PROMPT: Record<MediaKind, string> = {
  film: 'Quel est ce film ?',
  musique: 'Quelle est cette chanson ?',
  extrait: 'Qu’est-ce que c’est ?',
};

/**
 * Mode de jeu : « devine » (les joueurs tapent le titre) ou « sous-titres » (les joueurs
 * écrivent le sous-titre d’une scène en langue étrangère, puis votent pour le meilleur).
 */
export const MEDIA_MODES = ['devine', 'sous-titres'] as const;
export type MediaMode = (typeof MEDIA_MODES)[number];

export const MEDIA_MODE_LABEL: Record<MediaMode, string> = {
  devine: 'Devine (on tape le titre)',
  'sous-titres': 'Sous-titres (on écrit)',
};

export const MEDIA_KIND_ICON: Record<MediaKind, string> = {
  film: '🎬',
  musique: '🎵',
  extrait: '🎧',
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const ASSET_ID = /^[0-9a-f]{32}$/;
const ITEM_ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Extrait l’identifiant d’une vidéo YouTube depuis une URL (watch, youtu.be, shorts,
 * embed, live) ou depuis l’identifiant seul. Renvoie null si rien de valide.
 */
export function parseYoutubeId(input: string): string | null {
  const text = input.trim();
  if (YOUTUBE_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? null;
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/**
 * Lit un temps saisi par une personne : « 90 », « 1:30 », « 1:02:03 », « 1m30s ».
 * Renvoie le nombre de secondes, ou null si la saisie n’est pas un temps.
 */
export function parseTimeInput(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return Number(text);
  const colon = text.split(':');
  if (colon.length >= 2 && colon.length <= 3 && colon.every((p) => /^\d+$/.test(p))) {
    return colon.reduce((total, part) => total * 60 + Number(part), 0);
  }
  const unit = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (unit && (unit[1] || unit[2] || unit[3])) {
    return Number(unit[1] ?? 0) * 3600 + Number(unit[2] ?? 0) * 60 + Number(unit[3] ?? 0);
  }
  return null;
}

/** Temps de début porté par une URL YouTube (`t=90`, `t=1m30s`, `start=90`), sinon null. */
export function youtubeStartFromUrl(input: string): number | null {
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
    return raw ? parseTimeInput(raw) : null;
  } catch {
    return null;
  }
}

export const mediaSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('youtube'),
    videoId: z.string().regex(YOUTUBE_ID, 'Lien YouTube invalide.'),
  }),
  z.object({
    type: z.literal('asset'),
    assetId: z.string().regex(ASSET_ID, 'Fichier de la médiathèque invalide.'),
    mediaKind: z.enum(['audio', 'video']),
  }),
]);

export type MediaSource = z.infer<typeof mediaSourceSchema>;

export const mediaItemSchema = z.object({
  id: z.string().regex(ITEM_ID, 'Identifiant d’extrait invalide.'),
  /**
   * Réponse attendue (titre du film ou de la chanson). En mode « sous-titres », c’est la
   * traduction de référence, montrée à la révélation ; elle est alors facultative.
   */
  answer: z.string().trim().max(200).default(''),
  /** Autres formulations acceptées (titre original, titre court…). Mode « devine » seulement. */
  aliases: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  /**
   * Précision : après la révélation en mode « devine » (année, réalisateur…), indice
   * affiché aux joueurs en mode « sous-titres » (langue, contexte de la scène).
   */
  detail: z.string().trim().max(160).default(''),
  source: mediaSourceSchema,
  /** Début de l’extrait, en secondes. */
  startSec: z.number().int().min(0).max(43_200).default(0),
  /** Durée de l’extrait, en secondes. */
  durationSec: z.number().int().min(3).max(60).default(20),
});

export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaQuizDefinitionSchema = z
  .object({
    mode: z.enum(MEDIA_MODES).default('devine'),
    kind: z.enum(MEDIA_KINDS),
    name: z.string().trim().min(3, 'Le nom doit compter au moins 3 caractères.').max(40),
    description: z.string().trim().max(200).default(''),
    icon: z.string().trim().min(1).max(8).default('🎬'),
    rules: z
      .object({
        questionCount: z.number().int().min(1).max(30).default(8),
        answerSeconds: z.number().int().min(10).max(90).default(30),
        speedBonus: z.boolean().default(true),
      })
      .default({ questionCount: 8, answerSeconds: 30, speedBonus: true }),
    items: z.array(mediaItemSchema).min(1, 'Ajoutez au moins un extrait.').max(60),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    def.items.forEach((item, i) => {
      if (ids.has(item.id)) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: `Extrait « ${item.id} » en double.` });
      }
      ids.add(item.id);
      if (def.mode === 'devine') {
        if (item.answer.length === 0) {
          ctx.addIssue({ code: 'custom', path: ['items', i, 'answer'], message: 'La réponse est obligatoire.' });
        } else if (item.answer.length > 80) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', i, 'answer'],
            message: 'La réponse compte 80 caractères au plus.',
          });
        }
      }
    });
  });

export type MediaQuizDefinition = z.infer<typeof mediaQuizDefinitionSchema>;

/** Fichier d’export : un jeu complet, réimportable dans une autre installation. */
export const MEDIA_EXPORT_FORMAT = 'partyhub-questions-medias';

export const mediaExportSchema = z.object({
  format: z.literal(MEDIA_EXPORT_FORMAT),
  version: z.literal(1),
  definition: mediaQuizDefinitionSchema,
});

export type MediaExport = z.infer<typeof mediaExportSchema>;

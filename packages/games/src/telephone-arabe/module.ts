import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, shuffle } from '../common/engine.js';
import rawPhrases from './phrases.fr.json' with { type: 'json' };
import {
  DESCRIPTION_MAX_LENGTH,
  DRAWING_MAX_POINTS,
  DRAWING_MAX_POINTS_PER_STROKE,
  DRAWING_MAX_STROKES,
  DRAWING_SIZE,
  SENTENCE_MAX_LENGTH,
  STEP_INSTRUCTION,
  TELEPHONE_SOURCES,
  TELEPHONE_TIMES,
  type TelephoneSource,
} from './info.js';

/**
 * Le téléphone arabe illustré : chaque joueur part d’une phrase, qu’il ne voit pas forcément en entier. Le
 * suivant la dessine au doigt, le troisième la décrit, et ainsi de suite. Chaque chaîne tourne entre les
 * joueurs ; à la fin, l’écran principal montre toute l’évolution de chaque phrase.
 *
 * Les phrases de départ sont tirées au hasard, ou écrites par les joueurs au premier tour. Le temps par étape
 * est libre, ou limité à 45 ou 30 secondes. Une étape sans réponse reçoit une réponse vide, et la chaîne continue.
 */

const PHRASES: string[] = z.array(z.string().min(1)).min(1).parse(rawPhrases);

export const telephoneSettingsSchema = z.object({
  steps: z.number().int().min(3).max(8).default(6),
  time: z.enum(TELEPHONE_TIMES).default('libre'),
  source: z.enum(TELEPHONE_SOURCES).default('aleatoire'),
});

export type TelephoneSettings = z.infer<typeof telephoneSettingsSchema>;

/** Sans limite, une étape se termine quand tout le monde a répondu, ou après ce délai de sécurité. */
const SAFETY_MS = 180_000;
const STEP_TIMEOUT = 'step-timeout';
const FALLBACK_SENTENCE = '…';
const FALLBACK_DESCRIPTION = '(rien de visible)';

export type TelephoneKind = 'sentence' | 'draw' | 'describe';
export type Point = [number, number];
export type Stroke = Point[];

export interface TelephoneItem {
  kind: TelephoneKind;
  text: string | null;
  strokes: Stroke[] | null;
  /** Auteur de l’étape ; null pour une phrase tirée au hasard. */
  by: string | null;
}

export type TelephonePhase = 'ready' | 'step' | 'final';

export interface TelephoneState {
  phase: TelephonePhase;
  settings: TelephoneSettings;
  /** Ordre de jeu : les joueurs dans l’ordre où ils ont rejoint la salle. */
  order: string[];
  players: Record<string, string>;
  round: number;
  /** Une chaîne par joueur de départ ; chaque chaîne liste ses étapes dans l’ordre. */
  chains: TelephoneItem[][];
  /** joueur -> réponse de l’étape en cours. */
  answers: Record<string, TelephoneItem>;
  endsAt: number;
}

/** Nature de l’étape : une phrase (joueurs), puis un dessin et une description en alternance. */
export function kindOf(round: number, source: TelephoneSource): TelephoneKind {
  if (source === 'personnalisees') {
    if (round === 0) return 'sentence';
    return round % 2 === 1 ? 'draw' : 'describe';
  }
  return round % 2 === 0 ? 'draw' : 'describe';
}

/** Chaîne travaillée par le joueur `position` à l’étape `round` : chaque chaîne tourne d’un joueur à chaque étape. */
export function chainIndex(position: number, round: number, count: number): number {
  return (((position - round) % count) + count) % count;
}

const pointSchema = z.tuple([z.number().int().min(0).max(DRAWING_SIZE), z.number().int().min(0).max(DRAWING_SIZE)]);
const strokeSchema = z.array(pointSchema).min(1).max(DRAWING_MAX_POINTS_PER_STROKE);
const drawingSchema = z.object({
  strokes: z
    .array(strokeSchema)
    .min(1)
    .max(DRAWING_MAX_STROKES)
    .refine((strokes) => strokes.reduce((n, stroke) => n + stroke.length, 0) <= DRAWING_MAX_POINTS, {
      message: 'Dessin trop long',
    }),
});
const sentenceSchema = z.object({ text: z.string().trim().min(1).max(SENTENCE_MAX_LENGTH) });
const descriptionSchema = z.object({ text: z.string().trim().min(1).max(DESCRIPTION_MAX_LENGTH) });

function fallbackItem(kind: TelephoneKind, by: string): TelephoneItem {
  if (kind === 'sentence') return { kind, text: FALLBACK_SENTENCE, strokes: null, by };
  if (kind === 'draw') return { kind, text: null, strokes: [], by };
  return { kind, text: FALLBACK_DESCRIPTION, strokes: null, by };
}

function clearStepTimer(ctx: GameContext): void {
  ctx.cancel(STEP_TIMEOUT);
}

function openStep(s: TelephoneState, ctx: GameContext): TelephoneState {
  clearStepTimer(ctx);
  const ms = s.settings.time === 'libre' ? SAFETY_MS : Number(s.settings.time) * 1000;
  ctx.schedule(STEP_TIMEOUT, ms);
  return { ...s, phase: 'step', answers: {}, endsAt: ctx.now() + ms };
}

/** Range les réponses de l’étape dans leurs chaînes, puis passe à l’étape suivante ou au bilan. */
function collect(s: TelephoneState, ctx: GameContext): TelephoneState {
  clearStepTimer(ctx);
  const kind = kindOf(s.round, s.settings.source);
  const count = s.order.length;
  const chains = s.chains.map((items) => [...items]);
  s.order.forEach((id, position) => {
    const item = s.answers[id] ?? fallbackItem(kind, id);
    const c = chainIndex(position, s.round, count);
    chains[c] = [...(chains[c] ?? []), item];
  });
  const next = { ...s, chains, answers: {} };
  if (s.round + 1 < s.settings.steps) {
    return openStep({ ...next, round: s.round + 1 }, ctx);
  }
  return finish(next, ctx);
}

function finish(s: TelephoneState, ctx: GameContext): TelephoneState {
  clearStepTimer(ctx);
  return { ...s, phase: 'final' };
}

const BOT_SENTENCES = [
  'Un canard danse la valse avec un parapluie.',
  'Une girafe fait du ski sur un toit.',
  'Le facteur mange une pizza au fromage bleu.',
];

const BOT_DESCRIPTIONS = [
  'C’est un animal qui dort sur un nuage.',
  'On dirait une maison qui fait la sieste.',
  'Il y a quelque chose qui vole, je crois.',
];

/** Dessin de robot : trois traits au hasard, pour tester la chaîne sans écran. */
function botStrokes(random: () => number): Stroke[] {
  const cx = 200 + Math.floor(random() * 600);
  const cy = 200 + Math.floor(random() * 600);
  return [0, 1, 2].map((k) =>
    Array.from(
      { length: 8 },
      (_, i) =>
        [
          Math.min(DRAWING_SIZE, Math.max(0, cx + Math.round(Math.cos(i + k) * (60 + k * 30)))),
          Math.min(DRAWING_SIZE, Math.max(0, cy + Math.round(Math.sin(i + k) * (60 + k * 30)))),
        ] as Point,
    ),
  );
}

export const telephoneArabe: GameModule<TelephoneState, TelephoneSettings> = {
  manifest: {
    id: 'telephone-arabe',
    category: 'quiz',
    name: 'Le téléphone arabe illustré',
    description: 'Une phrase absurde, dessinée puis décrite par le joueur suivant : le résultat fait rire.',
    icon: '🎨',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 10,
    durationMin: 15,
    notice: {
      goal: 'Voir une phrase absurde se transformer de joueur en joueur, du dessin à la description.',
      steps: [
        'Écrivez une phrase absurde, ou lisez celle qu’on vous donne.',
        'Au tour suivant, dessinez la phrase que vous recevez, au doigt, sans écrire.',
        'Puis décrivez le dessin que vous recevez, en une phrase.',
        'À la fin, toute l’évolution de chaque phrase apparaît sur l’écran principal.',
      ],
      tips: ['Le dessin se fait au doigt, sans outil ni couleur.', 'Une étape sans réponse reçoit une réponse vide.'],
    },
  },

  settingsSchema: telephoneSettingsSchema,
  defaultSettings: telephoneSettingsSchema.parse({}),

  actions: {
    sentence: sentenceSchema,
    draw: drawingSchema,
    describe: descriptionSchema,
  },

  // Les chaînes sont construites au lancement, quand la liste des joueurs est fixée (voir start).
  initialize(settings, players) {
    const parsed = telephoneSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      order: players.map((p) => p.id),
      players: directory(players),
      round: 0,
      chains: [],
      answers: {},
      endsAt: 0,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return { ...s, order: [...s.order, p.id], players: { ...s.players, [p.id]: p.name } };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    delete players[p.id];
    return { ...s, order: s.order.filter((id) => id !== p.id), players };
  },

  start(s, ctx) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.order.length < 2) return fail('Il faut au moins deux joueurs');
    const count = s.order.length;
    // Phrases au hasard : chaque chaîne démarre avec la sienne, sans répétition tant qu’il y en a assez.
    const seeds =
      s.settings.source === 'aleatoire'
        ? shuffle(PHRASES, ctx.random)
            .slice(0, count)
            .map((text) => ({ kind: 'sentence' as const, text, strokes: null, by: null }))
        : null;
    const chains: TelephoneItem[][] = s.order.map((_, c) => (seeds ? [seeds[c % seeds.length]!] : []));
    return ok(openStep({ ...s, chains, round: 0 }, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (s.phase !== 'step') return fail('Pas d’étape en cours');
    if (!['sentence', 'draw', 'describe'].includes(type)) return fail('Action inconnue');

    const kind = kindOf(s.round, s.settings.source);
    if (type !== kind) return fail('Ce n’est pas le moment de ce type de réponse');
    if (p.id in s.answers) return fail('Réponse déjà envoyée');

    let item: TelephoneItem;
    if (kind === 'sentence') {
      const parsed = sentenceSchema.safeParse(payload);
      if (!parsed.success) return fail('Phrase invalide');
      item = { kind, text: parsed.data.text, strokes: null, by: p.id };
    } else if (kind === 'draw') {
      const parsed = drawingSchema.safeParse(payload);
      if (!parsed.success) return fail('Dessin invalide');
      item = { kind, text: null, strokes: parsed.data.strokes as Stroke[], by: p.id };
    } else {
      const parsed = descriptionSchema.safeParse(payload);
      if (!parsed.success) return fail('Description invalide');
      item = { kind, text: parsed.data.text, strokes: null, by: p.id };
    }

    const next = { ...s, answers: { ...s.answers, [p.id]: item } };
    const done = everyConnectedDone(ctx, s.order, (id) => id in next.answers);
    return ok(done ? collect(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === STEP_TIMEOUT && s.phase === 'step') return collect(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    return s.phase === 'step' ? collect(s, ctx) : s;
  },

  // Pas de points dans ce jeu : c’est un récit à lire ensemble.
  calculateScores() {
    return [];
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const base = {
      phase: s.phase,
      round: s.round,
      total: s.settings.steps,
      playerCount: s.order.length,
    };

    if (s.phase === 'ready') return { ...base, kind: null, instruction: null };

    if (s.phase === 'step') {
      const kind = kindOf(s.round, s.settings.source);
      return {
        ...base,
        kind,
        instruction: STEP_INSTRUCTION[kind],
        endsAt: s.endsAt,
        durationMs: s.settings.time === 'libre' ? null : Number(s.settings.time) * 1000,
        submittedCount: Object.keys(s.answers).length,
      };
    }

    // Bilan : toute l’évolution de chaque chaîne, étape par étape, avec ses auteurs.
    return {
      ...base,
      kind: null,
      instruction: null,
      chains: s.chains.map((items) => ({
        items: items.map((item) => ({
          kind: item.kind,
          text: item.text,
          strokes: item.strokes,
          by: item.by ? (s.players[item.by] ?? '?') : null,
        })),
      })),
    };
  },

  getPlayerState(s, playerId) {
    const position = s.order.indexOf(playerId);
    let task: {
      kind: TelephoneKind;
      instruction: string;
      previousText: string | null;
      previousStrokes: Stroke[] | null;
      previousBy: string | null;
    } | null = null;

    if (s.phase === 'step' && position >= 0) {
      const kind = kindOf(s.round, s.settings.source);
      const c = chainIndex(position, s.round, s.order.length);
      const items = s.chains[c] ?? [];
      const previous = items[items.length - 1] ?? null;
      task = {
        kind,
        instruction: STEP_INSTRUCTION[kind],
        previousText: kind === 'draw' ? (previous?.text ?? null) : null,
        previousStrokes: kind === 'describe' ? (previous?.strokes ?? null) : null,
        previousBy: previous?.by ? (s.players[previous.by] ?? null) : null,
      };
    }

    return {
      task,
      answered: s.phase === 'step' ? playerId in s.answers : false,
    };
  },

  getHostState(s) {
    const pending = s.phase === 'step' ? s.order.filter((id) => !(id in s.answers)) : [];
    return { pending: pending.map((id) => s.players[id] ?? '?') };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.phase !== 'step' || playerId in s.answers) return null;
    const kind = kindOf(s.round, s.settings.source);
    const key = `r${s.round}`;
    if (kind === 'sentence') {
      return { type: 'sentence', payload: { text: BOT_SENTENCES[Math.floor(random() * BOT_SENTENCES.length)]! }, key };
    }
    if (kind === 'draw') {
      return { type: 'draw', payload: { strokes: botStrokes(random) }, key };
    }
    return {
      type: 'describe',
      payload: { text: BOT_DESCRIPTIONS[Math.floor(random() * BOT_DESCRIPTIONS.length)]! },
      key,
    };
  },
};

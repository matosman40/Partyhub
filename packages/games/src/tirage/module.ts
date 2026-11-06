import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { addPoints, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import banqueEstimer from './banque-estimer.fr.json' with { type: 'json' };
import banqueEspeces from './banque-especes.fr.json' with { type: 'json' };
import banqueIdentifier from './banque-identifier.fr.json' with { type: 'json' };

/**
 * Tirage surprise : chaque manche est tirée au hasard, soit en mode Estimer (un chiffre réel à deviner, Wikidata),
 * soit en mode Identifier (l'auteur d'un tableau, parmi quatre choix, Met Museum). Ce fichier contient les règles ;
 * il est pur.
 */

export const tirageSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(5),
  guessSeconds: z.number().int().min(20).max(180).default(60),
  difficulty: z.number().int().min(1).max(3).default(2),
});

export type TirageSettings = z.infer<typeof tirageSettingsSchema>;

const estimerSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  valeur: z.number().int().min(0),
  unite: z.string().min(1),
  theme: z.string().min(1),
  source: z.string().min(1),
});

const identifierSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  reponse: z.string().min(1),
  titre: z.string().min(1),
  image: z.string().startsWith('/tirage/'),
  theme: z.string().min(1),
  source: z.string().min(1),
  /** Crédit du photographe ou de la collection, quand la licence le demande (CC BY, CC BY-SA). */
  credit: z.string().min(1).optional(),
});

/** Une estimation : le chiffre réel et son unité. */
export interface Estimation extends z.infer<typeof estimerSchema> {
  kind: 'estimer';
}

/** Une identification, telle qu'elle est dans la banque : la réponse seulement, les choix sont tirés en partie. */
export interface IdentificationBase extends z.infer<typeof identifierSchema> {
  kind: 'identifier';
}

/** Une identification prête à jouer : quatre choix, dont la bonne réponse à l'index `bonne`. */
export interface Identification extends IdentificationBase {
  choix: string[];
  bonne: number;
}

export type Entree = Estimation | Identification;

/** Banques chargées et validées au démarrage ; une entrée mal formée fait échouer le chargement, pas une partie. */
export const BANQUE: Estimation[] = z
  .object({ entrees: z.array(estimerSchema).min(1) })
  .parse(banqueEstimer)
  .entrees.map((e) => ({ ...e, kind: 'estimer' as const }));

const identificationSchema = z.object({ entrees: z.array(identifierSchema).min(1) });

/** Tableaux (Met Museum) et espèces (iNaturalist) : une seule liste, les distracteurs sont tirés dans le même thème. */
export const BANQUE_IDENTIFICATION: IdentificationBase[] = [
  ...identificationSchema.parse(banqueIdentifier).entrees,
  ...identificationSchema.parse(banqueEspeces).entrees,
].map((e) => ({ ...e, kind: 'identifier' as const }));

/** Points au maximum, et tolérance (écart relatif accepté pour un point) selon le niveau. */
export const MAX_POINTS = 5000;
export const TOLERANCE_BY_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.5, 3: 0.2 };

/** Points d'une bonne réponse en mode Identifier : moins qu'une estimation parfaite, car le choix est fermé. */
export const POINTS_IDENTIFICATION = 1000;
export const NOMBRE_CHOIX = 4;

const ESTIMATE_TIMEOUT = 'estimate-timeout';
const REVEAL_NEXT = 'reveal-next';
const REVEAL_DELAY_MS = 12_000;

export const estimateSchema = z.object({ valeur: z.number().int().min(0).max(1e13) });
export const chooseSchema = z.object({
  choix: z
    .number()
    .int()
    .min(0)
    .max(NOMBRE_CHOIX - 1),
});

/** Points d'une estimation : le maximum pile sur la valeur, nul au-delà de la tolérance. */
export function pointsEstimation(guess: number, reel: number, tolerance: number): number {
  if (reel === 0) return guess === 0 ? MAX_POINTS : 0;
  const ecart = Math.abs(guess - reel) / reel;
  return Math.max(0, Math.round(MAX_POINTS * (1 - ecart / tolerance)));
}

/** Points d'un choix : POINTS_IDENTIFICATION pour la bonne réponse, rien sinon. */
export function pointsIdentification(choix: number, bonne: number): number {
  return choix === bonne ? POINTS_IDENTIFICATION : 0;
}

/**
 * Prépare les quatre choix d'une identification : la bonne réponse et trois autres auteurs tirés dans la banque.
 * Renvoie null s'il n'y a pas assez d'auteurs distincts pour proposer quatre choix.
 */
export function preparerIdentification(base: IdentificationBase, auteurs: string[], random: () => number) {
  const leurres = shuffle([...new Set(auteurs.filter((a) => a !== base.reponse))], random).slice(0, NOMBRE_CHOIX - 1);
  if (leurres.length < NOMBRE_CHOIX - 1) return null;
  const choix = shuffle([base.reponse, ...leurres], random);
  return { ...base, choix, bonne: choix.indexOf(base.reponse) } satisfies Identification;
}

export interface Manche {
  entreeId: string;
  guesses: Record<string, number>;
  gains: Record<string, number>;
}

export interface TirageState {
  settings: TirageSettings;
  phase: 'ready' | 'guess' | 'reveal' | 'final';
  names: Record<string, string>;
  /** Manches tirées pour la partie, sans répétition, estimations et identifications mêlées. */
  entrees: Entree[];
  index: number;
  /** Estimation (valeur) ou choix (index) de chaque joueur pour la manche en cours. */
  guesses: Record<string, number>;
  guessEndsAt: number;
  points: Record<string, number>;
  manches: Manche[];
}

function beginRound(s: TirageState, ctx: GameContext): TirageState {
  const limit = s.settings.guessSeconds * 1000;
  ctx.schedule(ESTIMATE_TIMEOUT, limit);
  return { ...s, phase: 'guess', guesses: {}, guessEndsAt: ctx.now() + limit };
}

function gainOf(entree: Entree, guess: number, difficulty: number): number {
  if (entree.kind === 'estimer') {
    const tolerance = TOLERANCE_BY_DIFFICULTY[difficulty as 1 | 2 | 3];
    return pointsEstimation(guess, entree.valeur, tolerance);
  }
  return pointsIdentification(guess, entree.bonne);
}

function reveal(s: TirageState, ctx: GameContext): TirageState {
  ctx.cancel(ESTIMATE_TIMEOUT);
  const entree = s.entrees[s.index];
  if (!entree) return finish(s, ctx);
  let points = { ...s.points };
  const gains: Record<string, number> = {};
  for (const id of Object.keys(s.names)) {
    const guess = s.guesses[id];
    const gained = guess === undefined ? 0 : gainOf(entree, guess, s.settings.difficulty);
    gains[id] = gained;
    points = addPoints(points, id, gained);
  }
  ctx.schedule(REVEAL_NEXT, REVEAL_DELAY_MS);
  return { ...s, phase: 'reveal', points, manches: [...s.manches, { entreeId: entree.id, guesses: s.guesses, gains }] };
}

function advance(s: TirageState, ctx: GameContext): TirageState {
  ctx.cancel(REVEAL_NEXT);
  if (s.index + 1 < s.entrees.length) return beginRound({ ...s, index: s.index + 1 }, ctx);
  return finish(s, ctx);
}

function finish(s: TirageState, ctx: GameContext): TirageState {
  ctx.cancel(ESTIMATE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  return { ...s, phase: 'final' };
}

/** Ce qui est révélé pour une manche : la valeur ou l'auteur, la source et l'image. */
function answerOf(entree: Entree) {
  if (entree.kind === 'estimer') {
    return {
      valeur: entree.valeur,
      reponse: null,
      source: entree.source,
      theme: entree.theme,
      image: null,
      credit: null,
    };
  }
  return {
    valeur: null,
    reponse: entree.reponse,
    source: entree.source,
    theme: entree.theme,
    image: entree.image,
    credit: entree.credit ?? null,
  };
}

export const tirageSurprise: GameModule<TirageState, TirageSettings> = {
  manifest: {
    id: 'tirage-surprise',
    category: 'quiz',
    name: 'Tirage surprise',
    description: 'Des chiffres réels à deviner, et des tableaux à attribuer : tout est tiré au sort.',
    icon: '🎲',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 8,
    notice: {
      goal: 'Deviner des chiffres réels, ou reconnaître l’auteur d’un tableau.',
      steps: [
        'Lisez la question sur l’écran principal. Elle peut être une estimation ou un choix.',
        'Tapez votre estimation, ou touchez votre choix, sur votre téléphone, avant la fin du temps.',
        'À la révélation, les points viennent de l’écart avec la bonne valeur, ou de la bonne réponse.',
      ],
      tips: [
        'Plus le niveau est difficile, plus la tolérance des estimations est étroite.',
        'Les chiffres viennent de Wikidata (CC0), les tableaux du Met Museum (CC0), les espèces d’iNaturalist (crédit affiché).',
      ],
    },
  },

  settingsSchema: tirageSettingsSchema,
  defaultSettings: tirageSettingsSchema.parse({}),

  actions: { estimate: estimateSchema, choose: chooseSchema },

  initialize(settings, players, ctx) {
    const parsed = tirageSettingsSchema.parse(settings);
    const pool: Array<Estimation | IdentificationBase> = [...BANQUE, ...BANQUE_IDENTIFICATION];
    const entrees: Entree[] = [];
    for (const candidat of shuffle(pool, ctx.random)) {
      if (entrees.length >= parsed.rounds) break;
      if (candidat.kind === 'estimer') {
        entrees.push(candidat);
        continue;
      }
      const memeTheme = BANQUE_IDENTIFICATION.filter((e) => e.theme === candidat.theme).map((e) => e.reponse);
      const prete = preparerIdentification(candidat, memeTheme, ctx.random);
      if (prete) entrees.push(prete);
    }
    return {
      settings: parsed,
      phase: 'ready',
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      entrees,
      index: 0,
      guesses: {},
      guessEndsAt: 0,
      points: {},
      manches: [],
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    return { ...s, names: { ...s.names, [p.id]: p.name } };
  },

  onPlayerLeave(s, p: PlayerRef, ctx) {
    const names = { ...s.names };
    delete names[p.id];
    const next = { ...s, names };
    if (next.phase === 'guess' && everyConnectedDone(ctx, Object.keys(next.names), (id) => id in next.guesses)) {
      return reveal(next, ctx);
    }
    return next;
  },

  start(s, ctx): GameResult<TirageState> {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.entrees.length === 0) return fail('Aucune question disponible');
    return ok(beginRound(s, ctx));
  },

  handleAction(s, p, type, payload, ctx): GameResult<TirageState> {
    if (type !== 'estimate' && type !== 'choose') return fail('Action inconnue');
    if (s.phase !== 'guess') return fail('Pas de question en cours');
    if (!(p.id in s.names)) return fail('Joueur inconnu');
    const entree = s.entrees[s.index];
    if (!entree) return fail('Pas de question en cours');
    let guess: number;
    if (type === 'estimate') {
      if (entree.kind !== 'estimer') return fail('Cette question se répond par un choix');
      guess = (payload as { valeur: number }).valeur;
    } else {
      if (entree.kind !== 'identifier') return fail('Cette question se répond par une estimation');
      guess = (payload as { choix: number }).choix;
      if (guess < 0 || guess >= entree.choix.length) return fail('Choix inconnu');
    }
    const next: TirageState = { ...s, guesses: { ...s.guesses, [p.id]: guess } };
    return ok(everyConnectedDone(ctx, Object.keys(next.names), (id) => id in next.guesses) ? reveal(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === ESTIMATE_TIMEOUT && s.phase === 'guess') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'guess') return reveal(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  calculateScores(s): ScoreEntry[] {
    return rankEntries(s.names, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  // Vue publique : la question et les choix pendant la devinette, la bonne réponse seulement à la révélation.
  getPublicState(s) {
    const entree = s.entrees[s.index];
    const visible = entree && (s.phase === 'guess' || s.phase === 'reveal');
    const revealed = s.phase === 'reveal';
    const last = s.manches[s.manches.length - 1];
    const identification = entree?.kind === 'identifier' ? entree : null;
    const choixDe = (guess: number | null | undefined): string | null =>
      identification && guess !== null && guess !== undefined ? (identification.choix[guess] ?? null) : null;
    return {
      phase: s.phase,
      round: s.index + 1,
      total: s.entrees.length,
      endsAt: s.phase === 'guess' ? s.guessEndsAt : undefined,
      guessSeconds: s.settings.guessSeconds,
      kind: visible ? entree.kind : null,
      question: visible ? entree.question : null,
      unit: visible && entree.kind === 'estimer' ? entree.unite : null,
      image: visible && identification ? identification.image : null,
      choices: visible && s.phase === 'guess' && identification ? identification.choix : null,
      answered: Object.keys(s.guesses).length,
      playerCount: Object.keys(s.names).length,
      answer: revealed && entree ? answerOf(entree) : null,
      placements:
        revealed && last
          ? Object.keys(s.names).map((id) => ({
              playerId: id,
              name: s.names[id] ?? '?',
              guess: last.guesses[id] ?? null,
              choice: choixDe(last.guesses[id]),
              gained: last.gains[id] ?? 0,
            }))
          : [],
      ranking: rankEntries(s.names, s.points),
    };
  },

  // Vue privée : sa propre réponse, jamais celles des autres avant la révélation.
  getPlayerState(s, playerId) {
    const rank = rankEntries(s.names, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      myGuess: s.guesses[playerId] ?? null,
      guessed: playerId in s.guesses,
      points: s.points[playerId] ?? 0,
      rank,
    };
  },

  getHostState(s) {
    return {
      pending:
        s.phase === 'guess'
          ? Object.keys(s.names)
              .filter((id) => !(id in s.guesses))
              .map((id) => s.names[id])
          : [],
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  // Mode test : un robot répond au hasard (une estimation entre la moitié et le double, ou un choix au hasard).
  suggest(s, playerId, random) {
    const entree = s.entrees[s.index];
    if (s.phase !== 'guess' || !entree || playerId in s.guesses) return null;
    const delayMs = 3000 + random() * 5000;
    const key = `answer-${s.index}-${playerId}`;
    if (entree.kind === 'identifier') {
      return {
        type: 'choose',
        payload: { choix: Math.floor(random() * entree.choix.length) },
        key,
        delayMs,
      };
    }
    return {
      type: 'estimate',
      payload: { valeur: Math.round(entree.valeur * (0.5 + random() * 1.5)) },
      key,
      delayMs,
    };
  },
};

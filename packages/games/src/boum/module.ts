import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { fail, ok, shuffle } from '../common/engine.js';
import { matchAnswer, normalizeAnswer } from '../media-quiz/answer.js';
import { MODE_BY_ID, FAMILY_COLORS, MIME_SECONDS, type ModeDef, type ModeId } from './modes.js';
import { drawModes, eligibleModes, type RoomRules } from './pool.js';
import { COUNTRY_CENTROIDS, COUNTRY_NAMES_FR } from './geo/countries-data.js';
import { COUNTRY_CODES } from './bank/countries.js';
import {
  closestPoints,
  countryPoints,
  detectorPoints,
  haversineKm,
  PERFORMER_POINTS_PER_FINDER,
  PROBABLE_POINTS,
  quickPoints,
  rankStandings,
  VOTE_POINTS,
} from './scoring.js';
import { currentBoumBank, type BankSnapshot } from './bank/registry.js';
import { BANK_TYPE_INFO, type BankType, type Level } from './bank/types.js';

/**
 * BOUM ! : un tirage de cinq manches dans un pool de modes, joué sur l'écran principal et les téléphones.
 * Phase 1 : modes texte, vote et cartes. Les banques sont lues à la création de la salle (instantané).
 */

export const boumSettingsSchema = z.object({
  rounds: z.number().int().min(3).max(8).default(5),
  writeSeconds: z.number().int().min(15).max(120).default(45),
  voteSeconds: z.number().int().min(10).max(60).default(25),
  /** Pack Humour noir : activé à la création de la salle, avec un avertissement à l'entrée. */
  pack: z.boolean().default(false),
  /** Ton corsé (en plus du doux). */
  corse: z.boolean().default(false),
  /** Effets de mise en scène sur l'écran principal. */
  effects: z.enum(['complets', 'reduits', 'aucun']).default('reduits'),
});

export type BoumSettings = z.infer<typeof boumSettingsSchema>;

export type BoumPhase = 'ready' | 'announce' | 'write' | 'vote' | 'rate' | 'reveal' | 'final';

const ANNOUNCE_MS = 2500;
const REVEAL_MS = 9000;
const TIMER = 'boum-timer';
const ANNOUNCE_TIMER = 'boum-announce';
const REVEAL_TIMER = 'boum-reveal';
const MAX_TEXT = 200;

export interface Prompt {
  id: string;
  type: BankType;
  level: Level;
  text: string;
  answer: string | null;
}

export interface BoumRound {
  mode: ModeId;
  prompt: Prompt | null;
  /** Joueur qui se défend (détecteur). */
  pleader: string | null;
  /** Dernier texte écrit ou carte jouée, par joueur. Jamais montré avant le vote. */
  writings: Record<string, string>;
  guesses: Record<string, number>;
  /** Bonnes réponses dans l'ordre d'arrivée (réponse rapide). */
  correct: string[];
  /** Cartes en main (main sale), par joueur. */
  hands: Record<string, string[]>;
  /** Carte jouée : index dans la main. */
  played: Record<string, number>;
  /** Où est-ce ? : pays choisi par chaque joueur (code ISO). */
  picks: Record<string, string>;
  /** Devine la chanson : extrait chanté par le chanteur (data URL audio), ou null. */
  clip: string | null;
  /** Options de vote : identifiants des auteurs (ou des joueurs visés), dans un ordre aléatoire. */
  options: string[];
  votes: Record<string, number | string>;
  ratings: Record<string, number>;
  endsAt: number;
  durationMs: number;
  gains: Record<string, number>;
}

export interface BoumState {
  settings: BoumSettings;
  phase: BoumPhase;
  players: Record<string, string>;
  points: Record<string, number>;
  fiveStars: Record<string, number>;
  modes: ModeId[];
  index: number;
  round: BoumRound | null;
  /** Toutes les entrées utilisables de la salle, par type. */
  pool: Partial<Record<BankType, Prompt[]>>;
  /** Entrées pas encore tirées dans cette partie, par type. */
  queues: Partial<Record<BankType, Prompt[]>>;
}

const answerSchema = z.object({ text: z.string().trim().min(1).max(MAX_TEXT) });
const guessSchema = z.object({ value: z.number().int().min(0).max(999_999_999) });
const pickSchema = z.object({ card: z.number().int().min(0).max(3) });
const voteSchema = z.object({
  option: z.number().int().min(0).max(19).optional(),
  player: z.string().min(1).max(64).optional(),
});
const rateSchema = z.object({ stars: z.number().int().min(1).max(5) });
const countrySchema = z.object({ code: z.string().length(2) });
/** Extrait chanté : même format que les sons d'Imite-moi, moins de 60 000 caractères par action. */
const CLIP_MAX_CHARS = 60_000;
const CLIP_URL = /^data:audio\/(webm|ogg|mp4)(;codecs=[A-Za-z0-9.,-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/;
const clipSchema = z.object({ dataUrl: z.string().max(CLIP_MAX_CHARS).regex(CLIP_URL, 'Extrait invalide') });
/** Photo-défi : une photo JPEG réduite, comme celles d'Imite-moi (moins de 60 000 caractères). */
const PHOTO_MAX_CHARS = 60_000;
const PHOTO_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const photoSchema = z.object({ dataUrl: z.string().max(PHOTO_MAX_CHARS).regex(PHOTO_URL, 'Photo invalide') });

export const boumActions = {
  answer: answerSchema,
  guess: guessSchema,
  pick: pickSchema,
  vote: voteSchema,
  rate: rateSchema,
  country: countrySchema,
  clip: clipSchema,
  photo: photoSchema,
};

/** Indice du mot secret : un seul mot, qui ne reprend ni le mot à deviner ni l'un de ses mots longs. */
function clueProblem(clue: string, word: string): string | null {
  const trimmed = clue.trim();
  if (/\s/.test(trimmed)) return 'L’indice doit être un seul mot';
  const folded = normalizeAnswer(trimmed);
  const target = normalizeAnswer(word);
  const tokens = target.split(' ').filter((t) => t.length >= 4);
  if (folded === target || tokens.some((t) => folded.includes(t) || (folded.length >= 4 && t.includes(folded)))) {
    return 'L’indice ne doit pas reprendre le mot à deviner';
  }
  return null;
}

const CARD_HAND = 4;

function levelsOf(settings: BoumSettings): Level[] {
  const levels: Level[] = ['doux'];
  if (settings.corse) levels.push('corse');
  if (settings.pack) levels.push('limite');
  return levels;
}

function roomRules(settings: BoumSettings, players: number): RoomRules {
  return { players, pack: settings.pack, corse: settings.corse };
}

/** Entrées de la banque utilisables dans la salle, groupées par type. */
export function buildPool(snapshot: BankSnapshot, levels: readonly Level[]): Partial<Record<BankType, Prompt[]>> {
  const pool: Partial<Record<BankType, Prompt[]>> = {};
  for (const entry of snapshot.entries) {
    if (!levels.includes(entry.level)) continue;
    (pool[entry.type] ??= []).push({ ...entry });
  }
  return pool;
}

/** Tire `count` entrées d'un type. Quand la file est vide, elle se recharge (répétitions acceptées). */
function take(
  state: BoumState,
  type: BankType,
  count: number,
  ctx: GameContext,
): { items: Prompt[]; queues: BoumState['queues'] } {
  let queue = [...(state.queues[type] ?? [])];
  const items: Prompt[] = [];
  const full = state.pool[type] ?? [];
  while (items.length < count && full.length > 0) {
    if (queue.length === 0) queue = shuffle(full, ctx.random);
    items.push(queue.shift()!);
  }
  return { items, queues: { ...state.queues, [type]: queue } };
}

function countValidOf(pool: BoumState['pool']) {
  return (type: BankType, levels: readonly Level[]) =>
    (pool[type] ?? []).filter((entry) => levels.includes(entry.level)).length;
}

function emptyRound(mode: ModeId, endsAt: number, durationMs: number): BoumRound {
  return {
    mode,
    prompt: null,
    pleader: null,
    writings: {},
    guesses: {},
    correct: [],
    hands: {},
    played: {},
    picks: {},
    clip: null,
    options: [],
    votes: {},
    ratings: {},
    endsAt,
    durationMs,
    gains: {},
  };
}

function clearTimers(ctx: GameContext): void {
  ctx.cancel(TIMER);
  ctx.cancel(ANNOUNCE_TIMER);
  ctx.cancel(REVEAL_TIMER);
}

function currentMode(state: BoumState): ModeDef | undefined {
  const id = state.modes[state.index];
  return id ? MODE_BY_ID[id] : undefined;
}

/** Classement courant (points, puis 5 étoiles, puis nom). */
function standingsOf(state: BoumState) {
  return rankStandings(
    Object.keys(state.players).map((id) => ({
      id,
      name: state.players[id] ?? '?',
      points: state.points[id] ?? 0,
      fiveStars: state.fiveStars[id] ?? 0,
    })),
  );
}

function connectedOf(state: BoumState, ctx: GameContext): string[] {
  const connected = new Set(ctx.connectedPlayerIds());
  return Object.keys(state.players).filter((id) => connected.has(id));
}

/* ------------------------------------------------------------------------- */
/* Déroulement d'une manche                                                    */
/* ------------------------------------------------------------------------- */

function startRound(state: BoumState, ctx: GameContext): BoumState {
  const mode = currentMode(state)!;
  clearTimers(ctx);
  ctx.schedule(ANNOUNCE_TIMER, ANNOUNCE_MS);
  return {
    ...state,
    phase: 'announce',
    round: emptyRound(mode.id, ctx.now() + ANNOUNCE_MS, ANNOUNCE_MS),
  };
}

/** Ouvre la manche après l'annonce : tire la consigne, les cartes, et le premier temps de saisie. */
function openRound(state: BoumState, ctx: GameContext): BoumState {
  const mode = currentMode(state);
  if (!mode || !state.round) return finish(state, ctx);
  let s = state;
  const round: BoumRound = { ...state.round };
  const ids = Object.keys(s.players);

  switch (mode.kind) {
    case 'reponse':
    case 'chiffre': {
      const { items, queues } = take(s, mode.needs[0]!.type, 1, ctx);
      s = { ...s, queues };
      round.prompt = items[0] ?? null;
      break;
    }
    case 'ecriture_vote':
    case 'photo': {
      const { items, queues } = take(s, mode.needs[0]!.type, 1, ctx);
      s = { ...s, queues };
      round.prompt = items[0] ?? null;
      break;
    }
    case 'carte_vote': {
      const phrase = take(s, 'phrase_trous', 1, ctx);
      s = { ...s, queues: phrase.queues };
      round.prompt = phrase.items[0] ?? null;
      const cards = take(s, 'carte_reponse', CARD_HAND * ids.length, ctx);
      s = { ...s, queues: cards.queues };
      const deck = cards.items.map((c) => c.text);
      ids.forEach((id, i) => {
        round.hands[id] = deck.slice(i * CARD_HAND, (i + 1) * CARD_HAND);
      });
      break;
    }
    case 'vote_joueur': {
      const { items, queues } = take(s, 'situation', 1, ctx);
      s = { ...s, queues };
      round.prompt = items[0] ?? null;
      round.options = shuffle(ids, ctx.random);
      break;
    }
    case 'detecteur': {
      const { items, queues } = take(s, 'situation', 1, ctx);
      s = { ...s, queues };
      round.prompt = items[0] ?? null;
      const sorted = [...ids].sort();
      round.pleader = sorted[s.index % sorted.length] ?? null;
      break;
    }
    case 'pays': {
      const { items, queues } = take(s, mode.needs[0]!.type, 1, ctx);
      s = { ...s, queues };
      round.prompt = items[0] ?? null;
      break;
    }
    case 'chanson':
    case 'mime':
    case 'mot_secret': {
      const { items, queues } = take(s, mode.needs[0]!.type, 1, ctx);
      s = { ...s, queues };
      round.prompt = items[0] ?? null;
      const sorted = [...ids].sort();
      round.pleader = sorted[s.index % sorted.length] ?? null;
      break;
    }
    case 'vrai_ou_faux':
      break;
  }

  const seconds =
    mode.kind === 'vote_joueur'
      ? s.settings.voteSeconds
      : mode.kind === 'mime' || mode.kind === 'chanson' || mode.kind === 'mot_secret'
        ? MIME_SECONDS
        : s.settings.writeSeconds;
  const durationMs = seconds * 1000;
  ctx.schedule(TIMER, durationMs);
  round.endsAt = ctx.now() + durationMs;
  round.durationMs = durationMs;
  return { ...s, phase: mode.kind === 'vote_joueur' ? 'vote' : 'write', round };
}

/** Passe à la phase de vote des textes écrits, ou à la révélation s'il n'y a pas assez de textes. */
function toVote(state: BoumState, ctx: GameContext): BoumState {
  const round = state.round!;
  const authors = shuffle(Object.keys(round.writings), ctx.random);
  if (authors.length < 2) return reveal({ ...state, round: { ...round, options: authors } }, ctx);
  clearTimers(ctx);
  const ms = state.settings.voteSeconds * 1000;
  ctx.schedule(TIMER, ms);
  return {
    ...state,
    phase: 'vote',
    round: { ...round, options: authors, endsAt: ctx.now() + ms, durationMs: ms },
  };
}

function toRate(state: BoumState, ctx: GameContext): BoumState {
  const round = state.round!;
  if (!round.writings[round.pleader ?? '']) return reveal(state, ctx);
  clearTimers(ctx);
  const ms = state.settings.voteSeconds * 1000;
  ctx.schedule(TIMER, ms);
  return { ...state, phase: 'rate', round: { ...round, endsAt: ctx.now() + ms, durationMs: ms } };
}

/** Calcule les gains de la manche, les ajoute aux points, et ouvre la révélation. */
function reveal(state: BoumState, ctx: GameContext): BoumState {
  clearTimers(ctx);
  const mode = currentMode(state)!;
  const round = state.round!;
  const gains: Record<string, number> = {};
  const add = (id: string, pts: number) => {
    if (pts > 0) gains[id] = (gains[id] ?? 0) + pts;
  };
  const fiveStars = { ...state.fiveStars };

  switch (mode.kind) {
    case 'reponse': {
      for (const [id, pts] of Object.entries(quickPoints(round.correct))) add(id, pts);
      break;
    }
    case 'pays': {
      const answer = round.prompt?.answer ?? '';
      for (const [id, pts] of Object.entries(countryPoints(round.picks, answer, COUNTRY_CENTROIDS))) add(id, pts);
      break;
    }
    case 'mot_secret': {
      // Le mot trouvé rapporte 100 au joueur désigné, et 50 à chaque auteur d'indice.
      if (round.pleader && round.correct.includes(round.pleader)) {
        add(round.pleader, 100);
        for (const id of Object.keys(round.writings)) add(id, 50);
      }
      break;
    }
    case 'chanson':
    case 'mime': {
      for (const [id, pts] of Object.entries(quickPoints(round.correct))) add(id, pts);
      if (round.pleader) add(round.pleader, PERFORMER_POINTS_PER_FINDER * round.correct.length);
      break;
    }
    case 'chiffre': {
      const answer = Number(round.prompt?.answer ?? NaN);
      if (Number.isFinite(answer)) {
        const guesses = Object.entries(round.guesses).map(([id, value]) => ({ id, value }));
        for (const [id, pts] of Object.entries(closestPoints(guesses, answer))) add(id, pts);
      }
      break;
    }
    case 'ecriture_vote':
    case 'photo':
    case 'carte_vote':
    case 'vrai_ou_faux': {
      for (const option of Object.values(round.votes)) {
        const author = round.options[option as number];
        if (author !== undefined) add(author, VOTE_POINTS);
      }
      break;
    }
    case 'vote_joueur': {
      for (const target of Object.values(round.votes)) add(String(target), PROBABLE_POINTS);
      break;
    }
    case 'detecteur': {
      const pleader = round.pleader;
      if (pleader && round.writings[pleader]) {
        const stars = Object.values(round.ratings);
        add(pleader, detectorPoints(stars));
        fiveStars[pleader] = (fiveStars[pleader] ?? 0) + stars.filter((s) => s === 5).length;
      }
      break;
    }
  }

  const points = { ...state.points };
  for (const [id, pts] of Object.entries(gains)) points[id] = (points[id] ?? 0) + pts;
  ctx.schedule(REVEAL_TIMER, REVEAL_MS);
  return {
    ...state,
    phase: 'reveal',
    points,
    fiveStars,
    round: { ...round, gains, endsAt: ctx.now() + REVEAL_MS, durationMs: REVEAL_MS },
  };
}

/** Manche suivante, ou fin de partie. */
function nextRound(state: BoumState, ctx: GameContext): BoumState {
  clearTimers(ctx);
  if (state.index + 1 < state.modes.length) {
    return startRound({ ...state, index: state.index + 1 }, ctx);
  }
  return finish(state, ctx);
}

function finish(state: BoumState, ctx: GameContext): BoumState {
  clearTimers(ctx);
  return { ...state, phase: 'final', round: null };
}

/** Réponse rapide : la manche se termine quand chaque joueur connecté a trouvé ou écrit. */
function maybeAdvanceQuick(state: BoumState, ctx: GameContext): BoumState {
  const round = state.round!;
  const mode = currentMode(state);
  const connected = connectedOf(state, ctx);
  if (mode?.kind === 'mime' || mode?.kind === 'chanson') {
    // Le mimeur ou le chanteur ne devine pas : la manche finit quand tous les autres ont trouvé.
    const guessers = connected.filter((id) => id !== round.pleader);
    return guessers.every((id) => round.correct.includes(id)) ? reveal(state, ctx) : state;
  }
  if (connected.every((id) => round.correct.includes(id) || id in round.writings)) return reveal(state, ctx);
  return state;
}

/** Vote : la révélation s'ouvre dès que chaque joueur connecté a voté. */
function maybeFinishVote(state: BoumState, ctx: GameContext): BoumState {
  const round = state.round!;
  const connected = connectedOf(state, ctx);
  if (connected.every((id) => id in round.votes)) return reveal(state, ctx);
  return state;
}

/** Fin de saisie : la manche avance dès que le mode n'attend plus personne. */
function afterWrite(state: BoumState, ctx: GameContext): BoumState {
  const mode = currentMode(state)!;
  const round = state.round!;
  const connected = connectedOf(state, ctx);
  switch (mode.kind) {
    case 'reponse':
      return reveal(state, ctx);
    case 'chiffre':
      return connected.every((id) => id in round.guesses) ? reveal(state, ctx) : state;
    case 'ecriture_vote':
    case 'photo':
    case 'vrai_ou_faux':
    case 'carte_vote':
      return connected.every((id) => id in round.writings) ? toVote(state, ctx) : state;
    case 'detecteur':
      return toRate(state, ctx);
    case 'pays':
      return connected.every((id) => id in round.picks) ? reveal(state, ctx) : state;
    default:
      return state;
  }
}

/* ------------------------------------------------------------------------- */
/* Module                                                                      */
/* ------------------------------------------------------------------------- */

export function createBoum(getBank: () => BankSnapshot = currentBoumBank): GameModule<BoumState, BoumSettings> {
  return {
    manifest: {
      id: 'boum',
      category: 'quiz',
      name: 'BOUM !',
      description: 'Des manches tirées au hasard : écrivez, votez, bluffez. Chaque manche change de mode.',
      icon: '💥',
      version: '1.0.0',
      apiVersion: 1,
      minPlayers: 2,
      maxPlayers: 12,
      durationMin: 12,
      notice: {
        goal: 'Gagnez le plus de points sur cinq manches tirées au hasard.',
        steps: [
          'L’écran principal annonce le mode de la manche.',
          'Sur votre téléphone, écrivez, jouez une carte, estimez ou votez selon la consigne.',
          'Les points tombent à la révélation : chaque vote reçu rapporte des points à son auteur.',
          'Le classement final désigne le vainqueur.',
        ],
        tips: [
          'Le pack Humour noir contient des contenus plus osés : activez-le en connaissance de cause.',
          'Un mode sans assez de contenu validé n’est jamais tiré : la partie continue avec les autres.',
        ],
      },
    },

    settingsSchema: boumSettingsSchema,
    defaultSettings: boumSettingsSchema.parse({}),
    actions: boumActions,

    initialize(settings, players) {
      const parsed = boumSettingsSchema.parse(settings);
      return {
        settings: parsed,
        phase: 'ready',
        players: Object.fromEntries(players.map((p) => [p.id, p.name])),
        points: Object.fromEntries(players.map((p) => [p.id, 0])),
        fiveStars: {},
        modes: [],
        index: 0,
        round: null,
        pool: {},
        queues: {},
      };
    },

    onPlayerJoin(state, player) {
      return {
        ...state,
        players: { ...state.players, [player.id]: player.name },
        points: { ...state.points, [player.id]: state.points[player.id] ?? 0 },
      };
    },

    onPlayerLeave(state, player) {
      const players = { ...state.players };
      delete players[player.id];
      return { ...state, players };
    },

    start(state, ctx): GameResult<BoumState> {
      if (state.phase !== 'ready') return fail('La partie a déjà commencé');
      const count = Object.keys(state.players).length;
      if (count < 2) return fail('Il faut au moins 2 joueurs');

      const pool = buildPool(getBank(), levelsOf(state.settings));
      const rules = roomRules(state.settings, count);
      const eligible = eligibleModes(rules, countValidOf(pool));
      if (eligible.length === 0) {
        return fail('Aucun mode jouable : les banques validées sont trop peu fournies pour cette salle.');
      }
      const modes = drawModes(eligible, state.settings.rounds, ctx.random);
      const started = { ...state, pool, queues: {}, modes, index: 0 };
      return ok(startRound(started, ctx));
    },

    handleAction(state, player: PlayerRef, type, payload, ctx): GameResult<BoumState> {
      if (!(player.id in state.players)) return fail('Vous ne jouez pas cette partie');
      const round = state.round;
      const mode = currentMode(state);
      if (!round || !mode) return fail('Aucune manche en cours');
      const pid = player.id;

      if (type === 'photo') {
        if (mode.kind !== 'photo') return fail('Pas de photo à envoyer pour cette manche');
        if (state.phase !== 'write') return fail('Le temps est écoulé');
        if (pid in round.writings) return fail('Vous avez déjà envoyé votre photo');
        const parsed = photoSchema.safeParse(payload);
        if (!parsed.success) return fail('Photo invalide');
        const next = { ...round, writings: { ...round.writings, [pid]: parsed.data.dataUrl } };
        return ok(afterWrite({ ...state, round: next }, ctx));
      }

      if (type === 'answer') {
        const { text } = payload as { text: string };
        if (mode.kind === 'mot_secret') {
          if (state.phase !== 'write') return fail('Le temps est écoulé');
          const word = round.prompt?.text ?? '';
          if (pid === round.pleader) {
            // Le joueur désigné devine : une bonne réponse termine la manche.
            if (!matchAnswer(text, { answer: word, aliases: [] })) return fail('Ce n’est pas le mot');
            return ok(reveal({ ...state, round: { ...round, correct: [pid] } }, ctx));
          }
          if (pid in round.writings) return fail('Vous avez déjà donné votre indice');
          const problem = clueProblem(text, word);
          if (problem) return fail(problem);
          return ok({ ...state, round: { ...round, writings: { ...round.writings, [pid]: text.trim() } } });
        }
        if (mode.kind === 'reponse' || mode.kind === 'mime' || mode.kind === 'chanson') {
          if (state.phase !== 'write') return fail('Le temps est écoulé');
          if (mode.kind === 'mime' && pid === round.pleader) return fail('Vous mimez : vous ne tapez pas le métier');
          if (mode.kind === 'chanson' && pid === round.pleader) return fail('Vous chantez : vous ne devinez pas');
          if (mode.kind === 'chanson' && !round.clip) return fail('Attendez l’extrait du chanteur');
          if (round.correct.includes(pid)) return fail('Vous avez déjà trouvé');
          const target = mode.kind === 'mime' ? (round.prompt?.text ?? '') : (round.prompt?.answer ?? '');
          // Devine la chanson : plusieurs bonnes réponses possibles, séparées par « / ».
          const parts =
            mode.kind === 'chanson'
              ? target
                  .split('/')
                  .map((part) => part.trim())
                  .filter(Boolean)
              : [target];
          const right = matchAnswer(text, { answer: parts[0] ?? '', aliases: parts.slice(1) });
          const next: BoumRound = { ...round, writings: { ...round.writings, [pid]: text } };
          if (right) next.correct = [...round.correct, pid];
          return ok(maybeAdvanceQuick({ ...state, round: next }, ctx));
        }
        if (mode.kind === 'detecteur') {
          if (state.phase !== 'write') return fail('Ce n’est pas le moment');
          if (pid !== round.pleader) return fail('Seul le joueur qui se défend écrit ici');
          return ok(afterWrite({ ...state, round: { ...round, writings: { ...round.writings, [pid]: text } } }, ctx));
        }
        if (mode.kind === 'ecriture_vote' || mode.kind === 'vrai_ou_faux') {
          if (state.phase !== 'write') return fail('Le temps est écoulé');
          return ok(afterWrite({ ...state, round: { ...round, writings: { ...round.writings, [pid]: text } } }, ctx));
        }
        return fail('Pas de texte à écrire pour cette manche');
      }

      if (type === 'clip') {
        if (mode.kind !== 'chanson') return fail('Pas d’extrait à chanter pour cette manche');
        if (state.phase !== 'write') return fail('Le temps est écoulé');
        if (pid !== round.pleader) return fail('Seul le chanteur envoie l’extrait');
        if (round.clip) return fail('Extrait déjà envoyé');
        // Le moteur valide déjà l'action ; on revérifie ici pour que la règle tienne seule.
        const parsed = clipSchema.safeParse(payload);
        if (!parsed.success) return fail('Extrait invalide');
        return ok({ ...state, round: { ...round, clip: parsed.data.dataUrl } });
      }

      if (type === 'country') {
        if (mode.kind !== 'pays') return fail('Pas de pays à choisir pour cette manche');
        if (state.phase !== 'write') return fail('Le temps est écoulé');
        if (pid in round.picks) return fail('Vous avez déjà choisi un pays');
        const { code } = payload as { code: string };
        if (!(COUNTRY_CODES as readonly string[]).includes(code)) return fail('Pays inconnu');
        return ok(afterWrite({ ...state, round: { ...round, picks: { ...round.picks, [pid]: code } } }, ctx));
      }

      if (type === 'guess') {
        if (mode.kind !== 'chiffre') return fail('Pas d’estimation pour cette manche');
        if (state.phase !== 'write') return fail('Le temps est écoulé');
        const { value } = payload as { value: number };
        const next: BoumRound = { ...round, guesses: { ...round.guesses, [pid]: value } };
        return ok(afterWrite({ ...state, round: next }, ctx));
      }

      if (type === 'pick') {
        if (mode.kind !== 'carte_vote') return fail('Pas de carte à jouer pour cette manche');
        if (state.phase !== 'write') return fail('Le temps est écoulé');
        const { card } = payload as { card: number };
        const hand = round.hands[pid] ?? [];
        if (card >= hand.length) return fail('Carte invalide');
        const next: BoumRound = {
          ...round,
          played: { ...round.played, [pid]: card },
          writings: { ...round.writings, [pid]: hand[card]! },
        };
        return ok(afterWrite({ ...state, round: next }, ctx));
      }

      if (type === 'vote') {
        if (state.phase !== 'vote') return fail('Le vote n’est pas ouvert');
        if (round.votes[pid] !== undefined) return fail('Vous avez déjà voté');
        const body = payload as { option?: number; player?: string };
        if (mode.kind === 'vote_joueur') {
          if (!body.player || !(body.player in state.players)) return fail('Joueur inconnu');
          if (body.player === pid) return fail('Vous ne pouvez pas voter pour vous-même');
          const next: BoumRound = { ...round, votes: { ...round.votes, [pid]: body.player } };
          return ok(maybeFinishVote({ ...state, round: next }, ctx));
        }
        if (body.option === undefined || body.option >= round.options.length) return fail('Choix invalide');
        if (round.options[body.option] === pid) return fail('Vous ne pouvez pas voter pour votre propre texte');
        const next: BoumRound = { ...round, votes: { ...round.votes, [pid]: body.option } };
        return ok(maybeFinishVote({ ...state, round: next }, ctx));
      }

      if (type === 'rate') {
        if (state.phase !== 'rate') return fail('La notation n’est pas ouverte');
        if (pid === round.pleader) return fail('On ne se note pas soi-même');
        if (round.ratings[pid] !== undefined) return fail('Vous avez déjà noté');
        const { stars } = payload as { stars: number };
        const next: BoumRound = { ...round, ratings: { ...round.ratings, [pid]: stars } };
        const judges = connectedOf(state, ctx).filter((id) => id !== round.pleader);
        if (judges.every((id) => id in next.ratings)) return ok(reveal({ ...state, round: next }, ctx));
        return ok({ ...state, round: next });
      }

      return fail('Action inconnue');
    },

    onTimer(state, key, ctx) {
      if (key === ANNOUNCE_TIMER) return openRound(state, ctx);
      if (key === REVEAL_TIMER) return nextRound(state, ctx);
      if (key !== TIMER) return state;
      const mode = currentMode(state);
      if (!mode || !state.round) return state;
      if (state.phase === 'write') {
        if (mode.kind === 'carte_vote') {
          const round = { ...state.round, played: { ...state.round.played }, writings: { ...state.round.writings } };
          for (const id of Object.keys(state.players)) {
            if (id in round.played) continue;
            const hand = round.hands[id] ?? [];
            if (hand.length === 0) continue;
            const card = Math.floor(ctx.random() * hand.length);
            round.played[id] = card;
            round.writings[id] = hand[card]!;
          }
          return toVote({ ...state, round }, ctx);
        }
        if (mode.kind === 'ecriture_vote' || mode.kind === 'vrai_ou_faux' || mode.kind === 'photo')
          return toVote(state, ctx);
        if (mode.kind === 'detecteur') return toRate(state, ctx);
        return reveal(state, ctx);
      }
      if (state.phase === 'vote') return reveal(state, ctx);
      if (state.phase === 'rate') return reveal(state, ctx);
      return state;
    },

    nextRound(state, ctx) {
      return nextRound(state, ctx);
    },

    calculateScores(state): ScoreEntry[] {
      return standingsOf(state).map((entry) => ({
        playerId: entry.id,
        name: entry.name,
        points: entry.points,
        rank: entry.rank,
      }));
    },

    end(state, ctx) {
      return finish(state, ctx);
    },

    getPublicState(state) {
      const mode = currentMode(state);
      const round = state.round;
      const base = {
        phase: state.phase,
        effects: state.settings.effects,
        pack: state.settings.pack,
        index: state.index,
        total: state.modes.length,
        players: Object.values(state.players).length,
        ranking: standingsOf(state).map((r) => ({ playerId: r.id, name: r.name, points: r.points, rank: r.rank })),
        mode: mode
          ? {
              id: mode.id,
              title: mode.title,
              brief: mode.brief,
              family: mode.family,
              color: mode.pack ? FAMILY_COLORS.noir : FAMILY_COLORS[mode.family],
              pack: mode.pack,
              kind: mode.kind,
            }
          : null,
      };
      if (!round || !mode || state.phase === 'ready' || state.phase === 'final') return base;

      // Le métier du mime ne sort jamais de la vue du mimeur : l'écran et les autres téléphones ne le voient pas.
      const prompt =
        round.prompt && mode.kind !== 'mime' && mode.kind !== 'chanson' && mode.kind !== 'mot_secret'
          ? {
              type: round.prompt.type,
              text: round.prompt.text,
              label: BANK_TYPE_INFO[round.prompt.type].label,
            }
          : null;
      const timed = { endsAt: round.endsAt, durationMs: round.durationMs };
      const pleader = round.pleader ? (state.players[round.pleader] ?? null) : null;

      if (state.phase === 'announce') return { ...base, ...timed, prompt: null };

      if (state.phase === 'write') {
        return {
          ...base,
          ...timed,
          prompt,
          pleader,
          written: Object.keys(round.writings).length,
          picked: Object.keys(round.picks).length,
          clip: mode.kind === 'chanson' ? round.clip : null,
          clues:
            mode.kind === 'mot_secret' ? Object.values(round.writings).sort((a, b) => a.localeCompare(b, 'fr')) : null,
          found: round.correct.length,
          guessed: Object.keys(round.guesses).length,
          played: Object.keys(round.played).length,
        };
      }

      if (state.phase === 'vote') {
        const options =
          mode.kind === 'vote_joueur'
            ? round.options.map((id) => ({ id, label: state.players[id] ?? '?' }))
            : round.options.map((id, i) => ({
                id: String(i),
                label: mode?.kind === 'photo' ? '' : (round.writings[id] ?? ''),
                image: mode?.kind === 'photo' ? (round.writings[id] ?? null) : null,
              }));
        return { ...base, ...timed, prompt, pleader, options, voted: Object.keys(round.votes).length };
      }

      if (state.phase === 'rate') {
        return {
          ...base,
          ...timed,
          prompt,
          pleader,
          excuse: round.writings[round.pleader ?? ''] ?? '',
          rated: Object.keys(round.ratings).length,
        };
      }

      // Révélation : les réponses, les auteurs et les gains deviennent publics.
      return { ...base, ...timed, prompt, pleader, reveal: revealView(state, round, mode) };
    },

    getPlayerState(state, playerId) {
      const round = state.round;
      const mode = currentMode(state);
      const rank = standingsOf(state).find((r) => r.id === playerId)?.rank ?? null;
      if (!round || !mode) return { phase: state.phase, points: state.points[playerId] ?? 0, rank };
      const hand = round.hands[playerId] ?? [];
      const myVote = round.votes[playerId] ?? null;
      // Index de sa propre option de vote (ses textes ne se votent pas) : rien de secret pour lui.
      const ownOption = round.options.indexOf(playerId);
      const mustAct =
        (state.phase === 'write' &&
          ((mode.kind === 'reponse' && !round.correct.includes(playerId)) ||
            (mode.kind === 'pays' && !(playerId in round.picks)) ||
            (mode.kind === 'chanson' && playerId === round.pleader && !round.clip) ||
            (mode.kind === 'chanson' &&
              playerId !== round.pleader &&
              round.clip !== null &&
              !round.correct.includes(playerId)) ||
            (mode.kind === 'mot_secret' &&
              (playerId === round.pleader ? !round.correct.includes(playerId) : !(playerId in round.writings))) ||
            (mode.kind === 'mime' && playerId !== round.pleader && !round.correct.includes(playerId)) ||
            (mode.kind === 'chiffre' && !(playerId in round.guesses)) ||
            (mode.kind === 'photo' && !(playerId in round.writings)) ||
            (mode.kind === 'ecriture_vote' && !(playerId in round.writings)) ||
            (mode.kind === 'vrai_ou_faux' && !(playerId in round.writings)) ||
            (mode.kind === 'carte_vote' && !(playerId in round.played)) ||
            (mode.kind === 'detecteur' && playerId === round.pleader && !(playerId in round.writings)))) ||
        (state.phase === 'vote' && myVote === null) ||
        (state.phase === 'rate' && playerId !== round.pleader && !(playerId in round.ratings));
      return {
        phase: state.phase,
        isPleader: playerId === round.pleader,
        // Le mimeur seul voit le métier, pendant la manche.
        secretWord:
          (mode.kind === 'mime' || mode.kind === 'chanson' || mode.kind === 'mot_secret') &&
          state.phase === 'write' &&
          playerId === round.pleader
            ? (round.prompt?.text ?? null)
            : null,
        mustAct,
        hand: mode.kind === 'carte_vote' ? hand : [],
        played: round.played[playerId] ?? null,
        myText: mode.kind === 'photo' ? null : (round.writings[playerId] ?? null),
        found: round.correct.includes(playerId),
        myVote,
        ownOption: ownOption >= 0 ? ownOption : null,
        myRating: round.ratings[playerId] ?? null,
        points: state.points[playerId] ?? 0,
        fiveStars: state.fiveStars[playerId] ?? 0,
        rank,
      };
    },

    getHostState(state) {
      const round = state.round;
      const connected = Object.keys(state.players);
      const waiting = (() => {
        if (!round) return [];
        if (state.phase === 'write') {
          const mode = currentMode(state);
          if (mode?.kind === 'chiffre') return connected.filter((id) => !(id in round.guesses));
          if (mode?.kind === 'reponse') return connected.filter((id) => !round.correct.includes(id));
          if (mode?.kind === 'pays') return connected.filter((id) => !(id in round.picks));
          if (mode?.kind === 'chanson') {
            if (!round.clip) return round.pleader ? [round.pleader] : [];
            return connected.filter((id) => id !== round.pleader && !round.correct.includes(id));
          }
          if (mode?.kind === 'mot_secret')
            return connected.filter((id) =>
              id === round.pleader ? !round.correct.includes(id) : !(id in round.writings),
            );
          if (mode?.kind === 'mime')
            return connected.filter((id) => id !== round.pleader && !round.correct.includes(id));
          if (mode?.kind === 'carte_vote') return connected.filter((id) => !(id in round.played));
          if (mode?.kind === 'detecteur')
            return round.pleader ? [round.pleader].filter((id) => !(id in round.writings)) : [];
          return connected.filter((id) => !(id in round.writings));
        }
        if (state.phase === 'vote') return connected.filter((id) => !(id in round.votes));
        if (state.phase === 'rate') return connected.filter((id) => id !== round.pleader && !(id in round.ratings));
        return [];
      })();
      return { pending: waiting.map((id) => state.players[id] ?? '?') };
    },

    isFinished(state) {
      return state.phase === 'final';
    },
  };
}

function revealView(state: BoumState, round: BoumRound, mode: ModeDef) {
  const name = (id: string) => state.players[id] ?? '?';
  const answer = round.prompt?.answer ?? null;
  switch (mode.kind) {
    case 'pays': {
      const target = answer ? COUNTRY_CENTROIDS[answer] : undefined;
      const points = countryPoints(round.picks, answer ?? '', COUNTRY_CENTROIDS);
      return {
        kind: 'pays' as const,
        answer,
        answerName: answer ? (COUNTRY_NAMES_FR[answer] ?? answer) : '',
        guesses: Object.entries(round.picks)
          .map(([id, code]) => {
            const centre = COUNTRY_CENTROIDS[code];
            return {
              name: name(id),
              code,
              countryName: COUNTRY_NAMES_FR[code] ?? code,
              km: target && centre ? Math.round(haversineKm(centre, target)) : null,
              gained: points[id] ?? 0,
            };
          })
          .sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name, 'fr')),
        misses: Object.keys(state.players)
          .filter((id) => !(id in round.picks))
          .map(name),
      };
    }
    case 'chanson':
      return {
        kind: 'chanson' as const,
        title: round.prompt?.text ?? null,
        answer,
        singer: round.pleader ? name(round.pleader) : null,
        order: round.correct.map((id) => ({ name: name(id), gained: round.gains[id] ?? 0 })),
        gainedSinger: round.pleader ? (round.gains[round.pleader] ?? 0) : 0,
        misses: Object.keys(state.players)
          .filter((id) => id !== round.pleader && !round.correct.includes(id))
          .map(name),
      };
    case 'mot_secret':
      return {
        kind: 'mot_secret' as const,
        word: round.prompt?.text ?? null,
        guesser: round.pleader ? name(round.pleader) : null,
        found: round.pleader ? round.correct.includes(round.pleader) : false,
        gainedGuesser: round.pleader ? (round.gains[round.pleader] ?? 0) : 0,
        clues: Object.entries(round.writings).map(([id, text]) => ({
          name: name(id),
          text,
          gained: round.gains[id] ?? 0,
        })),
        misses: Object.keys(state.players)
          .filter((id) => id !== round.pleader && !(id in round.writings))
          .map(name),
      };
    case 'mime':
      return {
        kind: 'mime' as const,
        word: round.prompt?.text ?? null,
        mimer: round.pleader ? name(round.pleader) : null,
        order: round.correct.map((id) => ({ name: name(id), gained: round.gains[id] ?? 0 })),
        gainedMimer: round.pleader ? (round.gains[round.pleader] ?? 0) : 0,
        misses: Object.keys(state.players)
          .filter((id) => id !== round.pleader && !round.correct.includes(id))
          .map(name),
      };
    case 'reponse':
      return {
        kind: 'reponse' as const,
        answer,
        order: round.correct.map((id) => ({ name: name(id), gained: round.gains[id] ?? 0 })),
        misses: Object.keys(state.players)
          .filter((id) => !round.correct.includes(id))
          .map(name),
      };
    case 'chiffre': {
      const target = Number(answer ?? NaN);
      return {
        kind: 'chiffre' as const,
        answer,
        guesses: Object.entries(round.guesses)
          .map(([id, value]) => ({
            name: name(id),
            value,
            gained: round.gains[id] ?? 0,
            distance: Math.abs(value - target),
          }))
          .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'fr'))
          .map(({ distance: _distance, ...rest }) => rest),
      };
    }
    case 'vote_joueur': {
      const counts = Object.values(round.votes).reduce<Record<string, number>>((acc, id) => {
        acc[String(id)] = (acc[String(id)] ?? 0) + 1;
        return acc;
      }, {});
      return {
        kind: 'vote_joueur' as const,
        results: Object.keys(state.players)
          .map((id) => ({ name: name(id), votes: counts[id] ?? 0, gained: round.gains[id] ?? 0 }))
          .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'fr')),
      };
    }
    case 'detecteur': {
      const stars = Object.values(round.ratings);
      return {
        kind: 'detecteur' as const,
        pleader: round.pleader ? name(round.pleader) : null,
        excuse: round.writings[round.pleader ?? ''] ?? '',
        average: stars.length ? Math.round((stars.reduce((s, r) => s + r, 0) / stars.length) * 10) / 10 : null,
        gained: round.pleader ? (round.gains[round.pleader] ?? 0) : 0,
      };
    }
    default: {
      // Écriture, carte et vrai ou faux : chaque texte, son auteur et ses votes.
      const counts = Object.values(round.votes).reduce<Record<number, number>>((acc, option) => {
        acc[option as number] = (acc[option as number] ?? 0) + 1;
        return acc;
      }, {});
      return {
        kind: 'texte' as const,
        answer,
        results: round.options
          .map((id, i) => ({
            text: mode.kind === 'photo' ? '' : (round.writings[id] ?? ''),
            image: mode.kind === 'photo' ? (round.writings[id] ?? null) : null,
            author: name(id),
            votes: counts[i] ?? 0,
            gained: round.gains[id] ?? 0,
          }))
          .sort((a, b) => b.votes - a.votes || a.author.localeCompare(b.author, 'fr')),
      };
    }
  }
}

export const boum: GameModule<BoumState, BoumSettings> = createBoum();

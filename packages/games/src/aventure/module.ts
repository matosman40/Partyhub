import type { GameContext, GameJob, GameModule, JobOutcome, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { runAventureJob, type JobInput, type PromptCharacter, type WorldInput } from './ai.js';
import { fallbackEpilogue, fallbackRoster, fallbackScene } from './fallback.js';
import {
  STATS,
  STAT_LABELS,
  TONE_LABELS,
  aventureSettingsSchema,
  pickSchema,
  regenerateSchema,
  voteSchema,
  type AventureSettings,
  type CharacterDraft,
  type EpilogueDraft,
  type RosterDraft,
  type SceneDraft,
  type StatKey,
} from './schemas.js';

/**
 * L'Aventure IA : une histoire racontée en direct. Chaque joueur incarne un personnage (fiche, PV, XP),
 * puis vote à chaque scène pour le choix qui fait avancer le récit. Le personnage qui a fait le choix retenu
 * tente sa chance : un jet de d20 plus sa stat. La suite de l'histoire dépend de ce qui s'est passé.
 *
 * Le moteur reste synchrone et déterministe. Les textes viennent d'un travail asynchrone (`pendingJob`) :
 * la salle l'exécute hors du moteur, puis `completeJob` intègre le résultat, ou l'histoire de secours si
 * l'IA n'est pas configurée ou répond mal.
 */

const CHOOSE_MS = 90_000;
const CHOOSE_TIMEOUT = 'choose-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
/** Le jet reste affiché cette durée avant la scène suivante, même quand le texte est déjà prêt. */
const REVEAL_MS = 5000;
const REVEAL_TIMEOUT = 'reveal-timeout';

const DIE_SIDES = 20;
const XP_SUCCESS = 10;
const PV_LOSS = 2;
const VICTORY_POINTS = 20;
const MAX_CHARACTERS = 6;
const PROMPT_HISTORY = 6;

export interface Character {
  id: string;
  name: string;
  title: string;
  emoji: string;
  backstory: string;
  stats: Record<StatKey, number>;
  pvMax: number;
  pv: number;
  ability: { name: string; text: string };
  flaw: string;
  item: string;
  xp: number;
  /** Joueur qui incarne ce personnage, ou null (compagnon de l'aventure, il ne vote pas). */
  ownerId: string | null;
}

export interface Choice {
  id: string;
  label: string;
  stat: StatKey;
  difficulty: number;
}

export interface SceneState {
  title: string;
  text: string;
  choices: Choice[];
}

export interface Resolution {
  sceneTitle: string;
  choiceLabel: string;
  characterId: string;
  characterName: string;
  stat: StatKey;
  roll: number;
  bonus: number;
  total: number;
  difficulty: number;
  success: boolean;
  /** Nombre de voix pour le choix retenu. */
  votes: number;
  /** Vrai quand plusieurs choix étaient à égalité et que le hasard a tranché. */
  tie: boolean;
}

export type AventurePhase = 'lobby' | 'preparing' | 'choose' | 'vote' | 'final';
export type ContentMode = 'ia' | 'secours';

/** Texte généré, gardé le temps de la révélation du jet. */
export type Queued =
  | { kind: 'scene'; draft: SceneDraft; mode: ContentMode }
  | { kind: 'epilogue'; draft: EpilogueDraft; mode: ContentMode };

export interface AventureState {
  phase: AventurePhase;
  settings: AventureSettings;
  /** Pseudo de chaque joueur, par identifiant. */
  players: Record<string, string>;
  /** Ordre d'arrivée des joueurs. */
  order: string[];
  world: WorldInput | null;
  characters: Character[];
  /** Origine du dernier contenu généré : IA ou histoire de secours. */
  mode: ContentMode | null;
  /** Numéro de la scène en cours (0 avant la première). */
  sceneNumber: number;
  scene: SceneState | null;
  /** Joueur -> choix. Les voix restent secrètes jusqu'à la résolution. */
  votes: Record<string, string>;
  resolution: Resolution | null;
  history: Resolution[];
  epilogue: { title: string; text: string } | null;
  victory: boolean | null;
  job: GameJob | null;
  jobSeq: number;
  endsAt: number;
  /** Vrai pendant la révélation d'un jet : la suite ne s'affiche pas encore. */
  reveal: boolean;
  /** Texte prêt, qui attend la fin de la révélation. */
  queued: Queued | null;
}

/** Valeur d'une stat : entière de 1 à 6, somme totale comprise entre 10 et 14. */
export function normalizeStats(stats: Record<StatKey, number>): Record<StatKey, number> {
  const out = { ...stats };
  let total = STATS.reduce((sum, k) => sum + out[k], 0);
  while (total < 10) {
    const key = [...STATS].filter((k) => out[k] < 6).sort((a, b) => out[a] - out[b])[0];
    if (!key) break;
    out[key] += 1;
    total += 1;
  }
  while (total > 14) {
    const key = [...STATS].filter((k) => out[k] > 1).sort((a, b) => out[b] - out[a])[0];
    if (!key) break;
    out[key] -= 1;
    total -= 1;
  }
  return out;
}

function pickOne<T>(items: readonly T[], random: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

function toCharacter(draft: CharacterDraft, id: string): Character {
  return {
    id,
    name: draft.name,
    title: draft.title,
    emoji: draft.emoji,
    backstory: draft.backstory,
    stats: normalizeStats(draft.stats),
    pvMax: draft.pvMax,
    pv: draft.pvMax,
    ability: draft.ability,
    flaw: draft.flaw,
    item: draft.item,
    xp: 0,
    ownerId: null,
  };
}

function characterOf(s: AventureState, playerId: string): Character | undefined {
  return s.characters.find((c) => c.ownerId === playerId);
}

function isActiveOwner(s: AventureState, playerId: string): boolean {
  const c = characterOf(s, playerId);
  return c !== undefined && c.pv > 0;
}

function activeCharacters(s: AventureState): Character[] {
  return s.characters.filter((c) => c.ownerId !== null && c.pv > 0);
}

function activeOwnerIds(s: AventureState): string[] {
  return s.characters.flatMap((c) => (c.ownerId !== null && c.pv > 0 ? [c.ownerId] : []));
}

function ownedCharacters(s: AventureState): Character[] {
  return s.characters.filter((c) => c.ownerId !== null);
}

function promptCharacters(s: AventureState): PromptCharacter[] {
  return s.characters.map((c) => ({
    name: c.name,
    title: c.title,
    pv: c.pv,
    pvMax: c.pvMax,
    ko: c.pv === 0,
    companion: c.ownerId === null,
    stats: c.stats,
    ability: c.ability,
    flaw: c.flaw,
    item: c.item,
  }));
}

function historyLines(history: Resolution[]): string[] {
  return history
    .slice(-PROMPT_HISTORY)
    .map(
      (h) =>
        `Scène « ${h.sceneTitle} » : ${h.characterName} choisit « ${h.choiceLabel} » — ${h.success ? 'réussi' : 'échoué'} (jet ${h.total} contre ${h.difficulty}).`,
    );
}

function publicSheet(c: Character, players: Record<string, string>) {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    emoji: c.emoji,
    backstory: c.backstory,
    stats: c.stats,
    pv: c.pv,
    pvMax: c.pvMax,
    ability: c.ability,
    flaw: c.flaw,
    item: c.item,
    xp: c.xp,
    ownerId: c.ownerId,
    ownerName: c.ownerId !== null ? (players[c.ownerId] ?? '?') : null,
  };
}

/** Un travail de texte est demandé : la salle l'exécute, puis `completeJob` reprend la main. */
function askJob(s: AventureState, kind: GameJob['kind'], input: JobInput): AventureState {
  const seq = s.jobSeq + 1;
  return { ...s, phase: 'preparing', job: { id: `job-${seq}`, kind, input }, jobSeq: seq };
}

function askRoster(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(CHOOSE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_TIMEOUT);
  return askJob(
    {
      ...s,
      world: null,
      characters: [],
      mode: null,
      sceneNumber: 0,
      scene: null,
      votes: {},
      resolution: null,
      history: [],
      epilogue: null,
      victory: null,
      reveal: false,
      queued: null,
    },
    'roster',
    { kind: 'roster', theme: s.settings.theme, tone: s.settings.tone },
  );
}

function applyRoster(s: AventureState, draft: RosterDraft, mode: ContentMode, ctx: GameContext): AventureState {
  ctx.schedule(CHOOSE_TIMEOUT, CHOOSE_MS);
  return {
    ...s,
    phase: 'choose',
    world: draft.world,
    characters: draft.characters.slice(0, MAX_CHARACTERS).map((c, i) => toCharacter(c, `c${i + 1}`)),
    mode,
    endsAt: ctx.now() + CHOOSE_MS,
  };
}

/** Fin du choix : les joueurs sans personnage reçoivent au hasard ce qui reste. */
function finishChoose(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(CHOOSE_TIMEOUT);
  const free = shuffle(
    s.characters.filter((c) => c.ownerId === null).map((c) => c.id),
    ctx.random,
  );
  const waiting = s.order.filter((id) => !characterOf(s, id));
  const pairs: [characterId: string, playerId: string][] = [];
  waiting.forEach((playerId, i) => {
    const characterId = free[i];
    if (characterId !== undefined) pairs.push([characterId, playerId]);
  });
  const characters = s.characters.map((c) => {
    const pair = pairs.find(([characterId]) => characterId === c.id);
    return pair ? { ...c, ownerId: pair[1] } : c;
  });
  return askScene({ ...s, characters }, ctx);
}

function askScene(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(VOTE_TIMEOUT);
  if (!s.world) return s;
  const sceneNumber = s.sceneNumber + 1;
  return askJob({ ...s, sceneNumber, scene: null, votes: {} }, 'scene', {
    kind: 'scene',
    world: s.world,
    characters: promptCharacters(s),
    history: historyLines(s.history),
    sceneNumber,
    total: s.settings.scenes,
  });
}

function applyScene(s: AventureState, draft: SceneDraft, mode: ContentMode, ctx: GameContext): AventureState {
  const ms = s.settings.voteSeconds * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return {
    ...s,
    phase: 'vote',
    mode,
    scene: {
      title: draft.title,
      text: draft.text,
      choices: draft.choices.slice(0, 3).map((c, i) => ({
        id: `o${i + 1}`,
        label: c.label,
        stat: c.stat,
        difficulty: c.difficulty,
      })),
    },
    votes: {},
    endsAt: ctx.now() + ms,
  };
}

function askEpilogue(s: AventureState, victory: boolean, ctx: GameContext): AventureState {
  ctx.cancel(VOTE_TIMEOUT);
  if (!s.world) return endAdventure(s, ctx);
  return askJob({ ...s, scene: null, votes: {}, victory }, 'epilogue', {
    kind: 'epilogue',
    world: s.world,
    characters: promptCharacters(s),
    history: historyLines(s.history),
    victory,
  });
}

function applyEpilogue(s: AventureState, draft: EpilogueDraft, mode: ContentMode): AventureState {
  return { ...s, phase: 'final', mode, epilogue: { title: draft.title, text: draft.text }, scene: null };
}

function endAdventure(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(CHOOSE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_TIMEOUT);
  return { ...s, phase: 'final', job: null, scene: null, votes: {}, reveal: false, queued: null };
}

/** Fin de la révélation du jet : le texte prêt s'affiche maintenant, sinon il s'affichera dès qu'il arrive. */
function releaseReveal(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(REVEAL_TIMEOUT);
  const next = { ...s, reveal: false, queued: null };
  if (!s.queued) return next;
  return s.queued.kind === 'scene'
    ? applyScene(next, s.queued.draft, s.queued.mode, ctx)
    : applyEpilogue(next, s.queued.draft, s.queued.mode);
}

/**
 * Clôture du vote. Le choix le plus soutenu l'emporte (égalité tranchée au hasard, aucun vote : choix au hasard).
 * Le personnage du premier joueur qui a voté ce choix tente sa chance.
 */
function resolveVote(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(VOTE_TIMEOUT);
  const scene = s.scene;
  if (!scene) return s;

  const valid = Object.entries(s.votes).filter(
    ([playerId, choiceId]) => isActiveOwner(s, playerId) && scene.choices.some((c) => c.id === choiceId),
  );
  const counts = new Map<string, number>();
  for (const [, choiceId] of valid) counts.set(choiceId, (counts.get(choiceId) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  const leaders = max === 0 ? scene.choices : scene.choices.filter((c) => counts.get(c.id) === max);
  const winner = pickOne(leaders, ctx.random);
  if (!winner) return s;
  const tie = max > 0 && leaders.length > 1;

  const voterId = valid.find(([, choiceId]) => choiceId === winner.id)?.[0];
  const voter = voterId !== undefined ? characterOf(s, voterId) : undefined;
  const actor = voter && voter.pv > 0 ? voter : pickOne(activeCharacters(s), ctx.random);
  if (!actor) return askEpilogue(s, false, ctx);

  const roll = Math.floor(ctx.random() * DIE_SIDES) + 1;
  const bonus = actor.stats[winner.stat];
  const total = roll + bonus;
  const success = roll === DIE_SIDES || (roll !== 1 && total >= winner.difficulty);

  const resolution: Resolution = {
    sceneTitle: scene.title,
    choiceLabel: winner.label,
    characterId: actor.id,
    characterName: actor.name,
    stat: winner.stat,
    roll,
    bonus,
    total,
    difficulty: winner.difficulty,
    success,
    votes: counts.get(winner.id) ?? 0,
    tie,
  };
  const characters = s.characters.map((c) => {
    if (c.id !== actor.id) return c;
    return success ? { ...c, xp: c.xp + XP_SUCCESS } : { ...c, pv: Math.max(0, c.pv - PV_LOSS) };
  });
  const next: AventureState = {
    ...s,
    characters,
    resolution,
    history: [...s.history, resolution],
    scene: null,
    reveal: true,
    queued: null,
  };
  ctx.schedule(REVEAL_TIMEOUT, REVEAL_MS);

  if (ownedCharacters(next).every((c) => c.pv === 0)) return askEpilogue(next, false, ctx);
  if (next.sceneNumber >= next.settings.scenes) return askEpilogue(next, true, ctx);
  return askScene(next, ctx);
}

/** Classement : XP des personnages de chaque joueur, plus un bonus si l'aventure est gagnée. */
function rankingOf(s: AventureState) {
  const points: Record<string, number> = Object.fromEntries(s.order.map((id) => [id, 0]));
  for (const c of s.characters) {
    if (c.ownerId === null) continue;
    points[c.ownerId] = (points[c.ownerId] ?? 0) + c.xp + (s.victory ? VICTORY_POINTS : 0);
  }
  return rankEntries(s.players, points);
}

export const aventureIa: GameModule<AventureState, AventureSettings> = {
  manifest: {
    id: 'aventure-ia',
    category: 'role',
    name: 'Aventure IA',
    description:
      'Une aventure racontée en direct : chacun incarne un personnage et vote les choix qui font avancer l’histoire.',
    icon: '🐉',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: MAX_CHARACTERS,
    durationMin: 20,
    notice: {
      goal: 'Mener le groupe au bout de l’aventure, sans que tous les personnages tombent.',
      steps: [
        'Choisissez votre personnage et lisez sa fiche.',
        'Chaque scène propose deux ou trois choix : votez pour celui qui vous tente.',
        'Le personnage qui a voté le choix retenu tente sa chance : un jet de dé, plus sa stat.',
        'L’histoire continue selon ce qui s’est passé, jusqu’à l’épilogue.',
      ],
      tips: [
        'Réussir un jet rapporte de l’expérience ; échouer coûte 2 PV.',
        'Quand tous les personnages sont à terre, l’aventure se termine en défaite.',
        'Sans IA configurée sur le serveur, l’aventure se joue avec une histoire de secours.',
      ],
    },
  },

  settingsSchema: aventureSettingsSchema,
  defaultSettings: aventureSettingsSchema.parse({}),

  actions: {
    pick: pickSchema,
    vote: voteSchema,
  },

  hostActions: {
    regenerate: regenerateSchema,
  },

  initialize(settings, players) {
    return {
      phase: 'lobby',
      settings: aventureSettingsSchema.parse(settings),
      players: directory(players),
      order: players.map((p) => p.id),
      world: null,
      characters: [],
      mode: null,
      sceneNumber: 0,
      scene: null,
      votes: {},
      resolution: null,
      history: [],
      epilogue: null,
      victory: null,
      job: null,
      jobSeq: 0,
      endsAt: 0,
      reveal: false,
      queued: null,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'lobby') return s;
    return {
      ...s,
      players: { ...s.players, [p.id]: p.name },
      order: [...s.order.filter((id) => id !== p.id), p.id],
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'lobby') return s;
    const players = { ...s.players };
    delete players[p.id];
    return { ...s, players, order: s.order.filter((id) => id !== p.id) };
  },

  start(s, ctx) {
    if (s.phase !== 'lobby') return fail('La partie a déjà commencé');
    return ok(askRoster(s, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

    if (type === 'pick') {
      if (s.phase !== 'choose') return fail('Les personnages se choisissent au début de l’aventure');
      const parsed = pickSchema.safeParse(payload);
      if (!parsed.success) return fail('Choix invalide');
      const target = s.characters.find((c) => c.id === parsed.data.characterId);
      if (!target) return fail('Personnage inconnu');
      if (target.ownerId !== null && target.ownerId !== p.id) return fail('Ce personnage est déjà pris');
      const characters = s.characters.map((c) => {
        if (c.id === target.id) return { ...c, ownerId: p.id };
        return c.ownerId === p.id ? { ...c, ownerId: null } : c;
      });
      const next = { ...s, characters };
      const done = everyConnectedDone(ctx, s.order, (id) => characterOf(next, id) !== undefined);
      return ok(done ? finishChoose(next, ctx) : next);
    }

    if (type === 'vote') {
      if (s.phase !== 'vote' || !s.scene) return fail('Pas de vote en cours');
      const mine = characterOf(s, p.id);
      if (!mine) return fail('Vous n’avez pas de personnage dans cette aventure');
      if (mine.pv <= 0) return fail('Votre personnage est à terre : vous suivez la suite en spectateur');
      const parsed = voteSchema.safeParse(payload);
      if (!parsed.success) return fail('Vote invalide');
      const choiceId = parsed.data.choiceId;
      if (!s.scene.choices.some((c) => c.id === choiceId)) return fail('Choix inconnu');
      const next = { ...s, votes: { ...s.votes, [p.id]: choiceId } };
      const done = everyConnectedDone(ctx, activeOwnerIds(next), (id) => id in next.votes);
      return ok(done ? resolveVote(next, ctx) : next);
    }

    return fail('Action inconnue');
  },

  handleHostAction(s, type, _payload, ctx) {
    if (type !== 'regenerate') return fail('Action inconnue');
    if (s.phase !== 'choose') return fail('Les personnages ne se régénèrent qu’avant les choix');
    if (s.characters.some((c) => c.ownerId !== null)) {
      return fail('Un joueur a déjà choisi son personnage : impossible de régénérer');
    }
    return ok(askRoster(s, ctx));
  },

  pendingJob(s) {
    return s.job;
  },

  runJob: runAventureJob,

  completeJob(s, jobId: string, outcome: JobOutcome, ctx) {
    const job = s.job;
    if (!job || job.id !== jobId) return s;
    const input = job.input as JobInput;
    const data = outcome.ok ? outcome.value : null;
    const mode: ContentMode = data ? 'ia' : 'secours';
    const cleared: AventureState = { ...s, job: null };

    if (input.kind === 'roster') {
      return applyRoster(cleared, (data as RosterDraft | null) ?? fallbackRoster(ctx.random), mode, ctx);
    }
    const queued: Queued =
      input.kind === 'scene'
        ? {
            kind: 'scene',
            mode,
            draft:
              (data as SceneDraft | null) ??
              fallbackScene(
                ctx.random,
                s.history.map((h) => h.sceneTitle),
              ),
          }
        : {
            kind: 'epilogue',
            mode,
            draft: (data as EpilogueDraft | null) ?? fallbackEpilogue(ctx.random, input.victory),
          };
    // Pendant la révélation du jet, le texte attend : il ne remplace pas le résultat affiché.
    if (s.reveal) return { ...cleared, queued };
    return queued.kind === 'scene'
      ? applyScene(cleared, queued.draft, mode, ctx)
      : applyEpilogue(cleared, queued.draft, mode);
  },

  onTimer(s, key, ctx) {
    if (key === CHOOSE_TIMEOUT && s.phase === 'choose') return finishChoose(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return resolveVote(s, ctx);
    if (key === REVEAL_TIMEOUT && s.reveal) return releaseReveal(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.reveal) return releaseReveal(s, ctx);
    if (s.phase === 'choose') return finishChoose(s, ctx);
    if (s.phase === 'vote') return resolveVote(s, ctx);
    return s;
  },

  calculateScores(s) {
    return rankingOf(s);
  },

  end(s, ctx) {
    return endAdventure(s, ctx);
  },

  getPublicState(s) {
    const choosing = s.phase === 'choose';
    return {
      phase: s.phase,
      preparing: s.job?.kind ?? s.queued?.kind ?? null,
      reveal: s.reveal,
      mode: s.mode,
      theme: s.settings.theme,
      tone: TONE_LABELS[s.settings.tone],
      world: s.world,
      characters: s.characters.map((c) => publicSheet(c, s.players)),
      playerCount: s.order.length,
      pickedCount: s.order.filter((id) => characterOf(s, id) !== undefined).length,
      sceneNumber: s.sceneNumber,
      total: s.settings.scenes,
      scene: s.scene
        ? {
            title: s.scene.title,
            text: s.scene.text,
            choices: s.scene.choices.map((c) => ({
              id: c.id,
              label: c.label,
              stat: c.stat,
              statLabel: STAT_LABELS[c.stat],
              difficulty: c.difficulty,
            })),
          }
        : null,
      voteCount: Object.keys(s.votes).length,
      voterCount: activeOwnerIds(s).length,
      resolution: s.resolution,
      history: s.history,
      epilogue: s.epilogue,
      victory: s.victory,
      endsAt: s.endsAt,
      durationMs: choosing ? CHOOSE_MS : s.phase === 'vote' ? s.settings.voteSeconds * 1000 : 0,
      ranking: rankingOf(s),
    };
  },

  getPlayerState(s, playerId) {
    const mine = characterOf(s, playerId);
    const hasVoted = playerId in s.votes;
    return {
      characterId: mine?.id ?? null,
      ko: mine !== undefined && mine.pv === 0,
      canPick: s.phase === 'choose',
      canVote: s.phase === 'vote' && mine !== undefined && mine.pv > 0 && !hasVoted,
      hasVoted,
      myVote: s.votes[playerId] ?? null,
    };
  },

  getHostState(s) {
    const waiting =
      s.phase === 'choose'
        ? s.order.filter((id) => characterOf(s, id) === undefined)
        : s.phase === 'vote'
          ? activeOwnerIds(s).filter((id) => !(id in s.votes))
          : [];
    return {
      canRegenerate: s.phase === 'choose' && s.characters.every((c) => c.ownerId === null),
      pending: waiting.map((id) => s.players[id] ?? '?'),
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.phase === 'choose' && characterOf(s, playerId) === undefined) {
      const free = s.characters.filter((c) => c.ownerId === null);
      const pick = pickOne(free, random);
      if (!pick) return null;
      return { type: 'pick', payload: { characterId: pick.id }, key: `pick:${playerId}:${pick.id}` };
    }
    if (s.phase === 'vote' && s.scene && isActiveOwner(s, playerId) && !(playerId in s.votes)) {
      const choice = pickOne(s.scene.choices, random);
      if (!choice) return null;
      return { type: 'vote', payload: { choiceId: choice.id }, key: `vote:${s.sceneNumber}:${playerId}` };
    }
    return null;
  },
};

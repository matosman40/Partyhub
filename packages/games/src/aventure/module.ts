import type { GameContext, GameJob, GameModule, JobOutcome, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { runAventureJob, type JobInput, type PromptCharacter, type PromptNpc, type WorldInput } from './ai.js';
import { resolveRound, pickAction } from './combat.js';
import type { RosterImages } from './images.js';
import { fallbackEpilogue, fallbackRoster, fallbackScene } from './fallback.js';
import {
  gainItem,
  gainXp,
  heal,
  loseLife,
  nextLevelXp,
  relationOf,
  shiftBond,
  shiftDifficulty,
  syncLevel,
} from './progression.js';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_SHIFT,
  STATS,
  STAT_LABELS,
  TONE_LABELS,
  aventureSettingsSchema,
  combatSchema,
  epilogueDraftSchema,
  rosterDraftSchema,
  sceneDraftSchema,
  LIBRARY_MAX,
  pickSchema,
  savedCharacterSchema,
  regenerateSchema,
  voteSchema,
  type AventureSettings,
  type CharacterDraft,
  type EpilogueDraft,
  type NpcDraft,
  type RosterDraft,
  type SavedCharacter,
  type SceneDraft,
  type StatKey,
} from './schemas.js';
import { THEMES, themeById } from './themes.js';
import type { Character, Choice, Combat, Foe, Npc, Recap, Resolution, SceneState } from './types.js';

/**
 * L'Aventure IA : une histoire racontée en direct, en parties courtes. Chaque joueur incarne un personnage.
 * L'équipe a un objectif et un secret ; elle rencontre des personnages secondaires avec qui elle parle, qu'elle
 * peut gagner ou froisser. Une scène est un choix, un dialogue, une énigme, une halte ou un affrontement tour par
 * tour. Chaque choix dit déjà ce qui arrive en cas de réussite ou d'échec : le jet ne fait que trancher.
 * Les personnages progressent (niveaux, objets) et sont gardés dans le profil du joueur pour d'autres parties.
 *
 * Le moteur reste synchrone et déterministe. Les textes viennent d'un travail asynchrone (`pendingJob`) :
 * la salle l'exécute hors du moteur, puis `completeJob` intègre le résultat, ou l'histoire de secours si
 * l'IA n'est pas configurée ou répond mal.
 */

export type { Character, Choice, Combat, Foe, Npc, Recap, Resolution, RoundReport, SceneState } from './types.js';

const CHOOSE_MS = 60_000;
const CHOOSE_TIMEOUT = 'choose-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const COMBAT_TIMEOUT = 'combat-timeout';
/** Le jet et le bilan d'une manche restent affichés cette durée avant la suite. */
const REVEAL_MS = 5000;
const REVEAL_TIMEOUT = 'reveal-timeout';
const ROUND_MS = 30_000;

const DIE_SIDES = 20;
const XP_SUCCESS = 10;
const VICTORY_POINTS = 20;
const MAX_CHARACTERS = 6;
const PROMPT_HISTORY = 8;

export type AventurePhase = 'lobby' | 'preparing' | 'choose' | 'vote' | 'combat' | 'final';
export type ContentMode = 'ia' | 'secours';

/** Texte généré, gardé le temps de la révélation du jet ou du bilan. */
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
  /** Thème retenu pour cette aventure (identifiant du catalogue), ou null pour un thème libre. */
  themeKey: string | null;
  world: WorldInput | null;
  /** Fond du monde : identifiant d'image de la bibliothèque, ou null (pas de décor généré). */
  backgroundId: string | null;
  characters: Character[];
  /** Personnages secondaires de l'histoire, et ceux déjà rencontrés (par nom). */
  npcs: Npc[];
  met: string[];
  /** Intrigue de secours utilisée (index), ou null quand le monde vient de l'IA. */
  arc: number | null;
  /** Origine du dernier contenu généré : IA ou histoire de secours. */
  mode: ContentMode | null;
  /** Numéro de la scène en cours (0 avant la première). */
  sceneNumber: number;
  scene: SceneState | null;
  /** Joueur -> choix. Les voix restent secrètes jusqu'à la résolution. */
  votes: Record<string, string>;
  resolution: Resolution | null;
  combat: Combat | null;
  history: Recap[];
  epilogue: { title: string; text: string } | null;
  victory: boolean | null;
  /** Profil de chaque joueur qui en a un (joueur -> profil). */
  profiles: Record<string, string>;
  /** Personnages gardés dans le profil de chaque joueur, lus à son arrivée (joueur -> liste). */
  library: Record<string, SavedCharacter[]>;
  /** Vrai une fois la partie comptée (parties jouées, victoires) : évite de compter deux fois. */
  recorded: boolean;
  job: GameJob | null;
  jobSeq: number;
  endsAt: number;
  /** Vrai pendant la révélation d'un jet ou d'une manche : la suite ne s'affiche pas encore. */
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

const sameName = (a: string, b: string) => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr');

function toCharacter(draft: CharacterDraft, id: string): Character {
  return {
    id,
    libraryId: null,
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
    bag: [],
    level: 1,
    xp: 0,
    xpStart: 0,
    games: 0,
    victories: 0,
    portraitId: null,
    ownerId: null,
  };
}

/** Personnage repris de la bibliothèque du profil : son identifiant est celui de la bibliothèque. */
function fromSaved(saved: SavedCharacter, ownerId: string): Character {
  return {
    id: saved.libraryId,
    libraryId: saved.libraryId,
    name: saved.name,
    title: saved.title,
    emoji: saved.emoji,
    backstory: saved.backstory,
    stats: { ...saved.stats },
    pvMax: saved.pvMax,
    pv: saved.pvMax,
    ability: saved.ability,
    flaw: saved.flaw,
    item: saved.item,
    bag: [],
    level: saved.level,
    xp: saved.xp,
    xpStart: saved.xp,
    games: saved.games,
    victories: saved.victories,
    portraitId: saved.portraitId,
    ownerId,
  };
}

/** Un personnage repris de la bibliothèque (son identifiant est celui de la bibliothèque). */
function isLibraryCharacter(c: Character): boolean {
  return c.libraryId !== null && c.id === c.libraryId;
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

/** Libère les personnages d'un joueur : un personnage de bibliothèque repart chez lui, les autres redeviennent libres. */
function releaseOwned(s: AventureState, playerId: string): AventureState {
  const characters = s.characters.flatMap((c) => {
    if (c.ownerId !== playerId) return [c];
    return isLibraryCharacter(c) ? [] : [{ ...c, ownerId: null }];
  });
  return { ...s, characters };
}

function promptCharacters(s: AventureState): PromptCharacter[] {
  return s.characters.map((c) => ({
    name: c.name,
    title: c.title,
    pv: c.pv,
    pvMax: c.pvMax,
    ko: c.pv === 0,
    companion: c.ownerId === null,
    level: c.level,
    stats: c.stats,
    ability: c.ability,
    flaw: c.flaw,
    item: c.item,
    bag: c.bag,
  }));
}

function promptCast(s: AventureState): PromptNpc[] {
  return s.npcs.map((n) => ({
    name: n.name,
    title: n.title,
    attitude: n.attitude,
    met: s.met.includes(n.name),
    relation: relationOf(n.bond),
  }));
}

function historyLines(history: Recap[]): string[] {
  return history.slice(-PROMPT_HISTORY).map((h) => `${h.sceneTitle} : ${h.text}`);
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
    bag: c.bag,
    level: c.level,
    xp: c.xp,
    nextXp: nextLevelXp(c.level),
    games: c.games,
    victories: c.victories,
    portraitId: c.portraitId,
    ownerId: c.ownerId,
    ownerName: c.ownerId !== null ? (players[c.ownerId] ?? '?') : null,
  };
}

/** Ajoute un personnage secondaire à la liste de l'histoire, ou le retrouve par son nom. */
function withNpc(npcs: Npc[], draft: NpcDraft): Npc[] {
  if (npcs.some((n) => sameName(n.name, draft.name))) return npcs;
  return [...npcs, { name: draft.name, title: draft.title, emoji: draft.emoji, attitude: draft.attitude, bond: 0 }];
}

/** Un travail de texte est demandé : la salle l'exécute, puis `completeJob` reprend la main. */
function askJob(s: AventureState, kind: GameJob['kind'], input: JobInput): AventureState {
  const seq = s.jobSeq + 1;
  return { ...s, phase: 'preparing', job: { id: `job-${seq}`, kind, input }, jobSeq: seq };
}

/** Thème de l'aventure : un thème du catalogue (au hasard pour `auto`), et le texte libre s'il y en a un. */
function themeFor(s: AventureState, random: () => number): { key: string | null; text: string } {
  const preset =
    s.settings.themeId === 'auto' ? (pickOne(THEMES, random) ?? null) : (themeById(s.settings.themeId) ?? null);
  const parts = [preset ? `${preset.label} : ${preset.brief}` : '', s.settings.theme.trim()].filter(Boolean);
  return { key: preset?.id ?? null, text: parts.join(' — ') };
}

function askRoster(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(CHOOSE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(COMBAT_TIMEOUT);
  ctx.cancel(REVEAL_TIMEOUT);
  const theme = themeFor(s, ctx.random);
  return askJob(
    {
      ...s,
      themeKey: theme.key,
      world: null,
      backgroundId: null,
      characters: [],
      npcs: [],
      met: [],
      arc: null,
      mode: null,
      sceneNumber: 0,
      scene: null,
      votes: {},
      resolution: null,
      combat: null,
      history: [],
      epilogue: null,
      victory: null,
      reveal: false,
      queued: null,
    },
    'roster',
    { kind: 'roster', theme: theme.text, themeKey: theme.key, tone: s.settings.tone },
  );
}

function applyRoster(
  s: AventureState,
  draft: RosterDraft,
  mode: ContentMode,
  arc: number | null,
  ctx: GameContext,
  images: RosterImages | null = null,
): AventureState {
  ctx.schedule(CHOOSE_TIMEOUT, CHOOSE_MS);
  return {
    ...s,
    phase: 'choose',
    world: { title: draft.world.title, intro: draft.world.intro, goal: draft.world.goal, secret: draft.world.secret },
    backgroundId: images?.backgroundId ?? null,
    characters: draft.characters
      .slice(0, MAX_CHARACTERS)
      .map((c, i) => ({ ...toCharacter(c, `c${i + 1}`), portraitId: images?.portraitIds[i] ?? null })),
    npcs: draft.npcs.map((n) => ({ name: n.name, title: n.title, emoji: n.emoji, attitude: n.attitude, bond: 0 })),
    met: [],
    arc,
    mode,
    endsAt: ctx.now() + CHOOSE_MS,
  };
}

/** Fin du choix : les joueurs sans personnage reçoivent au hasard ce qui reste (les personnages générés). */
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
    cast: promptCast(s),
    history: historyLines(s.history),
    sceneNumber,
    total: s.settings.scenes,
    difficulty: DIFFICULTY_LABELS[s.settings.difficulte],
  });
}

/**
 * Scène prête. Un affrontement démarre tout de suite ; un dialogue, une énigme, une halte ou une rencontre
 * donnent des choix, que les joueurs votent. La difficulté du salon décale les jets et les points de vie.
 */
function applyScene(s: AventureState, draft: SceneDraft, mode: ContentMode, ctx: GameContext): AventureState {
  const shift = DIFFICULTY_SHIFT[s.settings.difficulte];
  const npcDraft = draft.npc ?? null;
  const npcs = npcDraft ? withNpc(s.npcs, npcDraft) : s.npcs;
  const npc = npcDraft ? (npcs.find((n) => sameName(n.name, npcDraft.name)) ?? null) : null;
  const met = npc && !s.met.includes(npc.name) ? [...s.met, npc.name] : s.met;
  const declared = draft.kind ?? (draft.npc ? 'dialogue' : 'choix');
  const kind = draft.enemy ? 'combat' : declared === 'combat' ? 'choix' : declared;
  const scene: SceneState = {
    kind,
    title: draft.title,
    text: draft.text,
    hint: draft.hint ?? null,
    npc: npc && npcDraft ? { ...npc, line: npcDraft.line } : null,
    choices: [],
  };

  if (draft.enemy) {
    const foe: Foe = {
      name: draft.enemy.name,
      title: draft.enemy.title,
      emoji: draft.enemy.emoji,
      intro: draft.enemy.intro,
      hp: Math.min(16, Math.max(3, draft.enemy.hp + shift.hp)),
      hpMax: Math.min(16, Math.max(3, draft.enemy.hp + shift.hp)),
      defense: draft.enemy.defense,
      damage: draft.enemy.damage,
      onVictory: draft.enemy.onVictory,
      loot: draft.enemy.loot ?? null,
    };
    ctx.cancel(VOTE_TIMEOUT);
    ctx.schedule(COMBAT_TIMEOUT, ROUND_MS);
    return {
      ...s,
      phase: 'combat',
      mode,
      npcs,
      met,
      scene,
      votes: {},
      combat: {
        foe,
        sceneTitle: draft.title,
        round: 1,
        step: 'act',
        actions: {},
        report: null,
        over: false,
        progress: [],
      },
      endsAt: ctx.now() + ROUND_MS,
    };
  }

  const ms = s.settings.voteSeconds * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return {
    ...s,
    phase: 'vote',
    mode,
    npcs,
    met,
    combat: null,
    scene: {
      ...scene,
      choices: draft.choices.slice(0, 3).map((c, i): Choice => ({
        id: `o${i + 1}`,
        label: c.label,
        stat: c.stat,
        difficulty: shiftDifficulty(c.difficulty, shift.difficulty),
        onSuccess: c.onSuccess,
        onFailure: c.onFailure,
        item: c.item ?? null,
        heal: c.heal,
        risk: c.risk,
        bond: c.bond,
      })),
    },
    votes: {},
    endsAt: ctx.now() + ms,
  };
}

function askEpilogue(s: AventureState, victory: boolean, ctx: GameContext): AventureState {
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(COMBAT_TIMEOUT);
  if (!s.world) return endAdventure(s, ctx);
  return askJob({ ...s, scene: null, votes: {}, victory }, 'epilogue', {
    kind: 'epilogue',
    world: s.world,
    characters: promptCharacters(s),
    history: historyLines(s.history),
    victory,
  });
}

function applyEpilogue(s: AventureState, draft: EpilogueDraft, mode: ContentMode, ctx: GameContext): AventureState {
  const finished = {
    ...s,
    phase: 'final' as const,
    mode,
    epilogue: { title: draft.title, text: draft.text },
    scene: null,
    combat: null,
  };
  return recordGame(finished, ctx);
}

function endAdventure(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(CHOOSE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(COMBAT_TIMEOUT);
  ctx.cancel(REVEAL_TIMEOUT);
  return recordGame(
    { ...s, phase: 'final', job: null, scene: null, votes: {}, combat: null, reveal: false, queued: null },
    ctx,
  );
}

/* Bibliothèque : les personnages de chaque profil, gardés d'une partie à l'autre. */

/**
 * Relit la bibliothèque d'un profil. Une fiche abîmée est écartée seule : les autres gardent leur place, et la
 * sauvegarde suivante ne les efface pas.
 */
function readLibrary(ctx: GameContext, profileId: string): SavedCharacter[] {
  const raw = ctx.profileData?.read(profileId);
  if (raw === null || raw === undefined || typeof raw !== 'object') return [];
  const data = raw as { version?: unknown; characters?: unknown };
  if (data.version !== 1 || !Array.isArray(data.characters)) return [];
  const kept: SavedCharacter[] = [];
  for (const item of data.characters) {
    const parsed = savedCharacterSchema.safeParse(item);
    if (parsed.success) kept.push(parsed.data);
    if (kept.length === LIBRARY_MAX) break;
  }
  return kept;
}

function writeLibrary(ctx: GameContext, profileId: string, characters: SavedCharacter[]): void {
  try {
    ctx.profileData?.write(profileId, { version: 1, characters });
  } catch {
    // Stockage plein ou indisponible : la partie continue, seul le souvenir du personnage est perdu.
  }
}

function newLibraryId(ctx: GameContext): string {
  return `lib-${Math.floor(ctx.random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0')}`;
}

/**
 * Sauvegarde les personnages joués par des joueurs qui ont un profil. Un personnage garde son identifiant de
 * bibliothèque d'une sauvegarde à l'autre. La liste est relue avant d'être écrite : un autre salon du même profil
 * ne perd pas ses personnages.
 */
function saveLibraries(s: AventureState, ctx: GameContext): AventureState {
  if (!ctx.profileData) return s;
  let characters = s.characters;
  for (const playerId of s.order) {
    const profileId = s.profiles[playerId];
    if (!profileId || !characters.some((c) => c.ownerId === playerId)) continue;
    const now = ctx.now();
    let list = readLibrary(ctx, profileId);
    characters = characters.map((c) => {
      if (c.ownerId !== playerId) return c;
      const libraryId = c.libraryId ?? newLibraryId(ctx);
      const saved: SavedCharacter = {
        libraryId,
        name: c.name,
        title: c.title,
        emoji: c.emoji,
        backstory: c.backstory,
        stats: c.stats,
        pvMax: c.pvMax,
        ability: c.ability,
        flaw: c.flaw,
        item: c.item,
        level: c.level,
        xp: c.xp,
        games: c.games,
        victories: c.victories,
        portraitId: c.portraitId,
        lastPlayed: now,
      };
      list = [saved, ...list.filter((x) => x.libraryId !== libraryId)];
      return c.libraryId === libraryId ? c : { ...c, libraryId };
    });
    const kept = [...list].sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, LIBRARY_MAX);
    writeLibrary(ctx, profileId, kept);
  }
  return { ...s, characters };
}

/** Compte la partie une seule fois : parties jouées pour chaque personnage, victoires si l'aventure est gagnée. */
function recordGame(s: AventureState, ctx: GameContext): AventureState {
  if (s.recorded) return s;
  const won = s.victory === true;
  const characters = s.characters.map((c) =>
    c.ownerId === null ? c : { ...c, games: c.games + 1, victories: c.victories + (won ? 1 : 0) },
  );
  return saveLibraries({ ...s, characters, recorded: true }, ctx);
}

/** Gains d'un choix réussi ou raté : expérience, objet, soin, blessure, lien avec le personnage de la scène. */
function applyChoiceEffects(
  s: AventureState,
  actor: Character,
  choice: Choice,
  success: boolean,
  npcName: string | null,
): { characters: Character[]; npcs: Npc[]; progress: string[] } {
  const progress: string[] = [];
  let updated = actor;
  if (success) {
    const grown = gainXp(updated, XP_SUCCESS);
    updated = grown.character;
    progress.push(...grown.lines);
    if (choice.item) {
      const got = gainItem(updated, choice.item);
      updated = got.character;
      progress.push(...got.lines);
    }
    const healed = heal(updated, choice.heal);
    updated = healed.character;
    progress.push(...healed.lines);
  } else {
    const hurt = loseLife(updated, choice.risk);
    updated = hurt.character;
    progress.push(...hurt.lines);
  }

  let npcs = s.npcs;
  if (npcName && choice.bond !== 0) {
    npcs = npcs.map((n) => (sameName(n.name, npcName) ? { ...n, bond: shiftBond(n.bond, choice.bond) } : n));
    const after = npcs.find((n) => sameName(n.name, npcName));
    if (after) progress.push(`${npcName} : lien ${relationOf(after.bond)}.`);
  }
  const characters = s.characters.map((c) => (c.id === actor.id ? updated : c));
  return { characters, npcs, progress };
}

/**
 * Clôture du vote. Le choix le plus soutenu l'emporte (égalité tranchée au hasard, aucun vote : choix au hasard).
 * Le personnage du premier joueur qui a voté ce choix tente sa chance, et la conséquence prévue s'applique.
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
  const consequence = success ? winner.onSuccess : winner.onFailure;

  const effects = applyChoiceEffects(s, actor, winner, success, scene.npc?.name ?? null);
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
    consequence,
    progress: effects.progress,
  };
  const recap: Recap = {
    sceneTitle: scene.title,
    text: `${actor.name} tente « ${winner.label} » (${success ? 'réussi' : 'raté'}, jet ${total} contre ${winner.difficulty}). ${consequence}`,
  };
  const next = saveLibraries(
    {
      ...s,
      characters: effects.characters,
      npcs: effects.npcs,
      resolution,
      history: [...s.history, recap],
      scene: null,
      reveal: true,
      queued: null,
    },
    ctx,
  );
  ctx.schedule(REVEAL_TIMEOUT, REVEAL_MS);

  if (ownedCharacters(next).every((c) => c.pv === 0)) return askEpilogue(next, false, ctx);
  if (next.sceneNumber >= next.settings.scenes) return askEpilogue(next, true, ctx);
  return askScene(next, ctx);
}

/** Manche suivante : chacun choisit à nouveau son action. */
function startRound(s: AventureState, ctx: GameContext): AventureState {
  if (!s.combat) return s;
  ctx.cancel(REVEAL_TIMEOUT);
  ctx.schedule(COMBAT_TIMEOUT, ROUND_MS);
  return {
    ...s,
    reveal: false,
    queued: null,
    combat: { ...s.combat, round: s.combat.round + 1, step: 'act', actions: {}, progress: [] },
    endsAt: ctx.now() + ROUND_MS,
  };
}

/** Règle la manche en cours : bilan affiché, puis suite (autre manche, scène suivante, épilogue). */
function resolveCombatRound(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(COMBAT_TIMEOUT);
  const combat = s.combat;
  if (!combat || combat.step !== 'act' || combat.over) return s;

  const result = resolveRound({
    characters: s.characters,
    order: s.order,
    combat,
    random: ctx.random,
    ownerName: (id) => s.players[id] ?? null,
  });

  // Expérience gagnée pendant la manche : les niveaux suivent, et le butin revient au premier debout.
  const progress: string[] = [];
  let characters = result.characters.map((c) => {
    const before = s.characters.find((o) => o.id === c.id);
    const gained = before ? c.xp - before.xp : 0;
    if (gained > 0) progress.push(`${c.name} gagne ${gained} d’expérience.`);
    const synced = syncLevel(c);
    progress.push(...synced.lines);
    return synced.character;
  });
  const foe: Foe = { ...combat.foe, hp: result.foeHp };
  if (result.outcome === 'victory' && combat.foe.loot) {
    const holder = s.order
      .map((id) => characters.find((c) => c.ownerId === id && c.pv > 0))
      .find((c): c is Character => c !== undefined);
    if (holder) {
      const got = gainItem(holder, combat.foe.loot);
      characters = characters.map((c) => (c.id === holder.id ? got.character : c));
      progress.push(...got.lines);
    }
  }

  const ongoing = result.outcome === 'ongoing';
  const reportCombat: Combat = {
    ...combat,
    foe,
    step: 'reveal',
    actions: {},
    report: result.report,
    over: !ongoing,
    progress,
  };
  const next = saveLibraries({ ...s, characters }, ctx);
  ctx.schedule(REVEAL_TIMEOUT, REVEAL_MS);
  const reveal = { reveal: true, endsAt: ctx.now() + REVEAL_MS, queued: null };

  if (ongoing) {
    return { ...next, ...reveal, combat: reportCombat };
  }

  const verdict =
    result.outcome === 'victory'
      ? `${foe.name} est vaincu`
      : result.outcome === 'flight'
        ? `${foe.name} s’enfuit`
        : 'le groupe est à terre';
  const recap: Recap = {
    sceneTitle: combat.sceneTitle,
    text: `Combat contre ${foe.name} : ${verdict}. ${result.report.consequence ?? ''}`.trim(),
  };
  const ended: AventureState = { ...next, ...reveal, combat: reportCombat, history: [...s.history, recap] };

  if (result.outcome === 'defeat' || ownedCharacters(ended).every((c) => c.pv === 0)) {
    return askEpilogue(ended, false, ctx);
  }
  if (ended.sceneNumber >= ended.settings.scenes) return askEpilogue(ended, true, ctx);
  return askScene(ended, ctx);
}

/** Fin de la révélation : une manche suivante, ou le texte prêt qui s'affiche maintenant. */
function releaseReveal(s: AventureState, ctx: GameContext): AventureState {
  ctx.cancel(REVEAL_TIMEOUT);
  if (s.combat && !s.combat.over && s.combat.step === 'reveal') return startRound(s, ctx);
  const cleared = s.combat?.over ? { ...s, combat: null } : s;
  const next = { ...cleared, reveal: false, queued: null };
  if (!s.queued) return next;
  return s.queued.kind === 'scene'
    ? applyScene(next, s.queued.draft, s.queued.mode, ctx)
    : applyEpilogue(next, s.queued.draft, s.queued.mode, ctx);
}

/** Classement : expérience gagnée pendant la partie, plus un bonus si l'aventure est gagnée. */
function rankingOf(s: AventureState) {
  const points: Record<string, number> = Object.fromEntries(s.order.map((id) => [id, 0]));
  for (const c of s.characters) {
    if (c.ownerId === null) continue;
    const earned = Math.max(0, c.xp - c.xpStart);
    points[c.ownerId] = (points[c.ownerId] ?? 0) + earned + (s.victory ? VICTORY_POINTS : 0);
  }
  return rankEntries(s.players, points);
}

function durationOf(s: AventureState): number {
  if (s.phase === 'choose') return CHOOSE_MS;
  if (s.phase === 'vote') return s.settings.voteSeconds * 1000;
  if (s.phase === 'combat') return s.combat?.step === 'reveal' ? REVEAL_MS : ROUND_MS;
  return 0;
}

/** Le thème tel qu'il s'affiche : son libellé du catalogue, sinon le texte libre, sinon « au choix du conteur ». */
function themeLabelOf(s: AventureState): string {
  const preset = themeById(s.themeKey);
  if (preset) return preset.label;
  return s.settings.theme.trim() || 'Au choix du conteur';
}

/** Ajoute un joueur qui arrive dans la salle : son profil, et les personnages qu'il a gardés. */
function withProfile(s: AventureState, p: PlayerRef, ctx: GameContext): AventureState {
  if (!p.profileId) return s;
  return {
    ...s,
    profiles: { ...s.profiles, [p.id]: p.profileId },
    library: { ...s.library, [p.id]: readLibrary(ctx, p.profileId) },
  };
}

/**
 * Revalide une réponse de l'IA avant de l'intégrer : les valeurs par défaut s'appliquent (soin, risque, lien),
 * et une réponse hors format devient null, ce qui fait basculer sur l'histoire de secours.
 */
/** Le travail de bibliothèque (roster) renvoie son contenu avec ses images ; les autres renvoient le contenu seul. */
function unwrapJob(kind: JobInput['kind'], value: unknown): { value: unknown; images: RosterImages | null } {
  if (kind === 'roster' && value !== null && typeof value === 'object' && 'draft' in value) {
    const wrapped = value as { draft: unknown; images?: RosterImages | null };
    return { value: wrapped.draft, images: wrapped.images ?? null };
  }
  return { value, images: null };
}

function checkedDraft(kind: JobInput['kind'], value: unknown): unknown {
  if (kind === 'roster') {
    const parsed = rosterDraftSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (kind === 'scene') {
    const parsed = sceneDraftSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  const parsed = epilogueDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const aventureIa: GameModule<AventureState, AventureSettings> = {
  manifest: {
    id: 'aventure-ia',
    category: 'role',
    name: 'Aventure IA',
    description:
      'Une aventure courte et racontée en direct : chacun incarne un personnage, parle aux habitants, vote les choix, affronte les ennemis tour par tour, et garde son personnage pour la prochaine partie.',
    icon: '🐉',
    version: '1.2.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: MAX_CHARACTERS,
    durationMin: 12,
    ai: true,
    notice: {
      goal: 'Atteindre l’objectif de l’aventure, sans que tous les personnages tombent.',
      steps: [
        'Choisissez votre personnage et lisez sa fiche. Si vous avez déjà joué, vous pouvez reprendre un ancien personnage, avec son niveau.',
        'Chaque scène propose des choix : une rencontre, un dialogue avec un habitant, une énigme, une halte, ou un affrontement. Votez pour le choix qui vous tente : il se joue avec un jet de dé.',
        'Les réponses aux habitants comptent : un personnage qui plaît ouvre des portes, un personnage vexant les ferme.',
        'Un affrontement se joue tour par tour : chacun choisit une action à chaque manche (frapper, feinter, soigner, parlementer).',
        'Les réussites donnent de l’expérience : un personnage monte de niveau, trouve des objets, et garde tout cela pour la prochaine partie.',
      ],
      tips: [
        'Chaque choix a une conséquence claire : la réussite ou l’échec du jet fait avancer l’histoire.',
        'Un combat se gagne en équipe : soignez le plus blessé avant qu’il ne tombe.',
        'Les personnages secondaires se souviennent de vous : soyez aimable, ou gagnez-les par la ruse.',
        'Quand tous les personnages sont à terre, l’aventure se termine en défaite.',
        'Sans IA configurée sur le serveur, l’aventure se joue avec une histoire de secours, avec des thèmes écrits à l’avance.',
      ],
    },
  },

  settingsSchema: aventureSettingsSchema,
  defaultSettings: aventureSettingsSchema.parse({}),

  actions: {
    pick: pickSchema,
    vote: voteSchema,
    combat: combatSchema,
  },

  hostActions: {
    regenerate: regenerateSchema,
  },

  initialize(settings, players, ctx) {
    const base: AventureState = {
      phase: 'lobby',
      settings: aventureSettingsSchema.parse(settings),
      players: directory(players),
      order: players.map((p) => p.id),
      themeKey: null,
      world: null,
      characters: [],
      npcs: [],
      met: [],
      arc: null,
      mode: null,
      sceneNumber: 0,
      scene: null,
      votes: {},
      resolution: null,
      combat: null,
      history: [],
      epilogue: null,
      victory: null,
      profiles: {},
      backgroundId: null,
      library: {},
      recorded: false,
      job: null,
      jobSeq: 0,
      endsAt: 0,
      reveal: false,
      queued: null,
    };
    return players.reduce((s, p) => withProfile(s, p, ctx), base);
  },

  onPlayerJoin(s, p: PlayerRef, ctx) {
    if (s.phase !== 'lobby') return s;
    const joined = withProfile(s, p, ctx);
    return {
      ...joined,
      players: { ...joined.players, [p.id]: p.name },
      order: [...joined.order.filter((id) => id !== p.id), p.id],
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'lobby') return s;
    const players = { ...s.players };
    delete players[p.id];
    const profiles = { ...s.profiles };
    delete profiles[p.id];
    const library = { ...s.library };
    delete library[p.id];
    return { ...s, players, order: s.order.filter((id) => id !== p.id), profiles, library };
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
      const id = parsed.data.characterId;
      const released = releaseOwned(s, p.id);
      const saved = (s.library[p.id] ?? []).find((l) => l.libraryId === id);
      let characters: Character[];
      if (saved) {
        if (released.characters.some((c) => c.id === id)) return fail('Ce personnage est déjà pris');
        characters = [...released.characters, fromSaved(saved, p.id)];
      } else {
        const target = released.characters.find((c) => c.id === id);
        if (!target) return fail('Personnage inconnu');
        if (target.ownerId !== null) return fail('Ce personnage est déjà pris');
        characters = released.characters.map((c) => (c.id === id ? { ...c, ownerId: p.id } : c));
      }
      const next = { ...released, characters };
      const done = everyConnectedDone(ctx, s.order, (pid) => characterOf(next, pid) !== undefined);
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

    if (type === 'combat') {
      if (s.phase !== 'combat' || !s.combat || s.combat.step !== 'act') return fail('Pas de manche en cours');
      const mine = characterOf(s, p.id);
      if (!mine) return fail('Vous n’avez pas de personnage dans cette aventure');
      if (mine.pv <= 0) return fail('Votre personnage est à terre : vous suivez le combat en spectateur');
      const parsed = combatSchema.safeParse(payload);
      if (!parsed.success) return fail('Action de combat invalide');
      const combat: Combat = { ...s.combat, actions: { ...s.combat.actions, [p.id]: parsed.data.action } };
      const next = { ...s, combat };
      const done = everyConnectedDone(ctx, activeOwnerIds(next), (id) => id in combat.actions);
      return ok(done ? resolveCombatRound(next, ctx) : next);
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
    const unwrapped = outcome.ok ? unwrapJob(input.kind, outcome.value) : { value: null, images: null };
    const data = checkedDraft(input.kind, unwrapped.value);
    const cleared: AventureState = { ...s, job: null };

    if (input.kind === 'roster') {
      if (data) return applyRoster(cleared, data as RosterDraft, 'ia', null, ctx, unwrapped.images);
      const fallback = fallbackRoster(ctx.random, s.themeKey);
      return applyRoster(cleared, fallback.roster, 'secours', fallback.arc, ctx);
    }

    const mode: ContentMode = data ? 'ia' : 'secours';
    const queued: Queued =
      input.kind === 'scene'
        ? {
            kind: 'scene',
            mode,
            draft:
              (data as SceneDraft | null) ??
              fallbackScene(
                ctx.random,
                s.arc,
                input.sceneNumber,
                input.total,
                s.history.map((h) => h.sceneTitle),
              ),
          }
        : {
            kind: 'epilogue',
            mode,
            draft: (data as EpilogueDraft | null) ?? fallbackEpilogue(s.arc, input.victory),
          };
    // Pendant une révélation, le texte attend : il ne remplace pas le résultat affiché.
    if (s.reveal) return { ...cleared, queued };
    return queued.kind === 'scene'
      ? applyScene(cleared, queued.draft, mode, ctx)
      : applyEpilogue(cleared, queued.draft, mode, ctx);
  },

  onTimer(s, key, ctx) {
    if (key === CHOOSE_TIMEOUT && s.phase === 'choose') return finishChoose(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return resolveVote(s, ctx);
    if (key === COMBAT_TIMEOUT && s.phase === 'combat') return resolveCombatRound(s, ctx);
    if (key === REVEAL_TIMEOUT && s.reveal) return releaseReveal(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.reveal) return releaseReveal(s, ctx);
    if (s.phase === 'choose') return finishChoose(s, ctx);
    if (s.phase === 'vote') return resolveVote(s, ctx);
    if (s.phase === 'combat') return resolveCombatRound(s, ctx);
    return s;
  },

  calculateScores(s) {
    return rankingOf(s);
  },

  end(s, ctx) {
    return endAdventure(s, ctx);
  },

  getPublicState(s) {
    return {
      phase: s.phase,
      preparing: s.job?.kind ?? s.queued?.kind ?? null,
      reveal: s.reveal,
      mode: s.mode,
      theme: themeLabelOf(s),
      difficulty: DIFFICULTY_LABELS[s.settings.difficulte],
      tone: TONE_LABELS[s.settings.tone],
      // Le secret de l'histoire reste caché jusqu'à l'épilogue.
      world: s.world ? { title: s.world.title, intro: s.world.intro, goal: s.world.goal } : null,
      backgroundId: s.backgroundId,
      characters: s.characters.map((c) => publicSheet(c, s.players)),
      npcs: s.npcs.map((n) => ({ ...n, met: s.met.includes(n.name), relation: relationOf(n.bond) })),
      playerCount: s.order.length,
      pickedCount: s.order.filter((id) => characterOf(s, id) !== undefined).length,
      sceneNumber: s.sceneNumber,
      total: s.settings.scenes,
      scene: s.scene
        ? {
            kind: s.scene.kind,
            title: s.scene.title,
            text: s.scene.text,
            hint: s.scene.hint,
            npc: s.scene.npc ? { ...s.scene.npc, relation: relationOf(s.scene.npc.bond) } : null,
            // Les conséquences restent secrètes : on ne voit que les choix.
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
      combat: s.combat
        ? {
            foe: {
              name: s.combat.foe.name,
              title: s.combat.foe.title,
              emoji: s.combat.foe.emoji,
              intro: s.combat.foe.intro,
              hp: s.combat.foe.hp,
              hpMax: s.combat.foe.hpMax,
              defense: s.combat.foe.defense,
              damage: s.combat.foe.damage,
            },
            sceneTitle: s.combat.sceneTitle,
            round: s.combat.round,
            step: s.combat.step,
            actedCount: Object.keys(s.combat.actions).length,
            actorCount: activeOwnerIds(s).length,
            report: s.combat.report,
            over: s.combat.over,
            progress: s.combat.progress,
          }
        : null,
      history: s.history,
      epilogue: s.epilogue,
      victory: s.victory,
      endsAt: s.endsAt,
      durationMs: durationOf(s),
      ranking: rankingOf(s),
    };
  },

  getPlayerState(s, playerId) {
    const mine = characterOf(s, playerId);
    const alive = mine !== undefined && mine.pv > 0;
    const hasVoted = playerId in s.votes;
    const acted = s.combat !== null && playerId in s.combat.actions;
    return {
      characterId: mine?.id ?? null,
      ko: mine !== undefined && mine.pv === 0,
      canPick: s.phase === 'choose',
      canVote: s.phase === 'vote' && alive && !hasVoted,
      hasVoted,
      myVote: s.votes[playerId] ?? null,
      canAct: s.phase === 'combat' && s.combat !== null && s.combat.step === 'act' && alive && !acted,
      acted,
      myAction: s.combat?.actions[playerId] ?? null,
      /** Personnages gardés dans son profil : il peut en reprendre un au début de l'aventure. */
      library: (s.library[playerId] ?? []).map((l) => ({
        libraryId: l.libraryId,
        name: l.name,
        title: l.title,
        emoji: l.emoji,
        portraitId: l.portraitId,
        level: l.level,
        games: l.games,
        victories: l.victories,
        inPlay: s.characters.some((c) => c.id === l.libraryId),
      })),
    };
  },

  getHostState(s) {
    const combat = s.combat;
    const waiting =
      s.phase === 'choose'
        ? s.order.filter((id) => characterOf(s, id) === undefined)
        : s.phase === 'vote'
          ? activeOwnerIds(s).filter((id) => !(id in s.votes))
          : s.phase === 'combat' && combat?.step === 'act'
            ? activeOwnerIds(s).filter((id) => !(id in combat.actions))
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
    if (
      s.phase === 'combat' &&
      s.combat?.step === 'act' &&
      isActiveOwner(s, playerId) &&
      !(playerId in s.combat.actions)
    ) {
      return {
        type: 'combat',
        payload: { action: pickAction(random) },
        key: `combat:${s.combat.round}:${playerId}`,
      };
    }
    return null;
  },
};

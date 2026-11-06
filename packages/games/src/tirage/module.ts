import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { addPoints, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { distanceKm, pinSchema, pointsFor, SCALE_BY_DIFFICULTY, type Pin } from '../photo-mystere/module.js';
import { PHOTOS } from '../photo-mystere/photos.js';
import banqueEstimer from './banque-estimer.fr.json' with { type: 'json' };
import banqueEspeces from './banque-especes.fr.json' with { type: 'json' };
import banqueLivres from './banque-livres.fr.json' with { type: 'json' };
import banqueIdentifier from './banque-identifier.fr.json' with { type: 'json' };
import { rechercherThemeLibre, resultatLibreSchema } from './theme-libre.js';

/**
 * Tirage surprise : chaque manche est tirée au hasard parmi trois modes.
 * - Estimer : un chiffre réel à deviner (Wikidata).
 * - Identifier : quatre choix (auteur d'un tableau, espèce, auteur d'un livre) ou deux choix (Chronologie).
 * - Localiser : un point à placer sur la carte, à partir d'une photo de lieu (Wikimedia Commons, via Photo mystère).
 * Ce fichier contient les règles ; il est pur.
 */

/** Thèmes au lancement : chaque manche vient d'un thème coché. Les thèmes libres avec IA ne sont pas encore là. */
export const THEMES = ['Animaux', 'Monuments', 'Peintures', 'Pays', 'Littérature'] as const;
export type Theme = (typeof THEMES)[number];

export const tirageSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(5),
  guessSeconds: z.number().int().min(20).max(180).default(60),
  difficulty: z.number().int().min(1).max(3).default(2),
  themes: z
    .array(z.enum(THEMES))
    .min(1)
    .default([...THEMES]),
  /** Thème libre facultatif, tapé par l'hôte : il remplace les thèmes cochés. Vide = pas de thème libre. */
  themeLibre: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().max(40).optional(),
  ),
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
  /** Image locale ; absente pour les livres (les couvertures ne sont pas libres). */
  image: z.string().startsWith('/tirage/').optional(),
  theme: z.string().min(1),
  source: z.string().min(1),
  /** Crédit du photographe ou de la collection, quand la licence le demande (CC BY, CC BY-SA). */
  credit: z.string().min(1).optional(),
  /** Année de première publication (livres), pour le mode Chronologie. */
  annee: z.number().int().optional(),
});

/** Une estimation : le chiffre réel et son unité. */
export interface Estimation extends z.infer<typeof estimerSchema> {
  kind: 'estimer';
}

/** Une identification, telle qu'elle est dans la banque : la réponse seulement, les choix sont tirés en partie. */
export interface IdentificationBase extends z.infer<typeof identifierSchema> {
  kind: 'identifier';
}

/** Une identification prête à jouer : des choix, dont la bonne réponse à l'index `bonne`. */
export interface Identification extends IdentificationBase {
  choix: string[];
  bonne: number;
}

/** Un lieu à placer sur la carte : la photo, et les coordonnées de la bonne place. */
export interface Localisation {
  kind: 'localiser';
  id: string;
  question: string;
  titre: string;
  image: string;
  theme: string;
  source: string;
  credit: string;
  lat: number;
  lon: number;
}

export type Entree = Estimation | Identification | Localisation;

/** Banques chargées et validées au démarrage ; une entrée mal formée fait échouer le chargement, pas une partie. */
export const BANQUE: Estimation[] = z
  .object({ entrees: z.array(estimerSchema).min(1) })
  .parse(banqueEstimer)
  .entrees.map((e) => ({ ...e, kind: 'estimer' as const }));

const identificationSchema = z.object({ entrees: z.array(identifierSchema).min(1) });

/** Tableaux (Met Museum), espèces (iNaturalist) et livres (Open Library) : une seule liste, les distracteurs viennent du même thème. */
export const BANQUE_IDENTIFICATION: IdentificationBase[] = [
  ...identificationSchema.parse(banqueIdentifier).entrees,
  ...identificationSchema.parse(banqueEspeces).entrees,
  ...identificationSchema.parse(banqueLivres).entrees,
].map((e) => ({ ...e, kind: 'identifier' as const }));

/** Lieux : les photos de Photo mystère, déjà contrôlées pour leur licence (auteur et source notés). */
export const BANQUE_LOCALISATION: Localisation[] = PHOTOS.map((p) => ({
  kind: 'localiser' as const,
  id: `lieu-${p.id}`,
  question: 'Où se trouve ce lieu ?',
  titre: p.place,
  image: p.file,
  theme: 'Monuments',
  source: p.source,
  credit: `${p.credit} · ${p.license}`,
  lat: p.lat,
  lon: p.lon,
}));

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
export const locateSchema = pinSchema;

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

/** Nombre de questions « Lequel a été publié en premier ? » par partie : chaque paire retire deux livres d'Attribuer. */
export const PAIRES_CHRONOLOGIE = 12;
/** Écart minimal entre deux années pour que la question ait une réponse nette. */
const ECART_MIN_ANNEES = 5;

/**
 * Paires de livres pour le mode Chronologie : « Lequel a été publié en premier ? ». Chaque paire est une question à deux
 * choix, prête à jouer. Renvoie aussi les livres utilisés, pour ne pas les reposer en Attribuer dans la même partie.
 */
export function pairesChronologie(livres: IdentificationBase[], random: () => number, n = PAIRES_CHRONOLOGIE) {
  const melange = shuffle(livres, random);
  const utilises = new Set<string>();
  const paires: Identification[] = [];
  for (let i = 0; i < melange.length && paires.length < n; i++) {
    const a = melange[i]!;
    if (utilises.has(a.id) || a.annee === undefined) continue;
    const b = melange.find(
      (x, j) =>
        j > i &&
        !utilises.has(x.id) &&
        x.annee !== undefined &&
        Math.abs(x.annee - a.annee!) >= ECART_MIN_ANNEES &&
        x.titre !== a.titre,
    );
    if (!b) continue;
    utilises.add(a.id);
    utilises.add(b.id);
    const [vieux, recent] = a.annee! <= b.annee! ? [a, b] : [b, a];
    const choix = shuffle([vieux.titre, recent.titre], random);
    paires.push({
      kind: 'identifier',
      id: `chrono-${vieux.id}-${recent.id}`,
      question: 'Lequel a été publié en premier ?',
      reponse: vieux.titre,
      titre: vieux.titre,
      theme: 'Littérature',
      source: vieux.source,
      credit: `Première publication : ${vieux.annee} (Open Library)`,
      choix,
      bonne: choix.indexOf(vieux.titre),
    });
  }
  return { paires, utilises };
}

/**
 * Prépare les quatre choix d'une identification : la bonne réponse et trois autres réponses du même thème.
 * Renvoie null s'il n'y a pas assez de réponses distinctes pour proposer quatre choix.
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
  pins: Record<string, Pin>;
  gains: Record<string, number>;
}

/** Thème libre en cours : « attente » pendant la recherche Wikidata, puis « pret » ou « secours » (thèmes fixes). */
export interface LibreEtat {
  theme: string;
  etat: 'attente' | 'pret' | 'secours';
  erreur: string | null;
}

export interface TirageState {
  settings: TirageSettings;
  phase: 'ready' | 'preparation' | 'guess' | 'reveal' | 'final';
  /** Présent quand l'hôte a tapé un thème libre. */
  libre: LibreEtat | null;
  names: Record<string, string>;
  /** Manches tirées pour la partie, sans répétition, les trois modes mêlés. */
  entrees: Entree[];
  index: number;
  /** Estimation (valeur) ou choix (index) de chaque joueur pour la manche en cours. */
  guesses: Record<string, number>;
  /** Point placé sur la carte par chaque joueur pour la manche en cours (mode Localiser). */
  pins: Record<string, Pin>;
  guessEndsAt: number;
  points: Record<string, number>;
  manches: Manche[];
}

/** Les joueurs ayant déjà répondu, quel que soit le mode de la manche. */
function aRepondu(s: TirageState, id: string): boolean {
  return id in s.guesses || id in s.pins;
}

function beginRound(s: TirageState, ctx: GameContext): TirageState {
  const limit = s.settings.guessSeconds * 1000;
  ctx.schedule(ESTIMATE_TIMEOUT, limit);
  return { ...s, phase: 'guess', guesses: {}, pins: {}, guessEndsAt: ctx.now() + limit };
}

function gainOf(entree: Entree, guess: number, difficulty: number): number {
  if (entree.kind === 'estimer') {
    const tolerance = TOLERANCE_BY_DIFFICULTY[difficulty as 1 | 2 | 3];
    return pointsEstimation(guess, entree.valeur, tolerance);
  }
  if (entree.kind === 'identifier') return pointsIdentification(guess, entree.bonne);
  return 0;
}

/** Points d'un point posé sur la carte : la distance à la bonne place, avec le barème du niveau de Photo mystère. */
function gainLocalisation(entree: Localisation, pin: Pin, difficulty: number): number {
  const echelle = SCALE_BY_DIFFICULTY[difficulty as 1 | 2 | 3];
  return pointsFor(distanceKm(pin, { lat: entree.lat, lon: entree.lon }), echelle);
}

/** Points d'un joueur pour la manche en cours, selon le mode : estimation, choix, ou point sur la carte. */
function gainPourJoueur(entree: Entree, s: TirageState, id: string): number {
  if (entree.kind === 'localiser') {
    const pin = s.pins[id];
    return pin ? gainLocalisation(entree, pin, s.settings.difficulty) : 0;
  }
  const guess = s.guesses[id];
  return guess === undefined ? 0 : gainOf(entree, guess, s.settings.difficulty);
}

function reveal(s: TirageState, ctx: GameContext): TirageState {
  ctx.cancel(ESTIMATE_TIMEOUT);
  const entree = s.entrees[s.index];
  if (!entree) return finish(s, ctx);
  let points = { ...s.points };
  const gains: Record<string, number> = {};
  for (const id of Object.keys(s.names)) {
    const gained = gainPourJoueur(entree, s, id);
    gains[id] = gained;
    points = addPoints(points, id, gained);
  }
  ctx.schedule(REVEAL_NEXT, REVEAL_DELAY_MS);
  return {
    ...s,
    phase: 'reveal',
    points,
    manches: [...s.manches, { entreeId: entree.id, guesses: s.guesses, pins: s.pins, gains }],
  };
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

/** Ce qui est révélé pour une manche : la valeur, l'auteur ou le lieu, la source, l'image et le crédit. */
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
  if (entree.kind === 'localiser') {
    return {
      valeur: null,
      reponse: entree.titre,
      source: entree.source,
      theme: entree.theme,
      image: entree.image,
      credit: entree.credit,
    };
  }
  return {
    valeur: null,
    reponse: entree.reponse,
    source: entree.source,
    theme: entree.theme,
    image: entree.image ?? null,
    credit: entree.credit ?? null,
  };
}

export const tirageSurprise: GameModule<TirageState, TirageSettings> = {
  manifest: {
    id: 'tirage-surprise',
    category: 'quiz',
    name: 'Tirage surprise',
    description: 'Des chiffres réels, des tableaux à attribuer et des lieux à placer : tout est tiré au sort.',
    icon: '🎲',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 8,
    notice: {
      goal: 'Deviner des chiffres réels, reconnaître un auteur, ou placer un lieu sur la carte.',
      steps: [
        'Lisez la question sur l’écran principal. Elle peut être une estimation, un choix ou un lieu à placer.',
        'Tapez votre estimation, touchez votre choix, ou touchez la carte, avant la fin du temps.',
        'À la révélation, les points viennent de l’écart avec la bonne valeur, de la bonne réponse, ou de la distance.',
      ],
      tips: [
        'Plus le niveau est difficile, plus la tolérance des estimations est étroite.',
        'Les chiffres viennent de Wikidata (CC0), les tableaux du Met Museum (CC0), les espèces d’iNaturalist (crédit affiché), les livres d’Open Library, les lieux de Wikimedia Commons (crédit affiché).',
      ],
    },
  },

  settingsSchema: tirageSettingsSchema,
  defaultSettings: tirageSettingsSchema.parse({}),

  actions: { estimate: estimateSchema, choose: chooseSchema, locate: locateSchema },

  initialize(settings, players, ctx) {
    const parsed = tirageSettingsSchema.parse(settings);
    // Les paires de Chronologie sont prêtes ; les livres qu'elles utilisent ne servent pas à Attribuer dans la même partie.
    const themes = new Set<string>(parsed.themes);
    const identifications = BANQUE_IDENTIFICATION.filter((e) => themes.has(e.theme));
    const { paires, utilises } = pairesChronologie(identifications, ctx.random);
    const pool: Array<Estimation | IdentificationBase | Identification | Localisation> = [
      ...BANQUE.filter((e) => themes.has(e.theme)),
      ...identifications.filter((e) => !utilises.has(e.id)),
      ...paires,
      ...BANQUE_LOCALISATION.filter((e) => themes.has(e.theme)),
    ];
    const entrees: Entree[] = [];
    for (const candidat of shuffle(pool, ctx.random)) {
      if (entrees.length >= parsed.rounds) break;
      if (candidat.kind === 'estimer' || candidat.kind === 'localiser') {
        entrees.push(candidat);
        continue;
      }
      if ('choix' in candidat) {
        entrees.push(candidat);
        continue;
      }
      const memeTheme = BANQUE_IDENTIFICATION.filter((e) => e.theme === candidat.theme).map((e) => e.reponse);
      const prete = preparerIdentification(candidat, memeTheme, ctx.random);
      if (prete) entrees.push(prete);
    }
    const libre: LibreEtat | null = parsed.themeLibre
      ? { theme: parsed.themeLibre, etat: 'attente', erreur: null }
      : null;
    return {
      settings: parsed,
      phase: 'ready',
      libre,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      entrees,
      index: 0,
      guesses: {},
      pins: {},
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
    if (next.phase === 'guess' && everyConnectedDone(ctx, Object.keys(next.names), (id) => aRepondu(next, id))) {
      return reveal(next, ctx);
    }
    return next;
  },

  start(s, ctx): GameResult<TirageState> {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    // Thème libre : la recherche Wikidata se fait dans un travail hors moteur ; la première manche suit son résultat.
    if (s.libre?.etat === 'attente') return ok({ ...s, phase: 'preparation' });
    if (s.entrees.length === 0) return fail('Aucune question disponible');
    return ok(beginRound(s, ctx));
  },

  // Travail hors moteur : la recherche du thème libre sur Wikidata (réseau), jamais dans le moteur.
  pendingJob(s) {
    if (s.phase !== 'preparation' || s.libre?.etat !== 'attente') return null;
    return { id: `theme:${s.libre.theme}`, kind: 'theme-libre', input: { theme: s.libre.theme } };
  },

  runJob(job, _ctx, signal) {
    return rechercherThemeLibre((job.input as { theme: string }).theme, signal);
  },

  completeJob(s, jobId, outcome, ctx) {
    if (s.phase !== 'preparation' || !s.libre || jobId !== `theme:${s.libre.theme}`) return s;
    const parsed = outcome.ok ? resultatLibreSchema.safeParse(outcome.value) : null;
    if (parsed?.success) {
      // Les questions libres sont prêtes : quatre choix, les trois leurres étant des pays de la même recherche.
      const entrees: Entree[] = parsed.data.entrees.map((q) => {
        const choix = shuffle([q.reponse, ...q.leurres], ctx.random);
        return {
          kind: 'identifier' as const,
          id: q.id,
          question: q.question,
          reponse: q.reponse,
          titre: q.titre,
          theme: parsed.data.theme,
          source: q.source,
          choix,
          bonne: choix.indexOf(q.reponse),
        };
      });
      const pret: TirageState = {
        ...s,
        libre: { ...s.libre, etat: 'pret', erreur: null },
        entrees: entrees.slice(0, s.settings.rounds),
        index: 0,
      };
      return beginRound(pret, ctx);
    }
    // Échec : la partie continue avec les thèmes fixes, et l'hôte voit pourquoi.
    const erreur = outcome.ok ? 'Réponse de Wikidata inexploitable' : outcome.error;
    const secours: TirageState = { ...s, libre: { ...s.libre, etat: 'secours', erreur } };
    if (secours.entrees.length === 0) return finish(secours, ctx);
    return beginRound(secours, ctx);
  },

  handleAction(s, p, type, payload, ctx): GameResult<TirageState> {
    if (type !== 'estimate' && type !== 'choose' && type !== 'locate') return fail('Action inconnue');
    if (s.phase !== 'guess') return fail('Pas de question en cours');
    if (!(p.id in s.names)) return fail('Joueur inconnu');
    const entree = s.entrees[s.index];
    if (!entree) return fail('Pas de question en cours');
    let next: TirageState;
    if (type === 'estimate') {
      if (entree.kind !== 'estimer') return fail('Cette question ne se répond pas par une estimation');
      const valeur = (payload as { valeur: number }).valeur;
      next = { ...s, guesses: { ...s.guesses, [p.id]: valeur } };
    } else if (type === 'choose') {
      if (entree.kind !== 'identifier') return fail('Cette question ne se répond pas par un choix');
      const choix = (payload as { choix: number }).choix;
      if (choix < 0 || choix >= entree.choix.length) return fail('Choix inconnu');
      next = { ...s, guesses: { ...s.guesses, [p.id]: choix } };
    } else {
      if (entree.kind !== 'localiser') return fail('Cette question ne se place pas sur la carte');
      const pin = locateSchema.safeParse(payload);
      if (!pin.success) return fail('Position invalide');
      next = { ...s, pins: { ...s.pins, [p.id]: pin.data } };
    }
    return ok(everyConnectedDone(ctx, Object.keys(next.names), (id) => aRepondu(next, id)) ? reveal(next, ctx) : next);
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

  // Vue publique : la question, les choix ou la carte pendant la devinette ; la bonne réponse seulement à la révélation.
  getPublicState(s) {
    const entree = s.entrees[s.index];
    const visible = entree && (s.phase === 'guess' || s.phase === 'reveal');
    const revealed = s.phase === 'reveal';
    const last = s.manches[s.manches.length - 1];
    const identification = entree?.kind === 'identifier' ? entree : null;
    const localisation = entree?.kind === 'localiser' ? entree : null;
    const choixDe = (guess: number | null | undefined): string | null =>
      identification && guess !== null && guess !== undefined ? (identification.choix[guess] ?? null) : null;
    const cible = revealed && localisation ? { lat: localisation.lat, lon: localisation.lon } : null;
    return {
      phase: s.phase,
      libre: s.libre ? { theme: s.libre.theme, etat: s.libre.etat, erreur: s.libre.erreur } : null,
      round: s.index + 1,
      total: s.entrees.length,
      endsAt: s.phase === 'guess' ? s.guessEndsAt : undefined,
      guessSeconds: s.settings.guessSeconds,
      kind: visible ? entree.kind : null,
      question: visible ? entree.question : null,
      unit: visible && entree.kind === 'estimer' ? entree.unite : null,
      image:
        visible && (identification || localisation) ? (identification?.image ?? localisation?.image ?? null) : null,
      choices: visible && s.phase === 'guess' && identification ? identification.choix : null,
      answered: new Set([...Object.keys(s.guesses), ...Object.keys(s.pins)]).size,
      playerCount: Object.keys(s.names).length,
      answer: revealed && entree ? answerOf(entree) : null,
      target: cible,
      placements:
        revealed && last
          ? Object.keys(s.names).map((id) => {
              const pin = last.pins[id] ?? null;
              return {
                playerId: id,
                name: s.names[id] ?? '?',
                guess: last.guesses[id] ?? null,
                choice: choixDe(last.guesses[id]),
                pin,
                km: pin && cible ? Math.round(distanceKm(pin, cible)) : null,
                gained: last.gains[id] ?? 0,
              };
            })
          : [],
      ranking: rankEntries(s.names, s.points),
    };
  },

  // Vue privée : sa propre réponse, jamais celles des autres avant la révélation.
  getPlayerState(s, playerId) {
    const rank = rankEntries(s.names, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      myGuess: s.guesses[playerId] ?? null,
      myPin: s.pins[playerId] ?? null,
      guessed: aRepondu(s, playerId),
      points: s.points[playerId] ?? 0,
      rank,
    };
  },

  getHostState(s) {
    return {
      pending:
        s.phase === 'guess'
          ? Object.keys(s.names)
              .filter((id) => !aRepondu(s, id))
              .map((id) => s.names[id])
          : [],
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  // Mode test : un robot répond au hasard, près de la bonne place pour un lieu, entre la moitié et le double pour une estimation.
  suggest(s, playerId, random) {
    const entree = s.entrees[s.index];
    if (s.phase !== 'guess' || !entree || aRepondu(s, playerId)) return null;
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
    if (entree.kind === 'localiser') {
      const lat = Math.max(-85, Math.min(85, entree.lat + (random() - 0.5) * 40));
      const lon = ((((entree.lon + (random() - 0.5) * 60 + 540) % 360) + 360) % 360) - 180;
      return { type: 'locate', payload: { lat, lon }, key, delayMs };
    }
    return {
      type: 'estimate',
      payload: { valeur: Math.round(entree.valeur * (0.5 + random() * 1.5)) },
      key,
      delayMs,
    };
  },
};

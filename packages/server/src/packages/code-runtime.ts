import ivm from 'isolated-vm';
import type {
  BotSuggestion,
  GameContext,
  GameJob,
  GameManifest,
  GameModule,
  GameResult,
  JobOutcome,
  PlayerRef,
} from '@partyhub/shared';

/**
 * Runtime d'un jeu de code : le bundle serveur tourne dans un isolat V8 séparé.
 *
 * Garanties (vérifiées par les tests) :
 * - pas de réseau, pas de système de fichiers, pas de processus : l'isolat n'a aucune API de Node ;
 * - mémoire bornée (isolat) et temps borné (chaque appel) ;
 * - l'état de partie vit côté hôte et voyage en JSON : une erreur ou un dépassement de temps
 *   fait échouer l'action, sans corrompre la partie.
 *
 * Limites connues : le jeu n'a ni IA, ni images, ni données de profil (le contexte ne les lui donne pas),
 * et il ne doit garder aucun état en mémoire entre deux appels (un même isolat sert toutes les salles).
 */

/** Mémoire maximale de l'isolat, en Mio. */
export const CODE_MEMORY_MB = 64;
/** Durée maximale d'un appel, en millisecondes : au-delà, l'appel échoue. */
export const CODE_CALL_TIMEOUT_MS = 2000;
/**
 * Dépassements de temps tolérés avant l'arrêt du jeu. Chaque dépassement bloque le serveur pendant
 * la durée du délai : le budget borne donc le temps total qu'un jeu peut immobiliser.
 */
export const CODE_MAX_TIMEOUTS = 5;

/** Nom de la variable globale que le bundle serveur (format iife) renseigne. */
export const CODE_SERVER_GLOBAL = '__partyhubGame';
/** Nom de la variable globale que le bundle des vues (format iife) renseigne. */
export const CODE_VIEW_GLOBAL = '__partyhubView';

/**
 * Code exécuté dans l'isolat avant le jeu. Il ne contient que de la logique de passage : le jeu lui-même
 * n'a accès qu'au contexte fourni ici (horloge, hasard, minuteurs, joueurs connectés).
 */
const SHIM = `
(function () {
  var mod = ${CODE_SERVER_GLOBAL}.default;
  var REQUIRED = ['initialize','onPlayerJoin','onPlayerLeave','start','handleAction','onTimer',
    'nextRound','calculateScores','end','getPublicState','getPlayerState','getHostState','isFinished'];
  function host(name, a, b) { return __hostCall.applySync(undefined, [name, a, b]); }
  var ctx = {
    now: function () { return host('now', null, null); },
    random: function () { return host('random', null, null); },
    schedule: function (key, ms) { host('schedule', String(key), Number(ms)); },
    cancel: function (key) { host('cancel', String(key), null); },
    connectedPlayerIds: function () { return JSON.parse(host('connected', null, null)); }
  };
  function plain(result) {
    if (result.success) return { success: true, data: result.data };
    return { success: false, error: { issues: result.error.issues } };
  }
  function ok(value) { return JSON.stringify({ v: value === undefined ? null : value }); }
  var actionNames = Object.keys(mod.actions || {});
  var hostActionNames = Object.keys(mod.hostActions || {});
  globalThis.__dispatch = function (method, wrapped) {
    var a = JSON.parse(wrapped).v;
    switch (method) {
      case 'meta':
        return ok({
          manifest: mod.manifest,
          defaults: mod.defaultSettings === undefined ? null : mod.defaultSettings,
          actions: actionNames,
          hostActions: hostActionNames,
          hasHostActions: typeof mod.handleHostAction === 'function',
          hasSuggest: typeof mod.suggest === 'function',
          hasJob: typeof mod.pendingJob === 'function' && typeof mod.completeJob === 'function',
          missing: REQUIRED.filter(function (n) { return typeof mod[n] !== 'function'; })
        });
      case 'settingsParse': return ok(plain(mod.settingsSchema.safeParse(a.value)));
      case 'actionParse': return ok(plain(mod.actions[a.type].safeParse(a.payload)));
      case 'hostActionParse': return ok(plain(mod.hostActions[a.type].safeParse(a.payload)));
      case 'initialize': return ok(mod.initialize(a.settings, a.players, ctx));
      case 'onPlayerJoin': return ok(mod.onPlayerJoin(a.state, a.player, ctx));
      case 'onPlayerLeave': return ok(mod.onPlayerLeave(a.state, a.player, ctx));
      case 'start': return ok(mod.start(a.state, ctx));
      case 'handleAction': return ok(mod.handleAction(a.state, a.player, a.type, a.payload, ctx));
      case 'handleHostAction': return ok(mod.handleHostAction(a.state, a.type, a.payload, ctx));
      case 'onTimer': return ok(mod.onTimer(a.state, a.key, ctx));
      case 'nextRound': return ok(mod.nextRound(a.state, ctx));
      case 'calculateScores': return ok(mod.calculateScores(a.state));
      case 'end': return ok(mod.end(a.state, ctx));
      case 'publicState': return ok(mod.getPublicState(a.state));
      case 'playerState': return ok(mod.getPlayerState(a.state, a.playerId));
      case 'hostState': return ok(mod.getHostState(a.state));
      case 'isFinished': return ok(mod.isFinished(a.state));
      case 'pendingJob': return ok(mod.pendingJob ? mod.pendingJob(a.state) : null);
      case 'completeJob': return ok(mod.completeJob(a.state, a.jobId, a.outcome, ctx));
      case 'suggest':
        return ok(mod.suggest ? mod.suggest(a.state, a.playerId, function () { return host('random', null, null); }, a.now) : null);
      default: throw new Error('Méthode inconnue : ' + method);
    }
  };
})();
`;

/** Portée d'un appel : le contexte du moteur et le générateur à utiliser. */
interface CallScope {
  ctx: GameContext | null;
  random: () => number;
}

const NO_SCOPE: CallScope = {
  ctx: null,
  random: () => {
    throw new Error('Aucun contexte pendant cet appel.');
  },
};

export interface CodeMeta {
  manifest: GameManifest;
  defaults: unknown;
  actions: string[];
  hostActions: string[];
  hasHostActions: boolean;
  hasSuggest: boolean;
  /** Vrai quand le jeu demande un travail hors moteur (ex. génération par IA). */
  hasJob?: boolean;
  missing: string[];
}

interface SafeParseLike {
  success: boolean;
  data?: unknown;
  error?: { issues: { path: PropertyKey[]; message: string; code: string }[] };
}

/** Ce qui se passe quand le runtime s'arrête tout seul (mémoire dépassée, délais répétés). */
export interface RuntimeHooks {
  /** Appelé une seule fois, avec la raison, quand le runtime s'arrête. */
  onStop?: (reason: string) => void;
  /** Dépassements de temps tolérés avant l'arrêt. */
  maxTimeouts?: number;
}

/** Vrai pour l'erreur que renvoie l'isolat quand un appel dépasse son délai. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && /timed out/i.test(err.message);
}

/** Un isolat par jeu de code installé : les appels sont synchrones, comme le moteur l'attend. */
export class CodeGameRuntime {
  private readonly isolate: ivm.Isolate;
  private readonly context: ivm.Context;
  private readonly dispatch: ivm.Reference;
  private scope: CallScope = NO_SCOPE;
  private disposed = false;
  private timeouts = 0;

  constructor(
    serverBundle: string,
    private readonly timeoutMs: number = CODE_CALL_TIMEOUT_MS,
    private readonly hooks: RuntimeHooks = {},
  ) {
    this.isolate = new ivm.Isolate({ memoryLimit: CODE_MEMORY_MB });
    this.context = this.isolate.createContextSync();
    this.context.global.setSync(
      '__hostCall',
      new ivm.Reference((name: string, a: unknown, b: unknown) => this.host(name, a, b)),
    );
    this.context.evalSync(serverBundle, { filename: 'game-server.js', timeout: timeoutMs });
    this.context.evalSync(SHIM, { filename: 'partyhub-shim.js', timeout: timeoutMs });
    this.dispatch = this.context.global.getSync('__dispatch', { reference: true });
  }

  /** Fonctions du contexte, reliées au moteur pendant un appel. */
  private host(name: string, a: unknown, b: unknown): unknown {
    const { ctx, random } = this.scope;
    // Le hasard d'un robot (suggest) est fourni par l'appelant, même sans contexte de partie.
    if (name === 'random') return random();
    if (!ctx) throw new Error('Appel du contexte hors d’un appel de jeu.');
    switch (name) {
      case 'now':
        return ctx.now();
      case 'schedule':
        ctx.schedule(String(a), Number(b));
        return null;
      case 'cancel':
        ctx.cancel(String(a));
        return null;
      case 'connected':
        return JSON.stringify(ctx.connectedPlayerIds());
      default:
        throw new Error(`Appel de contexte inconnu : ${name}`);
    }
  }

  /** Appelle une méthode de l'isolat. Les arguments et le résultat sont copiés en JSON. */
  call<T>(method: string, args: Record<string, unknown>, scope: CallScope = NO_SCOPE): T {
    if (this.isDisposed) throw new Error('Le runtime du jeu est arrêté.');
    const previous = this.scope;
    this.scope = scope;
    try {
      const text = this.dispatch.applySync(undefined, [method, JSON.stringify({ v: args })], {
        timeout: this.timeoutMs,
      }) as string;
      return JSON.parse(text).v as T;
    } catch (err) {
      this.observeFailure(err);
      throw err;
    } finally {
      this.scope = previous;
    }
  }

  /** Dépassements de temps constatés depuis le démarrage du runtime. */
  get timeoutCount(): number {
    return this.timeouts;
  }

  /** Arrête le runtime si l'isolat est tombé, ou si le budget de dépassements de temps est épuisé. */
  private observeFailure(err: unknown): void {
    if (this.isolate.isDisposed) {
      this.stop('mémoire dépassée');
      return;
    }
    if (!isTimeout(err)) return;
    this.timeouts++;
    const limit = this.hooks.maxTimeouts ?? CODE_MAX_TIMEOUTS;
    if (this.timeouts >= limit) {
      this.stop(`${this.timeouts} dépassements de temps de ${this.timeoutMs} ms`);
    }
  }

  /** Arrêt par le runtime lui-même : une seule fois, puis le rappel est prévenu. */
  private stop(reason: string): void {
    if (this.disposed) return;
    this.dispose();
    this.hooks.onStop?.(reason);
  }

  /** Lit les métadonnées du module et vérifie que toutes les méthodes requises existent. */
  meta(): CodeMeta {
    const meta = this.call<CodeMeta>('meta', {});
    if (meta.missing.length > 0) {
      throw new Error(`Méthodes absentes du module de jeu : ${meta.missing.join(', ')}.`);
    }
    return meta;
  }

  /** Libère l'isolat. Sans effet si l'isolat s'est déjà arrêté (dépassement de mémoire). */
  dispose(): void {
    if (!this.isolate.isDisposed) this.isolate.dispose();
    this.disposed = true;
  }

  /** Vrai une fois l'isolat arrêté, par dépassement de mémoire ou par `dispose`. */
  get isDisposed(): boolean {
    return this.disposed || this.isolate.isDisposed;
  }
}

function scopeOf(ctx: GameContext): CallScope {
  return { ctx, random: () => ctx.random() };
}

function issuesMessage(result: SafeParseLike): string {
  return result.error?.issues[0]?.message ?? 'Valeur invalide.';
}

/**
 * Construit un GameModule qui délègue au runtime isolé. Le moteur de salle l'utilise comme n'importe quel jeu :
 * toutes les méthodes sont synchrones, les schémas se valident dans l'isolat.
 */
export function createCodeModule(runtime: CodeGameRuntime, codeView?: { script: string; sha256: string }): GameModule {
  const meta = runtime.meta();
  /** Schéma au sens de zod (safeParse, parse) dont la validation se fait dans l'isolat. */
  const schemaOf = (parse: (value: unknown) => SafeParseLike) => ({
    safeParse: (value: unknown) => parse(value),
    parse: (value: unknown) => {
      const result = parse(value);
      if (!result.success) throw new Error(issuesMessage(result));
      return result.data;
    },
  });

  const actions = Object.fromEntries(
    meta.actions.map((type) => [
      type,
      schemaOf((payload) => runtime.call<SafeParseLike>('actionParse', { type, payload })),
    ]),
  );
  const settingsSchema = schemaOf((value) => runtime.call<SafeParseLike>('settingsParse', { value }));

  const stateCall = <T>(method: string, args: Record<string, unknown>, ctx: GameContext): T =>
    runtime.call<T>(method, args, scopeOf(ctx));

  const module: Record<string, unknown> = {
    manifest: meta.manifest,
    settingsSchema,
    defaultSettings: meta.defaults,
    actions,
    initialize: (settings: unknown, players: PlayerRef[], ctx: GameContext) =>
      stateCall('initialize', { settings, players }, ctx),
    onPlayerJoin: (state: unknown, player: PlayerRef, ctx: GameContext) =>
      stateCall('onPlayerJoin', { state, player }, ctx),
    onPlayerLeave: (state: unknown, player: PlayerRef, ctx: GameContext) =>
      stateCall('onPlayerLeave', { state, player }, ctx),
    start: (state: unknown, ctx: GameContext): GameResult<unknown> => stateCall('start', { state }, ctx),
    handleAction: (state: unknown, player: PlayerRef, type: string, payload: unknown, ctx: GameContext) =>
      stateCall<GameResult<unknown>>('handleAction', { state, player, type, payload }, ctx),
    onTimer: (state: unknown, key: string, ctx: GameContext) => stateCall('onTimer', { state, key }, ctx),
    nextRound: (state: unknown, ctx: GameContext) => stateCall('nextRound', { state }, ctx),
    calculateScores: (state: unknown) => runtime.call('calculateScores', { state }),
    end: (state: unknown, ctx: GameContext) => stateCall('end', { state }, ctx),
    getPublicState: (state: unknown) => runtime.call('publicState', { state }),
    getPlayerState: (state: unknown, playerId: string) => runtime.call('playerState', { state, playerId }),
    getHostState: (state: unknown) => runtime.call('hostState', { state }),
    isFinished: (state: unknown) => runtime.call<boolean>('isFinished', { state }),
  };

  if (meta.hasJob) {
    // Le travail (IA, réseau) ne tourne pas dans le bac à sable : il échoue proprement, et le jeu
    // reprend son contenu intégré (repli), comme quand aucune IA n'est configurée.
    module.pendingJob = (state: unknown) => runtime.call<GameJob | null>('pendingJob', { state });
    module.runJob = async () => {
      throw new Error('Travail IA indisponible dans un jeu de code : repli sur le contenu intégré.');
    };
    module.completeJob = (state: unknown, jobId: string, outcome: JobOutcome, ctx: GameContext) =>
      stateCall('completeJob', { state, jobId, outcome }, ctx);
  }
  if (meta.hasSuggest) {
    module.suggest = (state: unknown, playerId: string, random: () => number, now: number): BotSuggestion | null =>
      runtime.call<BotSuggestion | null>('suggest', { state, playerId, now }, { ctx: null, random });
  }
  if (meta.hasHostActions) {
    module.hostActions = Object.fromEntries(
      meta.hostActions.map((type) => [
        type,
        schemaOf((payload) => runtime.call<SafeParseLike>('hostActionParse', { type, payload })),
      ]),
    );
    module.handleHostAction = (state: unknown, type: string, payload: unknown, ctx: GameContext) =>
      stateCall('handleHostAction', { state, type, payload }, ctx);
  }

  if (codeView) module.codeView = codeView;
  return module as unknown as GameModule;
}

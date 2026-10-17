/**
 * Journal du navigateur : erreurs de script, promesses rejetées, écran de secours, appels API et
 * connexion temps réel. Les entrées sont mises en file, envoyées par lots à /api/logs/client, et
 * vidées quand la page se ferme. Un échec d'envoi ne doit jamais produire de nouvelle erreur.
 */

export type ClientLogLevel = 'error' | 'warn' | 'info';
export type ClientLogKind = 'boundary' | 'window' | 'promise' | 'console' | 'api' | 'socket' | 'page';
export type ClientLogExtra = Record<string, string | number | boolean | null>;

export interface ClientLogEntry {
  level: ClientLogLevel;
  kind: ClientLogKind;
  message: string;
  stack?: string;
  path?: string;
  time: string;
  session: string;
  app?: string;
  ua?: string;
  screen?: string;
  online?: boolean;
  extra?: ClientLogExtra;
}

const ENDPOINT = '/api/logs/client';
/** Au plus cette taille de file : au-delà, les plus anciennes entrées sont abandonnées et comptées. */
export const MAX_QUEUE = 100;
/** Taille d'un lot : le serveur accepte jusqu'à 25 entrées par requête. */
export const BATCH_SIZE = 10;
const FLUSH_DELAY_MS = 5000;

const MAX_MESSAGE = 500;
const MAX_STACK = 1500;

let queue: ClientLogEntry[] = [];
let dropped = 0;
let sending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let insideConsoleHook = false;
let session = 'inconnue';
let appVersion: string | undefined;

/** Coupe un texte trop long et indique qu'il a été coupé. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Message et pile d'appels d'une valeur lancée (Error, texte, objet quelconque). */
export function describeError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    const stack = value.stack ? clip(value.stack, MAX_STACK) : undefined;
    return { message: clip(value.message || value.name || 'Erreur', MAX_MESSAGE), stack };
  }
  if (typeof value === 'string') return { message: clip(value, MAX_MESSAGE) };
  try {
    return { message: clip(JSON.stringify(value) ?? String(value), MAX_MESSAGE) };
  } catch {
    return { message: clip(String(value), MAX_MESSAGE) };
  }
}

function sessionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

/** Champs communs : page, navigateur, taille d'écran. Lus au moment de l'erreur. */
function context(): Pick<ClientLogEntry, 'path' | 'session' | 'app' | 'ua' | 'screen' | 'online'> {
  const hasWindow = typeof window !== 'undefined';
  return {
    path: hasWindow ? window.location.pathname : undefined,
    session,
    app: appVersion,
    ua: typeof navigator !== 'undefined' ? clip(navigator.userAgent, 300) : undefined,
    screen: hasWindow ? `${window.innerWidth}x${window.innerHeight}` : undefined,
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
  };
}

/** Ajoute une entrée à la file. Les champs de navigateur sont lus seulement s'ils existent. */
export function logClient(
  level: ClientLogLevel,
  kind: ClientLogKind,
  message: string,
  details: { stack?: string; extra?: ClientLogExtra } = {},
): void {
  const entry: ClientLogEntry = {
    level,
    kind,
    message: clip(message || 'Erreur sans message', MAX_MESSAGE),
    stack: details.stack ? clip(details.stack, MAX_STACK) : undefined,
    time: new Date().toISOString(),
    ...context(),
    extra: details.extra,
  };
  enqueue(entry);
}

function enqueue(entry: ClientLogEntry): void {
  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    dropped += 1;
  }
  queue.push(entry);
  if (queue.length >= BATCH_SIZE) void flush();
  else schedule();
}

function schedule(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

/** Entrées de la file prêtes à partir : une mention des entrées abandonnées est ajoutée en tête. */
function takeBatch(size: number): ClientLogEntry[] {
  if (dropped > 0) {
    queue.unshift({
      level: 'warn',
      kind: 'page',
      message: `${dropped} entrée(s) de journal abandonnée(s) : file pleine`,
      time: new Date().toISOString(),
      ...context(),
    });
    dropped = 0;
  }
  return queue.splice(0, size);
}

/** Envoie un lot. En cas d'échec réseau ou serveur, le lot repart dans la file (sans boucle infinie). */
export async function flush(): Promise<void> {
  if (sending || queue.length === 0 || typeof fetch === 'undefined') return;
  sending = true;
  const batch = takeBatch(BATCH_SIZE);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    });
    // 429 et 4xx : le serveur refuse ce lot, inutile de le renvoyer. 5xx : on réessaiera.
    if (!res.ok && res.status >= 500) requeue(batch);
  } catch {
    requeue(batch);
  } finally {
    sending = false;
    if (queue.length > 0) schedule();
  }
}

function requeue(batch: ClientLogEntry[]): void {
  queue = [...batch, ...queue].slice(-MAX_QUEUE);
}

/** Dernier envoi au moment où la page se ferme : sendBeacon survit à la fermeture. */
export function flushOnExit(): void {
  if (queue.length === 0 || typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  const batch = takeBatch(25);
  const blob = new Blob([JSON.stringify({ entries: batch })], { type: 'application/json' });
  if (!navigator.sendBeacon(ENDPOINT, blob)) requeue(batch);
}

function consoleText(args: unknown[]): { message: string; stack?: string } {
  const stack = args.find((a): a is Error => a instanceof Error)?.stack;
  const message = args.map((a) => (a instanceof Error ? a.message : describeError(a).message)).join(' ');
  return { message: clip(message || 'Erreur console', MAX_MESSAGE), stack: stack ? clip(stack, MAX_STACK) : undefined };
}

/**
 * Branche le journal sur la page : une seule fois, au démarrage. Les erreurs sont aussi affichées
 * dans la console, comme avant.
 */
export function installClientLogging(version: string): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  appVersion = version;
  session = sessionId();

  window.addEventListener('error', (event) => {
    const { message, stack } = describeError(event.error ?? event.message);
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
    logClient('error', 'window', message, { stack, extra: where ? { source: where } : undefined });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const { message, stack } = describeError(event.reason);
    logClient('error', 'promise', message, { stack });
  });

  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
  });

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      if (insideConsoleHook) return;
      insideConsoleHook = true;
      try {
        const { message, stack } = consoleText(args);
        logClient(level, 'console', message, { stack });
      } finally {
        insideConsoleHook = false;
      }
    };
  }
}

/** Pour les tests : remet le module à zéro. */
export function resetClientLogForTests(): void {
  queue = [];
  dropped = 0;
  sending = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** Pour les tests : contenu de la file. */
export function queuedForTests(): readonly ClientLogEntry[] {
  return queue;
}

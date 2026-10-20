import fs from 'node:fs';
import Database from 'better-sqlite3';
import { loadConfig } from './config.js';
import { SecretBox } from './ai/secrets.js';

/**
 * Fichier de la clé locale des secrets (distinct de celle des clés d’IA, pour qu’aucune des deux ne s’écrase).
 * Les secrets enregistrés (mot de passe, jeton, clés) sont chiffrés avec elle : une copie de la base seule ne les révèle pas.
 */
export const SETTINGS_KEY_FILE = 'settings-secret.key';

/**
 * Réglages du serveur modifiables depuis l’administration. Ils remplacent les variables correspondantes du fichier
 * `.env` : la valeur saisie dans l’application (stockée dans la base, clé « server_settings ») l’emporte, et « Rétablir »
 * revient à la valeur du fichier. Ils sont appliqués au démarrage ; l’administration propose de redémarrer.
 *
 * Restent dans `.env` : l’adresse et les ports publiés, le dossier des données. Ils dépendent du conteneur, pas du serveur.
 * Les clés d’IA se règlent dans « Système → Intelligence artificielle », et le dépôt du magasin sur sa page.
 */

export const SERVER_SETTINGS_KEY = 'server_settings';

export type SettingGroup =
  'administration' | 'magasin' | 'journal' | 'sauvegardes' | 'reseau' | 'jeux' | 'images' | 'ia';

export const SETTING_GROUPS: readonly { id: SettingGroup; title: string; text: string }[] = [
  { id: 'administration', title: 'Administration', text: 'Mot de passe de l’administration.' },
  { id: 'magasin', title: 'Magasin de jeux', text: 'Jeton GitHub, pour les limites d’appels et les dépôts privés.' },
  { id: 'journal', title: 'Journal', text: 'Niveau et taille des fichiers de journal.' },
  { id: 'sauvegardes', title: 'Sauvegardes', text: 'Sauvegarde automatique de la base.' },
  { id: 'reseau', title: 'Réseau et sécurité', text: 'Cookies et proxys de confiance.' },
  { id: 'jeux', title: 'Jeux', text: 'Jeux intégrés à l’application.' },
  { id: 'images', title: 'Images (Aventure IA)', text: 'Fournisseurs d’images et plafonds.' },
  {
    id: 'ia',
    title: 'Intelligence artificielle',
    text: 'Réglages généraux. Les clés se saisissent dans « Intelligence artificielle ».',
  },
];

type Kind =
  | { kind: 'text' }
  | { kind: 'secret' }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'choice'; choices: readonly string[] }
  | { kind: 'bool' };

export type ServerSettingDef = Kind & {
  /** Nom de la variable d’environnement, identique à celui du fichier .env. */
  env: string;
  label: string;
  help: string;
  group: SettingGroup;
  /** Valeur quand rien n’est réglé (ce que le serveur utilise sans la variable). */
  defaultValue: string;
};

export const SERVER_SETTINGS: readonly ServerSettingDef[] = [
  {
    env: 'ADMIN_PASSWORD',
    kind: 'secret',
    label: 'Mot de passe de l’administration',
    help: 'Au moins 8 caractères. Pris en compte au prochain redémarrage. Laissez vide pour garder le mot de passe actuel.',
    group: 'administration',
    defaultValue: '',
  },
  {
    env: 'GITHUB_TOKEN',
    kind: 'secret',
    label: 'Jeton GitHub',
    help: 'Facultatif pour les dépôts publics. Il relève la limite d’appels de GitHub, et sert aux dépôts privés.',
    group: 'magasin',
    defaultValue: '',
  },
  {
    env: 'LOG_LEVEL',
    kind: 'choice',
    choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
    label: 'Niveau du journal',
    help: 'info suffit au quotidien. debug et trace produisent beaucoup de lignes.',
    group: 'journal',
    defaultValue: 'info',
  },
  {
    env: 'LOG_MAX_MB',
    kind: 'int',
    min: 1,
    max: 100,
    label: 'Taille maximale d’un fichier de journal (Mo)',
    help: 'Entre 1 et 100.',
    group: 'journal',
    defaultValue: '5',
  },
  {
    env: 'LOG_FILES',
    kind: 'int',
    min: 1,
    max: 50,
    label: 'Nombre de fichiers de journal gardés',
    help: 'Entre 1 et 50.',
    group: 'journal',
    defaultValue: '6',
  },
  {
    env: 'DB_BACKUP_EVERY_HOURS',
    kind: 'int',
    min: 0,
    max: 8760,
    label: 'Sauvegarde automatique, toutes les (heures)',
    help: '0 désactive la sauvegarde automatique.',
    group: 'sauvegardes',
    defaultValue: '24',
  },
  {
    env: 'DB_BACKUP_KEEP',
    kind: 'int',
    min: 1,
    max: 365,
    label: 'Nombre de sauvegardes gardées',
    help: 'Les plus anciennes sont supprimées au-delà de ce nombre.',
    group: 'sauvegardes',
    defaultValue: '7',
  },
  {
    env: 'COOKIE_SECURE',
    kind: 'bool',
    label: 'Cookies envoyés seulement en HTTPS',
    help: 'Laissez activé : PartyHub s’utilise en HTTPS.',
    group: 'reseau',
    defaultValue: 'true',
  },
  {
    env: 'TRUST_PROXY',
    kind: 'text',
    label: 'Proxys de confiance',
    help: 'loopback, ou le réseau du proxy. Derrière Caddy dans Docker : 172.16.0.0/12.',
    group: 'reseau',
    defaultValue: '172.16.0.0/12',
  },
  {
    env: 'BUILTIN_GAMES',
    kind: 'choice',
    choices: ['off', 'on'],
    label: 'Jeux intégrés sur une installation neuve',
    help: 'off : les jeux intégrés restent désactivés, à activer un par un.',
    group: 'jeux',
    defaultValue: 'off',
  },
  {
    env: 'CLOUDFLARE_ACCOUNT_ID',
    kind: 'text',
    label: 'Cloudflare : identifiant du compte',
    help: 'Pour les images générées par Cloudflare Workers AI.',
    group: 'images',
    defaultValue: '',
  },
  {
    env: 'CLOUDFLARE_API_TOKEN',
    kind: 'secret',
    label: 'Cloudflare : jeton d’API',
    help: 'Reste sur le serveur, jamais affiché.',
    group: 'images',
    defaultValue: '',
  },
  {
    env: 'MODELSCOPE_API_KEY',
    kind: 'secret',
    label: 'ModelScope : clé d’API',
    help: 'Reste sur le serveur, jamais affichée.',
    group: 'images',
    defaultValue: '',
  },
  {
    env: 'MODELSCOPE_ALLOW_NONCOMMERCIAL',
    kind: 'bool',
    label: 'ModelScope : usage non commercial déclaré',
    help: 'Sans cette case, ModelScope reste désactivé même avec sa clé.',
    group: 'images',
    defaultValue: 'false',
  },
  {
    env: 'IMAGE_PROVIDERS',
    kind: 'text',
    label: 'Ordre des fournisseurs d’images',
    help: 'Séparés par des virgules (cloudflare, modelscope). Vide : automatique.',
    group: 'images',
    defaultValue: '',
  },
  {
    env: 'IMAGE_MAX_PER_DAY',
    kind: 'int',
    min: 1,
    max: 100000,
    label: 'Nombre maximal d’images par jour',
    help: 'Tous fournisseurs confondus.',
    group: 'images',
    defaultValue: '150',
  },
  {
    env: 'IMAGE_TIMEOUT_MS',
    kind: 'int',
    min: 5000,
    max: 300000,
    label: 'Délai maximal pour une image (ms)',
    help: 'Entre 5 000 et 300 000.',
    group: 'images',
    defaultValue: '60000',
  },
  {
    env: 'AI_TIMEOUT_MS',
    kind: 'int',
    min: 5000,
    max: 120000,
    label: 'Délai maximal d’un appel à l’IA (ms)',
    help: 'Entre 5 000 et 120 000.',
    group: 'ia',
    defaultValue: '30000',
  },
  {
    env: 'AI_MAX_CALLS_PER_HOUR',
    kind: 'int',
    min: 1,
    max: 100000,
    label: 'Nombre maximal d’appels à l’IA par heure',
    help: 'Tous fournisseurs confondus.',
    group: 'ia',
    defaultValue: '300',
  },
];

const DEF_BY_ENV = new Map(SERVER_SETTINGS.map((def) => [def.env, def]));

export function settingDef(env: string): ServerSettingDef | undefined {
  return DEF_BY_ENV.get(env);
}

export type CheckResult = { ok: true; value: string } | { ok: false; error: string };

/** Vérifie la forme d’une valeur saisie. Les secrets ne sont jamais repris dans un message d’erreur. */
export function checkShape(def: ServerSettingDef, raw: string): CheckResult {
  const value = raw.trim();
  if (value === '') return { ok: true, value: '' };
  switch (def.kind) {
    case 'secret': {
      if (/\s/.test(value)) return { ok: false, error: 'Cette valeur ne doit pas contenir d’espace.' };
      if (value.length > 300) return { ok: false, error: 'Valeur trop longue.' };
      if (def.env === 'ADMIN_PASSWORD' && value.length < 8) {
        return { ok: false, error: 'Le mot de passe doit faire au moins 8 caractères.' };
      }
      return { ok: true, value };
    }
    case 'int': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < def.min || n > def.max) {
        return { ok: false, error: `Entier attendu, entre ${def.min} et ${def.max}.` };
      }
      return { ok: true, value: String(n) };
    }
    case 'choice':
      return def.choices.includes(value) ? { ok: true, value } : { ok: false, error: 'Choix inconnu.' };
    case 'bool':
      if (value === 'true' || value === 'false') return { ok: true, value };
      return { ok: false, error: 'Attendu : oui ou non.' };
    case 'text':
      if (value.length > 300) return { ok: false, error: 'Valeur trop longue.' };
      return { ok: true, value };
  }
}

/**
 * Vérifie que la configuration complète reste valide avec ce réglage. Le même contrôle que le démarrage : un
 * réglage ne peut donc jamais empêcher le serveur de démarrer.
 */
export function checkWholeConfig(baseEnv: NodeJS.ProcessEnv, overrides: Record<string, string>): string | null {
  try {
    loadConfig({ ...baseEnv, ...overrides });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Configuration invalide.';
  }
}

/**
 * Lit les réglages enregistrés, en gardant seulement ceux qui sont connus et bien formés. Les secrets sont
 * déchiffrés ; sans la clé locale (ou valeur abîmée), ils sont ignorés : il faudra les ressaisir.
 */
export function parseOverrides(raw: string | undefined, box: SecretBox): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [env, value] of Object.entries(parsed as Record<string, unknown>)) {
    const def = settingDef(env);
    if (!def || typeof value !== 'string') continue;
    const plain = def.kind === 'secret' ? box.open(value) : value;
    if (plain === null) continue;
    const checked = checkShape(def, plain);
    if (checked.ok && checked.value !== '') out[env] = checked.value;
  }
  return out;
}

/**
 * Réglages enregistrés, lus dans la base avant son ouverture complète (les migrations passent après la copie de
 * sécurité). Une base absente ou sans table donne aucun réglage.
 */
export function readSavedOverrides(dbFile: string, box: SecretBox): Record<string, string> {
  if (!fs.existsSync(dbFile)) return {};
  try {
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(SERVER_SETTINGS_KEY) as
        { value: string } | undefined;
      return parseOverrides(row?.value, box);
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

/**
 * Environnement de démarrage : le fichier .env, puis les réglages enregistrés. Si cette combinaison est invalide,
 * on revient au seul fichier .env : le serveur démarre, et l’erreur est signalée.
 */
export function resolveBootEnv(
  baseEnv: NodeJS.ProcessEnv,
  saved: Record<string, string>,
): { env: NodeJS.ProcessEnv; overrides: Record<string, string>; error: string | null } {
  const problem = checkWholeConfig(baseEnv, saved);
  if (problem === null) return { env: { ...baseEnv, ...saved }, overrides: saved, error: null };
  return { env: baseEnv, overrides: {}, error: problem };
}

export interface SettingView {
  env: string;
  label: string;
  help: string;
  group: SettingGroup;
  kind: ServerSettingDef['kind'];
  choices?: readonly string[];
  min?: number;
  max?: number;
  /** Valeur actuelle, sauf pour les secrets (jamais renvoyés). */
  value: string | null;
  /** Où vient la valeur : saisie dans l’application, fichier .env, ou valeur par défaut. */
  source: 'app' | 'fichier' | 'defaut';
  /** Vrai si une valeur existe (utile pour les secrets). */
  configured: boolean;
  defaultValue: string;
}

export interface StoreLike {
  getKv(key: string): string | undefined;
  setKv(key: string, value: string): void;
}

export interface ServerSettingsOptions {
  /** Environnement du fichier .env (sans les réglages enregistrés). */
  baseEnv: NodeJS.ProcessEnv;
  /** Réglages appliqués au démarrage : seuls ceux-là comptent pour « redémarrage nécessaire ». */
  booted: Record<string, string>;
  /** Chiffrement des secrets enregistrés. */
  box: SecretBox;
}

/** Réglages du serveur, lus et enregistrés par l’administration. */
export class ServerSettingsService {
  constructor(
    private readonly store: StoreLike,
    private readonly options: ServerSettingsOptions,
  ) {}

  saved(): Record<string, string> {
    return parseOverrides(this.store.getKv(SERVER_SETTINGS_KEY), this.options.box);
  }

  /** Vrai si les réglages enregistrés diffèrent de ceux appliqués au démarrage. */
  pendingRestart(): boolean {
    return JSON.stringify(sorted(this.saved())) !== JSON.stringify(sorted(this.options.booted));
  }

  list(): { settings: SettingView[]; groups: typeof SETTING_GROUPS; pendingRestart: boolean } {
    const saved = this.saved();
    const settings = SERVER_SETTINGS.map((def): SettingView => {
      const app = saved[def.env];
      const file = this.options.baseEnv[def.env]?.trim();
      const source: SettingView['source'] = app !== undefined ? 'app' : file ? 'fichier' : 'defaut';
      const current = app ?? (file || def.defaultValue);
      const view: SettingView = {
        env: def.env,
        label: def.label,
        help: def.help,
        group: def.group,
        kind: def.kind,
        value: def.kind === 'secret' ? null : current,
        source,
        configured: current !== '',
        defaultValue: def.defaultValue,
      };
      if (def.kind === 'choice') view.choices = def.choices;
      if (def.kind === 'int') {
        view.min = def.min;
        view.max = def.max;
      }
      return view;
    });
    return { settings, groups: SETTING_GROUPS, pendingRestart: this.pendingRestart() };
  }

  /**
   * Enregistre une valeur (vide = rétablir la valeur du fichier .env). Renvoie une erreur lisible sans jamais
   * répéter un secret.
   */
  set(env: string, raw: unknown): { ok: true; action: 'set' | 'reset' } | { ok: false; error: string; status: number } {
    const def = settingDef(env);
    if (!def) return { ok: false, error: 'Réglage inconnu.', status: 404 };
    if (typeof raw !== 'string') return { ok: false, error: 'Valeur attendue.', status: 400 };
    const checked = checkShape(def, raw);
    if (!checked.ok) return { ok: false, error: checked.error, status: 400 };

    const saved = this.saved();
    const next = { ...saved };
    if (checked.value === '') delete next[env];
    else next[env] = checked.value;

    const problem = checkWholeConfig(this.options.baseEnv, next);
    if (problem !== null) return { ok: false, error: problem, status: 400 };

    // Les secrets sont chiffrés avant d’être gardés : la base ne contient jamais leur valeur en clair.
    const stored = Object.fromEntries(
      Object.entries(next).map(([name, value]) => [
        name,
        settingDef(name)?.kind === 'secret' ? this.options.box.seal(value) : value,
      ]),
    );
    this.store.setKv(SERVER_SETTINGS_KEY, JSON.stringify(stored));
    return { ok: true, action: checked.value === '' ? 'reset' : 'set' };
  }
}

function sorted(record: Record<string, string>): [string, string][] {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

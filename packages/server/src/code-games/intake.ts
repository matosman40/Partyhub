import dns from 'node:dns/promises';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { DEFAULT_PACKAGE_LIMITS } from '../packages/format.js';
import type { CodeGameAudit, CodeGameInstallResult, CodeGameService } from './service.js';

/**
 * Deux voies d'ajout des jeux de code, en plus de l'éditeur :
 *  - le dossier de dépôt DATA_DIR/depot-jeux, relu à intervalle régulier ;
 *  - l'adresse HTTPS d'un fichier .phgame, collée par l'administrateur.
 * Dans les deux cas le paquet est vérifié (signature, contrôle de lancement) puis installé en attente de revue.
 * Rien ne s'active sans l'approbation de l'administrateur. PartyHub ne signe rien : la clé reste chez l'auteur.
 */

export const DROP_DIR_NAME = 'depot-jeux';
const PACKAGE_EXTENSION = '.phgame';
const MAX_BYTES = DEFAULT_PACKAGE_LIMITS.maxArchiveBytes;
const MAX_MEGABYTES = Math.round(MAX_BYTES / (1024 * 1024));
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

export type DropStatus = 'en_attente' | 'deja_recu' | 'refuse';

export interface DropFileReport {
  name: string;
  status: DropStatus;
  message: string;
  issues: string[];
  id?: string;
  version?: string;
  /** Moment de la lecture, en ISO. */
  readAt: string;
}

export interface DropState {
  folder: string;
  files: DropFileReport[];
}

/** Réponse d'un téléchargement : code, redirection éventuelle, corps lu au fil de l'eau. */
export interface HttpResponse {
  status: number;
  location?: string;
  contentLength?: number;
  body: AsyncIterable<Uint8Array>;
  /** Abandonne la réponse sans la lire (redirection, erreur). */
  discard(): void;
}

/** Accès réseau et résolution de noms, remplaçables dans les tests. */
export interface IntakeDeps {
  /** Adresses IP d'un nom d'hôte. */
  lookup: (host: string) => Promise<string[]>;
  /**
   * Télécharge une adresse HTTPS en se connectant à l'adresse IP déjà vérifiée : le nom n'est résolu qu'une fois,
   * par `lookup`, et la connexion ne peut pas aller ailleurs.
   */
  get: (url: URL, address: string) => Promise<HttpResponse>;
}

/**
 * Plages qui ne sont jamais des serveurs publics : boucle locale, réseaux privés, liens locaux, multicast.
 * Deux listes, une par famille : Node traite une IPv4 comme mappée dans l'espace IPv6, et une plage IPv6 la
 * couvrirait sinon.
 */
const BLOCKED_V4 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_V4.addSubnet(address, prefix, 'ipv4');
}
const BLOCKED_V6 = new net.BlockList();
for (const [address, prefix] of [
  ['::', 96],
  ['::1', 128],
  // Toute adresse IPv4 écrite en IPv6 (::ffff:a.b.c.d, sous forme pointée ou hexadécimale) est refusée.
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_V6.addSubnet(address, prefix, 'ipv6');
}

/** Vrai si l'adresse n'est pas publique, ou si elle ne se lit pas. */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) return BLOCKED_V4.check(address, 'ipv4');
  if (net.isIPv6(address)) return BLOCKED_V6.check(address, 'ipv6');
  return true;
}

async function defaultLookup(host: string): Promise<string[]> {
  const found = await dns.lookup(host, { all: true });
  return found.map((entry) => entry.address);
}

/**
 * Requête HTTPS vers une adresse déjà vérifiée. Le nom de l'URL reste celui du certificat, du SNI et de l'en-tête
 * Host ; seule la connexion est fixée à `address`. Le certificat est toujours vérifié.
 */
export function httpsGet(
  url: URL,
  address: string,
  options: { timeoutMs?: number; ca?: string } = {},
): Promise<HttpResponse> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const family = net.isIPv6(address) ? 6 : 4;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        // Une connexion neuve par téléchargement : aucune session réutilisée avec un autre certificat de confiance.
        agent: false,
        ca: options.ca,
        headers: { 'user-agent': 'PartyHub' },
        // La « résolution » rend l'adresse vérifiée : aucune seconde interrogation du DNS.
        lookup: (_host, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
      },
      (res) => {
        res.once('close', () => clearTimeout(timer));
        resolve({
          status: res.statusCode ?? 0,
          location: typeof res.headers.location === 'string' ? res.headers.location : undefined,
          contentLength:
            res.headers['content-length'] !== undefined ? Number(res.headers['content-length']) : undefined,
          body: res,
          discard: () => {
            res.resume();
          },
        });
      },
    );
    // Délai total, corps compris : au-delà, la requête est coupée.
    const timer = setTimeout(() => req.destroy(new Error('délai dépassé')), timeoutMs);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Ce qui interdit une adresse, en elle-même (sans la résoudre). Null si elle est acceptable. */
function urlProblem(url: URL): string | null {
  if (url.protocol !== 'https:') return 'Seules les adresses HTTPS sont acceptées.';
  if (url.username || url.password) return 'L’adresse ne doit pas contenir de mot de passe.';
  return null;
}

/** Corps de la réponse, ou null s'il dépasse la limite. La lecture s'arrête dès que la limite est franchie. */
async function readCapped(body: AsyncIterable<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > max) return null;
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export class CodeIntake {
  private readonly deps: IntakeDeps;
  /** Dernier résultat par fichier, avec la signature (taille et date) du fichier lu. */
  private readonly seen = new Map<string, { signature: string; report: DropFileReport }>();
  private files: DropFileReport[] = [];
  private scanning = false;

  constructor(
    private readonly dataDir: string,
    private readonly codeGames: CodeGameService,
    private readonly audit?: CodeGameAudit,
    deps: Partial<IntakeDeps> = {},
  ) {
    this.deps = {
      lookup: deps.lookup ?? defaultLookup,
      get: deps.get ?? ((url, address) => httpsGet(url, address)),
    };
    fs.mkdirSync(this.folder(), { recursive: true });
  }

  folder(): string {
    return path.join(this.dataDir, DROP_DIR_NAME);
  }

  /** Dernière lecture du dossier de dépôt. */
  state(): DropState {
    return { folder: DROP_DIR_NAME, files: this.files };
  }

  /**
   * Lit le dossier de dépôt. Un fichier déjà lu et resté identique n'est pas relu ; `force` relit tout.
   * Les paquets reçus arrivent en attente de revue : aucun n'est activé ici.
   */
  async scan(actor = 'dossier de dépôt', force = false): Promise<DropState> {
    if (this.scanning) return this.state();
    this.scanning = true;
    try {
      const dir = this.folder();
      fs.mkdirSync(dir, { recursive: true });
      if (force) this.seen.clear();
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.') && entry.name.endsWith(PACKAGE_EXTENSION))
        .sort((a, b) => a.name.localeCompare(b.name));
      const reports: DropFileReport[] = [];
      for (const entry of entries) {
        reports.push(await this.readEntry(path.join(dir, entry.name), entry.name, actor));
      }
      const present = new Set(entries.map((entry) => entry.name));
      for (const name of [...this.seen.keys()]) {
        if (!present.has(name)) this.seen.delete(name);
      }
      this.files = reports;
      return this.state();
    } finally {
      this.scanning = false;
    }
  }

  /** Relit le dossier de dépôt à intervalle régulier. Renvoie la fonction qui arrête la relecture. */
  watch(everyMs: number): () => void {
    const timer = setInterval(() => {
      this.scan().catch(() => undefined);
    }, everyMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async readEntry(file: string, name: string, actor: string): Promise<DropFileReport> {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return { name, status: 'refuse', message: 'Fichier illisible.', issues: [], readAt: new Date().toISOString() };
    }
    const signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = this.seen.get(name);
    if (cached && cached.signature === signature) return cached.report;
    const report = await this.process(file, name, stat, actor);
    this.seen.set(name, { signature, report });
    this.audit?.(
      'code_game.drop',
      { file: name, status: report.status, id: report.id ?? '', version: report.version ?? '', actor },
      `Dossier de dépôt : ${name}, ${report.message}`,
    );
    return report;
  }

  private async process(file: string, name: string, stat: fs.Stats, actor: string): Promise<DropFileReport> {
    const base = { name, issues: [] as string[], readAt: new Date().toISOString() };
    if (!stat.isFile()) {
      return { ...base, status: 'refuse', message: 'seuls les fichiers réguliers sont lus (pas de lien symbolique).' };
    }
    if (stat.size > MAX_BYTES) {
      return { ...base, status: 'refuse', message: `paquet trop volumineux (maximum ${MAX_MEGABYTES} Mio).` };
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(fs.readFileSync(file));
    } catch {
      return { ...base, status: 'refuse', message: 'lecture impossible.' };
    }
    let result: CodeGameInstallResult;
    try {
      result = await this.codeGames.install(bytes, actor);
    } catch (err) {
      return { ...base, status: 'refuse', message: errorMessage(err) };
    }
    if (!result.ok) {
      const issues = result.issues ?? [];
      return { ...base, issues, status: 'refuse', message: result.error };
    }
    if (result.unchanged) {
      return {
        ...base,
        id: result.id,
        version: result.version,
        status: 'deja_recu',
        message: `déjà installé : ${result.id} ${result.version}.`,
      };
    }
    return {
      ...base,
      id: result.id,
      version: result.version,
      status: 'en_attente',
      message: `reçu : ${result.id} ${result.version}, en attente de revue.`,
    };
  }

  /**
   * L'adresse à laquelle se connecter, ou la raison du refus. Le nom n'est résolu qu'ici : la connexion
   * part vers cette adresse, et nulle part ailleurs.
   */
  private async checkedAddress(url: URL): Promise<{ address: string } | { problem: string }> {
    const problem = urlProblem(url);
    if (problem) return { problem };
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    try {
      addresses = await this.deps.lookup(host);
    } catch {
      return { problem: 'Serveur introuvable.' };
    }
    const address = addresses[0];
    if (address === undefined || addresses.some(isPrivateAddress)) {
      return { problem: 'Adresse locale ou privée refusée.' };
    }
    return { address };
  }

  /** Suit les redirections une par une : chaque adresse est vérifiée, puis appelée à cette adresse seule. */
  private async download(start: URL): Promise<HttpResponse | string> {
    let current = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = await this.checkedAddress(current);
      if ('problem' in checked) return checked.problem;
      let res: HttpResponse;
      try {
        res = await this.deps.get(current, checked.address);
      } catch {
        return 'Téléchargement impossible.';
      }
      if (res.status >= 300 && res.status < 400 && res.location) {
        res.discard();
        try {
          current = new URL(res.location, current);
        } catch {
          return 'Redirection vers une adresse invalide.';
        }
        continue;
      }
      return res;
    }
    return 'Trop de redirections.';
  }

  /** Télécharge un paquet depuis une adresse HTTPS, puis l'installe en attente de revue. */
  async importUrl(raw: string, actor: string): Promise<CodeGameInstallResult> {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return { ok: false, error: 'Adresse invalide.' };
    }
    const outcome = await this.fetchAndInstall(url, actor);
    this.audit?.(
      'code_game.import_url',
      { host: url.hostname, ok: outcome.ok, actor },
      `Jeu de code importé depuis ${url.hostname} par ${actor} : ${outcome.ok ? 'reçu' : outcome.error}`,
    );
    return outcome;
  }

  private async fetchAndInstall(url: URL, actor: string): Promise<CodeGameInstallResult> {
    const downloaded = await this.download(url);
    if (typeof downloaded === 'string') return { ok: false, error: downloaded };
    if (downloaded.status < 200 || downloaded.status >= 300) {
      downloaded.discard();
      return { ok: false, error: `Le serveur distant répond ${downloaded.status} : rien n’a été reçu.` };
    }
    if (downloaded.contentLength !== undefined && downloaded.contentLength > MAX_BYTES) {
      downloaded.discard();
      return { ok: false, error: `Paquet trop volumineux (maximum ${MAX_MEGABYTES} Mio).` };
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(downloaded.body, MAX_BYTES);
    } catch {
      return { ok: false, error: 'Téléchargement interrompu.' };
    }
    if (bytes === null) return { ok: false, error: `Paquet trop volumineux (maximum ${MAX_MEGABYTES} Mio).` };
    try {
      return await this.codeGames.install(bytes, actor);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }
}

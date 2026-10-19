import { createHash } from 'node:crypto';
import { DEFAULT_PACKAGE_LIMITS } from '../packages/format.js';
import { compareVersions, isValidVersion } from '../packages/semver.js';
import { readZip, ZipError, type ZipFileEntry } from '../packages/zip.js';

/**
 * Client minimal de l’API GitHub pour les releases. Seules les releases publiques ou accessibles
 * avec le jeton du serveur sont lues. Les réponses sont limitées à des hôtes connus, pour qu’une
 * redirection ne puisse pas envoyer le téléchargement ailleurs.
 */

export const GITHUB_API = 'https://api.github.com';

export const ALLOWED_HOSTS = [
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
  // Hôte officiel des archives de dépôt (zipball) : la requête y est redirigée, sans le jeton.
  'codeload.github.com',
];

/** « auteur/depot » : caractères GitHub admis, sans chemin ni segment supplémentaire. */
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function isValidRepo(value: string): boolean {
  if (!REPO.test(value)) return false;
  const name = value.split('/')[1]!;
  return name !== '.' && name !== '..';
}

/** Identifiant de jeu, tel que dans le manifeste (et dans le nom du dossier d’un dépôt commun). */
const GAME_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

export interface SourceRef {
  /** Dépôt GitHub, « auteur/nom ». */
  repo: string;
  /**
   * Jeu choisi dans un dépôt commun, ou null pour un dépôt dédié à un seul jeu. Dans un dépôt
   * commun, chaque version est un tag `<jeu>-vX.Y.Z` et son fichier s’appelle `<jeu>.phgame`.
   */
  game: string | null;
}

/**
 * Lit une source : « auteur/nom » (un jeu par dépôt) ou « auteur/depot/jeu » (dépôt commun).
 * Renvoie null si la forme n’est pas admise.
 */
export function parseSource(value: string): SourceRef | null {
  const parts = value.split('/');
  if (parts.length === 2 && isValidRepo(value)) return { repo: value, game: null };
  if (parts.length === 3) {
    const repo = `${parts[0]}/${parts[1]}`;
    if (isValidRepo(repo) && GAME_ID.test(parts[2]!)) return { repo, game: parts[2]! };
  }
  return null;
}

export class GitHubError extends Error {}

export interface GitHubOptions {
  fetch?: typeof fetch;
  /** Jeton GitHub du serveur (GITHUB_TOKEN). Envoyé seulement à GitHub, jamais journalisé. */
  token?: string;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface Release {
  tag: string;
  version: string;
  archive: ReleaseAsset;
  checksum: ReleaseAsset;
}

async function request(
  url: string,
  accept: string,
  options: GitHubOptions,
  timeoutMs = 20_000,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'PartyHub',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new GitHubError('GitHub est injoignable (réseau ou pare-feu).');
  }
  if (!ALLOWED_HOSTS.includes(new URL(res.url || url).hostname)) {
    throw new GitHubError('Redirection vers un site non autorisé refusée.');
  }
  if (res.status === 404) {
    throw new GitHubError('Dépôt ou release introuvable. Pour un dépôt privé, GITHUB_TOKEN doit être configuré.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new GitHubError('GitHub refuse l’accès (jeton absent ou invalide, ou limite de requêtes atteinte).');
  }
  if (!res.ok) throw new GitHubError(`GitHub a répondu ${res.status}.`);
  return res;
}

/** Lit une réponse JSON de l’API GitHub, avec les mêmes contrôles d’hôte et de statut que le reste. */
export async function githubGetJson(url: string, options: GitHubOptions): Promise<unknown> {
  const res = await request(url, 'application/vnd.github+json', options);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new GitHubError('Réponse GitHub illisible.');
  }
}

function parseAsset(raw: unknown): ReleaseAsset | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, url, size } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') return null;
  if (!url.startsWith('https://')) return null;
  return { name, url, size };
}

interface ReleaseData {
  tag_name?: unknown;
  assets?: unknown;
}

/** Lit une release : version issue du tag, fichier `.phgame` et `.sha256` associé. */
function parseRelease(data: ReleaseData, game: string | null): Release {
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  const version = game ? tag.slice(`${game}-v`.length) : tag.replace(/^v/, '');
  if (!isValidVersion(version)) {
    throw new GitHubError(`Le tag « ${tag} » n’est pas un numéro de version (X.Y.Z, avec ou sans « v »).`);
  }

  const assets = Array.isArray(data.assets)
    ? data.assets.map(parseAsset).filter((a): a is ReleaseAsset => a !== null)
    : [];
  let archive: ReleaseAsset | undefined;
  if (game) {
    archive = assets.find((a) => a.name === `${game}.phgame`);
    if (!archive) throw new GitHubError(`Le fichier ${game}.phgame est absent de la release ${tag}.`);
  } else {
    const archives = assets.filter((a) => a.name.endsWith('.phgame'));
    if (archives.length === 0) throw new GitHubError('Aucun fichier .phgame dans la dernière release.');
    if (archives.length > 1) {
      throw new GitHubError('Plusieurs fichiers .phgame dans la dernière release : un seul est accepté.');
    }
    archive = archives[0]!;
  }
  if (archive.size > DEFAULT_PACKAGE_LIMITS.maxArchiveBytes) {
    throw new GitHubError('Le fichier .phgame de la release dépasse la taille maximale.');
  }
  const checksum = assets.find((a) => a.name === `${archive.name}.sha256`);
  if (!checksum) throw new GitHubError(`Le fichier ${archive.name}.sha256 est absent de la release.`);
  return { tag, version, archive, checksum };
}

/**
 * Tag le plus haut d’un jeu dans un dépôt commun : parmi les tags `<game>-vX.Y.Z`, celui dont la version est la plus
 * haute. Les autres jeux du dépôt ne sont pas touchés.
 */
export async function latestTag(
  repo: string,
  options: GitHubOptions,
  game: string,
): Promise<{ tag: string; version: string }> {
  const prefix = `${game}-v`;
  const refs = await request(
    `${GITHUB_API}/repos/${repo}/git/matching-refs/tags/${prefix}`,
    'application/vnd.github+json',
    options,
  );
  const list: unknown = await refs.json();
  const versions = (Array.isArray(list) ? list : [])
    .map((r) =>
      r && typeof r === 'object' && typeof (r as { ref?: unknown }).ref === 'string' ? (r as { ref: string }).ref : '',
    )
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => ({ tag, version: tag.slice(prefix.length) }))
    .filter((c) => isValidVersion(c.version))
    .sort((a, b) => compareVersions(b.version, a.version));
  const best = versions[0];
  if (!best) throw new GitHubError(`Aucune version publiée pour « ${game} » : les tags attendus sont ${prefix}X.Y.Z.`);
  return best;
}

/**
 * Dernière release publiée. Pour un dépôt commun (`game` renseigné), on prend la version la plus
 * haute parmi les tags `<game>-vX.Y.Z`, sans toucher aux autres jeux du dépôt.
 */
export async function latestRelease(
  repo: string,
  options: GitHubOptions,
  game: string | null = null,
): Promise<Release> {
  if (!game) {
    const res = await request(`${GITHUB_API}/repos/${repo}/releases/latest`, 'application/vnd.github+json', options);
    return parseRelease((await res.json()) as ReleaseData, null);
  }

  const best = await latestTag(repo, options, game);
  const res = await request(
    `${GITHUB_API}/repos/${repo}/releases/tags/${best.tag}`,
    'application/vnd.github+json',
    options,
  );
  return parseRelease((await res.json()) as ReleaseData, game);
}

/** Limites de lecture d’un dossier de jeu à un tag : un dossier plus gros est refusé sans être lu en entier. */
export const SNAPSHOT_LIMITS = {
  maxFiles: DEFAULT_PACKAGE_LIMITS.maxEntries,
  maxFileBytes: DEFAULT_PACKAGE_LIMITS.maxEntryBytes,
  maxTotalBytes: DEFAULT_PACKAGE_LIMITS.maxTotalBytes,
};

const SHA1 = /^[0-9a-f]{40}$/;
/** Un segment de chemin, comme dans un paquet : pas de caractère spécial, pas de « .. ». */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface TreeEntry {
  path?: unknown;
  mode?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
}

/** Empreinte qu’un fichier porte dans l’historique Git : elle ne dépend que du contenu. */
function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

/** Archive du dépôt au tag : tout le dépôt est téléchargé, donc les limites sont celles d’un dépôt entier. */
export const REPO_ARCHIVE_LIMITS = {
  maxArchiveBytes: 128 * 1024 * 1024,
  maxEntries: 20_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxRatio: 100,
  ratioCheckBytes: 1024 * 1024,
  allowDirectories: true,
};

const ARCHIVE_TIMEOUT_MS = 120_000;

/** Archive du dépôt au tag (zipball) : une requête d’API, puis le téléchargement suit la redirection. */
async function repoArchive(repo: string, tag: string, options: GitHubOptions): Promise<Uint8Array> {
  const res = await request(
    `${GITHUB_API}/repos/${repo}/zipball/${encodeURIComponent(tag)}`,
    'application/octet-stream',
    options,
    ARCHIVE_TIMEOUT_MS,
  );
  const max = REPO_ARCHIVE_LIMITS.maxArchiveBytes;
  if (Number(res.headers.get('content-length') ?? '0') > max) {
    throw new GitHubError('L’archive du dépôt dépasse la taille maximale.');
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > max) throw new GitHubError('L’archive du dépôt dépasse la taille maximale.');
  return bytes;
}

/**
 * Lit l’archive d’un dépôt. Son dossier racine doit être celui du commit du tag (« auteur-dépôt-sha »), sinon
 * l’archive ne vient pas de ce commit et elle est refusée.
 */
function unpackRepo(
  bytes: Uint8Array,
  repo: string,
  tag: string,
  commitId: string,
): { root: string; files: Map<string, Uint8Array> } {
  let entries: ZipFileEntry[];
  try {
    entries = readZip(bytes, REPO_ARCHIVE_LIMITS, (name) => {
      if (name.startsWith('/') || /[\\\0]/.test(name) || name.split('/').includes('..')) {
        throw new GitHubError(`Nom refusé dans l’archive du dépôt : « ${name} ».`);
      }
    });
  } catch (error) {
    if (error instanceof ZipError) throw new GitHubError(`Archive du dépôt illisible : ${error.message}`);
    throw error;
  }

  const roots = [...new Set(entries.map((e) => e.name.split('/')[0]!))];
  const root = roots.length === 1 ? roots[0]! : '';
  const [owner, name] = repo.split('/') as [string, string];
  const head = `${owner}-${name}-`.toLowerCase();
  const short = root.toLowerCase().startsWith(head) ? root.slice(head.length) : '';
  if (short.length < 7 || !commitId.startsWith(short.toLowerCase())) {
    throw new GitHubError(`L’archive ne correspond pas au commit du tag « ${tag} ».`);
  }

  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (!entry.name.endsWith('/')) files.set(entry.name, entry.data);
  }
  return { root, files };
}

/**
 * Fichiers d’un dossier, tels qu’ils sont au tag demandé (un jeu du magasin). Le tag désigne un commit : son arbre
 * complet donne l’empreinte attendue de chaque fichier, et l’archive du dépôt à ce commit fournit les contenus. Un
 * fichier du dossier absent, en trop ou modifié fait échouer la lecture. Les chemins renvoyés sont relatifs au
 * dossier. Rien n’est écrit sur le disque.
 */
export async function tagFiles(
  repo: string,
  tag: string,
  folder: string,
  options: GitHubOptions,
  limits: typeof SNAPSHOT_LIMITS = SNAPSHOT_LIMITS,
): Promise<Map<string, Uint8Array>> {
  const commit = (await githubGetJson(`${GITHUB_API}/repos/${repo}/commits/${encodeURIComponent(tag)}`, options)) as {
    sha?: unknown;
    commit?: { tree?: { sha?: unknown } };
  } | null;
  const commitId = commit?.sha;
  const treeSha = commit?.commit?.tree?.sha;
  if (typeof commitId !== 'string' || !SHA1.test(commitId) || typeof treeSha !== 'string' || !SHA1.test(treeSha)) {
    throw new GitHubError(`Le tag « ${tag} » ne désigne pas un commit lisible.`);
  }
  const tree = (await githubGetJson(`${GITHUB_API}/repos/${repo}/git/trees/${treeSha}?recursive=1`, options)) as {
    tree?: unknown;
    truncated?: unknown;
  } | null;
  if (!tree || !Array.isArray(tree.tree)) throw new GitHubError('Réponse GitHub illisible.');
  if (tree.truncated === true) throw new GitHubError('Le dépôt est trop grand pour être lu d’un seul coup.');

  const prefix = `${folder}/`;
  const entries: { rel: string; sha: string; size: number }[] = [];
  for (const raw of tree.tree as TreeEntry[]) {
    if (typeof raw.path !== 'string' || !raw.path.startsWith(prefix) || raw.type !== 'blob') continue;
    const rel = raw.path.slice(prefix.length);
    if (!rel.split('/').every((segment) => SAFE_SEGMENT.test(segment))) {
      throw new GitHubError(`« ${rel} » : nom de fichier refusé.`);
    }
    if (raw.mode === '120000') throw new GitHubError(`« ${rel} » : lien symbolique refusé.`);
    if (typeof raw.sha !== 'string' || !SHA1.test(raw.sha) || typeof raw.size !== 'number') {
      throw new GitHubError('Réponse GitHub illisible.');
    }
    entries.push({ rel, sha: raw.sha, size: raw.size });
  }
  if (entries.length === 0) throw new GitHubError(`Le dossier « ${folder} » est absent à la version ${tag}.`);
  if (entries.length > limits.maxFiles) {
    throw new GitHubError(`Le dossier du jeu compte plus de ${limits.maxFiles} fichiers.`);
  }
  if (entries.reduce((sum, e) => sum + e.size, 0) > limits.maxTotalBytes) {
    throw new GitHubError('Le dossier du jeu dépasse la taille maximale.');
  }

  const { root, files: archived } = unpackRepo(await repoArchive(repo, tag, options), repo, tag, commitId);
  const base = `${root}/${prefix}`;
  const wanted = new Set(entries.map((e) => base + e.rel));
  for (const name of archived.keys()) {
    if (name.startsWith(base) && !wanted.has(name)) {
      throw new GitHubError(`« ${name.slice(base.length)} » est dans l’archive mais pas dans le commit : lecture refusée.`);
    }
  }

  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const bytes = archived.get(base + entry.rel);
    if (!bytes) throw new GitHubError(`« ${entry.rel} » est absent de l’archive du tag.`);
    if (bytes.byteLength > limits.maxFileBytes) throw new GitHubError(`« ${entry.rel} » dépasse la taille autorisée.`);
    if (bytes.byteLength !== entry.size || gitBlobSha(bytes) !== entry.sha) {
      throw new GitHubError(`« ${entry.rel} » ne correspond pas à son empreinte GitHub : lecture refusée.`);
    }
    files.set(entry.rel, bytes);
  }
  return files;
}

/** Télécharge le paquet et lit l’empreinte attendue. La comparaison est faite par l’appelant. */
export async function downloadArchive(
  release: Release,
  options: GitHubOptions,
): Promise<{ bytes: Uint8Array; expectedSha256: string }> {
  const sum = await request(release.checksum.url, 'application/octet-stream', options);
  const match = /^([a-fA-F0-9]{64})\b/.exec((await sum.text()).trim());
  if (!match) throw new GitHubError('Le fichier .sha256 ne contient pas une empreinte valide.');

  const max = DEFAULT_PACKAGE_LIMITS.maxArchiveBytes;
  const res = await request(release.archive.url, 'application/octet-stream', options);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > max) throw new GitHubError('Le fichier téléchargé dépasse la taille maximale.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > max) throw new GitHubError('Le fichier téléchargé dépasse la taille maximale.');
  return { bytes, expectedSha256: match[1]!.toLowerCase() };
}

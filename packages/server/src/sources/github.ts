import { DEFAULT_PACKAGE_LIMITS } from '../packages/format.js';
import { compareVersions, isValidVersion } from '../packages/semver.js';

/**
 * Client minimal de l'API GitHub pour les releases. Seules les releases publiques ou accessibles
 * avec le jeton du serveur sont lues. Les réponses sont limitées à des hôtes connus, pour qu'une
 * redirection ne puisse pas envoyer le téléchargement ailleurs.
 */

export const GITHUB_API = 'https://api.github.com';

export const ALLOWED_HOSTS = [
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
];

/** « auteur/depot » : caractères GitHub admis, sans chemin ni segment supplémentaire. */
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function isValidRepo(value: string): boolean {
  if (!REPO.test(value)) return false;
  const name = value.split('/')[1]!;
  return name !== '.' && name !== '..';
}

/** Identifiant de jeu, tel que dans le manifeste (et dans le nom du dossier d'un dépôt commun). */
const GAME_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

export interface SourceRef {
  /** Dépôt GitHub, « auteur/nom ». */
  repo: string;
  /**
   * Jeu choisi dans un dépôt commun, ou null pour un dépôt dédié à un seul jeu. Dans un dépôt
   * commun, chaque version est un tag `<jeu>-vX.Y.Z` et son fichier s'appelle `<jeu>.phgame`.
   */
  game: string | null;
}

/**
 * Lit une source : « auteur/nom » (un jeu par dépôt) ou « auteur/depot/jeu » (dépôt commun).
 * Renvoie null si la forme n'est pas admise.
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

async function request(url: string, accept: string, options: GitHubOptions): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'PartyHub',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
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
 * Dernière release publiée. Pour un dépôt commun (`game` renseigné), on prend la version la plus
 * haute parmi les tags `<game>-vX.Y.Z`, sans toucher aux autres jeux du dépôt.
 */
export async function latestRelease(repo: string, options: GitHubOptions, game: string | null = null): Promise<Release> {
  if (!game) {
    const res = await request(`${GITHUB_API}/repos/${repo}/releases/latest`, 'application/vnd.github+json', options);
    return parseRelease((await res.json()) as ReleaseData, null);
  }

  const prefix = `${game}-v`;
  const refs = await request(
    `${GITHUB_API}/repos/${repo}/git/matching-refs/tags/${prefix}`,
    'application/vnd.github+json',
    options,
  );
  const list: unknown = await refs.json();
  const versions = (Array.isArray(list) ? list : [])
    .map((r) => (r && typeof r === 'object' && typeof (r as { ref?: unknown }).ref === 'string' ? (r as { ref: string }).ref : ''))
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => ({ tag, version: tag.slice(prefix.length) }))
    .filter((c) => isValidVersion(c.version))
    .sort((a, b) => compareVersions(b.version, a.version));
  const best = versions[0];
  if (!best) throw new GitHubError(`Aucune version publiée pour « ${game} » : les tags attendus sont ${prefix}X.Y.Z.`);

  const res = await request(`${GITHUB_API}/repos/${repo}/releases/tags/${best.tag}`, 'application/vnd.github+json', options);
  return parseRelease((await res.json()) as ReleaseData, game);
}

/** Télécharge le paquet et lit l'empreinte attendue. La comparaison est faite par l'appelant. */
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

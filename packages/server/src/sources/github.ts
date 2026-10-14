import { DEFAULT_PACKAGE_LIMITS } from '../packages/format.js';
import { isValidVersion } from '../packages/semver.js';

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

/** Dernière release publiée du dépôt, avec son fichier `.phgame` et le fichier `.sha256` associé. */
export async function latestRelease(repo: string, options: GitHubOptions): Promise<Release> {
  const res = await request(`${GITHUB_API}/repos/${repo}/releases/latest`, 'application/vnd.github+json', options);
  const data = (await res.json()) as { tag_name?: unknown; assets?: unknown };
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  const version = tag.replace(/^v/, '');
  if (!isValidVersion(version)) {
    throw new GitHubError(`Le tag « ${tag} » n’est pas un numéro de version (X.Y.Z, avec ou sans « v »).`);
  }

  const assets = Array.isArray(data.assets)
    ? data.assets.map(parseAsset).filter((a): a is ReleaseAsset => a !== null)
    : [];
  const archives = assets.filter((a) => a.name.endsWith('.phgame'));
  if (archives.length === 0) throw new GitHubError('Aucun fichier .phgame dans la dernière release.');
  if (archives.length > 1) {
    throw new GitHubError('Plusieurs fichiers .phgame dans la dernière release : un seul est accepté.');
  }
  const archive = archives[0]!;
  if (archive.size > DEFAULT_PACKAGE_LIMITS.maxArchiveBytes) {
    throw new GitHubError('Le fichier .phgame de la release dépasse la taille maximale.');
  }
  const checksum = assets.find((a) => a.name === `${archive.name}.sha256`);
  if (!checksum) throw new GitHubError(`Le fichier ${archive.name}.sha256 est absent de la release.`);
  return { tag, version, archive, checksum };
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

import { z } from 'zod';
import { compareVersions } from '../packages/semver.js';
import { GITHUB_API, GitHubError, githubGetJson, type GitHubOptions } from '../sources/github.js';

/**
 * Lecture du dépôt de jeux (le « magasin ») : la liste des jeux vient des tags `<jeu>-vX.Y.Z`, et chaque fiche
 * vient du manifeste lu à ce tag. Rien n’est écrit dans le dépôt ; une version publiée ne change jamais, donc
 * ses fiches peuvent être gardées en mémoire.
 */

export const GAME_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** Limites du format : manifeste 8 Ko, image 200 Ko (voir docs/PHGAME.md). */
export const MANIFEST_MAX_BYTES = 8 * 1024;
export const COVER_MAX_BYTES = 200 * 1024;
/** Couverture : un chemin sous assets/, sans segment « .. » (la lecture passe par l’API du dépôt). */
const COVER_PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const TAG_PAGE_SIZE = 100;
const MAX_TAG_PAGES = 10;

/** Type d’un jeu de code : sa fiche porte `kind: "code"` au lieu de modules déclaratifs. */
export const CODE_MODULE = 'code';

const MODULE_LABELS: Record<string, string> = {
  cards: 'Jeu de cartes',
  board: 'Jeu de plateau',
  quiz: 'Questions (vidéos YouTube)',
  recipe: 'Recette',
  [CODE_MODULE]: 'Jeu de code',
};

export interface StoreManifest {
  name: string;
  description: string;
  author: string;
  module: string;
  /** Image de couverture, chemin relatif dans le paquet (assets/…), ou null. */
  coverPath: string | null;
}

export interface StoreGameInfo extends StoreManifest {
  id: string;
  /** Tag de la version la plus haute : `<jeu>-vX.Y.Z`. */
  tag: string;
  latestVersion: string;
  moduleLabel: string;
  /** Problème de lecture de la fiche (le jeu reste listé, avec son identifiant). */
  error: string | null;
}

/** Étiquette d’une version de jeu dans un dépôt commun. Null si la forme ne convient pas. */
export function parseGameTag(tag: string): { game: string; version: string } | null {
  const match = /^(.+)-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) return null;
  const game = match[1]!;
  if (!GAME_ID.test(game)) return null;
  return { game, version: match[2]! };
}

/** Noms de tous les tags du dépôt, page par page. Refuse un dépôt trop grand plutôt que de tronquer la liste. */
export async function repoTagNames(repo: string, options: GitHubOptions): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; page <= MAX_TAG_PAGES; page++) {
    const list = await githubGetJson(
      `${GITHUB_API}/repos/${repo}/tags?per_page=${TAG_PAGE_SIZE}&page=${page}`,
      options,
    );
    if (!Array.isArray(list)) throw new GitHubError('Réponse GitHub illisible.');
    for (const item of list) {
      const name = item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined;
      if (typeof name === 'string') names.push(name);
    }
    if (list.length < TAG_PAGE_SIZE) return names;
  }
  throw new GitHubError(
    `Le dépôt compte plus de ${MAX_TAG_PAGES * TAG_PAGE_SIZE} tags : le magasin ne peut pas tout lire.`,
  );
}

interface ContentsResponse {
  type?: unknown;
  encoding?: unknown;
  content?: unknown;
  size?: unknown;
}

/** Contenu d’un fichier du dépôt à une version donnée. Refusé au-delà de `maxBytes`. */
export async function repoFile(
  repo: string,
  filePath: string,
  ref: string,
  options: GitHubOptions,
  maxBytes: number,
): Promise<Uint8Array> {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const data = (await githubGetJson(
    `${GITHUB_API}/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    options,
  )) as ContentsResponse | null;
  if (!data || typeof data !== 'object' || data.type !== 'file') {
    throw new GitHubError(`« ${filePath} » est introuvable à cette version.`);
  }
  if (typeof data.size !== 'number' || data.size > maxBytes) {
    throw new GitHubError(`« ${filePath} » dépasse la taille autorisée.`);
  }
  if (data.encoding !== 'base64' || typeof data.content !== 'string') {
    throw new GitHubError(`« ${filePath} » ne peut pas être lu.`);
  }
  const bytes = new Uint8Array(Buffer.from(data.content.replace(/\s+/g, ''), 'base64'));
  if (bytes.byteLength > maxBytes) throw new GitHubError(`« ${filePath} » dépasse la taille autorisée.`);
  return bytes;
}

const manifestSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(400).optional(),
    author: z.string().max(80).optional(),
    kind: z.string().optional(),
    requires: z.object({ modules: z.array(z.string()).min(1) }).optional(),
    cover: z.string().max(200).optional(),
  })
  .passthrough();

/** Fiche d’un jeu, lue dans son manifeste à la version demandée. Lève une erreur lisible si elle est inutilisable. */
export function parseStoreManifest(bytes: Uint8Array, gameId: string): StoreManifest {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GitHubError('Le manifeste n’est pas du JSON valide.');
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new GitHubError('Le manifeste est incomplet ou mal formé.');
  const manifest = parsed.data;
  const isCode = manifest.kind === 'code';
  if (!isCode && !manifest.requires) throw new GitHubError('Le manifeste est incomplet ou mal formé.');
  if (manifest.id !== gameId) {
    throw new GitHubError(`Le manifeste annonce « ${manifest.id} », pas « ${gameId} ».`);
  }
  const cover =
    manifest.cover && COVER_PATH.test(manifest.cover) && coverContentType(manifest.cover) ? manifest.cover : null;
  return {
    name: manifest.name,
    description: manifest.description ?? '',
    author: manifest.author ?? '',
    module: isCode ? CODE_MODULE : (manifest.requires?.modules[0] ?? ''),
    coverPath: cover,
  };
}

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? (module || 'Inconnu');
}

/** Type d’image d’une couverture, d’après son extension ; null si l’extension n’est pas admise. */
export function coverContentType(path: string): string | null {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return null;
}

/** Vérifie la signature de l’image : une couverture qui n’est pas une image n’est jamais servie. */
export function looksLikeImage(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/webp') {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

/**
 * Jeux publiés dans le dépôt : pour chacun, la version la plus haute et sa fiche. `manifests` garde les fiches
 * déjà lues, indexées par dépôt et tag (une version publiée ne change pas).
 */
export async function readCatalog(
  repo: string,
  options: GitHubOptions,
  manifests: Map<string, StoreManifest>,
): Promise<StoreGameInfo[]> {
  const latest = new Map<string, { version: string; tag: string }>();
  for (const name of await repoTagNames(repo, options)) {
    const parsed = parseGameTag(name);
    if (!parsed) continue;
    const current = latest.get(parsed.game);
    if (!current || compareVersions(parsed.version, current.version) > 0) {
      latest.set(parsed.game, { version: parsed.version, tag: name });
    }
  }
  const games: StoreGameInfo[] = [];
  for (const [id, { version, tag }] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
    const key = `${repo}\n${tag}`;
    const base = { id, tag, latestVersion: version };
    let fiche = manifests.get(key);
    if (fiche) {
      games.push({ ...base, ...fiche, moduleLabel: moduleLabel(fiche.module), error: null });
      continue;
    }
    try {
      const bytes = await repoFile(repo, `jeux/${id}/manifest.json`, tag, options, MANIFEST_MAX_BYTES);
      fiche = parseStoreManifest(bytes, id);
    } catch (err) {
      // Une erreur n’est pas gardée : elle peut être passagère (réseau, limite d’appels).
      games.push({
        ...base,
        name: id,
        description: '',
        author: '',
        module: '',
        moduleLabel: moduleLabel(''),
        coverPath: null,
        error: err instanceof Error ? err.message : 'Fiche illisible.',
      });
      continue;
    }
    manifests.set(key, fiche);
    while (manifests.size > 500) manifests.delete(manifests.keys().next().value!);
    games.push({ ...base, ...fiche, moduleLabel: moduleLabel(fiche.module), error: null });
  }
  return games;
}

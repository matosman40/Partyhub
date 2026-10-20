import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  CHARACTER_LOOK_ID,
  CHARACTER_PACK_ATLASES,
  CHARACTER_PACK_ID,
  type CharacterPackAtlas,
  type CharacterPackAtlasName,
  type CharacterPackImage,
  type CharacterPackInfo,
  type CharacterPackLook,
} from '@partyhub/shared';
import { readZip, ZipError, type ZipFileEntry } from '../packages/zip.js';

/**
 * Packs de personnages (sprites) importés depuis un zip dans l’administration.
 *
 * Format attendu dans le zip (la racine peut être un dossier) :
 *   json/visages.json + atlas/visages.png   (obligatoire : portraits, ligne « neutre »)
 *   json/poses.json   + atlas/poses.png     (obligatoire : corps entier, ligne « repos »)
 *   json/marche.json  + atlas/marche.png    (facultatif : marche)
 * Les autres fichiers du zip (sources, aperçus, script, README) sont ignorés.
 * Voir docs/PERSONNAGES-PACK.md.
 *
 * Stockage : dans PERSONNAGES_DIR, un dossier par personnage, `packs/<id>/pack.json` (nom, looks, dimensions des
 * planches) et `packs/<id>/<look>/<planche>.png`. Rien n’est gardé dans la base : une sauvegarde de la base ne
 * contient pas les personnages, il faut sauvegarder le dossier (ou l’archive complète).
 */

export const CHARACTER_PACK_LIMITS = {
  maxArchiveBytes: 8 * 1024 * 1024,
  maxEntries: 60,
  maxEntryBytes: 6 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxRatio: 100,
  ratioCheckBytes: 1024 * 1024,
  maxPngBytes: 2 * 1024 * 1024,
  maxJsonBytes: 256 * 1024,
  allowDirectories: true,
} as const;

const MAX_NAME = 60;
const MIN_NAME = 2;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const pivotSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const imageSchema = z.object({
  nom: z.string().regex(/^[a-z0-9_]{1,30}$/, 'nom : lettres minuscules, chiffres et _ (30 caractères au plus)'),
  x: z.number().int().min(0).max(8192),
  y: z.number().int().min(0).max(8192),
  w: z.number().int().min(1).max(4096),
  h: z.number().int().min(1).max(4096),
  pivot: pivotSchema.optional(),
});
const atlasJsonSchema = z.object({
  cellule: z.object({ w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096) }),
  colonnes: z.number().int().min(1).max(64),
  lignes: z.number().int().min(1).max(64),
  images: z.array(imageSchema).min(1).max(256),
});

/** Ce qu’il faut absolument trouver dans un pack pour qu’il soit utilisable. */
const REQUIRED_IMAGE: Partial<Record<CharacterPackAtlasName, string>> = { visages: 'neutre', poses: 'repos' };
const REQUIRED_ATLASES: CharacterPackAtlasName[] = ['visages', 'poses'];

const JSON_ENTRY = /(?:^|\/)json\/(visages|poses|marche)\.json$/;
const PNG_ENTRY = /(?:^|\/)atlas\/(visages|poses|marche)\.png$/;

export type PackValidation =
  | { ok: true; atlases: Partial<Record<CharacterPackAtlasName, { meta: CharacterPackAtlas; png: Uint8Array }>> }
  | { ok: false; issues: string[] };

/** Dimensions d’un PNG, lues dans l’en-tête IHDR. Null si ce n’est pas un PNG. */
export function pngSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24) return null;
  if (!PNG_SIGNATURE.every((byte, i) => data[i] === byte)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = String.fromCharCode(data[12] ?? 0, data[13] ?? 0, data[14] ?? 0, data[15] ?? 0);
  if (type !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** Nom de zip sûr : pas de chemin absolu, pas de « .. », pas de caractères de contrôle. */
function checkEntryName(name: string): void {
  const unsafe =
    name.length > 200 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    [...name].some((ch) => ch.charCodeAt(0) < 32) ||
    name.split('/').some((segment) => segment === '..');
  if (unsafe) throw new ZipError(`« ${name} » : chemin non autorisé dans l’archive.`);
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'format invalide';
  const where = issue.path.length ? `${issue.path.join('.')} : ` : '';
  return `${where}${issue.message}`;
}

/** Vérifie un pack complet et renvoie ses atlas prêts à être stockés, ou la liste des problèmes. */
export function validateCharacterPack(bytes: Uint8Array): PackValidation {
  if (bytes.byteLength > CHARACTER_PACK_LIMITS.maxArchiveBytes) {
    return { ok: false, issues: ['Le zip dépasse 8 Mo.'] };
  }

  let entries: ZipFileEntry[];
  try {
    entries = readZip(bytes, CHARACTER_PACK_LIMITS, checkEntryName);
  } catch (err) {
    if (err instanceof ZipError) return { ok: false, issues: [err.message] };
    return { ok: false, issues: ['Archive ZIP illisible.'] };
  }

  const issues: string[] = [];
  const jsonFiles = new Map<string, Uint8Array>();
  const pngFiles = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const json = JSON_ENTRY.exec(entry.name);
    const png = PNG_ENTRY.exec(entry.name);
    if (json) {
      const atlas = json[1] as string;
      if (jsonFiles.has(atlas)) issues.push(`Plusieurs fichiers json/${atlas}.json dans l’archive.`);
      jsonFiles.set(atlas, entry.data);
    } else if (png) {
      const atlas = png[1] as string;
      if (pngFiles.has(atlas)) issues.push(`Plusieurs fichiers atlas/${atlas}.png dans l’archive.`);
      pngFiles.set(atlas, entry.data);
    }
  }

  for (const atlas of REQUIRED_ATLASES) {
    if (!jsonFiles.has(atlas) || !pngFiles.has(atlas)) {
      issues.push(`Fichiers manquants : json/${atlas}.json et atlas/${atlas}.png sont obligatoires.`);
    }
  }
  if (issues.length) return { ok: false, issues };

  const atlases: Partial<Record<CharacterPackAtlasName, { meta: CharacterPackAtlas; png: Uint8Array }>> = {};
  for (const atlas of CHARACTER_PACK_ATLASES) {
    const jsonData = jsonFiles.get(atlas);
    const pngData = pngFiles.get(atlas);
    if (!jsonData || !pngData) {
      if (jsonData || pngData) issues.push(`json/${atlas}.json et atlas/${atlas}.png doivent aller ensemble.`);
      continue;
    }
    const label = `${atlas}`;
    if (jsonData.byteLength > CHARACTER_PACK_LIMITS.maxJsonBytes) {
      issues.push(`${label}.json : fichier trop volumineux.`);
      continue;
    }
    if (pngData.byteLength > CHARACTER_PACK_LIMITS.maxPngBytes) {
      issues.push(`${label}.png : image trop volumineuse (2 Mo au plus).`);
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(jsonData));
    } catch {
      issues.push(`${label}.json : JSON invalide.`);
      continue;
    }
    const parsed = atlasJsonSchema.safeParse(raw);
    if (!parsed.success) {
      issues.push(`${label}.json : ${firstIssue(parsed.error)}`);
      continue;
    }

    const size = pngSize(pngData);
    if (!size) {
      issues.push(`${label}.png : fichier PNG invalide.`);
      continue;
    }
    const { cellule, colonnes, lignes, images } = parsed.data;
    const expectedW = cellule.w * colonnes;
    const expectedH = cellule.h * lignes;
    if (size.width !== expectedW || size.height !== expectedH) {
      issues.push(
        `${label}.png fait ${size.width} × ${size.height} px, mais ${label}.json annonce ${expectedW} × ${expectedH} px.`,
      );
      continue;
    }

    const names = new Set<string>();
    const outside: string[] = [];
    const duplicates: string[] = [];
    const list: CharacterPackImage[] = [];
    for (const image of images) {
      if (names.has(image.nom)) duplicates.push(image.nom);
      names.add(image.nom);
      if (image.x + image.w > size.width || image.y + image.h > size.height) outside.push(image.nom);
      list.push({
        name: image.nom,
        x: image.x,
        y: image.y,
        w: image.w,
        h: image.h,
        pivot: image.pivot ?? { x: Math.floor(image.w / 2), y: image.h - 1 },
      });
    }
    if (duplicates.length) issues.push(`${label}.json : noms en double (${[...new Set(duplicates)].join(', ')}).`);
    if (outside.length) issues.push(`${label}.json : cases hors de l’image (${outside.join(', ')}).`);
    const required = REQUIRED_IMAGE[atlas];
    if (required && !names.has(required)) issues.push(`${label}.json : la case « ${required} » est obligatoire.`);
    if (issues.length) continue;

    atlases[atlas] = {
      meta: {
        width: size.width,
        height: size.height,
        cell: { w: cellule.w, h: cellule.h },
        columns: colonnes,
        rows: lignes,
        images: list,
      },
      png: pngData,
    };
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, atlases };
}

/** Identifiant dérivé du nom : « Dewi Sri » → « dewi-sri ». */
export function packIdFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export const DEFAULT_LOOK_NAME = 'Standard';

export interface InstallOptions {
  /** Nom du personnage : requis pour un nouveau personnage, ignoré pour un ajout de look. */
  name: string;
  /** Personnage existant auquel ajouter un look. Absent : nouveau personnage. */
  packId?: string | null;
  /** Nom du look (« Standard » si vide). */
  lookName: string;
  consent: boolean;
}

export type InstallPackResult =
  | { ok: true; pack: CharacterPackInfo; look: CharacterPackLook; createdPack: boolean }
  | { ok: false; status: 400 | 404 | 409 | 413; error: string; issues?: string[] };

/* ---------- Stockage en fichiers ---------- */

export const PACK_FILE = 'pack.json';

/** Un personnage, tel qu’il est écrit dans `pack.json`. */
export interface StoredPack {
  id: string;
  name: string;
  createdAt: string;
  looks: StoredLook[];
}

/** Un look : ses dimensions de planches, et ses PNG rangés dans son dossier. */
export interface StoredLook {
  id: string;
  name: string;
  createdAt: string;
  atlases: CharacterPackLook['atlases'];
}

function isPackId(id: string): boolean {
  return CHARACTER_PACK_ID.test(id);
}

function isLookId(id: string): boolean {
  return CHARACTER_LOOK_ID.test(id);
}

/** Écrit un fichier d’un seul tenant : fichier temporaire, puis renommage. Crée les dossiers manquants. */
export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Lit le `pack.json` d’un dossier de personnage. Null si absent ou illisible. */
export function readStoredPack(dir: string): StoredPack | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, PACK_FILE), 'utf8')) as Partial<StoredPack>;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.looks)) return null;
    return { id: raw.id, name: raw.name, createdAt: raw.createdAt ?? '', looks: raw.looks as StoredLook[] };
  } catch {
    return null;
  }
}

function sortLooks(looks: StoredLook[]): StoredLook[] {
  return [...looks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function infoOf(pack: StoredPack): CharacterPackInfo {
  return {
    id: pack.id,
    name: pack.name,
    createdAt: pack.createdAt,
    looks: sortLooks(pack.looks).map((look) => ({ id: look.id, name: look.name, atlases: look.atlases })),
  };
}

/** Dossier des personnages : `<racine>/packs/<id>/`, avec `pack.json` et un dossier par look. */
export class CharacterPackService {
  private readonly packsDir: string;

  /** `root` : dossier des personnages (PERSONNAGES_DIR). */
  constructor(root: string) {
    this.packsDir = path.join(root, 'packs');
  }

  private packDir(id: string): string {
    return path.join(this.packsDir, id);
  }

  /** Personnage stocké, ou null (identifiant mal formé compris : il ne sert jamais de chemin). */
  private read(id: string): StoredPack | null {
    if (!isPackId(id)) return null;
    return readStoredPack(this.packDir(id));
  }

  list(): CharacterPackInfo[] {
    if (!fs.existsSync(this.packsDir)) return [];
    const packs: CharacterPackInfo[] = [];
    for (const entry of fs.readdirSync(this.packsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isPackId(entry.name)) continue;
      const pack = readStoredPack(this.packDir(entry.name));
      if (pack && pack.id === entry.name) packs.push(infoOf(pack));
    }
    return packs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  get(id: string): CharacterPackInfo | null {
    const pack = this.read(id);
    return pack ? infoOf(pack) : null;
  }

  exists(id: string): boolean {
    return this.read(id) !== null;
  }

  lookExists(packId: string, lookId: string): boolean {
    const pack = this.read(packId);
    return !!pack && pack.looks.some((look) => look.id === lookId);
  }

  /** Image PNG d’une planche d’un look, ou null. */
  atlasFile(packId: string, lookId: string, atlas: string): Buffer | null {
    if (!isPackId(packId) || !isLookId(lookId)) return null;
    if (!(CHARACTER_PACK_ATLASES as readonly string[]).includes(atlas)) return null;
    try {
      return fs.readFileSync(path.join(this.packDir(packId), lookId, `${atlas}.png`));
    } catch {
      return null;
    }
  }

  install(bytes: Uint8Array, options: InstallOptions): InstallPackResult {
    if (!options.consent) {
      return {
        ok: false,
        status: 400,
        error: 'Confirmez que la personne représentée a donné son accord pour ce personnage.',
      };
    }
    const lookName = options.lookName.trim() || DEFAULT_LOOK_NAME;
    if (lookName.length > 40)
      return { ok: false, status: 400, error: 'Le nom du look ne doit pas dépasser 40 caractères.' };
    const lookId = packIdFromName(lookName);
    if (!CHARACTER_LOOK_ID.test(lookId)) {
      return { ok: false, status: 400, error: 'Ce nom de look ne donne pas d’identifiant utilisable.' };
    }

    let existing: StoredPack | null = null;
    let packId: string;
    let packName: string;
    let createdPack: boolean;
    if (options.packId) {
      existing = this.read(options.packId);
      if (!existing) return { ok: false, status: 404, error: 'Personnage inconnu.' };
      packId = existing.id;
      packName = existing.name;
      createdPack = false;
      if (existing.looks.some((look) => look.id === lookId)) {
        return { ok: false, status: 409, error: `${existing.name} a déjà un look « ${lookName} ».` };
      }
    } else {
      const name = options.name.trim();
      if (name.length < MIN_NAME || name.length > MAX_NAME) {
        return { ok: false, status: 400, error: `Le nom doit faire entre ${MIN_NAME} et ${MAX_NAME} caractères.` };
      }
      packId = packIdFromName(name);
      if (!CHARACTER_PACK_ID.test(packId)) {
        return {
          ok: false,
          status: 400,
          error: 'Ce nom ne donne pas d’identifiant utilisable. Essayez d’autres lettres.',
        };
      }
      if (this.exists(packId)) {
        return {
          ok: false,
          status: 409,
          error: `Un personnage porte déjà ce nom (identifiant « ${packId} »). Ajoutez-y un look plutôt.`,
        };
      }
      packName = name;
      createdPack = true;
    }

    const validation = validateCharacterPack(bytes);
    if (!validation.ok) {
      return { ok: false, status: 400, error: 'Le pack n’est pas valide.', issues: validation.issues };
    }

    const createdAt = new Date().toISOString();
    const atlases: CharacterPackLook['atlases'] = Object.fromEntries(
      Object.entries(validation.atlases).map(([a, v]) => [a, v?.meta]),
    );
    const look: StoredLook = { id: lookId, name: lookName, createdAt, atlases };
    const dir = this.packDir(packId);
    const lookDir = path.join(dir, lookId);
    const stored: StoredPack = existing
      ? { ...existing, looks: [...existing.looks, look] }
      : { id: packId, name: packName, createdAt, looks: [look] };
    try {
      for (const [atlas, value] of Object.entries(validation.atlases)) {
        if (value) writeFileAtomic(path.join(lookDir, `${atlas}.png`), value.png);
      }
      writeFileAtomic(path.join(dir, PACK_FILE), JSON.stringify(stored));
    } catch {
      // Rien à moitié écrit : on retire ce qui vient d’être créé.
      fs.rmSync(lookDir, { recursive: true, force: true });
      if (createdPack) fs.rmSync(dir, { recursive: true, force: true });
      return { ok: false, status: 400, error: 'Import impossible.' };
    }
    return { ok: true, pack: infoOf(stored), look: { id: lookId, name: lookName, atlases }, createdPack };
  }

  /** Supprime un look. Le dernier look supprimé supprime aussi le personnage. */
  removeLook(packId: string, lookId: string): { ok: true; removedPack: boolean } | { ok: false } {
    const pack = this.read(packId);
    if (!pack || !isLookId(lookId) || !pack.looks.some((look) => look.id === lookId)) return { ok: false };
    fs.rmSync(path.join(this.packDir(packId), lookId), { recursive: true, force: true });
    const looks = pack.looks.filter((look) => look.id !== lookId);
    if (looks.length === 0) {
      this.remove(packId);
      return { ok: true, removedPack: true };
    }
    writeFileAtomic(path.join(this.packDir(packId), PACK_FILE), JSON.stringify({ ...pack, looks }));
    return { ok: true, removedPack: false };
  }

  remove(id: string): boolean {
    if (!this.read(id)) return false;
    fs.rmSync(this.packDir(id), { recursive: true, force: true });
    return true;
  }
}

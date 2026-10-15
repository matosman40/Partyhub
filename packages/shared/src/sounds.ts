import { z } from 'zod';

/**
 * Sons de PartyHub : musique de fond des menus, de l'accueil et de la fin de partie, et bruitages
 * des jeux. Chaque emplacement reçoit un fichier audio de la médiathèque, ou rien (silence pour la
 * musique, son synthétisé d'origine pour les bruitages).
 */

/** Bruitages joués par les jeux. Les noms sont les clés du réglage et de l'effet sonore. */
export const SFX_NAMES = [
  'place',
  'explode',
  'crate',
  'pickup',
  'die',
  'hit',
  'start',
  'win',
  'final',
  'click',
  'card',
  'draw',
  'turn',
  'chip',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export const SFX_LABELS: Record<SfxName, string> = {
  place: 'Pose d’une pièce',
  explode: 'Explosion',
  crate: 'Caisse brisée',
  pickup: 'Ramassage',
  die: 'Élimination',
  hit: 'Impact',
  start: 'Lancement de partie',
  win: 'Victoire',
  final: 'Fin de partie',
  click: 'Clic',
  card: 'Carte posée',
  draw: 'Pioche',
  turn: 'Votre tour',
  chip: 'Jetons poussés',
};

/** Emplacements de musique de fond. */
export const MUSIC_SLOTS = ['accueil', 'menus', 'fin'] as const;
export type MusicSlot = (typeof MUSIC_SLOTS)[number];

export const MUSIC_LABELS: Record<MusicSlot, string> = {
  accueil: 'Accueil',
  menus: 'Menus (rejoindre, profil, salon avant la partie)',
  fin: 'Fin de partie (résultats)',
};

const slotValue = z.string().min(1).max(64).nullable().default(null);

/** Volume de chaque musique de fond, en pourcentage. */
export const MUSIC_VOLUME_DEFAULT = 50;
const volumeValue = z.number().int().min(0).max(100).default(MUSIC_VOLUME_DEFAULT);

const musicShape = Object.fromEntries(MUSIC_SLOTS.map((slot) => [slot, slotValue])) as Record<
  MusicSlot,
  typeof slotValue
>;
const sfxShape = Object.fromEntries(SFX_NAMES.map((name) => [name, slotValue])) as Record<SfxName, typeof slotValue>;

const musicVolumeShape = Object.fromEntries(MUSIC_SLOTS.map((slot) => [slot, volumeValue])) as Record<
  MusicSlot,
  typeof volumeValue
>;

export const soundSettingsSchema = z.object({
  music: z.object(musicShape),
  musicVolume: z.object(musicVolumeShape).default(() => defaultMusicVolume()),
  sfx: z.object(sfxShape),
});

function defaultMusicVolume(): Record<MusicSlot, number> {
  return Object.fromEntries(MUSIC_SLOTS.map((slot) => [slot, MUSIC_VOLUME_DEFAULT])) as Record<MusicSlot, number>;
}

/** Identifiant de fichier de médiathèque par emplacement, ou null. */
export type SoundSettings = {
  music: Record<MusicSlot, string | null>;
  musicVolume: Record<MusicSlot, number>;
  sfx: Record<SfxName, string | null>;
};

export const EMPTY_SOUND_SETTINGS: SoundSettings = {
  music: Object.fromEntries(MUSIC_SLOTS.map((slot) => [slot, null])) as Record<MusicSlot, null>,
  musicVolume: defaultMusicVolume(),
  sfx: Object.fromEntries(SFX_NAMES.map((name) => [name, null])) as Record<SfxName, null>,
};

/**
 * Lit le réglage enregistré, champ par champ : un emplacement illisible devient vide, les autres
 * gardent leur valeur. Une valeur qui n'est pas du JSON redonne le réglage vide.
 */
export function parseSoundSettings(raw: string | undefined): SoundSettings {
  const out = structuredClone(EMPTY_SOUND_SETTINGS);
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  const source = (data ?? {}) as {
    music?: Record<string, unknown>;
    musicVolume?: Record<string, unknown>;
    sfx?: Record<string, unknown>;
  };
  const read = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
  const readVolume = (value: unknown): number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100 ? value : MUSIC_VOLUME_DEFAULT;
  for (const slot of MUSIC_SLOTS) out.music[slot] = read(source.music?.[slot]);
  for (const slot of MUSIC_SLOTS) out.musicVolume[slot] = readVolume(source.musicVolume?.[slot]);
  for (const name of SFX_NAMES) out.sfx[name] = read(source.sfx?.[name]);
  return out;
}

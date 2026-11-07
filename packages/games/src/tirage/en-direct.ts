import { z } from 'zod';
import { adresseRelais, photosEnDirect } from '../photo-mystere/en-direct.js';

/**
 * Questions tirées en direct pour Tirage surprise, pour qu’une partie ne ressemble pas à la précédente :
 * - Peintures : tableaux du domaine public du Met Museum (CC0), « Qui a peint ce tableau ? » ;
 * - Animaux : observations validées d’iNaturalist (CC0, CC BY, CC BY-SA, crédit affiché), « Quelle est cette espèce ? » ;
 * - Monuments : lieux de Wikidata et Wikimedia Commons (ceux de Photo mystère), « Où se trouve ce lieu ? ».
 * Les images passent par le relais du serveur. Ce fichier ne parle au réseau que dans le travail hors moteur.
 */

const UA = { 'User-Agent': 'PartyHub/1.0 (jeu de soirée auto-hébergé)' };
const DELAI_MS = 25_000;
const MET = 'https://collectionapi.metmuseum.org/public/collection';
const INAT = 'https://api.inaturalist.org/v1/observations';
const LICENCES_INAT: Record<string, string> = { cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA' };
const GROUPES_INAT = ['Mammalia', 'Aves', 'Reptilia', 'Amphibia', 'Actinopterygii', 'Insecta'];

export const identificationDirecteSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  reponse: z.string().min(1).max(120),
  titre: z.string().min(1).max(300),
  image: z.string().startsWith('/api/images-ouvertes?u='),
  theme: z.enum(['Peintures', 'Animaux']),
  source: z.string().url(),
  credit: z.string().min(1).max(200).optional(),
});
export type IdentificationDirecte = z.infer<typeof identificationDirecteSchema>;

export const lieuDirectSchema = z.object({
  id: z.string().min(1),
  titre: z.string().min(1),
  image: z.string().startsWith('/api/images-ouvertes?u='),
  source: z.string().url(),
  credit: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type LieuDirect = z.infer<typeof lieuDirectSchema>;

export const resultatDirectSchema = z.object({
  identifications: z.array(identificationDirecteSchema),
  lieux: z.array(lieuDirectSchema),
});
export type ResultatDirect = z.infer<typeof resultatDirectSchema>;

function melanger<T>(liste: T[], random: () => number): T[] {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

async function json(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: UA, signal });
  if (!res.ok) throw new Error(`${new URL(url).hostname} : ${res.status}`);
  return res.json();
}

const metObjetSchema = z.object({
  objectID: z.number().int(),
  isPublicDomain: z.boolean(),
  objectName: z.string().optional(),
  primaryImageSmall: z.string().optional(),
  artistDisplayName: z.string().optional(),
  artistRole: z.string().optional(),
  title: z.string().optional(),
});

/** Un objet du Met devient une question, s’il s’agit d’un tableau du domaine public d’un artiste nommé. Fonction pure. */
export function questionMet(brut: unknown): IdentificationDirecte | null {
  const o = metObjetSchema.safeParse(brut);
  if (!o.success) return null;
  const { objectID, isPublicDomain, objectName, primaryImageSmall, artistDisplayName, artistRole, title } = o.data;
  const artiste = (artistDisplayName ?? '').trim();
  if (!isPublicDomain || objectName !== 'Painting' || artistRole !== 'Artist' || !artiste) return null;
  if (!primaryImageSmall?.startsWith('https://images.metmuseum.org/')) return null;
  return {
    id: `met-${objectID}`,
    question: 'Qui a peint ce tableau ?',
    reponse: artiste.slice(0, 120),
    titre: (title ?? 'Sans titre').slice(0, 300),
    image: adresseRelais(primaryImageSmall),
    theme: 'Peintures',
    source: `https://www.metmuseum.org/art/collection/search/${objectID}`,
    credit: 'CC0 (Met Museum)',
  };
}

async function tableauxMet(
  nombre: number,
  random: () => number,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<IdentificationDirecte[]> {
  const recherche = (await json(
    `${MET}/v1.1/search?q=painting&hasImages=true&isPublicDomain=true&departmentId=11`,
    signal,
    fetchImpl,
  )) as { objectIDs?: number[] | null };
  const ids = melanger(recherche.objectIDs ?? [], random).slice(0, nombre * 3);
  const objets = await Promise.allSettled(ids.map((id) => json(`${MET}/v1/objects/${id}`, signal, fetchImpl)));
  const out: IdentificationDirecte[] = [];
  for (const r of objets) {
    const q = r.status === 'fulfilled' ? questionMet(r.value) : null;
    if (q && out.length < nombre) out.push(q);
  }
  return out;
}

const inatSchema = z.object({
  id: z.number().int(),
  taxon: z
    .object({
      id: z.number().int(),
      name: z.string(),
      rank: z.string(),
      preferred_common_name: z.string().optional(),
    })
    .nullable()
    .optional(),
  photos: z
    .array(
      z.object({ url: z.string(), license_code: z.string().nullable().optional(), attribution: z.string().optional() }),
    )
    .optional(),
});

/** Une observation iNaturalist devient une question, si l’espèce a un nom français et la photo une licence admise. */
export function questionInat(brut: unknown): IdentificationDirecte | null {
  const o = inatSchema.safeParse(brut);
  if (!o.success || !o.data.taxon) return null;
  const { taxon } = o.data;
  const photo = o.data.photos?.[0];
  const nom = taxon.preferred_common_name?.trim();
  const licence = LICENCES_INAT[photo?.license_code ?? ''];
  if (!photo || !nom || taxon.rank !== 'species' || !licence) return null;
  const url = photo.url.replace('/square.', '/medium.');
  if (!/^https:\/\/(inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\//.test(url)) return null;
  return {
    id: `inat-${taxon.id}`,
    question: 'Quelle est cette espèce ?',
    reponse: (nom.charAt(0).toLocaleUpperCase('fr') + nom.slice(1)).slice(0, 120),
    titre: taxon.name.slice(0, 300),
    image: adresseRelais(url),
    theme: 'Animaux',
    source: `https://www.inaturalist.org/observations/${o.data.id}`,
    credit: `${(photo.attribution ?? 'Photo iNaturalist').slice(0, 150)} · ${licence}`,
  };
}

async function especesInat(
  nombre: number,
  random: () => number,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<IdentificationDirecte[]> {
  const groupes = melanger(GROUPES_INAT, random).slice(0, 3).join(',');
  // Une page au hasard parmi les observations les plus appréciées : des espèces reconnaissables, jamais les mêmes.
  const page = 1 + Math.floor(random() * 20);
  const url =
    `${INAT}?quality_grade=research&photos=true&photo_license=cc0,cc-by,cc-by-sa&iconic_taxa=${groupes}` +
    `&rank=species&order_by=votes&per_page=60&page=${page}&locale=fr&spam=false`;
  const data = (await json(url, signal, fetchImpl)) as { results?: unknown[] };
  const vus = new Set<string>();
  const out: IdentificationDirecte[] = [];
  for (const brut of melanger(data.results ?? [], random)) {
    const q = questionInat(brut);
    if (!q || vus.has(q.id) || vus.has(q.reponse)) continue;
    vus.add(q.id);
    vus.add(q.reponse);
    out.push(q);
    if (out.length >= nombre * 2) break; // le surplus sert de leurres
  }
  return out;
}

/**
 * Tire des questions neuves pour les thèmes cochés. Chaque source peut échouer seule : le résultat contient ce qui a
 * répondu à temps, et le module complète avec les banques locales.
 */
export async function questionsEnDirect(
  themes: string[],
  nombre: number,
  random: () => number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultatDirect> {
  const combine = AbortSignal.any([signal, AbortSignal.timeout(DELAI_MS)]);
  const t = new Set(themes);
  const [met, inat, lieux] = await Promise.allSettled([
    t.has('Peintures') ? tableauxMet(nombre, random, combine, fetchImpl) : Promise.resolve([]),
    t.has('Animaux') ? especesInat(nombre, random, combine, fetchImpl) : Promise.resolve([]),
    t.has('Monuments') ? photosEnDirect(Math.min(nombre, 4), random, combine, fetchImpl) : Promise.resolve([]),
  ]);
  return {
    identifications: [
      ...(met.status === 'fulfilled' ? met.value : []),
      ...(inat.status === 'fulfilled' ? inat.value : []),
    ],
    lieux: (lieux.status === 'fulfilled' ? lieux.value : []).map((p) => ({
      id: `lieu-${p.id}`,
      titre: p.place.charAt(0).toLocaleUpperCase('fr') + p.place.slice(1),
      image: p.file,
      source: p.source,
      credit: `${p.credit} · ${p.license}`,
      lat: p.lat,
      lon: p.lon,
    })),
  };
}

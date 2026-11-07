import { z } from 'zod';
import type { Photo } from './photos.js';

/**
 * Photos tirées en direct pour Photo mystère : Wikidata donne des lieux célèbres (photo, coordonnées, pays non dissous),
 * Wikimedia Commons donne la licence et l’auteur de chaque photo. Les licences NC et ND sont refusées, comme pour la
 * banque locale. Les images passent par le relais du serveur (`/api/images-ouvertes`), seul autorisé par la
 * politique de sécurité. Ce fichier ne parle au réseau que dans le travail hors moteur (`runJob`).
 */

/** Catégories de lieux (classes Wikidata) ; chaque partie en tire quelques-unes au hasard. */
export const CATEGORIES_LIEUX: Record<string, string> = {
  Q839954: 'site archéologique',
  Q4989906: 'monument',
  Q23413: 'château',
  Q12280: 'pont',
  Q16560: 'palais',
  Q2977: 'cathédrale',
  Q44539: 'temple',
  Q12518: 'tour',
  Q34038: 'chute d’eau',
  Q8502: 'montagne',
  Q174782: 'place',
  Q9259: 'site du patrimoine mondial',
  Q33506: 'musée',
  Q1785071: 'fort',
  Q570116: 'attraction touristique',
};

const CATEGORIES_PAR_PARTIE = 6;
const LIENS_MIN = 30;
const DELAI_REQUETE_MS = 20_000;
const DELAI_TOTAL_MS = 35_000;
const LARGEUR_IMAGE = 1280;
const UA = { 'User-Agent': 'PartyHub/1.0 (jeu de soirée auto-hébergé)' };
const LICENCE_REFUSEE = /\b(NC|ND)\b|non-commercial|no derivatives|fair use/i;
const LICENCE_ADMISE = /^(CC0|CC BY(-SA)?( \d(\.\d)?)?|Public domain|PD\b)/i;

/** Requête Wikidata d’une catégorie : lieux bien documentés, avec photo, coordonnées et pays non dissous. */
export function requeteCategorie(classe: string): string {
  return `SELECT ?item ?itemLabel ?countryLabel ?coord ?image WHERE {
  ?item wdt:P31 wd:${classe}; wikibase:sitelinks ?links. FILTER(?links >= ${LIENS_MIN})
  ?item wdt:P18 ?image; wdt:P625 ?coord; wdt:P17 ?country.
  FILTER NOT EXISTS { ?country wdt:P576 ?fin }
  ?item rdfs:label ?itemLabel. FILTER(LANG(?itemLabel) = "fr")
  ?country rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = "fr")
} LIMIT 400`;
}

const ligneSchema = z.object({
  item: z.object({ value: z.string() }),
  itemLabel: z.object({ value: z.string().min(1).max(120) }),
  countryLabel: z.object({ value: z.string().min(1).max(80) }),
  coord: z.object({ value: z.string() }),
  image: z.object({ value: z.string() }),
});

export interface LieuCandidat {
  qid: string;
  place: string;
  country: string;
  lat: number;
  lon: number;
  /** Nom du fichier sur Commons, sans le préfixe « File: ». */
  fichier: string;
}

/** « Point(lon lat) » → coordonnées, ou null. Fonction pure. */
export function lireCoordonnees(wkt: string): { lat: number; lon: number } | null {
  const m = /^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/.exec(wkt.trim());
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}

/** Lignes SPARQL → lieux candidats : un seul par entité, nom et coordonnées valides. Fonction pure. */
export function lieuxDepuisLignes(lignes: unknown[]): LieuCandidat[] {
  const vus = new Map<string, LieuCandidat>();
  for (const brut of lignes) {
    const l = ligneSchema.safeParse(brut);
    if (!l.success) continue;
    const qid = l.data.item.value.split('/').pop() ?? '';
    if (!/^Q\d+$/.test(qid) || vus.has(qid)) continue;
    const place = l.data.itemLabel.value;
    if (/^Q\d+$/.test(place)) continue; // pas de libellé français
    const coord = lireCoordonnees(l.data.coord.value);
    const fichier = decodeURIComponent(l.data.image.value.split('/Special:FilePath/').pop() ?? '').trim();
    if (!coord || !fichier || !/\.(jpe?g|png|webp)$/i.test(fichier)) continue;
    vus.set(qid, { qid, place, country: l.data.countryLabel.value, ...coord, fichier });
  }
  return [...vus.values()];
}

/** Texte brut d’un champ HTML de Commons (auteur), borné. Fonction pure. */
export function texteBrut(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Vrai pour une licence libre admise (CC0, CC BY, CC BY-SA, domaine public). Fonction pure. */
export function licenceAdmise(licence: string): boolean {
  return LICENCE_ADMISE.test(licence.trim()) && !LICENCE_REFUSEE.test(licence);
}

/** Vrai pour une vignette servie par Wikimedia (ancien et nouveau domaine des vignettes). Fonction pure. */
export function vignetteCommons(url: string): boolean {
  return /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url);
}

/** Retire les paramètres de suivi (utm_…) d’une adresse de vignette ; l’adresse reste stable pour le cache. */
export function sansSuivi(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
  return u.toString();
}

/** Adresse de l’image servie par le relais du serveur. Fonction pure. */
export function adresseRelais(distante: string): string {
  return `/api/images-ouvertes?u=${encodeURIComponent(distante)}`;
}

interface InfoImage {
  vignette: string;
  licence: string;
  auteur: string;
  source: string;
  /** Vrai quand l’appareil a noté sa position : c’est presque toujours une photo prise sur place (pas un plan). */
  gps: boolean;
}

const infoSchema = z.object({
  query: z
    .object({
      pages: z.record(
        z.string(),
        z.object({
          title: z.string().optional(),
          imageinfo: z
            .array(
              z.object({
                thumburl: z.string().optional(),
                descriptionurl: z.string().optional(),
                extmetadata: z.record(z.string(), z.object({ value: z.unknown() })).optional(),
              }),
            )
            .optional(),
        }),
      ),
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
    })
    .optional(),
});

async function infosCommons(
  fichiers: string[],
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<Map<string, InfoImage>> {
  const out = new Map<string, InfoImage>();
  for (let i = 0; i < fichiers.length; i += 40) {
    const lot = fichiers.slice(i, i + 40);
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(LARGEUR_IMAGE),
      iiextmetadatafilter: 'LicenseShortName|Artist|GPSLatitude',
      titles: lot.map((f) => `File:${f}`).join('|'),
    }).toString();
    const res = await fetchImpl(url, { headers: UA, signal });
    if (!res.ok) continue;
    const data = infoSchema.safeParse(await res.json());
    if (!data.success || !data.data.query) continue;
    // Commons normalise les titres (espaces, majuscule) : on retrouve le nom demandé.
    const demande = new Map<string, string>();
    for (const n of data.data.query.normalized ?? []) demande.set(n.to, n.from.replace(/^File:/, ''));
    for (const page of Object.values(data.data.query.pages)) {
      const ii = page.imageinfo?.[0];
      if (!page.title || !ii?.thumburl || !ii.descriptionurl) continue;
      const nom = demande.get(page.title) ?? page.title.replace(/^File:/, '');
      out.set(nom, {
        vignette: sansSuivi(ii.thumburl),
        licence: texteBrut(ii.extmetadata?.LicenseShortName?.value),
        auteur: texteBrut(ii.extmetadata?.Artist?.value) || 'Auteur sur Wikimedia Commons',
        source: ii.descriptionurl,
        gps: ii.extmetadata?.GPSLatitude !== undefined,
      });
    }
  }
  return out;
}

async function lieuxCategorie(classe: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<LieuCandidat[]> {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(requeteCategorie(classe));
  const combine = AbortSignal.any([signal, AbortSignal.timeout(DELAI_REQUETE_MS)]);
  const res = await fetchImpl(url, { headers: { ...UA, Accept: 'application/sparql-results+json' }, signal: combine });
  if (!res.ok) return [];
  // Une réponse coupée par le délai de Wikidata n’est pas du JSON valide : la catégorie est ignorée.
  const texte = await res.text();
  try {
    const json = JSON.parse(texte) as { results?: { bindings?: unknown[] } };
    return lieuxDepuisLignes(json.results?.bindings ?? []);
  } catch {
    return [];
  }
}

function melanger<T>(liste: T[], random: () => number): T[] {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Choisit des lieux variés : au plus deux par pays, dans l’ordre du mélange. Fonction pure. */
export function choisirVaries(lieux: LieuCandidat[], nombre: number): LieuCandidat[] {
  const parPays = new Map<string, number>();
  const choisis: LieuCandidat[] = [];
  for (const l of lieux) {
    if (choisis.length >= nombre) break;
    const n = parPays.get(l.country) ?? 0;
    if (n >= 2) continue;
    parPays.set(l.country, n + 1);
    choisis.push(l);
  }
  return choisis;
}

/**
 * Tire `nombre` photos de lieux en direct. Renvoie moins de photos (voire aucune) si le réseau ou les licences ne
 * le permettent pas : le module complète avec la banque locale.
 */
export async function photosEnDirect(
  nombre: number,
  random: () => number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Photo[]> {
  const combine = AbortSignal.any([signal, AbortSignal.timeout(DELAI_TOTAL_MS)]);
  const classes = melanger(Object.keys(CATEGORIES_LIEUX), random).slice(0, CATEGORIES_PAR_PARTIE);
  const resultats = await Promise.allSettled(classes.map((c) => lieuxCategorie(c, combine, fetchImpl)));
  // Un lieu peut appartenir à plusieurs catégories (château et attraction) : une seule fois par partie.
  const parQid = new Map<string, LieuCandidat>();
  for (const r of resultats) if (r.status === 'fulfilled') for (const l of r.value) parQid.set(l.qid, l);
  const tous = [...parQid.values()];
  // On examine trois fois plus de lieux que nécessaire : certaines photos ont une licence refusée.
  const candidats = choisirVaries(melanger(tous, random), nombre * 3);
  if (candidats.length === 0) return [];
  const infos = await infosCommons(
    candidats.map((c) => c.fichier),
    combine,
    fetchImpl,
  );
  // Les photos prises sur place (position de l’appareil connue) passent avant les gravures, plans et tableaux.
  const admis = candidats.filter((c) => {
    const info = infos.get(c.fichier);
    return info !== undefined && licenceAdmise(info.licence) && vignetteCommons(info.vignette);
  });
  const ordre = [...admis.filter((c) => infos.get(c.fichier)?.gps), ...admis.filter((c) => !infos.get(c.fichier)?.gps)];
  const photos: Photo[] = [];
  for (const c of ordre) {
    if (photos.length >= nombre) break;
    const info = infos.get(c.fichier);
    if (!info) continue;
    photos.push({
      id: `wd-${c.qid}`,
      place: c.place,
      country: c.country,
      lat: c.lat,
      lon: c.lon,
      file: adresseRelais(info.vignette),
      credit: info.auteur,
      license: info.licence,
      source: info.source,
    });
  }
  return photos;
}

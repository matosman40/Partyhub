import type { Mot } from './crossword.js';

/**
 * Mots croisés : mots et indices tirés en direct de Wikidata (libellé et description en français, CC0). Seuls les
 * noms communs passent : libellé en minuscules, sans chiffre, sans parenthèse, indice court qui ne contient pas le
 * mot. Les mots sans accent ni tiret, de 4 à 10 lettres, sont convertis en majuscules. Ce fichier ne parle au réseau
 * que dans le travail hors moteur ; la banque locale complète si Internet ne répond pas.
 */

const UA = { 'User-Agent': 'PartyHub/1.0 (jeu de soirée auto-hébergé)' };
const DELAI_MS = 25_000;
const LIMITE = 120;

/** Classes Wikidata (instance directe, pour rester rapide) : fruits, instruments, vêtements, sports, métiers, animaux. */
export const CLASSES_MOTS: Record<string, string> = {
  Q3314483: 'fruit',
  Q34379: 'instrument de musique',
  Q11460: 'vêtement',
  Q349: 'sport',
  Q28640: 'métier',
  Q16521: 'animal',
};

function requete(classe: string): string {
  return `SELECT ?label ?desc WHERE {
  ?item wdt:P31 wd:${classe}; wikibase:sitelinks ?s. FILTER(?s >= 25)
  ?item rdfs:label ?label. FILTER(LANG(?label) = "fr" && REGEX(?label, "^[a-zà-ÿ]{4,10}$"))
  ?item schema:description ?desc. FILTER(LANG(?desc) = "fr" && STRLEN(?desc) <= 80)
} LIMIT ${LIMITE}`;
}

/** Mot en majuscules sans accents, ou null s’il n’est pas utilisable en grille. Fonction pure. */
export function versMot(libelle: string): string | null {
  if (!/^[a-zà-ÿ]{4,10}$/.test(libelle)) return null;
  const sans = libelle.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return /^[A-Z]{4,10}$/.test(sans) ? sans : null;
}

/** Indice tiré de la description : une phrase nominale courte, sans nom propre apparent. Fonction pure. */
export function versIndice(description: string, mot: string): string | null {
  const d = description.trim();
  if (d.length < 4 || d.length > 80) return null;
  if (/[()\d:;"«»]/.test(d)) return null;
  const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (sansAccent(d).includes(mot)) return null;
  // Une description commence par un nom commun, en minuscules : « fruit », « espèce de… » ; un nom propre est écarté.
  if (!/^[a-zà-ÿ]/.test(d)) return null;
  const premiere = d.charAt(0).toLocaleUpperCase('fr') + d.slice(1);
  return premiere.replace(/\.$/, '');
}

/** Mots et indices d’une réponse Wikidata, sans doublon. Fonction pure. */
export function motsDepuisLignes(lignes: unknown[]): Mot[] {
  const vus = new Set<string>();
  const out: Mot[] = [];
  for (const brut of lignes) {
    const l = brut as { label?: { value?: string }; desc?: { value?: string } };
    const libelle = l.label?.value ?? '';
    const desc = l.desc?.value ?? '';
    const mot = versMot(libelle);
    if (!mot || vus.has(mot)) continue;
    const indice = versIndice(desc, mot);
    if (!indice) continue;
    vus.add(mot);
    out.push({ word: mot, clue: indice });
  }
  return out;
}

/** Tire des mots neufs dans chaque classe ; une classe qui échoue est simplement ignorée. */
export async function motsEnDirect(
  random: () => number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Mot[]> {
  const combine = AbortSignal.any([signal, AbortSignal.timeout(DELAI_MS)]);
  const classes = Object.keys(CLASSES_MOTS);
  const resultats = await Promise.allSettled(
    classes.map(async (c) => {
      const res = await fetchImpl(
        'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(requete(c)),
        {
          headers: { ...UA, Accept: 'application/sparql-results+json' },
          signal: combine,
        },
      );
      if (!res.ok) return [];
      const json = JSON.parse(await res.text()) as { results?: { bindings?: unknown[] } };
      return motsDepuisLignes(json.results?.bindings ?? []);
    }),
  );
  const tous: Mot[] = [];
  const vus = new Set<string>();
  for (const r of resultats) {
    if (r.status !== 'fulfilled') continue;
    for (const m of r.value) {
      if (vus.has(m.word)) continue;
      vus.add(m.word);
      tous.push(m);
    }
  }
  // Mélange, puis une quarantaine de mots : assez pour varier, sans noyer la banque.
  for (let i = tous.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tous[i], tous[j]] = [tous[j] as Mot, tous[i] as Mot];
  }
  return tous.slice(0, 40);
}

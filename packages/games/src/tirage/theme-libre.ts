import { z } from 'zod';

/**
 * Thème libre de Tirage surprise : l'hôte tape un thème (« fleuves »), Wikidata en donne la classe, puis les entités
 * de cette classe avec un seul pays. Chaque question est « Dans quel pays se trouve… ? ».
 *
 * Garde-fous : un seul pays par entité (sinon la réponse n'est pas unique), un nom français, au moins 25 liens
 * inter-wiki, et un lien Wikidata sur chaque question. Ce fichier ne parle au réseau que par `fetch` fourni par
 * l'appelant (travail du serveur, hors moteur) ; les règles de partie restent dans module.ts.
 */

const UA = 'PartyHub-tirage/1.0 (https://github.com/renaudmathieu/partyhub)';
const SEUIL_LIENS = 25;
const MIN_INSTANCES = 10;
const MIN_PAYS = 4;
const TIMEOUT_MS = 60_000;

/** Thème tapé par l'hôte, nettoyé : des mots, sans caractères spéciaux, en minuscules. */
export function nettoyerTheme(saisie: unknown): string {
  const propre = String(saisie ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} '-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (propre.length < 3 || propre.length > 40) throw new Error('Thème : entre 3 et 40 caractères');
  return propre;
}

/** Questions prêtes à mettre en partie, validées au retour du travail. */
export const questionLibreSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  reponse: z.string().min(1),
  leurres: z.array(z.string().min(1)).length(3),
  titre: z.string().min(1),
  source: z.string().min(1),
});

export type QuestionLibre = z.infer<typeof questionLibreSchema>;

export const resultatLibreSchema = z.object({
  theme: z.string().min(3),
  classe: z.string().min(2),
  entrees: z.array(questionLibreSchema).min(MIN_PAYS),
});

export type ResultatLibre = z.infer<typeof resultatLibreSchema>;

/** Réponse SPARQL : une ligne par résultat, chaque variable a une valeur textuelle. */
type SparqlBindings = { results: { bindings: Array<Record<string, { value: string }>> } };

async function getJson<T>(url: string, signal: AbortSignal, sparql = false): Promise<T> {
  const combine = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  for (let essai = 1; essai <= 3; essai++) {
    const res = await fetch(url, {
      headers: sparql ? { Accept: 'application/sparql-results+json', 'User-Agent': UA } : { 'User-Agent': UA },
      signal: combine,
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 429 && res.status < 500) throw new Error(`Wikidata : HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * essai));
  }
  throw new Error('Wikidata indisponible');
}

function sparql(requete: string, signal: AbortSignal): Promise<SparqlBindings> {
  return getJson<SparqlBindings>(
    `https://query.wikidata.org/sparql?query=${encodeURIComponent(requete)}`,
    signal,
    true,
  );
}

async function nombreInstances(id: string, signal: AbortSignal): Promise<number> {
  const j = await sparql(
    `SELECT (COUNT(?x) AS ?n) WHERE { { SELECT ?x WHERE { ?x wdt:P31 wd:${id} } LIMIT 5000 } }`,
    signal,
  );
  return Number(j.results.bindings[0]?.n.value ?? 0);
}

/**
 * Classe Wikidata du thème : parmi les premiers résultats de recherche (au pluriel et au singulier), celui qui a le
 * plus d'instances. Le premier résultat seul se trompe : « fleuves » tombe sur un groupe de musique.
 */
export async function classeDuTheme(theme: string, signal: AbortSignal): Promise<{ id: string; n: number }> {
  const formes = [...new Set([theme, theme.replace(/s$/, '')])];
  const candidats = new Map<string, string>();
  for (const forme of formes) {
    const url =
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(forme)}` +
      '&language=fr&type=item&limit=5&format=json';
    const j = await getJson<{ search?: Array<{ id: string; label?: string }> }>(url, signal);
    for (const c of (j.search ?? []) as Array<{ id: string; label?: string }>) candidats.set(c.id, c.label ?? c.id);
  }
  if (candidats.size === 0) throw new Error(`Aucune classe Wikidata pour « ${theme} »`);
  let meilleur: { id: string; n: number } | null = null;
  for (const id of candidats.keys()) {
    const n = await nombreInstances(id, signal);
    if (!meilleur || n > meilleur.n) meilleur = { id, n };
  }
  if (!meilleur || meilleur.n < MIN_INSTANCES) throw new Error(`Classe trop peu documentée pour « ${theme} »`);
  return meilleur;
}

/** Fiche Wikidata réduite à ce qui sert au jeu : libellé français, liens inter-wiki, pays (P17). */
interface FicheWikidata {
  id: string;
  labels?: { fr?: { value: string } };
  sitelinks?: Record<string, unknown>;
  claims?: { P17?: Array<{ mainsnak: { datavalue?: { value: { id: string } } } }> };
}

/** Fiches Wikidata par lots de 50 (API wbgetentities, rapide). */
async function fichesWikidata(ids: string[], signal: AbortSignal): Promise<FicheWikidata[]> {
  const fiches: FicheWikidata[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const lot = ids.slice(i, i + 50).join('|');
    const url =
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${lot}` +
      '&props=labels|sitelinks|claims&languages=fr&format=json';
    const j = await getJson<{ entities?: Record<string, FicheWikidata> }>(url, signal);
    fiches.push(...Object.values(j.entities ?? {}));
  }
  return fiches;
}

/**
 * Entités de la classe avec un seul pays, nom français et assez de liens inter-wiki. Deux étapes, parce qu'une seule
 * requête SPARQL avec tri et libellés expire : une liste SPARQL simple, puis les fiches par lots.
 */
export async function entitesDeLaClasse(
  classeId: string,
  signal: AbortSignal,
): Promise<Array<{ id: string; nom: string; pays: string }>> {
  const liste = await sparql(`SELECT ?e WHERE { ?e wdt:P31 wd:${classeId}; wdt:P17 ?p } LIMIT 400`, signal);
  const ids = [...new Set(liste.results.bindings.map((b) => b.e!.value.split('/').pop()!))];
  const fiches = await fichesWikidata(ids, signal);
  const retenues = fiches
    .map((f) => {
      const pays = [...new Set((f.claims?.P17 ?? []).map((c) => c.mainsnak.datavalue?.value.id).filter(Boolean))];
      return { id: f.id, nom: f.labels?.fr?.value, liens: Object.keys(f.sitelinks ?? {}).length, pays };
    })
    .filter(
      (f): f is { id: string; nom: string; liens: number; pays: string[] } =>
        Boolean(f.nom) && f.liens >= SEUIL_LIENS && f.pays.length === 1,
    )
    .sort((a, b) => b.liens - a.liens)
    .slice(0, 80);
  const nomsDePays = new Map(
    (await fichesWikidata([...new Set(retenues.map((f) => f.pays[0]!))], signal)).map((p) => [
      p.id,
      p.labels?.fr?.value,
    ]),
  );
  return retenues
    .map((f) => ({ id: f.id, nom: f.nom, pays: nomsDePays.get(f.pays[0]!) ?? '' }))
    .filter((f) => f.pays !== '');
}

/**
 * Questions « Dans quel pays se trouve… ? ». Les trois leurres sont les pays suivants de la liste : déterministes,
 * donc une même recherche donne toujours les mêmes questions.
 */
export function questionsPays(
  entites: Array<{ id: string; nom: string; pays: string }>,
  theme: string,
): QuestionLibre[] {
  const paysDistincts = [...new Set(entites.map((e) => e.pays))];
  if (paysDistincts.length < MIN_PAYS) return [];
  return entites.map((e) => {
    const i = paysDistincts.indexOf(e.pays);
    return {
      id: `libre-${theme.replace(/\s+/g, '-')}-${e.id}`,
      question: `Dans quel pays se trouve « ${e.nom} » ?`,
      reponse: e.pays,
      leurres: [1, 2, 3].map((k) => paysDistincts[(i + k) % paysDistincts.length]!),
      titre: e.nom,
      source: `https://www.wikidata.org/wiki/${e.id}`,
    };
  });
}

/** Travail complet : thème tapé → questions. Lève une erreur lisible si le thème ne donne pas assez de questions. */
export async function rechercherThemeLibre(saisie: unknown, signal: AbortSignal): Promise<ResultatLibre> {
  const theme = nettoyerTheme(saisie);
  const classe = await classeDuTheme(theme, signal);
  const entites = await entitesDeLaClasse(classe.id, signal);
  const entrees = questionsPays(entites, theme);
  if (entrees.length < MIN_PAYS) throw new Error(`Pas assez de questions pour « ${theme} »`);
  return resultatLibreSchema.parse({ theme, classe: classe.id, entrees });
}

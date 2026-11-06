import { z } from 'zod';

/**
 * Thème libre de Tirage surprise : l'hôte tape un thème (« fleuves »), Wikidata en donne la classe, puis les entités
 * de cette classe. Chaque entité ne sert qu'à une question :
 * - chronologie « Lequel a été créé en premier ? » si Wikidata donne deux dates de création assez éloignées ;
 * - estimation « Quelle est la longueur de… ? » si Wikidata donne la longueur (en kilomètres) ;
 * - sinon « Dans quel pays se trouve… ? » (un seul pays, sinon la réponse n'est pas unique).
 *
 * Garde-fous : un nom français, au moins 25 liens inter-wiki, un lien Wikidata sur chaque question. Les dates de
 * Wikidata mêlent parfois début de chantier et fin de construction : la chronologie n'est donc gardée que pour une
 * date à la précision de l'année. Ce fichier ne parle au réseau que par `fetch` fourni par l'appelant (travail du
 * serveur, hors moteur) ; les règles de partie restent dans module.ts.
 */

const UA = 'PartyHub-tirage/1.0 (https://github.com/renaudmathieu/partyhub)';
const SEUIL_LIENS = 25;
const MIN_INSTANCES = 10;
const MIN_PAYS = 4;
const TIMEOUT_MS = 60_000;
/** Écart minimal entre deux dates de création pour une question nette. */
const ECART_MIN_ANNEES = 10;
/** Chronologies par partie libre : au-delà, les entités restent pour les autres questions. */
const MAX_CHRONOLOGIES = 4;
/** Interrupteur : la chronologie des thèmes libres reste coupée tant que les dates Wikidata ne sont pas fiables. */
export const CHRONOLOGIE_LIBRE_ACTIVE = false;
/** Précision Wikidata « année » (9) ; en dessous, la date est trop vague pour une question. */
const PRECISION_ANNEE = 9;
const ANNEE_MIN = 1000;

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

/** Question « pays » prête à mettre en partie, validée au retour du travail. */
export const questionLibreSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  reponse: z.string().min(1),
  leurres: z.array(z.string().min(1)).length(3),
  titre: z.string().min(1),
  source: z.string().min(1),
});

export type QuestionLibre = z.infer<typeof questionLibreSchema>;

/** Estimation d'une longueur (en kilomètres), pour une entité dont Wikidata donne la longueur. */
export const estimationLibreSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  valeur: z.number().int().min(1),
  unite: z.string().min(1),
  source: z.string().min(1),
});

export type EstimationLibre = z.infer<typeof estimationLibreSchema>;

/** Chronologie : deux choix, la bonne réponse étant le plus ancien. */
export const chronologieLibreSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  reponse: z.string().min(1),
  leurre: z.string().min(1),
  titre: z.string().min(1),
  source: z.string().min(1),
  credit: z.string().min(1),
});

export type ChronologieLibre = z.infer<typeof chronologieLibreSchema>;

export const resultatLibreSchema = z.object({
  theme: z.string().min(3),
  classe: z.string().min(2),
  entrees: z.array(questionLibreSchema),
  estimations: z.array(estimationLibreSchema).default([]),
  chronologies: z.array(chronologieLibreSchema).default([]),
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
    for (const c of j.search ?? []) candidats.set(c.id, c.label ?? c.id);
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

/** Fiche Wikidata réduite à ce qui sert au jeu : libellé français, liens inter-wiki, pays, longueur, date. */
interface FicheWikidata {
  id: string;
  labels?: { fr?: { value: string } };
  sitelinks?: Record<string, unknown>;
  claims?: {
    P17?: Array<{ mainsnak: { datavalue?: { value: { id: string } } } }>;
    P2043?: Array<{ mainsnak: { datavalue?: { value: { amount: string; unit: string } } } }>;
    P571?: Array<{ mainsnak: { datavalue?: { value: { time: string; precision: number } } } }>;
  };
}

/** Longueur en kilomètres (P2043, unité Q828224 = kilomètre), ou null si Wikidata n'en donne pas. */
export function longueurKm(fiche: FicheWikidata): number | null {
  const v = fiche.claims?.P2043?.[0]?.mainsnak.datavalue?.value;
  if (!v || !v.unit.endsWith('Q828224')) return null;
  const km = Math.round(Number(v.amount));
  return Number.isFinite(km) && km > 0 ? km : null;
}

/**
 * Année de création (P571), seulement si la date est à la précision de l'année et postérieure à l'an 1000.
 * La date « +1855-00-00T00:00:00Z » donne 1855 ; une date plus vague n'est pas utilisée.
 */
export function anneeCreation(fiche: FicheWikidata): number | null {
  const v = fiche.claims?.P571?.[0]?.mainsnak.datavalue?.value;
  if (!v || v.precision < PRECISION_ANNEE) return null;
  const annee = Number(v.time.slice(0, 5));
  return Number.isInteger(annee) && annee >= ANNEE_MIN ? annee : null;
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

/** Entité retenue pour le thème : un nom, un ou plusieurs éléments de données, et une seule question possible. */
export interface EntiteLibre {
  id: string;
  nom: string;
  pays: string;
  longueurKm: number | null;
  annee: number | null;
}

/**
 * Entités de la classe avec un seul pays, nom français et assez de liens inter-wiki. Deux étapes, parce qu'une seule
 * requête SPARQL avec tri et libellés expire : une liste SPARQL simple, puis les fiches par lots.
 */
export async function entitesDeLaClasse(classeId: string, signal: AbortSignal): Promise<EntiteLibre[]> {
  const liste = await sparql(`SELECT ?e WHERE { ?e wdt:P31 wd:${classeId}; wdt:P17 ?p } LIMIT 400`, signal);
  const ids = [...new Set(liste.results.bindings.map((b) => b.e!.value.split('/').pop()!))];
  const fiches = await fichesWikidata(ids, signal);
  const retenues = fiches
    .map((f) => {
      const pays = [...new Set((f.claims?.P17 ?? []).map((c) => c.mainsnak.datavalue?.value.id).filter(Boolean))];
      return {
        id: f.id,
        nom: f.labels?.fr?.value,
        liens: Object.keys(f.sitelinks ?? {}).length,
        pays,
        longueurKm: longueurKm(f),
        annee: anneeCreation(f),
      };
    })
    .filter(
      (
        f,
      ): f is {
        id: string;
        nom: string;
        liens: number;
        pays: string[];
        longueurKm: number | null;
        annee: number | null;
      } => Boolean(f.nom) && f.liens >= SEUIL_LIENS && f.pays.length === 1,
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
    .map((f) => ({
      id: f.id,
      nom: f.nom,
      pays: nomsDePays.get(f.pays[0]!) ?? '',
      longueurKm: f.longueurKm,
      annee: f.annee,
    }))
    .filter((f) => f.pays !== '');
}

/**
 * Questions « Dans quel pays se trouve… ? ». Les trois leurres sont les pays suivants de la liste : déterministes,
 * donc une même recherche donne toujours les mêmes questions. `pourLeurres` donne la liste des pays possibles.
 */
export function questionsPays(
  entites: Array<{ id: string; nom: string; pays: string }>,
  theme: string,
  pourLeurres: Array<{ pays: string }> = entites,
): QuestionLibre[] {
  const paysDistincts = [...new Set(pourLeurres.map((e) => e.pays))];
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

/** Estimations de longueur, pour les entités dont Wikidata donne la longueur en kilomètres. */
export function estimationsLongueur(
  entites: Array<{ id: string; nom: string; longueurKm: number | null }>,
): EstimationLibre[] {
  return entites
    .filter((e): e is { id: string; nom: string; longueurKm: number } => e.longueurKm !== null)
    .map((e) => ({
      id: `libre-km-${e.id}`,
      question: `Quelle est la longueur de « ${e.nom} » ?`,
      valeur: e.longueurKm,
      unite: 'kilomètres',
      source: `https://www.wikidata.org/wiki/${e.id}`,
    }));
}

/**
 * Chronologies : deux entités datées assez loin l'une de l'autre. Renvoie les questions et les entités utilisées,
 * pour qu'une même entité ne serve pas deux fois dans la partie.
 */
export function chronologiesLibres(entites: EntiteLibre[]): { questions: ChronologieLibre[]; utilises: Set<string> } {
  const datees = entites.filter((e): e is EntiteLibre & { annee: number } => e.annee !== null);
  const utilises = new Set<string>();
  const questions: ChronologieLibre[] = [];
  for (let i = 0; i < datees.length && questions.length < MAX_CHRONOLOGIES; i++) {
    const a = datees[i]!;
    if (utilises.has(a.id)) continue;
    const b = datees.find(
      (x, j) => j > i && !utilises.has(x.id) && Math.abs(x.annee - a.annee) >= ECART_MIN_ANNEES && x.nom !== a.nom,
    );
    if (!b) continue;
    utilises.add(a.id);
    utilises.add(b.id);
    const [vieux, recent] = a.annee <= b.annee ? [a, b] : [b, a];
    questions.push({
      id: `libre-chrono-${vieux.id}-${recent.id}`,
      question: 'Lequel a été créé en premier ?',
      reponse: vieux.nom,
      leurre: recent.nom,
      titre: `${vieux.nom} / ${recent.nom}`,
      source: `https://www.wikidata.org/wiki/${vieux.id}`,
      credit: `Date de création : ${vieux.annee} (Wikidata)`,
    });
  }
  return { questions, utilises };
}

/** Travail complet : thème tapé → questions. Lève une erreur lisible si le thème ne donne pas assez de questions. */
export async function rechercherThemeLibre(saisie: unknown, signal: AbortSignal): Promise<ResultatLibre> {
  const theme = nettoyerTheme(saisie);
  const classe = await classeDuTheme(theme, signal);
  const entites = await entitesDeLaClasse(classe.id, signal);
  // Chronologie désactivée pour les thèmes libres : Wikidata donne parfois une date fausse (château de Balmoral
  // daté de 1390, construit en 1855), que le filtre de précision ne voit pas. Réactivable après vérification.
  const chrono = CHRONOLOGIE_LIBRE_ACTIVE
    ? chronologiesLibres(entites)
    : { questions: [], utilises: new Set<string>() };
  const restantes = entites.filter((e) => !chrono.utilises.has(e.id));
  const estimations = estimationsLongueur(restantes);
  // Les pays sans longueur donnent les questions « pays » ; les leurres viennent de toutes les entités.
  const entrees = questionsPays(
    restantes.filter((e) => e.longueurKm === null),
    theme,
    entites,
  );
  if (entrees.length + estimations.length + chrono.questions.length < MIN_PAYS) {
    throw new Error(`Pas assez de questions pour « ${theme} »`);
  }
  return resultatLibreSchema.parse({
    theme,
    classe: classe.id,
    entrees,
    estimations,
    chronologies: chrono.questions,
  });
}

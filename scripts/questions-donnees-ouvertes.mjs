#!/usr/bin/env node
/**
 * Génère des questions de Quiz Party à partir de données ouvertes, puis les écrit dans
 * packages/games/src/quiz-party/questions-ouvertes.fr.json. Le jeu lit ce fichier : il ne dépend d'aucune API en partie.
 *
 * Sources (sans clé) :
 * - Wikidata, service SPARQL (données CC0) : capitales, éléments chimiques, tableaux célèbres ;
 * - API Géo, geo.api.gouv.fr (Licence Ouverte 2.0, Etalab) : départements et préfectures.
 *
 * Usage : node --use-system-ca scripts/questions-donnees-ouvertes.mjs
 * (--use-system-ca seulement derrière un proxy d'entreprise à certificat maison.)
 * Le tirage est fixé par SEED : relancer le script ne change le fichier que si les données ont changé.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../packages/games/src/quiz-party/questions-ouvertes.fr.json', import.meta.url));
const SEED = 20261105;
const UA = 'PartyHub-quiz-generator/1.0 (https://github.com/renaudmathieu/partyhub)';
const PER_KIND = 20;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Une question à 4 choix : la bonne réponse et 3 leurres distincts tirés de `pool`, mélangés.
 * Écartée si la question contient déjà la réponse (Territoire de Belfort → Belfort).
 */
function mcq(id, category, question, answer, pool) {
  if (question.includes(answer)) return null;
  const decoys = shuffle([...new Set(pool)].filter((p) => p !== answer)).slice(0, 3);
  if (decoys.length < 3) return null;
  const choices = shuffle([answer, ...decoys]);
  return { id, category, question, choices, answer: choices.indexOf(answer) };
}

/** Wikidata répond parfois 502 ou 429 : on réessaie deux fois, avec une pause croissante. */
async function getJson(url, init = {}, attempt = 1) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init.headers } });
  if ((res.status >= 500 || res.status === 429) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return getJson(url, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`;
  const data = await getJson(url, { headers: { Accept: 'application/sparql-results+json' } });
  return data.results.bindings.map((b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value.replace('http://www.wikidata.org/entity/', '')])),
  );
}

/** Capitales contestées : une question de quiz ne doit pas trancher un débat politique. */
const CONTESTED = new Set(['Q801']); // Israël

async function capitals() {
  // États souverains existants, une seule capitale, triés par notoriété (nombre d'articles Wikipédia).
  const rows = await sparql(`SELECT ?pays ?paysL ?capL ?contL ?sl WHERE {
    ?pays wdt:P31 wd:Q3624078; wdt:P36 ?cap; wdt:P30 ?cont; wikibase:sitelinks ?sl.
    FILTER NOT EXISTS { ?pays wdt:P576 ?fin }
    FILTER NOT EXISTS { ?pays wdt:P36 ?autre. FILTER(?autre != ?cap) }
    ?pays rdfs:label ?paysL. FILTER(lang(?paysL) = "fr")
    ?cap rdfs:label ?capL. FILTER(lang(?capL) = "fr")
    ?cont rdfs:label ?contL. FILTER(lang(?contL) = "fr")
  } ORDER BY DESC(?sl) STR(?pays) ?contL`);
  const countries = new Map();
  for (const r of rows) {
    if (r.contL === 'Eurasie' || CONTESTED.has(r.pays)) continue;
    if (!countries.has(r.pays))
      countries.set(r.pays, { id: r.pays, name: r.paysL, capital: r.capL, continent: r.contL });
  }
  const known = [...countries.values()].slice(0, 120);
  return shuffle(known.slice(0, 60))
    .slice(0, PER_KIND)
    .map((c) =>
      mcq(
        `od-cap-${c.id}`,
        'Géographie',
        `Quelle est la capitale du pays « ${c.name} » ?`,
        c.capital,
        known.filter((o) => o.continent === c.continent).map((o) => o.capital),
      ),
    );
}

async function elements() {
  const rows = await sparql(`SELECT ?e ?eL ?sym WHERE {
    ?e wdt:P31 wd:Q11344; wdt:P246 ?sym; wdt:P1086 ?num. FILTER(?num <= 60)
    ?e rdfs:label ?eL. FILTER(lang(?eL) = "fr")
  } ORDER BY ?num`);
  const names = rows.map((r) => cap(r.eL));
  return shuffle(rows)
    .slice(0, PER_KIND)
    .map((r) =>
      mcq(`od-chi-${r.e}`, 'Sciences', `Quel élément chimique a pour symbole « ${r.sym} » ?`, cap(r.eL), names),
    );
}

/** Tableaux écartés : attribution disputée (Salvator Mundi), titre trop vague (Iris). */
const DOUBTFUL = new Set(['Q1892745', 'Q2282256']);

async function paintings() {
  const rows = await sparql(`SELECT ?t ?tL ?aL ?sl WHERE {
    ?t wdt:P31 wd:Q3305213; wdt:P170 ?a; wikibase:sitelinks ?sl. FILTER(?sl > 40)
    ?a wdt:P31 wd:Q5.
    ?t rdfs:label ?tL. FILTER(lang(?tL) = "fr")
    ?a rdfs:label ?aL. FILTER(lang(?aL) = "fr")
  } ORDER BY DESC(?sl) STR(?t) ?aL`);
  const seen = new Set();
  const works = rows.filter((r) => !DOUBTFUL.has(r.t) && !seen.has(r.t) && seen.add(r.t));
  const painters = works.map((r) => r.aL);
  return shuffle(works)
    .slice(0, PER_KIND)
    .map((r) => mcq(`od-art-${r.t}`, 'Culture', `Qui a peint « ${r.tL} » ?`, r.aL, painters));
}

async function departements() {
  const deps = await getJson('https://geo.api.gouv.fr/departements?fields=nom,code,chefLieu,codeRegion');
  const picked = shuffle(deps).slice(0, PER_KIND);
  // Préfecture : leurres pris dans la même région quand c'est possible, pour rester plausibles.
  const withPrefecture = await Promise.all(
    picked.map(async (d) => ({
      ...d,
      prefecture: (await getJson(`https://geo.api.gouv.fr/communes/${d.chefLieu}?fields=nom`)).nom,
    })),
  );
  const prefQuestions = withPrefecture.slice(0, PER_KIND / 2).map((d) => {
    const sameRegion = withPrefecture.filter((o) => o.codeRegion === d.codeRegion).map((o) => o.prefecture);
    const pool = sameRegion.length > 3 ? sameRegion : withPrefecture.map((o) => o.prefecture);
    return mcq(
      `od-pre-${d.code}`,
      'Géographie',
      `Quelle est la préfecture du département ${d.nom} ?`,
      d.prefecture,
      pool,
    );
  });
  const numQuestions = withPrefecture.slice(PER_KIND / 2).map((d) =>
    mcq(
      `od-dep-${d.code}`,
      'Géographie',
      `Quel département porte le numéro ${d.code} ?`,
      d.nom,
      deps.map((o) => o.nom),
    ),
  );
  return [...prefQuestions, ...numQuestions];
}

const questions = [];
for (const [name, build] of Object.entries({ capitals, elements, paintings, departements })) {
  const list = (await build()).filter(Boolean);
  console.log(`${name} : ${list.length} questions`);
  questions.push(...list);
}
writeFileSync(OUT, `${JSON.stringify(questions, null, 2)}\n`);
console.log(`${questions.length} questions écrites dans ${OUT}`);

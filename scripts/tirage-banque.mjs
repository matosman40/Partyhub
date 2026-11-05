#!/usr/bin/env node
/**
 * Banque du mode « Estimer » de Tirage surprise : des chiffres réels tirés de Wikidata (CC0).
 * Écrit packages/games/src/tirage/banque-estimer.fr.json. Le jeu ne lit que ce fichier pendant une partie.
 *
 * Usage : node --use-system-ca scripts/tirage-banque.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'packages/games/src/tirage/banque-estimer.fr.json');
const UA = 'PartyHub-tirage/1.0 (https://github.com/renaudmathieu/partyhub)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query) {
  for (let essai = 1; essai <= 3; essai++) {
    const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) return (await res.json()).results.bindings;
    await sleep(4000 * essai);
  }
  throw new Error('Wikidata indisponible');
}

const val = (b, k) => b[k]?.value;
const id = (uri) => uri.replace('http://www.wikidata.org/entity/', '');

const pays = await sparql(`SELECT ?e ?l ?pop WHERE {
  ?e wdt:P31 wd:Q3624078; wdt:P1082 ?pop.
  FILTER NOT EXISTS { ?e wdt:P576 ?fin }
  ?e rdfs:label ?l. FILTER(lang(?l) = "fr")
  FILTER(?pop > 1000000)
} ORDER BY DESC(?pop) LIMIT 60`);

await sleep(1500);
const montagnes = await sparql(`SELECT ?e ?l ?h WHERE {
  ?e wdt:P31/wdt:P279* wd:Q8502; wdt:P2044 ?h.
  ?e rdfs:label ?l. FILTER(lang(?l) = "fr")
  FILTER(?h > 1000 && ?h < 8849)
} ORDER BY DESC(?h) LIMIT 60`);

const entrees = [
  ...pays.map((b) => ({
    id: `pop-${id(val(b, 'e'))}`,
    question: `Combien d'habitants compte ${val(b, 'l')} ?`,
    valeur: Math.round(Number(val(b, 'pop'))),
    unite: 'habitants',
    theme: 'Pays',
    source: `https://www.wikidata.org/wiki/${id(val(b, 'e'))}`,
  })),
  ...montagnes.map((b) => ({
    id: `alt-${id(val(b, 'e'))}`,
    question: `Quelle est l'altitude de ${val(b, 'l')} ?`,
    valeur: Math.round(Number(val(b, 'h'))),
    unite: 'mètres',
    theme: 'Monuments',
    source: `https://www.wikidata.org/wiki/${id(val(b, 'e'))}`,
  })),
];

const vus = new Set();
const uniques = entrees.filter((e) => !vus.has(e.id) && vus.add(e.id));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ licence: 'CC0 (Wikidata)', entrees: uniques }, null, 2)}\n`);
console.log(`${uniques.length} entrées (${pays.length} pays, ${montagnes.length} montagnes) → ${OUT}`);

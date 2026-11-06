#!/usr/bin/env node
/**
 * Banque du mode « Attribuer » de Tirage surprise : des livres en français et leur auteur, tirés d'Open Library.
 * Écrit packages/games/src/tirage/banque-livres.fr.json.
 *
 * Seules les métadonnées (titre, auteur) sont gardées : Open Library publie ses données sous CC0, mais pas les
 * couvertures, dont les droits ne sont pas libres. Aucune image n'est donc utilisée pour ce mode.
 *
 * Usage : node --use-system-ca scripts/tirage-banque-livres.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'packages/games/src/tirage/banque-livres.fr.json');
const API = 'https://openlibrary.org/search.json';
const UA = 'PartyHub-tirage/1.0 (https://github.com/renaudmathieu/partyhub)';
const SUJETS = ['french literature', 'french fiction', 'french poetry', 'french drama'];
const CIBLE = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let essai = 1; essai <= 3; essai++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} ${url}`);
    await sleep(5000 * essai);
  }
  throw new Error(`Open Library indisponible : ${url}`);
}

const entrees = [];
const vus = new Set();

for (const sujet of SUJETS) {
  for (let page = 1; page <= 3 && entrees.length < CIBLE; page++) {
    await sleep(1000);
    const url =
      `${API}?subject=${encodeURIComponent(sujet)}&language=fre` +
      `&fields=key,title,author_name,first_publish_year&limit=100&page=${page}`;
    const { docs } = await getJson(url);
    for (const d of docs) {
      if (entrees.length >= CIBLE) break;
      const titre = (d.title ?? '').trim();
      const auteurs = d.author_name ?? [];
      if (!d.key || titre.length < 3 || titre.length > 70 || auteurs.length !== 1) continue;
      if (!Number.isInteger(d.first_publish_year) || d.first_publish_year < 1500 || d.first_publish_year > 2000)
        continue;
      const auteur = auteurs[0].trim();
      if (!auteur || vus.has(d.key) || vus.has(titre)) continue;
      vus.add(d.key);
      vus.add(titre);
      entrees.push({
        id: `livre-${d.key.replace('/works/', '')}`,
        question: `Qui a écrit « ${titre} » ?`,
        reponse: auteur,
        titre,
        annee: d.first_publish_year,
        theme: 'Littérature',
        source: `https://openlibrary.org${d.key}`,
        licence: 'Open Library (données CC0)',
      });
    }
  }
}

const auteurs = new Set(entrees.map((e) => e.reponse));
if (auteurs.size < 4) throw new Error(`Pas assez d'auteurs distincts pour quatre choix : ${auteurs.size}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ licence: 'CC0 (Open Library, métadonnées)', entrees }, null, 2)}\n`);
console.log(`${entrees.length} livres, ${auteurs.size} auteurs distincts → ${OUT}`);

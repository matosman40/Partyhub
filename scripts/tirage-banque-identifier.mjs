#!/usr/bin/env node
/**
 * Banque du mode « Identifier » de Tirage surprise : des tableaux du Met Museum (CC0, domaine public).
 * Écrit packages/games/src/tirage/banque-identifier.fr.json. Seules les œuvres en domaine public, avec image
 * et nom d'artiste connu, sont gardées. Chaque image est téléchargée depuis le Met dans
 * packages/web/public/tirage/met/ : le jeu ne fait aucun appel externe pendant une partie.
 *
 * Usage : node --use-system-ca scripts/tirage-banque-identifier.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'packages/games/src/tirage/banque-identifier.fr.json');
const IMAGES = join(ROOT, 'packages/web/public/tirage/met');
const API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const UA = 'PartyHub-tirage/1.0 (https://github.com/renaudmathieu/partyhub)';
const CIBLE = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let essai = 1; essai <= 3; essai++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status !== 403 && res.status !== 429) throw new Error(`HTTP ${res.status} ${url}`);
    await sleep(10_000 * essai);
  }
  throw new Error(`Met indisponible : ${url}`);
}

// Recherche élargie aux peintures européennes ; l'API v1.1 remplace l'ancienne recherche retirée en 2026.
const recherche = await getJson(
  `${API.replace('/v1', '/v1.1')}/search?q=painting&hasImages=true&isPublicDomain=true&departmentId=11`,
);
const ids = (recherche.objectIDs ?? []).slice(0, 150);

const entrees = [];
for (const objectID of ids) {
  if (entrees.length >= CIBLE) break;
  await sleep(1200);
  const o = await getJson(`${API}/objects/${objectID}`);
  if (!o) continue;
  const artiste = (o.artistDisplayName ?? '').trim();
  const ok =
    o.isPublicDomain && o.objectName === 'Painting' && o.primaryImageSmall && artiste && o.artistRole === 'Artist';
  if (!ok) continue;
  const fichier = `${o.objectID}.jpg`;
  const chemin = join(IMAGES, fichier);
  if (!existsSync(chemin)) {
    await sleep(1200);
    const image = await fetch(o.primaryImageSmall, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(60_000),
    });
    if (!image.ok) continue;
    mkdirSync(IMAGES, { recursive: true });
    writeFileSync(chemin, Buffer.from(await image.arrayBuffer()));
  }
  entrees.push({
    id: `met-${o.objectID}`,
    question: 'Qui a peint ce tableau ?',
    reponse: artiste,
    titre: o.title,
    date: o.objectDate || null,
    image: `/tirage/met/${fichier}`,
    theme: 'Peintures',
    source: o.objectURL,
    licence: 'CC0 (Met Museum)',
  });
}

const artistes = new Set(entrees.map((e) => e.reponse));
if (artistes.size < 4) throw new Error(`Pas assez d'artistes distincts pour quatre choix : ${artistes.size}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ licence: 'CC0 (Met Museum)', entrees }, null, 2)}\n`);
console.log(`${entrees.length} tableaux, ${artistes.size} artistes distincts → ${OUT}`);

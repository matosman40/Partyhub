#!/usr/bin/env node
/**
 * Banque d'espèces du mode « Identifier » de Tirage surprise : des photos iNaturalist sous licence libre
 * (CC0, CC BY, CC BY-SA), une espèce par entrée, avec son nom français.
 *
 * Écrit packages/games/src/tirage/banque-especes.fr.json et télécharge chaque photo dans
 * packages/web/public/tirage/inat/ : le jeu ne fait aucun appel externe pendant une partie.
 * Chaque entrée garde le crédit exact du photographe, requis par les licences CC BY et CC BY-SA.
 *
 * Usage : node --use-system-ca scripts/tirage-banque-especes.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'packages/games/src/tirage/banque-especes.fr.json');
const IMAGES = join(ROOT, 'packages/web/public/tirage/inat');
const API = 'https://api.inaturalist.org/v1/observations';
const UA = 'PartyHub-tirage/1.0 (https://github.com/renaudmathieu/partyhub)';
const GROUPES = ['Aves', 'Mammalia', 'Insecta', 'Reptilia', 'Amphibia', 'Actinopterygii', 'Plantae'];
const PAR_GROUPE = 9;
const LICENCES = {
  cc0: 'CC0',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let essai = 1; essai <= 3; essai++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (res.ok) return res.json();
    if (res.status !== 403 && res.status !== 429) throw new Error(`HTTP ${res.status} ${url}`);
    await sleep(5000 * essai);
  }
  throw new Error(`iNaturalist indisponible : ${url}`);
}

const entrees = [];
const taxons = new Set();

for (const groupe of GROUPES) {
  let retenues = 0;
  for (let page = 1; page <= 4 && retenues < PAR_GROUPE; page++) {
    await sleep(1200);
    const url =
      `${API}?quality_grade=research&photos=true&photo_license=cc0,cc-by,cc-by-sa` +
      `&iconic_taxa=${groupe}&rank=species&order_by=votes&per_page=100&page=${page}&locale=fr&spam=false`;
    const { results } = await getJson(url);
    for (const obs of results) {
      if (retenues >= PAR_GROUPE) break;
      const taxon = obs.taxon;
      const photo = obs.photos?.[0];
      const nom = taxon?.preferred_common_name?.trim();
      if (!taxon || !photo || !nom || taxon.rank !== 'species' || taxons.has(taxon.id)) continue;
      const licence = LICENCES[photo.license_code];
      if (!licence) continue;

      // L'extension suit le format réel de la photo, pour que le serveur serve le bon type MIME.
      const extension = (photo.url.match(/\.(jpe?g|png|gif)(\?|$)/i)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
      const fichier = `${taxon.id}.${extension}`;
      const chemin = join(IMAGES, fichier);
      if (!existsSync(chemin)) {
        await sleep(1200);
        const image = await fetch(photo.url.replace('/square.', '/medium.'), {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(60_000),
        });
        if (!image.ok) continue;
        mkdirSync(IMAGES, { recursive: true });
        writeFileSync(chemin, Buffer.from(await image.arrayBuffer()));
      }

      taxons.add(taxon.id);
      retenues++;
      entrees.push({
        id: `inat-${taxon.id}`,
        question: 'Quelle est cette espèce ?',
        reponse: nom.charAt(0).toUpperCase() + nom.slice(1),
        titre: taxon.name,
        image: `/tirage/inat/${fichier}`,
        theme: 'Animaux',
        source: `https://www.inaturalist.org/observations/${obs.id}`,
        credit: `${photo.attribution ?? 'Photo iNaturalist'} · ${licence}`,
        licence,
      });
    }
  }
  console.log(`${groupe} : ${retenues} espèces`);
}

const reponses = new Set(entrees.map((e) => e.reponse));
if (reponses.size < 4) throw new Error(`Pas assez de noms français distincts : ${reponses.size}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify({ licence: 'CC0, CC BY, CC BY-SA (iNaturalist, crédit par photo)', entrees }, null, 2)}\n`,
);
console.log(`${entrees.length} espèces → ${OUT}`);

#!/usr/bin/env node
/**
 * Constitue les questions « Qui a peint ce tableau ? » de Quiz Party à partir des tableaux du Metropolitan
 * Museum of Art (API publique, sans clé). Les images sont téléchargées dans packages/web/public/quiz-party/ et
 * les questions écrites dans packages/games/src/quiz-party/questions-musee.fr.json.
 *
 * Seuls les tableaux du domaine public (CC0, « isPublicDomain ») sont retenus. Chaque question garde son crédit,
 * sa licence et l’adresse de la notice : le jeu les affiche à la révélation.
 *
 * Usage : node --use-system-ca scripts/quiz-musee-images.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMG_DIR = join(ROOT, 'packages/web/public/quiz-party');
const OUT = join(ROOT, 'packages/games/src/quiz-party/questions-musee.fr.json');
const UA = 'PartyHub-quiz-musee/1.0 (https://github.com/renaudmathieu/partyhub)';
const API = 'https://collectionapi.metmuseum.org/public/collection/v1';
// La recherche est servie par la v1.1 (la v1 a été retirée le 2026-10-01).
const API_RECHERCHE = 'https://collectionapi.metmuseum.org/public/collection/v1.1';

/** Peintres (libellé français, mot-clé à chercher dans le nom affiché par le musée). */
const PEINTRES = [
  ['Claude Monet', 'Monet'],
  ['Vincent van Gogh', 'Gogh'],
  ['Rembrandt', 'Rembrandt'],
  ['Johannes Vermeer', 'Vermeer'],
  ['Edgar Degas', 'Degas'],
  ['Pierre-Auguste Renoir', 'Renoir'],
  ['Paul Cézanne', 'Cézanne'],
  ['Paul Gauguin', 'Gauguin'],
  ['Édouard Manet', 'Manet'],
  ['Gustave Courbet', 'Courbet'],
  ['Diego Velázquez', 'Velázquez'],
  ['Francisco de Goya', 'Goya'],
  ['Peter Paul Rubens', 'Rubens'],
  ['Le Caravage', 'Caravaggio'],
  ['Titien', 'Titian'],
  ['Katsushika Hokusai', 'Hokusai'],
  ['William Turner', 'Turner'],
  ['John Constable', 'Constable'],
  ['Camille Corot', 'Corot'],
  ['Georges Seurat', 'Seurat'],
];

/**
 * Tableaux écartés après relecture : nus (public familial) ; le numéro est celui de la notice du musée.
 */
const EXCLUS = new Map([
  [459110, 'nu (Renoir, Baigneuse)'],
  [437826, 'nus (Titien, Vénus et Adonis)'],
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let dernier = 0;
/** Pause minimale entre deux requêtes : le musée bloque les rafales (réponse 403). */
async function attendre() {
  const reste = dernier + 1100 - Date.now();
  if (reste > 0) await sleep(reste);
  dernier = Date.now();
}

async function get(url, { binary = false } = {}, essai = 1) {
  await attendre();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if ((res.status >= 500 || res.status === 429) && essai < 4) {
      await sleep(3000 * essai);
      return get(url, { binary }, essai + 1);
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  } catch (err) {
    if (essai < 4) {
      await sleep(3000 * essai);
      return get(url, { binary }, essai + 1);
    }
    throw err;
  }
}

/**
 * Tableau du domaine public, avec image, dont l’auteur correspond au mot-clé. Le musée marque ses œuvres phares
 * (champ isHighlight) : on les préfère, pour que le quiz porte sur des tableaux reconnaissables.
 */
async function tableauDe(mot) {
  const recherche = await get(`${API_RECHERCHE}/search?hasImages=true&isPublicDomain=true&q=${encodeURIComponent(mot)}`);
  const ids = (recherche.objectIDs ?? []).slice(0, 30);
  for (let i = 0; i < ids.length; i += 8) {
    // Notices chargées par lots de huit ; une notice absente ou retirée est simplement ignorée.
    const lot = [];
    for (const id of ids.slice(i, i + 8)) lot.push(await get(`${API}/objects/${id}`).catch(() => null));
    const phare = lot.find(
      (o) =>
        o &&
        !EXCLUS.has(o.objectID) &&
        o.isHighlight &&
        o.isPublicDomain &&
        o.primaryImageSmall &&
        o.objectName === 'Painting' &&
        String(o.artistDisplayName ?? '').includes(mot),
    );
    if (phare) return phare;
  }
  return null;
}

function melange(liste, graine) {
  let s = graine >>> 0 || 1;
  const hasard = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(hasard() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

async function main() {
  const retenus = [];
  for (const [label, mot] of PEINTRES) {
    let o = null;
    try {
      o = await tableauDe(mot);
    } catch (err) {
      console.log(`  ${label} : erreur ${err.message}`);
    }
    if (!o) {
      console.log(`  ${label} : aucun tableau du domaine public trouvé`);
      continue;
    }
    retenus.push({ label, objet: o });
    console.log(`  ${label} ← ${o.title} (${o.objectDate ?? 'date ?'})`);
    await sleep(300);
  }

  mkdirSync(IMG_DIR, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });
  const questions = [];
  retenus.forEach((r, i) => {
    const fichier = `met-${r.objet.objectID}.jpg`;
    const autres = retenus.filter((x) => x !== r).map((x) => x.label);
    const leurres = melange(autres, r.objet.objectID).slice(0, 3);
    // Les choix sont mélangés par l’identifiant du tableau : la bonne réponse n’est jamais toujours en tête.
    const choix = melange([r.label, ...leurres], r.objet.objectID + i);
    questions.push({
      id: `met-${r.objet.objectID}`,
      category: 'Culture',
      question: 'Qui a peint ce tableau ?',
      choices: choix,
      answer: choix.indexOf(r.label),
      image: {
        src: `/quiz-party/${fichier}`,
        alt: 'Tableau à identifier : le peintre n’est pas nommé',
        credit: `The Met, ${r.objet.title}`,
        license: 'CC0 (domaine public)',
        source: r.objet.objectURL,
      },
    });
  });

  for (const r of retenus) {
    const octets = await get(r.objet.primaryImageSmall, { binary: true });
    writeFileSync(join(IMG_DIR, `met-${r.objet.objectID}.jpg`), octets);
    await sleep(300);
  }
  writeFileSync(OUT, `${JSON.stringify(questions, null, 2)}\n`);
  console.log(`${questions.length} questions et images écrites.`);
}

await main();

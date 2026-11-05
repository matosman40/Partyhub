#!/usr/bin/env node
/**
 * Constitue le fonds de photos de « Photo mystère ».
 *
 * Deux temps, pour qu'aucune photo ne parte dans le jeu sans avoir été regardée :
 *   node --use-system-ca scripts/photo-mystere-photos.mjs scout <dossier-hors-depot>
 *     Cherche, pour chaque lieu de SITES, des photos géolocalisées sur Wikimedia Commons (licences libres)
 *     et écrit une planche d'images candidates. Ne touche pas au dépôt.
 *   node --use-system-ca scripts/photo-mystere-photos.mjs build
 *     Télécharge uniquement les fichiers épinglés dans SITES (champ `file`), dans
 *     packages/web/public/photo-mystere/, et écrit packages/games/src/photo-mystere/photos.fr.json.
 *
 * Sources : Wikimedia Commons (API MediaWiki, pas de clé). Chaque photo garde son auteur, sa licence
 * et son adresse d'origine, affichés dans le jeu. Les licences avec « NC » ou « ND » sont refusées.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'packages/web/public/photo-mystere');
const DATA_OUT = join(ROOT, 'packages/games/src/photo-mystere/photos.fr.json');
const UA = 'PartyHub-photo-mystere/1.0 (https://github.com/renaudmathieu/partyhub)';
const RADIUS_M = 1500;

/**
 * Titres Commons relus visuellement (planches de contrôle, 2026-11-05). Un lieu sans titre est ignoré.
 */
const PINNED = {
  'angkor-vat': 'File:Angkor Wat 119.jpg',
  bagan: 'File:Temples and hot air balloons. (Unsplash).jpg',
  'baie-halong': 'File:Ha Long Bay 下龍灣 - panoramio (1).jpg',
  'big-ben':
    'File:December Clock Tower London The Big Ben Her Majesty Services Evangelize - Master England Photography 2012 - panoramio.jpg',
  'christ-redempteur': 'File:Santa Teresa, Rio de Janeiro - State of Rio de Janeiro, Brazil - panoramio (14).jpg',
  dubrovnik: 'File:Dubrovnik (213621645).jpeg',
  'golden-gate': 'File:Golden Gate Bridge (Unsplash).jpg',
  'grande-muraille': 'File:Great Wall of China July 2006.JPG',
  gullfoss: 'File:Gullfoss (Unsplash).jpg',
  havane: 'File:Havana, Cuba (Unsplash N20LjgOVWAA).jpg',
  iguazu: 'File:Parque Nacional do Iguaçu & Cataratas do Iguaçu 02.jpg',
  'jemaa-el-fna': 'File:Tienda de lámparas -- 2014 -- Plaza Djemaa el Fna, Marrakech, Marruecos.jpg',
  kilimandjaro: 'File:Furtwanler Glacier Mt. Kilimanjaro.JPG',
  kremlin: 'File:View of the Kremlin (Moscow, 2005).jpg',
  moai: 'File:Atardecer Ahu Tahai.JPG',
  'notre-dame': 'File:Notre-Dame de Paris north rose window 2026-01-04-1.jpg',
  petra: 'File:Jordan 2011-02-07 (5572976725).jpg',
  'pyramides-gizeh': 'File:The Great Pyramid of Giza (Pyramid of Cheops or Khufu) (14823042753).jpg',
  'sagrada-familia': 'File:Sagrada Famiglia di Barcellona (3).JPG',
  'sainte-sophie': 'File:Istanbul, İstanbul, Turkey - panoramio (332).jpg',
  shibuya: 'File:渋谷 - panoramio.jpg',
  'table-mountain': 'File:500px photo (227830463).jpeg',
  'taj-mahal': 'File:TajMehel.jpg',
  'times-square': 'File:Times Square at night in New York - NYC - USA - panoramio.jpg',
  'tour-eiffel': 'File:Eiffel Tower by night, Paris, FRANCE.jpg',
};

/**
 * Lieux visés. Le titre épinglé dans PINNED est la photo retenue.
 */
const SITES = [
  { id: 'tour-eiffel', place: 'La tour Eiffel', country: 'France', lat: 48.8584, lon: 2.2945 },
  { id: 'machu-picchu', place: 'Machu Picchu', country: 'Pérou', lat: -13.1631, lon: -72.545 },
  { id: 'taj-mahal', place: 'Le Taj Mahal', country: 'Inde', lat: 27.1751, lon: 78.0421 },
  { id: 'statue-liberte', place: 'La statue de la Liberté', country: 'États-Unis', lat: 40.6892, lon: -74.0445 },
  { id: 'colisee', place: 'Le Colisée', country: 'Italie', lat: 41.8902, lon: 12.4922 },
  { id: 'petra', place: 'Pétra', country: 'Jordanie', lat: 30.3285, lon: 35.4444 },
  { id: 'pyramides-gizeh', place: 'Les pyramides de Gizeh', country: 'Égypte', lat: 29.9792, lon: 31.1342 },
  { id: 'big-ben', place: 'Big Ben', country: 'Royaume-Uni', lat: 51.5007, lon: -0.1246 },
  { id: 'burj-khalifa', place: 'La tour Burj Khalifa', country: 'Émirats arabes unis', lat: 25.1972, lon: 55.2744 },
  { id: 'christ-redempteur', place: 'Le Christ Rédempteur', country: 'Brésil', lat: -22.9519, lon: -43.2105 },
  { id: 'angkor-vat', place: 'Angkor Vat', country: 'Cambodge', lat: 13.4125, lon: 103.867 },
  { id: 'grande-muraille', place: 'La Grande Muraille de Chine', country: 'Chine', lat: 40.4319, lon: 116.5704 },
  { id: 'golden-gate', place: 'Le Golden Gate', country: 'États-Unis', lat: 37.8199, lon: -122.4783 },
  { id: 'iguazu', place: 'Les chutes d’Iguazú', country: 'Argentine', lat: -25.6953, lon: -54.4367 },
  { id: 'sagrada-familia', place: 'La Sagrada Família', country: 'Espagne', lat: 41.4036, lon: 2.1744 },
  { id: 'kremlin', place: 'Le Kremlin', country: 'Russie', lat: 55.752, lon: 37.6175 },
  { id: 'sainte-sophie', place: 'Sainte-Sophie', country: 'Turquie', lat: 41.0086, lon: 28.9802 },
  { id: 'baie-halong', place: 'La baie d’Along', country: 'Viêt Nam', lat: 20.9101, lon: 107.1839 },
  { id: 'uluru', place: 'Uluru', country: 'Australie', lat: -25.3444, lon: 131.0369 },
  { id: 'moai', place: 'Les moaï de l’île de Pâques', country: 'Chili', lat: -27.1127, lon: -109.3497 },
  { id: 'mont-saint-michel', place: 'Le Mont-Saint-Michel', country: 'France', lat: 48.6361, lon: -1.5114 },
  { id: 'shibuya', place: 'Le carrefour de Shibuya', country: 'Japon', lat: 35.6595, lon: 139.7005 },
  { id: 'jemaa-el-fna', place: 'La place Jemaa el-Fna', country: 'Maroc', lat: 31.6258, lon: -7.9891 },
  { id: 'table-mountain', place: 'La Table Mountain', country: 'Afrique du Sud', lat: -33.9628, lon: 18.4098 },
  { id: 'times-square', place: 'Times Square', country: 'États-Unis', lat: 40.758, lon: -73.9855 },
  { id: 'dubrovnik', place: 'La vieille ville de Dubrovnik', country: 'Croatie', lat: 42.6507, lon: 18.0944 },
  { id: 'santorin', place: 'Santorin', country: 'Grèce', lat: 36.3932, lon: 25.4615 },
  { id: 'bagan', place: 'Bagan', country: 'Birmanie', lat: 21.1717, lon: 94.8585 },
  { id: 'havane', place: 'La Havane', country: 'Cuba', lat: 23.1136, lon: -82.3666 },
  { id: 'gullfoss', place: 'La cascade de Gullfoss', country: 'Islande', lat: 64.3271, lon: -20.1199 },
  { id: 'notre-dame', place: 'La cathédrale Notre-Dame de Paris', country: 'France', lat: 48.853, lon: 2.3499 },
  { id: 'kilimandjaro', place: 'Le Kilimandjaro', country: 'Tanzanie', lat: -3.0674, lon: 37.3556 },
];

const DENIED_LICENSE = /\b(NC|ND)\b|non-commercial|no derivatives/i;
const DENIED_TITLE =
  /portrait|logo|flag|drapeau|map|carte|plan|diagram|schéma|\.svg|\.pdf|signature|coat of arms|blason/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { binary = false } = {}, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if ((res.status >= 500 || res.status === 429) && attempt < 4) {
      await sleep(4000 * attempt);
      return get(url, { binary }, attempt + 1);
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  } catch (err) {
    if (attempt < 4) {
      await sleep(4000 * attempt);
      return get(url, { binary }, attempt + 1);
    }
    throw err;
  }
}

const text = (field) =>
  (field?.value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Candidates géolocalisées autour d'un lieu, déjà filtrées par type et licence. */
async function candidates(site) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  const params = {
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${site.lat}|${site.lon}`,
    ggsradius: String(RADIUS_M),
    ggsnamespace: '6',
    ggslimit: '20',
    prop: 'imageinfo|coordinates',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '960',
    format: 'json',
    formatversion: '2',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const json = await get(url);
  const pages = json.query?.pages ?? [];
  return pages
    .map((p) => {
      const ii = p.imageinfo?.[0];
      const coord = p.coordinates?.[0];
      return {
        title: p.title,
        mime: ii?.mime,
        width: ii?.width,
        height: ii?.height,
        thumb: ii?.thumburl,
        license: text(ii?.extmetadata?.LicenseShortName),
        artist: text(ii?.extmetadata?.Artist),
        descriptionUrl: ii?.descriptionurl,
        lat: coord?.lat,
        lon: coord?.lon,
      };
    })
    .filter(
      (c) =>
        c.mime === 'image/jpeg' &&
        c.width >= 1000 &&
        c.thumb &&
        c.license &&
        !DENIED_LICENSE.test(c.license) &&
        !DENIED_TITLE.test(c.title),
    );
}

async function scout(dir) {
  mkdirSync(dir, { recursive: true });
  const report = {};
  for (const site of SITES) {
    const list = await candidates(site);
    report[site.id] = list.map((c) => ({ title: c.title, license: c.license, artist: c.artist, thumb: c.thumb }));
    console.log(`${site.id.padEnd(20)} ${list.length} candidate(s)`);
    for (const c of list.slice(0, 4)) console.log(`    ${c.title}  [${c.license}]`);
    await sleep(1500);
  }
  const out = join(dir, 'candidates.json');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nCandidates écrites dans ${out}`);
}

async function build() {
  const pinned = SITES.filter((s) => PINNED[s.id]).map((s) => ({ ...s, file: PINNED[s.id] }));
  mkdirSync(PUBLIC_DIR, { recursive: true });
  const entries = [];
  for (const site of pinned) {
    const list = await candidates(site);
    const chosen = list.find((c) => c.title === site.file);
    if (!chosen) throw new Error(`Fichier épinglé introuvable pour ${site.id} : ${site.file}`);
    const bytes = await get(chosen.thumb, { binary: true });
    const fileName = `${site.id}.jpg`;
    writeFileSync(join(PUBLIC_DIR, fileName), bytes);
    entries.push({
      id: site.id,
      place: site.place,
      country: site.country,
      lat: chosen.lat ?? site.lat,
      lon: chosen.lon ?? site.lon,
      file: `/photo-mystere/${fileName}`,
      credit: chosen.artist || 'Auteur inconnu',
      license: chosen.license,
      source: chosen.descriptionUrl,
    });
    console.log(`${site.id} ← ${chosen.title} [${chosen.license}]`);
    await sleep(1500);
  }
  mkdirSync(dirname(DATA_OUT), { recursive: true });
  writeFileSync(DATA_OUT, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`\n${entries.length} photos écrites ; données : ${DATA_OUT}`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'scout') await scout(arg ?? join(tmpdir(), 'photo-mystere-scout'));
else if (mode === 'build') await build();
else {
  console.error('Usage : photo-mystere-photos.mjs scout <dossier> | build');
  process.exit(1);
}

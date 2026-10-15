// Génère packages/games/src/boum/geo/countries-data.ts pour « Où est-ce ? » de BOUM !.
// Source : world-atlas (Natural Earth, domaine public, licence ISC). Noms : i18n-iso-countries (MIT).
// Centres : jeu 50 m (plus de pays couverts). Tracés : jeu 110 m (fichier léger).
// Usage (depuis un dossier où ces paquets sont installés) :
//   npm i world-atlas@2 topojson-client@3 i18n-iso-countries@7
//   node <chemin>/generate-countries.mjs <fichier de sortie .ts>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(`${process.cwd()}/`);
const coarse = require('world-atlas/countries-110m.json');
const detailed = require('world-atlas/countries-50m.json');
const topojson = require('topojson-client');
const iso = require('i18n-iso-countries');

const out = process.argv[2];
if (!out) throw new Error('Indiquez le fichier de sortie.');

const W = 1000;
const H = 500;
const toXY = ([lon, lat]) => [Math.round(((lon + 180) / 360) * W), Math.round(((90 - lat) / 180) * H)];

/** Anneau en coordonnées déroulées : évite les sauts au passage de l'antiméridien (Russie, Fidji…). */
function unwrap(ring) {
  const out = [];
  let shift = 0;
  let prev = null;
  for (const [lon, lat] of ring) {
    if (prev !== null) {
      const d = lon - prev;
      if (d > 180) shift -= 360;
      else if (d < -180) shift += 360;
    }
    out.push([lon + shift, lat]);
    prev = lon;
  }
  return out;
}

/** Centroïde (planaire, pondéré par l'aire) et aire signée d'un anneau. */
function ringCentroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { area: 0, lon: ring[0]?.[0] ?? 0, lat: ring[0]?.[1] ?? 0 };
  return { area: Math.abs(a), lon: cx / (6 * a), lat: cy / (6 * a) };
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

const names = iso.getNames('fr', { select: 'official' });
const centroids = {};
const paths = {};
const labels = {};
const unknown = new Set();

/** Centre du plus grand polygone d'un pays (la France métropolitaine, pas la Guyane). */
function centreOf(polygons) {
  let best = null;
  for (const polygon of polygons) {
    const c = ringCentroid(unwrap(polygon[0]));
    if (!best || c.area > best.area) best = c;
  }
  const lon = ((((best.lon + 180) % 360) + 360) % 360) - 180;
  const lat = Math.max(-90, Math.min(90, best.lat));
  return [Math.round(lat * 10) / 10, Math.round(lon * 10) / 10];
}

// Centres d'abord depuis le jeu détaillé, puis le jeu léger pour les pays qu'il omet.
for (const source of [detailed, coarse]) {
  for (const feature of topojson.feature(source, source.objects.countries).features) {
    const alpha2 = iso.numericToAlpha2(String(feature.id).padStart(3, '0'));
    const polygons = polygonsOf(feature.geometry);
    if (!alpha2) {
      unknown.add(feature.properties?.name ?? String(feature.id));
      continue;
    }
    if (polygons.length > 0 && !centroids[alpha2]) centroids[alpha2] = centreOf(polygons);
  }
}

for (const feature of topojson.feature(coarse, coarse.objects.countries).features) {
  const alpha2 = iso.numericToAlpha2(String(feature.id).padStart(3, '0'));
  if (!alpha2) continue;
  const polygons = polygonsOf(feature.geometry);
  if (polygons.length === 0) continue;

  // Tracé SVG : une sous-chaîne par anneau, coupée au passage de l'antiméridien.
  const parts = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = unwrap(ring).map(toXY);
      let segment = [];
      let last = null;
      for (const [x, y] of points) {
        if (last && Math.abs(x - last[0]) > W / 2) {
          if (segment.length > 2) parts.push(segment);
          segment = [];
        }
        segment.push([x, y]);
        last = [x, y];
      }
      if (segment.length > 2) parts.push(segment);
    }
  }
  paths[alpha2] = (paths[alpha2] ? paths[alpha2] + ' ' : '') +
    parts.map((seg) => 'M' + seg.map(([x, y]) => `${x} ${y}`).join('L') + 'Z').join(' ');
  labels[alpha2] = names[alpha2] ?? feature.properties?.name ?? alpha2;
}
for (const code of Object.keys(centroids)) labels[code] ??= names[code] ?? code;

// Territoires rattachés à un autre pays dans les jeux de données : centres saisis à la main
// (coordonnées approximatives, à 1° près). Ils ne sont utilisés que si le jeu ne les donne pas.
const MANUAL_CENTROIDS = {
  BQ: [12.18, -68.25], BV: [-54.42, 3.36], CC: [-12.16, 96.87], CX: [-10.48, 105.63], GF: [3.93, -53.13], GI: [36.14, -5.35],
  GP: [16.25, -61.55], MQ: [14.64, -61.02], RE: [-21.12, 55.54], SJ: [78.0, 20.0], TK: [-9.2, -171.85],
  TV: [-7.48, 178.68], UM: [19.3, 166.6], YT: [-12.83, 45.17],
};
for (const [code, centre] of Object.entries(MANUAL_CENTROIDS)) {
  centroids[code] ??= centre;
  labels[code] ??= names[code] ?? code;
}

const lines = [
  '// Généré par scripts/boum/generate-countries.mjs : ne pas modifier à la main.',
  '// Source : world-atlas (Natural Earth, domaine public, ISC) ; noms : i18n-iso-countries (MIT).',
  '',
  `export const MAP_WIDTH = ${W};`,
  `export const MAP_HEIGHT = ${H};`,
  '',
  '/** Centre approximatif de chaque pays, en [latitude, longitude]. */',
  'export const COUNTRY_CENTROIDS: Readonly<Record<string, readonly [number, number]>> = ' +
    JSON.stringify(centroids, null, 0).replace(/\],"/g, '],\n"').replace(/^\{/, '{\n').replace(/\}$/, '\n}') +
    ';',
  '',
  '/** Tracé SVG (projection équirectangulaire) de chaque pays. */',
  'export const COUNTRY_PATHS: Readonly<Record<string, string>> = ' +
    JSON.stringify(paths, null, 0).replace(/","/g, '",\n"').replace(/^\{/, '{\n').replace(/\}$/, '\n}') +
    ';',
  '',
  '/** Nom français de chaque pays. */',
  'export const COUNTRY_NAMES_FR: Readonly<Record<string, string>> = ' +
    JSON.stringify(labels, null, 0).replace(/","/g, '",\n"').replace(/^\{/, '{\n').replace(/\}$/, '\n}') +
    ';',
  '',
];
writeFileSync(out, lines.join('\n'));
console.log(`pays avec centre : ${Object.keys(centroids).length}, avec tracé : ${Object.keys(paths).length}`);
console.log('sans correspondance ISO :', [...unknown].join(', '));

#!/usr/bin/env node
/**
 * Exporte les jeux intégrés à l'application en jeux de code du magasin : un dossier par jeu, prêt à être
 * construit. Pour chaque jeu, la sortie contient :
 *   manifest.json, src/server.ts, src/client.tsx, src/games/… (fermeture copiée depuis packages/games/src),
 *   styles/app.css et styles/fonts/ (feuille et polices de l'application), licenses/.
 *
 * Usage : node scripts/exporter-jeux-de-code.mjs [dossier-de-sortie]   (par défaut : jeux-du-magasin/)
 * Un jeu dont la forme de vues n'est pas reconnue est signalé et ignoré, jamais deviné.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'packages/server/package.json'));
const esbuild = require('esbuild');
const SRC = path.join(ROOT, 'packages/games/src');
const REGISTRY = path.join(SRC, 'client/index.tsx');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'jeux-du-magasin'));

/** Jeu de code → module serveur (relatif à packages/games/src). Les vues viennent du registre client. */
const GAMES = {
  'quiz-party': 'quiz-party/module.ts',
  'phrases-trous': 'phrases-trous/module.ts',
  association: 'association/module.ts',
  'plutot-qui': 'plutot-qui/module.ts',
  'imposteur-parmi-nous': 'imposteur-parmi-nous/module.ts',
  'tribunal-absurde': 'tribunal-absurde/module.ts',
  'telephone-arabe': 'telephone-arabe/module.ts',
  'tennis-party': 'tennis/module.ts',
  karaoke: 'karaoke/module.ts',
  'plateau-fete': 'plateau-fete/module.ts',
  'micro-defis': 'micro-defis/module.ts',
  'gags-en-rafale': 'gags-en-rafale/module.ts',
  funambule: 'funambule/module.ts',
  'aventure-ia': 'aventure/module.ts',
  'plus-ou-moins': 'plus-ou-moins/module.ts',
  reflexe: 'reflexe/module.ts',
  'imite-moi': 'imite-moi/module.ts',
  'bombes-party': 'bombes-party/module.ts',
  banquise: 'banquise/module.ts',
  boum: 'boum/module.ts',
  promoteur: 'promoteur/module.ts',
  'loups-village': 'loups-village/module.ts',
  president: 'president/module.ts',
  'rami-51': 'rami51/module.ts',
  tarot: 'tarot/module.ts',
  'poker-texas': 'poker/module.ts',
};

/** Jeux solo : une seule fichier (solo/games.ts), un export par jeu ; vues dans soloClientViews[id]. */
const SOLO_EXPORTS = {
  sudoku: 'sudoku',
  solitaire: 'solitaire',
  taquin: 'taquin',
  'mots-croises': 'motsCroises',
};

/**
 * Jeux dont les vues sont un objet GameClientViews exporté par un index (pas de Promise.all dans le registre) :
 * client.tsx le ré-exporte tel quel.
 */
const INDEX_VIEWS = {
  president: { file: 'president/client/index.ts', name: 'presidentViews' },
  'rami-51': { file: 'rami51/client/index.ts', name: 'ramiViews' },
  tarot: { file: 'tarot/client/index.ts', name: 'tarotViews' },
  'poker-texas': { file: 'poker/client/index.ts', name: 'pokerViews' },
};

/** Extrait l'expression équilibrée qui commence à text[open] (parenthèse, crochet ou accolade). */
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error('parenthèse non fermée dans le registre');
}

/** Bloc lazyViews d'un jeu : noms importés (et leurs chemins) et valeurs Settings / Host / Player. */
function registryOf(id) {
  const src = fs.readFileSync(REGISTRY, 'utf8');
  const head = new RegExp(`^  '?${id}'?: lazyViews\\(async \\(\\) => \\{`, 'm').exec(src);
  if (!head) throw new Error('vues non reconnues (pas de Promise.all dans le registre)');
  const end = src.indexOf('\n  }),', head.index);
  const block = src.slice(head.index, end);

  const destr = /const \[([^\]]+)\] = await Promise\.all\(\[([\s\S]*?)\]\);/.exec(block);
  if (!destr) throw new Error('import groupé non reconnu');
  const names = [...destr[1].matchAll(/\{\s*(\w+)\s*\}/g)].map((m) => m[1]);
  const paths = [...destr[2].matchAll(/import\('([^']+)'\)/g)].map((m) => m[1]);
  if (names.length !== paths.length) throw new Error('noms et chemins ne correspondent pas');
  const importOf = new Map(names.map((name, i) => [name, paths[i]]));

  const ret = /return \{([\s\S]*?)\};/.exec(block);
  if (!ret) throw new Error('retour des vues non reconnu');
  const values = {};
  for (const key of ['Settings', 'Host', 'Player']) {
    const at = new RegExp(`\\b${key}:\\s*`).exec(ret[1]);
    if (!at) {
      if (key === 'Settings') continue;
      throw new Error(`« ${key} » absent du retour des vues`);
    }
    const rest = ret[1].slice(at.index + at[0].length);
    const call = /^(fieldSettings)\(/.exec(rest);
    if (call) {
      values[key] = { call: 'fieldSettings', expr: `fieldSettings${balanced(rest, call[0].length - 1)}` };
    } else {
      const ident = /^(\w+)/.exec(rest);
      if (!ident || !importOf.has(ident[1])) throw new Error(`« ${key} » : valeur non reconnue`);
      values[key] = { ident: ident[1] };
    }
  }
  return { importOf, values };
}

/** Nom exporté par le module serveur : export const X: GameModule. */
function moduleExportOf(text, file) {
  // export const X: GameModule<…> = …  ou  export const X = createXGame() : le module du jeu (pas un objet d'actions).
  const m = /export const (\w+)(?::\s*GameModule\b[^=]*=|\s*=\s*create\w+\()/.exec(text);
  if (!m) throw new Error(`export du module introuvable dans ${path.relative(ROOT, file)}`);
  return m[1];
}

/**
 * Métadonnées du jeu : bloc manifest du module, ou bloc createSoloGame de l'export `exportName` (jeux solo).
 * La version est 1.0.0 pour un jeu solo, qui n'en déclare pas.
 */
function manifestOf(text, exportName) {
  let block;
  if (exportName) {
    const start = text.indexOf(`export const ${exportName} =`);
    if (start < 0) throw new Error(`export « ${exportName} » introuvable`);
    block = text.slice(start, text.indexOf('\n});', start));
  } else {
    const start = text.indexOf('manifest:');
    if (start < 0) throw new Error('bloc manifest absent du module');
    block = text.slice(start, text.indexOf('\n  },', start));
  }
  const find = (key) => {
    const m = new RegExp(`\\b${key}:\\s*(?:'([^']*)'|(\\w+))`).exec(block);
    if (!m) return undefined;
    if (m[1] !== undefined) return m[1];
    const constant = new RegExp(`const ${m[2]} = '([^']*)'`).exec(text);
    if (!constant) throw new Error(`« ${key} » : constante ${m[2]} introuvable`);
    return constant[1];
  };
  const required = (key) => {
    const value = find(key);
    if (value === undefined) throw new Error(`« ${key} » absent du manifeste du module`);
    return value;
  };
  return {
    id: required('id'),
    name: required('name'),
    description: required('description'),
    version: find('version') ?? '1.0.0',
  };
}

/**
 * Contenu de src/client.tsx. `spec(rel)` donne le chemin d'import d'un fichier de packages/games/src (rel) :
 * relatif dans le paquet, absolu pour la mesure de fermeture.
 */
function clientSource(reg, spec) {
  const lines = [];
  const values = Object.values(reg.values);
  if (values.some((v) => v.call === 'fieldSettings')) {
    lines.push(`import { fieldSettings } from '${spec('client/settings.js')}';`);
  }
  const used = new Set(values.map((v) => v.ident).filter(Boolean));
  for (const name of used) {
    const rel = path.relative(SRC, path.resolve(SRC, 'client', reg.importOf.get(name)));
    lines.push(`import { ${name} } from '${spec(rel)}';`);
  }
  const settings = reg.values.Settings;
  const entries = [];
  const body = [];
  if (settings && settings.call) {
    body.push(`const Settings = ${settings.expr};`);
    entries.push('Settings');
  } else if (settings) {
    entries.push(`Settings: ${settings.ident}`);
  }
  entries.push(`Host: ${reg.values.Host.ident}`, `Player: ${reg.values.Player.ident}`);
  const head = lines.join('\n');
  const rest = body.length ? `${body.join('\n')}\n\n` : '\n';
  return `${head}\n\n${rest}export default { ${entries.join(', ')} };\n`;
}

/** Fichiers source de la fermeture, lus avec esbuild (sans écrire le résultat). */
async function sourcesOf(entry, platform) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform,
    format: 'esm',
    jsx: 'automatic',
    logLevel: 'silent',
    absWorkingDir: '/',
    nodePaths: [path.join(ROOT, 'node_modules')],
  });
  return Object.keys(result.metafile.inputs)
    .filter((p) => !p.includes('node_modules'))
    .map((p) => `/${p}`)
    .filter((p) => p.startsWith(SRC + path.sep));
}

function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

async function exportGame(id) {
  const solo = SOLO_EXPORTS[id];
  const moduleRel = solo ? 'solo/games.ts' : GAMES[id];
  const moduleFile = path.join(SRC, moduleRel);
  const moduleText = fs.readFileSync(moduleFile, 'utf8');
  const meta = manifestOf(moduleText, solo);
  if (meta.id !== id) throw new Error(`identifiant du module « ${meta.id} » ≠ « ${id} »`);
  const exported = solo ?? moduleExportOf(moduleText, moduleFile);
  const index = INDEX_VIEWS[id];
  const reg = index || SOLO_EXPORTS[id] ? null : registryOf(id);
  /** Texte de src/client.tsx : par registre, ou ré-export de l'objet de vues de l'index. */
  const clientText = (spec) => {
    if (solo)
      return `import { soloClientViews } from '${spec('solo/client/index.ts')}';\nexport default soloClientViews['${id}'];\n`;
    return index ? `export { ${index.name} as default } from '${spec(index.file)}';\n` : clientSource(reg, spec);
  };
  const dir = path.join(OUT, id);
  fs.rmSync(dir, { recursive: true, force: true });

  // Mesure de la fermeture : fichier temporaire à chemins absolus, supprimé aussitôt.
  fs.mkdirSync(OUT, { recursive: true });
  const probe = path.join(OUT, `.sonde-${id}.tsx`);
  fs.writeFileSync(
    probe,
    clientText((rel) => path.join(SRC, rel)),
  );
  let inputs;
  try {
    inputs = new Set([...(await sourcesOf(moduleFile, 'neutral')), ...(await sourcesOf(probe, 'browser'))]);
  } finally {
    fs.rmSync(probe, { force: true });
  }
  for (const abs of inputs) writeFile(path.join(dir, 'src', 'games', path.relative(SRC, abs)), fs.readFileSync(abs));

  writeFile(
    path.join(dir, 'src/server.ts'),
    `import { ${exported} } from './games/${moduleRel.replace(/\.ts$/, '.js')}';\n\nexport default ${exported};\n`,
  );
  writeFile(
    path.join(dir, 'src/client.tsx'),
    clientText((rel) => `./games/${rel}`),
  );
  writeFile(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        format: 'phgame',
        formatVersion: 5,
        kind: 'code',
        id,
        name: meta.name,
        version: meta.version,
        description: meta.description,
        author: 'PartyHub',
        engine: { minVersion: '0.15.0', api: 1 },
        entry: { server: 'code/server.js', client: 'code/client.js' },
        licenses: [
          { path: 'licenses/LICENSE.txt', covers: [] },
          { path: 'licenses/polices.txt', covers: [] },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFile(path.join(dir, 'styles/app.css'), fs.readFileSync(path.join(ROOT, 'packages/web/src/styles.css')));
  const fonts = path.join(ROOT, 'packages/web/public/fonts');
  for (const font of fs.readdirSync(fonts)) {
    if (font.endsWith('.woff2'))
      writeFile(path.join(dir, 'styles/fonts', font), fs.readFileSync(path.join(fonts, font)));
  }
  writeFile(path.join(dir, 'licenses/LICENSE.txt'), fs.readFileSync(path.join(ROOT, 'LICENSE')));
  writeFile(path.join(dir, 'licenses/polices.txt'), fs.readFileSync(path.join(fonts, 'LICENSES.txt')));
  return { id, files: inputs.size };
}

fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const id of [...Object.keys(GAMES), ...Object.keys(SOLO_EXPORTS)]) {
  try {
    report.push({ id, ok: true, ...(await exportGame(id)) });
  } catch (error) {
    report.push({ id, ok: false, error: error.message });
  }
}
for (const row of report) {
  console.log(
    row.ok ? `OK     ${row.id.padEnd(18)} ${row.files} fichiers source` : `ECHEC  ${row.id.padEnd(18)} ${row.error}`,
  );
}
fs.writeFileSync(path.join(OUT, 'rapport.json'), `${JSON.stringify(report, null, 2)}\n`);

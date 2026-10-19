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
  imposteur: 'imposteur/module.ts',
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
  const m = /export const (\w+): GameModule/.exec(text);
  if (!m) throw new Error(`export GameModule introuvable dans ${path.relative(ROOT, file)}`);
  return m[1];
}

/** Métadonnées lues dans le bloc manifest du module. */
function manifestOf(text) {
  const start = text.indexOf('manifest:');
  if (start < 0) throw new Error('bloc manifest absent du module');
  const block = text.slice(start, text.indexOf('\n  },', start));
  const pick = (key) => {
    const m = new RegExp(`\\b${key}:\\s*(?:'([^']*)'|(\\w+))`).exec(block);
    if (!m) throw new Error(`« ${key} » absent du manifeste du module`);
    if (m[1] !== undefined) return m[1];
    // Valeur nommée (const GAME_NAME = '…') : on lit la constante du module.
    const constant = new RegExp(`const ${m[2]} = '([^']*)'`).exec(text);
    if (!constant) throw new Error(`« ${key} » : constante ${m[2]} introuvable`);
    return constant[1];
  };
  return { id: pick('id'), name: pick('name'), description: pick('description'), version: pick('version') };
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
  const moduleRel = GAMES[id];
  const moduleFile = path.join(SRC, moduleRel);
  const moduleText = fs.readFileSync(moduleFile, 'utf8');
  const meta = manifestOf(moduleText);
  if (meta.id !== id) throw new Error(`identifiant du module « ${meta.id} » ≠ « ${id} »`);
  const exported = moduleExportOf(moduleText, moduleFile);
  const reg = registryOf(id);
  const dir = path.join(OUT, id);
  fs.rmSync(dir, { recursive: true, force: true });

  // Mesure de la fermeture : fichier temporaire à chemins absolus, supprimé aussitôt.
  fs.mkdirSync(OUT, { recursive: true });
  const probe = path.join(OUT, `.sonde-${id}.tsx`);
  fs.writeFileSync(probe, clientSource(reg, (rel) => path.join(SRC, rel).replace(/\.js$/, '.js')));
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
  writeFile(path.join(dir, 'src/client.tsx'), clientSource(reg, (rel) => `./games/${rel}`));
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
    if (font.endsWith('.woff2')) writeFile(path.join(dir, 'styles/fonts', font), fs.readFileSync(path.join(fonts, font)));
  }
  writeFile(path.join(dir, 'licenses/LICENSE.txt'), fs.readFileSync(path.join(ROOT, 'LICENSE')));
  writeFile(path.join(dir, 'licenses/polices.txt'), fs.readFileSync(path.join(fonts, 'LICENSES.txt')));
  return { id, files: inputs.size };
}

fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const id of Object.keys(GAMES)) {
  try {
    report.push({ id, ok: true, ...(await exportGame(id)) });
  } catch (error) {
    report.push({ id, ok: false, error: error.message });
  }
}
for (const row of report) {
  console.log(row.ok ? `OK     ${row.id.padEnd(18)} ${row.files} fichiers source` : `ECHEC  ${row.id.padEnd(18)} ${row.error}`);
}
fs.writeFileSync(path.join(OUT, 'rapport.json'), `${JSON.stringify(report, null, 2)}\n`);

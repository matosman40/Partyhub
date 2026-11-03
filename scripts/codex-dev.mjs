#!/usr/bin/env node
/**
 * Confie une tâche à Codex, le développeur associé, sans interface interactive (`codex exec`).
 * Claude reste chef de projet : il écrit la consigne, relit le diff et lance les contrôles.
 *
 * Usage (à la racine du dépôt, consigne sur l'entrée standard) :
 *   node scripts/codex-dev.mjs < consigne.md                  nouvelle tâche, Codex peut écrire dans le dépôt
 *   node scripts/codex-dev.mjs --lecture < question.md        Codex lit seulement (analyse, avis)
 *   node scripts/codex-dev.mjs --reprendre <id> < retour.md   même session Codex, avec ses souvenirs
 *
 * Le binaire Codex est cherché dans CODEX_BIN, puis dans le PATH, puis dans l'extension VS Code d'OpenAI.
 * Les sorties brutes vont dans le dossier temporaire du système, jamais dans le dépôt.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

function trouverCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['codex'], { encoding: 'utf8' });
  const surPath = which.status === 0 ? which.stdout.split(/\r?\n/).find((l) => /codex(\.exe)?$/i.test(l.trim())) : null;
  if (surPath) return surPath.trim();
  const extensions = join(homedir(), '.vscode', 'extensions');
  if (existsSync(extensions)) {
    const versions = readdirSync(extensions)
      .filter((d) => d.startsWith('openai.chatgpt-'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      const bin = join(extensions, v, 'bin');
      if (!existsSync(bin)) continue;
      for (const plateforme of readdirSync(bin)) {
        const exe = join(bin, plateforme, process.platform === 'win32' ? 'codex.exe' : 'codex');
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const args = process.argv.slice(2);
const lecture = args.includes('--lecture');
const iReprise = args.indexOf('--reprendre');
const reprise = iReprise >= 0 ? args[iReprise + 1] : null;
if (iReprise >= 0 && !reprise) {
  console.error('--reprendre attend l’identifiant de session donné à la fin de la tâche précédente.');
  process.exit(2);
}

const consigne = readFileSync(0, 'utf8').trim();
if (!consigne) {
  console.error('Consigne vide : passez-la sur l’entrée standard (node scripts/codex-dev.mjs < consigne.md).');
  process.exit(2);
}

const codex = trouverCodex();
if (!codex) {
  console.error('Codex introuvable. Installez le Codex CLI ou indiquez son chemin dans CODEX_BIN.');
  process.exit(2);
}

const racine = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd();
const sortie = mkdtempSync(join(tmpdir(), 'codex-dev-'));
const dernierMessage = join(sortie, 'dernier-message.md');
const evenements = join(sortie, 'evenements.jsonl');

const options = ['-c', `sandbox_mode="${lecture ? 'read-only' : 'workspace-write'}"`, '--json', '-o', dernierMessage];
const commande = reprise ? ['exec', 'resume', ...options, reprise, '-'] : ['exec', ...options, '-'];

const enfant = spawn(codex, commande, { cwd: racine, stdio: ['pipe', 'pipe', 'inherit'] });
enfant.stdin.end(consigne);

let session = reprise;
let journal = '';
let reste = '';
enfant.stdout.setEncoding('utf8');
enfant.stdout.on('data', (morceau) => {
  journal += morceau;
  const lignes = (reste + morceau).split('\n');
  reste = lignes.pop();
  for (const ligne of lignes) {
    let e;
    try {
      e = JSON.parse(ligne);
    } catch {
      continue;
    }
    if (e.type === 'thread.started') session = e.thread_id;
    // Suivi court sur stderr : ce que Codex fait, sans le détail des sorties.
    if (e.type === 'item.started' && e.item?.type === 'command_execution') {
      console.error(`[codex] $ ${e.item.command.slice(0, 160)}`);
    }
    if (e.type === 'item.completed' && e.item?.type === 'file_change') {
      const fichiers = (e.item.changes ?? []).map((c) => `${c.kind ?? ''} ${c.path}`.trim());
      console.error(`[codex] fichiers : ${fichiers.join(', ')}`);
    }
    if (e.type === 'error' || e.type === 'turn.failed') console.error(`[codex] erreur : ${ligne}`);
  }
});

enfant.on('close', (code) => {
  writeFileSync(evenements, journal);
  const message = existsSync(dernierMessage) ? readFileSync(dernierMessage, 'utf8').trim() : '(aucun message final)';
  const etat = spawnSync('git', ['status', '--short'], { cwd: racine, encoding: 'utf8' }).stdout.trim();
  console.log(`## Rapport de Codex\n\n${message}\n`);
  // Tout l'état git, y compris ce qui était déjà modifié avant la tâche.
  console.log(`## État du dépôt (git status)\n\n${etat || '(propre)'}\n`);
  console.log(
    `Session Codex : ${session ?? 'inconnue'}  (reprendre : node scripts/codex-dev.mjs --reprendre ${session ?? '<id>'})`,
  );
  console.log(`Journal complet : ${evenements}`);
  process.exit(code ?? 1);
});

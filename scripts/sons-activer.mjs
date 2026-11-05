#!/usr/bin/env node
/**
 * Active le lot de sons libres (packages/web/public/sons) sur une installation PartyHub :
 * téléverse chaque fichier dans la médiathèque, puis affecte les bruitages correspondants.
 *
 * Usage : ADMIN_PASSWORD='…' node scripts/sons-activer.mjs <adresse-de-l'installation>
 * Exemple : ADMIN_PASSWORD='…' node scripts/sons-activer.mjs http://127.0.0.1:8282
 *
 * Les sons de quiz (bonne réponse, erreur, compte à rebours) restent dans la médiathèque : il n'existe pas
 * d'emplacement de bruitage pour eux. Rien d'autre que les réglages de son n'est modifié.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
if (!BASE || !PASSWORD) {
  console.error("Usage : ADMIN_PASSWORD='…' node scripts/sons-activer.mjs <adresse-de-l'installation>");
  process.exit(2);
}

/** Fichier du lot → emplacement de bruitage (ou null : son de quiz, sans emplacement). */
const CORRESPONDANCE = {
  'clic.mp3': 'click',
  'carte.mp3': 'card',
  'explosion.mp3': 'explode',
  'victoire.mp3': 'win',
  'votre-tour.mp3': 'turn',
  'bonne-reponse.mp3': null,
  'erreur.mp3': null,
  'compte-a-rebours.mp3': null,
};

const DOSSIER = join(fileURLToPath(new URL('..', import.meta.url)), 'packages/web/public/sons');
const manifeste = JSON.parse(readFileSync(join(DOSSIER, 'SOURCES.json'), 'utf8'));

const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
});
if (!login.ok) {
  console.error('Connexion administrateur refusée.');
  process.exit(1);
}
const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
const entete = { Cookie: cookie };

const reglages = await (await fetch(`${BASE}/api/admin/sound-settings`, { headers: entete })).json();
const sons = reglages.sounds;

for (const son of manifeste) {
  const fichier = son.fichier.split('/').pop();
  const octets = readFileSync(join(DOSSIER, fichier));
  const envoi = await fetch(`${BASE}/api/admin/assets`, {
    method: 'POST',
    headers: { ...entete, 'Content-Type': 'audio/mpeg', 'x-file-name': encodeURIComponent(fichier) },
    body: octets,
  });
  const reponse = await envoi.json();
  if (!envoi.ok || !reponse.asset) {
    console.error(`Échec pour ${fichier} : ${reponse.error ?? envoi.status}`);
    continue;
  }
  const emplacement = CORRESPONDANCE[fichier];
  console.log(`${fichier} → ${emplacement ? `bruitage « ${emplacement} »` : 'médiathèque seulement'}`);
  if (emplacement) sons.sfx[emplacement] = reponse.asset.id;
}

const enregistrement = await fetch(`${BASE}/api/admin/sound-settings`, {
  method: 'PUT',
  headers: { ...entete, 'Content-Type': 'application/json' },
  body: JSON.stringify({ sounds: reglages.sounds }),
});
if (!enregistrement.ok) {
  console.error('Enregistrement des réglages refusé :', await enregistrement.text());
  process.exit(1);
}
console.log('Sons activés.');

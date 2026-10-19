/**
 * Parcours de l'éditeur des jeux de code, dans un vrai navigateur, à l'écran de l'administration :
 *   1. l'administrateur crée la clé de signature de l'installation, puis un jeu depuis le modèle ;
 *   2. il renomme le jeu et fixe sa version, vérifie le code (partie complète jouée par des robots),
 *      puis signe et envoie le jeu en revue ;
 *   3. il relit le code et approuve le jeu dans « Jeux de code ».
 *
 * Variables d'environnement :
 *   PARTYHUB_URL              adresse du serveur (défaut : http://127.0.0.1:8290)
 *   PARTYHUB_ADMIN_PASSWORD   mot de passe administrateur (obligatoire)
 *   PLAYWRIGHT                module Playwright à charger (défaut : « playwright »)
 *   CHROMIUM                  chemin d'un Chromium déjà installé (facultatif)
 *   SHOTS                     dossier des captures d'écran (facultatif)
 *
 * Le serveur doit être neuf : aucune clé de signature et aucun jeu de code. Le script échoue au premier écart,
 * et aussi sur toute erreur de page ou de console.
 */
const path = require('node:path');

const BASE = (process.env.PARTYHUB_URL || 'http://127.0.0.1:8290').replace(/\/$/, '');
const PASSWORD = required('PARTYHUB_ADMIN_PASSWORD');
const SHOTS = process.env.SHOTS;
const GAME_ID = 'editeur-essai';
const GAME_NAME = 'Essai de l’éditeur';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Variable ${name} obligatoire. Voir l'en-tête de ${path.basename(__filename)}.`);
    process.exit(2);
  }
  return value;
}

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

function watch(page, errors) {
  page.on('pageerror', (e) => errors.push(`administration : ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`administration console : ${m.text()}`));
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(page, errors);
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.locator('input[type=password]').first().press('Enter');
    await page.getByText('Créer des jeux').first().click();
    await page.waitForTimeout(800);

    // 1. Clé de signature, puis création du jeu depuis le modèle.
    await page.getByRole('heading', { name: 'Créer et modifier un jeu de code' }).scrollIntoViewIfNeeded();
    const creerCle = page.getByRole('button', { name: 'Créer la clé de signature' });
    if (await creerCle.count()) {
      await creerCle.click();
      await page.getByRole('status').filter({ hasText: 'Clé de signature créée' }).first().waitFor({ timeout: 20000 });
    }
    console.log('1. clé de signature présente');

    const nouveau = page.getByRole('form', { name: 'Nouveau jeu de code' });
    await nouveau.getByLabel('Identifiant').fill(GAME_ID);
    await nouveau.getByLabel('Nom affiché').fill(GAME_NAME);
    await nouveau.getByLabel('Auteur').fill('Test e2e');
    await nouveau.getByRole('button', { name: 'Créer un jeu depuis le modèle' }).click();
    await page.getByRole('status').filter({ hasText: 'Brouillon « ' }).first().waitFor({ timeout: 20000 });
    console.log('1. brouillon créé depuis le modèle');
    await shot(page, 'editeur-cree');

    // 2. Informations, vérification, signature : l'ordre est imposé par l'écran.
    const infos = page.getByRole('form', { name: 'Informations du jeu' });
    await infos.getByLabel('Version (X.Y.Z)').fill('0.2.0');
    await infos.getByRole('button', { name: 'Enregistrer les informations' }).click();
    await page.getByRole('status').filter({ hasText: 'Informations enregistrées' }).first().waitFor({ timeout: 20000 });

    const signer = page.getByRole('button', { name: 'Signer et envoyer en revue' });
    if (!(await signer.isDisabled())) throw new Error('signer doit rester désactivé avant une vérification réussie');
    await page.getByRole('button', { name: 'Vérifier le jeu' }).click();
    await page.getByText('Vérification : réussie').first().waitFor({ timeout: 90000 });
    console.log('2. vérification réussie (partie de robots)');
    await shot(page, 'editeur-verifie');

    if (await signer.isDisabled()) throw new Error('signer doit être disponible après une vérification réussie');
    await signer.click();
    await page.getByRole('status').filter({ hasText: 'est envoyé en revue' }).first().waitFor({ timeout: 60000 });
    console.log('2. jeu signé et envoyé en revue');

    // 3. Revue et approbation dans « Jeux de code ».
    const ligne = page.locator('li').filter({ hasText: GAME_NAME }).first();
    await ligne.getByRole('button', { name: 'Relire et approuver' }).click();
    await page.getByRole('region', { name: /Revue de/ }).waitFor({ timeout: 20000 });
    const approuver = page.getByRole('button', { name: 'Approuver et activer' });
    if (!(await approuver.isDisabled()))
      throw new Error('le bouton d’approbation doit rester désactivé avant la relecture');
    await page.getByRole('checkbox', { name: /relu ce code/ }).check();
    await approuver.click();
    await page.getByRole('status').filter({ hasText: 'est approuvé' }).first().waitFor({ timeout: 20000 });
    console.log('3. jeu approuvé');
    await shot(page, 'editeur-approuve');

    if (errors.length > 0) throw new Error(`erreurs remontées :\n  ${errors.join('\n  ')}`);
    console.log('Parcours de l’éditeur terminé sans erreur.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});

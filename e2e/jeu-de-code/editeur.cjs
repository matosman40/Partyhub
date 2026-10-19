/**
 * Parcours de l'éditeur des jeux de code, dans un vrai navigateur, à l'écran de l'administration :
 *   1. l'administrateur crée un jeu depuis le modèle ;
 *   2. il renomme le jeu et fixe sa version, puis vérifie le code (partie complète jouée par des robots) ;
 *   3. l'écran ne propose aucune signature : elle se fait hors de PartyHub, avec la clé de l'auteur. Il indique
 *      la commande et les deux moyens d'ajouter le paquet ensuite (dossier de dépôt, lien HTTPS).
 *
 * Variables d'environnement :
 *   PARTYHUB_URL              adresse du serveur (défaut : http://127.0.0.1:8290)
 *   PARTYHUB_ADMIN_PASSWORD   mot de passe administrateur (obligatoire)
 *   PLAYWRIGHT                module Playwright à charger (défaut : « playwright »)
 *   CHROMIUM                  chemin d'un Chromium déjà installé (facultatif)
 *   SHOTS                     dossier des captures d'écran (facultatif)
 *
 * Le script échoue au premier écart, et aussi sur toute erreur de page ou de console.
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

    // 0. Aucune clé de signature n'est proposée dans PartyHub.
    await page.getByRole('heading', { name: 'Créer et modifier un jeu de code' }).scrollIntoViewIfNeeded();
    if (await page.getByRole('button', { name: /clé de signature/ }).count()) {
      throw new Error('l’éditeur ne doit proposer aucune clé de signature');
    }
    console.log('0. aucune clé de signature proposée');

    // 1. Création du jeu depuis le modèle.
    const nouveau = page.getByRole('form', { name: 'Nouveau jeu de code' });
    await nouveau.getByLabel('Identifiant').fill(GAME_ID);
    await nouveau.getByLabel('Nom affiché').fill(GAME_NAME);
    await nouveau.getByLabel('Auteur').fill('Test e2e');
    await nouveau.getByRole('button', { name: 'Créer un jeu depuis le modèle' }).click();
    await page.getByRole('status').filter({ hasText: 'Brouillon « ' }).first().waitFor({ timeout: 20000 });
    console.log('1. brouillon créé depuis le modèle');
    await shot(page, 'editeur-cree');

    // 2. Informations, puis vérification. Avant la vérification, rien n'invite encore à signer.
    const infos = page.getByRole('form', { name: 'Informations du jeu' });
    await infos.getByLabel('Version (X.Y.Z)').fill('0.2.0');
    await infos.getByRole('button', { name: 'Enregistrer les informations' }).click();
    await page.getByRole('status').filter({ hasText: 'Informations enregistrées' }).first().waitFor({ timeout: 20000 });

    if (await page.getByText('La vérification est réussie').count()) {
      throw new Error('la consigne de signature ne doit pas apparaître avant une vérification réussie');
    }
    await page.getByRole('button', { name: 'Vérifier le jeu' }).click();
    await page.getByText('Vérification : réussie').first().waitFor({ timeout: 90000 });
    console.log('2. vérification réussie (partie de robots)');
    await shot(page, 'editeur-verifie');

    // 3. Après la vérification : la commande de signature hors de PartyHub, et le moyen de déposer le paquet.
    await page.getByText('La vérification est réussie').first().waitFor({ timeout: 20000 });
    await page.getByText(`phgame pack DATA_DIR/jeux-en-cours/${GAME_ID}`).first().waitFor({ timeout: 20000 });
    if (await page.getByRole('button', { name: /Signer et envoyer en revue/ }).count()) {
      throw new Error('le bouton « Signer et envoyer en revue » ne doit plus exister');
    }
    console.log('3. consigne de signature hors de PartyHub affichée');

    // 4. L'ajout de paquets est visible dans « Jeux de code » : dossier de dépôt et lien HTTPS.
    await page.getByRole('region', { name: 'Ajouter un jeu de code' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Relire le dossier maintenant' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Importer depuis ce lien' }).waitFor({ timeout: 20000 });
    console.log('4. dossier de dépôt et lien HTTPS proposés');
    await shot(page, 'editeur-ajout');

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

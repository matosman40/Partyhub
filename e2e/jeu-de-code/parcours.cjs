/**
 * Parcours de bout en bout d'un jeu de code, dans un vrai navigateur :
 *   1. l'administrateur téléverse le .phgame, relit le code, coche la case et approuve ;
 *   2. l'hôte crée une salle, deux téléphones la rejoignent ;
 *   3. la partie est lancée et les téléphones jouent trois manches (« Pile » / « Face ») ;
 *   4. la TV affiche « Fin de partie », et aucune erreur de page ou console n'a été remontée.
 *
 * Variables d'environnement :
 *   PARTYHUB_URL              adresse du serveur (défaut : http://127.0.0.1:8290)
 *   PARTYHUB_ADMIN_PASSWORD   mot de passe administrateur, celui de ADMIN_PASSWORD (obligatoire)
 *   PHGAME                    chemin du .phgame à installer (obligatoire)
 *   GAME_ID                   identifiant du jeu contenu dans le paquet (obligatoire)
 *   PLAYWRIGHT                module Playwright à charger (défaut : « playwright »)
 *   CHROMIUM                  chemin d'un Chromium déjà installé (facultatif)
 *   SHOTS                     dossier des captures d'écran (facultatif)
 *
 * Les étapes de jeu suivent le modèle « pile ou face » (`phgame new`). Un autre jeu demande
 * d'adapter les textes attendus et les choix des téléphones.
 */
const path = require('node:path');

const BASE = (process.env.PARTYHUB_URL || 'http://127.0.0.1:8290').replace(/\/$/, '');
const PASSWORD = required('PARTYHUB_ADMIN_PASSWORD');
const PHGAME = required('PHGAME');
const GAME_ID = required('GAME_ID');
const SHOTS = process.env.SHOTS;

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
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

function watch(page, who, errors) {
  page.on('pageerror', (e) => errors.push(`${who} : ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${who} console : ${m.text()}`));
}

async function administrer(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, 'administration', errors);
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.locator('input[type=password]').first().press('Enter');
  await page.getByText('Créer des jeux').first().click();
  await page.waitForTimeout(800);
  await page.locator('input[type=file][accept*="phgame"]').first().setInputFiles(PHGAME);
  await page.getByText('Jeu de code reçu').first().waitFor({ timeout: 20000 });
  console.log('1. paquet téléversé, en attente de revue');

  await page.getByText('Jeux de code', { exact: false }).last().scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Relire et approuver' }).first().click();
  await page.getByRole('region', { name: /Revue de/ }).waitFor({ timeout: 20000 });
  await shot(page, 'admin-revue');

  const approuver = page.getByRole('button', { name: 'Approuver et activer' });
  if (!(await approuver.isDisabled())) throw new Error('le bouton d’approbation doit rester désactivé avant la relecture');
  await page.getByRole('checkbox', { name: /relu ce code/ }).check();
  await approuver.click();
  await page.getByRole('status').filter({ hasText: 'est approuvé' }).first().waitFor({ timeout: 20000 });
  console.log('2. jeu approuvé');
  await shot(page, 'admin-approuve');
  await page.close();
}

async function jouer(browser, errors) {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostCtx.newPage();
  watch(host, 'hôte', errors);
  await host.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const created = await host.evaluate(async (gameId) => {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, practice: false }),
    });
    return res.json();
  }, GAME_ID);
  await host.evaluate(([c, t]) => sessionStorage.setItem(`ph:host:${c}`, t), [created.code, created.hostToken]);
  await host.goto(`${BASE}/tv/${created.code}`, { waitUntil: 'networkidle' });
  console.log(`3. salle ${created.code} créée`);

  const phones = {};
  for (const name of ['Ana', 'Ben']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    watch(page, `téléphone ${name}`, errors);
    await page.goto(`${BASE}/j/${created.code}`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox').first().fill(name);
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await page.getByRole('button', { name: 'Entrer dans la salle', exact: true }).click();
    phones[name] = page;
  }
  await host.getByText('Ana').first().waitFor({ timeout: 20000 });
  console.log('4. deux téléphones dans la salle');

  await host.getByRole('button', { name: 'Lancer la partie' }).click();
  const tv = host.frameLocator('iframe[title="Écran du jeu"]');
  await tv.getByText('Manche 1 sur 3').waitFor({ timeout: 20000 });
  console.log('5. la TV affiche la manche 1');
  await shot(host, 'tv-manche-1');

  const choix = ['Pile', 'Face'];
  for (let manche = 1; manche <= 3; manche++) {
    let i = 0;
    for (const name of ['Ana', 'Ben']) {
      const bouton = phones[name]
        .frameLocator('iframe[title="Écran du téléphone"]')
        .getByRole('button', { name: choix[i++ % 2] });
      await bouton.waitFor({ timeout: 20000 });
      await bouton.click();
    }
    console.log(`6. manche ${manche} jouée`);
    if (manche < 3) await tv.getByText(`Manche ${manche + 1} sur 3`).waitFor({ timeout: 30000 });
  }
  await tv.getByText('Fin de partie').waitFor({ timeout: 30000 });
  console.log('7. partie terminée : « Fin de partie » à l’écran');
  await shot(host, 'tv-fin');
  await shot(phones.Ana, 'telephone-fin');
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    args: ['--no-sandbox'],
  });
  const errors = [];
  try {
    await administrer(browser, errors);
    await jouer(browser, errors);
  } finally {
    await browser.close();
  }
  if (errors.length > 0) {
    console.error('Erreurs dans le navigateur :\n' + errors.slice(0, 20).join('\n'));
    process.exit(1);
  }
  console.log('OK : parcours complet, sans erreur de page ni de console.');
})().catch((err) => {
  console.error(`ÉCHEC : ${err.message}`);
  process.exit(1);
});

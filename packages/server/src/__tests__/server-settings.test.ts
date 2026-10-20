import { afterAll, describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { SecretBox } from '../ai/secrets.js';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import {
  ServerSettingsService,
  checkShape,
  parseOverrides,
  readSavedOverrides,
  resolveBootEnv,
  settingDef,
  SERVER_SETTINGS_KEY,
} from '../server-settings.js';

function memoryStore() {
  const kv = new Map<string, string>();
  return {
    kv,
    getKv: (key: string) => kv.get(key),
    setKv: (key: string, value: string) => void kv.set(key, value),
  };
}

const def = (env: string) => settingDef(env)!;

const keyDir = mkdtempSync(path.join(os.tmpdir(), 'ph-reglages-cle-'));
const box = new SecretBox(path.join(keyDir, 'settings-secret.key'));
afterAll(() => rmSync(keyDir, { recursive: true, force: true }));

describe('valeurs des réglages', () => {
  it('accepte les entiers dans leur plage, et refuse le reste', () => {
    expect(checkShape(def('LOG_FILES'), ' 8 ')).toEqual({ ok: true, value: '8' });
    expect(checkShape(def('LOG_FILES'), '0').ok).toBe(false);
    expect(checkShape(def('LOG_FILES'), '2,5').ok).toBe(false);
  });

  it('accepte seulement les choix proposés et les oui/non', () => {
    expect(checkShape(def('LOG_LEVEL'), 'debug').ok).toBe(true);
    expect(checkShape(def('LOG_LEVEL'), 'verbeux').ok).toBe(false);
    expect(checkShape(def('COOKIE_SECURE'), 'true').ok).toBe(true);
    expect(checkShape(def('COOKIE_SECURE'), 'oui').ok).toBe(false);
  });

  it('exige un mot de passe administrateur d’au moins 8 caractères, sans espace', () => {
    expect(checkShape(def('ADMIN_PASSWORD'), 'court').ok).toBe(false);
    expect(checkShape(def('ADMIN_PASSWORD'), 'deux mots ici').ok).toBe(false);
    expect(checkShape(def('ADMIN_PASSWORD'), 'motdepasse-long').ok).toBe(true);
  });

  it('une valeur vide signifie « rétablir » : elle est acceptée telle quelle', () => {
    expect(checkShape(def('GITHUB_TOKEN'), '   ')).toEqual({ ok: true, value: '' });
  });

  it('un secret refusé ne se retrouve jamais dans le message', () => {
    const result = checkShape(def('GITHUB_TOKEN'), 'ghp_secret valeur');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain('ghp_secret');
  });
});

describe('réglages enregistrés', () => {
  it('ne garde que les réglages connus et bien formés', () => {
    const raw = JSON.stringify({ LOG_FILES: '4', LOG_LEVEL: 'inconnu', INCONNU: '1', DB_BACKUP_KEEP: 9 });
    expect(parseOverrides(raw, box)).toEqual({ LOG_FILES: '4' });
    expect(parseOverrides('pas du json', box)).toEqual({});
    expect(parseOverrides(undefined, box)).toEqual({});
  });

  it('lit les réglages gardés dans une base existante, sans la migrer', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ph-reglages-'));
    try {
      const file = path.join(dir, 'partyhub.db');
      const store = new Store(file);
      store.setKv(SERVER_SETTINGS_KEY, JSON.stringify({ LOG_FILES: '3' }));
      store.close();
      expect(readSavedOverrides(file, box)).toEqual({ LOG_FILES: '3' });
      expect(readSavedOverrides(path.join(dir, 'absente.db'), box)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('démarre avec les réglages enregistrés, qui remplacent le fichier .env', () => {
    const boot = resolveBootEnv({ LOG_FILES: '6' }, { LOG_FILES: '3' });
    expect(boot.env.LOG_FILES).toBe('3');
    expect(boot.error).toBeNull();
  });

  it('revient au fichier .env si la combinaison enregistrée casse la configuration', () => {
    const boot = resolveBootEnv({ TRUST_PROXY: 'loopback' }, { TRUST_PROXY: 'n’importe quoi' });
    expect(boot.env.TRUST_PROXY).toBe('loopback');
    expect(boot.overrides).toEqual({});
    expect(boot.error).toMatch(/TRUST_PROXY/);
  });
});

describe('service des réglages', () => {
  const services: ServerSettingsService[] = [];
  afterEach(() => services.splice(0));

  function service(baseEnv: NodeJS.ProcessEnv = {}, booted: Record<string, string> = {}) {
    const store = memoryStore();
    const svc = new ServerSettingsService(store, { baseEnv, booted, box });
    services.push(svc);
    return { svc, store };
  }

  it('enregistre une valeur, la signale comme à redémarrer, puis la rétablit', () => {
    const { svc, store } = service({ LOG_FILES: '6' });
    expect(svc.set('LOG_FILES', '4')).toEqual({ ok: true, action: 'set' });
    expect(JSON.parse(store.kv.get(SERVER_SETTINGS_KEY)!)).toEqual({ LOG_FILES: '4' });
    const view = svc.list();
    expect(view.pendingRestart).toBe(true);
    expect(view.settings.find((s) => s.env === 'LOG_FILES')).toMatchObject({ value: '4', source: 'app' });

    expect(svc.set('LOG_FILES', '')).toEqual({ ok: true, action: 'reset' });
    expect(svc.list().settings.find((s) => s.env === 'LOG_FILES')).toMatchObject({ value: '6', source: 'fichier' });
  });

  it('n’envoie jamais la valeur d’un secret, seulement s’il est défini', () => {
    const { svc } = service({ GITHUB_TOKEN: 'ghp_depuis_le_fichier' });
    svc.set('CLOUDFLARE_API_TOKEN', 'cf_token_saisi');
    const json = JSON.stringify(svc.list());
    expect(json).not.toContain('ghp_depuis_le_fichier');
    expect(json).not.toContain('cf_token_saisi');
    const github = svc.list().settings.find((s) => s.env === 'GITHUB_TOKEN');
    expect(github).toMatchObject({ value: null, configured: true, source: 'fichier' });
  });

  it('chiffre les secrets dans la base, et les relit correctement', () => {
    const store = memoryStore();
    const svc = new ServerSettingsService(store, { baseEnv: {}, booted: {}, box });
    svc.set('GITHUB_TOKEN', 'ghp_valeur_secrete_0001');
    expect(store.kv.get(SERVER_SETTINGS_KEY)).not.toContain('ghp_valeur_secrete_0001');
    expect(new ServerSettingsService(store, { baseEnv: {}, booted: {}, box }).saved()).toEqual({
      GITHUB_TOKEN: 'ghp_valeur_secrete_0001',
    });
  });

  it('un secret chiffré avec une autre clé est ignoré, sans faire échouer', () => {
    const other = new SecretBox(path.join(keyDir, 'autre.key'));
    const store = memoryStore();
    new ServerSettingsService(store, { baseEnv: {}, booted: {}, box: other }).set('GITHUB_TOKEN', 'ghp_autre_cle_0002');
    expect(new ServerSettingsService(store, { baseEnv: {}, booted: {}, box }).saved()).toEqual({});
  });

  it('refuse une valeur inconnue ou mal formée, sans rien enregistrer', () => {
    const { svc, store } = service();
    expect(svc.set('INCONNU', '1')).toMatchObject({ ok: false, status: 404 });
    expect(svc.set('LOG_FILES', 'beaucoup')).toMatchObject({ ok: false, status: 400 });
    expect(store.kv.has(SERVER_SETTINGS_KEY)).toBe(false);
  });

  it('refuse une combinaison qui empêcherait le démarrage', () => {
    const { svc, store } = service();
    const result = svc.set('TRUST_PROXY', '10.0.0.1/99');
    expect(result.ok).toBe(false);
    expect(store.kv.has(SERVER_SETTINGS_KEY)).toBe(false);
  });

  it('n’est en attente de redémarrage que tant que la valeur enregistrée diffère de celle du démarrage', () => {
    const store = memoryStore();
    const before = new ServerSettingsService(store, { baseEnv: {}, booted: {}, box });
    expect(before.pendingRestart()).toBe(false);
    before.set('LOG_FILES', '4');
    expect(before.pendingRestart()).toBe(true);

    // Après redémarrage, le serveur démarre avec la valeur enregistrée : plus rien n’attend.
    const after = new ServerSettingsService(store, { baseEnv: {}, booted: { LOG_FILES: '4' }, box });
    expect(after.pendingRestart()).toBe(false);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { writeZip, type ZipFileEntry } from '../packages/zip.js';
import { packIdFromName, pngSize, validateCharacterPack } from '../characters/packs.js';

/**
 * Packs de personnages : import d'un zip par l'administration, validation, lecture publique,
 * et choix dans le profil (un pack inconnu est refusé).
 */

const PASSWORD = 'test-password-123';
let server: PartyServer;
let base: string;
let cookie: string;
const uniq = () => randomUUID().slice(0, 8).replace(/-/g, '');
const enc = (text: string) => new TextEncoder().encode(text);

/** En-tête PNG complet (signature + IHDR) : suffisant pour contrôler les dimensions. */
function tinyPng(width: number, height: number): Uint8Array {
  const data = new Uint8Array(33);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(data.buffer);
  view.setUint32(8, 13);
  data.set(enc('IHDR'), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

/** Planches conformes au format : mêmes dimensions que le JSON annonce. */
const ATLAS = {
  visages: {
    cell: { w: 67, h: 70 },
    cols: 4,
    rows: 2,
    names: ['neutre', 'contente', 'tres_joyeuse', 'fachee', 'colere', 'triste', 'surprise', 'clin_doeil'],
  },
  poses: {
    cell: { w: 55, h: 68 },
    cols: 4,
    rows: 2,
    names: ['repos', 'coucou', 'joie', 'colere', 'triste', 'victoire', 'defaite', 'fachee'],
  },
  marche: { cell: { w: 52, h: 64 }, cols: 4, rows: 3, names: Array.from({ length: 12 }, (_, i) => `marche${i}`) },
} as const;

function atlasJson(atlas: keyof typeof ATLAS, overrides: Record<string, unknown> = {}) {
  const spec = ATLAS[atlas];
  const images = spec.names.map((nom, i) => {
    const col = i % spec.cols;
    const row = Math.floor(i / spec.cols);
    return {
      nom,
      x: col * spec.cell.w,
      y: row * spec.cell.h,
      w: spec.cell.w,
      h: spec.cell.h,
      pivot: { x: Math.floor(spec.cell.w / 2), y: spec.cell.h - 2 },
      ligne: row,
      colonne: col,
      vide: false,
    };
  });
  return enc(
    JSON.stringify({
      source: 'source.png',
      cellule: spec.cell,
      colonnes: spec.cols,
      lignes: spec.rows,
      images,
      ...overrides,
    }),
  );
}

function atlasPng(atlas: keyof typeof ATLAS, width?: number, height?: number) {
  const spec = ATLAS[atlas];
  return tinyPng(width ?? spec.cell.w * spec.cols, height ?? spec.cell.h * spec.rows);
}

/** Pack complet et valide, dans un dossier racine comme le zip réel. */
function packEntries(overrides: Partial<Record<string, Uint8Array>> = {}): ZipFileEntry[] {
  const base: Record<string, Uint8Array> = {
    'PartyHub-sprites/json/visages.json': atlasJson('visages'),
    'PartyHub-sprites/atlas/visages.png': atlasPng('visages'),
    'PartyHub-sprites/json/poses.json': atlasJson('poses'),
    'PartyHub-sprites/atlas/poses.png': atlasPng('poses'),
    'PartyHub-sprites/json/marche.json': atlasJson('marche'),
    'PartyHub-sprites/atlas/marche.png': atlasPng('marche'),
    'PartyHub-sprites/README.md': enc('# Notes'),
    'PartyHub-sprites/sources/source.PNG': tinyPng(10, 10),
  };
  const merged = { ...base, ...overrides };
  return Object.entries(merged)
    .filter(([, data]) => data !== undefined)
    .map(([name, data]) => ({ name, data: data as Uint8Array }));
}

function zipOf(entries: ZipFileEntry[]): Uint8Array {
  return writeZip(entries);
}

async function adminImport(zip: Uint8Array, query: string) {
  return fetch(`${base}/api/admin/character-packs?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip', cookie },
    body: zip as unknown as BodyInit,
  });
}

beforeAll(async () => {
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/tmp/partyhub-tests',
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: PASSWORD,
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server.close();
});

describe('identifiant et en-tête PNG', () => {
  it('dérive un identifiant lisible du nom', () => {
    expect(packIdFromName('Dewi Sri')).toBe('dewi-sri');
    expect(packIdFromName('Léa — fille !')).toBe('lea-fille');
  });

  it('lit les dimensions dans l’en-tête IHDR et refuse le reste', () => {
    expect(pngSize(tinyPng(268, 140))).toEqual({ width: 268, height: 140 });
    expect(pngSize(enc('pas une image du tout, vraiment'))).toBeNull();
  });
});

describe('validation d’un pack', () => {
  it('accepte un pack complet dans un dossier racine', () => {
    const result = validateCharacterPack(zipOf(packEntries()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.atlases).sort()).toEqual(['marche', 'poses', 'visages']);
      expect(result.atlases.visages?.meta.images[0]).toMatchObject({ name: 'neutre', x: 0, y: 0, w: 67, h: 70 });
    }
  });

  it('accepte un pack sans marche (facultatif)', () => {
    const entries = packEntries().filter((e) => !e.name.includes('marche'));
    const result = validateCharacterPack(zipOf(entries));
    expect(result.ok).toBe(true);
  });

  it('refuse un pack sans planche de poses', () => {
    const entries = packEntries().filter((e) => !e.name.includes('poses'));
    const result = validateCharacterPack(zipOf(entries));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('poses');
  });

  it('refuse une image dont les dimensions ne correspondent pas au JSON', () => {
    const entries = packEntries({ 'PartyHub-sprites/atlas/poses.png': tinyPng(200, 136) });
    const result = validateCharacterPack(zipOf(entries));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('220 × 136');
  });

  it('refuse une case qui sort de l’image', () => {
    const bad = JSON.parse(new TextDecoder().decode(atlasJson('visages')));
    bad.images[0].x = 240;
    const entries = packEntries({ 'PartyHub-sprites/json/visages.json': enc(JSON.stringify(bad)) });
    const result = validateCharacterPack(zipOf(entries));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('hors de l’image');
  });

  it('refuse l’absence de la case obligatoire « neutre »', () => {
    const bad = JSON.parse(new TextDecoder().decode(atlasJson('visages')));
    bad.images = bad.images.filter((i: { nom: string }) => i.nom !== 'neutre');
    const entries = packEntries({ 'PartyHub-sprites/json/visages.json': enc(JSON.stringify(bad)) });
    const result = validateCharacterPack(zipOf(entries));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('« neutre » est obligatoire');
  });

  it('accepte les entrées de dossier créées par Finder ou l’Explorateur', () => {
    const entries = [
      { name: 'PartyHub-sprites/', data: new Uint8Array() },
      { name: 'PartyHub-sprites/json/', data: new Uint8Array() },
      ...packEntries(),
    ];
    const result = validateCharacterPack(zipOf(entries));
    expect(result.ok).toBe(true);
  });

  it('refuse un chemin qui remonte hors de l’archive', () => {
    const entries = [...packEntries(), { name: 'PartyHub-sprites/../../evil.json', data: enc('{}') }];
    const result = validateCharacterPack(zipOf(entries));
    expect(result.ok).toBe(false);
  });

  it('refuse un fichier qui n’est pas un zip', () => {
    const result = validateCharacterPack(enc('ceci n’est pas une archive, juste du texte'));
    expect(result.ok).toBe(false);
  });
});

describe('import par l’administration', () => {
  it('refuse sans l’accord de la personne représentée', async () => {
    const res = await adminImport(zipOf(packEntries()), `nom=${encodeURIComponent('Sans accord ' + uniq())}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('accord');
  });

  it('refuse sans session administrateur', async () => {
    const res = await fetch(`${base}/api/admin/character-packs?nom=Test&confirme=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zipOf(packEntries()) as unknown as BodyInit,
    });
    expect(res.status).toBe(401);
  });

  it('crée un personnage avec son look Standard, le liste, sert les planches, puis le supprime', async () => {
    const name = `Dewi Sri ${uniq()}`;
    const id = packIdFromName(name);
    const res = await adminImport(zipOf(packEntries()), `nom=${encodeURIComponent(name)}&confirme=1`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      pack: { id: string; looks: { id: string; name: string; atlases: Record<string, { width: number }> }[] };
      createdPack: boolean;
    };
    expect(body.pack.id).toBe(id);
    expect(body.createdPack).toBe(true);
    expect(body.pack.looks.map((l) => l.id)).toEqual(['standard']);
    expect(body.pack.looks[0]?.atlases.poses?.width).toBe(220);

    const list = (await (await fetch(`${base}/api/character-packs`)).json()) as { packs: { id: string }[] };
    expect(list.packs.map((p) => p.id)).toContain(id);

    const png = await fetch(`${base}/api/character-packs/${id}/looks/standard/atlas/visages.png`);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await png.arrayBuffer()).slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));

    const missing = await fetch(`${base}/api/character-packs/${id}/looks/standard/atlas/../../secret.png`);
    expect(missing.status).not.toBe(200);

    const again = await adminImport(zipOf(packEntries()), `nom=${encodeURIComponent(name)}&confirme=1`);
    expect(again.status).toBe(409);

    const del = await fetch(`${base}/api/admin/character-packs/${id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(200);
    const gone = await fetch(`${base}/api/character-packs/${id}/looks/standard/atlas/visages.png`);
    expect(gone.status).toBe(404);
  });

  it('ajoute un look à un personnage existant, puis retire les looks un à un', async () => {
    const name = `Look ${uniq()}`;
    const id = packIdFromName(name);
    const first = await adminImport(zipOf(packEntries()), `nom=${encodeURIComponent(name)}&confirme=1`);
    expect(first.status).toBe(201);

    const second = await adminImport(
      zipOf(packEntries()),
      `pack=${encodeURIComponent(id)}&look=${encodeURIComponent('Fête')}&confirme=1`,
    );
    expect(second.status).toBe(201);
    const added = (await second.json()) as {
      createdPack: boolean;
      look: { id: string; name: string };
      pack: { looks: { id: string }[] };
    };
    expect(added.createdPack).toBe(false);
    expect(added.look).toMatchObject({ id: 'fete', name: 'Fête' });
    expect(added.pack.looks.map((l) => l.id)).toEqual(['standard', 'fete']);

    const png = await fetch(`${base}/api/character-packs/${id}/looks/fete/atlas/poses.png`);
    expect(png.status).toBe(200);

    const dup = await adminImport(zipOf(packEntries()), `pack=${encodeURIComponent(id)}&look=Fete&confirme=1`);
    expect(dup.status).toBe(409);

    const unknownPack = await adminImport(zipOf(packEntries()), `pack=inconnu-xyz&look=Autre&confirme=1`);
    expect(unknownPack.status).toBe(404);

    const removeFete = await fetch(`${base}/api/admin/character-packs/${id}/looks/fete`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(removeFete.status).toBe(200);
    expect(((await removeFete.json()) as { removedPack: boolean }).removedPack).toBe(false);

    const removeStandard = await fetch(`${base}/api/admin/character-packs/${id}/looks/standard`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(((await removeStandard.json()) as { removedPack: boolean }).removedPack).toBe(true);
    const list = (await (await fetch(`${base}/api/character-packs`)).json()) as { packs: { id: string }[] };
    expect(list.packs.map((p) => p.id)).not.toContain(id);
  });

  it('renvoie les problèmes de validation sans rien enregistrer', async () => {
    const name = `Cassé ${uniq()}`;
    const res = await adminImport(
      zipOf(packEntries({ 'PartyHub-sprites/atlas/poses.png': tinyPng(10, 10) })),
      `nom=${encodeURIComponent(name)}&confirme=1`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: string[] };
    expect(body.issues.length).toBeGreaterThan(0);
    const list = (await (await fetch(`${base}/api/character-packs`)).json()) as { packs: { id: string }[] };
    expect(list.packs.map((p) => p.id)).not.toContain(packIdFromName(name));
  });
});

describe('choix du personnage et de son look dans le profil', () => {
  async function registerAndToken() {
    const username = `pack${uniq()}`.slice(0, 20);
    const reg = await fetch(`${base}/api/profiles/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'motdepasse1', displayName: 'Pack' }),
    });
    const { token } = (await reg.json()) as { token: string };
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  }

  it('accepte un personnage et un look existants, et refuse les autres', async () => {
    const name = `Léa ${uniq()}`;
    const id = packIdFromName(name);
    const imported = await adminImport(zipOf(packEntries()), `nom=${encodeURIComponent(name)}&confirme=1`);
    expect(imported.status).toBe(201);
    await adminImport(zipOf(packEntries()), `pack=${id}&look=Fete&confirme=1`);
    const headers = await registerAndToken();
    const character = { body: 1, skin: 0, hair: 0, hairColor: 0, accessory: 0 };
    const put = (body: Record<string, unknown>) =>
      fetch(`${base}/api/profiles/me`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ avatarCharacter: { ...character, ...body } }),
      });

    const ok = await put({ pack: id, look: 'fete' });
    expect(ok.status).toBe(200);
    const profile = (await ok.json()) as { profile: { avatar: { character: { pack?: string; look?: string } } } };
    expect(profile.profile.avatar.character).toMatchObject({ pack: id, look: 'fete' });

    expect((await put({ pack: id, look: 'inconnu' })).status).toBe(400);
    expect((await put({ pack: null, look: 'fete' })).status).toBe(400);
    expect((await put({ pack: 'nexiste-pas' })).status).toBe(400);
    expect((await put({})).status).toBe(200);

    await fetch(`${base}/api/admin/character-packs/${id}`, { method: 'DELETE', headers: { cookie } });
  });
});

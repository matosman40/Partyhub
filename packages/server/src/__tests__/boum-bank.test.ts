import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BANK_TYPES, BANK_TYPE_INFO, currentBoumBank, setBoumBank, type BankType, type Level } from '@partyhub/games';
import { BoumBankService, LOW_STOCK_THRESHOLD } from '../boum/service.js';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, Store } from '../db/store.js';

/** Banque BOUM ! : amorce, validation, import/export et migration. */

const LEVEL_PAIRS = BANK_TYPES.reduce((n, type) => n + (BANK_TYPE_INFO[type].limitAllowed ? 3 : 2), 0);

let stores: Store[] = [];
let dirs: string[] = [];

function freshStore(): Store {
  const store = new Store(':memory:');
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores) store.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  stores = [];
  dirs = [];
  setBoumBank({ entries: [] });
});

describe('Amorce', () => {
  it('insère 10 entrées par type et par niveau, toutes en a_valider', () => {
    const store = freshStore();
    new BoumBankService(store);
    const rows = store.listBoumEntries();
    expect(rows).toHaveLength(LEVEL_PAIRS * 10);
    expect(rows.every((r) => r.status === 'a_valider')).toBe(true);
    for (const type of BANK_TYPES) {
      for (const level of ['doux', 'corse'] as Level[]) {
        expect(rows.filter((r) => r.type === type && r.level === level)).toHaveLength(10);
      }
      const limite = rows.filter((r) => r.type === type && r.level === 'limite').length;
      expect(limite).toBe(BANK_TYPE_INFO[type].limitAllowed ? 10 : 0);
    }
  });

  it('n’est insérée qu’une fois, même après un nouveau démarrage', () => {
    const store = freshStore();
    new BoumBankService(store);
    const first = store.listBoumEntries().length;
    new BoumBankService(store);
    expect(store.listBoumEntries().length).toBe(first);
  });

  it('ne rend rien tirable tant que rien n’est validé', () => {
    const store = freshStore();
    new BoumBankService(store);
    expect(currentBoumBank().entries).toHaveLength(0);
  });
});

describe('Validation et statuts', () => {
  it('une entrée validée entre dans l’instantané, et seule celle-là', () => {
    const store = freshStore();
    const service = new BoumBankService(store);
    const one = store.listBoumEntries({ type: 'metier', level: 'doux' })[0]!;
    service.setStatus([one.id], 'valide');
    const snapshot = currentBoumBank().entries;
    expect(snapshot.map((e) => e.id)).toEqual([one.id]);
  });

  it('modifier le texte d’une entrée validée la repasse en a_valider et la retire du tirage', () => {
    const store = freshStore();
    const service = new BoumBankService(store);
    const one = store.listBoumEntries({ type: 'metier', level: 'doux' })[0]!;
    service.setStatus([one.id], 'valide');
    const edited = service.update(one.id, { type: 'metier', level: 'doux', text: 'Pompier volontaire' });
    expect(edited.ok).toBe(true);
    expect(store.getBoumEntry(one.id)?.status).toBe('a_valider');
    expect(currentBoumBank().entries).toHaveLength(0);
  });

  it('la suppression est douce : l’entrée reste, et ne peut plus être modifiée sans restauration', () => {
    const store = freshStore();
    const service = new BoumBankService(store);
    const one = store.listBoumEntries({ type: 'metier', level: 'doux' })[0]!;
    service.setStatus([one.id], 'retire', 'hors sujet');
    expect(store.getBoumEntry(one.id)?.status).toBe('retire');
    expect(store.getBoumEntry(one.id)?.reason).toBe('hors sujet');
    const result = service.update(one.id, { type: 'metier', level: 'doux', text: 'Autre texte' });
    expect(result.ok).toBe(false);
  });

  it('refuse les noms interdits, le HTML et les doublons normalisés', () => {
    const service = new BoumBankService(freshStore());
    expect(service.create({ type: 'metier', level: 'doux', text: 'Monopoly' }).ok).toBe(false);
    expect(service.create({ type: 'metier', level: 'doux', text: '<b>gras</b>' }).ok).toBe(false);
    expect(service.create({ type: 'metier', level: 'doux', text: 'Plombière astucieuse' }).ok).toBe(true);
    expect(service.create({ type: 'metier', level: 'doux', text: 'PLOMBIÈRE  astucieuse ' }).ok).toBe(false);
  });

  it('signale les types sous le seuil de stock', () => {
    const counts = new BoumBankService(freshStore()).counts();
    expect(counts.types.find((t) => t.type === 'metier')?.toValidate).toBe(20);
    expect(counts.lowStock).toEqual(BANK_TYPES);
    expect(LOW_STOCK_THRESHOLD).toBe(8);
  });
});

describe('Import', () => {
  const SAMPLE = [
    '# Exemple',
    'metier ; doux ; dompteur de hérissons',
    'metier ; doux ; bibliothécaire ninja',
    'question_chiffre ; doux ; Distance Paris Lyon ? ; 390',
    'question_chiffre ; doux ; Une question sans réponse',
    'pays_indice ; doux ; Sa capitale est Ottawa. ; XX',
    'phrase_trous ; doux ; Sans trou ici',
    'metier ; doux ; Monopoly',
    'metier ; doux ; dompteur de hérissons',
    'metier ; limite ; cuisinier',
    'mauvais format',
  ].join('\n');

  it('aperçu : accepte les lignes valides et signale chaque erreur avec son numéro de ligne', () => {
    const service = new BoumBankService(freshStore());
    const preview = service.previewImport(SAMPLE);
    expect(preview.fatal).toBeNull();
    expect(preview.accepted.map((c) => c.line)).toEqual([2, 3, 4]);
    // 5 : réponse absente ; 6 : code pays inconnu ; 7 : aucun trou ; 8 : nom interdit ;
    // 10 : niveau limite refusé pour ce type ; 11 : format non reconnu.
    expect(preview.rejected.map((r) => r.line)).toEqual([5, 6, 7, 8, 10, 11]);
    // 9 : doublon du texte de la ligne 2, dans le même fichier.
    expect(preview.duplicates.map((d) => d.line)).toEqual([9]);
  });

  it('import additif, en a_valider : rien n’est écrasé ni supprimé', () => {
    const store = freshStore();
    const service = new BoumBankService(store);
    const before = store.listBoumEntries().length;
    const result = service.commitImport(SAMPLE, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(3);
    expect(store.listBoumEntries().length).toBe(before + 3);
    expect(store.listBoumEntries({ status: 'valide' })).toHaveLength(0);
  });

  it('« Valider à l’import » rend les lignes tirables tout de suite', () => {
    const service = new BoumBankService(freshStore());
    service.commitImport(SAMPLE, true);
    const imported = currentBoumBank().entries.filter(
      (e) => e.text === 'dompteur de hérissons' || e.text === 'bibliothécaire ninja',
    );
    expect(imported).toHaveLength(2);
  });

  it('refuse en entier un fichier trop long, trop de lignes, un encodage cassé ou un format inconnu', () => {
    const service = new BoumBankService(freshStore());
    expect(service.previewImport('metier ; doux ; x\n'.repeat(2001)).fatal).toMatch(/2 000/);
    expect(service.previewImport('metier ; doux ; ' + 'a'.repeat(310 * 1024)).fatal).toMatch(/300 Ko/);
    expect(service.previewImport('metier ; doux ; caf�').fatal).toMatch(/Encodage/);
    expect(service.previewImport('bonjour ; tout le monde ; ceci n’est pas un fichier').fatal).toMatch(
      /Format non reconnu/,
    );
    expect(service.commitImport('bonjour\n', false).ok).toBe(false);
  });

  it('export puis import du même fichier ne crée aucun doublon', () => {
    const store = freshStore();
    const service = new BoumBankService(store);
    service.setStatus(
      store.listBoumEntries().map((r) => r.id),
      'valide',
    );
    const exported = service.exportText();
    const preview = service.previewImport(exported);
    expect(preview.accepted).toHaveLength(0);
    expect(preview.duplicates.length).toBe(LEVEL_PAIRS * 10);
  });

  it('export filtré par type ne sort que les entrées valides de ce type', () => {
    const store = freshStore();
    const service = new BoumBankService(store);
    const metiers = store.listBoumEntries({ type: 'metier' });
    service.setStatus(
      metiers.slice(0, 3).map((r) => r.id),
      'valide',
    );
    const lines = service
      .exportText({ types: ['metier'] as BankType[] })
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.startsWith('metier ; '))).toBe(true);
  });
});

describe('Migration', () => {
  it('ajoute la table des banques à une base existante, sans toucher aux données', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-boum-migration-'));
    dirs.push(dir);
    const file = join(dir, 'partyhub.db');
    const before = new Store(file, {
      migrations: MIGRATIONS.filter((m) => m.version <= 10),
      backupDir: join(dir, 'backups'),
    });
    before.setKv('marqueur', 'ancien');
    before.close();

    const after = new Store(file, { backupDir: join(dir, 'backups') });
    stores.push(after);
    expect(after.getKv('marqueur')).toBe('ancien');
    expect(after.listBoumEntries()).toEqual([]);
    expect(after.migration.from).toBe(10);
    expect(after.migration.to).toBe(LATEST_SCHEMA_VERSION);
    expect(after.migration.backup).toBeTruthy();
  });
});

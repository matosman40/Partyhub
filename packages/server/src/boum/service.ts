import { randomUUID } from 'node:crypto';
import {
  BANK_TYPES,
  duplicateKey,
  parseBankText,
  SEED_TEXT,
  serializeBankEntries,
  setBoumBank,
  validateEntry,
  type BankType,
  type CandidateInput,
  type EntryStatus,
  type ImportPreview,
  type Level,
} from '@partyhub/games';
import type { BoumEntryRow, Store } from '../db/store.js';

/**
 * Banques de contenu de BOUM ! : stockage en base, validation partagée (saisie et import),
 * recharge de l'instantané lu par les salles. Une entrée n'est tirable qu'à l'état `valide`.
 */

/** En dessous de ce nombre d'entrées valides, l'administration affiche une alerte. */
export const LOW_STOCK_THRESHOLD = 8;

/** Clé kv : l'amorce n'est insérée qu'une seule fois, même si l'administrateur retire tout. */
const SEEDED_KEY = 'boum_seeded';

export interface BoumEntryView {
  id: string;
  type: BankType;
  level: Level;
  text: string;
  answer: string | null;
  status: EntryStatus;
  reason: string | null;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface TypeCount {
  type: BankType;
  valid: number;
  toValidate: number;
  proposed: number;
  retired: number;
}

export interface ImportSummary {
  imported: number;
  validatedNow: boolean;
  rejected: ImportPreview['rejected'];
  duplicates: ImportPreview['duplicates'];
}

export type BankResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): BankResult<T> {
  return { ok: false, error };
}

function ok<T>(value: T): BankResult<T> {
  return { ok: true, value };
}

function toView(row: BoumEntryRow): BoumEntryView {
  return {
    id: row.id,
    type: row.type as BankType,
    level: row.level as Level,
    text: row.text,
    answer: row.answer,
    status: row.status as EntryStatus,
    reason: row.reason,
    authorName: row.authorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class BoumBankService {
  constructor(
    private readonly store: Store,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.seedOnce();
    this.reload();
  }

  /** Relit les entrées valides et remplace l'instantané de la banque. */
  reload(): void {
    const entries = this.store.listBoumEntries({ status: 'valide' }).map((row) => ({
      id: row.id,
      type: row.type as BankType,
      level: row.level as Level,
      text: row.text,
      answer: row.answer,
    }));
    setBoumBank({ entries });
  }

  list(filter: { type?: string; level?: string; status?: string; q?: string } = {}): BoumEntryView[] {
    return this.store.listBoumEntries(filter).map(toView);
  }

  counts(): { types: TypeCount[]; lowStock: BankType[] } {
    const rows = this.store.boumCounts();
    const of = (type: BankType, status: string) => rows.find((r) => r.type === type && r.status === status)?.count ?? 0;
    const types = BANK_TYPES.map((type) => ({
      type,
      valid: of(type, 'valide'),
      toValidate: of(type, 'a_valider'),
      proposed: of(type, 'propose'),
      retired: of(type, 'retire'),
    }));
    return { types, lowStock: types.filter((t) => t.valid < LOW_STOCK_THRESHOLD).map((t) => t.type) };
  }

  create(input: CandidateInput): BankResult<BoumEntryView> {
    const checked = validateEntry(input);
    if (!checked.ok) return fail(checked.reason);
    const { entry } = checked;
    if (this.existingKeys().has(duplicateKey(entry.type, entry.text))) {
      return fail('doublon : ce texte existe déjà pour ce type');
    }
    const at = this.clock();
    const row: BoumEntryRow = {
      id: randomUUID(),
      type: entry.type,
      level: entry.level,
      text: entry.text,
      answer: entry.answer,
      status: 'a_valider',
      reason: null,
      authorId: null,
      authorName: 'admin',
      createdAt: at,
      updatedAt: at,
    };
    this.store.insertBoumEntries([row]);
    return ok(toView(row));
  }

  /**
   * Modifie une entrée. Modifier le contenu d'une entrée `valide` la repasse en `a_valider` :
   * un contenu validé ne change jamais sans nouvelle revue. Une entrée retirée se restaure d'abord.
   */
  update(id: string, input: CandidateInput): BankResult<BoumEntryView> {
    const row = this.store.getBoumEntry(id);
    if (!row) return fail('Entrée introuvable.');
    if (row.status === 'retire') return fail('Entrée retirée : restaurez-la avant de la modifier.');

    const checked = validateEntry(input);
    if (!checked.ok) return fail(checked.reason);
    const { entry } = checked;
    if (this.existingKeys(id).has(duplicateKey(entry.type, entry.text))) {
      return fail('doublon : ce texte existe déjà pour ce type');
    }

    const changed =
      entry.type !== row.type ||
      entry.level !== row.level ||
      entry.text !== row.text ||
      (entry.answer ?? null) !== (row.answer ?? null);
    const updated: BoumEntryRow = {
      ...row,
      type: entry.type,
      level: entry.level,
      text: entry.text,
      answer: entry.answer,
      status: changed && row.status === 'valide' ? 'a_valider' : row.status,
      reason: changed ? null : row.reason,
      updatedAt: this.clock(),
    };
    this.store.updateBoumEntry(updated);
    this.reload();
    return ok(toView(updated));
  }

  /** Change le statut d'une sélection. Un motif court accompagne un refus (propositions). */
  setStatus(
    ids: string[],
    status: 'valide' | 'a_valider' | 'retire',
    reason: string | null = null,
  ): BankResult<number> {
    if (ids.length === 0) return fail('Aucune entrée sélectionnée.');
    const changed = this.store.setBoumStatus(ids, status, reason, this.clock());
    this.reload();
    return ok(changed);
  }

  /** Aperçu d'un import : rien n'est écrit. L'administrateur confirme ensuite avec `commitImport`. */
  previewImport(text: string): ImportPreview {
    return parseBankText(text, this.existingKeys());
  }

  /** Import additif : aucune écriture ni suppression d'entrée existante. Une ligne fausse ne bloque pas les autres. */
  commitImport(text: string, validateNow: boolean): BankResult<ImportSummary> {
    const preview = parseBankText(text, this.existingKeys());
    if (preview.fatal) return fail(preview.fatal);
    const at = this.clock();
    const rows: BoumEntryRow[] = preview.accepted.map((c) => ({
      id: randomUUID(),
      type: c.type,
      level: c.level,
      text: c.text,
      answer: c.answer,
      status: validateNow ? 'valide' : 'a_valider',
      reason: null,
      authorId: null,
      authorName: 'admin',
      createdAt: at,
      updatedAt: at,
    }));
    this.store.insertBoumEntries(rows);
    if (validateNow) this.reload();
    return ok({
      imported: rows.length,
      validatedNow: validateNow,
      rejected: preview.rejected,
      duplicates: preview.duplicates,
    });
  }

  /** Export au format de l'import, pour les entrées valides (tous types, ou une sélection). */
  exportText(filter: { types?: BankType[]; ids?: string[] } = {}): string {
    const wanted = new Set(filter.ids ?? []);
    const types = new Set(filter.types ?? []);
    const entries = this.store
      .listBoumEntries({ status: 'valide' })
      .filter(
        (row) => (wanted.size === 0 || wanted.has(row.id)) && (types.size === 0 || types.has(row.type as BankType)),
      )
      .map((row) => ({
        type: row.type as BankType,
        level: row.level as Level,
        text: row.text,
        answer: row.answer,
      }));
    return serializeBankEntries(entries);
  }

  /** Clés de doublon des entrées non retirées (sauf une, celle qu'on modifie). */
  private existingKeys(exceptId?: string): Set<string> {
    const keys = new Set<string>();
    for (const row of this.store.listBoumEntries()) {
      if (row.status === 'retire' || row.id === exceptId) continue;
      keys.add(duplicateKey(row.type as BankType, row.text));
    }
    return keys;
  }

  /** Amorce : 10 entrées par type et par niveau, en `a_valider`, insérées au premier démarrage seulement. */
  private seedOnce(): void {
    if (this.store.getKv(SEEDED_KEY) !== undefined) return;
    const preview = parseBankText(SEED_TEXT, new Set());
    const at = this.clock();
    this.store.insertBoumEntries(
      preview.accepted.map((c) => ({
        id: randomUUID(),
        type: c.type,
        level: c.level,
        text: c.text,
        answer: c.answer,
        status: 'a_valider',
        reason: null,
        authorId: null,
        authorName: 'admin',
        createdAt: at,
        updatedAt: at,
      })),
    );
    this.store.setKv(SEEDED_KEY, '1');
  }
}

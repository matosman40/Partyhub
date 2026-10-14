import { randomBytes } from 'node:crypto';
import { createCardGame } from '@partyhub/games';
import {
  CARD_EXPORT_FORMAT,
  cardExportSchema,
  cardGameDefinitionSchema,
  type CardGameDefinition,
} from '@partyhub/shared';
import type { Store } from '../db/store.js';
import { setCustomGames } from '../games-registry.js';

/** Préfixe des identifiants de jeux créés dans l'administration. */
export const CUSTOM_GAME_PREFIX = 'custom-';

export interface CardGameRecord {
  id: string;
  definition: CardGameDefinition;
  updatedAt: string;
}

/**
 * Gère les jeux de cartes personnalisés : stockage, validation et
 * reconstruction des modules jouables. Une définition invalide en base
 * (version future par exemple) est ignorée sans empêcher le démarrage.
 */
export class CardGameService {
  constructor(private readonly store: Store) {
    this.reload();
  }

  reload(): void {
    const modules = [];
    for (const row of this.store.listCardGames()) {
      try {
        const parsed = cardGameDefinitionSchema.safeParse(JSON.parse(row.definition));
        if (parsed.success) modules.push(createCardGame(parsed.data, { id: row.id }));
      } catch {
        // Ligne illisible : on l'ignore plutôt que de bloquer le serveur.
      }
    }
    setCustomGames('cards', modules);
  }

  list(): CardGameRecord[] {
    const records: CardGameRecord[] = [];
    for (const row of this.store.listCardGames()) {
      try {
        const parsed = cardGameDefinitionSchema.safeParse(JSON.parse(row.definition));
        if (parsed.success) records.push({ id: row.id, definition: parsed.data, updatedAt: row.updatedAt });
      } catch {
        // Ignorée, comme au démarrage.
      }
    }
    return records;
  }

  exists(id: string): boolean {
    return this.store.listCardGames().some((row) => row.id === id);
  }

  /** Crée un jeu (id absent) ou remplace la définition d'un jeu existant. */
  save(id: string | null, input: unknown): { ok: true; id: string } | { ok: false; error: string } {
    const parsed = cardGameDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, error: issue?.message ?? 'Définition invalide.' };
    }
    const backImage = parsed.data.back?.imageAssetId;
    if (backImage) {
      const asset = this.store.getAsset(backImage);
      if (!asset || asset.kind !== 'image') {
        return { ok: false, error: 'L’image du dos n’existe pas dans la médiathèque.' };
      }
    }
    const fontAsset = parsed.data.fontAssetId;
    if (fontAsset) {
      const asset = this.store.getAsset(fontAsset);
      if (!asset || asset.kind !== 'font') {
        return { ok: false, error: 'La police n’existe pas dans la médiathèque.' };
      }
    }
    if (id !== null && !this.exists(id)) return { ok: false, error: 'Jeu inconnu.' };
    const gameId = id ?? `${CUSTOM_GAME_PREFIX}${randomBytes(4).toString('hex')}`;
    this.store.saveCardGame(gameId, JSON.stringify(parsed.data));
    this.store.setGameEnabled(gameId, true);
    this.reload();
    return { ok: true, id: gameId };
  }

  /** Jeux de cartes qui utilisent une ressource de la médiathèque (image de dos ou police). */
  usersOfAsset(assetId: string): string[] {
    return this.list()
      .filter((r) => r.definition.back?.imageAssetId === assetId || r.definition.fontAssetId === assetId)
      .map((r) => `${r.definition.name} (cartes)`);
  }

  remove(id: string): boolean {
    if (!this.exists(id)) return false;
    this.store.deleteCardGame(id);
    this.reload();
    return true;
  }

  exportOf(id: string) {
    const record = this.list().find((r) => r.id === id);
    if (!record) return null;
    return { format: CARD_EXPORT_FORMAT, version: 1 as const, definition: record.definition };
  }

  /** Lit un fichier exporté (ou une définition brute) sans rien enregistrer. */
  parseImport(input: unknown): { ok: true; definition: CardGameDefinition } | { ok: false; error: string } {
    const wrapped = cardExportSchema.safeParse(input);
    if (wrapped.success) return { ok: true, definition: wrapped.data.definition };
    const raw = cardGameDefinitionSchema.safeParse(input);
    if (raw.success) return { ok: true, definition: raw.data };
    const issue = (wrapped.error ?? raw.error).issues[0];
    return { ok: false, error: issue?.message ?? 'Fichier non reconnu.' };
  }

  /** Copie d'un jeu de cartes, nommée « … (copie) ». */
  duplicate(id: string): { ok: true; id: string } | { ok: false; error: string } {
    const original = this.list().find((r) => r.id === id);
    if (!original) return { ok: false, error: 'Jeu inconnu.' };
    const suffix = ' (copie)';
    const name = `${original.definition.name.slice(0, 40 - suffix.length)}${suffix}`;
    return this.save(null, { ...original.definition, name });
  }
}

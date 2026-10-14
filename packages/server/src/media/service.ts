import { randomBytes } from 'node:crypto';
import { createMediaGame } from '@partyhub/games';
import {
  mediaExportSchema,
  mediaQuizDefinitionSchema,
  MEDIA_EXPORT_FORMAT,
  type MediaQuizDefinition,
} from '@partyhub/shared';
import type { AssetService } from '../assets/service.js';
import type { Store } from '../db/store.js';
import { setCustomGames } from '../games-registry.js';

/** Préfixe des identifiants des jeux de questions médias créés dans l'administration. */
export const MEDIA_GAME_PREFIX = 'media-';

export interface MediaGameRecord {
  id: string;
  definition: MediaQuizDefinition;
  updatedAt: string;
  /** Identifiants de fichiers absents de la médiathèque (import depuis une autre installation). */
  missingAssets: string[];
}

/**
 * Jeux de questions médias : stockage, validation (y compris les fichiers référencés),
 * export/import et reconstruction des modules jouables. Une ligne illisible est ignorée
 * sans bloquer le démarrage.
 */
export class MediaQuizService {
  constructor(
    private readonly store: Store,
    private readonly assets: AssetService,
  ) {
    this.reload();
  }

  reload(): void {
    const modules = [];
    for (const row of this.store.listMediaGames()) {
      try {
        const parsed = mediaQuizDefinitionSchema.safeParse(JSON.parse(row.definition));
        if (parsed.success) modules.push(createMediaGame(parsed.data, { id: row.id }));
      } catch {
        // Ligne illisible : ignorée.
      }
    }
    setCustomGames('media', modules);
  }

  private parseRow(definition: string): MediaQuizDefinition | null {
    try {
      const parsed = mediaQuizDefinitionSchema.safeParse(JSON.parse(definition));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private missingAssetsOf(def: MediaQuizDefinition): string[] {
    const missing = new Set<string>();
    for (const item of def.items) {
      if (item.source.type === 'asset' && !this.assets.get(item.source.assetId)) {
        missing.add(item.source.assetId);
      }
    }
    return [...missing];
  }

  list(): MediaGameRecord[] {
    const records: MediaGameRecord[] = [];
    for (const row of this.store.listMediaGames()) {
      const definition = this.parseRow(row.definition);
      if (definition) {
        records.push({
          id: row.id,
          definition,
          updatedAt: row.updatedAt,
          missingAssets: this.missingAssetsOf(definition),
        });
      }
    }
    return records;
  }

  get(id: string): MediaGameRecord | undefined {
    return this.list().find((r) => r.id === id);
  }

  exists(id: string): boolean {
    return this.store.listMediaGames().some((row) => row.id === id);
  }

  /**
   * Erreurs de cohérence : chaque extrait tiré de la médiathèque doit exister, et être
   * du bon type (audio pour un son, vidéo pour une vidéo).
   */
  referenceErrors(def: MediaQuizDefinition): string[] {
    const errors: string[] = [];
    def.items.forEach((item, i) => {
      if (item.source.type !== 'asset') return;
      const asset = this.assets.get(item.source.assetId);
      if (!asset) {
        errors.push(`Extrait ${i + 1} (« ${item.answer} ») : fichier absent de la médiathèque.`);
      } else if (asset.kind !== item.source.mediaKind) {
        errors.push(`Extrait ${i + 1} (« ${item.answer} ») : « ${asset.name} » n’est pas un fichier ${item.source.mediaKind === 'audio' ? 'audio' : 'vidéo'}.`);
      }
    });
    return errors;
  }

  /** Crée un jeu (id absent) ou remplace la définition d'un jeu existant. */
  save(id: string | null, input: unknown): { ok: true; id: string } | { ok: false; error: string } {
    const parsed = mediaQuizDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue && issue.path.length > 0 ? `${issue.path.join(' › ')} : ` : '';
      return { ok: false, error: `${where}${issue?.message ?? 'Définition invalide.'}` };
    }
    if (id !== null && !this.exists(id)) return { ok: false, error: 'Jeu inconnu.' };
    const errors = this.referenceErrors(parsed.data);
    if (errors.length > 0) return { ok: false, error: errors[0]! };
    const gameId = id ?? `${MEDIA_GAME_PREFIX}${randomBytes(4).toString('hex')}`;
    this.store.saveMediaGame(gameId, JSON.stringify(parsed.data));
    this.store.setGameEnabled(gameId, true);
    this.reload();
    return { ok: true, id: gameId };
  }

  remove(id: string): boolean {
    if (!this.exists(id)) return false;
    this.store.deleteMediaGame(id);
    this.reload();
    return true;
  }

  /** Copie d'un jeu, nommée « … (copie) » : on repart d'une base modifiable. */
  duplicate(id: string): { ok: true; id: string } | { ok: false; error: string } {
    const original = this.get(id);
    if (!original) return { ok: false, error: 'Jeu inconnu.' };
    const suffix = ' (copie)';
    const name = `${original.definition.name.slice(0, 40 - suffix.length)}${suffix}`;
    return this.save(null, { ...original.definition, name });
  }

  /** Noms des jeux qui utilisent ce fichier (pour empêcher sa suppression). */
  usersOfAsset(assetId: string): string[] {
    return this.list()
      .filter((r) => r.definition.items.some((i) => i.source.type === 'asset' && i.source.assetId === assetId))
      .map((r) => r.definition.name);
  }

  exportOf(id: string) {
    const record = this.get(id);
    if (!record) return null;
    return { format: MEDIA_EXPORT_FORMAT, version: 1 as const, definition: record.definition };
  }

  /** Lit un fichier exporté (ou une définition brute) sans rien enregistrer. */
  parseImport(input: unknown): { ok: true; definition: MediaQuizDefinition } | { ok: false; error: string } {
    const wrapped = mediaExportSchema.safeParse(input);
    if (wrapped.success) return { ok: true, definition: wrapped.data.definition };
    const raw = mediaQuizDefinitionSchema.safeParse(input);
    if (raw.success) return { ok: true, definition: raw.data };
    const issue = (wrapped.error ?? raw.error).issues[0];
    return { ok: false, error: issue?.message ?? 'Fichier non reconnu.' };
  }
}

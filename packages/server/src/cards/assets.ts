import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CardExportAsset, CardGameDefinition } from '@partyhub/shared';
import type { AssetKind, AssetService } from '../assets/service.js';

/**
 * Fichiers de la médiathèque qu’un jeu de cartes utilise : l’image du dos et la police.
 * Un export les joint pour qu’ils voyagent avec le jeu ; un import les recrée ici.
 */
type CardAssetKind = Extract<AssetKind, 'image' | 'font'>;

function referencedAssets(def: CardGameDefinition): { id: string; kind: CardAssetKind; label: string }[] {
  const refs: { id: string; kind: CardAssetKind; label: string }[] = [];
  if (def.back?.imageAssetId) refs.push({ id: def.back.imageAssetId, kind: 'image', label: 'image du dos' });
  if (def.fontAssetId) refs.push({ id: def.fontAssetId, kind: 'font', label: 'police' });
  return refs;
}

/** Joint les fichiers du jeu à son export. Échoue si un fichier n’existe plus dans la médiathèque. */
export function embedCardAssets(
  def: CardGameDefinition,
  assets: AssetService,
): { ok: true; assets: CardExportAsset[] } | { ok: false; error: string } {
  const out: CardExportAsset[] = [];
  for (const ref of referencedAssets(def)) {
    const record = assets.get(ref.id);
    if (!record || record.kind !== ref.kind) {
      return { ok: false, error: `La ${ref.label} du jeu est absente de la médiathèque : export impossible.` };
    }
    try {
      const bytes = readFileSync(assets.filePath(ref.id));
      out.push({ id: ref.id, kind: ref.kind, name: record.name, data: bytes.toString('base64') });
    } catch {
      return { ok: false, error: `La ${ref.label} du jeu ne peut pas être lue : export impossible.` };
    }
  }
  return { ok: true, assets: out };
}

/**
 * Recrée dans la médiathèque les fichiers joints à un jeu importé, sous de nouveaux identifiants, puis rend
 * la définition qui les référence. Un fichier référencé sans être joint est gardé s’il existe déjà ici ;
 * sinon l’enregistrement du jeu le signalera. En cas d’échec, les fichiers déjà créés sont supprimés.
 */
export function restoreCardAssets(
  def: CardGameDefinition,
  joined: CardExportAsset[],
  assets: AssetService,
): { ok: true; definition: CardGameDefinition; created: string[] } | { ok: false; error: string } {
  const created: string[] = [];
  const fail = (error: string) => {
    for (const id of created) assets.remove(id);
    return { ok: false as const, error };
  };

  let next = def;
  for (const ref of referencedAssets(def)) {
    const file = joined.find((a) => a.id === ref.id);
    if (!file) continue;
    if (file.kind !== ref.kind) return fail(`Le fichier joint pour la ${ref.label} n’a pas le bon type.`);

    const id = randomBytes(16).toString('hex');
    const bytes = Buffer.from(file.data, 'base64');
    const result = assets.importRecord(
      { id, kind: ref.kind, mime: '', name: file.name, size: bytes.length, createdAt: new Date().toISOString() },
      bytes,
    );
    if (!result.ok) return fail(result.error);
    created.push(id);
    next = withAssetId(next, ref.kind, id);
  }
  return { ok: true, definition: next, created };
}

function withAssetId(def: CardGameDefinition, kind: CardAssetKind, id: string): CardGameDefinition {
  if (kind === 'image') return { ...def, back: { ...def.back, imageAssetId: id } };
  return { ...def, fontAssetId: id };
}

import type { MediaItem } from '@partyhub/shared';

/**
 * Ce que l’écran principal doit lire pour un extrait. Seule cette vue contient la
 * source du média : les téléphones ne reçoivent jamais l’identifiant du fichier ni la vidéo.
 */
export function hostMediaOf(item: MediaItem, key: number) {
  const source =
    item.source.type === 'youtube'
      ? { type: 'youtube' as const, videoId: item.source.videoId }
      : { type: 'asset' as const, assetId: item.source.assetId, mediaKind: item.source.mediaKind };
  return { key, source, startSec: item.startSec, durationSec: item.durationSec };
}

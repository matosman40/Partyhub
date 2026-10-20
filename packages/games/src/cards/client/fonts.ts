import type { CardFontPreset } from '@partyhub/shared';
import { loadMediaBytes, usesMediaRelay } from '../../client/media-relay.js';

/** Noms de famille des polices livrées dans packages/web/public/fonts (déclarées dans styles.css). */
const PRESET_FAMILIES: Record<CardFontPreset, string> = {
  lisible: 'Atkinson Hyperlegible',
  symboles: 'Noto Sans Symbols 2',
  titre: 'Luckiest Guy',
};

/** Pile de polices d’une police livrée avec l’application, prête pour un style CSS. */
export function presetFontFamily(preset: CardFontPreset): string {
  return `"${PRESET_FAMILIES[preset]}", sans-serif`;
}

/**
 * Police de la médiathèque, chargée une seule fois par identifiant. Retourne le nom de famille
 * CSS à utiliser. L’identifiant vient du serveur et ne contient que des caractères hexadécimaux.
 */
const loadedFamilies = new Set<string>();

export function assetFontFamily(assetId: string): string {
  const family = `ph-font-${assetId}`;
  if (typeof document === 'undefined' || loadedFamilies.has(family)) return `"${family}"`;
  loadedFamilies.add(family);
  if (usesMediaRelay()) {
    // Dans une vue de jeu de code, la police arrive par le relais : elle se charge à partir de ses octets.
    loadMediaBytes(`/api/assets/${assetId}`)
      .then((data) => new FontFace(family, data).load())
      .then((face) => document.fonts.add(face))
      .catch(() => {
        /* police illisible : la pile de secours reste affichée */
      });
    return `"${family}"`;
  }
  const style = document.createElement('style');
  style.id = `style-${family}`;
  style.textContent = `@font-face{font-family:"${family}";src:url("/api/assets/${assetId}");font-display:swap}`;
  document.head.appendChild(style);
  return `"${family}"`;
}

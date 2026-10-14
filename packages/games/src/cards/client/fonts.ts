/**
 * Police de la médiathèque, chargée une seule fois par identifiant. Retourne le nom de famille
 * CSS à utiliser. L'identifiant vient du serveur et ne contient que des caractères hexadécimaux.
 */
export function assetFontFamily(assetId: string): string {
  const family = `ph-font-${assetId}`;
  if (typeof document === 'undefined') return `"${family}"`;
  const styleId = `style-${family}`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `@font-face{font-family:"${family}";src:url("/api/assets/${assetId}");font-display:swap}`;
    document.head.appendChild(style);
  }
  return `"${family}"`;
}

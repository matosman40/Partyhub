/** Une modification ne touche pas les salles déjà ouvertes : on le dit à l'administrateur. */
export function openRoomsText(count: number): string {
  if (count === 0) return 'Les prochaines salles utiliseront cette version.';
  const plural = count > 1;
  return `${count} salle${plural ? 's' : ''} déjà ouverte${plural ? 's' : ''} gard${plural ? 'ent' : 'e'} l’ancienne version jusqu’à leur fin.`;
}

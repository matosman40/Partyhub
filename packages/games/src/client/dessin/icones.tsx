/** Pictogrammes de l’outil de dessin : tracés simples, en trait, pour rester nets à toutes les tailles. */

export type NomIcone =
  | 'annuler'
  | 'refaire'
  | 'stylo'
  | 'pinceau'
  | 'marqueur'
  | 'neon'
  | 'gomme'
  | 'tampon'
  | 'zoomPlus'
  | 'zoomMoins'
  | 'ajuster'
  | 'grille'
  | 'corbeille';

const TRACES: Record<NomIcone, string[]> = {
  annuler: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  refaire: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  stylo: ['M4 20l4-1L19 8l-3-3L5 16l-1 4z', 'M14 7l3 3'],
  pinceau: ['M14 4l6 6-7 7-6-6z', 'M7 14c-2.5 0-4.5 2-4.5 5 2.5 0 5.5-1 6.5-3'],
  marqueur: ['M14 5l5 4-6 8-5-4z', 'M5 19h6'],
  neon: ['M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6'],
  gomme: ['M4 16l8-8 6 6-5 5H7z', 'M9 19h11'],
  tampon: ['M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z'],
  zoomPlus: ['M11 6.5v9M6.5 11h9', 'M15.5 15.5 20 20'],
  zoomMoins: ['M6.5 11h9', 'M15.5 15.5 20 20'],
  ajuster: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  grille: ['M4 4h16v16H4z', 'M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16'],
  corbeille: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
};

export function Icone({ nom }: { nom: NomIcone }) {
  return (
    <svg
      className="dessin-icone"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACES[nom].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

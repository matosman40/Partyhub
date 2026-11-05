/**
 * Cadre « objectif » autour de la photo : le lieu à deviner se regarde comme dans un viseur.
 * Le texte alternatif ne donne aucun indice : il ne nomme jamais le lieu.
 */
export function Viewfinder({ src, round, total }: { src: string; round: number; total: number }) {
  return (
    <figure className="pm-viewfinder">
      <img src={src} alt={`Photo ${round} sur ${total} : lieu à deviner`} />
      <span className="pm-corner pm-corner--tl" aria-hidden="true" />
      <span className="pm-corner pm-corner--tr" aria-hidden="true" />
      <span className="pm-corner pm-corner--bl" aria-hidden="true" />
      <span className="pm-corner pm-corner--br" aria-hidden="true" />
      <figcaption className="pm-viewfinder-tag">
        Vue {round} / {total}
      </figcaption>
    </figure>
  );
}

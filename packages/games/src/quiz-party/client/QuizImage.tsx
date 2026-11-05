/** Image jointe à une question du quiz. Le crédit et la licence ne s’affichent qu’à la révélation, sur l’écran principal. */
export function QuizImage({
  image,
  showCredit = false,
}: {
  image: { src: string; alt: string; credit: string; license: string; source: string };
  showCredit?: boolean;
}) {
  return (
    <figure className="quiz-image">
      <img src={image.src} alt={image.alt} loading="eager" />
      {showCredit && (
        <figcaption className="quiz-image-credit">
          {image.credit} · {image.license} ·{' '}
          <a href={image.source} target="_blank" rel="noreferrer">
            source
          </a>
        </figcaption>
      )}
    </figure>
  );
}

import { GameLogo } from './GameLogo.js';
import { hasGameIcon } from './gameIcons.js';

/** Vignette illustrée des jeux intégrés, avec logo SVG en secours pour les jeux importés. */
export function GameArtwork({
  gameId,
  name,
  className,
  logoClassName,
}: {
  gameId: string;
  name: string;
  className: string;
  logoClassName: string;
}) {
  if (hasGameIcon(gameId)) {
    return (
      <img
        src={`/game-icons/${gameId}.webp`}
        className={className}
        alt=""
        loading="lazy"
        decoding="async"
        width={512}
        height={512}
      />
    );
  }

  return <GameLogo gameId={gameId} name={name} className={logoClassName} />;
}

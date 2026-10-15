import { COUNTRY_CENTROIDS, COUNTRY_PATHS, MAP_HEIGHT, MAP_WIDTH } from '../geo/countries-data.js';

/** Carte du monde pour « Où est-ce ? » : bonne réponse en orange, choix des joueurs en points. */
export function CountryMap({ answer, picks }: { answer: string | null; picks: { code: string; name: string }[] }) {
  return (
    <svg
      className="country-map"
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      role="img"
      aria-label="Carte du monde : le bon pays et les choix des joueurs"
    >
      {Object.entries(COUNTRY_PATHS).map(([code, d]) => (
        <path key={code} d={d} className={code === answer ? 'country-answer' : 'country-land'} />
      ))}
      {picks.map((pick, i) => {
        const centre = COUNTRY_CENTROIDS[pick.code];
        if (!centre) return null;
        const [lat, lon] = centre;
        const x = ((lon + 180) / 360) * MAP_WIDTH;
        const y = ((90 - lat) / 180) * MAP_HEIGHT;
        return (
          <circle key={`${pick.code}-${i}`} cx={x} cy={y} r={7} className="country-pick">
            <title>{pick.name}</title>
          </circle>
        );
      })}
    </svg>
  );
}

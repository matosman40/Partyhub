import type { MouseEvent } from 'react';
import { COUNTRY_PATHS, MAP_HEIGHT, MAP_WIDTH } from '../../boum/geo/countries-data.js';

export interface MapMarker {
  key: string;
  name: string;
  lat: number;
  lon: number;
  tone: 'me' | 'other' | 'answer';
}

/** Position d’un point (latitude, longitude) dans le repère de la carte, projection équirectangulaire. */
export function toMapXY(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * MAP_WIDTH, y: ((90 - lat) / 180) * MAP_HEIGHT };
}

/** Inverse de `toMapXY` : un point cliqué dans le repère de la carte devient une latitude et une longitude. */
export function fromMapXY(x: number, y: number): { lat: number; lon: number } {
  return { lat: 90 - (y / MAP_HEIGHT) * 180, lon: (x / MAP_WIDTH) * 360 - 180 };
}

/**
 * Carte du monde où l’on place un point. Avec `onPick`, un clic ou un toucher donne une position ;
 * sans `onPick`, la carte n’affiche que des repères (écran principal, révélation).
 */
export function PhotoMap({
  markers,
  onPick,
  label,
  links,
}: {
  markers: MapMarker[];
  onPick?: (lat: number, lon: number) => void;
  label: string;
  /** Segments tracés entre un pin et la bonne place, à la révélation. */
  links?: { from: MapMarker; to: MapMarker }[];
}) {
  function handlePick(e: MouseEvent<SVGSVGElement>) {
    if (!onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * MAP_HEIGHT;
    const { lat, lon } = fromMapXY(Math.max(0, Math.min(MAP_WIDTH, x)), Math.max(0, Math.min(MAP_HEIGHT, y)));
    onPick(Math.max(-90, Math.min(90, lat)), Math.max(-180, Math.min(180, lon)));
  }

  return (
    <svg
      className={`pm-map${onPick ? ' pm-map--pick' : ''}`}
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      role="img"
      aria-label={label}
      onClick={handlePick}
    >
      {Object.entries(COUNTRY_PATHS).map(([code, d]) => (
        <path key={code} d={d} className="pm-land" />
      ))}
      {links?.map(({ from, to }) => {
        const a = toMapXY(from.lat, from.lon);
        const b = toMapXY(to.lat, to.lon);
        return <line key={`link-${from.key}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="pm-link" />;
      })}
      {markers.map((m) => {
        const { x, y } = toMapXY(m.lat, m.lon);
        return (
          <circle key={m.key} cx={x} cy={y} r={m.tone === 'answer' ? 12 : 8} className={`pm-pin pm-pin--${m.tone}`}>
            <title>{m.name}</title>
          </circle>
        );
      })}
    </svg>
  );
}

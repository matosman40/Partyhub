import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { readMyRooms, saveMyRooms } from '../seat/my-rooms.js';

export interface MyRoomItem {
  code: string;
  gameName: string | null;
  status: 'waiting' | 'full' | 'in_game' | 'ended';
}

interface RoomInfo {
  exists: boolean;
  status: MyRoomItem['status'] | null;
  gameName: string | null;
}

/** Libellé du statut, en français. */
export function roomStatusLabel(status: MyRoomItem['status']): string {
  return status === 'in_game' ? 'Partie en cours' : 'Salon ouvert';
}

/** Présentation pure : la liste des parties auxquelles cet appareil participe. Rien quand la liste est vide. */
export function MyRoomsList({ items }: { items: MyRoomItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="my-rooms" aria-labelledby="my-rooms-title">
      <h3 id="my-rooms-title">Parties en cours</h3>
      <ul>
        {items.map((item) => (
          <li key={item.code}>
            <span>{item.gameName ?? 'Partie'}</span> <span className="muted small">{roomStatusLabel(item.status)}</span>{' '}
            <Link className="btn primary small" to={`/j/${encodeURIComponent(item.code)}`}>
              {item.status === 'in_game' ? 'Reprendre' : 'Rejoindre'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Check = { kind: 'open'; item: MyRoomItem } | { kind: 'gone' } | { kind: 'unknown' };

/**
 * Parties de cet appareil encore ouvertes. Vérifie chaque code auprès du serveur. Une salle disparue ou
 * terminée est retirée de la mémoire de l’appareil ; en cas d’erreur réseau, elle reste en mémoire et
 * n’est pas affichée pour l’instant.
 */
export function MyRooms() {
  const [items, setItems] = useState<MyRoomItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const codes = readMyRooms();
    if (codes.length === 0) return;
    Promise.all(
      codes.map(async (code): Promise<Check> => {
        try {
          const info = await api<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`);
          if (!info.exists || !info.status || info.status === 'ended') return { kind: 'gone' };
          return { kind: 'open', item: { code, gameName: info.gameName, status: info.status } };
        } catch {
          return { kind: 'unknown' };
        }
      }),
    ).then((checks) => {
      if (cancelled) return;
      const keep = codes.filter((_, i) => checks[i]?.kind !== 'gone');
      saveMyRooms(keep);
      setItems(checks.flatMap((c) => (c.kind === 'open' ? [c.item] : [])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <MyRoomsList items={items} />;
}

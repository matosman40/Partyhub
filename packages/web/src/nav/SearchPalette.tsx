import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { api } from '../api.js';
import { GROUP_ORDER, PAGE_ITEMS, adminNavItems, gameNavItems, searchNav, type NavItem } from './nav-index.js';
import { readRecents } from './recents.js';

/**
 * Recherche unique : une page, une sous-section de l’administration, un jeu. Utilisable à la souris, au clavier
 * (Ctrl/Cmd+K) et à la télécommande d’un téléviseur (flèches et Entrée). Le clavier de l’écran ne s’ouvre que si
 * l’appareil a un pavé (souris) ; sur tablette, téléphone et téléviseur, c’est la liste qui reçoit le focus.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [games, setGames] = useState<CatalogGame[]>([]);

  const recents = useMemo<NavItem[]>(
    () =>
      readRecents().map((entry) => ({
        id: `recent-${entry.to}`,
        title: entry.title,
        subtitle: 'Récemment ouvert',
        to: entry.to,
        group: 'Récent',
        keywords: [],
      })),
    [],
  );

  useEffect(() => {
    api<{ games: CatalogGame[] }>('/api/catalog')
      .then((res) => setGames(res.games))
      .catch(() => setGames([]));
  }, []);

  // Sans recherche : les pages récentes, puis les pages du menu. Avec une recherche : tout ce qui correspond.
  const items = useMemo<NavItem[]>(() => {
    if (query.trim() === '') {
      const recentTargets = new Set(recents.map((item) => item.to));
      return [...recents, ...PAGE_ITEMS.filter((item) => !recentTargets.has(item.to))];
    }
    return searchNav([...PAGE_ITEMS, ...adminNavItems(), ...gameNavItems(games)], query);
  }, [query, games, recents]);

  // Affichage et clavier suivent le même ordre : par groupe, puis par pertinence.
  const ordered = useMemo(() => GROUP_ORDER.flatMap((group) => items.filter((item) => item.group === group)), [items]);
  const current = ordered.length === 0 ? -1 : Math.min(active, ordered.length - 1);
  const activeId = current >= 0 ? `palette-opt-${current}` : undefined;

  useEffect(() => {
    if (current < 0) return;
    document.getElementById(`palette-opt-${current}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    (fine ? inputRef.current : listRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  function choose(item: NavItem) {
    onClose();
    navigate(item.to);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (ordered.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + ordered.length) % ordered.length);
      return;
    }
    if (event.key === 'Enter') {
      const item = current >= 0 ? ordered[current] : undefined;
      if (item) {
        event.preventDefault();
        choose(item);
      }
      return;
    }
    if (event.key === 'Tab') {
      // Le Tab reste dans la fenêtre : sans cela, le focus part derrière la recherche.
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]') ?? [],
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  let optionIndex = -1;
  return (
    <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        onKeyDown={onKeyDown}
      >
        <div className="palette-head">
          <h2 id="palette-title" className="sr-only">
            Rechercher dans PartyHub
          </h2>
          <input
            ref={inputRef}
            type="search"
            className="palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Rechercher une page, un jeu ou un réglage"
            placeholder="Page, jeu ou réglage…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <button type="button" className="btn ghost palette-close" onClick={onClose}>
            Fermer
          </button>
        </div>

        {ordered.length === 0 && (
          <p className="palette-empty" role="status">
            Aucun résultat pour « {query.trim()} ».
          </p>
        )}

        <ul
          ref={listRef}
          id="palette-list"
          className="palette-list"
          role="listbox"
          aria-label="Résultats"
          tabIndex={0}
          aria-activedescendant={activeId}
        >
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <li key={group} role="presentation" className="palette-group">
                <span className="palette-group-title">{group}</span>
                <ul role="presentation" className="palette-group-list">
                  {groupItems.map((item) => {
                    optionIndex += 1;
                    const index = optionIndex;
                    const selected = index === current;
                    return (
                      <li
                        key={item.id}
                        id={`palette-opt-${index}`}
                        role="option"
                        aria-selected={selected}
                        className={`palette-item${selected ? ' active' : ''}`}
                        onClick={() => choose(item)}
                        onMouseMove={() => setActive(index)}
                      >
                        <span className="palette-item-title">{item.title}</span>
                        <span className="muted small">{item.subtitle}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>

        <p className="muted small palette-hint">Flèches pour choisir · Entrée pour ouvrir · Échap pour fermer</p>
      </div>
    </div>
  );
}

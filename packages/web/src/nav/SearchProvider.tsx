import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { SearchPalette } from './SearchPalette.js';
import { navItemForLocation } from './nav-index.js';
import { rememberRecent } from './recents.js';

interface SearchApi {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const SearchContext = createContext<SearchApi>({ isOpen: false, open: () => undefined, close: () => undefined });

/** Accès à la recherche depuis n’importe quelle page (bouton « Rechercher », Ctrl/Cmd+K). */
export function useSearch(): SearchApi {
  return useContext(SearchContext);
}

/**
 * Fournit la recherche et tient la liste des pages récentes : chaque page du menu ouverte est retenue, pour la
 * reprendre plus tard. Doit être placé dans le routeur.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const item = navItemForLocation(location.pathname, location.search);
    if (item) rememberRecent({ title: item.title, to: item.to });
  }, [location.pathname, location.search]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      {isOpen && <SearchPalette onClose={close} />}
    </SearchContext.Provider>
  );
}

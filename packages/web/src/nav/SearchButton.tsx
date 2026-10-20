import { useSearch } from './SearchProvider.js';

/** Bouton « Rechercher », visible sur les pages principales : la recherche ne dépend pas du clavier. */
export function SearchButton({ className = 'btn ghost small' }: { className?: string }) {
  const { open } = useSearch();
  return (
    <button type="button" className={className} onClick={open} aria-keyshortcuts="Control+K Meta+K">
      🔎 Rechercher
    </button>
  );
}

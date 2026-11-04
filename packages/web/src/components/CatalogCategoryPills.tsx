import type { GameCategory } from '@partyhub/shared';
import { CATEGORY_LABEL } from '../catalog/labels.js';

/** Filtres de catégorie en pastilles : plusieurs catégories peuvent être retenues à la fois. */
export function CatalogCategoryPills({
  categories,
  selected,
  onChange,
}: {
  categories: GameCategory[];
  selected: GameCategory[];
  onChange: (categories: GameCategory[]) => void;
}) {
  function toggleCategory(category: GameCategory) {
    onChange(selected.includes(category) ? selected.filter((item) => item !== category) : [...selected, category]);
  }

  return (
    <div className="category-pills" role="group" aria-label="Catégories de jeux">
      <button type="button" aria-pressed={selected.length === 0} onClick={() => onChange([])}>
        Tous
      </button>
      {categories.map((category) => (
        <button
          key={category}
          type="button"
          aria-pressed={selected.includes(category)}
          onClick={() => toggleCategory(category)}
        >
          {CATEGORY_LABEL[category]}
        </button>
      ))}
    </div>
  );
}

import React from 'react';
import type { Genre, Language, Scene, Mood, Decade } from '../services/api';

interface FilterBarProps {
  genres: Genre[];
  languages: Language[];
  scenes: Scene[];
  moods: Mood[];
  decades: Decade[];
  selectedGenres: number[];
  selectedLanguages: number[];
  selectedScenes: number[];
  selectedMoods: number[];
  selectedDecades: number[];
  onToggleGenre: (id: number) => void;
  onToggleLanguage: (id: number) => void;
  onToggleScene: (id: number) => void;
  onToggleMood: (id: number) => void;
  onToggleDecade: (id: number) => void;
  onClearAll: () => void;
}

interface FilterSectionProps {
  label: string;
  icon: string;
  items: { id: number; name: string }[];
  selectedIds: number[];
  onToggle: (id: number) => void;
}

const FilterSection: React.FC<FilterSectionProps> = ({ label, icon, items, selectedIds, onToggle }) => {
  if (items.length === 0) return null;

  return (
    <div className="filter-section">
      <div className="filter-label">
        <span className="filter-label-icon">{icon}</span>
        {label}
      </div>
      <div className="filter-tags">
        {items.map((item) => (
          <button
            key={item.id}
            className={`filter-tag${selectedIds.includes(item.id) ? ' selected' : ''}`}
            onClick={() => onToggle(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
    </div>
  );
};

// 将树形 genres 展平为列表
function flattenGenres(genres: Genre[]): { id: number; name: string }[] {
  const result: { id: number; name: string }[] = [];
  for (const g of genres) {
    result.push({ id: g.id, name: g.name });
    if (g.children?.length) {
      for (const child of g.children) {
        result.push({ id: child.id, name: `${g.name} / ${child.name}` });
      }
    }
  }
  return result;
}

const FilterBar: React.FC<FilterBarProps> = ({
  genres,
  languages,
  scenes,
  moods,
  decades,
  selectedGenres,
  selectedLanguages,
  selectedScenes,
  selectedMoods,
  selectedDecades,
  onToggleGenre,
  onToggleLanguage,
  onToggleScene,
  onToggleMood,
  onToggleDecade,
  onClearAll,
}) => {
  const hasFilters =
    selectedGenres.length > 0 ||
    selectedLanguages.length > 0 ||
    selectedScenes.length > 0 ||
    selectedMoods.length > 0 ||
    selectedDecades.length > 0;

  const flatGenres = flattenGenres(genres);

  return (
    <div className="filter-bar">
      <FilterSection
        label="流派"
        icon="🎵"
        items={flatGenres}
        selectedIds={selectedGenres}
        onToggle={onToggleGenre}
      />
      <FilterSection
        label="语言"
        icon="🌍"
        items={languages}
        selectedIds={selectedLanguages}
        onToggle={onToggleLanguage}
      />
      <FilterSection
        label="场景"
        icon="🎬"
        items={scenes}
        selectedIds={selectedScenes}
        onToggle={onToggleScene}
      />
      <FilterSection
        label="心情"
        icon="💫"
        items={moods}
        selectedIds={selectedMoods}
        onToggle={onToggleMood}
      />
      <FilterSection
        label="年代"
        icon="📅"
        items={decades}
        selectedIds={selectedDecades}
        onToggle={onToggleDecade}
      />
      {hasFilters && (
        <div style={{ marginTop: 4 }}>
          <button className="filter-clear" onClick={onClearAll}>
            ✕ 清除全部筛选
          </button>
        </div>
      )}
    </div>
  );
};

export default FilterBar;

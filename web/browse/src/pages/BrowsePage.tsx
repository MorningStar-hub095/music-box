import React, { useState, useEffect, useCallback, useRef } from 'react';
import FilterBar from '../components/FilterBar';
import SongCard from '../components/SongCard';
import {
  fetchSongs,
  fetchGenres,
  fetchLanguages,
  fetchScenes,
  fetchMoods,
  fetchDecades,
  type Genre,
  type Language,
  type Scene,
  type Mood,
  type Decade,
  type Song,
  type Pagination,
} from '../services/api';

const PAGE_LIMIT = 24;

const SORT_OPTIONS = [
  { value: 'hot_score', label: '热度' },
  { value: 'created_at', label: '最新' },
  { value: 'title', label: '标题' },
  { value: 'artist', label: '艺术家' },
];

const BrowsePage: React.FC = () => {
  // 分类数据
  const [genres, setGenres] = useState<Genre[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [decades, setDecades] = useState<Decade[]>([]);

  // 筛选状态
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<number[]>([]);
  const [selectedScenes, setSelectedScenes] = useState<number[]>([]);
  const [selectedMoods, setSelectedMoods] = useState<number[]>([]);
  const [selectedDecades, setSelectedDecades] = useState<number[]>([]);

  // 搜索与排序
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState('hot_score');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // 歌曲数据
  const [songs, setSongs] = useState<Song[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  // 切换选择辅助函数
  const toggleItem = useCallback((list: number[], setList: React.Dispatch<React.SetStateAction<number[]>>, id: number) => {
    setList((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setPage(1);
  }, []);

  // 清除所有筛选
  const clearAll = useCallback(() => {
    setSelectedGenres([]);
    setSelectedLanguages([]);
    setSelectedScenes([]);
    setSelectedMoods([]);
    setSelectedDecades([]);
    setSearch('');
    setSearchInput('');
    setPage(1);
  }, []);

  // 加载分类数据
  useEffect(() => {
    Promise.allSettled([
      fetchGenres(),
      fetchLanguages(),
      fetchScenes(),
      fetchMoods(),
      fetchDecades(),
    ]).then(([g, l, s, m, d]) => {
      if (g.status === 'fulfilled') setGenres(g.value);
      if (l.status === 'fulfilled') setLanguages(l.value);
      if (s.status === 'fulfilled') setScenes(s.value);
      if (m.status === 'fulfilled') setMoods(m.value);
      if (d.status === 'fulfilled') setDecades(d.value);
    });
  }, []);

  // 加载歌曲数据
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const filters: Record<string, string | number> = {
      sort,
      order,
      page,
      limit: PAGE_LIMIT,
    };

    if (selectedGenres.length) filters.genres = selectedGenres.join(',');
    if (selectedLanguages.length) filters.languages = selectedLanguages.join(',');
    if (selectedScenes.length) filters.scenes = selectedScenes.join(',');
    if (selectedMoods.length) filters.moods = selectedMoods.join(',');
    if (selectedDecades.length) filters.decades = selectedDecades.join(',');
    if (search) filters.search = search;

    fetchSongs(filters)
      .then((res) => {
        if (!cancelled) {
          setSongs(res.songs);
          setPagination(res.pagination);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSongs([]);
          setPagination(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedGenres, selectedLanguages, selectedScenes, selectedMoods, selectedDecades, search, sort, order, page]);

  // 搜索防抖
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 400);
  };

  // 排序切换
  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSort(e.target.value);
    setPage(1);
  };

  // 升降序切换
  const toggleOrder = () => {
    setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    setPage(1);
  };

  // 生成分页按钮
  const renderPagination = () => {
    if (!pagination || pagination.total_pages <= 1) return null;

    const { page: cur, total_pages: total, total: totalItems } = pagination;
    const pages: (number | '...')[] = [];

    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (cur > 3) pages.push('...');
      for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) {
        pages.push(i);
      }
      if (cur < total - 2) pages.push('...');
      pages.push(total);
    }

    return (
      <div className="pagination">
        <span className="page-info">共 {totalItems} 首</span>
        <button
          className="page-btn"
          disabled={cur <= 1}
          onClick={() => setPage(cur - 1)}
        >
          ‹
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="page-ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`page-btn${p === cur ? ' active' : ''}`}
              onClick={() => setPage(p as number)}
            >
              {p}
            </button>
          )
        )}
        <button
          className="page-btn"
          disabled={cur >= total}
          onClick={() => setPage(cur + 1)}
        >
          ›
        </button>
        <span className="page-info">
          {cur}/{total} 页
        </span>
      </div>
    );
  };

  return (
    <div className="browse-app">
      {/* 头部 */}
      <header className="browse-header">
        <div className="browse-logo">
          <span className="browse-logo-icon">♪</span>
          音乐盒子
        </div>

        <div className="search-wrap">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            type="text"
            placeholder="搜索歌曲、艺术家、专辑..."
            value={searchInput}
            onChange={handleSearchChange}
          />
        </div>

        {pagination && (
          <div className="song-count">
            共 <strong>{pagination.total}</strong> 首歌曲
          </div>
        )}
      </header>

      {/* 筛选栏 */}
      <FilterBar
        genres={genres}
        languages={languages}
        scenes={scenes}
        moods={moods}
        decades={decades}
        selectedGenres={selectedGenres}
        selectedLanguages={selectedLanguages}
        selectedScenes={selectedScenes}
        selectedMoods={selectedMoods}
        selectedDecades={selectedDecades}
        onToggleGenre={(id) => toggleItem(selectedGenres, setSelectedGenres, id)}
        onToggleLanguage={(id) => toggleItem(selectedLanguages, setSelectedLanguages, id)}
        onToggleScene={(id) => toggleItem(selectedScenes, setSelectedScenes, id)}
        onToggleMood={(id) => toggleItem(selectedMoods, setSelectedMoods, id)}
        onToggleDecade={(id) => toggleItem(selectedDecades, setSelectedDecades, id)}
        onClearAll={clearAll}
      />

      {/* 工具栏 */}
      <div className="browse-toolbar">
        <div className="sort-wrap">
          <span className="sort-label">排序</span>
          <select className="sort-select" value={sort} onChange={handleSortChange}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button className="order-btn" onClick={toggleOrder} title={order === 'asc' ? '升序' : '降序'}>
            {order === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* 歌曲网格 */}
      {loading ? (
        <div className="loading-state">
          <div className="loading-spinner" />
        </div>
      ) : songs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎵</div>
          <div className="empty-state-text">暂无歌曲</div>
          <div className="empty-state-hint">尝试调整筛选条件或搜索关键词</div>
        </div>
      ) : (
        <>
          <div className="songs-grid">
            {songs.map((song) => (
              <SongCard key={song.id} song={song} />
            ))}
          </div>
          {renderPagination()}
        </>
      )}
    </div>
  );
};

export default BrowsePage;

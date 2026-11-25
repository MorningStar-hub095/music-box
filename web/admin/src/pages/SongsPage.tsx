import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { songsApi, genresApi, languagesApi, scenesApi, moodsApi, decadesApi, tagsApi } from '../services/api';

interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  coverColor?: string;
  platform?: string;
  playable: boolean;
  playCount: number;
  hotScore: number;
  createdAt: string;
  dataSource?: string;
  genres: { genre: { id: number; name: string } }[];
  languages: { language: { id: number; name: string } }[];
  scenes: { scene: { id: number; name: string } }[];
  moods: { mood: { id: number; name: string } }[];
  decades: { decade: { id: number; name: string } }[];
  tags: { tag: { id: number; name: string } }[];
}

interface Category {
  id: number;
  name: string;
}

const SongsPage: React.FC = () => {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 分类数据
  const [genres, setGenres] = useState<Category[]>([]);
  const [languages, setLanguages] = useState<Category[]>([]);
  const [scenes, setScenes] = useState<Category[]>([]);
  const [moods, setMoods] = useState<Category[]>([]);
  const [decades, setDecades] = useState<Category[]>([]);
  const [tags, setTags] = useState<Category[]>([]);

  // 筛选状态
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [sceneFilter, setSceneFilter] = useState('');
  const [moodFilter, setMoodFilter] = useState('');
  const [decadeFilter, setDecadeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [playableFilter, setPlayableFilter] = useState('');
  const [dataSourceFilter, setDataSourceFilter] = useState('');
  
  // 排序状态
  const [sortBy, setSortBy] = useState('hot_score');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // 分页状态
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const fetchSongs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page,
        limit: 20,
        sort: sortBy,
        order: sortOrder,
      };
      if (search) params.search = search;
      if (genreFilter) params.genres = genreFilter;
      if (languageFilter) params.languages = languageFilter;
      if (sceneFilter) params.scenes = sceneFilter;
      if (moodFilter) params.moods = moodFilter;
      if (decadeFilter) params.decades = decadeFilter;
      if (tagFilter) params.tags = tagFilter;
      if (platformFilter) params.platform = platformFilter;
      if (playableFilter) params.playable = playableFilter;
      if (dataSourceFilter) params.dataSource = dataSourceFilter;

      const res = await songsApi.getSongs(params);
      const data = res.data.data;
      setSongs(data.songs || []);
      setTotalPages(data.pagination?.total_pages || 1);
      setTotalItems(data.pagination?.total || 0);
    } catch {
      setSongs([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, genreFilter, languageFilter, sceneFilter, moodFilter, decadeFilter, tagFilter, platformFilter, playableFilter, dataSourceFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const [genresRes, langsRes, scenesRes, moodsRes, decadesRes, tagsRes] = await Promise.all([
          genresApi.getGenres(),
          languagesApi.getLanguages(),
          scenesApi.getScenes(),
          moodsApi.getMoods(),
          decadesApi.getDecades(),
          tagsApi.getTags(),
        ]);
        setGenres(genresRes.data.data || []);
        setLanguages(langsRes.data.data || []);
        setScenes(scenesRes.data.data || []);
        setMoods(moodsRes.data.data || []);
        setDecades(decadesRes.data.data || []);
        setTags(tagsRes.data.data || []);
      } catch {
        // ignore
      }
    };
    fetchFilters();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这首歌曲吗？')) return;
    try {
      await songsApi.deleteSong(Number(id));
      fetchSongs();
    } catch {
      alert('删除失败');
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchSongs();
  };

  const clearAllFilters = () => {
    setSearch('');
    setGenreFilter('');
    setLanguageFilter('');
    setSceneFilter('');
    setMoodFilter('');
    setDecadeFilter('');
    setTagFilter('');
    setPlatformFilter('');
    setPlayableFilter('');
    setDataSourceFilter('');
    setPage(1);
  };

  const hasActiveFilters = search || genreFilter || languageFilter || sceneFilter || 
    moodFilter || decadeFilter || tagFilter || platformFilter || playableFilter || dataSourceFilter;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const getDataSourceLabel = (source?: string) => {
    const labels: Record<string, string> = {
      crawler: '爬虫',
      manual: '手动',
      import: '导入',
      api: 'API',
    };
    return labels[source || ''] || source || '--';
  };

  return (
    <div className="songs-page">
      <div className="page-header">
        <h2 className="page-title">歌曲管理</h2>
        <span className="total-count">共 {totalItems} 首歌曲</span>
      </div>

      {/* 搜索和筛选区域 */}
      <div className="songs-toolbar">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="搜索歌曲名称、歌手、专辑..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-btn">搜索</button>
        </form>
        
        <div className="filter-group">
          <select value={genreFilter} onChange={(e) => { setGenreFilter(e.target.value); setPage(1); }}>
            <option value="">全部流派</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          
          <select value={languageFilter} onChange={(e) => { setLanguageFilter(e.target.value); setPage(1); }}>
            <option value="">全部语言</option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          
          <select value={sceneFilter} onChange={(e) => { setSceneFilter(e.target.value); setPage(1); }}>
            <option value="">全部场景</option>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          
          <select value={moodFilter} onChange={(e) => { setMoodFilter(e.target.value); setPage(1); }}>
            <option value="">全部情绪</option>
            {moods.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          
          <select value={decadeFilter} onChange={(e) => { setDecadeFilter(e.target.value); setPage(1); }}>
            <option value="">全部年代</option>
            {decades.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          
          <select value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}>
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        
        <div className="filter-group">
          <select value={platformFilter} onChange={(e) => { setPlatformFilter(e.target.value); setPage(1); }}>
            <option value="">全部平台</option>
            <option value="netease">网易云</option>
            <option value="qq">QQ音乐</option>
            <option value="kugou">酷狗</option>
            <option value="local">本地</option>
            <option value="other">其他</option>
          </select>
          
          <select value={playableFilter} onChange={(e) => { setPlayableFilter(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            <option value="true">可播放</option>
            <option value="false">不可用</option>
          </select>
          
          <select value={dataSourceFilter} onChange={(e) => { setDataSourceFilter(e.target.value); setPage(1); }}>
            <option value="">全部来源</option>
            <option value="crawler">爬虫采集</option>
            <option value="manual">手动添加</option>
            <option value="import">批量导入</option>
            <option value="api">API接口</option>
          </select>
        </div>
        
        <div className="filter-group">
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }}>
            <option value="hot_score">按热度</option>
            <option value="created_at">按时间</option>
            <option value="title">按名称</option>
            <option value="artist">按歌手</option>
            <option value="play_count">按播放量</option>
          </select>
          
          <button 
            className="sort-order-btn"
            onClick={() => { setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); setPage(1); }}
          >
            {sortOrder === 'asc' ? '↑ 升序' : '↓ 降序'}
          </button>
        </div>
        
        {hasActiveFilters && (
          <button className="clear-filters-btn" onClick={clearAllFilters}>
            清除筛选
          </button>
        )}
      </div>

      {/* 歌曲列表 */}
      {loading ? (
        <div className="page-loading">加载中...</div>
      ) : songs.length === 0 ? (
        <div className="empty-state">暂无歌曲数据</div>
      ) : (
        <>
          <div className="songs-table">
            <table>
              <thead>
                <tr>
                  <th>歌曲</th>
                  <th>流派</th>
                  <th>语言</th>
                  <th>平台</th>
                  <th>来源</th>
                  <th>播放量</th>
                  <th>热度</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((song) => (
                  <tr key={song.id}>
                    <td className="song-cell">
                      <div className="song-info">
                        {song.albumCover ? (
                          <img src={song.albumCover} alt="" className="song-thumb" />
                        ) : (
                          <div className="song-thumb-placeholder" style={{ backgroundColor: song.coverColor || '#6366f1' }}>
                            ♪
                          </div>
                        )}
                        <div>
                          <div className="song-title">{song.title}</div>
                          <div className="song-artist">{song.artist}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {song.genres.map(({ genre }) => (
                        <span key={genre.id} className="mini-tag">{genre.name}</span>
                      ))}
                    </td>
                    <td>
                      {song.languages.map(({ language }) => (
                        <span key={language.id} className="mini-tag">{language.name}</span>
                      ))}
                    </td>
                    <td>{song.platform || '--'}</td>
                    <td>
                      <span className="source-badge">{getDataSourceLabel(song.dataSource)}</span>
                    </td>
                    <td>{song.playCount.toLocaleString()}</td>
                    <td>{song.hotScore.toFixed(1)}</td>
                    <td>
                      <span className={`status ${song.playable ? 'playable' : 'unplayable'}`}>
                        {song.playable ? '可播放' : '不可用'}
                      </span>
                    </td>
                    <td>{formatDate(song.createdAt)}</td>
                    <td>
                      <div className="action-buttons">
                        <button 
                          className="view-btn" 
                          onClick={() => navigate(`/songs/${song.id}`)}
                        >
                          详情
                        </button>
                        <button className="delete-btn" onClick={() => handleDelete(song.id)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
            <span className="page-info">第 {page} / {totalPages} 页</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
          </div>
        </>
      )}
    </div>
  );
};

export default SongsPage;

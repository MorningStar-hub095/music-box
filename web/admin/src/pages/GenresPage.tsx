import React, { useEffect, useState } from 'react';
import { genresApi } from '../services/api';

interface Genre {
  id: number;
  name: string;
  parentId?: number | null;
  children?: Genre[];
}

const GenresPage: React.FC = () => {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [parentId, setParentId] = useState<number | ''>('');

  const fetchGenres = async () => {
    setLoading(true);
    try {
      const res = await genresApi.getGenres();
      setGenres(res.data.data || res.data || []);
    } catch {
      setGenres([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGenres();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await genresApi.createGenre({
        name: newName.trim(),
        parentId: parentId === '' ? undefined : Number(parentId),
      });
      setNewName('');
      setParentId('');
      fetchGenres();
    } catch {
      alert('添加失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此流派吗？')) return;
    try {
      await genresApi.deleteGenre(id);
      fetchGenres();
    } catch {
      alert('删除失败');
    }
  };

  const renderGenreTree = (items: Genre[], level = 0) => {
    return items.map((genre) => (
      <React.Fragment key={genre.id}>
        <div className="genre-row" style={{ paddingLeft: level * 24 }}>
          <span className="genre-icon">{level === 0 ? '📁' : '📄'}</span>
          <span className="genre-name">{genre.name}</span>
          <button className="delete-btn small" onClick={() => handleDelete(genre.id)}>
            删除
          </button>
        </div>
        {genre.children && genre.children.length > 0 &&
          renderGenreTree(genre.children, level + 1)}
      </React.Fragment>
    ));
  };

  // 构建树形结构
  const buildTree = (items: Genre[]): Genre[] => {
    const map = new Map<number, Genre>();
    const roots: Genre[] = [];
    items.forEach((item) => map.set(item.id, { ...item, children: [] }));
    items.forEach((item) => {
      const node = map.get(item.id)!;
      if (item.parentId && map.has(item.parentId)) {
        map.get(item.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  };

  const tree = buildTree(genres);

  return (
    <div className="genres-page">
      <h2 className="page-title">流派管理</h2>

      <form onSubmit={handleAdd} className="genre-form">
        <input
          type="text"
          placeholder="新流派名称"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="genre-input"
          required
        />
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value === '' ? '' : Number(e.target.value))}
          className="genre-select"
        >
          <option value="">顶级分类</option>
          {genres.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button type="submit" className="add-btn">添加</button>
      </form>

      {loading ? (
        <div className="page-loading">加载中...</div>
      ) : genres.length === 0 ? (
        <div className="empty-state">暂无流派数据</div>
      ) : (
        <div className="genre-tree">
          {renderGenreTree(tree)}
        </div>
      )}
    </div>
  );
};

export default GenresPage;

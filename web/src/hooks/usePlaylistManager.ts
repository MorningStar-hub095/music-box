import { useState, useCallback, useEffect, useMemo } from 'react';
import { Track } from '@/types';
import { tracks as defaultTracks } from '@/data/tracks';
import { useStorage } from './useStorage';
import { API_BASE } from '../services/api';
import { validateTrack } from '../../../shared/trackValidator';

export interface PlaylistItem {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_PLAYLIST_ID = 'default';

// 系统预设分类播放列表（不可删除、不可重命名，trackIds 由筛选逻辑或后端填充）
export const PRESET_PLAYLISTS: PlaylistItem[] = [
  {
    id: 'preset-hot',
    name: '热门推荐',
    description: '当前热门100首',
    trackIds: [], // 初始为空，由调用方异步填充
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-classic',
    name: '经典曲目',
    description: '岁月沉淀的金曲',
    trackIds: [], // 由 defaultTracks 按关键词筛选填充
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-edm',
    name: '电子嘻哈',
    description: 'EDM与Hip-Hop节奏',
    trackIds: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-cpop',
    name: '华语流行',
    description: '华语流行歌手精选',
    trackIds: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-western',
    name: '欧美经典',
    description: 'Western Pop Classics',
    trackIds: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-folk',
    name: '民谣清吧',
    description: '安静民谣精选',
    trackIds: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-trending',
    name: '抖音热歌',
    description: '播放量最高50首',
    trackIds: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset-night',
    name: '安静夜晚',
    description: '助眠轻音乐',
    trackIds: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

function generateId(): string {
  return `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 根据预设 ID 用关键词匹配歌曲的 title/artist/album 字段，返回匹配的 trackId 数组
export function buildPresetTrackIds(presetId: string, tracks: Track[]): string[] {
  // 通用关键词匹配：不区分大小写，匹配 title/artist/album
  const matchByKeywords = (keywords: string[]): string[] => {
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    return tracks
      .filter(t => {
        const haystack = `${t.title} ${t.artist} ${t.album || ''}`.toLowerCase();
        return lowerKeywords.some(k => haystack.includes(k));
      })
      .map(t => t.id);
  };

  switch (presetId) {
    case 'preset-classic':
      return matchByKeywords(['经典', '岁月', '怀旧', '老歌', '情歌', '回忆']);
    case 'preset-edm':
      return matchByKeywords(['电子', '嘻哈', 'edm', 'hip-hop', 'hiphop', 'rap', 'dj', '电音', 'dance', 'beat']);
    case 'preset-cpop':
      return matchByKeywords(['周杰伦', '林俊杰', '五月天', '王菲', '陈奕迅', '张学友', '张惠妹', '蔡依林', '梁静茹', '孙燕姿', '华晨宇', '毛不易']);
    case 'preset-western':
      return matchByKeywords(['backstreet', 'justin', 'adele', 'taylor', 'swift', 'ed sheeran', 'coldplay', 'maroon', 'bruno mars']);
    case 'preset-folk':
      return matchByKeywords(['宋冬野', '陈粒', '赵雷', '陈鸿宇', '花粥', '房东的猫', '民谣', '李志', '郝云', '马頔']);
    case 'preset-trending': {
      // 按 hotScore/playCount 排序（若存在），没有则保持原顺序，取前 50
      const hasScoreField = tracks.some(t => 'hotScore' in t || 'playCount' in t);
      if (!hasScoreField) {
        return tracks.slice(0, 50).map(t => t.id);
      }
      return [...tracks]
        .sort((a, b) => {
          const sa = (a as any).hotScore ?? (a as any).playCount ?? 0;
          const sb = (b as any).hotScore ?? (b as any).playCount ?? 0;
          return sb - sa;
        })
        .slice(0, 50)
        .map(t => t.id);
    }
    case 'preset-night':
      return matchByKeywords(['晚安', '夜', '钢琴', '轻音乐', '安静', 'sleep', 'moon', 'lullaby']);
    case 'preset-hot':
      return []; // 由调用方通过 API 异步填充
    default:
      return [];
  }
}

// 预设分类 ID 与 API 路径的映射
const PRESET_CATEGORY_MAP: Record<string, string> = {
  'preset-hot': 'hot',
  'preset-classic': 'classic',
  'preset-edm': 'edm',
  'preset-cpop': 'cpop',
  'preset-western': 'western',
  'preset-folk': 'folk',
  'preset-trending': 'trending',
  'preset-night': 'night',
};

export function usePlaylistManager(extraTracks: Track[] = []) {
  const [playlists, setPlaylists] = useStorage<PlaylistItem[]>('mb_playlists', [
    {
      id: DEFAULT_PLAYLIST_ID,
      name: '默认播放列表',
      description: '系统默认播放列表',
      trackIds: defaultTracks.map(t => t.id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ...PRESET_PLAYLISTS,
  ]);
  
  const [currentPlaylistId, setCurrentPlaylistId] = useStorage<string | null>(
    'mb_current_playlist_id', 
    DEFAULT_PLAYLIST_ID
  );
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Partial<PlaylistItem> | null>(null);
  // API 返回的额外歌曲（不在本地曲库中的歌曲）
  const [apiExtraTracks, setApiExtraTracks] = useState<Track[]>([]);

  // 获取当前播放列表
  const currentPlaylist = playlists.find(p => p.id === currentPlaylistId) || playlists[0];

  // 合并默认歌曲和额外歌曲
  const allTracks = useMemo(() => [...defaultTracks, ...extraTracks, ...apiExtraTracks], [extraTracks, apiExtraTracks]);

  // 获取当前播放列表的歌曲
  const currentPlaylistTracks: Track[] = currentPlaylist
    ? currentPlaylist.trackIds
        .map(id => allTracks.find(t => t.id === id))
        .filter(Boolean) as Track[]
    : [];

  // 创建播放列表
  const createPlaylist = useCallback((name: string, description: string = '') => {
    const newPlaylist: PlaylistItem = {
      id: generateId(),
      name,
      description,
      trackIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setPlaylists(prev => [...prev, newPlaylist]);
    setCurrentPlaylistId(newPlaylist.id);
    return newPlaylist;
  }, [setPlaylists, setCurrentPlaylistId]);

  // 更新播放列表
  const updatePlaylist = useCallback((id: string, updates: Partial<PlaylistItem>) => {
    setPlaylists(prev => prev.map(p => 
      p.id === id 
        ? { ...p, ...updates, updatedAt: Date.now() }
        : p
    ));
  }, [setPlaylists]);

  // 挂载时：兼容迁移缺失的预设列表 + 异步加载所有分类歌单
  // 依赖项为空数组 []，仅执行一次，避免无限循环
  useEffect(() => {
    let mounted = true;

    // 1. 兼容处理：若已存储的 playlists 不包含某个 preset-xxx，则补充进去（向后兼容）
    setPlaylists(prev => {
      const existingIds = new Set(prev.map(p => p.id));
      const missing = PRESET_PLAYLISTS.filter(p => !existingIds.has(p.id));
      if (missing.length === 0) return prev;
      return [...prev, ...missing];
    });

    // 2. 异步加载所有分类歌单（通过后端 API）
    for (const [presetId, categoryId] of Object.entries(PRESET_CATEGORY_MAP)) {
      // 随机延迟 100-500ms，避免同时发起 8 个请求
      const delay = Math.random() * 400 + 100;
      setTimeout(async () => {
        if (!mounted) return;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          const resp = await fetch(`${API_BASE}/playlists/category/${categoryId}`, { signal: controller.signal });
          clearTimeout(timer);
          if (!mounted || !resp.ok) return;
          const result = await resp.json();
          if (!mounted || !result.success || !Array.isArray(result.data)) return;

          // 获取本地曲库中对应的 track
          const trackIds = result.data
            .map((s: any) => s.id)
            .filter((id: string) => allTracks.some(t => t.id === id));

          // 如果本地曲库中没有的歌曲，也需要添加到 apiExtraTracks
          const newSongs = result.data.filter((s: any) => !allTracks.some(t => t.id === s.id));
          if (newSongs.length > 0) {
            // 将 API 返回的新歌曲添加到 apiExtraTracks
            setApiExtraTracks(prev => {
              const existingIds = new Set(prev.map(t => t.id));
              const toAdd = newSongs.filter((s: any) => !existingIds.has(s.id));
              if (toAdd.length === 0) return prev;
              return [...prev, ...toAdd.map((s: any): Track => ({
                id: s.id,
                title: s.title,
                artist: s.artist,
                album: s.album || '',
                albumCover: s.albumCover || '',
                audioUrl: s.audioUrl,
                lyricContent: s.lyricContent || '',
                coverColor: s.coverColor || '#17C3B2',
                platform: s.platform || 'netease',
                playable: s.playable ?? true,
                duration: s.duration || undefined,  // 传递 duration（毫秒），undefined 表示无数据
              }))];
            });
            // trackIds 包含所有返回的歌曲 ID
            const allTrackIds = result.data.map((s: any) => s.id);
            updatePlaylist(presetId, { trackIds: allTrackIds });
          } else {
            updatePlaylist(presetId, { trackIds });
          }
        } catch (err) {
          console.warn(`[Playlist] 加载分类 ${categoryId} 失败:`, err);
          // 降级：使用本地关键词筛选
          const fallbackTrackIds = buildPresetTrackIds(presetId, [...defaultTracks, ...extraTracks]);
          if (fallbackTrackIds.length > 0) {
            updatePlaylist(presetId, { trackIds: fallbackTrackIds });
          }
        }
      }, delay);
    }

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 删除播放列表
  const deletePlaylist = useCallback((id: string) => {
    if (id === DEFAULT_PLAYLIST_ID) return false; // 不能删除默认播放列表
    if (id.startsWith('preset-')) return false; // 预设列表不可删除

    setPlaylists(prev => prev.filter(p => p.id !== id));
    
    if (currentPlaylistId === id) {
      setCurrentPlaylistId(DEFAULT_PLAYLIST_ID);
    }
    
    return true;
  }, [playlists, currentPlaylistId, setPlaylists, setCurrentPlaylistId]);

  // 重命名播放列表
  const renamePlaylist = useCallback((id: string, newName: string) => {
    if (id.startsWith('preset-')) return false; // 预设列表不可重命名
    updatePlaylist(id, { name: newName });
    return true;
  }, [updatePlaylist]);

  // 添加歌曲到播放列表（带验证）
  const addTrackToPlaylist = useCallback((playlistId: string, trackId: string): { success: boolean; error?: string } => {
    // 查找歌曲
    const track = allTracks.find(t => t.id === trackId);
    if (!track) {
      return { success: false, error: '歌曲不存在' };
    }

    // 本地验证
    const validation = validateTrack(track);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 检查是否已存在
    const playlist = playlists.find(p => p.id === playlistId);
    if (playlist && playlist.trackIds.includes(trackId)) {
      return { success: false, error: '歌曲已在播放列表中' };
    }

    // 添加歌曲
    setPlaylists(prev => prev.map(p => {
      if (p.id !== playlistId) return p;
      return {
        ...p,
        trackIds: [...p.trackIds, trackId],
        updatedAt: Date.now(),
      };
    }));

    return { success: true };
  }, [setPlaylists, playlists, allTracks]);

  // 从播放列表移除歌曲
  const removeTrackFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id !== playlistId) return p;
      return {
        ...p,
        trackIds: p.trackIds.filter(id => id !== trackId),
        updatedAt: Date.now(),
      };
    }));
  }, [setPlaylists]);

  // 批量从播放列表移除歌曲（单次 setState，避免 N 次触发）
  const removeTracksFromPlaylist = useCallback((playlistId: string, trackIds: string[]) => {
    if (trackIds.length === 0) return;
    const idSet = new Set(trackIds);
    setPlaylists(prev => prev.map(p => {
      if (p.id !== playlistId) return p;
      return {
        ...p,
        trackIds: p.trackIds.filter(id => !idSet.has(id)),
        updatedAt: Date.now(),
      };
    }));
  }, [setPlaylists]);

  // 移动歌曲位置
  const moveTrackInPlaylist = useCallback((playlistId: string, trackId: string, direction: 'up' | 'down') => {
    setPlaylists(prev => prev.map(p => {
      if (p.id !== playlistId) return p;
      
      const index = p.trackIds.indexOf(trackId);
      if (index === -1) return p;
      
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= p.trackIds.length) return p;
      
      const newTrackIds = [...p.trackIds];
      [newTrackIds[index], newTrackIds[newIndex]] = [newTrackIds[newIndex], newTrackIds[index]];
      
      return {
        ...p,
        trackIds: newTrackIds,
        updatedAt: Date.now(),
      };
    }));
  }, [setPlaylists]);

  // 切换播放列表
  const switchPlaylist = useCallback((id: string) => {
    setCurrentPlaylistId(id);
  }, [setCurrentPlaylistId]);

  // 开始编辑播放列表
  const startEditing = useCallback((playlist: PlaylistItem | null = null) => {
    setEditingPlaylist(playlist ? { ...playlist } : { name: '', description: '' });
    setIsEditing(true);
  }, []);

  // 保存编辑
  const saveEditing = useCallback(() => {
    if (!editingPlaylist) return;
    
    if (editingPlaylist.id) {
      // 更新现有播放列表
      updatePlaylist(editingPlaylist.id, editingPlaylist);
    } else {
      // 创建新播放列表
      createPlaylist(editingPlaylist.name || '新建播放列表', editingPlaylist.description || '');
    }
    
    setIsEditing(false);
    setEditingPlaylist(null);
  }, [editingPlaylist, updatePlaylist, createPlaylist]);

  // 取消编辑
  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditingPlaylist(null);
  }, []);

  // 检查歌曲是否在播放列表中
  const isTrackInPlaylist = useCallback((playlistId: string, trackId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    return playlist ? playlist.trackIds.includes(trackId) : false;
  }, [playlists]);

  // 获取播放列表的歌曲数量（只统计可播放歌曲）
  const getPlaylistTrackCount = useCallback((playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return 0;
    // 只统计可播放歌曲（playable !== false），确保分类榜单数量与实际可播放歌曲一致
    return playlist.trackIds.filter(id => {
      const t = allTracks.find(x => x.id === id);
      return t && t.playable !== false;
    }).length;
  }, [playlists, allTracks]);

  return {
    // 状态
    playlists,
    currentPlaylist,
    currentPlaylistId,
    currentPlaylistTracks,
    allTracks,
    isEditing,
    editingPlaylist,
    
    // 操作
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    renamePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    removeTracksFromPlaylist,
    moveTrackInPlaylist,
    switchPlaylist,
    startEditing,
    saveEditing,
    cancelEditing,
    
    // 查询
    isTrackInPlaylist,
    getPlaylistTrackCount,
    
    // 编辑状态更新
    setEditingPlaylist,
  };
}

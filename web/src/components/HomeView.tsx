import React, { useEffect, useMemo, useState } from 'react';
import { Track } from '@/types';
import { UserInfo, RecommendedSong, recommendationApi } from '@/services/api';
import type { PlaylistItem } from '../hooks/usePlaylistManager';
import { PlayIcon, HeartIcon } from './Icons';
import './HomeView.css';

interface ShelfCover {
  cover: string | null;
  color: string;
}

export interface HomeViewProps {
  user: UserInfo;
  /** 最近播放（新→旧） */
  recentTracks: Track[];
  favorites: Track[];
  /** 全部可播放曲目数 */
  libraryCount: number;
  playlists: PlaylistItem[];
  currentPlaylistId: string | null;
  resolveCover: (p: { trackIds: string[] }) => ShelfCover;
  getTrackCount: (id: string) => number;
  /** 播放曲库内曲目（自动进入播放态） */
  onPlayTrack: (t: Track) => void;
  /** 播放每日推荐歌曲（App 内已实现入队 + 历史同步） */
  onPlayRecommended: (song: RecommendedSong, all?: RecommendedSong[]) => void;
  onOpenProfile: () => void;
  onOpenShelf: () => void;
  onOpenWeather: () => void;
  onOpenRadio: () => void;
  onOpenManager: () => void;
  onOpenAddSong: () => void;
  onOpenCache: () => void;
}

const greetingByHour = (): { hello: string; hint: string } => {
  const h = new Date().getHours();
  if (h < 5) return { hello: '夜深了', hint: '让音乐陪你度过安静的凌晨' };
  if (h < 11) return { hello: '早上好', hint: '用一首歌开启今天' };
  if (h < 14) return { hello: '中午好', hint: '午休时光，来点轻松的旋律' };
  if (h < 18) return { hello: '下午好', hint: '下午茶与音乐更配' };
  if (h < 23) return { hello: '晚上好', hint: '夜色与音符正在上线' };
  return { hello: '夜深了', hint: '让音乐陪你度过安静的夜晚' };
};

// 2026-11-20 封面代理修复：外链封面改走服务端代理，避免网易云防盗链 403
import { resolveCoverUrl } from '../services/cover';

const CardCover: React.FC<{ cover?: string | null; color: string; title: string }> = ({ cover, color, title }) => {
  const coverSrc = resolveCoverUrl(cover);
  return (
    <div className="hv-card-cover" style={{ background: `linear-gradient(135deg, ${color} 0%, #0F1228 130%)` }}>
      {/* [2026-11-20 封面代理修复] 旧实现（直连外链被网易云防盗链 403，且无 onError 兜底）：
          {cover ? <img src={cover} alt={title} loading="lazy" /> : <span className="hv-card-note">♪</span>} */}
      {coverSrc ? <img src={coverSrc} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <span className="hv-card-note">♪</span>}
      <div className="hv-card-play">
        <PlayIcon size={16} />
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title, sub, action, children,
}) => (
  <section className="hv-section">
    <div className="hv-section-head">
      <div>
        <h3 className="hv-section-title">{title}</h3>
        {sub && <p className="hv-section-sub">{sub}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const HomeView: React.FC<HomeViewProps> = ({
  user,
  recentTracks,
  favorites,
  libraryCount,
  playlists,
  currentPlaylistId,
  resolveCover,
  getTrackCount,
  onPlayTrack,
  onPlayRecommended,
  onOpenProfile,
  onOpenShelf,
  onOpenWeather,
  onOpenRadio,
  onOpenManager,
  onOpenAddSong,
  onOpenCache,
}) => {
  const greet = useMemo(greetingByHour, []);
  const [daily, setDaily] = useState<RecommendedSong[] | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    recommendationApi
      .getDaily()
      .then((d) => { if (alive) setDaily(d.songs || []); })
      .catch(() => { if (alive) setDaily([]); })
      .finally(() => { if (alive) setDailyLoading(false); });
    return () => { alive = false; };
  }, []);

  const lastPlayed = recentTracks[0] ?? null;
  const continueList = recentTracks.slice(0, 12);
  const favList = favorites.slice(0, 12);

  const entries: Array<{ icon: string; label: string; desc: string; onClick: () => void; accent: string }> = [
    { icon: '🧬', label: '听歌画像', desc: '情感 DNA · 旋律地图', onClick: onOpenProfile, accent: '#8B5CF6' },
    { icon: '🎙️', label: 'AI 电台', desc: '私人无限流电台', onClick: onOpenRadio, accent: '#17C3B2' },
    { icon: '🌤️', label: '天气电台', desc: '跟着天气听歌', onClick: onOpenWeather, accent: '#38BDF8' },
    { icon: '🗂️', label: '3D 歌单架', desc: '封面架上挑歌单', onClick: onOpenShelf, accent: '#F59E0B' },
    { icon: '📚', label: '歌单管理', desc: '整理我的曲库', onClick: onOpenManager, accent: '#6366F1' },
    { icon: '＋', label: '添加歌曲', desc: '导入或在线添加', onClick: onOpenAddSong, accent: '#EC4899' },
  ];

  return (
    <div className="home-view">
      {/* ── Hero：问候 + 继续听 ── */}
      <div className="hv-hero">
        <div className="hv-hero-text">
          <p className="hv-hello">{greet.hello}，{user.username}</p>
          <h1 className="hv-slogan">{greet.hint}</h1>
          <div className="hv-hero-meta">
            <span>曲库 {libraryCount} 首</span>
            <span className="hv-dot">·</span>
            <span>歌单 {playlists.length} 个</span>
            <span className="hv-dot">·</span>
            <span>收藏 {favorites.length} 首</span>
          </div>
        </div>
        {lastPlayed ? (
          <button
            className="hv-hero-card"
            onClick={() => onPlayTrack(lastPlayed)}
            title="继续上次播放"
          >
            <CardCover cover={lastPlayed.albumCover} color={lastPlayed.coverColor} title={lastPlayed.title} />
            <div className="hv-hero-card-info">
              <span className="hv-hero-tag">继续听</span>
              <div className="hv-hero-title">{lastPlayed.title}</div>
              <div className="hv-hero-artist">{lastPlayed.artist}</div>
            </div>
          </button>
        ) : (
          <div className="hv-hero-card hv-hero-empty">
            <span className="hv-hero-empty-note">♪</span>
            <div className="hv-hero-card-info">
              <span className="hv-hero-tag">开始聆听</span>
              <div className="hv-hero-title">从下方推荐挑一首</div>
              <div className="hv-hero-artist">播放后这里会记录你的足迹</div>
            </div>
          </div>
        )}
      </div>

      {/* ── 快捷入口 ── */}
      <div className="hv-entries">
        {entries.map((e) => (
          <button key={e.label} className="hv-entry" onClick={e.onClick} style={{ '--entry-accent': e.accent } as React.CSSProperties}>
            <span className="hv-entry-icon">{e.icon}</span>
            <span className="hv-entry-text">
              <span className="hv-entry-label">{e.label}</span>
              <span className="hv-entry-desc">{e.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ── 每日推荐 ── */}
      <Section title="每日推荐" sub="基于你的聆听画像实时生成">
        {dailyLoading ? (
          <div className="hv-row">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="hv-card hv-card-skeleton">
                <div className="hv-card-cover hv-skeleton" />
                <div className="hv-skeleton hv-skeleton-line" />
                <div className="hv-skeleton hv-skeleton-line short" />
              </div>
            ))}
          </div>
        ) : daily && daily.length > 0 ? (
          <div className="hv-row">
            {daily.slice(0, 12).map((s) => (
              <button key={s.id} className="hv-card" onClick={() => onPlayRecommended(s, daily)}>
                <CardCover cover={s.albumCover} color={s.coverColor || '#6366F1'} title={s.title} />
                <span className="hv-card-title">{s.title}</span>
                <span className="hv-card-sub">{s.artist}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="hv-section-empty">推荐引擎正在了解你的口味，先随便听听吧</div>
        )}
      </Section>

      {/* ── 最近播放 ── */}
      {continueList.length > 0 && (
        <Section title="最近播放" sub="接着上次的旋律">
          <div className="hv-row">
            {continueList.map((t) => (
              <button key={t.id} className="hv-card" onClick={() => onPlayTrack(t)}>
                <CardCover cover={t.albumCover} color={t.coverColor} title={t.title} />
                <span className="hv-card-title">{t.title}</span>
                <span className="hv-card-sub">{t.artist}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ── 我的歌单 ── */}
      <Section
        title="我的歌单"
        sub="点击封面切换播放队列"
        action={
          <button className="hv-section-action" onClick={onOpenManager}>管理全部 →</button>
        }
      >
        <div className="hv-row">
          {playlists.map((p) => {
            const c = resolveCover(p);
            return (
              <button
                key={p.id}
                className={`hv-card${p.id === currentPlaylistId ? ' current' : ''}`}
                onClick={() => onOpenShelf()}
                title="在 3D 歌单架中浏览并切换"
              >
                <CardCover cover={c.cover} color={c.color} title={p.name} />
                <span className="hv-card-title">{p.name}</span>
                <span className="hv-card-sub">{getTrackCount(p.id)} 首{p.id === currentPlaylistId ? ' · 当前' : ''}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── 我的收藏 ── */}
      {favList.length > 0 && (
        <Section
          title="我的收藏"
          sub={`共 ${favorites.length} 首`}
          action={
            <span className="hv-section-fav"><HeartIcon size={13} fill="currentColor" /> 心动清单</span>
          }
        >
          <div className="hv-row">
            {favList.map((t) => (
              <button key={t.id} className="hv-card" onClick={() => onPlayTrack(t)}>
                <CardCover cover={t.albumCover} color={t.coverColor} title={t.title} />
                <span className="hv-card-title">{t.title}</span>
                <span className="hv-card-sub">{t.artist}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ── 底部工具 ── */}
      <div className="hv-footer-tools">
        <button className="hv-tool-link" onClick={onOpenCache}>缓存管理</button>
        <span className="hv-dot">·</span>
        <button className="hv-tool-link" onClick={onOpenAddSong}>添加歌曲</button>
        <span className="hv-dot">·</span>
        <span>音乐盒子 · 你的私人音乐空间</span>
      </div>
    </div>
  );
};

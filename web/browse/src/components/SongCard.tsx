import React from 'react';
import type { Song } from '../services/api';

interface SongCardProps {
  song: Song;
}

const PLACEHOLDER_COLORS = [
  'linear-gradient(135deg, #7c3aed 0%, #1a0030 100%)',
  'linear-gradient(135deg, #6366f1 0%, #0f1228 100%)',
  'linear-gradient(135deg, #a855f7 0%, #1e1b4b 100%)',
  'linear-gradient(135deg, #ec4899 0%, #4a044e 100%)',
  'linear-gradient(135deg, #3b82f6 0%, #0c1445 100%)',
  'linear-gradient(135deg, #14b8a6 0%, #042f2e 100%)',
];

function getCoverGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length];
}

function getCoverStyle(song: Song): React.CSSProperties {
  if (song.albumCover) {
    return { background: `url(${song.albumCover}) center/cover no-repeat` };
  }
  if (song.coverColor) {
    return { background: `linear-gradient(135deg, ${song.coverColor} 0%, #0a0015 100%)` };
  }
  return { background: getCoverGradient(song.id) };
}

const SongCard: React.FC<SongCardProps> = ({ song }) => {
  const genreNames = song.genres?.map((g) => g.genre.name).slice(0, 3) ?? [];

  const handleClick = () => {
    localStorage.setItem('mb_browse_song', JSON.stringify(song));
    // 跳转主应用：使用当前来源，避免硬编码端口在部署环境失效
    window.open(window.location.origin, '_blank');
  };

  return (
    <div className="song-card" onClick={handleClick}>
      <div className="song-card-cover" style={getCoverStyle(song)}>
        {song.albumCover ? (
          <img
            className="song-card-cover-img"
            src={song.albumCover}
            alt={song.title}
            loading="lazy"
          />
        ) : (
          <span className="song-card-cover-icon">♪</span>
        )}
        <div className="song-card-play-overlay">
          <div className="song-card-play-btn">▶</div>
        </div>
      </div>

      <div className="song-card-info">
        <div className="song-card-title" title={song.title}>{song.title}</div>
        <div className="song-card-artist" title={song.artist}>{song.artist}</div>
        {song.album && (
          <div className="song-card-album" title={song.album}>{song.album}</div>
        )}
        {genreNames.length > 0 && (
          <div className="song-card-tags">
            {genreNames.map((name) => (
              <span key={name} className="song-card-tag">{name}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SongCard;

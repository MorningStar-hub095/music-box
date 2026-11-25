export interface Track {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  audioUrlMp3?: string;
  lyricContent: string;
  coverColor: string;
  albumCover?: string;
  album?: string;
  platform?: string;
  /** 来源标记：'online' 表示线上搜索即时结果（2026-11-20 新增，供 UI 来源徽标） */
  source?: string;
  playable?: boolean;
  genres?: string[];
  languages?: string[];
  duration?: number;
}

export type PlayMode = 'sequential' | 'listLoop' | 'singleLoop' | 'shuffle';

export interface LyricLine {
  time: number;
  text: string;
}

export type TabKey = 'player' | 'favorites' | 'recent';

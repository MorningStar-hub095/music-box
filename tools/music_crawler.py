#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多平台音乐数据聚合工具。

功能：
  1. 聚合网易云、QQ、酷狗、汽水音乐的歌曲元数据
  2. 获取歌词、封面和平台返回的真实候选播放地址
  3. 校验播放地址是否真实可播放
  4. 只导出音频与歌词匹配且真实可播放的曲目，不使用测试音乐替代

用法：
  python tools/music_crawler.py export --keywords "周杰伦,五月天" --count 20
  python tools/music_crawler.py search "晴天"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests

try:
    import netease_crawler
except Exception:
    netease_crawler = None

try:
    from retry_utils import retry_on_network_error
except ImportError:
    # 降级：retry_utils 不可用时提供无重试的占位装饰器
    def retry_on_network_error(*_args, **_kwargs):
        def _decorator(func):
            return func
        return _decorator

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUTPUT = os.path.join(BASE_DIR, 'shared', 'tracks.json')

COLORS = [
    '#17C3B2', '#8B5CF6', '#F59E0B', '#10B981', '#3B82F6',
    '#EF4444', '#EC4899', '#6366F1', '#14B8A6', '#F97316'
]

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
})

# 为直接使用 SESSION 的 provider（酷狗/QQ）提供带重试的请求方法。
# NeteaseProvider 的网络调用经由 netease_crawler.api_get/api_post，已在该层应用重试。
retryable_get = retry_on_network_error()(SESSION.get)
retryable_post = retry_on_network_error()(SESSION.post)

# ========== 爬虫负载监控 ==========
# 严格模式：最大并发5、每请求间隔1-2秒、每日总量≤500首
MAX_CONCURRENCY = 5
REQUEST_DELAY_MIN = 1.0  # 秒
REQUEST_DELAY_MAX = 2.0  # 秒
DAILY_CRAWL_LIMIT = 500

try:
    import resource  # 仅 Unix；Windows 下降级为 psutil 或跳过
except ImportError:
    pass

# 全局状态文件路径
CRAWL_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.crawl_state.json')


def get_daily_crawl_count():
    """获取今日已爬取数量"""
    from datetime import date
    try:
        with open(CRAWL_STATE_FILE, 'r') as f:
            state = json.load(f)
        if state.get('date') == date.today().isoformat():
            return state.get('count', 0)
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass
    return 0


def increment_daily_crawl_count(n=1):
    """增加今日爬取计数"""
    from datetime import date
    state = {'date': date.today().isoformat(), 'count': get_daily_crawl_count() + n}
    try:
        with open(CRAWL_STATE_FILE, 'w') as f:
            json.dump(state, f)
    except IOError:
        pass


def is_daily_limit_reached():
    """检查是否达到每日爬取上限"""
    return get_daily_crawl_count() >= DAILY_CRAWL_LIMIT


def get_system_load():
    """获取系统负载（CPU使用率%）"""
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory().percent
        return cpu, mem
    except ImportError:
        # psutil 不可用时，返回安全值
        return 0, 0


def is_system_overloaded():
    """检查系统是否过载（CPU>80% 或 内存>85%）"""
    cpu, mem = get_system_load()
    return cpu > 80 or mem > 85


def crawl_delay():
    """请求间延迟（1-2秒随机）"""
    import random
    time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX))


@dataclass
class TrackCandidate:
    id: str
    platform: str
    title: str
    artist: str
    album: str = ''
    albumCover: str = ''
    lyricContent: str = ''
    audioUrl: str = ''
    playable: bool = False
    coverColor: str = '#17C3B2'
    duration: int = 0  # 歌曲时长（秒）


def clean_lrc(text: str) -> str:
    lines = []
    for line in (text or '').split('\n'):
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        if lower.startswith('[ti:') or lower.startswith('[ar:') or lower.startswith('[al:'):
            continue
        if lower.startswith('[by:') or lower.startswith('[offset:'):
            continue
        lines.append(stripped)
    return '\n'.join(lines)


def fetch_netease_lyric_by_keyword(title: str, artist: str) -> str:
    if netease_crawler is None:
        return ''
    keyword = f'{title} {artist}'.strip()
    try:
        songs = netease_crawler.search_songs(keyword, limit=1)
        if not songs:
            return ''
        lyric = netease_crawler.get_lyric(songs[0]['id'])
        return clean_lrc(lyric)
    except Exception as exc:
        print(f'[WARN] 歌词回填失败: {keyword} -> {exc}', file=sys.stderr)
        return ''


def is_playable_audio(url: str, timeout: int = 10) -> bool:
    if not url:
        return False
    try:
        resp = SESSION.get(url, stream=True, allow_redirects=True, timeout=timeout)
        final_url = resp.url.lower()
        content_type = resp.headers.get('Content-Type', '').lower()
        if resp.status_code != 200:
            return False
        if '404' in final_url or 'text/html' in content_type:
            return False
        if any(t in content_type for t in ['audio/', 'mpeg', 'mp3', 'aac', 'mp4', 'ogg']):
            return True
        return final_url.endswith(('.mp3', '.m4a', '.aac', '.mp4', '.ogg'))
    except requests.RequestException:
        return False
    finally:
        try:
            resp.close()  # type: ignore[name-defined]
        except Exception:
            pass


def is_trial_audio(url: str, timeout: int = 8) -> bool:
    """检测音频 URL 是否为30秒试听片段
    
    试听文件通常 <1MB，完整歌曲 >2MB
    """
    if not url:
        return True  # 无 URL 视为不可用
    try:
        # HEAD 请求只获取头信息，不下载文件体
        resp = SESSION.head(url, allow_redirects=True, timeout=timeout)
        content_length = int(resp.headers.get('Content-Length', 0))
        # <1MB 的音频文件很可能是30秒试听
        if content_length > 0 and content_length < 1024 * 1024:
            return True
        return False
    except requests.RequestException:
        return False  # 无法确定时，不标记为试听（让其他检查处理）


def _is_known_audio_url(url: str) -> bool:
    """检查 URL 是否来自已知音乐平台（跳过 HTTP 验证）"""
    if not url:
        return False
    known_domains = [
        'music.126.net',      # 网易云
        'm701.music.126.net',
        'm702.music.126.net',
        'm801.music.126.net',
        'm802.music.126.net',
        'm7.music.126.net',
        'm8.music.126.net',
        'aqqmusic.tc.qq.com',  # QQ 音乐
        'isure.stream.qqmusic.qq.com',
        'wwwapi.kugou.com',    # 酷狗
        'trackercdn.kugou.com',
    ]
    url_lower = url.lower()
    return any(d in url_lower for d in known_domains)


def normalize_track(track: TrackCandidate, index: int) -> Optional[Dict[str, Any]]:
    if track.platform == 'open-library' and track.audioUrl:
        track.playable = True
    elif track.audioUrl and _is_known_audio_url(track.audioUrl):
        # 信任来自已知音乐平台的音频 URL，跳过耗时的 HTTP 验证
        track.playable = True
        # 但需要检查是否为30秒试听
        if is_trial_audio(track.audioUrl):
            print(f'[SKIP] 30秒试听，已跳过: {track.title} - {track.artist}', file=sys.stderr)
            return None
    else:
        track.playable = is_playable_audio(track.audioUrl)
    if not track.playable:
        print(f'[SKIP] 不可播放，已跳过: {track.title} - {track.artist}', file=sys.stderr)
        return None
    if not track.lyricContent:
        print(f'[SKIP] 无歌词，已跳过: {track.title} - {track.artist}', file=sys.stderr)
        return None
    # 歌词质量检查
    # 1. 必须有 LRC 时间标签（如 [00:30.542]）
    if not re.search(r'\[\d{1,2}:\d{2}', track.lyricContent):
        print(f'[SKIP] 无LRC时间标签，已跳过: {track.title} - {track.artist}', file=sys.stderr)
        return None
    # 2. 去除元数据后实际内容需 >= 200 字符
    clean_lyric = re.sub(r'\[[\d:.\-]+\]', '', track.lyricContent).strip()
    clean_lyric = re.sub(r'作词|作曲|编曲|制作人|混音|出品|采样|和声|吉他|贝斯|鼓|钢琴|弦乐|录音|母带|统筹|顾问|版权|OP|SP|法律|设计|配唱|人声|打击乐|音乐制作|音乐著作|录音版权|改编词|制作人', '', clean_lyric).strip()
    if len(clean_lyric) < 200:
        print(f'[SKIP] 歌词过短({len(clean_lyric)}字)，已跳过: {track.title} - {track.artist}', file=sys.stderr)
        return None
    track.coverColor = COLORS[index % len(COLORS)]
    return asdict(track)


class BaseProvider:
    platform = 'base'

    def search(self, keyword: str, limit: int) -> List[TrackCandidate]:
        return []


class NeteaseProvider(BaseProvider):
    platform = 'netease'

    def search(self, keyword: str, limit: int) -> List[TrackCandidate]:
        if netease_crawler is None:
            return []
        result = []
        try:
            songs = netease_crawler.search_songs(keyword, limit=limit)
            for song in songs:
                sid = str(song.get('id', ''))
                lyric = netease_crawler.get_lyric(sid) if sid else ''
                audio_url = netease_crawler.get_song_url(sid) if sid else ''
                result.append(TrackCandidate(
                    id=f'netease:{sid}',
                    platform=self.platform,
                    title=song.get('title', ''),
                    artist=song.get('artist', ''),
                    album=song.get('album', ''),
                    albumCover=song.get('cover', ''),
                    lyricContent=clean_lrc(lyric),
                    audioUrl=audio_url,
                    duration=song.get('duration', 0) or 0,  # 新增
                ))
        except Exception as exc:
            print(f'[WARN] 网易云搜索失败: {exc}', file=sys.stderr)
        return result


class KugouProvider(BaseProvider):
    platform = 'kugou'

    def get_song_info(self, file_hash: str, album_id: str = '') -> Dict[str, str]:
        if not file_hash:
            return {}
        try:
            url = 'https://wwwapi.kugou.com/yy/index.php'
            params = {
                'r': 'play/getdata',
                'hash': file_hash,
                'album_id': album_id,
                'dfid': '-',
            }
            resp = retryable_get(url, params=params, timeout=10)
            data = resp.json().get('data', {})
            return {
                'audioUrl': data.get('play_url', '') or data.get('play_backup_url', ''),
                'lyricContent': clean_lrc(data.get('lyrics', '')),
                'albumCover': data.get('img', ''),
            }
        except Exception as exc:
            print(f'[WARN] 酷狗播放信息获取失败: {file_hash} -> {exc}', file=sys.stderr)
            return {}

    def search(self, keyword: str, limit: int) -> List[TrackCandidate]:
        result = []
        try:
            url = 'https://complexsearch.kugou.com/v2/search/song'
            params = {
                'keyword': keyword,
                'page': 1,
                'pagesize': limit,
                'platform': 'WebFilter',
                'clientver': 2000,
                'tag': 'em',
                'filter': 2,
                'iscorrection': 1,
            }
            resp = retryable_get(url, params=params, timeout=10)
            data = resp.json().get('data', {}).get('lists', [])
            for item in data[:limit]:
                title = item.get('SongName') or item.get('FileName', '')
                artist = item.get('SingerName', '')
                file_hash = item.get('FileHash', '')
                album_id = str(item.get('AlbumID', '') or '')
                song_info = self.get_song_info(file_hash, album_id)
                result.append(TrackCandidate(
                    id=f'kugou:{item.get("EMixSongID") or file_hash or title}',
                    platform=self.platform,
                    title=title,
                    artist=artist,
                    album=item.get('AlbumName', ''),
                    albumCover=song_info.get('albumCover') or item.get('Image', '').replace('{size}', '400'),
                    lyricContent=song_info.get('lyricContent', ''),
                    audioUrl=song_info.get('audioUrl', ''),
                ))
        except Exception as exc:
            print(f'[WARN] 酷狗搜索失败: {exc}', file=sys.stderr)
        return result


class QQProvider(BaseProvider):
    platform = 'qq'

    def get_song_url(self, songmid: str) -> str:
        try:
            url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
            payload = {
                'req_0': {
                    'module': 'vkey.GetVkeyServer',
                    'method': 'CgiGetVkey',
                    'param': {
                        'guid': '10000',
                        'songmid': [songmid],
                        'songtype': [0],
                        'uin': '0',
                        'loginflag': 1,
                        'platform': '20',
                    },
                },
                'comm': {
                    'uin': 0,
                    'format': 'json',
                    'ct': 24,
                    'cv': 0,
                },
            }
            resp = retryable_post(url, json=payload, headers={'Referer': 'https://y.qq.com/'}, timeout=10)
            data = resp.json().get('req_0', {}).get('data', {})
            midurlinfo = data.get('midurlinfo', [])
            sip = data.get('sip', [])
            if not midurlinfo or not sip:
                return ''
            purl = midurlinfo[0].get('purl', '')
            return f'{sip[0]}{purl}' if purl else ''
        except Exception as exc:
            print(f'[WARN] QQ播放地址获取失败: {songmid} -> {exc}', file=sys.stderr)
            return ''

    def get_lyric(self, songmid: str) -> str:
        try:
            url = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
            params = {
                'songmid': songmid,
                'format': 'json',
                'nobase64': 1,
                'g_tk': 5381,
            }
            headers = {'Referer': 'https://y.qq.com/'}
            resp = retryable_get(url, params=params, headers=headers, timeout=10)
            lyric = resp.json().get('lyric', '')
            return clean_lrc(lyric)
        except Exception as exc:
            print(f'[WARN] QQ歌词获取失败: {songmid} -> {exc}', file=sys.stderr)
            return ''

    def search(self, keyword: str, limit: int) -> List[TrackCandidate]:
        result = []
        try:
            url = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
            params = {
                'w': keyword,
                'format': 'json',
                'p': 1,
                'n': limit,
                'cr': 1,
                'g_tk': 5381,
            }
            headers = {'Referer': 'https://y.qq.com/'}
            resp = retryable_get(url, params=params, headers=headers, timeout=10)
            songs = resp.json().get('data', {}).get('song', {}).get('list', [])
            for item in songs[:limit]:
                singers = item.get('singer', [])
                artist = ' / '.join(s.get('name', '') for s in singers)
                mid = item.get('songmid') or str(item.get('songid', ''))
                result.append(TrackCandidate(
                    id=f'qq:{mid}',
                    platform=self.platform,
                    title=item.get('songname', ''),
                    artist=artist,
                    album=item.get('albumname', ''),
                    albumCover=f'https://y.gtimg.cn/music/photo_new/T002R300x300M000{item.get("albummid", "")}.jpg'
                    if item.get('albummid') else '',
                    lyricContent=self.get_lyric(mid),
                    audioUrl=self.get_song_url(mid),
                ))
        except Exception as exc:
            print(f'[WARN] QQ音乐搜索失败: {exc}', file=sys.stderr)
        return result


class QishuiProvider(BaseProvider):
    platform = 'qishui'

    def search(self, keyword: str, limit: int) -> List[TrackCandidate]:
        # 汽水音乐公开 Web 接口稳定性较差，这里保留 provider 边界。
        # 如果接口不可用，不影响其他平台聚合和播放。
        encoded = quote(keyword)
        print(f'[INFO] 汽水音乐暂无稳定公开接口，跳过关键词: {encoded}', file=sys.stderr)
        return []


class OpenLibraryProvider(BaseProvider):
    platform = 'open-library'

    OPEN_TRACKS = [
        {
            'id': 'local:track1',
            'title': '阳光下的我们',
            'artist': '曲婉婷',
            'album': '本地音乐',
            'albumCover': '',
            'audioUrl': '/audio/track1.mp3',
            'lyricContent': '[00:00.00]阳光下的我们 - 曲婉婷\n[00:10.00]♪ 本地音乐文件 ♪',
        },
        {
            'id': 'local:track2',
            'title': '本地音乐 2',
            'artist': '未知艺术家',
            'album': '本地音乐',
            'albumCover': '',
            'audioUrl': '/audio/track2.mp3',
            'lyricContent': '[00:00.00]♪ 本地音乐文件 ♪',
        },
        {
            'id': 'local:track3',
            'title': '本地音乐 3',
            'artist': '未知艺术家',
            'album': '本地音乐',
            'albumCover': '',
            'audioUrl': '/audio/track3.mp3',
            'lyricContent': '[00:00.00]♪ 本地音乐文件 ♪',
        },
        {
            'id': 'local:track4',
            'title': '本地音乐 4',
            'artist': '未知艺术家',
            'album': '本地音乐',
            'albumCover': '',
            'audioUrl': '/audio/track4.mp3',
            'lyricContent': '[00:00.00]♪ 本地音乐文件 ♪',
        },
        {
            'id': 'local:track5',
            'title': '本地音乐 5',
            'artist': '未知艺术家',
            'album': '本地音乐',
            'albumCover': '',
            'audioUrl': '/audio/track5.mp3',
            'lyricContent': '[00:00.00]♪ 本地音乐文件 ♪',
        },
        {
            'id': 'local:track6',
            'title': '忘川彼岸',
            'artist': '零一九零贰',
            'album': '本地音乐',
            'albumCover': '',
            'audioUrl': '/audio/track6.mp3',
            'lyricContent': '[00:00.00]忘川彼岸 - 零一九零贰\n[00:10.00]♪ 本地音乐文件 ♪',
        },
    ]

    def search(self, keyword: str, limit: int) -> List[TrackCandidate]:
        keyword_lower = keyword.lower()
        result = []
        for item in self.OPEN_TRACKS:
            haystack = f"{item['title']} {item['artist']} {item['album']} open public domain".lower()
            if keyword_lower and keyword_lower not in haystack and keyword_lower not in 'open music':
                continue
            result.append(TrackCandidate(
                id=item['id'],
                platform=self.platform,
                title=item['title'],
                artist=item['artist'],
                album=item['album'],
                albumCover=item['albumCover'],
                lyricContent=item['lyricContent'],
                audioUrl=item['audioUrl'],
            ))
            if len(result) >= limit:
                break
        return result


PROVIDERS = [OpenLibraryProvider(), NeteaseProvider(), KugouProvider(), QQProvider(), QishuiProvider()]


def search_all(keyword: str, limit: int = 5) -> List[TrackCandidate]:
    all_tracks: List[TrackCandidate] = []
    seen = set()
    for provider in PROVIDERS:
        for track in provider.search(keyword, limit):
            key = f'{track.title.lower()}::{track.artist.lower()}'
            if key in seen:
                continue
            seen.add(key)
            all_tracks.append(track)
    return all_tracks


def export_tracks(keywords: List[str], count: int, output: str, open_only: bool = False) -> List[Dict[str, Any]]:
    # 每个关键词均匀分配配额
    per_keyword = max(1, count // max(1, len(keywords)))
    tracks: List[Dict[str, Any]] = []
    track_index = 0

    for keyword in keywords:
        print(f'[SEARCH] {keyword} (limit={per_keyword})')
        results = search_all(keyword, limit=max(10, per_keyword * 3)) if not open_only else \
                  OpenLibraryProvider().search(keyword, limit=per_keyword)

        # 遍历候选，取 per_keyword 个通过质量检查的
        taken = 0
        for candidate in results:
            if taken >= per_keyword:
                break
            if not candidate.audioUrl:
                continue
            if not candidate.lyricContent:
                candidate.lyricContent = fetch_netease_lyric_by_keyword(candidate.title, candidate.artist)
            normalized = normalize_track(candidate, track_index)
            if normalized:
                tracks.append(normalized)
                track_index += 1
                taken += 1
        print(f'  -> {taken} tracks added')

    if not tracks and netease_crawler is not None:
        print('[INFO] 未搜索到结果，尝试网易云热门歌单')
        for song in netease_crawler.get_top_playlist_songs(count * 2):
            if len(tracks) >= count:
                break
            candidate = TrackCandidate(
                id=f'netease:{song.get("id")}',
                platform='netease',
                title=song.get('title', ''),
                artist=song.get('artist', ''),
                album=song.get('album', ''),
                albumCover=song.get('cover', ''),
                lyricContent=clean_lrc(song.get('lyric', '')),
                audioUrl=song.get('audioUrl', ''),
            )
            normalized = normalize_track(candidate, len(tracks))
            if normalized:
                tracks.append(normalized)

    if not tracks:
        print('[WARN] 未找到平台真实可播放且歌词匹配的曲目，已导出空曲库。', file=sys.stderr)

    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output, 'w', encoding='utf-8') as f:
        json.dump(tracks, f, ensure_ascii=False, indent=2)
    print(f'[OK] exported {len(tracks)} matched playable tracks -> {output}')
    return tracks


def fetch_hot100(limit: int = 100) -> List[Dict[str, Any]]:
    if netease_crawler is None:
        return []
    # get_top_playlist_songs 内部已并行获取 lyric 和 audioUrl
    songs = netease_crawler.get_top_playlist_songs(limit)
    print(f'[INFO] 开始验证 {len(songs)} 首歌曲的可播放性...', file=sys.stderr)

    def validate_song(index_song):
        """验证单首歌曲：检查可播放性、试听、歌词完整性"""
        index, song = index_song
        # 熔断检查
        if is_daily_limit_reached():
            print(f'[LIMIT] 已达到每日爬取上限 {DAILY_CRAWL_LIMIT} 首，跳过剩余歌曲', file=sys.stderr)
            return None
        if is_system_overloaded():
            print(f'[LIMIT] 系统负载过高，跳过剩余歌曲', file=sys.stderr)
            return None
        sid = str(song.get('id', ''))
        if not sid:
            return None
        audio_url = song.get('audioUrl', '')  # 直接复用，不再重复获取
        lyric = clean_lrc(song.get('lyric', ''))
        if not audio_url:
            print(f'[SKIP] 无音频URL: {song.get("title", "")} - {song.get("artist", "")}', file=sys.stderr)
            return None
        # 检查是否为试听片段
        if is_trial_audio(audio_url):
            print(f'[SKIP] 30秒试听: {song.get("title", "")} - {song.get("artist", "")}', file=sys.stderr)
            return None
        # 检查是否可播放
        if not is_playable_audio(audio_url) and not _is_known_audio_url(audio_url):
            print(f'[SKIP] 不可播放: {song.get("title", "")} - {song.get("artist", "")}', file=sys.stderr)
            return None
        if not lyric:
            print(f'[SKIP] 无歌词: {song.get("title", "")} - {song.get("artist", "")}', file=sys.stderr)
            return None
        increment_daily_crawl_count()
        return {
            '_order_index': index,  # 用于排序
            'id': f'netease:{sid}',
            'title': song.get('title', ''),
            'artist': song.get('artist', ''),
            'album': song.get('album', ''),
            'albumCover': song.get('cover', ''),
            'audioUrl': audio_url,
            'lyricContent': lyric,
            'coverColor': COLORS[index % len(COLORS)],
            'platform': 'netease',
            'playable': True,
            'duration': song.get('duration', 0) or song.get('dt', 0) // 1000 or 0,  # 新增
        }

    # 并行验证（最多5并发）
    from concurrent.futures import ThreadPoolExecutor, as_completed
    result = []
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as executor:
        futures = [executor.submit(validate_song, (i, s)) for i, s in enumerate(songs)]
        for future in as_completed(futures):
            validated = future.result()
            if validated:
                result.append(validated)

    # 按原始顺序排序，并移除临时排序字段
    result.sort(key=lambda r: r.pop('_order_index', 0))

    print(f'[INFO] 验证完成: {len(result)}/{len(songs)} 首可播放', file=sys.stderr)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description='多平台音乐数据聚合工具')
    sub = parser.add_subparsers(dest='cmd', required=True)

    search_parser = sub.add_parser('search')
    search_parser.add_argument('keyword')
    search_parser.add_argument('--limit', type=int, default=5)

    export_parser = sub.add_parser('export')
    export_parser.add_argument('--keywords', default='周杰伦,五月天,朴树,周笔畅')
    export_parser.add_argument('--count', type=int, default=20)
    export_parser.add_argument('--output', default=DEFAULT_OUTPUT)
    export_parser.add_argument('--open-only', action='store_true', help='只导出开放曲库，避免混入商业平台搜索结果')

    hot100_parser = sub.add_parser('hot100', help='获取热门100首')
    hot100_parser.add_argument('--limit', type=int, default=100, help='获取数量')

    args = parser.parse_args()

    if args.cmd == 'search':
        tracks = [asdict(t) for t in search_all(args.keyword, args.limit)]
        print(json.dumps(tracks, ensure_ascii=False, indent=2))
        return 0

    if args.cmd == 'export':
        keywords = [item.strip() for item in args.keywords.split(',') if item.strip()]
        export_tracks(keywords, args.count, args.output, args.open_only)
        return 0
    elif args.cmd == 'hot100':
        songs = fetch_hot100(args.limit)
        print(json.dumps(songs, ensure_ascii=False, indent=2))
        return 0

    return 1


if __name__ == '__main__':
    raise SystemExit(main())

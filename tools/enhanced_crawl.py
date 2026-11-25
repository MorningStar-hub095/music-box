#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版爬虫 — 三维度扩展采集
1. 热门歌手列表：各平台热门歌手及代表作品
2. 热门歌单：平台推荐及用户创建的热门歌单
3. 音乐分类：按风格、语言、年代等维度系统性爬取
"""
import sys, os, json, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netease_crawler as nc

COVER_COLORS = [
    '#17C3B2', '#8B5CF6', '#F59E0B', '#10B981', '#3B82F6',
    '#EF4444', '#EC4899', '#6366F1', '#14B8A6', '#F97316',
    '#84CC16', '#06B6D4', '#A855F7', '#F43F5E', '#22C55E',
    '#EAB308', '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B',
]

def clean_lrc(text):
    lines = []
    for line in (text or '').split('\n'):
        s = line.strip()
        if not s:
            continue
        low = s.lower()
        if low.startswith('[ti:') or low.startswith('[ar:') or low.startswith('[al:'):
            continue
        if low.startswith('[by:') or low.startswith('[offset:'):
            continue
        lines.append(s)
    return '\n'.join(lines)

def has_valid_lyric(lyric):
    if not lyric or len(lyric) < 100:
        return False
    return bool(re.search(r'\[\d{1,2}:\d{2}', lyric))

def is_known_audio_url(url):
    known = ['music.126.net', 'm701.music.126.net', 'm801.music.126.net', 'm7.music.126.net', 'm8.music.126.net']
    return any(d in url.lower() for d in known) if url else False

# ==================== 策略1: 热门歌手列表 ====================
HOT_ARTISTS = [
    # 华语男歌手 - 流行
    '周杰伦', '林俊杰', '陈奕迅', '薛之谦', '李荣浩', '毛不易', '华晨宇',
    '张学友', '刘德华', '王力宏', '潘玮柏', '陶喆', '方大同', '李健',
    '张杰', '魏晨', '俞灏明', '王栎鑫', '阿信', '吴青峰',
    # 华语男歌手 - 说唱/摇滚
    'GAI', '法老', '刘聪', '宝石Gem', '谢帝', '马思唯', '派克特',
    '崔健', '窦唯', '张楚', '何勇', '汪峰', '许巍', '郑钧',
    # 华语女歌手 - 流行
    '邓紫棋', '田馥甄', '蔡依林', '张惠妹', '孙燕姿', '梁静茹', '王心凌',
    '刘若英', '陈粒', '袁娅维', '张靓颖', '谭维维', '郁可唯', '徐佳莹',
    '萧亚轩', '张韶涵', '飞儿乐队', '郭静', '戴佩妮', '魏如萱',
    # 华语女歌手 - 经典
    '邓丽君', '王菲', '梅艳芳', '林忆莲', '叶倩文', '陈慧娴', '关淑怡',
    # 乐队/组合
    '五月天', 'Beyond', '苏打绿', '草蜢', 'FIR', 'SHE', '凤凰传奇',
    '草东没有派对', '万能青年旅店', '新裤子', '刺猬乐队', '马赛克',
    '达达乐队', '逃跑计划', '旅行团', '后海大鲨鱼',
    # 民谣/独立
    '赵雷', '宋冬野', '陈鸿宇', '房东的猫', '花粥', '隔壁老樊',
    '尧十三', '贰佰', '纣棒', '陈绮贞', '曹方',
    # 欧美
    'Taylor Swift', 'Ed Sheeran', 'Adele', 'Bruno Mars', 'Billie Eilish',
    'The Weeknd', 'Dua Lipa', 'Post Malone', 'Maroon 5', 'Imagine Dragons',
    # 韩国
    'BTS', 'BLACKPINK', 'EXO', 'TWICE', 'Red Velvet', 'IU',
    # 日本
    'LiSA', 'YOASOBI', '米津玄师', 'One OK Rock', 'RADWIMPS',
]

# ==================== 策略2: 热门歌单 ====================
HOT_PLAYLIST_IDS = [
    '3778678',    # 热歌榜
    '2884035',    # 官方榜
    '19723756',   # 飙升榜
    '3779629',    # 新歌榜
    '71385702',   # 云音乐飙升榜
    '991319590',  # 说唱榜
    '745956260',  # 电音榜
    '10520166',   # 热门华语
    '5059643708', # 热门英文
    '5059633708', # 热门日韩
]

# ==================== 策略3: 分类关键词 ====================
CATEGORY_KEYWORDS = {
    '流派': ['流行', '摇滚', '民谣', '说唱', '电子', '爵士', '古典', 'R&B', '乡村', '布鲁斯'],
    '语言': ['华语', '粤语', '英语', '日语', '韩语', '法语', '小语种'],
    '年代': ['80年代', '90年代', '00年代', '10年代', '20年代'],
    '场景': ['跑步', '学习', '睡眠', '驾驶', '咖啡厅', '雨天', '清晨', '夜晚'],
    '情绪': ['开心', '伤感', '励志', '放松', '怀旧', '浪漫', '愤怒'],
}

def crawl_by_artists(existing_ids, target=80):
    """策略1: 按热门歌手列表爬取"""
    collected = []
    print(f'\n{"="*60}')
    print(f'策略1: 热门歌手列表爬取 (目标 {target} 首)')
    print(f'{"="*60}')

    for artist in HOT_ARTISTS:
        if len(collected) >= target:
            break
        try:
            songs = nc.search_songs(artist, limit=5)
        except Exception as e:
            print(f'  [WARN] 搜索 {artist} 失败: {e}')
            continue

        for song in songs:
            if len(collected) >= target:
                break
            sid = str(song['id'])
            if sid in existing_ids:
                continue
            if song.get('fee', 0) == 1:
                continue

            result = process_song(song, len(collected) + len(existing_ids))
            if result:
                collected.append(result)
                existing_ids.add(sid)
                print(f'  [{len(collected)}] {result["title"]} - {result["artist"]}')
            time.sleep(0.2)

    print(f'策略1完成: 采集 {len(collected)} 首')
    return collected

def crawl_by_playlists(existing_ids, target=60):
    """策略2: 按热门歌单爬取"""
    collected = []
    print(f'\n{"="*60}')
    print(f'策略2: 热门歌单爬取 (目标 {target} 首)')
    print(f'{"="*60}')

    for pl_id in HOT_PLAYLIST_IDS:
        if len(collected) >= target:
            break
        try:
            resp = nc.api_post('https://music.163.com/weapi/v6/playlist/detail', {
                'id': pl_id, 'n': 30,
            })
            tracks = resp.get('playlist', {}).get('tracks', [])
            print(f'  歌单 {pl_id}: {len(tracks)} 首')
        except Exception as e:
            print(f'  [WARN] 歌单 {pl_id} 失败: {e}')
            continue

        for track in tracks:
            if len(collected) >= target:
                break
            sid = str(track['id'])
            if sid in existing_ids:
                continue

            song = {
                'id': sid,
                'title': track['name'],
                'artist': ' / '.join(a['name'] for a in track.get('ar', [])),
                'album': track.get('al', {}).get('name', ''),
                'cover': track.get('al', {}).get('picUrl', ''),
                'fee': track.get('fee', 0),
            }

            result = process_song(song, len(collected) + len(existing_ids))
            if result:
                collected.append(result)
                existing_ids.add(sid)
                print(f'  [{len(collected)}] {result["title"]} - {result["artist"]}')
            time.sleep(0.2)

    print(f'策略2完成: 采集 {len(collected)} 首')
    return collected

def crawl_by_categories(existing_ids, target=60):
    """策略3: 按分类维度爬取"""
    collected = []
    print(f'\n{"="*60}')
    print(f'策略3: 分类维度爬取 (目标 {target} 首)')
    print(f'{"="*60}')

    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if len(collected) >= target:
                break
            try:
                songs = nc.search_songs(kw, limit=5)
            except Exception as e:
                print(f'  [WARN] 搜索 {kw} 失败: {e}')
                continue

            for song in songs:
                if len(collected) >= target:
                    break
                sid = str(song['id'])
                if sid in existing_ids:
                    continue
                if song.get('fee', 0) == 1:
                    continue

                result = process_song(song, len(collected) + len(existing_ids))
                if result:
                    collected.append(result)
                    existing_ids.add(sid)
                    print(f'  [{len(collected)}] [{cat}:{kw}] {result["title"]} - {result["artist"]}')
                time.sleep(0.2)

    print(f'策略3完成: 采集 {len(collected)} 首')
    return collected

def process_song(song, index):
    """处理单首歌曲：获取URL、歌词、验证可播放性"""
    sid = str(song['id'])
    title = song.get('title', '').strip()
    artist = song.get('artist', '').strip()
    if not title or not artist:
        return None

    # 获取播放URL
    try:
        audio_url = nc.get_song_url(sid)
    except:
        audio_url = ''
    if not audio_url or not is_known_audio_url(audio_url):
        return None

    # 获取歌词
    try:
        lyric = clean_lrc(nc.get_lyric(sid))
    except:
        lyric = ''
    if not has_valid_lyric(lyric):
        return None

    return {
        'id': f'netease:{sid}',
        'title': title,
        'artist': artist,
        'album': song.get('album', ''),
        'albumCover': song.get('cover', ''),
        'audioUrl': audio_url,
        'lyricContent': lyric,
        'coverColor': COVER_COLORS[index % len(COVER_COLORS)],
        'platform': 'netease',
    }

def main():
    print('='*60)
    print('增强版爬虫 — 三维度扩展采集')
    print('='*60)

    # 读取已有数据
    json_path = os.path.join(os.path.dirname(__file__), '..', 'shared', 'tracks_crawled.json')
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
    else:
        existing = []

    existing_ids = {s['id'].replace('netease:', '') for s in existing}
    print(f'已有歌曲: {len(existing)} 首')

    # 三策略采集
    new_songs = []
    new_songs += crawl_by_artists(existing_ids.copy(), target=80)
    new_songs += crawl_by_playlists(existing_ids.copy(), target=60)
    new_songs += crawl_by_categories(existing_ids.copy(), target=60)

    print(f'\n{"="*60}')
    print(f'总计新增: {len(new_songs)} 首')
    print(f'{"="*60}')

    # 合并并保存
    all_songs = existing + new_songs
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(all_songs, f, ensure_ascii=False, indent=2)
    print(f'保存到: {json_path} (共 {len(all_songs)} 首)')

    return 0

if __name__ == '__main__':
    raise SystemExit(main())

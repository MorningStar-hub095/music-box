#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量采集歌曲数据并直接写入MySQL数据库
目标：200+首真实可播放的歌曲，含歌词和封面
"""
import sys, os, json, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import netease_crawler as nc
import requests

# 数据库配置
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',
    'password': 'password',
    'database': 'music_box',
}

# 采集关键词 - 覆盖多种风格/年代/语言
KEYWORDS = [
    # 华语男歌手
    '周杰伦', '林俊杰', '陈奕迅', '薛之谦', '李荣浩', '毛不易', '华晨宇',
    '张学友', '刘德华', '王力宏', '潘玮柏', '陶喆', '方大同', '李健',
    # 华语女歌手
    '邓紫棋', '田馥甄', '蔡依林', '张惠妹', '孙燕姿', '梁静茹', '王心凌',
    '刘若英', '陈粒', '袁娅维', '张靓颖', '谭维维', '郁可唯', '徐佳莹',
    # 乐队/组合
    '五月天', 'Beyond', '苏打绿', '草蜢', 'FIR', 'SHE', '凤凰传奇',
    'NewPants', '草东没有派对', '万能青年旅店',
    # 民谣/独立
    '赵雷', '宋冬野', '陈鸿宇', '房东的猫', '花粥', '隔壁老樊',
    # 经典老歌
    '邓丽君', '罗大佑', '李宗盛', '齐秦', '张国荣', '梅艳芳', '王菲',
    # 流行/说唱
    'GAI', 'PGone', '法老', '刘柏辛', '单依纯', '希林娜依高',
]

COVER_COLORS = [
    '#17C3B2', '#8B5CF6', '#F59E0B', '#10B981', '#3B82F6',
    '#EF4444', '#EC4899', '#6366F1', '#14B8A6', '#F97316',
]

def clean_lrc(text):
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

def has_valid_lyric(lyric):
    if not lyric or len(lyric) < 100:
        return False
    if not re.search(r'\[\d{1,2}:\d{2}', lyric):
        return False
    return True

def is_trial_audio(url):
    if not url:
        return True
    try:
        resp = requests.head(url, allow_redirects=True, timeout=8,
            headers={'User-Agent': 'Mozilla/5.0'})
        cl = int(resp.headers.get('Content-Length', 0))
        if cl > 0 and cl < 1024 * 1024:
            return True
        return False
    except:
        return False

def is_known_audio_url(url):
    known = ['music.126.net', 'm701.music.126.net', 'm801.music.126.net', 'm7.music.126.net', 'm8.music.126.net']
    return any(d in url.lower() for d in known) if url else False

def collect_songs():
    """采集歌曲数据"""
    all_songs = {}
    collected = 0
    target = 220  # 多采一些以应对过滤

    for kw in KEYWORDS:
        if collected >= target:
            break
        print(f'\n[搜索] {kw} (已采集 {collected}/{target})')
        try:
            songs = nc.search_songs(kw, limit=15)
        except Exception as e:
            print(f'  [WARN] 搜索失败: {e}')
            continue

        for song in songs:
            if collected >= target:
                break
            sid = str(song['id'])
            if sid in all_songs:
                continue

            # 跳过VIP歌曲（fee=1），优先免费(fee=0)和试听(fee=8)
            fee = song.get('fee', 0)
            if fee == 1:
                continue

            title = song.get('title', '').strip()
            artist = song.get('artist', '').strip()
            if not title or not artist:
                continue

            print(f'  [{collected+1}] {title} - {artist} (fee={fee})', end='')

            # 获取播放URL
            try:
                audio_url = nc.get_song_url(sid)
            except:
                audio_url = ''

            if not audio_url:
                print(' -> 无URL，跳过')
                continue

            # 验证URL可播放性
            if not is_known_audio_url(audio_url):
                print(' -> URL不可信，跳过')
                continue

            if is_trial_audio(audio_url):
                print(' -> 30秒试听，跳过')
                continue

            # 获取歌词
            try:
                lyric = nc.get_lyric(sid)
                lyric = clean_lrc(lyric)
            except:
                lyric = ''

            if not has_valid_lyric(lyric):
                print(' -> 歌词无效，跳过')
                continue

            print(' -> OK')

            all_songs[sid] = {
                'id': f'netease:{sid}',
                'title': title,
                'artist': artist,
                'album': song.get('album', ''),
                'albumCover': song.get('cover', ''),
                'audioUrl': audio_url,
                'lyricContent': lyric,
                'coverColor': COVER_COLORS[collected % len(COVER_COLORS)],
                'platform': 'netease',
                'fee': fee,
            }
            collected += 1
            time.sleep(0.3)  # 礼貌延迟

    return list(all_songs.values())

def import_to_mysql(songs):
    """导入MySQL数据库"""
    try:
        import mysql.connector
    except ImportError:
        print('[ERROR] mysql-connector-python 未安装')
        return 0

    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    imported = 0
    skipped = 0

    for song in songs:
        try:
            # 检查是否已存在
            cursor.execute('SELECT id FROM songs WHERE id = %s', (song['id'],))
            if cursor.fetchone():
                # 更新现有记录
                cursor.execute('''
                    UPDATE songs SET
                        title=%s, artist=%s, album=%s, album_cover=%s,
                        audio_url=%s, lyric_content=%s, cover_color=%s,
                        platform=%s, playable=1, updated_at=NOW(), url_checked_at=NOW()
                    WHERE id=%s
                ''', (
                    song['title'], song['artist'], song['album'], song['albumCover'],
                    song['audioUrl'], song['lyricContent'], song['coverColor'],
                    song['platform'], song['id']
                ))
                skipped += 1
            else:
                # 插入新记录
                cursor.execute('''
                    INSERT INTO songs (id, title, artist, album, album_cover, audio_url,
                        lyric_content, cover_color, platform, playable, data_source,
                        hot_score, play_count, created_at, updated_at, imported_at, url_checked_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1, 'crawler', %s, 0, NOW(), NOW(), NOW(), NOW())
                ''', (
                    song['id'], song['title'], song['artist'], song['album'], song['albumCover'],
                    song['audioUrl'], song['lyricContent'], song['coverColor'],
                    song['platform'], round(50 + (imported % 50), 1)
                ))
                imported += 1
        except Exception as e:
            print(f'  [WARN] 导入失败 {song["id"]}: {e}')

    conn.commit()

    # 清理mock数据（example.com的URL）
    cursor.execute("DELETE FROM songs WHERE audio_url LIKE '%example.com%'")
    deleted_mock = cursor.rowcount

    # 更新统计
    cursor.execute('SELECT COUNT(*) FROM songs WHERE playable = 1 AND archived = 0')
    total = cursor.fetchone()[0]

    cursor.close()
    conn.close()

    print(f'\n[数据库] 新增: {imported}, 更新: {skipped}, 删除mock: {deleted_mock}, 总计可播放: {total}')
    return imported

def main():
    print('='*60)
    print('音乐数据库批量采集工具')
    print('='*60)

    # 采集
    print(f'\n开始采集，目标 220+ 首...')
    songs = collect_songs()
    print(f'\n采集完成: {len(songs)} 首有效歌曲')

    if not songs:
        print('[ERROR] 未采集到任何歌曲')
        return 1

    # 导入数据库
    print('\n导入数据库...')
    imported = import_to_mysql(songs)

    # 导出JSON备份
    output_path = os.path.join(os.path.dirname(__file__), '..', 'shared', 'tracks_crawled.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(songs, f, ensure_ascii=False, indent=2)
    print(f'JSON备份: {output_path}')

    print(f'\n完成！共导入 {imported} 首新歌曲')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

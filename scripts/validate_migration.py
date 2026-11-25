#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
迁移验证脚本: 对比 tracks.json 与 MySQL songs 表，检查数据完整性

功能:
  - 对比 tracks.json 条目数与 songs 表记录数
  - 逐条检查每首歌曲是否正确迁移（核心字段匹配）
  - 检查关联表（语言、年代、流派）是否已建立关联
  - 输出验证报告

依赖:
  pip install mysql-connector-python
"""

import json
import os
import sys

# 添加本地 site-packages 路径（项目内依赖）
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCAL_SITE = os.path.join(_SCRIPT_DIR, "site-packages")
if os.path.isdir(_LOCAL_SITE) and _LOCAL_SITE not in sys.path:
    sys.path.insert(0, _LOCAL_SITE)

# Windows 控制台 UTF-8 输出
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import mysql.connector
from mysql.connector import Error

# ──────────────────────────── 路径 & 连接配置 ────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
TRACKS_JSON = os.path.join(PROJECT_ROOT, "shared", "tracks.json")

DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "",
    "database": "music_box",
    "charset": "utf8mb4",
}


# ──────────────────────────── 辅助函数 ────────────────────────────

def load_tracks(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize(value):
    """统一空值：空字符串 → None"""
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


# ──────────────────────────── 验证逻辑 ────────────────────────────

def validate():
    # 1. 读取 tracks.json
    if not os.path.exists(TRACKS_JSON):
        print(f"错误: 找不到源数据文件 {TRACKS_JSON}")
        sys.exit(1)

    tracks = load_tracks(TRACKS_JSON)
    json_count = len(tracks)
    print(f"tracks.json 包含 {json_count} 首歌曲\n")

    # 2. 连接数据库
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
    except Error as e:
        print(f"数据库连接失败: {e}")
        sys.exit(1)

    cursor = conn.cursor(dictionary=True)

    # 3. 总数对比
    cursor.execute("SELECT COUNT(*) AS cnt FROM songs")
    db_count = cursor.fetchone()["cnt"]
    print(f"songs 表包含 {db_count} 条记录")
    if json_count == db_count:
        print("✓ 数量一致\n")
    else:
        print(f"✗ 数量不一致 (JSON: {json_count}, DB: {db_count})\n")

    # 4. 逐条验证
    passed = 0
    failed_tracks: list[str] = []
    warn_tracks: list[str] = []

    for idx, track in enumerate(tracks, 1):
        song_id = track["id"]
        title = track.get("title", "")
        artist = track.get("artist", "")

        cursor.execute("SELECT * FROM songs WHERE id = %s", (song_id,))
        row = cursor.fetchone()

        if row is None:
            failed_tracks.append(f"  [{idx}] {song_id} ({title}): 不存在于数据库")
            continue

        errors = []

        # 核心字段对比
        if row["title"] != title:
            errors.append(f"title 不匹配: 期望 '{title}', 实际 '{row['title']}'")

        if row["artist"] != artist:
            errors.append(f"artist 不匹配: 期望 '{artist}', 实际 '{row['artist']}'")

        expected_album = normalize(track.get("album", ""))
        actual_album = row.get("album")
        if expected_album != actual_album:
            errors.append(f"album 不匹配: 期望 '{expected_album}', 实际 '{actual_album}'")

        expected_cover = normalize(track.get("albumCover", ""))
        actual_cover = row.get("album_cover")
        if expected_cover != actual_cover:
            errors.append(f"album_cover 不匹配")

        expected_url = track.get("audioUrl", "")
        actual_url = row.get("audio_url", "")
        if expected_url != actual_url:
            errors.append(f"audio_url 不匹配")

        expected_lyric = normalize(track.get("lyricContent", ""))
        actual_lyric = row.get("lyric_content")
        if expected_lyric != actual_lyric:
            # 歌词可能很长，只提示不同
            errors.append(f"lyric_content 不匹配")

        expected_color = normalize(track.get("coverColor", ""))
        actual_color = row.get("cover_color")
        if expected_color != actual_color:
            errors.append(f"cover_color 不匹配")

        expected_platform = normalize(track.get("platform", ""))
        actual_platform = row.get("platform")
        if expected_platform != actual_platform:
            errors.append(f"platform 不匹配")

        if errors:
            failed_tracks.append(f"  [{idx}] {song_id} ({title}): {'; '.join(errors)}")
        else:
            passed += 1

    # 5. 检查关联表
    print("检查关联表...\n")

    cursor.execute("SELECT COUNT(*) AS cnt FROM song_languages")
    lang_count = cursor.fetchone()["cnt"]
    cursor.execute("SELECT COUNT(*) AS cnt FROM song_decades")
    decade_count = cursor.fetchone()["cnt"]
    cursor.execute("SELECT COUNT(*) AS cnt FROM song_genres")
    genre_count = cursor.fetchone()["cnt"]

    print(f"  song_languages: {lang_count} 条关联")
    print(f"  song_decades:   {decade_count} 条关联")
    print(f"  song_genres:    {genre_count} 条关联")

    missing_assoc = []
    if lang_count == 0:
        missing_assoc.append("song_languages 为空")
    if decade_count == 0:
        missing_assoc.append("song_decades 为空")
    if genre_count == 0:
        missing_assoc.append("song_genres 为空")

    if missing_assoc:
        warn_tracks.append(f"  警告: {', '.join(missing_assoc)}")

    # 6. 检查孤儿关联（关联到不存在的歌曲）
    cursor.execute("""
        SELECT sl.song_id FROM song_languages sl
        LEFT JOIN songs s ON sl.song_id = s.id
        WHERE s.id IS NULL LIMIT 5
    """)
    orphans = cursor.fetchall()
    if orphans:
        warn_tracks.append(f"  警告: song_languages 存在 {len(orphans)} 条孤儿记录")

    cursor.close()
    conn.close()

    # 7. 输出报告
    print("\n" + "=" * 60)
    print("验证报告")
    print("=" * 60)
    print(f"  tracks.json 歌曲数:  {json_count}")
    print(f"  songs 表记录数:      {db_count}")
    print(f"  核心字段验证通过:    {passed}")
    print(f"  核心字段验证失败:    {len(failed_tracks)}")
    print(f"  关联表警告:          {len(warn_tracks)}")

    if failed_tracks:
        print("\n失败详情:")
        for line in failed_tracks:
            print(line)

    if warn_tracks:
        print("\n警告:")
        for line in warn_tracks:
            print(line)

    if not failed_tracks and not warn_tracks:
        print("\n✓ 所有验证通过！迁移数据完整。")
    elif not failed_tracks:
        print("\n✓ 核心数据验证通过，但有关联表警告。")
    else:
        print("\n✗ 存在验证失败，需要检查。")

    print("=" * 60)
    return len(failed_tracks) == 0


if __name__ == "__main__":
    ok = validate()
    sys.exit(0 if ok else 1)

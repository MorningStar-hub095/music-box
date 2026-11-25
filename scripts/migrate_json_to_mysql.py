#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据迁移脚本: 将 tracks.json 数据迁移到 MySQL music_box 数据库

功能:
  - 读取 shared/tracks.json
  - 插入 songs 表
  - 自动推断语言、年代、流派
  - 关联 songs_genres / songs_languages / songs_decades 关联表

依赖:
  pip install mysql-connector-python
"""

import json
import os
import re
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

def contains_chinese(text: str) -> bool:
    """检测文本是否包含中文字符 (CJK Unified Ideographs 范围)"""
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def contains_cjk_punctuation(text: str) -> bool:
    """检测文本是否包含中文标点（用于补充判断）"""
    return bool(re.search(r"[\u3000-\u303f\uff00-\uffef]", text))


def detect_language(title: str, artist: str) -> str:
    """
    语言检测规则:
      - 标题或艺术家包含中文字符 → 'zh'（中文）
      - 否则 → 'en'（英文/其他，作为默认）
    """
    combined = f"{title} {artist}"
    if contains_chinese(combined) or contains_cjk_punctuation(combined):
        return "zh"
    return "en"


def infer_decade(title: str, artist: str) -> str:
    """
    年代推断: 由于 tracks.json 中没有发布时间信息，默认分配到 '2020s'
    """
    return "2020s"


def infer_genre(title: str, artist: str) -> str | None:
    """
    流派推断: 通过标题和艺术家中的关键词匹配流派

    关键词 → 流派映射:
      - DJ / 电音 / Remix / remix → 电子
      - 古典 / 交响 / 协奏 / 奏鸣曲 → 古典
      - 爵士 / Jazz / jazz → 爵士
      - 摇滚 / Rock / rock → 摇滚
      - 民谣 / Folk / folk → 民谣
      - 嘻哈 / Hip-Hop / hip-hop / rap / Rap → 嘻哈
      - R&B / rnb → R&B
      - 金属 / Metal / metal → 金属
      - 朋克 / Punk / punk → 朋克
      - 默认 → 流行
    """
    combined = f"{title} {artist}".lower()

    genre_keywords = {
        "电子": ["dj", "电音", "remix", "mix", "edm", "house", "techno", "trance", "dubstep"],
        "古典": ["古典", "交响", "协奏", "奏鸣曲", "classic"],
        "爵士": ["爵士", "jazz"],
        "摇滚": ["摇滚", "rock"],
        "民谣": ["民谣", "folk", "弹唱"],
        "嘻哈": ["嘻哈", "hip-hop", "hiphop", "rap", "说唱"],
        "R&B": ["r&b", "rnb", "r&b"],
        "金属": ["金属", "metal"],
        "朋克": ["朋克", "punk"],
    }

    for genre, keywords in genre_keywords.items():
        for kw in keywords:
            if kw in combined:
                return genre

    return "流行"  # 默认流派


# ──────────────────────────── 查询缓存 ────────────────────────────

class DBLookupCache:
    """缓存数据库中 languages / genres / decades 的 id 映射，避免重复查询"""

    def __init__(self, cursor):
        self._cursor = cursor
        self._languages: dict[str, int] = {}
        self._genres: dict[str, int] = {}
        self._decades: dict[str, int] = {}

    # ---------- languages ----------
    def get_language_id(self, code: str) -> int | None:
        if code not in self._languages:
            self._cursor.execute("SELECT id FROM languages WHERE code = %s", (code,))
            row = self._cursor.fetchone()
            self._languages[code] = row[0] if row else None
        return self._languages[code]

    # ---------- genres ----------
    def get_genre_id(self, name: str) -> int | None:
        if name not in self._genres:
            self._cursor.execute("SELECT id FROM genres WHERE name = %s AND parent_id IS NULL", (name,))
            row = self._cursor.fetchone()
            self._genres[name] = row[0] if row else None
        return self._genres[name]

    # ---------- decades ----------
    def get_decade_id(self, name: str) -> int | None:
        if name not in self._decades:
            self._cursor.execute("SELECT id FROM decades WHERE name = %s", (name,))
            row = self._cursor.fetchone()
            self._decades[name] = row[0] if row else None
        return self._decades[name]


# ──────────────────────────── 核心迁移逻辑 ────────────────────────────

def load_tracks(path: str) -> list[dict]:
    """读取 tracks.json"""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def sanitize_value(value):
    """将空字符串转为 None（MySQL NULL），保留有内容的字符串"""
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


def migrate():
    # 1. 读取 tracks.json
    if not os.path.exists(TRACKS_JSON):
        print(f"错误: 找不到源数据文件 {TRACKS_JSON}")
        sys.exit(1)

    tracks = load_tracks(TRACKS_JSON)
    total = len(tracks)
    print(f"读取到 {total} 首歌曲，开始迁移...\n")

    # 2. 连接数据库
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
    except Error as e:
        print(f"数据库连接失败: {e}")
        sys.exit(1)

    cursor = conn.cursor()
    cache = DBLookupCache(cursor)

    success = 0
    failed = 0
    skipped = 0
    errors: list[str] = []

    for idx, track in enumerate(tracks, 1):
        song_id = track.get("id", "")
        title = track.get("title", "")
        artist = track.get("artist", "")
        album = sanitize_value(track.get("album", ""))
        album_cover = sanitize_value(track.get("albumCover", ""))
        audio_url = track.get("audioUrl", "")
        lyric_content = sanitize_value(track.get("lyricContent", ""))
        cover_color = sanitize_value(track.get("coverColor", ""))
        platform = sanitize_value(track.get("platform", ""))
        playable = track.get("playable", True)

        if not song_id or not audio_url:
            errors.append(f"  [{idx}] {song_id or '(无ID)'}: 缺少 id 或 audioUrl，跳过")
            failed += 1
            continue

        # ---------- 推断分类 ----------
        lang_code = detect_language(title, artist)
        decade_name = infer_decade(title, artist)
        genre_name = infer_genre(title, artist)

        # ---------- 插入 songs 表 ----------
        insert_song_sql = """
            INSERT IGNORE INTO songs
                (id, title, artist, album, album_cover, audio_url,
                 lyric_content, cover_color, platform, playable)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        try:
            cursor.execute(insert_song_sql, (
                song_id, title, artist, album, album_cover,
                audio_url, lyric_content, cover_color, platform, playable,
            ))

            if cursor.rowcount == 0:
                # INSERT IGNORE 意味着主键已存在，算作跳过
                skipped += 1
                print(f"  [{idx}/{total}] 跳过（已存在）: {title} - {artist}")
            else:
                # ---------- 关联语言 ----------
                lang_id = cache.get_language_id(lang_code)
                if lang_id:
                    cursor.execute(
                        "INSERT IGNORE INTO song_languages (song_id, language_id) VALUES (%s, %s)",
                        (song_id, lang_id),
                    )

                # ---------- 关联年代 ----------
                decade_id = cache.get_decade_id(decade_name)
                if decade_id:
                    cursor.execute(
                        "INSERT IGNORE INTO song_decades (song_id, decade_id) VALUES (%s, %s)",
                        (song_id, decade_id),
                    )

                # ---------- 关联流派 ----------
                genre_id = cache.get_genre_id(genre_name)
                if genre_id:
                    cursor.execute(
                        "INSERT IGNORE INTO song_genres (song_id, genre_id) VALUES (%s, %s)",
                        (song_id, genre_id),
                    )

                success += 1
                print(f"  [{idx}/{total}] 成功: {title} - {artist}  "
                      f"(语言={lang_code}, 年代={decade_name}, 流派={genre_name})")

        except Error as e:
            errors.append(f"  [{idx}] {song_id}: {e}")
            failed += 1

    # 3. 提交事务
    conn.commit()

    cursor.close()
    conn.close()

    # 4. 输出统计
    print("\n" + "=" * 50)
    print("迁移完成！统计信息:")
    print(f"  总计: {total}")
    print(f"  成功: {success}")
    print(f"  跳过（已存在）: {skipped}")
    print(f"  失败: {failed}")

    if errors:
        print("\n失败详情:")
        for err in errors:
            print(err)

    print("=" * 50)
    return failed == 0


if __name__ == "__main__":
    ok = migrate()
    sys.exit(0 if ok else 1)

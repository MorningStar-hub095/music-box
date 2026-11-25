#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""歌曲自动分类器。

基于关键词规则为歌曲输出分类 ID，供 Node 端爬虫入库后调用：
  - genres: 流派（流行/摇滚/民谣/电子/嘻哈/R&B/古典/爵士/金属/朋克/子类）
  - moods: 情绪（欢快/悲伤/励志/浪漫/平静/激昂/怀旧/神秘）
  - scenes: 场景（运动/学习/工作/睡眠/驾驶/聚会/旅行/咖啡厅）
  - languages: 语言（中文/英文/日文/韩文/粤语/法语/西班牙语）
  - decades: 年代（默认空，不强行猜测）

分类 ID 与 server/prisma/schema.prisma 及 scripts/seed_data.sql 预设数据一致。
纯关键词匹配，不引入 ML 依赖。

用法：
  python auto_classifier.py --title "夜空中最亮的星" --artist "逃跑计划"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Dict, List


# ============================================================
# 关键词规则字典（ID 对应 scripts/seed_data.sql 预设分类）
# ============================================================

# 流派 genres: 1流行 2摇滚 3民谣 4电子 5嘻哈 6R&B 7古典 8爵士 9金属 10朋克
# 子类: 11华语流行 12欧美流行 13日韩流行 14House 15Techno 16Trance 17Dubstep
GENRE_KEYWORDS: Dict[str, int] = {
    '流行': 1, 'pop': 1,
    '摇滚': 2, '搖滾': 2, 'rock': 2,
    '民谣': 3, '民謠': 3, 'folk': 3,
    '电子': 4, '電子': 4, 'electronic': 4, 'edm': 4,
    '嘻哈': 5, 'hiphop': 5, 'hip-hop': 5, 'rap': 5,
    'r&b': 6, 'rnb': 6, '节奏布鲁斯': 6,
    '古典': 7, 'classical': 7,
    '爵士': 8, 'jazz': 8,
    '金属': 9, '金屬': 9, 'metal': 9,
    '朋克': 10, 'punk': 10,
    # 子类
    '华语流行': 11, '華語流行': 11,
    '欧美流行': 12, '歐美流行': 12,
    '日韩流行': 13, '日韓流行': 13,
    'house': 14,
    'techno': 15,
    'trance': 16,
    'dubstep': 17,
}

# 情绪 moods: 1欢快 2悲伤 3励志 4浪漫 5平静 6激昂 7怀旧 8神秘
MOOD_KEYWORDS: Dict[str, int] = {
    '欢快': 1, '歡快': 1, 'happy': 1, '快乐': 1, '快樂': 1,
    '悲伤': 2, '悲傷': 2, 'sad': 2, '伤感': 2, '傷感': 2, '哀': 2,
    '励志': 3, '勵志': 3, 'inspire': 3, 'inspirational': 3,
    '浪漫': 4, 'romantic': 4,
    '平静': 5, '平靜': 5, 'calm': 5, '安静': 5, '安靜': 5, '宁静': 5, '寧靜': 5,
    '激昂': 6, '燃': 6, '热血': 6, '熱血': 6, 'energetic': 6,
    '怀旧': 7, '懷舊': 7, 'classic': 7, 'nostalgia': 7, '复古': 7, '復古': 7,
    '神秘': 8, 'mystery': 8, 'mysterious': 8,
}

# 场景 scenes: 1运动 2学习 3工作 4睡眠 5驾驶 6聚会 7旅行 8咖啡厅
SCENE_KEYWORDS: Dict[str, int] = {
    '运动': 1, '運動': 1, 'workout': 1, 'fitness': 1, '跑步': 1, '健身': 1,
    '学习': 2, '學習': 2, 'study': 2,
    '工作': 3, 'work': 3,
    '睡眠': 4, 'sleep': 4, '夜': 4, 'night': 4, '晚安': 4, '催眠': 4,
    '驾驶': 5, '駕駛': 5, 'drive': 5, 'driving': 5, '公路': 5,
    '聚会': 6, '聚會': 6, 'party': 6, 'club': 6, 'dance': 6,
    '旅行': 7, 'travel': 7, '旅途': 7, '远方': 7, '遠方': 7,
    '咖啡': 8, 'coffee': 8, 'cafe': 8,
}

# 语言显式关键词（在 Unicode 检测之前优先匹配）
# 5粤语 6法语 7西班牙语
LANGUAGE_KEYWORDS: Dict[str, int] = {
    '粤语': 5, '粵語': 5, '广东话': 5, '廣東話': 5, 'cantonese': 5,
    '法语': 6, '法語': 6, 'french': 6, 'français': 6, 'francais': 6,
    '西班牙语': 7, '西班牙語': 7, 'spanish': 7, 'español': 7, 'espanol': 7,
}


# ============================================================
# Unicode 范围正则
# ============================================================

# CJK 统一表意文字（中文/日文汉字共享此区）
_CJK_RE = re.compile(r'[\u4e00-\u9fff]')
# 平假名 + 片假名（日文独有）
_KANA_RE = re.compile(r'[\u3040-\u30ff]')
# 韩文谚文（韩文独有）
_HANGUL_RE = re.compile(r'[\uac00-\ud7af]')
# 纯 ASCII
_ASCII_ONLY_RE = re.compile(r'^[\x00-\x7f]+$')


# ============================================================
# 匹配函数
# ============================================================

def _match_keywords(text: str, keyword_map: Dict[str, int]) -> List[int]:
    """在文本中匹配关键词，返回去重后的分类 ID 列表（按命中顺序）。"""
    if not text:
        return []
    text_lower = text.lower()
    matched: List[int] = []
    seen = set()
    for keyword, kid in keyword_map.items():
        if keyword.lower() in text_lower and kid not in seen:
            matched.append(kid)
            seen.add(kid)
    return matched


def _detect_language(text: str) -> List[int]:
    """从文本检测语言分类 ID。

    优先级：
      1. 显式语言关键词（粤语/法语/西班牙语等）
      2. 韩文谚文 -> 4
      3. 日文假名 -> 3
      4. 中文字符（且无日韩独有字符）-> 1
      5. 全 ASCII 英文 -> 2
      6. 无法判定 -> []（让 Node 端决定）
    """
    if not text or not text.strip():
        return []

    # 1. 显式语言关键词
    text_lower = text.lower()
    for keyword, lang_id in LANGUAGE_KEYWORDS.items():
        if keyword.lower() in text_lower:
            return [lang_id]

    # 2. 韩文谚文
    if _HANGUL_RE.search(text):
        return [4]

    # 3. 日文假名（平假名/片假名）
    if _KANA_RE.search(text):
        return [3]

    # 4. 中文字符（CJK 统一表意文字，且无日韩独有字符）
    if _CJK_RE.search(text):
        return [1]

    # 5. 全 ASCII 英文
    if _ASCII_ONLY_RE.match(text.strip()):
        return [2]

    # 6. 无法判定
    return []


# ============================================================
# 公开 API
# ============================================================

def classify_song(title: str, artist: str, album: str = '',
                  lyric: str = '') -> Dict[str, List[int]]:
    """对单首歌曲进行关键词分类。

    Args:
        title: 歌曲标题。
        artist: 艺术家名。
        album: 专辑名（可选）。
        lyric: 歌词文本（可选，用于提升匹配覆盖面）。

    Returns:
        分类 ID 字典，形如::

            {
                'genres': [1, 2],      # 流派 ID
                'moods': [3, 4],       # 情绪 ID
                'scenes': [4, 8],      # 场景 ID
                'languages': [1],      # 语言 ID
                'decades': [],         # 年代 ID（默认空）
            }

        命中为空的维度返回空列表，由 Node 端决定是否回退到默认值。
    """
    title = title or ''
    artist = artist or ''
    album = album or ''
    lyric = lyric or ''

    # 流派/情绪/场景：在标题+艺人+专辑+歌词全文中匹配
    full_text = f'{title} {artist} {album} {lyric}'

    # 语言检测仅用标题+艺人（更可靠，避免歌词噪声）
    lang_text = f'{title} {artist}'

    return {
        'genres': _match_keywords(full_text, GENRE_KEYWORDS),
        'moods': _match_keywords(full_text, MOOD_KEYWORDS),
        'scenes': _match_keywords(full_text, SCENE_KEYWORDS),
        'languages': _detect_language(lang_text),
        'decades': [],  # 标题/艺人无法可靠推断年代，不强行猜测
    }


def classify_songs(songs_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """批量分类歌曲。

    Args:
        songs_list: 歌曲字典列表，每个字典应含 ``title``/``artist`` 键，
            可选 ``album``、``lyric`` 或 ``lyricContent`` 键。

    Returns:
        原列表的浅拷贝，每项新增 ``classification`` 键存放分类结果，
        不修改传入的原字典。
    """
    results: List[Dict[str, Any]] = []
    for song in songs_list:
        song_copy = dict(song)
        song_copy['classification'] = classify_song(
            title=song.get('title', ''),
            artist=song.get('artist', ''),
            album=song.get('album', ''),
            lyric=song.get('lyric', '') or song.get('lyricContent', ''),
        )
        results.append(song_copy)
    return results


# ============================================================
# CLI 入口
# ============================================================

def main() -> int:
    parser = argparse.ArgumentParser(description='歌曲自动分类器（关键词匹配）')
    parser.add_argument('--title', required=True, help='歌曲标题')
    parser.add_argument('--artist', required=True, help='艺术家')
    parser.add_argument('--album', default='', help='专辑名')
    parser.add_argument('--lyric', default='', help='歌词片段')
    args = parser.parse_args()

    result = classify_song(args.title, args.artist, args.album, args.lyric)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

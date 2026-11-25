#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量更新 tracks.json 中缺失的 duration 字段。

通过网易云 API 获取歌曲详情，提取 dt 字段（毫秒），更新到 tracks.json。
"""

from __future__ import annotations
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# 添加 tools 目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import netease_crawler
except ImportError:
    print('[ERROR] 无法导入 netease_crawler', file=sys.stderr)
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS_FILE = os.path.join(BASE_DIR, 'shared', 'tracks.json')


def extract_netease_id(song_id: str) -> str:
    """从 'netease:123456' 格式中提取纯数字 ID"""
    if ':' in song_id:
        return song_id.split(':')[-1]
    return song_id


def fetch_duration(song_id: str) -> int:
    """获取单首歌曲的时长（毫秒）"""
    netease_id = extract_netease_id(song_id)
    if not netease_id or not netease_id.isdigit():
        return 0
    try:
        detail = netease_crawler.get_song_detail(netease_id)
        if detail and detail.get('duration', 0) > 0:
            # get_song_detail 返回秒，转换为毫秒
            return detail['duration'] * 1000
    except Exception as e:
        print(f'[WARN] 获取时长失败 {song_id}: {e}', file=sys.stderr)
    return 0


def main():
    # 读取 tracks.json
    with open(TRACKS_FILE, 'r', encoding='utf-8') as f:
        tracks = json.load(f)

    print(f'[INFO] 共 {len(tracks)} 首歌曲')

    # 找出缺少 duration 的歌曲
    missing = [t for t in tracks if not t.get('duration') or t.get('duration', 0) <= 0]
    print(f'[INFO] 缺少 duration 的歌曲: {len(missing)} 首')

    if not missing:
        print('[INFO] 所有歌曲都有 duration，无需更新')
        return

    # 并发获取时长（最多 5 个并发，避免对 API 造成压力）
    updated = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_track = {
            executor.submit(fetch_duration, t['id']): t
            for t in missing
        }

        for i, future in enumerate(as_completed(future_to_track)):
            track = future_to_track[future]
            try:
                duration_ms = future.result()
                if duration_ms > 0:
                    track['duration'] = duration_ms
                    updated += 1
                    print(f'[OK] {track["title"]} - {track["artist"]}: {duration_ms}ms ({duration_ms // 60000}:{(duration_ms % 60000) // 1000:02d})')
                else:
                    failed += 1
                    print(f'[SKIP] {track["title"]} - {track["artist"]}: 无法获取时长', file=sys.stderr)
            except Exception as e:
                failed += 1
                print(f'[ERROR] {track["title"]}: {e}', file=sys.stderr)

            # 每 20 首保存一次，避免中途崩溃丢失数据
            if (i + 1) % 20 == 0:
                with open(TRACKS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(tracks, f, ensure_ascii=False, indent=2)
                print(f'[INFO] 已保存进度: {i + 1}/{len(missing)}')

            # 请求间隔，避免触发频率限制
            time.sleep(0.1)

    # 最终保存
    with open(TRACKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(tracks, f, ensure_ascii=False, indent=2)

    print(f'\n[完成] 更新成功: {updated} 首, 失败: {failed} 首')
    print(f'[INFO] 已保存到 {TRACKS_FILE}')


if __name__ == '__main__':
    main()

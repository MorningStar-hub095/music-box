#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量补充歌曲封面图"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netease_crawler as nc

json_path = os.path.join(os.path.dirname(__file__), '..', 'shared', 'tracks_crawled.json')
with open(json_path, 'r', encoding='utf-8') as f:
    songs = json.load(f)

updated = 0
for i, song in enumerate(songs):
    if song.get('albumCover'):
        updated += 1
        continue
    # 从ID提取netease歌曲ID
    sid = song['id'].replace('netease:', '')
    try:
        detail = nc.get_song_detail(sid)
        if detail and detail.get('cover'):
            song['albumCover'] = detail['cover']
            updated += 1
            print(f'[{i+1}/{len(songs)}] {song["title"]} -> {detail["cover"][:60]}...')
        else:
            print(f'[{i+1}/{len(songs)}] {song["title"]} -> 无封面')
    except Exception as e:
        print(f'[{i+1}/{len(songs)}] {song["title"]} -> 错误: {e}')
    time.sleep(0.2)

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(songs, f, ensure_ascii=False, indent=2)

print(f'\n完成: {updated}/{len(songs)} 首有封面')

#!/usr/bin/env python3
"""按标题+歌手在网易云搜索并获取可播放 URL（跨源降级：qq/酷狗或网易云 VIP 歌曲回退到网易云搜索替代）。"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netease_crawler import search_songs, get_song_url


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "用法: search_song_url.py <标题> [歌手]"}))
        sys.exit(1)

    title = sys.argv[1]
    artist = sys.argv[2] if len(sys.argv) > 2 else ''
    query = f"{title} {artist}".strip()

    try:
        songs = search_songs(query, limit=5)
        # 优先免费歌曲（fee=0），再退而求其次
        for s in songs:
            if s.get('fee') == 0:
                url = get_song_url(s['id'])
                if url:
                    print(json.dumps({
                        "success": True,
                        "url": url,
                        "songId": s['id'],
                        "title": s.get('title', ''),
                        "artist": s.get('artist', ''),
                    }))
                    return
        for s in songs:
            url = get_song_url(s['id'])
            if url:
                print(json.dumps({
                    "success": True,
                    "url": url,
                    "songId": s['id'],
                    "title": s.get('title', ''),
                    "artist": s.get('artist', ''),
                }))
                return
        print(json.dumps({"success": False, "error": "搜索无结果或无免费可播放地址"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()

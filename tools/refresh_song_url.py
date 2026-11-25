#!/usr/bin/env python3
"""从网易云音乐重新获取歌曲的播放 URL（用于刷新过期的音频链接）。"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netease_crawler import get_song_url


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "用法: refresh_song_url.py <song_id>"}))
        sys.exit(1)

    raw_id = sys.argv[1]
    # 支持 "netease:12345" 或纯数字 "12345" 两种格式
    numeric_id = raw_id.split(":")[-1] if ":" in raw_id else raw_id

    try:
        url = get_song_url(numeric_id)
        if url:
            print(json.dumps({"success": True, "url": url}))
        else:
            print(json.dumps({"success": False, "error": "无法获取播放地址"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()

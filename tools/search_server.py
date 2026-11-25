#!/usr/bin/env python3
"""音乐盒子搜索微服务 - 提供 HTTP API 供 Web/小程序调用爬虫搜索和入库。"""
import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# 确保能导入 music_crawler
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import music_crawler

TRACKS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'shared', 'tracks.json')
PORT = 7878


class SearchHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._send_cors()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == '/api/search':
            q = params.get('q', [''])[0]
            if not q:
                self._send_json(400, {'error': '缺少参数 q'})
                return
            results = music_crawler.search_all(q, limit=10)
            data = [
                {
                    'id': t.id,
                    'platform': t.platform,
                    'title': t.title,
                    'artist': t.artist,
                    'album': t.album,
                    'albumCover': t.albumCover,
                    'lyricContent': t.lyricContent,
                    'audioUrl': t.audioUrl,
                    'playable': t.playable,
                }
                for t in results
            ]
            self._send_json(200, {'results': data})
            return

        self._send_json(404, {'error': '未知端点'})

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/add':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                track = json.loads(body)
            except json.JSONDecodeError:
                self._send_json(400, {'error': '无效 JSON'})
                return

            # 读取现有 tracks
            if os.path.exists(TRACKS_FILE):
                with open(TRACKS_FILE, 'r', encoding='utf-8') as f:
                    tracks = json.load(f)
            else:
                tracks = []

            # 去重
            if any(t.get('id') == track.get('id') for t in tracks):
                self._send_json(200, {'message': '曲目已存在', 'skipped': True})
                return

            # 追加
            if 'coverColor' not in track:
                track['coverColor'] = '#17C3B2'
            if 'playable' not in track:
                track['playable'] = True
            tracks.append(track)

            with open(TRACKS_FILE, 'w', encoding='utf-8') as f:
                json.dump(tracks, f, ensure_ascii=False, indent=2)

            self._send_json(200, {'message': '添加成功', 'track': track})
            return

        self._send_json(404, {'error': '未知端点'})

    def log_message(self, format, *args):
        print(f'[SearchServer] {args[0]}')


def main():
    print(f'[SearchServer] 启动搜索微服务 http://localhost:{PORT}')
    server = HTTPServer(('127.0.0.1', PORT), SearchHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[SearchServer] 已停止')
        server.server_close()


if __name__ == '__main__':
    main()

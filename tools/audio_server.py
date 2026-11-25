#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
音频 URL 自动刷新服务

功能：
  1. 提供 HTTP API 检测音频 URL 是否失效
  2. 失效时自动从网易云重新获取新鲜 URL
  3. 同步更新 shared/tracks.json

端点：
  GET /api/health                    - 健康检查
  GET /api/check-all                 - 检查所有曲目 URL 状态
  GET /api/refresh-track?id=xxx      - 刷新单首曲目 URL
  GET /api/refresh-all               - 检查并刷新所有失效 URL

启动：
  python tools/audio_server.py
  默认端口 8765
"""
from __future__ import annotations

import json
import os
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# 添加 tools 目录到 path，以便导入 netease_crawler
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, TOOLS_DIR)

TRACKS_FILE = os.path.join(BASE_DIR, 'shared', 'tracks.json')
PORT = int(os.environ.get('AUDIO_SERVER_PORT', '8765'))

# 文件锁，避免并发写入 tracks.json
_file_lock = threading.Lock()


def load_tracks():
    """加载 tracks.json"""
    try:
        with open(TRACKS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f'[ERROR] 读取 tracks.json 失败: {e}', file=sys.stderr)
        return []


def save_tracks(tracks):
    """保存 tracks.json"""
    with _file_lock:
        with open(TRACKS_FILE, 'w', encoding='utf-8') as f:
            json.dump(tracks, f, ensure_ascii=False, indent=2)


def check_url_valid(url, timeout=5):
    """检查 URL 是否有效（HEAD 请求，返回 (有效, 状态码, 大小KB)）"""
    try:
        req = urllib.request.Request(url, method='HEAD', headers={
            'User-Agent': 'Mozilla/5.0',
        })
        resp = urllib.request.urlopen(req, timeout=timeout)
        size_kb = int(resp.headers.get('Content-Length', 0)) // 1024
        return (True, resp.status, size_kb)
    except urllib.error.HTTPError as e:
        return (False, e.code, 0)
    except Exception as e:
        return (False, str(e)[:50], 0)


def extract_song_id(track_id):
    """从 track.id (如 'netease:2730151393') 提取网易云 song_id"""
    if ':' in track_id:
        parts = track_id.split(':')
        if len(parts) >= 2 and parts[0] == 'netease':
            return parts[1]
    return ''


def refresh_track_url(track_id):
    """刷新单首曲目的 URL
    
    返回: dict { success: bool, new_url: str, message: str }
    """
    song_id = extract_song_id(track_id)
    if not song_id:
        return {'success': False, 'new_url': '', 'message': f'无法解析 song_id: {track_id}'}

    try:
        import netease_crawler
    except Exception as e:
        return {'success': False, 'new_url': '', 'message': f'无法加载爬虫模块: {e}'}

    # 获取新 URL
    new_url = netease_crawler.get_song_url(song_id)
    if not new_url:
        return {'success': False, 'new_url': '', 'message': f'爬虫未返回 URL (song_id={song_id})'}

    # 验证新 URL
    valid, status, size_kb = check_url_valid(new_url, timeout=8)
    if not valid:
        return {'success': False, 'new_url': '', 'message': f'新 URL 验证失败 (status={status})'}

    if size_kb < 500:
        return {'success': False, 'new_url': '', 'message': f'新 URL 文件过小 ({size_kb}KB)，可能是试听片段'}

    # 更新 tracks.json
    tracks = load_tracks()
    updated = False
    for t in tracks:
        if t['id'] == track_id:
            old_size = 0
            # 检查旧 URL 是否真失效
            if t.get('audioUrl'):
                old_valid, _, _ = check_url_valid(t['audioUrl'], timeout=3)
                if old_valid:
                    # 旧 URL 还有效，无需更新
                    return {
                        'success': True,
                        'new_url': t['audioUrl'],
                        'message': f'URL 仍然有效，无需刷新',
                        'updated': False,
                    }
            t['audioUrl'] = new_url
            t['playable'] = True
            updated = True
            break

    if not updated:
        return {'success': False, 'new_url': '', 'message': f'未在 tracks.json 中找到曲目: {track_id}'}

    save_tracks(tracks)
    print(f'[REFRESH] {track_id} -> 新 URL ({size_kb}KB)')
    return {
        'success': True,
        'new_url': new_url,
        'message': f'URL 已刷新 ({size_kb}KB)',
        'updated': True,
    }


def refresh_all_invalid():
    """检查并刷新所有失效 URL
    
    返回: dict { total: int, valid: int, refreshed: int, failed: int, details: [] }
    """
    tracks = load_tracks()
    total = len(tracks)
    valid_count = 0
    refreshed = 0
    failed = 0
    details = []

    for t in tracks:
        track_id = t['id']
        url = t.get('audioUrl', '')
        if not url:
            failed += 1
            details.append({'id': track_id, 'title': t.get('title', ''), 'status': 'no_url'})
            continue

        valid, status, _ = check_url_valid(url, timeout=5)
        if valid:
            valid_count += 1
            details.append({'id': track_id, 'title': t.get('title', ''), 'status': 'valid'})
            continue

        # 失效，尝试刷新
        print(f'[CHECK] {t.get("title", "")} URL 失效 (status={status})，正在刷新...')
        result = refresh_track_url(track_id)
        if result['success']:
            refreshed += 1
            details.append({
                'id': track_id,
                'title': t.get('title', ''),
                'status': 'refreshed',
                'new_url': result['new_url'],
            })
        else:
            failed += 1
            details.append({
                'id': track_id,
                'title': t.get('title', ''),
                'status': 'failed',
                'message': result['message'],
            })

    return {
        'total': total,
        'valid': valid_count,
        'refreshed': refreshed,
        'failed': failed,
        'details': details,
    }


class AudioServerHandler(BaseHTTPRequestHandler):
    """HTTP 请求处理器"""

    def _set_cors_headers(self):
        """设置 CORS 头"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def _send_json(self, data, status=200):
        """发送 JSON 响应"""
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, message, status=400):
        """发送错误响应"""
        self._send_json({'success': False, 'error': message}, status)

    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        """处理 GET 请求"""
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == '/api/health':
            self._send_json({'status': 'ok', 'service': 'audio-server', 'port': PORT})
            return

        if path == '/api/check-all':
            tracks = load_tracks()
            result = []
            for t in tracks:
                url = t.get('audioUrl', '')
                if not url:
                    result.append({
                        'id': t['id'],
                        'title': t.get('title', ''),
                        'valid': False,
                        'reason': 'no_url',
                    })
                    continue
                valid, status, size_kb = check_url_valid(url, timeout=5)
                result.append({
                    'id': t['id'],
                    'title': t.get('title', ''),
                    'valid': valid,
                    'status': status,
                    'size_kb': size_kb,
                })
            self._send_json({'tracks': result})
            return

        if path == '/api/refresh-track':
            track_id = params.get('id', [''])[0]
            if not track_id:
                self._send_error('缺少 id 参数')
                return
            result = refresh_track_url(track_id)
            self._send_json(result, 200 if result['success'] else 500)
            return

        if path == '/api/refresh-all':
            result = refresh_all_invalid()
            self._send_json(result)
            return

        self._send_error(f'未知路径: {path}', 404)

    def log_message(self, format, *args):
        """简化日志"""
        print(f'[{self.log_date_time_string()}] {format % args}')


def main():
    # 预加载爬虫模块
    try:
        import netease_crawler
        print(f'[INFO] 爬虫模块加载成功')
    except Exception as e:
        print(f'[WARN] 爬虫模块加载失败: {e}', file=sys.stderr)

    # 启动时检查一次 tracks.json
    tracks = load_tracks()
    print(f'[INFO] 已加载 {len(tracks)} 首曲目 from {TRACKS_FILE}')

    server = ThreadingHTTPServer(('127.0.0.1', PORT), AudioServerHandler)
    print(f'[INFO] 音频刷新服务已启动: http://127.0.0.1:{PORT}')
    print(f'[INFO] 端点:')
    print(f'  GET /api/health         - 健康检查')
    print(f'  GET /api/check-all      - 检查所有 URL 状态')
    print(f'  GET /api/refresh-track  - 刷新单首 URL (?id=xxx)')
    print(f'  GET /api/refresh-all    - 刷新所有失效 URL')
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[INFO] 服务已停止')
        server.shutdown()


if __name__ == '__main__':
    main()

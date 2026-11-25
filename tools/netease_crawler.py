#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网易云音乐爬虫工具
功能：
  1. 搜索歌曲 / 获取热门歌单
  2. 获取歌词 (LRC 格式)
  3. 获取歌曲详情和播放地址
  4. 导出 JSON 数据供 web/mini-app 使用
  5. 命令行模式：单曲歌词下载（供 C++ 调用）

用法：
  python netease_crawler.py search 周杰伦          # 搜索歌曲
  python netease_crawler.py lyric 123456           # 下载歌词（保存为 .lrc）
  python netease_crawler.py export --count 20      # 导出热门歌曲 JSON
  python netease_crawler.py lyric-id3 "艺术家 - 标题"  # 解析 ID3 获取歌词
"""

import sys
import os
import json
import base64
import hashlib
import random
import string
import subprocess
import time
from Crypto.Cipher import AES
import requests

try:
    from retry_utils import retry_on_network_error
except ImportError:
    # 允许在缺少 retry_utils 的环境下以无重试方式降级运行
    def retry_on_network_error(*_args, **_kwargs):
        def _decorator(func):
            return func
        return _decorator

# ========== 爬虫负载监控 ==========
# 严格模式：最大并发5、每请求间隔1-2秒、每日总量≤500首
MAX_CONCURRENCY = 5
REQUEST_DELAY_MIN = 1.0  # 秒
REQUEST_DELAY_MAX = 2.0  # 秒
DAILY_CRAWL_LIMIT = 500

try:
    import resource  # 仅 Unix；Windows 下降级为 psutil 或跳过
except ImportError:
    pass

# 全局状态文件路径
CRAWL_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.crawl_state.json')


def get_daily_crawl_count():
    """获取今日已爬取数量"""
    from datetime import date
    try:
        with open(CRAWL_STATE_FILE, 'r') as f:
            state = json.load(f)
        if state.get('date') == date.today().isoformat():
            return state.get('count', 0)
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass
    return 0


def increment_daily_crawl_count(n=1):
    """增加今日爬取计数"""
    from datetime import date
    state = {'date': date.today().isoformat(), 'count': get_daily_crawl_count() + n}
    try:
        with open(CRAWL_STATE_FILE, 'w') as f:
            json.dump(state, f)
    except IOError:
        pass


def is_daily_limit_reached():
    """检查是否达到每日爬取上限"""
    return get_daily_crawl_count() >= DAILY_CRAWL_LIMIT


def get_system_load():
    """获取系统负载（CPU使用率%）"""
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory().percent
        return cpu, mem
    except ImportError:
        # psutil 不可用时，返回安全值
        return 0, 0


def is_system_overloaded():
    """检查系统是否过载（CPU>80% 或 内存>85%）"""
    cpu, mem = get_system_load()
    return cpu > 80 or mem > 85


def crawl_delay():
    """请求间延迟（1-2秒随机）"""
    time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX))


# ============================================================
# 网易云 API 加密参数
# ============================================================
FIRST_KEY = b'0CoJUm6Qyw8W8jud'
IV = b'0102030405060708'
PUBLIC_KEY = int(
    '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d'
    '2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee2559'
    '32575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7', 16
)
MODULUS = int(
    '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d'
    '2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee2559'
    '32575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7', 16
)
EXPONENT = 0x010001


def pad(data):
    data_bytes = data.encode('utf-8')
    pad_len = 16 - len(data_bytes) % 16
    return data_bytes + bytes([pad_len]) * pad_len


def aes_encrypt(text, key):
    cipher = AES.new(key, AES.MODE_CBC, IV)
    encrypted = cipher.encrypt(pad(text))
    return base64.b64encode(encrypted).decode('utf-8')


def rsa_encrypt(text):
    # 简化版 RSA，直接使用固定的 encSecKey（网易 API 实际上不严格校验）
    # 反向字符串 + hex
    rev = text[::-1]
    return format(int(rev.encode().hex(), 16) ** EXPONENT % MODULUS, 'x').zfill(256)


def gen_params(data):
    """生成加密后的 params 和 encSecKey"""
    text = json.dumps(data, ensure_ascii=False)
    second_key = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))
    # 两次 AES 加密
    enc_text = aes_encrypt(aes_encrypt(text, FIRST_KEY), second_key.encode('utf-8'))
    enc_sec_key = rsa_encrypt(second_key)
    return {'params': enc_text, 'encSecKey': enc_sec_key}


# ============================================================
# API 方法
# ============================================================
SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://music.163.com/',
    'Origin': 'https://music.163.com',
    'Cookie': 'os=pc; osver=Microsoft-Windows-10-Professional-build-19045-64bit; appver=2.10.14; '
              'MUSIC_U=00C0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0; '
              '__remember_me=true; NMTID=00O0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0',
})


@retry_on_network_error()
def api_post(url, data):
    """加密 API 调用（weapi 端点）"""
    resp = SESSION.post(url, data=gen_params(data))
    if 500 <= resp.status_code < 600:
        raise requests.HTTPError(f"Server error {resp.status_code} for {url}")
    return resp.json()


@retry_on_network_error()
def api_get(url, params=None):
    """不加密 API 调用（/api/ 端点，无需 AES+RSA 加密）"""
    resp = SESSION.get(url, params=params or {})
    if 500 <= resp.status_code < 600:
        raise requests.HTTPError(f"Server error {resp.status_code} for {url}")
    return resp.json()


def linux_api(url, params):
    """Linux 客户端 API（AES-ECB 加密，与 weapi 不同，更稳定）
    
    作为第三备用：当 /api/ 和 /weapi/ 都失效时使用
    """
    from Crypto.Cipher import AES as _AES
    from Crypto.Util.Padding import pad as _pad
    LINUX_KEY = b'rFgB&h#%2?^eDg:Q'
    payload = json.dumps({
        'method': 'POST',
        'url': url,
        'params': params,
    }, ensure_ascii=False).encode('utf-8')
    cipher = _AES.new(LINUX_KEY, _AES.MODE_ECB)
    encrypted = cipher.encrypt(_pad(payload, _AES.block_size))
    eparams = base64.b64encode(encrypted).decode()
    resp = SESSION.post('https://music.163.com/api/linux/forward', data={'eparams': eparams})
    return resp.json()


def search_songs(keyword, limit=10):
    """搜索歌曲 - 多端点备用，优先返回免费歌曲
    
    fee 字段: 0=免费, 1=VIP, 4=专辑购买, 8=试听
    """
    songs = []
    
    # 方式1：不加密 API（更稳定）
    try:
        resp = api_get('https://music.163.com/api/search/get', {
            's': keyword,
            'type': 1,      # 1=单曲
            'limit': limit,
            'offset': 0,
        })
        if resp.get('code') == 200:
            for item in resp.get('result', {}).get('songs', []):
                songs.append({
                    'id': str(item['id']),
                    'title': item['name'],
                    'artist': ' / '.join(a['name'] for a in item.get('artists', [])),
                    'album': item.get('album', {}).get('name', ''),
                    'cover': item.get('album', {}).get('picUrl', ''),
                    'duration': item.get('duration', 0) // 1000,
                    'fee': item.get('fee', 0),  # 0=免费, 1=VIP, 8=试听
                })
    except Exception:
        pass

    # 方式2：加密 API（weapi 端点）
    if not songs:
        try:
            resp = api_post('https://music.163.com/weapi/cloudsearch/get/web', {
                's': keyword,
                'type': 1,
                'limit': limit,
                'offset': 0,
            })
            for item in resp.get('result', {}).get('songs', []):
                songs.append({
                    'id': str(item['id']),
                    'title': item['name'],
                    'artist': ' / '.join(a['name'] for a in item.get('ar', [])),
                    'album': item.get('al', {}).get('name', ''),
                    'cover': item.get('al', {}).get('picUrl', ''),
                    'duration': item.get('dt', 0) // 1000,
                    'fee': item.get('fee', 0),
                })
        except Exception:
            pass

    # 方式3：Linux API（最后备用）
    if not songs:
        try:
            result = linux_api('https://music.163.com/api/search/get', {
                's': keyword,
                'type': 1,
                'limit': limit,
                'offset': 0,
            })
            for item in result.get('result', {}).get('songs', []):
                songs.append({
                    'id': str(item['id']),
                    'title': item['name'],
                    'artist': ' / '.join(a['name'] for a in item.get('artists', [])),
                    'album': item.get('album', {}).get('name', ''),
                    'cover': item.get('album', {}).get('picUrl', ''),
                    'duration': item.get('duration', 0) // 1000,
                    'fee': item.get('fee', 0),
                })
        except Exception:
            pass

    # 排序：免费歌曲(fee=0)优先，然后是试听(fee=8)，最后是VIP(fee=1)
    songs.sort(key=lambda s: {0: 0, 8: 1, 4: 2, 1: 3}.get(s.get('fee', 0), 9))
    return songs


def get_song_detail(song_id):
    """获取歌曲详情（含播放地址）"""
    resp = api_post('https://music.163.com/weapi/v3/song/detail', {
        'c': json.dumps([{'id': int(song_id)}]),
    })
    if resp.get('code') != 200:
        return None
    songs = resp.get('songs', [])
    if not songs:
        return None
    s = songs[0]
    return {
        'id': str(s['id']),
        'title': s['name'],
        'artist': ' / '.join(a['name'] for a in s.get('ar', [])),
        'album': s.get('al', {}).get('name', ''),
        'cover': s.get('al', {}).get('picUrl', ''),
        'duration': s.get('dt', 0) // 1000,
    }


def get_lyric(song_id):
    """获取歌词 - 三端点备用"""
    # 方式1：不加密 API
    try:
        resp = api_get('https://music.163.com/api/song/lyric', {
            'id': str(song_id),
            'lv': -1,
            'tv': -1,
            'kv': -1,
        })
        lrc = resp.get('lrc', {})
        if lrc and lrc.get('lyric'):
            return lrc['lyric']
    except Exception:
        pass
    # 方式2：加密 API
    try:
        resp = api_post('https://music.163.com/weapi/song/lyric', {
            'id': str(song_id),
            'lv': -1,
            'tv': -1,
        })
        lrc = resp.get('lrc', {}) if resp.get('code') == 200 else {}
        if lrc.get('lyric'):
            return lrc['lyric']
    except Exception:
        pass
    # 方式3：Linux API
    try:
        result = linux_api('https://music.163.com/api/song/lyric', {
            'id': str(song_id),
            'lv': -1,
            'tv': -1,
            'kv': -1,
        })
        lrc = result.get('lrc', {})
        if lrc.get('lyric'):
            return lrc['lyric']
    except Exception:
        pass
    return ''


def get_song_url(song_id):
    """获取歌曲播放地址 - 多种方式尝试，自动跳过试听片段
    
    试听检测：30秒试听文件通常 <1MB，完整歌曲 >2MB
    降低阈值到 500KB，接受更多可播放结果（包括较短的完整歌曲）
    """
    best_url = ''
    best_size = 0
    best_fee = -1

    # 方式1：不加密 API，尝试多码率（128k 更容易获取完整音频）
    for br in [128000, 192000, 320000]:
        try:
            resp = api_get('https://music.163.com/api/song/enhance/player/url', {
                'ids': json.dumps([int(song_id)]),
                'br': br,
            })
            data = resp.get('data', [])
            if data and data[0].get('url'):
                url = data[0]['url']
                size = data[0].get('size', 0) or 0
                fee = data[0].get('fee', 0) or 0
                # 降低阈值：>500KB 接受（从1MB降低），排除纯试听片段
                if size > 500 * 1024 and size > best_size:
                    best_url = url
                    best_size = size
                    best_fee = fee
                # 如果是免费歌曲(fee=0)且 size 合理，直接返回
                if fee == 0 and size > 500 * 1024:
                    return url
        except Exception:
            pass

    if best_url:
        return best_url

    # 方式2：外链地址（直接重定向到音频文件）
    try:
        outer_url = f'https://music.163.com/song/media/outer/url?id={song_id}'
        resp = SESSION.get(outer_url, allow_redirects=True, timeout=10, stream=True)
        if resp.status_code == 200 and 'audio' in resp.headers.get('Content-Type', ''):
            # 检查 Content-Length，降低阈值到 500KB
            content_length = int(resp.headers.get('Content-Length', 0))
            if content_length > 500 * 1024:  # >500KB
                return resp.url
        resp.close()
    except Exception:
        pass

    # 方式3：加密 API（回退）
    try:
        resp = api_post('https://music.163.com/weapi/song/enhance/player/url', {
            'ids': json.dumps([int(song_id)]),
            'br': 128000,
        })
        data = resp.get('data', [])
        if data and data[0].get('url'):
            url = data[0]['url']
            size = data[0].get('size', 0) or 0
            if size > 500 * 1024:
                return url
    except Exception:
        pass

    # 方式4：Linux API（不同加密方式，更稳定）
    try:
        result = linux_api('https://music.163.com/api/song/enhance/player/url', {
            'ids': json.dumps([int(song_id)]),
            'br': 128000,
        })
        data = result.get('data', [])
        if data and data[0].get('url'):
            url = data[0]['url']
            size = data[0].get('size', 0) or 0
            if size > 500 * 1024:
                return url
    except Exception:
        pass

    return ''


def get_top_playlist_songs(limit=20):
    """获取热门歌单中的歌曲"""
    # 官方热门推荐歌单 ID
    hot_playlists = [
        '3778678',   # 热歌榜
        '2884035',   # 官方榜
        '19723756',  # 飙升榜
        '3779629',   # 新歌榜
    ]

    all_songs = {}
    for pl_id in hot_playlists:
        if len(all_songs) >= limit * 3:
            break
        try:
            resp = api_post('https://music.163.com/weapi/v6/playlist/detail', {
                'id': pl_id,
                'n': limit,
            })
            tracks = resp.get('playlist', {}).get('tracks', [])
            for track in tracks:
                sid = str(track['id'])
                if sid in all_songs:
                    continue
                all_songs[sid] = {
                    'id': sid,
                    'title': track['name'],
                    'artist': ' / '.join(a['name'] for a in track.get('ar', [])),
                    'album': track.get('al', {}).get('name', ''),
                    'cover': track.get('al', {}).get('picUrl', ''),
                    'duration': track.get('dt', 0) // 1000,
                    'lyric': '',
                    'audioUrl': '',
                }
        except Exception as e:
            print(f'[WARN] 获取歌单 {pl_id} 失败: {e}', file=sys.stderr)

    # 对前 limit 首歌填充歌词和播放地址（并行化以加速）
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def fetch_song_details(song_item):
        """单首歌的歌词和URL获取（供线程池调用）"""
        # 熔断检查
        if is_daily_limit_reached():
            return song_item  # 返回未填充的歌曲
        sid = song_item['id']
        try:
            song_item['lyric'] = get_lyric(sid)
            song_item['audioUrl'] = get_song_url(sid)
        except Exception as e:
            print(f'[WARN] 获取 {song_item["title"]} 详情失败: {e}', file=sys.stderr)
            song_item['lyric'] = song_item.get('lyric', '')
            song_item['audioUrl'] = song_item.get('audioUrl', '')
        return song_item

    result = []
    songs_to_fetch = list(all_songs.values())[:limit]
    print(f'[INFO] 并行获取 {len(songs_to_fetch)} 首歌曲详情（最多5并发）...', file=sys.stderr)

    with ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as executor:
        futures = {executor.submit(fetch_song_details, song): song for song in songs_to_fetch}
        for i, future in enumerate(as_completed(futures)):
            try:
                song = future.result()
                print(f'  [{i+1}/{len(songs_to_fetch)}] 完成: {song["title"]} - {song["artist"]}', file=sys.stderr)
                result.append(song)
            except Exception as e:
                print(f'[WARN] 歌曲详情获取失败: {e}', file=sys.stderr)

    # 保持原始顺序
    song_order = {sid: i for i, sid in enumerate(list(all_songs.keys())[:limit])}
    result.sort(key=lambda s: song_order.get(s['id'], 999))

    return result


def export_tracks_json(count=20, output_path=None):
    """导出歌曲数据为 JSON 文件"""
    if output_path is None:
        output_path = os.path.join(os.path.dirname(__file__), '..', 'shared', 'tracks.json')

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f'正在获取热门歌曲 {count} 首...')
    songs = get_top_playlist_songs(count)

    # 转换成前端需要的格式（每首歌内嵌 LRC 歌词）
    tracks = []
    colors = ['#17C3B2', '#8B5CF6', '#F59E0B', '#10B981', '#3B82F6',
              '#EF4444', '#EC4899', '#6366F1', '#14B8A6', '#F97316']
    for i, song in enumerate(songs):
        # 去掉歌词中的元信息行（标题、艺术家行）
        lyric_lines = song['lyric'].split('\n')
        cleaned_lyric = '\n'.join(
            line for line in lyric_lines
            if not line.strip().startswith('[ti:') and
            not line.strip().startswith('[ar:') and
            not line.strip().startswith('[al:') and
            not line.strip().startswith('[by:') and
            not line.strip().startswith('[offset:')
        )
        tracks.append({
            'id': song['id'],
            'title': song['title'],
            'artist': song['artist'],
            'audioUrl': song['audioUrl'] or f'https://music.163.com/song/media/outer/url?id={song["id"]}.mp3',
            'lyricContent': cleaned_lyric.strip(),
            'coverColor': colors[i % len(colors)],
            'albumCover': song['cover'],
        })

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(tracks, f, ensure_ascii=False, indent=2)

    print(f'\n导出完成: {output_path} ({len(tracks)} 首歌曲)')
    return tracks


def download_song_lyric(song_id, output_dir=None):
    """为单首歌曲下载 LRC 歌词文件"""
    if output_dir is None:
        output_dir = os.getcwd()

    song = get_song_detail(song_id)
    if not song:
        print(f'[ERROR] 歌曲 {song_id} 未找到', file=sys.stderr)
        return False

    lyric = get_lyric(song_id)
    if not lyric:
        print(f'[ERROR] 歌词 {song_id} 为空', file=sys.stderr)
        return False

    # 生成安全的文件名
    safe_name = f"{song['artist']} - {song['title']}"
    safe_name = safe_name.replace('/', '_').replace('\\', '_').replace(':', '_')
    lrc_path = os.path.join(output_dir, f'{safe_name}.lrc')

    with open(lrc_path, 'w', encoding='utf-8') as f:
        f.write(lyric)

    print(f'[OK] 歌词已保存: {lrc_path}')
    return True


def search_and_download_lyric(keyword, output_dir=None):
    """通过关键词搜索歌曲并下载第一首歌词"""
    if output_dir is None:
        output_dir = os.getcwd()

    print(f'搜索: {keyword} ...')
    songs = search_songs(keyword, limit=1)
    if not songs:
        print(f'[ERROR] 未找到相关歌曲', file=sys.stderr)
        return False

    song = songs[0]
    print(f'找到: {song["title"]} - {song["artist"]} (ID: {song["id"]})')
    return download_song_lyric(song['id'], output_dir)


def extract_keyword_from_filename(filepath):
    """从文件名提取艺术家和标题关键词"""
    name = os.path.splitext(os.path.basename(filepath))[0]
    # 常见分隔符
    for sep in [' - ', ' -', '- ', '-', ' – ', ' _ ']:
        if sep in name:
            return name
    return name


# ============================================================
# CLI 入口
# ============================================================
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'search':
        keyword = sys.argv[2] if len(sys.argv) > 2 else input('搜索关键词: ')
        songs = search_songs(keyword, limit=10)
        for song in songs:
            print(json.dumps(song, ensure_ascii=False))

    elif cmd == 'lyric':
        song_id = sys.argv[2]
        output_dir = sys.argv[3] if len(sys.argv) > 3 else None
        download_song_lyric(song_id, output_dir)

    elif cmd == 'lyric-search':
        # C++ 调用入口：传入关键词，下载第一首歌词
        # 用法: python netease_crawler.py lyric-search "关键词" [输出目录]
        keyword = sys.argv[2]
        output_dir = sys.argv[3] if len(sys.argv) > 3 else None
        success = search_and_download_lyric(keyword, output_dir)
        sys.exit(0 if success else 1)

    elif cmd == 'lyric-file':
        # C++ 调用入口：传入音频文件路径，自动提取文件名搜索歌词
        # 用法: python netease_crawler.py lyric-file "D:/music/song.mp3" [输出目录]
        filepath = sys.argv[2]
        output_dir = sys.argv[3] if len(sys.argv) > 3 else None
        if output_dir is None:
            output_dir = os.path.dirname(filepath)
        keyword = extract_keyword_from_filename(filepath)
        success = search_and_download_lyric(keyword, output_dir)
        sys.exit(0 if success else 1)

    elif cmd == 'export':
        count = 20
        output_path = None
        args = sys.argv[2:]
        i = 0
        while i < len(args):
            if args[i] == '--count' and i + 1 < len(args):
                count = int(args[i + 1])
                i += 2
            elif args[i] == '--output' and i + 1 < len(args):
                output_path = args[i + 1]
                i += 2
            else:
                i += 1
        export_tracks_json(count, output_path)

    else:
        print(f'未知命令: {cmd}')
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()

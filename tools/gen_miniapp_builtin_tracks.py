#!/usr/bin/env python3
"""
生成小程序内置兜底曲库 mini-app/src/data/tracks-builtin.ts
从 shared/tracks.json 取前 50 首可播曲目，歌词截断到 160 字符，
控制主包体积（微信主包上限 2MB）。

用法：python tools/gen_miniapp_builtin_tracks.py
"""
import json
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'shared', 'tracks.json')
DST = os.path.join(ROOT, 'mini-app', 'src', 'data', 'tracks-builtin.ts')
MAX_TRACKS = 50
LYRIC_MAX = 160


def q(s):
    if s is None:
        return 'null'
    return json.dumps(str(s), ensure_ascii=False)


def main():
    with io.open(SRC, encoding='utf-8') as f:
        data = json.load(f)
    usable = [t for t in data if t.get('audioUrl') and t.get('playable') is not False][:MAX_TRACKS]

    lines = [
        '// src/data/tracks-builtin.ts',
        '// 内置兜底曲库（由 tools 脚本从 shared/tracks.json 生成，仅前 %d 首可播曲目）' % MAX_TRACKS,
        '// 说明：完整曲库（约千首/1.2MB）不再打包进主包——微信小程序主包限 2MB；',
        '// 且 shared/tracks.json 中的音频为带过期时间的临时直链，过期后本兜底集同样失效，',
        '// 长期方案见 fetchTracksFromApi()（改走 /api/songs 接口）。',
        '// 重新生成：python tools/gen_miniapp_builtin_tracks.py',
        "import { Track } from '@/types';",
        '',
        'export const builtinTracks: Track[] = [',
    ]
    for t in usable:
        # 版权合规：歌词是受版权保护的内容，公开发布的仓库/小程序不内嵌歌词文本，
        # 仅保留曲目元数据（歌名/歌手/专辑为事实性信息）；封面走网易云 CDN 直链。
        lines.append(
            '  { id: %s, title: %s, artist: %s, album: %s, albumCover: %s, audioUrl: %s, '
            "lyricContent: '', coverColor: %s, platform: %s, playable: true }," % (
                q(t.get('id')), q(t.get('title')), q(t.get('artist')), q(t.get('album')),
                q(t.get('albumCover')), q(t.get('audioUrl')),
                q(t.get('coverColor') or '#17C3B2'), q(t.get('platform') or 'netease')))
    lines += ['];', '']

    with io.open(DST, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    print('generated %d tracks -> %s' % (len(usable), DST))


if __name__ == '__main__':
    main()

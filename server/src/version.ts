/**
 * 应用版本管理与更新日志（单一事实来源）
 *
 * - APP_VERSION 与 server/package.json、desktop/package.json、根 package.json 保持一致，
 *   使用 `node scripts/bump-version.js <version>` 统一更新；
 * - CHANGELOG 按版本倒序记录，每次功能优化新增一条；
 * - 桌面版主进程启动时通过 GET /api/version 获取版本与日志，
 *   与本地已确认版本比对后弹窗提示更新内容。
 */

export const APP_VERSION = '1.4.7';

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.4.7',
    date: '2026-11-25',
    changes: [
      '【性能】推荐 MMR 重排只对融合分 Top-50 做多样性重排（原全量 1000 首约 O(n³) 相似度计算），每日推荐首生成不再秒级阻塞，电台个性化 3s 竞速可正常命中',
      '【修复】相似歌曲推荐 N+1：循环内 500 次逐首特征查询改为单次批量查询',
      '【重构】AI 增强信号改为独立新颖度评分（风格/艺术家新颖度 + 跳过抑制 + 探索趋势调节），消除与规则引擎的双重计算',
      '【重构】收藏信号改为收藏质心相似度（未听过的、接近收藏口味的歌曲获得加权），移除 +0.3 硬加分，保持 0-1 分数尺度',
      '【修复】每日推荐兜底热歌与主候选池统一过滤标准（排除播客/异常内容，优先有特征歌曲）',
      '【优化】协同过滤在相似用户为空（桌面单用户常态）时权重自动重分配给内容/规则引擎；协同分数恒定检测在融合层完成',
      '【优化】用户画像消费反馈强度：favorite/like 正向强化、dislike 负向抑制对应风格/情绪权重',
      '【性能】真实声学特征管线落地：对内置曲库 664 首离线提取 8 维频谱特征 + bpm/energy 写回 song_features（此前全库 0.5 占位导致内容过滤/相似歌/基因图谱/情绪 DNA 全链路退化），基因图谱 PCA 坐标同步重算',
      '【优化】推荐配置持久化：PUT /config 修改落盘 data/rec-config.json，重启不再丢失',
      '【优化】推荐质量报告准确率口径细化：仅按有反馈推荐计算，新增反馈覆盖率指标',
    ],
  },
  {
    version: '1.4.6',
    date: '2026-11-18',
    changes: [
      '【新功能】搜索强化 · 线上增量搜索：/api/search 整合 Jamendo CC 授权线上搜索（scope=all 默认），本地结果优先、线上结果独立附加段返回，不混入本地分页语义；scope=local 一键退化为纯本地搜索（离线/合规场景）',
      '【新功能】线上专属搜索端点 GET /api/search/online?q=（强制只搜线上、不查本地库，探索新歌场景）；健康检查 /api/search/health 新增 onlineSearch 状态（ok/stub/disabled）',
      '【加固】线上搜索全链路 fail-open：client_id 未配置/网络异常/Jamendo 慢响应（3s 硬超时闸门）一律降级为空结果+明确 reason，绝不阻塞本地响应；超时慢响应后台续跑回填进程缓存，下次同词搜索即时命中',
      '【性能】线上搜索三层缓存：进程 TTL 缓存（300s/200 条 LRU）+ Redis 结果缓存（60s）+ 超时降级短缓存（5s）+ 后台回填；实测首次含线上 1.4~1.9s，重复查询 ~6ms，scope=local ~8ms 零触网',
      '【修复】搜索建议永远为空的存量 bug：/api/search/suggestions 后端返回裸数组而前端读取 data.data?.suggestions，现对齐为 {suggestions:[...]}',
      '【前端】shared/useSearch.ts 合并线上增量结果到搜索结果列表（本地在前、线上在后，platform=jamendo 标记）；本地播放列表过滤逻辑零变更',
    ],
  },
  {
    version: '1.4.5',
    date: '2026-11-18',
    changes: [
      '【新功能】Jamendo CC 曲库真实接入（client_id 已配置）：/api/audio-source/jamendo/search 搜索真实可用，import / import-by-tag 按标签批量导入，下载 → 四道校验 → 入库 → 授权登记 → genre/mood 标签映射 → 中性声学特征占位全自动',
      '【加固】Jamendo API 间歇空响应对策：实测同一请求约 50% 概率返回空 results（status 仍 success），搜索与按 id 详情均加最多 3 次退避重试；importByTag 重构为直接复用搜索结果对象，砍掉二次 API 调用，规避怪癖并降低延迟',
      '【修复】 Jamendo 搜索 include 参数：双 include（"musicinfo licenses"）配合部分 tags（如 piano）返回 0 结果，改为单 include=musicinfo（license_ccurl 本为默认字段）',
      '【优化】导入曲目自动补 song_features 中性声学占位行，保证新导入歌曲不被 genome 相似度推荐路径排除',
    ],
  },
  {
    version: '1.4.4',
    date: '2026-11-18',
    changes: [
      '【新功能】音频三层供给架构（Source-Adapter）：内置曲库（永久资产，不被缓存 LRU 淘汰）/ 自托管源（本地 /audio-lib 静态路由，可平滑切对象存储+CDN）/ Jamendo CC 授权实时接入（JAMENDO_CLIENT_ID 未配置时自动 stub 模式）',
      '【新功能】曲库发布编目：POST /api/audio-source/library/publish 与 scripts/publish-local-library.cjs 把磁盘缓存硬链接编目为曲库永久资产（506 首零拷贝），url_source=self-hosted，缓存被淘汰后仍可播放',
      '【新功能】授权登记表 audio_licenses：Jamendo 导入逐曲登记来源与许可，/api/audio-source/status 提供授权覆盖率统计',
      '【新功能】合规曲目录入管线：Jamendo 下载统一过四道校验（容器魔数/时长/试听片段红线/码率 ≥96kbps），自动映射 genre/mood 标签到推荐维度表',
      '【治理】默认关闭网易爬取回退路径（ENABLE_NETEASE_FALLBACK 显式开启仅限教学演示），消除 YesPlayMusic 下架同类法律风险',
      '【修复】测试污染真实库：genome 测试无条件清空 song_features 全表（506 行特征被抹），改为仅清理本测试种子；recommendation.feedback 测试补齐幂等清理，消除唯一约束冲突',
      '【修复】M4A mvhd 时长解析偏移错误（timescale/duration 应在 +16/+20），校验管线对 M4A 容器的时长判定自此准确',
    ],
  },
  {
    version: '1.4.3',
    date: '2026-11-16',
    changes: [
      '【优化】磁盘缓存容量上限与 LRU 淘汰：新增 AUDIO_CACHE_MAX_MB 配置（默认 5120MB），缓存超限后按最久未播放（文件 mtime）淘汰；播放命中时自动触碰 mtime，管理接口 /api/cache/status 新增 maxSizeMB/evictions 字段、新增管理员手动淘汰端点 POST /api/cache/evict',
      '【加固】缓存目录迁移护栏：显式设置 AUDIO_CACHE_DIR 时不再自动执行旧目录迁移，且新旧目录同路径时跳过，杜绝自迁移/误搬缓存（2026-11-16 测试事故根因）',
      '【治理】音频资源清理（依据 2026-11-16 审计报告）：删除 16 个「试听片段」缓存文件（11.0MB）、归档 481 首不可播放且无缓存的死歌（archived=true，曲库有效口径缩至 779 首）、将无引用的 music/ 与 web-public-audio-backup（72MB）归档至仓库外',
    ],
  },
  {
    version: '1.4.2',
    date: '2026-11-16',
    changes: [
      '【修复】桌面版启动约 1 分钟后弹出 cmd 黑窗口：定时任务爬虫依赖预检的 python 子进程缺少 windowsHide，从无控制台的 GUI 主进程启动控制台程序时会创建可见控制台窗口，现已隐藏（与 2026-08-09 python-runner 的同类修复对齐）',
      '【修复】首次运行解压内置数据库集群的 tar.exe 子进程补充 windowsHide，消除首次启动的闪窗',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-11-16',
    changes: [
      '【修复】桌面版启动极慢/无响应问题：内嵌 PostgreSQL 在无控制台（windowsHide）方式下启动等待逻辑会挂死，pg_ctl 每次恰好 120 秒才返回；改为 detached 方式启动 + 协议级就绪探测，数据库就绪由约 120 秒降至 2~7 秒',
      '【优化】新增启动引导窗口：双击图标后立即显示启动进度（数据库 → 后端服务 → 完成），不再出现长时间“毫无反应”的空白期',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-16',
    changes: [
      '【新功能】桌面版自动版本更新：启动后自动检测新版本，提示后自动下载（支持差量下载与 sha512 完整性校验），可立即重启安装或退出时自动安装',
      '【新功能】服务端新增 /updates 更新包托管路由，配合 GET /api/version 构成完整版本更新链路',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-16',
    changes: [
      '【重构】MMR 多样性选择统一为 preference.engine.mmrSelectBySimilarity 单一实现，消除两套公式并存的隐患',
      '【工程】清理推荐服务中的未使用导入与死代码（metadataOverlap/jaccard）',
      '【文档】推荐算法总览与技术文档与代码实现对齐（权重、语义编码、AI 增强说明、缓存键）',
    ],
  },
  {
    version: '1.2.2',
    date: '2026-11-16',
    changes: [
      '【性能】内容过滤评分改为单次批量特征提取，消除逐首查询的 N+1 问题（1000 首候选由最多 1000 次 Redis/DB 往返降为 1 次批量查询），每日推荐生成延迟显著下降',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-11-16',
    changes: [
      '【安全】推荐配置接口 PUT /api/recommendation/config 增加 admin/super_admin 角色校验，普通用户不再可以修改全局推荐权重',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-11-16',
    changes: [
      '【推荐算法】修复语义特征编码缺陷：由「ID 取模标量」改为 multi-hot 编码，语义相似度恢复数学意义，内容过滤结果不再被无效语义噪声干扰',
      '【推荐算法】歌曲特征缓存键升级为 v2，自动与旧编码缓存隔离',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-11',
    changes: [
      '推荐算法多路融合架构上线（规则/内容/协同/AI 四路加权 + MMR 多样性选择）',
      '新增推荐质量评估接口与反馈闭环',
    ],
  },
];

/** 语义化版本号比较：返回 a-b（>0 表示 a 更新） */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 取 fromVersion（不含）之后的所有更新日志，按版本倒序 */
export function getChangelogSince(fromVersion: string | null): ChangelogEntry[] {
  const base = fromVersion || '0.0.0';
  return CHANGELOG.filter((e) => compareSemver(e.version, base) > 0);
}

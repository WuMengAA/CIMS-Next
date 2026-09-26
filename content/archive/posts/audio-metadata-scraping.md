---
title: 本地音频元数据刮削：从文件名到封面与歌词
date: '2026-09-05'
updated: '2026-09-13'
status: published
category: 工程笔记
tags:
  - 元数据
  - 刮削
  - MusicBrainz
  - CUE
  - AcoustID
owner: admin
excerpt: 本地曲库里一堆"裸"音频文件怎么办？梳理文件名匹配、音频指纹、CUE 分轨三条刮削路线的实现细节——MusicBrainz 限流怎么扛、Chromaprint 指纹对短音频为何无效、CUE 时间码为什么是 75 帧而非 100。
cover: /covers/audio-metadata-scraping.svg
---

用户的硬盘里，音乐文件往往是"裸"的：一首歌只有个 `track01.mp3`，没有封面、没有流派、没有歌词。本地播放器要做得体面，第一步就是把元数据补全——这件事叫**刮削（scraping）**。

刮削听起来简单，做起来会发现它是一串**失败率很高**的外部调用。下面把我实际落地的三条路线、分层策略，以及踩过的坑摊开讲。

## 三条路线的能力边界

| 路线 | 输入 | 依赖 | 命中率 | 成本 |
|------|------|------|--------|------|
| 标签 / 文件名匹配 | ID3、Vorbis comments、文件名 | MusicBrainz、Discogs | 中（依赖命名质量） | 低（一次网络查询） |
| 音频指纹 | 音频内容本身 | AcoustID + Chromaprint | 高（与命名无关） | 高（CPU 密集 + 联网） |
| CUE 分轨 | cue sheet + 整轨镜像 | 本地解析 | 确定（文件自带） | 极低（纯本地） |

## 路线一：标签 / 文件名匹配

最轻量。读取文件已有的 ID3、Vorbis comments 或 MP4 atoms，拼出「艺术家 + 专辑 + 曲名」，去在线数据库做模糊搜索。MusicBrainz 提供开放的查询 API，可以按艺术家、专辑、曲目名精确命中 [1]；Discogs 的 API 则更擅长厂牌与版本信息 [2]。

```dart
Future<List<Release>> searchRelease(String artist, String album) async {
  // MusicBrainz 要求带 User-Agent，否则会被拒绝服务
  final uri = Uri.https('musicbrainz.org', '/ws/2/release', {
    'query': 'artist:"$artist" AND release:"$album"',
    'fmt': 'json',
    'limit': '5',
  });
  final res = await http.get(uri, headers: {
    'User-Agent': 'Stelarith/1.0 ( https://stelarith.local )',
  });
  if (res.statusCode != 200) return [];
  final body = jsonDecode(res.body) as Map<String, dynamic>;
  return (body['releases'] as List? ?? [])
      .map((r) => Release.fromMb(r))
      .toList();
}
```

> [!IMPORTANT]
> **MusicBrainz 强制限流 1 次/秒**，且要求请求带明确的 `User-Agent`。不遵守会被封 IP。刮削整库时必须在客户端侧做串行队列 + 间隔，不要并发猛发——这是我用被封了一下午换来的教训。

这条路线依赖文件名"说得人话"。如果用户把文件命名成 `asdfgh.mp3`，匹配就会扑空——所以需要路线二兜底。

## 路线二：音频指纹（Chromaprint + AcoustID）

即便文件名全乱，声音本身不会骗人。Chromaprint 对音频提取一段**声学指纹**，交给 AcoustID 服务比对，命中后再跳到 MusicBrainz 拿完整元数据 [3][4]。

代价很实在，有三条：

1. **CPU 密集**：指纹提取要解码整段音频再跑变换。我把它放在独立 isolate 里，并且**只取前 60 秒**——AcoustID 本身也主要用开头片段匹配。
2. **对短音频无效**：低于约 20~30 秒的片段（比如音效、铃声）指纹区分度不足，几乎查不到。要提前按时长过滤，别浪费算力。
3. **依赖外部服务**：断网即失效。

所以它只能作为"匹配失败时的二次尝试"，不能当默认路径。

> [!TIP]
> 指纹结果要**落库缓存**。同一个文件第二次刮削不应再算一遍指纹，也不应再查一次网络。我按文件「大小 + 修改时间 + 前 64KB 哈希」做本地键，命中就直接复用。

## 路线三：CUE 分轨还原

很多无损专辑是一整张 `image.flac` 配一个 `image.cue`。CUE 里记录了每首曲子的标题与在整文件里的起止偏移，解析它就能把一整张镜像"切"成可独立播放、可独立显示元数据的分轨 [5]。

```text
FILE "image.flac" WAVE
  TRACK 01 AUDIO
    TITLE "前奏"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "主歌"
    INDEX 01 03:42:00
```

这段看着直白，实现时有个**几乎人人都会踩的坑**：

> [!WARNING]
> CUE 的时间码是 `分:秒:帧`，而**一秒等于 75 帧，不是 100**。按 100 换算会让后面每一轨的起始点都偏移，越靠后偏得越多——表现为"第 8 首听起来像第 7 首的尾巴"。正确换算是 `秒 = 分*60 + 秒 + 帧/75`。

解析出来的分轨不需要真的切文件。播放时 `open` 整轨文件，再 `seek` 到起始偏移，并在到达下一轨起点时自动停止或继续——这样零拷贝、零磁盘占用：

```dart
class CueTrack {
  final String title;
  final Duration start;
  Duration? end; // 下一轨的 start，最后一轨为 null

  Duration get duration => (end ?? audioDuration) - start;
}

Duration _parseCueIndex(String mmssff) {
  final p = mmssff.split(':');
  final m = int.parse(p[0]);
  final s = int.parse(p[1]);
  final f = int.parse(p[2]); // 帧：1 秒 = 75 帧
  return Duration(milliseconds: ((m * 60 + s) * 1000) + (f * 1000 / 75).round());
}
```

## 分层策略：命中即停

实际策略是分层的，每一层命中就停止，既快又稳：

1. **读本地标签** → 有完整封面与曲名就直接用，零网络
2. **文件名匹配**（MusicBrainz / Discogs）→ 补流派、年份、封面
3. **指纹匹配**（Chromaprint → AcoustID）→ 兜底对付乱命名
4. **整轨文件走 CUE 分轨** → 这是**并行**的另一条线，遇到 `.cue` 就先切轨，切完再对每轨走 1~3 步

第 4 步容易被漏掉：CUE 分轨不是元数据匹配的替代，而是它的前置步骤。

## 四个真实踩过的坑

1. **被 MusicBrainz 封 IP**：并发猛发查询，一下午拿不到数据。改成串行队列 + 最小 1.1 秒间隔后稳定。
2. **CUE 文件是 GBK 编码**：国内的老 CUE 大量是 GBK/GB18030，按 UTF-8 读出来全是乱码。要做编码探测，失败时回退 GBK 再解一次。
3. **指纹算在 UI 线程导致卡顿**：几千首歌逐个算指纹，主线程直接假死。必须丢进 isolate 池，并且对**小于 30 秒**的音频直接跳过。
4. **刮削中断后前功尽弃**：整库刮削动辄几十分钟，中途退出就重来。进度要能落盘续跑，已命中的结果立即写库，不要攒到最后统一提交。

## 小结

刮削的本质不是"调个 API"，而是**在不可靠的外部依赖之上搭一套可靠的流水线**：本地优先、限流友好、结果缓存、失败降级、进度可续。把这几点做扎实，用户感知到的就是"扫完就有封面"这件理所当然的小事。

## 参考来源

1. MusicBrainz API 文档 — 《MusicBrainz API》（含限流与 User-Agent 要求），https://musicbrainz.org/doc/MusicBrainz_API ，访问于 2026-09-13。
2. Discogs API 文档 — 《Discogs Developers》，https://www.discogs.com/developers/ ，访问于 2026-09-13。
3. AcoustID — 声学指纹比对服务，https://acoustid.org ，访问于 2026-09-13。
4. Chromaprint — AcoustID，GitHub 仓库（指纹提取库），https://github.com/acoustid/chromaprint ，访问于 2026-09-13。
5. Cue sheet (computing) — 维基百科条目（cue 文件格式与时间码说明），https://en.wikipedia.org/wiki/Cue_sheet_(computing) ，访问于 2026-09-13。

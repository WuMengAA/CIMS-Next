---
title: 本地音频元数据刮削：从文件名到封面与歌词
date: '2026-09-05'
status: published
category: 工程笔记
tags:
  - 元数据
  - 刮削
  - MusicBrainz
  - CUE
owner: admin
excerpt: 本地曲库里一堆"裸"音频文件怎么办？梳理文件名匹配、音频指纹、CUE 分轨三条刮削路线，以及它们背后的公开数据库与规范。
cover: /covers/audio-metadata-scraping.svg
---

用户的硬盘里，音乐文件往往是"裸"的：一首歌只有个 `track01.mp3`，没有封面、没有流派、没有歌词。本地播放器要做得体面，第一步就是把元数据补全——这件事叫**刮削（scraping）**。

## 路线一：文件名 / 标签匹配

最轻量。读取文件已有的 ID3 / 文件名校验信息，去在线数据库做模糊搜索匹配。MusicBrainz 提供开放的搜索与查询 API，可以按艺术家、专辑、曲目名精确命中；Discogs 的 API 则擅长厂牌与版本信息^[1]^[2]^。

> [!NOTE]
> 这条路线依赖文件名"说得人话"。如果用户把文件命名成 `asdfgh.mp3`，匹配就会扑空——所以需要路线二兜底。

## 路线二：音频指纹（AcoustID + Chromaprint）

即便文件名全乱，声音本身不会骗人。Chromaprint 对音频提取一段**声学指纹**，交给 AcoustID 服务比对，命中后再跳到 MusicBrainz 拿完整元数据。这条路线的好处是"文件名无关"，适合整理来历不明的曲库^[3]^[4]^。

代价是要算指纹（CPU 密集），且依赖外部服务返回。所以本地播放器通常把它作为"匹配失败时的二次尝试"，而不是默认路径。

## 路线三：CUE 分轨还原

很多无损专辑是一整张 `image.flac` 配一个 `image.cue`，CUE 文件里记录了每首曲子的标题与在整文件里的起止偏移。解析 CUE（cue sheet 是一种公开文本格式，描述曲目的索引与时间码）就能把一整张镜像"切"成可独立播放、可独立显示元数据的分轨^[5]^。

```text
FILE "image.flac" WAVE
  TRACK 01 AUDIO
    TITLE "前奏"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "主歌"
    INDEX 01 03:42:00
```

## 怎么组合

实际策略是分层：先读本地标签 → 失败则文件名匹配（MusicBrainz/Discogs）→ 仍失败则指纹匹配（AcoustID）→ 整轨文件走 CUE 分轨。每一层命中即停，既快又稳。

| 路线 | 输入 | 依赖 |
|------|------|------|
| 标签/文件名 | ID3、文件名 | MusicBrainz、Discogs |
| 音频指纹 | 音频内容 | AcoustID、Chromaprint |
| CUE 分轨 | cue + 镜像 | cue sheet 解析 |

## 参考来源

1. MusicBrainz API 文档 — 《MusicBrainz API》，https://musicbrainz.org/doc/MusicBrainz_API ，访问于 2026-09-05。
2. Discogs API 文档 — 《Discogs Developers》，https://www.discogs.com/developers/ ，访问于 2026-09-05。
3. AcoustID — 声学指纹比对服务，https://acoustid.org ，访问于 2026-09-05。
4. Chromaprint — AcoustID，GitHub 仓库（指纹提取库），https://github.com/acoustid/chromaprint ，访问于 2026-09-05。
5. Cue sheet (computing) — 维基百科条目（cue 文件格式说明），https://en.wikipedia.org/wiki/Cue_sheet_(computing) ，访问于 2026-09-05。

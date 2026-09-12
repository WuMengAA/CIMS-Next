---
title: 体素世界与白噪音：本地播放器的沉浸体验设计
date: '2026-09-04'
updated: '2026-09-13'
status: published
category: 体验设计
tags:
  - 体验
  - 体素
  - 白噪音
  - 空间音频
  - Flutter
owner: admin
excerpt: 播放器不该只是"放歌的工具"，而应是一个能停留的空间。记录星璃在体素背景、白噪音叠加、空间音效上的具体取舍——包括为什么白噪音默认关、为什么循环点会爆音、以及为什么有些歌加了空间化反而更难听。
cover: /covers/voxel-ambient-experience.svg
---

大多数播放器把自己当工具：一个列表、一个进度条、完事。但我做「星璃·无限音乐画布」的出发点不一样——它应该是一个**能停留的空间**。音乐是主角，视觉与音效是让它"值得待着"的陪衬。

这句话说起来漂亮，做起来全是具体的工程决策。下面把三个方向（体素背景、白噪音、空间音效）的实现与取舍摊开讲，包括那些**做完发现不好、又退回去**的部分。

## 体素世界背景：为什么是低多边形，不是风景照

我选了低多边形 / 体素风格的世界作为背景，而不是写实风景照。三条理由：

1. **性能可控**。体素场景用 Flutter 的 `CustomPaint` 自绘就能跑得很轻，不需要引入完整的 3D 渲染管线。我的目标是稳定 60fps，且**单帧绘制耗时留足余量**——因为播放器主界面还有封面、歌词、波形在同时动。
2. **风格统一**。写实风景照会和专辑封面"抢戏"：一张高饱和的风景照配上任意封面都可能冲突，而低多边形的低饱和几何体天然是背景板。
3. **不产生"看腻"**。照片看久了会腻，缓慢漂浮的几何体不会。

> [!TIP]
> 背景永远低于内容一档：慢速漂浮、低饱和、**不响应点击**。它的任务是"在场"，不是"被看"。一旦用户开始注意到背景，就说明它做过头了。

## 白噪音叠加：给音乐一个场景

纯音乐有时太"空"，尤其深夜或专注时。我在播放器里叠了一层可调控的环境音（雨声、海浪、风声），让音乐落进一个场景里。

实现上就是一路独立的音频源与音乐混合，关键是**增益必须压得很低**。我的默认值是环境音比音乐低约 24dB——这个量级下你"感觉到一个底"，但不会真的听清雨声里的细节。用户可以拉高，但默认值必须保守。

> [!IMPORTANT]
> **白噪音默认关闭。** 这条我很坚持。任何"替用户决定加一层声音"的默认开启，本质上都是在未经允许的情况下修改了他的音乐。想听的人会主动打开，不想听的人不该被迫关掉。

### 循环点爆音：一个不做处理就会被骂的细节

环境音素材通常只有十几秒到几十秒，必须循环播放。直接把音频首尾相接，在循环点会有一个明显的**"啪"声**——因为波形在接缝处不连续。

解决办法是交叉淡化（crossfade）：在素材尾部与头部重叠一小段（我用的是 ~1.5 秒），让两个副本的音量互补渐变。代价是素材长度和内存略增，但换来的是真正无缝的背景。

```dart
import 'package:media_kit/media_kit.dart';

// 双副本交叉淡化：让循环接缝处波形连续，消除"啪"声
class AmbientLooper {
  static const _fade = Duration(milliseconds: 1500);
  static const _total = Duration(seconds: 30); // 素材时长

  final List<Player> _decks = [Player(), Player()];
  int _active = 0;

  Future<void> start(String uri) async {
    await _decks[0].open(Media(uri), play: true);
    await _decks[0].setVolume(100);
    _scheduleCrossfade(uri);
  }

  Future<void> _scheduleCrossfade(String uri) async {
    // 关键：按「实际剩余时长」而不是素材时长来调度，
    // 否则一旦卡顿或 seek 过，两路就会错位变成双重叠音
    final pos = _decks[_active].state.position;
    final wait = _total - _fade - pos;
    if (wait > Duration.zero) await Future.delayed(wait);

    final next = 1 - _active;
    await _decks[next].open(Media(uri), play: true);
    await _decks[next].setVolume(0);

    for (var i = 0; i <= 20; i++) {
      final t = i / 20;
      await _decks[_active].setVolume(100 * (1 - t));
      await _decks[next].setVolume(100 * t);
      await Future.delayed(const Duration(milliseconds: 75));
    }
    await _decks[_active].stop();
    _active = next;
    _scheduleCrossfade(uri);
  }

  Future<void> dispose() async {
    for (final d in _decks) {
      await d.stop();
      d.dispose();
    }
  }
}
```

## 空间音效：让声音有方位，但不是所有歌都适合

配合支持空间音频的素材，播放器可以做轻度空间化处理，让人声居中、伴奏稍后，营造"坐在现场"的包裹感 [1]。Apple 在音乐产品里大量使用这类空间呈现，是已经被验证过的体验方向 [2]。

但这里有个**反直觉的教训**：空间化对**劣质素材是伤害**。把一副单声道出来的老录音做空间化，结果是人声发飘、低频散掉，比不加还难听。

> [!WARNING]
> 空间音效**只对本身带空间信息的素材启用**。我最早默认全开，试听时好几首老歌变得又薄又虚。改成"素材支持才启用"之后，才真正变成加分项。这条边界比"能不能做"更重要。

技术上的取舍是：不做完整的 HRTF 卷积（算力开销大、对小喇叭无效），只做轻度的声道扩展与延迟差。用户戴耳机时收益明显，外放时几乎无感——这就够了。

## 边界：以音乐为主，视觉音效为辅

这条边界我很克制，具体到三条可执行的规则：

| 能力 | 默认 | 启用条件 | 为什么 |
|------|------|----------|--------|
| 体素背景 | 开 | 始终 | 低饱和、不响应点击，不构成干扰 |
| 白噪音叠加 | **关** | 用户主动开 | 不擅自修改用户的音乐 |
| 空间音效 | 关 | 素材支持空间信息 | 对单声道老录音是伤害 |

**视觉和音效永远服务于"想多听一会儿"**，而不是炫技。所以体素背景不抢眼、白噪音默认关、空间音效只对有素材的歌启用。体验的终点，是用户忘记界面、只记得那首歌。

## 三个真实踩过的坑

1. **背景动画吃掉 GPU**：早期版本背景用 `setState` 驱动整个页面重建，帧率直接掉到 30 以下。后来把背景隔离成独立的 `RepaintBoundary` + 自己的动画控制器，主界面重绘不再连带背景。
2. **白噪音拖累续航**：一路额外的音频解码在移动端是实打实的耗电。移动端我把环境音限制为"仅在前台且亮屏时播放"，退到后台自动淡出。
3. **交叉淡化的时机算错**：如果按"素材时长"而不是"实际剩余时长"来调度下一路，一旦系统卡顿或 seek 过，两路音频就会错位，变成双重叠音。必须用播放器的实际位置来算。

## 参考来源

1. Apple 开发者文档 — 《Representing Spatial Audio》（空间音频呈现），https://developer.apple.com/documentation/avfoundation/audio/representing_spatial_audio ，访问于 2026-09-13。
2. Apple Music — 空间音频与环境音的产品理念，https://www.apple.com/apple-music/ ，访问于 2026-09-13。
3. Flutter 文档 — 《CustomPaint 与自定义绘制》，https://docs.flutter.dev/ui/layout ，访问于 2026-09-13。
4. MagicaVoxel — 体素编辑器（低多边形 / 体素审美来源），https://ephtracy.github.io/ ，访问于 2026-09-13。

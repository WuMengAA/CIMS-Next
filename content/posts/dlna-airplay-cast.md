---
title: DLNA / AirPlay 投屏：把本地音乐推到音箱
date: '2026-09-07'
updated: '2026-09-13'
status: published
pinned: true
category: 工程笔记
tags:
  - DLNA
  - AirPlay
  - 投屏
  - 音频
  - UPnP
owner: admin
excerpt: 本地播放器不该被束缚在耳机里。记录星璃怎么用 DLNA（UPnP AV）把音乐推到客厅音箱、用 AirPlay 推到 Apple 设备——SSDP 发现、SOAP 控制、DIDL-Lite 元数据怎么拼，以及多网卡、防火墙、AirPlay 2 加密这三道真实拦路虎。
cover: /covers/dlna-airplay-cast.svg
---

大多数本地播放器只在自己的窗口里出声。但用户的音箱在客厅、在书房的 HomePod、在书架上那台十年前的老功放。把音乐"推"过去，体验才完整。

我在星璃上做了两条投屏路线：**DLNA** 和 **AirPlay**。它们不互斥——按平台能力同时暴露两种出口，用户选手边最方便的那台设备。但这两条路线的实现难度完全不在一个量级，下面把原理、代码和踩过的坑都摊开。

## DLNA 到底是什么：三件事的组合

很多人把 DLNA 当成"一个协议"，其实它是基于 UPnP 的一套协议族。真正用到的就三件事 [1]：

1. **发现**：SSDP（Simple Service Discovery Protocol），在局域网里组播找设备。
2. **描述**：拿到设备自报家门的 XML，知道它提供哪些服务、控制接口在哪。
3. **控制**：用 SOAP 调用 `AVTransport`（播放/暂停/seek）和 `RenderingControl`（音量）。

关键点在于：DLNA 的"投屏"**不是把音频流推过去**，而是把音频的 URL 交给渲染设备，让设备自己去拉。播放器退居"遥控器"角色——这一点理解错了，后面所有实现都会走偏。

> [!IMPORTANT]
> 播放器是控制点（Control Point），不是流媒体服务器。你给渲染设备的是一个它能访问的 URL，所以要么起一个临时 HTTP 服务把本地文件暴露出去，要么让设备能直接访问文件路径。前者通用，后者只在少数支持 SMB 的设备上可行。

### 第一步：SSDP 组播发现

向 `239.255.255.250:1900` 发一个 `M-SEARCH` 广播，问"谁是媒体渲染器"：

```
M-SEARCH * HTTP/1.1
HOST: 239.255.255.250:1900
MAN: "ssdp:discover"
MX: 3
ST: urn:schemas-upnp-org:device:MediaRenderer:1
```

`MX: 3` 表示让设备在 0~3 秒内随机延迟应答——这个随机延迟是为了避免几十台设备同时回包把网络打爆。**自己实现客户端时必须等满 MX 秒再收尾**，我最初只等 1 秒，结果一半的设备搜不到。

设备回包里最重要的是 `LOCATION`，指向它的设备描述 XML：

```
HTTP/1.1 200 OK
LOCATION: http://192.168.1.23:8080/description.xml
ST: urn:schemas-upnp-org:device:MediaRenderer:1
USN: uuid:4d696e69-444c-164e-9d41-001122334455::urn:schemas-upnp-org:device:MediaRenderer:1
```

### 第二步：从描述 XML 里抠出控制地址

拿到 `description.xml`，找到 `AVTransport` 服务的 `controlURL`。这一步的坑是**命名空间**：不同厂商写的 XML 命名空间前缀五花八门，用字符串硬匹配 `<controlURL>` 有时会漏。稳妥做法是解析成 DOM 后按 `serviceType` 定位：

```dart
Future<String?> _findControlUrl(String xml, String serviceType) async {
  final doc = XmlDocument.parse(xml);
  for (final service in doc.findAllElements('service')) {
    final type = service.getElement('serviceType')?.text ?? '';
    if (!type.contains(serviceType)) continue;
    final ctrl = service.getElement('controlURL')?.text;
    if (ctrl == null || ctrl.isEmpty) continue;
    // controlURL 可能是相对路径，必须按 base URL 解析
    return Uri.parse(baseUrl).resolve(ctrl).toString();
  }
  return null;
}
```

`controlURL` 经常是相对路径（如 `/ctl/AVTransport`），**必须按设备的 base URL 做一次 resolve**。直接拿相对路径去 POST，是我调试时卡了最久的一处。

### 第三步：SOAP 控制与 DIDL-Lite 元数据

让设备播放某个 URL，调用 `SetAVTransportURI`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <CurrentURI>http://192.168.1.9:9123/track/42.flac</CurrentURI>
      <CurrentURIMetaData>
        &lt;DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"&gt;
          &lt;item id="42" parentID="0" restricted="1"&gt;
            &lt;dc:title&gt;晴天&lt;/dc:title&gt;
            &lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;
          &lt;/item&gt;
        &lt;/DIDL-Lite&gt;
      </CurrentURIMetaData>
    </u:SetAVTransportURI>
  </s:Body>
</s:Envelope>
```

两个容易翻车的细节：

- **`SOAPACTION` 头必须带**，格式是 `"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"`。缺了这个头，Many 设备直接返回 500。
- **DIDL-Lite 要做 XML 转义**后塞进 `CurrentURIMetaData`。我第一版没转义，设备收到后解析失败，表现为"点播放没反应、也不报错"——最难查的那类 bug。

之后 `Play`、`Pause`、`Seek`、`GetPositionInfo` 都是同样的 SOAP 套路。音量走 `RenderingControl` 服务的 `SetVolume`。

## AirPlay：Apple 生态里很甜，出了生态很难

在 Apple 平台上，AirPlay 几乎是"白送"的能力。系统框架已经做好了设备发现和用户选择，你要做的只是把音频路由交给系统，剩下的交给 `AVRoutePickerView` 之类的系统控件 [2]。用户在控制中心或播放界面就能选 HomePod、Apple TV 或任意 AirPlay 音箱。

**但出了 Apple 平台，情况完全不同**：非 Apple 平台没有官方 AirPlay SDK。AirPlay 1 的音频部分（RAOP）是相对公开的、有第三方实现；而 AirPlay 2 引入了加密配对和更严格的认证，基本没有可行的第三方方案。

> [!WARNING]
> 不要低估在 Windows / Android / Linux 上做 AirPlay 发送端的成本。如果目标设备里有 HomePod mini、Apple TV 这类只支持 AirPlay 2 的设备，非 Apple 平台基本够不着。我在星璃上的做法是：**Apple 平台走原生 AirPlay，其他平台只暴露 DLNA**，并把这个差异如实写在 UI 上，而不是假装两条路线处处可用。

## 五个真实踩过的坑

1. **多网卡让 SSDP 发错接口**：开了 VPN、WSL、虚拟机之后，机器上会多出好几张虚拟网卡。`M-SEARCH` 如果只从"默认"接口发出，可能发到虚拟网卡上，实体音箱永远搜不到。必须遍历所有可用网卡逐个组播，并过滤掉回环和虚拟适配器。
2. **Windows 防火墙拦 UDP 1900**：SSDP 依赖入站组播响应。防火墙一拦，表现为"能发出去但收不到任何回包"，很容易误判成代码问题。排查时先临时关防火墙验证一次，能省两小时。
3. **搜到设备但控制失败**：原因通常是描述 XML 的 `controlURL` 是相对路径没做 resolve，或者 `SOAPACTION` 头缺失。这两条占了控制失败原因的绝大多数。
4. **seek 单位不统一**：`Seek` 的 `Unit` 参数有 `REL_TIME`、`TRACK_NR`、`ABS_TIME` 等，设备支持程度不一。安全做法是只传 `REL_TIME`，并在 seek 后用 `GetPositionInfo` 轮询确认，不要假设一次调用就生效。
5. **投屏时 App 退到后台被系统杀掉**：既然是"脱离屏幕存在"，就要保证播放器进程在后台仍维持本地 HTTP 服务，否则设备拉不到流会静音。桌面端相对好办，移动端要额外处理后台保活。

## 两条路线的取舍

| 维度 | DLNA / UPnP AV | AirPlay |
|------|----------------|---------|
| 覆盖设备 | 安卓电视、智能音箱、多数功放 | Apple TV、HomePod、AirPlay 音箱 |
| 实现方 | 自己实现控制点（SSDP + SOAP） | Apple 平台由系统提供 |
| 非 Apple 平台 | 可行 | AirPlay 2 基本不可行 |
| 传输本质 | 给 URL，设备自己拉 | 系统级音频路由 |
| 主要风险 | 厂商实现参差、需大量容错 | 生态封闭、版本演进不可控 |

它们不互斥。星璃按平台能力同时暴露两种出口，用户选手边最方便的那台设备——投屏的目标从来不是"多一个按钮"，而是让音乐**脱离屏幕存在**：你关掉 App、锁屏、去倒杯水，歌还在音箱里响着。

## 参考来源

1. UPnP AV Architecture — Open Connectivity Foundation（DLNA 的传输底座），https://openconnectivity.org/ ，访问于 2026-09-13。
2. AirPlay — Apple 开发者文档（Streaming and AirPlay），https://developer.apple.com/airplay ，访问于 2026-09-13。
3. DLNA — Digital Living Network Alliance（标准概览），https://en.wikipedia.org/wiki/Digital_Living_Network_Alliance ，访问于 2026-09-13。
4. UPnP Device Architecture 1.1（SSDP 与 SOAP 控制规范），https://openconnectivity.org/upnp-specs/upnp-arch/ ，访问于 2026-09-13。

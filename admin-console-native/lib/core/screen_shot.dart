/// 星集控 · 本机截屏（Windows）
///
/// 为什么**不**用 PowerShell：学校里大量机器被组策略限制了脚本执行，
/// 而且每次起一个 `powershell.exe` 要 1~3 秒，比下发指令的节奏还慢。
/// 这里直接在**进程内**用 GDI 抓屏（dart:ffi），零外部依赖、百毫秒级。
/// PowerShell 仅作兜底（少数环境下 GDI 拿不到桌面 DC，但脚本能跑）。
///
/// ⚠️ PNG 是**自己编的**（`dart:io` 的 zlib + 手写 CRC32），刻意不用
/// `dart:ui` 的 `Image.toByteData` —— 那样整个 core 层就绑死在 Flutter 引擎上，
/// 命令行自检工具（`dart run tool/...`）会直接编译不过。
///
/// 诚实原则：抓不出来就返回 ok=false + 人能看懂的原因，
/// **绝不写一张全黑图然后当成功**（那会让面板以为"截到了"）。
library;

import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:typed_data';

import 'package:ffi/ffi.dart';

import 'log.dart';

/// 截屏结果：失败时 [detail] 必须能被人看懂（会进日志与面板提示）。
class CaptureResult {
  final bool ok;
  final String path;
  final String detail;
  const CaptureResult({required this.ok, this.path = '', this.detail = ''});

  static CaptureResult fail(String why) => CaptureResult(ok: false, detail: why);
}

/// 抓屏函数签名（可注入，便于测试与非 Windows 平台替换）。
typedef ScreenCapture = Future<CaptureResult> Function(String outPath);

// ---------------------------------------------------------------------------
// Win32 绑定
// ---------------------------------------------------------------------------

final class _BitmapInfoHeader extends Struct {
  @Uint32()
  external int biSize;
  @Int32()
  external int biWidth;
  @Int32()
  external int biHeight;
  @Uint16()
  external int biPlanes;
  @Uint16()
  external int biBitCount;
  @Uint32()
  external int biCompression;
  @Uint32()
  external int biSizeImage;
  @Int32()
  external int biXPelsPerMeter;
  @Int32()
  external int biYPelsPerMeter;
  @Uint32()
  external int biClrUsed;
  @Uint32()
  external int biClrImportant;
}

class _Gdi {
  static final DynamicLibrary _user32 = DynamicLibrary.open('user32.dll');
  static final DynamicLibrary _gdi32 = DynamicLibrary.open('gdi32.dll');

  static final int Function(int) getDc =
      _user32.lookupFunction<IntPtr Function(IntPtr), int Function(int)>('GetDC');
  static final int Function(int, int) releaseDc = _user32
      .lookupFunction<Int32 Function(IntPtr, IntPtr), int Function(int, int)>('ReleaseDC');
  static final int Function(int) getSystemMetrics =
      _user32.lookupFunction<Int32 Function(Int32), int Function(int)>('GetSystemMetrics');

  static final int Function(int) createCompatibleDc = _gdi32
      .lookupFunction<IntPtr Function(IntPtr), int Function(int)>('CreateCompatibleDC');
  static final int Function(int, int, int) createCompatibleBitmap = _gdi32
      .lookupFunction<IntPtr Function(IntPtr, Int32, Int32), int Function(int, int, int)>(
          'CreateCompatibleBitmap');
  static final int Function(int, int) selectObject = _gdi32
      .lookupFunction<IntPtr Function(IntPtr, IntPtr), int Function(int, int)>('SelectObject');
  static final int Function(int, int, int, int, int, int, int, int, int) bitBlt = _gdi32
      .lookupFunction<
          Int32 Function(IntPtr, Int32, Int32, Int32, Int32, IntPtr, Int32, Int32, Uint32),
          int Function(int, int, int, int, int, int, int, int, int)>('BitBlt');
  static final int Function(int, int, int, int, Pointer<Uint8>, Pointer<_BitmapInfoHeader>, int)
      getDIBits = _gdi32.lookupFunction<
          Int32 Function(IntPtr, IntPtr, Uint32, Uint32, Pointer<Uint8>,
              Pointer<_BitmapInfoHeader>, Uint32),
          int Function(int, int, int, int, Pointer<Uint8>, Pointer<_BitmapInfoHeader>,
              int)>('GetDIBits');
  static final int Function(int) deleteObject =
      _gdi32.lookupFunction<Int32 Function(IntPtr), int Function(int)>('DeleteObject');
  static final int Function(int) deleteDc =
      _gdi32.lookupFunction<Int32 Function(IntPtr), int Function(int)>('DeleteDC');

  // GetSystemMetrics 索引（虚拟屏 = 多显示器合并后的整体范围）
  static const int smXVirtualScreen = 76;
  static const int smYVirtualScreen = 77;
  static const int smCxVirtualScreen = 78;
  static const int smCyVirtualScreen = 79;
}

const int _srcCopy = 0x00CC0020;

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

class ScreenShot {
  /// 进程内 GDI 抓屏 → PNG 落盘。
  static Future<CaptureResult> capture(String outPath) async {
    if (!Platform.isWindows) {
      return CaptureResult.fail('本机不是 Windows，无法截屏');
    }
    final gdi = await _captureViaGdi(outPath);
    if (gdi.ok) return gdi;
    Log.w('GDI 抓屏失败（${gdi.detail}），改用脚本兜底', 'shot');
    final ps = await _captureViaPowerShell(outPath);
    if (ps.ok) return ps;
    return CaptureResult.fail('抓屏失败：${gdi.detail} / ${ps.detail}');
  }

  /// 截图落盘目录：`%LOCALAPPDATA%\xingjikong\shots`
  /// 放用户目录下 —— 学校机器上 Program Files 通常不可写。
  static Directory shotsDir() {
    final base = Platform.environment['LOCALAPPDATA'] ??
        Platform.environment['TEMP'] ??
        Directory.systemTemp.path;
    return Directory('$base${Platform.pathSeparator}xingjikong'
        '${Platform.pathSeparator}shots');
  }

  static String newShotPath() {
    final ts = DateTime.now().toIso8601String().replaceAll(RegExp(r'[:.]'), '-');
    return '${shotsDir().path}${Platform.pathSeparator}shot-$ts.png';
  }

  // ---- GDI 实现 ----

  static Future<CaptureResult> _captureViaGdi(String outPath) async {
    final x = _Gdi.getSystemMetrics(_Gdi.smXVirtualScreen);
    final y = _Gdi.getSystemMetrics(_Gdi.smYVirtualScreen);
    final w = _Gdi.getSystemMetrics(_Gdi.smCxVirtualScreen);
    final h = _Gdi.getSystemMetrics(_Gdi.smCyVirtualScreen);
    if (w <= 0 || h <= 0) return CaptureResult.fail('取不到屏幕尺寸（$w x $h）');

    var screenDc = 0;
    var memDc = 0;
    var bmp = 0;
    var oldObj = 0;
    Pointer<Uint8> buf = nullptr;
    Pointer<_BitmapInfoHeader> bmi = nullptr;
    try {
      screenDc = _Gdi.getDc(0);
      if (screenDc == 0) return CaptureResult.fail('GetDC 取不到桌面（可能无桌面会话）');
      memDc = _Gdi.createCompatibleDc(screenDc);
      if (memDc == 0) return CaptureResult.fail('CreateCompatibleDC 失败');
      bmp = _Gdi.createCompatibleBitmap(screenDc, w, h);
      if (bmp == 0) return CaptureResult.fail('CreateCompatibleBitmap 失败');
      oldObj = _Gdi.selectObject(memDc, bmp);
      final copied = _Gdi.bitBlt(memDc, 0, 0, w, h, screenDc, x, y, _srcCopy);
      if (copied == 0) return CaptureResult.fail('BitBlt 抓屏被拒绝（桌面 DC 不可访问）');

      final bytes = w * h * 4;
      buf = calloc<Uint8>(bytes);
      bmi = calloc<_BitmapInfoHeader>();
      bmi.ref
        ..biSize = sizeOf<_BitmapInfoHeader>()
        ..biWidth = w
        // 负高度 = 自上而下，与屏幕朝向一致，省掉一次翻转
        ..biHeight = -h
        ..biPlanes = 1
        ..biBitCount = 32
        ..biCompression = 0;

      final lines = _Gdi.getDIBits(memDc, bmp, 0, h, buf, bmi, 0);
      if (lines == 0) return CaptureResult.fail('GetDIBits 读像素失败');

      final bgra = buf.asTypedList(bytes);
      final png = encodePngFromBgra(w, h, bgra);
      final f = File(outPath);
      await f.parent.create(recursive: true);
      await f.writeAsBytes(png, flush: true);
      final size = await f.length();
      if (size <= 0) return CaptureResult.fail('PNG 落盘为空');
      return CaptureResult(
          ok: true, path: outPath, detail: '${w}x$h ${size ~/ 1024}KB');
    } catch (e) {
      return CaptureResult.fail('GDI 异常：$e');
    } finally {
      if (bmi != nullptr) calloc.free(bmi);
      if (buf != nullptr) calloc.free(buf);
      if (memDc != 0 && oldObj != 0) _Gdi.selectObject(memDc, oldObj);
      if (bmp != 0) _Gdi.deleteObject(bmp);
      if (memDc != 0) _Gdi.deleteDc(memDc);
      if (screenDc != 0) _Gdi.releaseDc(0, screenDc);
    }
  }

  // ---- PowerShell 兜底 ----

  /// 脚本刻意保持**纯 ASCII**：PS 5.1 对无 BOM 的 UTF-8 中文会按 ANSI 解析而崩。
  static const String _psScript = r'''
param([Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object -TypeName System.Drawing.Bitmap -ArgumentList ([int]$b.Width), ([int]$b.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$b.Left, [int]$b.Top, 0, 0, $bmp.Size)
  $dir = Split-Path -Parent $Out
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $fi = Get-Item $Out
  if ($fi.Length -le 0) { Write-Output "ERR empty file"; exit 1 }
  Write-Output ("OK " + $fi.Length)
} catch {
  Write-Output ("ERR " + $_.Exception.Message)
  exit 1
}
''';

  static Future<CaptureResult> _captureViaPowerShell(String outPath) async {
    File? script;
    try {
      script = File('${Directory.systemTemp.path}'
          '${Platform.pathSeparator}xjk-shot-${DateTime.now().microsecondsSinceEpoch}.ps1');
      await script.writeAsString(_psScript, flush: true, encoding: const SystemEncoding());
      final r = await Process.run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script.path,
          '-Out',
          outPath,
        ],
      ).timeout(const Duration(seconds: 20));
      final out = '${r.stdout}'.trim();
      final err = '${r.stderr}'.trim();
      if (r.exitCode != 0 || !out.startsWith('OK')) {
        final why = out.isEmpty ? err : out;
        return CaptureResult.fail(
            why.isEmpty ? 'PowerShell 退出码 ${r.exitCode}' : why);
      }
      return CaptureResult(ok: true, path: outPath, detail: out);
    } catch (e) {
      return CaptureResult.fail('PowerShell 不可用：$e');
    } finally {
      try {
        if (script != null && await script.exists()) await script.delete();
      } catch (_) {}
    }
  }

  // -------------------------------------------------------------------------
  // 最小 PNG 编码器（纯 Dart：zlib + CRC32）
  // -------------------------------------------------------------------------

  /// BGRA（Windows DIB 的字节序）→ 最小 PNG（8bit RGBA，filter=None）。
  /// 公开是为了可单测：编码是纯函数，不需要真屏幕。
  static Uint8List encodePngFromBgra(int width, int height, Uint8List bgra) {
    assert(bgra.length >= width * height * 4);
    final stride = width * 4;
    // 每行前置一个 filter 字节（0 = None）。用 None 是有意的：
    // 这是"能用就行"的内部截图，不做滤波压缩率无所谓，省掉一整类实现错误。
    final raw = Uint8List((stride + 1) * height);
    var o = 0;
    for (var y = 0; y < height; y++) {
      raw[o++] = 0;
      final src = y * stride;
      for (var i = 0; i < stride; i += 4) {
        raw[o++] = bgra[src + i + 2]; // R ← B
        raw[o++] = bgra[src + i + 1]; // G
        raw[o++] = bgra[src + i]; // B ← R
        raw[o++] = 255; // 桌面没有透明像素，直接写满
      }
    }
    final out = BytesBuilder();
    out.add(const <int>[137, 80, 78, 71, 13, 10, 26, 10]);
    out.add(_chunk('IHDR', <int>[
      ..._be32(width),
      ..._be32(height),
      8, // bit depth
      6, // color type: truecolor + alpha
      0, // compression: deflate
      0, // filter method
      0, // interlace: none
    ]));
    // zlib 的压缩级别是 ZLibCodec 的**构造参数**，不是 encode() 的位置参数
    out.add(_chunk('IDAT', Uint8List.fromList(ZLibCodec(level: 6).encode(raw))));
    out.add(_chunk('IEND', const <int>[]));
    return out.toBytes();
  }

  static List<int> _be32(int v) =>
      <int>[(v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];

  static Uint8List _chunk(String type, List<int> data) {
    final typeBytes = ascii.encode(type);
    final b = BytesBuilder()
      ..add(_be32(data.length))
      ..add(typeBytes)
      ..add(data);
    final crc = _crc32(typeBytes, data);
    b.add(_be32(crc));
    return b.toBytes();
  }

  static final Uint32List _crcTable = _buildCrcTable();

  static Uint32List _buildCrcTable() {
    final t = Uint32List(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
      }
      t[n] = c;
    }
    return t;
  }

  static int _crc32(List<int> a, List<int> b) {
    var c = 0xFFFFFFFF;
    for (final part in [a, b]) {
      for (final byte in part) {
        c = _crcTable[(c ^ byte) & 0xFF] ^ (c >> 8);
      }
    }
    return (c ^ 0xFFFFFFFF) & 0xFFFFFFFF;
  }
}

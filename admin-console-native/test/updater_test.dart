/// 星集控 · OTA 引擎集成测试（全本地回路，不碰任何真实设备 / 不开真实 socket）
///
/// 通过注入假 http.Client 把一段内存里的 zip 当作"更新包"喂给 performUpdate，
/// 验证：下载 → sha256 校验 → 解压到 staging → 进度阶段齐全；
/// 以及两条失败路径（校验不符 / HTTP 404）正确进入 error 阶段。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import 'package:xingjikong/core/update_check.dart';
import 'package:xingjikong/core/updater.dart';

/// 把若干内存文件打成 zip 字节。
List<int> _buildZip(Map<String, List<int>> files) {
  final archive = Archive();
  files.forEach((name, content) {
    archive.addFile(ArchiveFile(name, content.length, content));
  });
  return ZipEncoder().encode(archive)!;
}

/// 假 HTTP 客户端：不连网，直接按状态/字节返回。
class _FakeClient extends http.BaseClient {
  final int status;
  final List<int>? bytes;
  _FakeClient({this.status = 200, this.bytes});

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (status != 200 || bytes == null) {
      return http.StreamedResponse(Stream<List<int>>.empty(), status);
    }
    final body = Stream<List<int>>.value(Uint8List.fromList(bytes!));
    return http.StreamedResponse(body, 200, contentLength: bytes!.length);
  }
}

void main() {
  group('performUpdate', () {
    test('下载→校验→解压 到 staging（relaunch=false）', () async {
      final payload = <String, List<int>>{
        'xingjikong.exe': List.filled(2048, 0x4D), // 假 exe
        'readme.txt': utf8.encode('hello xingjikong'),
        'data/app.so': utf8.encode('fake so'),
      };
      final zip = _buildZip(payload);
      final sha = sha256.convert(zip).toString();

      final client = _FakeClient(bytes: zip);
      final progress = <UpdateProgress>[];
      final version =
          AppVersion(version: '9.9.9', build: 99, url: 'http://x/release.zip', sha256: sha);
      await performUpdate(version,
          client: client, allowRelaunch: false, onProgress: progress.add);

      // 到达 done，且暴露了 staging 路径
      final done = progress.last;
      expect(done.phase, UpdatePhase.done);
      expect(done.stagingDir, isNotNull);

      // staging 含解压出的文件，且内容一致（含子目录）
      final staging = Directory(done.stagingDir!);
      expect(await File(p.join(staging.path, 'xingjikong.exe')).exists(), isTrue);
      expect(await File(p.join(staging.path, 'readme.txt')).exists(), isTrue);
      expect(await File(p.join(staging.path, 'data', 'app.so')).exists(), isTrue);
      final txt =
          await File(p.join(staging.path, 'readme.txt')).readAsString();
      expect(txt, 'hello xingjikong');

      // 关键阶段都出现过
      final phases = progress.map((e) => e.phase).toSet();
      expect(
          phases,
          containsAll(<UpdatePhase>[
            UpdatePhase.downloading,
            UpdatePhase.verifying,
            UpdatePhase.extracting,
            UpdatePhase.preparing,
          ]));
    });

    test('sha256 不符 → error', () async {
      final zip = _buildZip({'xingjikong.exe': [1, 2, 3]});
      final client = _FakeClient(bytes: zip);
      final progress = <UpdateProgress>[];
      final version = AppVersion(
          version: '9.9.9', build: 99, url: 'http://x/release.zip', sha256: 'deadbeef');
      Object? caught;
      try {
        await performUpdate(version,
            client: client, allowRelaunch: false, onProgress: progress.add);
      } catch (e) {
        caught = e;
      }
      expect(caught, isA<StateError>());
      expect(progress.last.phase, UpdatePhase.error);
    });

    test('HTTP 404 → error', () async {
      final client = _FakeClient(status: 404);
      final progress = <UpdateProgress>[];
      final version = AppVersion(
          version: '9.9.9', build: 99, url: 'http://x/nope.zip', sha256: '');
      Object? caught;
      try {
        await performUpdate(version,
            client: client, allowRelaunch: false, onProgress: progress.add);
      } catch (e) {
        caught = e;
      }
      expect(caught, isA<StateError>());
      expect(progress.last.phase, UpdatePhase.error);
    });
  });
}

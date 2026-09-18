# Stelarith Control Plugin — .cipx 官方渠道发布（自动更新）

星璃集控插件已按 ClassIsland 官方 `StartUpAsAdmin` 同款流程做成了 `.cipx` 官包，可走**官方插件渠道自动更新**（客户端按 manifest 的 `repoOwner/repoName` + Release 的 `.cipx` + MD5 自动检测并升级，不再依赖整机重装）。

> 官方格式参考：<https://docs.classisland.tech/zh-cn/latest/dev/plugins/create-project/>
> 本项目对标样例：本机 `classisland.startUpAsAdmin/publish/新建文件夹/`（144 `.cipx` 即 zip；`.md5sum` = MD5；`checksums.md` = 汇总 + 藏 `<!-- CLASSISLAND_PKG_MD5 {...} -->`）。

## 目录

```
publish/cipx/
  StelarithControlPlugin/
    manifest.yml                     # = 插件目录那份（版本号三处同步的那份）
    StelarithControlPlugin.dll        # 含 UI 线程公网卡死修复（165376 B）
    StelarithControlPlugin.deps.json
    StelarithControlPlugin.pdb      # 调试符号
    icon.png
  StelarithControlPlugin.cipx       # 官包（zip，118 KB）
  StelarithControlPlugin.cipx.md5sum   # MD5
  checksums.md                     # 汇总（含 CLASSISLAND_PKG_MD5 注释）
  generate-md5.ps1               # 自动重算 MD5（纯 ASCII，规避 PS5.1 无 BOM 按 ANSI 读的乱码坑）
```

## 每次发版命令（三步）

```bash
# 1) 进源码 Release 输出所在层，打 .cipx（zip）
cd ext/stelarith-classisland-plugin/publish
'C:\Program Files\7-Zip\7z.exe' a -tzip -mx=5 cipx/StelarithControlPlugin.cipx cipx/StelarithControlPlugin/*

# 2) 重算 MD5（生成 <file>.md5sum 与 checksums.md）
powershell -ExecutionPolicy Bypass -File ext/stelarith-classisland-plugin/publish/cipx/generate-md5.ps1

# 3) 传 GitHub Release：把 StelarithControlPlugin.cipx + .md5sum 传到一个 Release tag 下
#    asset 前缀放 release 的 <tag>/StelarithControlPlugin.cipx
```

## 让 ClassIsland 客户端自动更新（"王中王"一条）

manifest.yml 已含 `repoOwner: WuMengAA` / `repoName: CIMS-Next` / `assetsRoot: main`。
在 ClassIsland 的 `PluginsIndex`（商店索引或内网 PluginMarket）里为该插件登记：

```yaml
- id: StelarithControlPlugin
  displayName: 星璃集控客户端
  downloadUrl: https://github.com/WuMengAA/CIMS-Next/releases/download/<tag>/StelarithControlPlugin.cipx
  downloadMd5: 1333C48DC03008F4955CF5ED8C139994
  manifest:     # 即 cipx 内 manifest.yml 同内容
```

客户端检测到该仓库新 tag / 新版本后，会按 `DownloadUrl` 拉 `.cipx` + 校验 `DownloadMd5` 自动更新 —— 后续发版只需打 .cipx → 传 release，所有已接入的教室机自动升级，不再整机重装。

> ⚠️ 发版前务必同步三处版本号：`manifest.yml version` ↔ `csproj <Version>` ↔ git tag。

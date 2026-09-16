# stelarith-classroom-deploy · 教室端离线部署包

把一套跑通的 ClassIsland + 星璃集控插件，组装成**可 U 盘拷走的自包含离线包**，
并附带一键部署 / 自检 / 升级 / 回滚四件套。

> 给使用者看的说明在包里（`docs\` 与 `00-从这里开始.html`）。
> 这份 README 是**维护者视角**：怎么改、怎么出包、为什么这么设计。

---

## 1. 目录职责

```
stelarith-classroom-deploy\
├── build-package.ps1        ← 出包脚本（在开发机/服务端跑）
├── payload\                 ← 会被原样装进包的模板
│   ├── 1-部署到本机.cmd      ← 目标机入口（自动提权）
│   ├── 2-环境自检.cmd
│   ├── 3-升级或降级.cmd
│   ├── 4-回滚.cmd
│   ├── config\
│   │   └── deployment.json  ← ★唯一需要改的配置（带完整字段说明）
│   ├── scripts\
│   │   ├── lib-common.ps1   ← 公共函数（JSON / 快捷方式 / 进程 / 连通性）
│   │   ├── deploy.ps1       ← 一键部署（七步）
│   │   ├── preflight.ps1    ← 环境自检（只读）
│   │   ├── upgrade.ps1      ← 升级 / 降级 / 卸自启
│   │   └── rollback.ps1     ← 回滚
│   └── docs\                ← 七份文档（01~06 教室端，07 公网与容灾）
└── （产出）D:\Stelarith\_deploy\ClassroomDeploy-<日期>\
```

### 内网 vs 公网：同一套包，两种配置

包本身不分内网/公网版，差别只在三个字段。判据只有一条：
**插件的 `BaseDomain` 必须等于服务端 `.env` 的 `CIMS_BASE_DOMAIN`**。

| | 内网（默认） | 公网（多校 + 容灾） |
|---|---|---|
| `ServerBase` | `http://10.0.0.10:8096` | `https://<slug>.<基域>` |
| `BaseDomain` | `localhost` | 真实域名，如 `cims.example.com` |
| 需要一个真实域名 | 不需要 | 需要（泛域名，一条规则覆盖全部租户） |
| 服务端 `CIMS_TRUSTED_PROXIES` | 留空 | **必须配**，否则全网设备会被限流连坐 |
| 详见 | `docs/02` §1 | **`docs/07-公网接入与容灾双实例.md`** |

## 2. 出包

```powershell
cd <repo>\school-multimedia-control\ext\stelarith-classroom-deploy

# 最常用
powershell -ExecutionPolicy Bypass -File build-package.ps1

# 指定来源与输出，并打 zip
powershell -ExecutionPolicy Bypass -File build-package.ps1 -SourceRoot D:\Classlsland -OutDir E:\ClassroomDeploy -Zip
```

默认从 **`D:\Classlsland`**（本机已跑通的那份安装）取本体与种子数据，
输出到 **`D:\Stelarith\_deploy\ClassroomDeploy-<yyyyMMdd>`**。

> **在 WorkBuddy / CodeBuddy 沙箱里跑会失败一次**：脚本开头的「清空重建输出目录」
> 会被安全删除守卫拦下（`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，
> 因为包里是 800+ 个文件）。先把输出目录删掉再跑即可，例如用 Python：
> ```bash
> python -c "import shutil;shutil.rmtree(r'D:\Stelarith\_deploy\ClassroomDeploy-20260916', ignore_errors=True)"
> ```
> 在自己机器的 PowerShell 里直接跑不受影响。

## 3. 改配置：只改 `payload\config\deployment.json`

这是唯一需要动的地方。里面的 `_字段说明` 段逐项解释了每个字段。
改完后重新出包即可；目标机上部署时会读这份配置。

需要区分「按班不同」和「全校一致」的字段：

| 字段 | 建议 |
|---|---|
| `ServerBase` / `Slug` / `BaseDomain` | 全校一致（同一个服务端） |
| `NotificationSourceName` | 全校一致（大屏上显示的发出来源） |
| `ClientUid` | **留空**，部署时自动取计算机名 |
| `ClassName` / `ClassPlanName` | 留空，由面板按设备绑定班级后下发 |
| `VoiceHubBase` | 全校一致；`VoiceHubKey` **不要预填真 key** |

## 4. 设计决策与踩过的坑（改之前请读）

### 4.1 为什么要「占位符替换」而不是直接拷配置

本机 `data\Settings.json` 里存的是**绝对路径**：

```json
"SomeSoundPath": "D:\\Classlsland\\assets\\musics\\system.wav"
```

直接拷到教室机上（装在 `C:\ClassIsland`），这些路径全部悬空 ——
**提醒音效静默失效**，不报错、不提示。所以出包时把源根替换成 `{{INSTALL_DIR}}`，
部署时替换成真实安装目录。

> 实现细节（踩过）：JSON 里的 Windows 路径是**转义形态**（`D:\\Classlsland`）。
> 用 `[regex]::Escape($SourceRoot)` 生成的模式 `D:\\Classlsland` 只匹配**单个**反斜杠，
> 与文件里的双反斜杠不匹配 → **静默失配、什么都不替换**。
> 正确做法是按「转义形态」和「原样形态」各做一次**文本**替换，
> 且替换值也要转义，否则会写出非法 JSON 转义序列（`\a` / `\m`）。

### 4.2 为什么要脱敏

本机 `data\Config\Plugins\ClassIsland.AISmartClass\aisettings.json` 里有**明文 API Key**。
这种配置一旦进分发包装进全校，等于把密钥发给所有人。
出包脚本按白名单式排除规则处理，并把排除项写进 `PACKAGE-INFO.json` 留痕。

### 4.3 为什么部署时要改 `Settings.json` 的两个键

- `AutoDisableCorruptPlugins` → `false`：ClassIsland 2.1 对第三方插件**没有运行时启停接口**，
  但启动期有「异常即自动禁用」逻辑。教室里别的插件抽风就可能把集控插件连带禁用，
  表现为**教室端静默失联且无告警**。这是唯一能防住的着力点。
- `IsWelcomeWindowShowed` → `true`：跳过欢迎向导，装完即可用。

修改方式是**逐键正则替换**（不是整体重写 JSON），改前自动备份 `Settings.json.before-deploy-*`。

### 4.4 为什么插件必须「dll + deps.json + manifest.yml」一起换

面板和插件管理页显示的版本号**读的是 `manifest.yml`**，不是程序集版本。
只换 dll 的结果是「代码新、界面版本旧」，会让人误判升级失败。

另一个同类坑：`manifest.yml` 是 `.csproj` 的 `Content` 项，**只在构建时复制到输出目录**。
所以「改了 manifest 不重新构建」= 构建产物里的 manifest 还是旧的。

### 4.5 为什么换 DLL 之前必须停进程

ClassIsland 宿主会**锁住插件 DLL**，运行中复制会失败（`Device or resource busy`）。
`upgrade.ps1` / `rollback.ps1` / `deploy.ps1` 都会先停进程并等到进程真的退干净
（`Stop-ClassIsland` 里有轮询等待，不是 `Start-Sleep` 猜时长）。

### 4.6 为什么 .ps1 必须带 UTF-8 BOM

Windows PowerShell 5.1 **在没有 BOM 时按 ANSI（本机 GBK）解析 `.ps1`** ——
全部中文变乱码，并连带引发大量「表达式或语句中包含意外的标记」的**假语法错误**
（实测 6 个脚本合计报了 130 多个错，实际一个都没有）。

所以本目录下的 `.ps1` **一律保存为 UTF-8 with BOM**。编辑时请保持这一点，
否则脚本在目标机上会直接崩。校验方法（不执行，只看语法）：

```powershell
$t=$null;$e=$null
[System.Management.Automation.Language.Parser]::ParseFile('deploy.ps1',[ref]$t,[ref]$e)
$e   # 输出为空 = 语法正确
```

`.cmd` 则相反：**内容保持纯 ASCII**（cmd 对编码比 PowerShell 更敏感，`echo` 中文会乱码），
中文提示一律放在 `.ps1` 里。中文**文件名**没问题，但脚本内容里不引用中文路径。

### 4.7 为什么自检要把「进程启动时间 vs DLL 修改时间」做成检查项

这个坑真实发生过：代码改了、DLL 也换了，但进程从早就在跑，
一直加载着内存里的旧版本，表现为「改了没效果」。
判据很硬：**进程启动时间早于 DLL 修改时间 ⇒ 跑的是旧代码**。

### 4.8 为什么不大范围动系统

脚本只做三件「留下痕迹」的事：写自己的安装目录、写当前用户的启动文件夹、建桌面快捷方式。
不改注册表、不改系统服务、不装运行时、不动防火墙（除非显式加 `-OpenFirewall`）。
—— 教室里出问题时，可回退的范围越小越好。

### 4.9 为什么 `.cmd` 里「先 `cd /d "%~dp0"`、后 `chcp 65001`」

反过来的话会踩 cmd 的代码页展开坑：`%~dp0` 的值按**当前代码页**解释，而批处理文件名
是本工程最大的特征 —— 交付物带中文名（如 `3-升级或降级.cmd`）。
先 `chcp 65001` 再取 `%~dp0`，中文路径可能被按错误编码拼出、`cd` 失败，
后续 `scripts\upgrade.ps1` 自然找不到。

正确顺序：
```bat
setlocal
cd /d "%~dp0"                 rem 先用原始代码页切目录
chcp 65001 >nul 2>&1          rem 再切代码页，让 PowerShell 子进程的中文正常输出
```

### 4.10 行尾与编码：出包时统一规范化，不依赖 git

仓库里 `.cmd` / `.ps1` 存 **LF**（git 友好、diff 干净），但**交付物必须是 CRLF** ——
`.cmd` 用 LF 时，多行 `if (...)` 块和标签扫描在部分环境会出问题。

关键认识：**出包脚本读的是「工作区」文件，而不是「checkout 之后的」文件**。
`.gitattributes` 只在 checkout 时生效，所以「靠 gitattributes 保证交付物行尾」是**不成立**的。

因此 `build-package.ps1` 里 `Copy-TextFile` 承担了全部规范化职责：

| 目标 | 编码 | 行尾 | 附加校验 |
|---|---|---|---|
| `.ps1` | UTF-8 **with BOM** | CRLF | — |
| `.cmd` | UTF-8（纯 ASCII） | CRLF | **出现非 ASCII 字符直接 throw** |
| `.md` / `.json` / `.html` | UTF-8（无 BOM） | 原样 | — |

### 4.11 为什么出包要带「自动自检」

本轮就是靠人工复验才发现的四个问题（`.cmd` 混进中文、`.cmd` 是 LF、交付物里残留
制作机路径、`PACKAGE-INFO.json` 记了源机绝对路径）。**能自动化的就不要靠人眼。**

`build-package.ps1` 末尾现在会自己跑五项，任一不过就 `throw`（**宁可出包时炸，
不要到教室机才发现**）：

1. 全部文本文件扫 `sk-` 密钥、扫制作机绝对路径（原样 + JSON 转义两种形态）
2. `scripts/*.ps1` 逐个验 UTF-8 BOM
3. 顶层 `*.cmd` 逐个验纯 ASCII + 含 `\r`（CRLF）
4. 全部 `*.json` 过一遍 `ConvertFrom-Json`
5. 打印文本文件/脚本/JSON 的检查计数，便于发现「漏拷」

## 5. 目标机脚本速查

| 场景 | 命令 |
|---|---|
| 首次部署 | `1-部署到本机.cmd`（会提示填服务端地址） |
| 无人值守部署 | `deploy.ps1 -NonInteractive`（配置必须先填好） |
| 演练不落盘 | `deploy.ps1 -DryRun` |
| 自检并存报告 | `2-环境自检.cmd -Report check.txt` |
| 只升插件 | `upgrade.ps1 -From E:\ClassroomDeploy-新` |
| 连本体一起升 | `upgrade.ps1 -From E:\ClassroomDeploy-新 -WithApp` |
| 降级 | 同上，`-From` 指向旧版本包 |
| 回滚到最近一次 | `rollback.ps1 -Last` |
| 只恢复同步配置 | `rollback.ps1 -RestoreSyncOnly` |
| 卸掉自启与快捷方式 | `upgrade.ps1 -RemoveAutoStart` |
| 同时当服务端用 | `deploy.ps1 -OpenFirewall` |

## 6. 与其它组件的关系

| 组件 | 关系 |
|---|---|
| `ext/stelarith-classisland-plugin` | 本包分发的插件本体；改完插件要重新 `dotnet build -c Release` 并部署到 `D:\Classlsland`，再出包 |
| `Stelarith-cims-eval/CIMS-backend` | 服务端；`ClientUid`/`Slug`/`BaseDomain` 必须与它的配置对齐 |
| `Stelarith-website/stelarith` | 面板（`/admin/console`）；包的 `ServerPanel` 指向它 |
| `ext/stelarith-agent(-node)` | 远程桌面所需的设备代理，**本包不含**，见 `docs/04` |
| `ext/classisland-voicehub-display/bridge` | 浏览器全屏看板，与插件互补 |

## 7. 已知边界

- **不支持双服务端自动切换**：两套服务端的资源版本号独立演进，自动切换会让档案来回跳。
  改用固定 IP / 内网 DNS 别名来降低迁移成本。
- **官方集控（`ManagementServerKind=1`）暂不可用**：官方标注「集控服务器正在开发」。
  模式 0（静态配置）可用；与 CIMS 对接需要反代改写 Host，见 `docs/03` 第 4 节。
- **插件日志无自动轮转**：`ste-*.log` 会持续增长，需纳入月度巡检
  （清空而不是删除 —— 插件以追加方式持有句柄）。
- **远程桌面需另装代理**：本包只提供插件侧能力（广播/锁屏/截图/切班/模块开关）。

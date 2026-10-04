# stelarith · 站点侧自有数据流域（src/lib/server/stelarith/）

> 依据架构定稿：「**实时走云端，账本走站点，界面在 Qt**」。
> 站点＝**无头服务端 + 账本**（账号会话、设备台账与班级绑定、通知、文件、审计、课表），不做面向老师的界面。
>
> 本目录是 **CIMS 退伍（2026-10-04 裁决：全量退伍 + 数据切自有）后，从 CIMS 迁过来的自有数据流的家**。
> 原则：**接入现成站点契约，不另立一套**；每个子模块用独立文件/子目录，职责单一、可单测。

## 目录约定

```
stelarith/
├── README.md          ← 本文件
├── classes/           ← 班级真源（替代 CIMS /class/list）
│                        · 数据源：站点 user_class_bindings + 云端设备注册表
│                        · 目标：班级列表/设备↔班级映射的单一出口
├── devices/           ← 设备台账（替代 CIMS /class/device-map）
│                        · 数据源：云端 8788 设备注册表（在线表）
│                        · 目标：uid 规范化 + 范围判定 + 定向广播解析
├── broadcast/         ← 广播下大屏（替代 CIMS command_queue → 教室大屏插件）
│                        · 目标：改走云端 WS 指令通道（agent 侧补 notify 动作）
│                        · 未完成前：保留降级路径（留痕 + 明确报"通道未就绪"）
├── receipts/          ← 回执聚合（替代 CIMS 回执 → notice_deliveries）
├── files/             ← 文件推送（替代 CIMS 文件转发 → file_deliveries）
└── accounts/          ← 账号镜像（替代 syncUserToCims；站点已是账号权威，镜像可停）
```

## 迁移状态

| 子域 | CIMS 依赖现状 | 自有替代 | 状态 |
|---|---|---|---|
| classes | `cims-client.fetchClassList` | user_class_bindings + 云端注册表 | ⬜ 待迁移 |
| devices | `cims-client.fetchDeviceClassMap` | 云端设备注册表 | ⬜ 待迁移 |
| broadcast | `broadcast.ts` → CIMS command_queue | 云端 WS notify 动作 | ⬜ 待补 agent 动作 |
| receipts | `cims-reply-sync.ts` | 云端回执 → notice_deliveries | ⬜ 待迁移 |
| files | `file-transfer.ts` → CIMS | 云端 file 动作（已支持） | ⬜ 待迁移 |
| accounts | `cims-account.ts` / `syncUserToCims` | 站点为权威，镜像可停 | ⬜ 待停 |

## 纪律

1. **接现成契约，不另立第三套真源**（本项目反复栽过的坑）。
2. 迁移时**旧文件不删**：先把新域模块写好、验证通过，再让调用方切引用；最后 CIMS 服务停止后才清 `cims-*`。
3. 每个子模块交付 = 接口 + 单测/探针 + 负向对照（CIMS 不可达时的行为要明示，不许静默）。

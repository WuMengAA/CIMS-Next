# 高斯泼溅（Gaussian Splatting）接入计划

## 定位
2028届八班 3D 教室的**进阶炫技**方案。当前 /campus/2028/class8/classroom3d 已用 Three.js 全景图（equirectangular 球体贴图）实现可交互教室 + 热点讲解，满足基础验收。

高斯泼溅能提供**真正可自由走动、可互动的 3D 场景**（非固定视点全景），视觉冲击力远超全景图。

## 为何暂不接入
- **成本高**：需对教室进行专业采集（多角度照片 + 重建），或用 3D 建模重建。
- **性能消耗大**：单个 .splat 文件数十 MB，渲染需 GPU，移动端/老旧设备帧率低。
- **素材未就绪**：当前无真实教室的高斯泼溅数据。

## 采集指南

### 方案 A：手机 App 一键采集+重建（推荐先用）

| App | 平台 | 导出格式 | 价格 |
|-----|------|---------|------|
| **Polycam** | iOS/Android | .ply / .splat | 免费（LiDAR 版付费） |
| **Luma AI** | iOS/Android | .ply | 免费 |
| **3D Scanner App** | iOS（需 LiDAR） | .ply / .usdz | 免费 |

**步骤**（以 Polycam 为例）：
1. 下载 Polycam → 选"Gaussian Splatting"模式
2. **拍摄**：手机稳定、缓慢移动，边走边拍；路线：门口 → 沿讲台走一圈 → 到后排再回讲台（闭环）；每走 1 步停 2 秒，全程 200-500 张照片
3. **自动处理**：App 调用云端重建，约 10-30 分钟
4. **导出**：下载 .ply 或 .splat 文件

**采集技巧**：

| 要点 | 做法 | 原因 |
|------|------|------|
| 光线 | 开所有灯，白天别拉窗帘 | 光太暗细节丢失 |
| 速度 | 缓慢匀速，不抖 | 手抖导致重建"鬼影" |
| 重叠 | 前后帧至少 60% 重叠 | 重叠不够无法匹配特征 |
| 视角 | 从下往上、从上往下都拍 | 只拍水平会丢天花板/地板 |
| 死角 | 绕每个柱子/柜子走半圈 | 死角重建失败 |
| 隐私 | 避开人脸正对镜头 | 涉及学生隐私 |
| 移动物体 | 关闭风扇、赶开走动学生 | 移动物体重建后是"半透明鬼影" |

### 方案 B：开源工具链（完全可控，质量更高）

**工具**：COLMAP（位姿估计）+ gsplat（高斯泼溅训练）

**硬件**：CPU 任意 + GPU NVIDIA RTX 3060 及以上（或云端 Colab）

**安装**：
git clone https://github.com/colmap/colmap.git && cd colmap
mkdir build && cd build && cmake .. -DGPU_ENABLED=ON -DCUDA_ARCHITECTURES=70 && make -j8
git clone https://github.com/gsplat/gsplat.git && cd gsplat && pip install -e .

**处理**：
colmap feature_extractor --database_path database.db --image_path photos/
colmap matcher --database_path database.db --exhaustive_matcher
colmap bundle_adjuster --database_path database.db --image_path photos/ --output_path sparse/
python gsplat/train.py --data_dir sparse/0 --image_path photos/ --output_dir output/ --iterations 30000 --ssim --save_splat output/classroom.splat

**Colab 云端方案**（没 GPU）：colab.research.google.com 搜 "gsplat notebook"，上传照片运行，下载 .splat。免费 Pro 每月 144 小时 GPU。

## 处理流程（采集完到能用）

| 产物 | 大小 | 说明 |
|------|------|------|
| 手机照片 | 500MB-2GB | 采集原始数据 |
| COLMAP 稀疏点云 | 1-5MB | sparse/0/points3D.ply |
| 高斯泼溅模型 | **20-80MB** | .splat 或 .ply |
| 最终部署文件 | 10-40MB | 压缩后 |

**压缩**：
npx @mkkellogg/gsplats-transform classroom.splat classroom-compressed.splat --target-size 30mb

| 格式 | 大小 | 加载速度 | 质量 | 推荐 |
|------|------|---------|------|------|
| .splat 原始 | 80MB | 慢 | 最佳 | ❌ |
| .splat 压缩 | 30MB | 中 | 优 | ✅ **推荐** |
| .glb | 5-15MB | 快 | 中 | ✅ 低端设备 |
| .ply | 100MB+ | 慢 | 中 | ❌ |

## 网站接入（已预留接口）

当前 classroom3d/+page.svelte 的 Three.js 场景结构可直接扩展：

import { SplatsRenderer } from "@mkkellogg/gsplats-three";
const splats = new SplatsRenderer();
await splats.loadFile("/campus/class8/classroom.splat");
scene.add(splats);
// 热点（dot）逻辑保持不变，只是贴在真实几何上

部署：cp classroom.splat D:/Stelarith/Stelarith-website/stelarith/static/campus/class8/

## 启用条件（待"好消息"）
1. 拿到教室高斯泼溅数据文件（.splat/.ply，≤30MB 为佳）
2. 确认目标设备 GPU 够用（教室一体机）
3. 用户确认开启（性能 vs 效果取舍）

## 功能规划

| 功能 | 状态 | 说明 |
|------|------|------|
| 全景图可交互 | ✅ 已实现 | Three.js 球体贴图 + OrbitControls |
| 热点点击讲解 | ✅ 已实现 | Raycaster 拾取 + 弹卡片 |
| **自动运镜讲解** | 🔧 **开发中** | 相机沿路线自动飞行 + TTS 语音 |
| 实时集控数据叠加 | ⚪ 计划 | 设备状态/温度标注在 3D 场景 |
| 多视角切换 | ⚪ 计划 | 教师/学生/讲解员预置机位 |
| 时间轴穿越 | ⚪ 计划 | 多时间点场景演变（成本高） |

## 注意事项

| 风险 | 应对 |
|------|------|
| 学生隐私 | 拍空教室或学生背影，别拍脸 |
| 光线不足 | 白天拍 + 开灯，避免暗部细节丢失 |
| 移动物体 | 关闭风扇、赶开走动的人 |
| 手抖 | 缓慢匀速，用三脚架或稳定器 |
| 文件大小 | 压缩到 30MB 以内，用 LOD 分层 |
| 加载慢 | 全屏 loading + 全景图占位，加载完无缝切换 |

## 推荐行动计划

| 步骤 | 做什么 | 耗时 | 产出 |
|------|--------|------|------|
| 1 | 下载 Polycam App，熟悉操作 | 10 分钟 | 会用了 |
| 2 | 找空教室时段采集一圈 | 30 分钟 | 200-500 张照片 |
| 3 | App 自动处理 | 10-30 分钟 | 得到 .splat 文件 |
| 4 | 下载 .splat 到电脑 | 5 分钟 | 本地文件 |
| 5 | 压缩到 30MB 以内 | 5 分钟 | classroom-compressed.splat |
| 6 | 部署到 static/campus/class8/ | 2 分钟 | 网站能用 |
| 7 | 改 classroom3d/+page.svelte 接入 | 30 分钟 | 上线 3D 教室 |

**总耗时**：约 1.5 小时（不含 App 处理等待）

## 当前占位
页面底部已标注："💡 高斯泼溅（可互动 3D 场景）已列入计划，待条件成熟接入"。
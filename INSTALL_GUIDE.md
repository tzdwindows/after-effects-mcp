# After Effects MCP 完整安装与使用指南 (Complete Installation & Usage Guide)

> **版本 (Version)**: `v1.1.0`  
> **适用版本**: Adobe After Effects 2022 / 2023 / 2024 / 2025 / 2026 (Windows & macOS)

---

## 一、完整压缩包目录说明 (Package Contents)

本发行版提供**开箱即用的完整打包程序**，解压后包含所有已编译的核心文件与内置模型：

```text
after-effects-mcp/
├── dist/
│   ├── index.js                      # MCP 服务端主入口文件（供 Claude / Cursor / Cline / Antigravity 调用）
│   ├── scripts/
│   │   ├── mcp-bridge-auto.jsx       # After Effects 桥接控制面板脚本（复制到 AE ScriptUI Panels）
│   │   └── installer.js              # 自动检测 AE 路径、安装插件并清理主菜单残留备份的工具
│   ├── audio/
│   │   ├── beat-analyzer.js          # 多频段鼓点 (Kick/Snare/HiHat)、BPM 与高潮段落检测引擎
│   │   ├── mms-aligner.js            # MMS-Align / CTC-Segmentation 声学强制对齐字幕引擎
│   │   └── dsp-utils.js              # 音频解码、STFT 与 80-Mel 滤波器组特征提取
│   └── video/
│       └── dover-scorer.js           # DOVER-Mobile 视频质量与音画同步打分引擎
├── models/
│   ├── dover_mobile/
│   │   └── dover_mobile.onnx         # 内置官方 DOVER-Mobile (ConvNeXtV2-Femto-3D) 视频评分模型权重
│   └── mms_fa/
│       ├── ctc_aligner.int8.onnx     # 内置神经声学 CTC 强制对齐模型权重
│       ├── silero_vad.onnx           # 内置 Silero VAD v6 人声活动检测模型权重
│       └── tokens.txt                # CTC 子词与音素词表
├── bin/
│   └── ffmpeg.exe                    # 内置音视频解码器（无需单独配置系统环境变量）
├── install-bridge.bat                # Windows 一键安装与菜单清理脚本（双击运行）
├── install-bridge.sh                 # macOS / Linux 一键安装与菜单清理脚本
├── package.json                      # Node.js 依赖配置
└── INSTALL_GUIDE.md                  # 本安装与使用说明文档
```

---

## 二、三步快速安装 (3-Step Quick Setup)

### 第一步：安装依赖并部署 AE 面板脚本

1. 确保电脑已安装 **Node.js**（推荐 `v18+` 或 `v20+`）。
2. 解压完整安装包到任意固定目录（例如 `D:\after-effects-mcp`）。
3. **Windows 用户**：直接双击运行根目录下的 **`install-bridge.bat`**（或在终端执行 `npm install && npm run install-bridge`）。  
   **macOS 用户**：在终端执行 `bash install-bridge.sh`。
   > **自动完成的操作**：
   > - 自动安装/校验 `onnxruntime-node` 原生推理依赖；
   > - 自动扫描本机所有 Adobe After Effects 安装目录；
   > - **自动清理 AE 主菜单 / 窗口菜单 / 最近打开列表中堆积的历史备份文件**（所有备份统一安全隔离在 `~/.ae-mcp/backups/`，绝不污染 AE 主菜单）；
   > - 将最新的 `dist/scripts/mcp-bridge-auto.jsx` 安装到 AE 的 `Support Files/Scripts/ScriptUI Panels/` 目录。

*(注：如果您想手动复制面板脚本，只需将 `dist/scripts/mcp-bridge-auto.jsx` 复制到 AE 安装目录下的 `Support Files\Scripts\ScriptUI Panels\` 即可，切勿在该文件夹内放置任何带“副本/.bak”后缀的备份文件。)*

---

### 第二步：开启 After Effects 脚本权限并打开面板

1. 启动 **Adobe After Effects**。
2. 开启脚本读写权限：
   - **Windows**：顶部菜单 `编辑 (Edit)` -> `首选项 (Preferences)` -> `脚本和表达式 (Scripting & Expressions)`
   - **macOS**：顶部菜单 `After Effects` -> `设置 (Settings)` -> `脚本和表达式 (Scripting & Expressions)`
   - 勾选 **“允许脚本写入文件和访问网络” (Allow Scripts to Write Files and Access Network)**，点击确定。
3. 打开桥接面板：
   - 点击顶部菜单 **`窗口 (Window)`** -> 在底部点击 **`mcp-bridge-auto.jsx`**。
   - 面板包含 4 个功能标签页：
     1. **图层助理**：自然语言直接选中图层加特效与关键帧
     2. **模型与接口设置**：配置 OpenAI / DeepSeek / Claude / Gemini / Ollama
     3. **音画对齐与DOVER评分**：一键提取音频鼓点打标、MMS-CTC 精准字幕对齐、DOVER-Mobile 视频质量打分
     4. **桥接与系统日志**：保持 `自动执行指令 (Auto-run)` 勾选即可全自动后台响应 MCP 指令。

---

### 第三步：在 AI 客户端中配置 `dist/index.js`

将以下 JSON 配置添加到您的 AI 编程助手或客户端（请将路径替换为您实际的解压路径）：

#### Cursor / Cline / Antigravity / Windsurf / Claude Desktop 配置：
```json
{
  "mcpServers": {
    "after-effects": {
      "command": "node",
      "args": [
        "D:/cppp/after-effects-mcp/dist/index.js"
      ]
    }
  }
}
```

---

## 三、核心新增功能详解 (New Features in v1.1.0)

### 1. 彻底修复主菜单备份堆积问题 (Zero Menu Clutter Fix)
- **修复原因**：旧版在快照保存时调用了 `app.project.save(snapFile)`（在 AE 中等同于“另存为”），导致每次执行指令都会把 `snapshot_<时间戳>.aep` 写入 AE 的 `文件 -> 最近打开的文件 (Open Recent)` 主菜单并劫持当前工程路径；同时 `ScriptUI Panels` 下的备份脚本也会被 AE 扫描进 `窗口 (Window)` 主菜单。
- **修复方案**：
  - 改为先在原工程上原位调用 `app.project.save()`，再通过操作系统级静默文件复制 (`File.copy`) 生成快照，**绝不触发另存为，绝不向 AE 主菜单添加任何快照记录**；
  - 面板启动时自动调用 `cleanSnapshotEntriesFromMRU()` 清理 AE 首选项 `MRU` 列表中的历史 `snapshot_*.aep` 残留；
  - 提供 `cleanBridgeBackups` 工具随时一键清理残留。

### 2. 多频段音频鼓点、节拍与高潮检测 (`analyzeAudioRhythm` & `applyBeatMarkersToComp`)
- **原理**：采用 2048 点 STFT 短时傅里叶变换 + 三频段半波整流谱通量 (Spectral Flux) + Ellis (2007) 动态规划节拍追踪算法：
  - **Kick 底鼓频段 (`20Hz – 150Hz`)**：精准捕捉 808 与底鼓重击；
  - **Snare 军鼓/拍手频段 (`150Hz – 2500Hz`)**：精准捕捉反拍军鼓与 Clap；
  - **Hi-Hat 踩镲频段 (`2500Hz – 10500Hz`)**：捕捉高频律动瞬态；
  - **结构分段**：自动识别 `intro`（前奏）、`verse_groove`（主歌律动）、`buildup`（情绪铺垫）、`climax_drop`（高潮爆发）时间区间，并给出运镜建议。
- **自动打标**：调用 `applyBeatMarkersToComp` 可直接在 AE 合成时间线上生成带颜色标签的小节重拍 (`BAR DOWNBEAT`) 与强鼓点冲击 (`DRUM IMPACT`) 标记。

### 3. MMS-Align / CTC-Segmentation 精准强制字幕对齐 (`alignLyricsWithMMS` & `createAlignedLyricLayers`)
- **原理**：内置神经声学 CTC 模型 (`models/mms_fa/ctc_aligner.int8.onnx`) + `silero_vad_v6.onnx` 人声检测 + 10ms 高分辨率谐波人声包络 + **Kürzinger et al. (2020) CTC-Segmentation Viterbi 动态规划强制对齐网格**。
- **解决痛点**：传统 LRC 歌词只有粗略行时间戳，遇到歌手拖拍、休止符或高潮前停顿（如 1.5 秒呼吸间隙）时，文字动效会严重脱节。本功能可直接计算出**每一个单词/字 (`word`) 的精确起止毫秒时间 (`startTime`, `endTime`)、LRC 漂移修正量 (`driftCorrectionMs`) 以及距离最近鼓点的毫秒偏差 (`beatOffsetMs`)**，并可一键在 AE 中生成精准卡点的 3D 字幕图层。

### 4. 内置 DOVER-Mobile 视频质量与音画同步评分 (`evaluateVideoWithDOVER`)
- **原理**：内置官方 **DOVER-Mobile** (`models/dover_mobile/dover_mobile.onnx`, `ConvNeXtV2-Femto-3D`) 双分支解耦视频质量评估网络：
  - **Technical Quality (技术质量分支, `7x7x32x32` 原生分辨率网格切片)**：评估画面清晰度、模糊伪影、曝光裁切、噪点与帧间抖动（0–100 分）；
  - **Aesthetic Quality (美学质量分支, `224x224` 全局构图视图)**：评估色彩和谐度、光影对比度、构图平衡感与视觉丰富度（0–100 分）；
  - **Audio-Visual Beat Sync Score (音画卡点同步分)**：对比视频画面光流/像素运动峰值与音频鼓点瞬态的重合度（0–100 分），并输出分时段诊断报告与修改建议。

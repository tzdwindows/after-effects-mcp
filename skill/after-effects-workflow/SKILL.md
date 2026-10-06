---
name: after-effects-workflow
description: >-
  After Effects 动态视觉与音乐PV制作全流程工作流指南。规范目录结构（素材/渲染/aep）、
  音频歌词处理（时间轴对齐/情感分析）、SVG矢量素材绘制、分级制作标准（低负载样板原型 -> 增量迭代 -> 终版细化）、
  以及AE MCP全套工具链的高级视觉美学应用。
---

# After Effects MCP 动效与音乐PV专业制作指南 (Skill)

本技能指南专门指导 AI Agent 如何利用 `after-effects-mcp` 工具链，与用户协同制作电影级、高水准视觉效果的动画和音乐 PV（Music Promotion Video），同时严格遵守工作间目录规范与分阶段性能优化法则。

---

## 一、 核心工作原则与标准流程 (Core Lifecycle)

制作动画（尤其是音乐 PV）切忌一开始盲目堆砌高消耗特效导致 AE 卡死或崩溃。必须严格贯彻 **先思考 -> 充分沟通 -> 样板原型 -> 增量反馈 -> 终版细化** 的闭环流程：

```mermaid
flowchart TD
    A[收到用户需求] --> B[深度思考 & 意图拆解]
    B --> C[主动询问关键时间段与画面意图]
    C --> D{是否为音乐 PV?}
    D -- 是 --> E[获取/提取音频与歌词文件]
    D -- 否 --> F[梳理剧本分镜/关键画面]
    E --> G[歌词/歌曲情感与节奏拆解]
    F --> H[检查素材资源]
    G --> H
    H --> I{素材是否齐全?}
    I -- 缺失 --> J[询问用户意图 / 动态手绘SVG矢量素材]
    I -- 齐全 --> K[规范工作间目录结构]
    J --> K
    K --> L[制作第0阶段: 轻量样板原型 (绝对防卡顿)]
    L --> M[用户确认与反馈]
    M -- 发现问题/提出想法 --> N[修复Bug / 针对性调整]
    M -- 认可样板 --> O[进入第1阶段: 镜头运镜/连线/发光细化]
    N --> M
    O --> P[最终合成与 AME 渲染输出]
```

### 1. 阶段一：深度思考与主动询问（先思而后问）
- **先思考 (Internal Reasoning)**:
  - 用户的视觉核心痛点是什么？（节奏感、视觉饱满度、冲击力、几何现代感、色彩氛围）
  - 目标时长或段落具体落在哪些帧区间？
- **主动询问用户**:
  - 明确询问：“在第 XX 秒（第 XX 帧）到第 YY 秒（第 YY 帧）之间，您希望呈现什么具体画面或运动情绪？”
  - 避免模糊代劳，每一幕的运镜方向、核心视觉主体必须与用户达成共识。

### 2. 阶段二：音乐 PV 专属资源与情感分析
若当前任务属于歌曲 PV 制作：
1. **音频与歌词获取**:
   - **优先检查**: 歌曲文件同级目录中是否存在歌词文件（如 `.lrc`, `.txt`, `.srt`）。若存在，读取并解析时间轴。
   - **若无歌词**: 第一时间向用户询问是否能提供歌词文本或 LRC 时间轴。
   - **若用户也没有**: Agent 须主动通过网络搜索该歌曲的标准歌词与发行信息，整理后与用户核对。
2. **情感与音乐结构分析**:
   - 划分歌曲结构：前奏 (Intro) -> 主歌 (Verse) -> 导歌/爬升 (Pre-Chorus) -> 副歌高潮 (Drop/Chorus) -> 间奏 (Bridge) -> 尾声 (Outro)。
   - **情绪分析**:
     - 询问用户：“在 [XX 帧 - YY 帧] 这段旋律中，您想要传达什么情绪（如：宁静压抑、赛博科技感、迷茫探索、爆发燃点）？”
     - 若用户未明确描述，Agent 须结合歌词语义（词义象征）与旋律速度（BPM/重低音跌宕）自主推断对应情绪，并向用户确认。

### 3. 阶段三：素材准备与 SVG 矢量绘制
- **素材来源**:
  - 优先使用用户在 `assets/` 目录提供的视频、图片、3D 贴图等。
  - **动态绘制 SVG 矢量素材**: 当缺乏合适图形时，Agent 必须发挥图形设计能力，使用 Node/Python 或代码生成精美的现代化 SVG 文件（如：Transformer 架构图、赛博神经网络节点、发光齿轮、电路连线、全息 HUD 圆环、动态波形等），保存至素材目录并导入 AE。

---

## 二、 工作间目录规范 (Workspace Architecture)

所有 AE 工程必须建立且遵守统一规范的工程目录结构，禁止将零散素材随处存放：

```text
<Project_Root>/
├── assets/                 # 素材文件夹：所有外部图片、音频、字体、自绘SVG素材
│   ├── audio/              # 歌曲音频与 .lrc 歌词文件
│   ├── svg/                # 动态生成的矢量图表、HUD、几何图标
│   └── textures/           # 噪点图、辉光贴图、粒子背景
├── output/                 # 渲染文件夹：样板预览图、MP4预演视频、AME导出成品
│   ├── previews/           # 逐帧快照或轻量样板导出
│   └── final/              # AME / ProRes / H.264 最终成片
├── skills/                 # 本工作流 skill 文件夹
│   └── after-effects-workflow/
│       └── SKILL.md
└── <Project_Name>.aep      # After Effects 核心工程文件
```

---

## 三、 分级制作与性能防卡顿法则 (Performance & Iteration)

> [!CAUTION]
> **绝对准则**：AE 在堆叠大量模糊、Deep Glow、复杂粒子或全屏三维光影时会严重消耗显存，极易卡死或导致 AE 崩溃。因此**第一版必须是轻量样板（Prototype/Animatic）**！

### 1. 阶段 0：样板原型版 (Low-Overhead Prototype)
- **目标**: 校验节奏点（Marker/Beat）、关键歌词排版、镜头运动轨迹（Camera Move）、构图与转场连贯性。
- **制作禁忌**:
  - 严禁在样板阶段挂载重度第三方滤镜（如 RSMB、Sapphire Glow、Trapcode Particular 等）。
  - 严禁用多层叠加的高斯模糊做辉光。
  - 严禁开启高采样景深（Depth of Field）和 3D 光线追踪/Draft 3D 极限抗锯齿。
- **推荐做法**:
  - 纯色层（Solid）、文字层（Text Layer）与矢量 Shape 占位。
  - 调优摄像机运动曲线（Camera Ease / Null Rig），让位移和旋转极具冲击力。
  - 将阶段性镜头分别整理，使用 `precomposeLayers` 整理为独立子预合成，降低单层合成的计算压力。

### 2. 阶段 1：增量反馈与修复 (Feedback & Fixes)
- 样板完成后，通过 `exportPreviewVideo` 或导出关键帧向用户展示。
- **收集反馈**:
  - 用户说某个位置生硬 -> 调整速度曲线（`setKeyframeVelocity`）。
  - 用户说图层遮挡或顺序错乱 -> 调用 `reorderLayer`（`moveBefore`/`moveAfter`/`moveToBeginning`）修正。
  - 用户提出新想法 -> 局部添加，不破坏已有层级。

### 3. 阶段 2：终版细化与电影级美化 (Final Polish)
只有当用户明确表示**“可以了”/“骨架很满意”**之后，方可逐步增加重度视觉细节：
- 电影级光效：发光滤镜（Glow）、光芒扫光（CC Light Rays / Shine）、暗角（Vignette）。
- 连线与神经网络动画：用 Shape Layer + Trim Paths 做出逐渐发光延伸的线条。
- 动态噪点与色差：微量 Displacement Map 或 RGB Split 增强力量感。
- 文字动效：使用 `addTextAnimator` 注入字符级打字、3D 翻转、解码故障。
- 最终输出：使用 `exportWithAME` 提交至 Adobe Media Encoder 进行后台高质量硬件编码，不卡死 AE。

---

## 四、 视觉美学秘籍：怎样做出“电影级”、“很燃”的视觉？

### 1. 冲击力镜头运镜 (Dynamic Camera & Rig)
- **Null 控制器法则**: 严禁直接在 Camera 上做乱七八糟的位置关键帧。始终使用 `createCameraRig`，用绑定的 3D Null（Position, Orientation）带动相机。
- **惯性与冲刺 (Snap Movement)**:
  - 快慢节奏对比：转场瞬间采用 4-6 帧极速前推/旋转（Speed Ratio > 80%），到位后接缓慢漂移（Drift），形成“爆冲-悬停-微动”的电影感。
  - 连续运镜转场：上一幕镜头向 Z 轴深处穿透（Zoom-in），下一幕镜头顺着同向穿出，实现无缝空间转场。

### 2. 呼吸与层级感 (Visual Hierarchy & Layering)
- **前后景深度 (Z-Space Distribution)**:
  - 前景（Foreground）：微小虚焦粒子或穿梭的几何线条（Z = -200 ~ -500）。
  - 中景主体（Midground）：文字标题、核心 SVG 架构图、矢量图表（Z = 0）。
  - 背景（Background）：深色网格（Grid）、大暗调星轨或微噪点底图（Z = 800 ~ 2000）。
- **连线与辉光技巧**:
  - 想要“舒服的发光”，不要直接拉高单层 Glow 的 Threshold！
  - **双层光效法则**：
    1. 内核光（Core）：小半径（Radius: 5-10）、高强度（Intensity: 1.5-2.0），呈现白热核心。
    2. 外围辉光（Aura）：大半径（Radius: 80-150）、低强度（Intensity: 0.3-0.6），呈现柔和环境光晕。

### 3. 节奏打点与冲击波 (Audio Reactivity & Drops)
- **高潮（Drop）瞬间**:
  - 在重低音或鼓点敲击的那一帧，叠加 1-2 帧的瞬间反色（Difference Strobe）或极短白闪（Flash）。
  - 镜头瞬间 Scale 震荡或微震颤（Wiggle Expression）。
- **现代文字特效**:
  - 避免静态文字！运用 `addTextAnimator`：
    - 科技代码感使用 `glitch_decoder` 或 `typewriter`。
    - 燃向冲击感使用 `scale_pop_chars` 或 `3d_flip_chars`。

---

## 五、 AE MCP 核心工具调用指南

| 工具名称 | 最佳使用场景 | 关键参数建议 |
| :--- | :--- | :--- |
| `precomposeLayers` | 整理混乱时间轴；将特定分镜打包；保持 3D 折叠变换 | `compName`, `precompName`, `layerIndices` 或 `layerNames` |
| `reorderLayer` | 调整遮挡关系；把光效或调整层移到最上方；把底图置底 | `operation: 'moveToBeginning'/'moveToEnd'/'moveBefore'/'moveAfter'`, `targetLayerName` |
| `createCameraRig` | 创建专业两节点 3D 相机与 Null 控制器，防摄像机倾斜失控 | `compName`, `cameraName`, `enableDepthOfField: false` (样板期关) |
| `addTextAnimator` | 赋予字幕/歌词电影级字符动画（打字机、缩放弹出、3D翻转等） | `preset: 'fade_up_chars'/'scale_pop_chars'/'glitch_decoder'`, `startTime`, `endTime` |
| `setKeyframeVelocity` | 调整运镜与图形缓入缓出曲线，彻底告别“生硬感” | `influenceIn: 75`, `influenceOut: 75`（创造高冲力运动） |
| `exportPreviewVideo` | 样板阶段快速导出低分预览供用户检验节奏 | `format: 'mp4'`, `fps: 30`, `scale: 0.5` |
| `exportWithAME` | 终版成片渲染，把合成队列推入 Media Encoder 后台多线程编码 | `compName`, `outputPath: "output/final/pv_master.mp4"`, `renderImmediately: true` |

---

## 六、 常见问题自愈与容错机制 (Crash & Bug Handling)

1. **AE 崩溃或突然退出**:
   - MCP 底层已集成自动拉起与守护（Auto-Relaunch）。当心跳中断时，系统会自动杀死残留错误上报并重新启动 `AfterFX.exe`。
   - Agent 须耐心等待 AE 启动完毕重新建立连接，并在聊天中明确告知用户：“检测到 AE 崩溃，已为您自动重启并恢复连接，正在继续执行当前管线。”
2. **图层索引发生偏移**:
   - 随时通过 `getLayerInfo` 或 `getProjectInfo` 重新校对当前合成图层列表。
   - 在图层调整时，优先使用 `layerName` 进行安全定位，避免单纯依赖可能会变动的数字索引。
3. **保持工程洁净**:
   - 适时调用 `saveProject` 固化阶段性成果。
   - 镜头分块过多时，主动利用 `precomposeLayers` 建立 `Scene_01_Intro`、`Scene_02_Verse`、`Scene_03_Drop` 等子预合成。

# After Effects MCP (Model Context Protocol) Server

针对 Adobe After Effects 的 Model Context Protocol (MCP) 服务端，提供合成、图层、关键帧曲线、插件/特效、3D图层、媒体导入、帧导出、低清预览视频导出，以及自带自动保存与回滚机制。内置 After Effects ScriptUI 控制台面板，支持在软件内直接配置模型接口并对选中图层进行自动化修改。

---

## 核心功能

- **合成与图层管理**：创建合成、纯色层、文本层、摄像机、空对象，支持图层复制、删除与层级调整。
- **3D 图层与空间控制**：支持创建 3D 图层（纯色/文本/空对象/形状），精确控制三维位置、空间朝向（Orientation）、三轴旋转、缩放与锚点；支持创建各类 3D 灯光（点光源、聚光灯、平行光、环境光）并控制光强、锥角与阴影投射。
- **材质与 3D 渲染器**：获取与设置 3D 图层材质属性（阴影投射、透光率、环境光、漫反射、高光强度、高光光泽、金属度、粗糙度等）；支持切换合成 3D 渲染引擎（Classic 3D、Advanced 3D、Cinema 4D）。
- **素材与 3D 模型导入**：支持导入 3D 模型（.obj, .gltf, .glb）、矢量与 SVG（.svg, .ai，支持自动转为原生矢量形状图层）、图像（.png, .jpg, .psd, .exr）、音视频素材，并可直接作为图层加入目标合成。
- **属性与关键帧速度曲线**：修改变换属性、不透明度、混合模式、3D 开关与轨道遮罩；在任意时间设置关键帧，精确调节速度曲线（入点/出点速度与影响度 Influence），内置 dynamicSnap、extremeSnap、easyEase 等动效预设。
- **蒙版控制**：支持添加矩形、椭圆、多边形或自定义贝塞尔蒙版，支持羽化、不透明度、扩展与混合模式。
- **插件与特效系统**：查询已安装内置特效与第三方插件（Trapcode, Sapphire, Element 3D, Deep Glow, Red Giant 等）；支持添加特效、查询参数、批量修改参数、对特效参数打关键帧、禁用/旁路（Bypass）特效以及调整特效堆叠顺序。
- **帧截图与快速视频预览**：支持导出指定时刻的状态截图（PNG）并返回 Base64 编码；支持指定起止帧快速渲染低清预览视频（支持 Quarter/Half 分辨率与 Draft/Low 画质）。
- **自动保存与回滚保护**：默认执行操作前自动保存工程并在 `~/.ae-mcp/snapshots/` 生成独立 `.aep` 快照；支持一键撤销（Undo / Rollback），安全可靠。
- **软件内嵌控制面板**：在 AE 内部（Window > mcp-bridge-auto.jsx）提供多标签控制面板：
  - 图层助理：实时检测选中图层，输入修改说明即可自动生成并执行动效脚本，支持附带当前帧截图作为视觉输入；
  - 模型与接口设置：配置 OpenAI、Claude、Gemini、DeepSeek、Ollama 或自定义接口地址与密钥，支持一键获取模型列表，支持思考等级（Reasoning Effort: off/low/medium/high）设置与多模态开关；
  - 桥接与系统日志：管理自动化指令执行、手动执行、撤销以及实时运行日志。

---

## 安装与配置

### 1. 安装依赖与构建

```bash
cd D:/cppp/after-effects-mcp
npm install
npm run build
```

### 2. 安装 AE 桥接面板

运行内置安装脚本，会自动检测本机 After Effects 安装路径并将控制台脚本复制至 `ScriptUI Panels` 目录：

```bash
npm run install-bridge
```

脚本将安装至：
`Adobe After Effects/Support Files/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx`

### 3. After Effects 设置

1. 打开 Adobe After Effects。
2. 菜单栏进入 **编辑 > 首选项 > 脚本和表达式**（Edit > Preferences > Scripting & Expressions）。
3. 勾选 **允许脚本写入文件和访问网络**（Allow Scripts to Write Files and Access Network）。
4. 菜单栏打开 **窗口 > mcp-bridge-auto.jsx**。
5. 保持面板处于开启状态。

---

## 客户端配置示例

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "after-effects": {
      "command": "node",
      "args": [
        "D:\\cppp\\after-effects-mcp\\dist\\index.js"
      ]
    }
  }
}
```

### Cursor / Antigravity / cline

在 MCP 设置中添加：
- **Command**: `node`
- **Args**: `D:/cppp/after-effects-mcp/dist/index.js`

---

## 工具清单

| 工具名称 | 功能说明 | 核心参数 |
| :--- | :--- | :--- |
| `create-composition` | 创建新合成 | `name`, `width`, `height`, `duration`, `frameRate`, `bgColor` |
| `run-script` | 在 AE 内部执行原生 ExtendScript JS 脚本 | `script`, `description` |
| `get-results` | 获取最近或指定指令的执行结果 | `commandId` (可选) |
| `get-help` | 获取可用指令与属性使用帮助 | `topic` ('overview', 'tools', 'properties', 'effects', 'bridge') |
| `setLayerKeyframe` | 在指定图层属性上添加关键帧 | `compName`, `layerName`/`layerIndex`, `propertyName`, `time`, `value`, `keyframeInterpolation` |
| `setKeyframeVelocity` | 调节关键帧速度曲线（入点/出点速度与影响度 Influence、图表编辑器贝塞尔曲线、预设 "dynamicSnap" 等） | `compName`, `layerName`/`layerIndex`, `propertyName`, `keyIndex`/`time`, `inSpeed`, `inInfluence`, `outSpeed`, `outInfluence`, `preset` |
| `getKeyframeInfo` | 获取某属性上所有关键帧详情（时间、取值、插值类型、速度与影响度） | `compName`, `layerName`/`layerIndex`, `propertyName` |
| `setLayerExpression` | 添加、修改或移除属性表达式 | `compName`, `layerName`/`layerIndex`, `propertyName`, `expression`, `enabled` |
| `setLayerProperties` | 设置图层常规与变换属性 | `position`, `scale`, `rotation`, `opacity`, `blendMode`, `threeDLayer`, `trackMatteType`, `enabled` 等 |
| `batchSetLayerProperties` | 批量更新多个图层属性 | `compName`, `updates` |
| `getLayerInfo` | 获取图层属性、3D 状态、特效与蒙版信息 | `compName`, `layerName`/`layerIndex` |
| `create3DLayer` | 直接创建 3D 图层（纯色、文本、空对象、形状）并预设 3D 变换 | `compName`, `layerType`, `name`, `text`, `color`, `position`, `orientation`, `rotationX/Y/Z`, `scale` |
| `set3DLayerTransform` | 精确调节 3D 图层坐标变换与旋转轴 | `compName`, `layerName`/`layerIndex`, `position`, `orientation`, `rotationX/Y/Z`, `scale`, `anchorPoint` |
| `createCamera` | 创建 1 节点或 2 节点 3D 摄像机图层（支持 15mm-200mm 焦段预设、景深开关、对焦距离、光圈虚化、叶片形状 Bokeh，并可选自动绑定 3D 控制器） | `compName`, `name`, `cameraType`, `preset`, `focalLength`, `zoom`, `position`, `pointOfInterest`, `orientation`, `rotationX/Y/Z`, `depthOfField`, `focusDistance`, `aperture`, `blurLevel`, `irisShape`, `createRig`, `rigName` |
| `setCameraProperties` | 修改 3D 摄像机的所有参数与属性（位移、目标点、3D 旋转、焦距、景深、光圈虚化程度、光圈叶片散景，或设置永久锁定目标图层自动对焦） | `compName`, `cameraName`/`cameraIndex`, `cameraType`, `position`, `pointOfInterest`, `orientation`, `rotationX/Y/Z`, `zoom`, `depthOfField`, `focusDistance`, `aperture`, `blurLevel`, `irisShape`, `irisRotation`, `irisRoundness`, `irisAspectRatio`, `lockFocusToLayer` |
| `applyCameraMove` | 一键执行专业电影级 3D 摄像机运镜（环绕 orbit、推镜头 dolly_in、拉镜头 dolly_out、横移 truck、升降 pedestal/boom、摇镜 pan、甩镜头 whip_pan、希区柯克眩晕变焦 dolly_zoom、穿梭飞掠 fly_through、螺旋推进 spiral、真实手持呼吸感微晃 handheld_shake） | `compName`, `cameraName`/`cameraIndex`, `moveType`, `targetLayerName`/`targetLayerIndex`, `startTime`, `duration`, `distance`, `angle`, `direction`, `easing`, `handheldIntensity` |
| `createCameraRig` | 创建工业级标准 3D 摄像机绑定系统（Target 目标 Null + Orbit 环绕控制器 Null + 摄像机，杜绝万向节死锁，便于自由运镜） | `compName`, `cameraName`, `rigName`, `targetPosition`, `distance` |
| `trackCameraToLayer` | 绑定摄像机实时追踪目标图层（`look_at` 视角锁定注视、`follow_position` 保持间距跟随位移、`focus_distance` 景深自动对焦锁定） | `compName`, `cameraName`/`cameraIndex`, `targetLayerName`/`targetLayerIndex`, `trackMode` |
| `createLight` | 创建 3D 灯光（点光 Point、聚光 Spot、平行光 Parallel、环境光 Ambient）及阴影控制 | `compName`, `name`, `lightType`, `intensity`, `color`, `coneAngle`, `coneFeather`, `castsShadows`, `position` |
| `createNullObject` | 创建空对象（Null Object） | `compName`, `name`, `duration` |
| `duplicateLayer` | 复制图层 | `compName`, `layerName`/`layerIndex` |
| `deleteLayer` | 删除图层 | `compName`, `layerName`/`layerIndex` |
| `addLayerMask` | 快捷添加图层蒙版（矩形、椭圆、多边形或自定义贝塞尔），支持羽化/不透明度/模式 | `compName`, `layerName`/`layerIndex`, `shapeType`, `bounds`, `vertices`, `maskMode`, `feather`, `opacity` |
| `setLayerMask` | 修改现有图层蒙版 | `compName`, `layerName`, `maskShape`, `maskMode`, `maskFeather`, `maskOpacity`, `inverted` |
| `getLayerMaterialOptions` | 获取 3D 图层材质选项（阴影投射、环境光、漫反射、高光、金属度、粗糙度等） | `compName`, `layerName`/`layerIndex` |
| `setLayerMaterialOptions` | 设置 3D 图层材质属性与光照响应 | `compName`, `layerName`/`layerIndex`, `castsShadows`, `acceptsLights`, `ambient`, `diffuse`, `specular`, `metal` 等 |
| `getCompRenderer` | 获取合成当前的 3D 渲染器及可用渲染器列表 | `compName` (可选) |
| `setCompRenderer` | 切换合成 3D 渲染器（"ADBE Advanced 3D"、"ADBE Cinema 4D"、"ADBE Classic 3D"） | `compName`, `renderer` |
| `importAsset` | 导入 3D 模型、图片、SVG/矢量、音视频，并可选自动加入合成或转形状图层 | `filePath`, `compName`, `sequence`, `convertToShape`, `isThreeD`, `position`, `scale` |
| `exportFrame` | 导出合成当前时刻或指定时间状态图片（PNG），并返回 Base64 预览 | `compName`, `time`/`frame`, `outputPath`, `returnBase64` |
| `exportPreviewVideo` | 快速导出指定起止帧的低清预览视频（支持 Quarter/Half 分辨率、Draft/Low 画质） | `compName`, `startFrame`, `endFrame`, `startTime`, `endTime`, `quality`, `resolution`, `outputPath` |
| `getInstalledPlugins` | 查询 AE 已安装特效/插件及 matchName | `category`, `search` |
| `applyEffect` | 为指定图层应用插件/特效 | `compName`, `layerName`, `effectName`, `properties` |
| `setEffectProperties` | 设置特效插件参数 | `compName`, `layerName`, `effectName`, `properties` |
| `setEffectPropertyKeyframe` | 对图层上的特效参数添加关键帧并指定缓动 | `compName`, `layerName`/`layerIndex`, `effectName`/`effectIndex`, `propertyName`, `time`, `value`, `keyframeInterpolation` |
| `getEffectProperties` | 查询某图层上特效的所有参数与当前值 | `compName`, `layerName`, `effectName` |
| `setEffectEnabled` | 启用或禁用（Bypass）图层上的指定特效 | `compName`, `layerName`/`layerIndex`, `effectName`/`effectIndex`, `enabled` |
| `reorderEffect` | 调整特效在图层特效栈中的上下顺序 | `compName`, `layerName`/`layerIndex`, `effectName`/`effectIndex`, `newIndex` |
| `removeEffect` | 从图层上移除特效 | `compName`, `layerName`, `effectName` |
| `createTextLayer` | 创建 2D 或 3D 文本图层（全面支持字号、PostScript 字体、填色/描边、字距 Tracking、行距 Leading、对齐、全部大写/小型大写、3D 空间朝向与旋转、直接挂载特效插件） | `compName`, `text`, `name`, `isThreeD`, `fontSize`, `font`, `fillColor`, `applyFill`, `strokeColor`, `strokeWidth`, `applyStroke`, `strokeOverFill`, `tracking`, `leading`, `justification`, `allCaps`, `smallCaps`, `position`, `orientation`, `rotationX`, `rotationY`, `rotationZ`, `effects` |
| `formatTextLayer` | 格式化已有文本图层的排版与文字属性（内容、字体、字号、填色、描边、字距、行距、对齐、大小写） | `compName`, `layerName`/`layerIndex`, `text`, `fontSize`, `font`, `fillColor`, `applyFill`, `strokeColor`, `strokeWidth`, `applyStroke`, `strokeOverFill`, `tracking`, `leading`, `justification`, `allCaps`, `smallCaps` |
| `getAvailableFonts` | 查询当前 AE 环境已加载的 PostScript 字体列表（名称、字族与字重样式） | 无 |
| `addTextAnimator` | 为文本图层添加文字动画器（支持打字机 typewriter、逐字淡入 fade_up_chars、逐字滑入 slide_in_chars、逐字弹跳缩放 scale_pop_chars、字距展开 tracking_expand、逐字 3D 翻转 3d_flip_chars、摆动波浪 wiggle_wave、矩阵解码 glitch_decoder，以及自定义 Range Selector 范围选择器、Wiggly Selector 摆动选择器） | `compName`, `layerName`/`layerIndex`, `animatorName`, `preset`, `startTime`, `duration`, `properties` (位移、缩放、旋转、3D旋转、不透明度、字距、模糊、颜色、倾斜、字符偏移等), `rangeSelector`, `wigglySelector` |
| `createSolidLayer` | 创建纯色背景图层 | `compName`, `name`, `color`, `width`, `height`, `duration` |
| `getProjectInfo` | 获取工程总览、文件路径、合成列表 | 无 |
| `saveProject` | 保存工程文件或另存为备份 | `saveAsPath` (可选) |
| `rollback` | 撤销回滚上一次操作 | 无 |
| `getHistory` | 查询操作历史记录与快照状态 | `limit` (默认 20 条) |
| `configureSettings` | 动态修改自动保存与历史配置 | `autoSave`, `autoRecordHistory`, `saveMode`, `maxHistory`, `timeoutMs` |
| `getSettings` | 查询当前 MCP 配置和 AE 连接健康状态 | 无 |
| `aiModifySelectedLayer` | 当操作不理想时用户输入自然语言提示词让模型针对性修改选中图层（结合当前帧截图、关键帧、特效、表达式） | `prompt`, `compName`, `layerName`/`layerIndex`, `attachScreenshot` |
| `installBridge` | 自动检测 AE 并安装桥接脚本至面板目录 | `targetDir` (可选) |

---

## 自动保存与回滚机制

1. **自动保存**：
   - 每次调用修改图层、添加关键帧或应用特效等工具时，系统默认自动保存当前工程，并在 `~/.ae-mcp/snapshots/` 下创建带时间戳的 `.aep` 备份快照。
   - 所有操作均记录在 `~/.ae-mcp/history.json` 中。
2. **回滚操作 (`rollback`)**：
   - 调用 `rollback` 工具即可直接触发 AE 原生撤销（Undo Group），将工程精确还原到上一步状态，并在历史记录中标记该步骤已回滚。可在面板中直接点击“撤销修改”。
3. **设置项 (`configureSettings`)**：
   - `autoSave`: 是否在每次操作后自动保存。
   - `saveMode`: 可选 `'project'`（保存当前工程）、`'snapshot'`（仅留存快照副本）、`'both'`（两者均执行）。
   - `maxHistory`: 保留的历史记录与快照数量上限（默认 50 条）。

---

## 提示词示例

- "在 After Effects 中创建一个 1920x1080 30fps、持续 10 秒的合成，名称为 'MainComp'。"
- "在 MainComp 中添加一个黑色背景纯色层和一个文字为 'Title' 的居中文本层。"
- "创建一个 3D 文本图层 'FUTURE CREATIVE'，字体为 'Arial-BoldMT'，字号 96，白色填充加金色描边，字距 120，并在创建时直接添加 Glow 发光特效。"
- "为文本图层添加 3D 字符翻转入场动画（addTextAnimator 配合 3d_flip_chars），从第 0 秒持续 2 秒。"
- "为文字添加打字机效果（typewriter），从第 0 秒到第 3 秒逐字打出。"
- "为文字添加摆动波浪动画（wiggle_wave），让每个文字带有自然的字符浮动。"
- "创建一个 50mm 电影级 3D 摄像机（createCamera），开启景深，光圈设为 80，自动创建 3D 摄像机绑定控制器。"
- "让摄像机围绕当前 3D 标题文字进行 180 度环绕运镜（applyCameraMove 配合 orbit），持续 3 秒，使用 cinematic 电影级缓动曲线。"
- "执行经典的希区柯克眩晕变焦（applyCameraMove 配合 dolly_zoom），镜头向前推进同时反向缩小焦距，保持主体大小不变背景空间产生畸变冲击。"
- "为摄像机添加真实自然的手持呼吸感微晃（applyCameraMove 配合 handheld_shake），强度设为 subtle。"
- "将摄像机对焦点永久锁定在目标模型图层上（trackCameraToLayer 配合 focus_distance），无论摄像机怎么移动主体都保持极清对焦。"
- "给文本层的 Position 属性打关键帧：在第 0 秒从上方落入，并在第 1 秒停止，速度曲线设为 'dynamicSnap'。"
- "导入 D:/assets/logo.svg 到合成中，并将其转为 AE 原生矢量形状图层。"
- "导入 D:/models/robot.glb 3D 模型，将合成切换为 Advanced 3D 渲染器，并放置在 [960, 540, 200]。"
- "创建一个 3D 聚光灯（Spot Light），强度设为 120%，开启阴影投射照射在 3D 模型上。"
- "获取模型图层的材质属性，将金属度设为 80%，高光强度设为 90%，开启阴影接受。"
- "为当前图层添加一个椭圆蒙版（addLayerMask），并设置 40 像素羽化。"
- "导出当前合成第 1.5 秒的截图图片（exportFrame）。"
- "快速导出第 0 帧到第 45 帧的低清预览视频（exportPreviewVideo），分辨率设为 Quarter。"
- "为文本层上的 Gaussian Blur 特效的 Blurriness 参数打关键帧：在第 0 秒为 30，第 1 秒为 0。"
- "撤销上一步操作（rollback）。"

# After Effects MCP (Model Context Protocol) Server

[![Release](https://img.shields.io/github/v/release/tzdwindows/after-effects-mcp?color=blue)](https://github.com/tzdwindows/after-effects-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

> [!NOTE]
> **Languages / 语言版本**:
> - [中文说明 (Chinese Guide)](#中文安装与使用教程)
> - [English Guide](#english-installation-and-usage-guide)

---

# 中文安装与使用教程

针对 Adobe After Effects（2025 / 2026 / CC）的专业级 Model Context Protocol (MCP) 服务端。提供合成管理、图层变换、空间速度缓动曲线、插件与特效系统、3D图层/灯光/材质、专业电影级摄像机运镜、素材导入、帧截图导出、低清预览视频导出，以及自带自动保存与一键回滚机制。

配备专用的 ExtendScript ScriptUI 后台面板，无需人工点击任何按钮，实现 **100% 全自动指令监听与毫秒级执行**。

---

## 快速安装步骤

### 步骤 1：下载并安装 AE 桥接脚本

可以选择 **自动安装** 或 **手动安装**：

#### 方法 A：自动安装（推荐）
如果您克隆了源码，在终端运行内置安装脚本即可自动查找本机 AE 并复制脚本：
```bash
git clone https://github.com/tzdwindows/after-effects-mcp.git
cd after-effects-mcp
npm install
npm run build
npm run install-bridge
```

#### 方法 B：手动下载与安装（从 Release 下载）
1. 前往 [Releases 页面](https://github.com/tzdwindows/after-effects-mcp/releases/latest) 下载 `mcp-bridge-panel-v1.0.0.zip`。
2. 解压得到 `mcp-bridge-auto.jsx` 文件。
3. 将该文件复制到您的 After Effects 安装目录下的 `ScriptUI Panels` 文件夹中：
   - **Windows 默认路径**：
     `C:\Program Files\Adobe\Adobe After Effects <版本>\Support Files\Scripts\ScriptUI Panels\`
     *(例如：`D:\AE2026\Adobe After Effects 2025\Support Files\Scripts\ScriptUI Panels\`)*
   - **macOS 默认路径**：
     `/Applications/Adobe After Effects <版本>/Scripts/ScriptUI Panels/`

---

### 步骤 2：配置 After Effects 脚本权限

1. 打开 **Adobe After Effects**。
2. 进入首选项设置：
   - **Windows**：菜单栏点击 **编辑 (Edit) -> 首选项 (Preferences) -> 脚本和表达式 (Scripting & Expressions)**。
   - **macOS**：菜单栏点击 **After Effects -> 首选项 (Preferences) -> 脚本和表达式 (Scripting & Expressions)**。
3. 勾选 **“允许脚本写入文件和访问网络” (Allow Scripts to Write Files and Access Network)**。
4. 点击“确定”保存设置。

---

### 步骤 3：在 AE 中启动桥接面板

1. 在 After Effects 顶部菜单栏点击 **窗口 (Window)**。
2. 在下拉菜单底部找到并点击 **`mcp-bridge-auto.jsx`**。
3. 面板打开后，您可将其停靠在工作区任意位置（如合成窗口旁或控制面板组中）。
4. 面板会自动建立心跳并开始监听，**保持面板开启即可，全程无需任何手动操作**。

---

### 步骤 4：在 MCP 客户端中配置

根据您使用的 AI 客户端添加以下配置：

#### 1. Claude Desktop
编辑配置文件（Windows: `%APPDATA%\Claude\claude_desktop_config.json`，macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`）：
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

#### 2. Antigravity / Cursor / Cline
在客户端的 MCP 配置文件中添加：
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

## 常用功能与工具示例

| 工具名称 | 功能描述 |
| :--- | :--- |
| `create-composition` | 创建指定宽高、帧率、时长的合成 |
| `renameComposition` | 重命名指定或当前活动的合成 |
| `setCompositionProperties` | 动态修改合成分辨率、时长、帧率、背景色 |
| `createTextLayer` | 创建 2D/3D 文本图层（字号、字距、字体、填色/描边、居中对齐、直接附加发光等特效） |
| `addTextAnimator` | 添加逐字打字机、3D字符翻转、弹跳缩放、波浪抖动等全套文字动画器 |
| `createCamera` / `applyCameraMove` | 创建电影级 3D 摄像机并执行环绕 (Orbit)、推拉 (Dolly)、横移 (Truck)、手持微晃 (Handheld) 等运镜 |
| `setKeyframeVelocity` | 精确调节速度曲线影响度 (Influence) 与速度 (Speed)，内置 `dynamicSnap`、`extremeSnap` 等强缓动预设 |
| `applyEffect` / `setEffectProperties` | 添加与修改内置或第三方插件（Glow、Trapcode、Sapphire、Element 3D 等） |
| `exportFrame` | 截取合成指定时刻的完整画面并生成 PNG 截图快照 |
| `exportPreviewVideo` | 快速导出指定帧区间的低清预览视频 |
| `rollback` | 撤销上一步操作并安全恢复工程 |

---
---

# English Installation and Usage Guide

A production-ready Model Context Protocol (MCP) server for Adobe After Effects (2025 / 2026 / CC). Enables direct AI control over compositions, layer hierarchies, spatial Bézier speed curves, 3D lights, material shaders, cinematic camera rigs, text animators, asset imports, frame snapshots, and preview video rendering with automatic project backup and rollbacks.

Includes a dedicated ExtendScript ScriptUI panel providing **100% automated background execution with sub-second response times and zero manual button clicking**.

---

## Quick Installation

### Step 1: Install AE Bridge Panel Script

Choose either **Automatic** or **Manual** installation:

#### Option A: Automatic Installation (Recommended)
If you have cloned the repository, run the built-in installer:
```bash
git clone https://github.com/tzdwindows/after-effects-mcp.git
cd after-effects-mcp
npm install
npm run build
npm run install-bridge
```

#### Option B: Manual Installation (From GitHub Release)
1. Go to the [Releases page](https://github.com/tzdwindows/after-effects-mcp/releases/latest) and download `mcp-bridge-panel-v1.0.0.zip`.
2. Extract `mcp-bridge-auto.jsx`.
3. Copy `mcp-bridge-auto.jsx` into your After Effects `ScriptUI Panels` folder:
   - **Windows**:
     `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
   - **macOS**:
     `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`

---

### Step 2: Configure Scripting Permissions in After Effects

1. Open **Adobe After Effects**.
2. Open Preferences:
   - **Windows**: **Edit -> Preferences -> Scripting & Expressions**
   - **macOS**: **After Effects -> Preferences -> Scripting & Expressions**
3. Ensure **"Allow Scripts to Write Files and Access Network"** is checked.
4. Click **OK**.

---

### Step 3: Launch the Bridge Panel in After Effects

1. In After Effects, navigate to the top menu: **Window**.
2. Select **`mcp-bridge-auto.jsx`** near the bottom of the menu.
3. Dock the panel anywhere in your workspace.
4. Keep the panel open. The panel listens for commands continuously in the background—**no manual clicking is required**.

---

### Step 4: Configure MCP Client

Add the server to your MCP client configuration:

#### 1. Claude Desktop
Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
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

#### 2. Antigravity / Cursor / Cline
Add to your client's MCP configuration:
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

## Example Prompts

- *"Create a 1920x1080 30fps 5-second composition named 'IntroScene'."*
- *"Rename the current composition to 'Final_Render'."*
- *"Add a 3D text layer 'ANTIGRAVITY MCP' with gold fill, 90px size, center justified, and apply Glow effect."*
- *"Create a 50mm cinema camera and animate a 180-degree orbit movement around the text over 3 seconds with cinematic easing."*
- *"Apply a typewriter text animation starting at 0.5s."*
- *"Export a preview PNG snapshot of the composition at 1.0s."*
- *"Undo the last action."*

---

## License

MIT License. See [LICENSE](LICENSE) for details.

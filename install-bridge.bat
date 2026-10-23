@echo off
chcp 65001 >nul
echo ============================================================================
echo   After Effects MCP Bridge v1.1.0 - 一键安装与主菜单备份清理程序
echo   (Audio Beat Sync + MMS-CTC Lyric Alignment + DOVER-Mobile Video Scorer)
echo ============================================================================
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo [1/3] 正在安装 Node.js 运行时依赖 ^(onnxruntime-node 等^)...
    call npm.cmd install
) else (
    echo [1/3] 检测到 node_modules 已存在，跳过依赖下载。
)

if not exist "dist\index.js" (
    echo [2/3] 正在编译 TypeScript 源码并复制桥接脚本...
    call npm.cmd run build
) else (
    echo [2/3] 检测到 dist\index.js 已就绪。
)

echo [3/3] 正在安装 AE 面板脚本并清理主菜单残留备份...
node dist\scripts\installer.js

echo.
echo ============================================================================
echo   安装完成！MCP Server 入口路径:
echo   %~dp0dist\index.js
echo   详细配置说明请查看: %~dp0INSTALL_GUIDE.md
echo ============================================================================
pause

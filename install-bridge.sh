#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================================================"
echo "  After Effects MCP Bridge v1.1.0 - One-Click Installer & Menu Cleaner"
echo "============================================================================"

if [ ! -d "node_modules" ]; then
  echo "[1/3] Installing Node.js dependencies..."
  npm install
else
  echo "[1/3] node_modules already present."
fi

if [ ! -f "dist/index.js" ]; then
  echo "[2/3] Building project..."
  npm run build
else
  echo "[2/3] dist/index.js ready."
fi

echo "[3/3] Installing AE ScriptUI Panel and cleaning menu backups..."
node dist/scripts/installer.js

echo ""
echo "Done! MCP Server entry point: $(pwd)/dist/index.js"
echo "See INSTALL_GUIDE.md for detailed instructions."

#!/bin/bash
# ═════════════════════════════════════════════════════════
# Cài đặt git hooks cho Work Log Tracker
#
# Script này sẽ copy các git hooks vào .git/hooks/ của
# repository hiện tại.
#
# Cách dùng:
#   cd /path/to/your/project
#   bash /path/to/tool-auto-logwork/hooks/setup.sh
#
#   Hoặc cài đặt global:
#   bash /path/to/tool-auto-logwork/hooks/setup.sh --global
# ═════════════════════════════════════════════════════════

set -e

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-local}"

echo "═══════════════════════════════════════════"
echo "  Work Log Tracker — Git Hooks Installer"
echo "═══════════════════════════════════════════"

if [ "$MODE" = "--global" ]; then
    TARGET_DIR="$HOME/.git-hooks"
    mkdir -p "$TARGET_DIR"
    git config --global core.hooksPath "$TARGET_DIR"
    echo "  → Global hooks directory: $TARGET_DIR"
else
    # Tìm .git directory
    GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || true)
    if [ -z "$GIT_DIR" ]; then
        echo "  ✗ Error: Not a git repository. Run from a git repo or use --global."
        exit 1
    fi
    TARGET_DIR="$GIT_DIR/hooks"
    echo "  → Repository hooks directory: $TARGET_DIR"
fi

# Copy post-commit hook
cp "$HOOKS_DIR/post-commit" "$TARGET_DIR/post-commit"
chmod +x "$TARGET_DIR/post-commit"

echo "  ✓ Installed: $TARGET_DIR/post-commit"
echo ""
echo "  Kể từ bây giờ, mỗi lần bạn commit, thông tin sẽ"
echo "  được ghi vào ~/.worklog_git_hooks.jsonl"
echo "  và Work Log Tracker sẽ tự động import."
echo ""
echo "  Để huỷ hook, xoá file:"
echo "    rm $TARGET_DIR/post-commit"
echo "═══════════════════════════════════════════"

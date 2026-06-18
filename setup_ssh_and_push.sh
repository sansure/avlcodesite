#!/bin/bash
# 一键配置 SSH 并推送 hello-avlcode-worker 到 GitHub
# 使用方法：bash setup_ssh_and_push.sh

set -e

REPO_DIR="/workspace/hxswork/edrAiFunction/hello-avlcode-worker"
SSH_KEY_PATH="$HOME/.ssh/id_ed25519"
SSH_PUB_PATH="$HOME/.ssh/id_ed25519.pub"

echo "========================================"
echo "  Hello AVL Code Worker - SSH 推送脚本"
echo "========================================"
echo ""

# 1. 确保 SSH 目录存在
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# 2. 生成 SSH key（如果不存在）
if [ ! -f "$SSH_PUB_PATH" ]; then
    echo "📝 未检测到 SSH key，正在生成 Ed25519 key..."
    ssh-keygen -t ed25519 -C "gitEdr@example.com" -f "$SSH_KEY_PATH" -N ""
    echo "✅ SSH key 生成完成"
else
    echo "✅ 已存在 SSH key: $SSH_PUB_PATH"
fi

# 3. 启动 ssh-agent 并添加 key
echo ""
echo "🔑 配置 SSH agent..."
eval "$(ssh-agent -s)"
ssh-add "$SSH_KEY_PATH" 2>/dev/null || true
echo "✅ SSH agent 已配置"

# 4. 显示公钥
echo ""
echo "========================================"
echo "  请将以下公钥添加到 GitHub"
echo "========================================"
cat "$SSH_PUB_PATH"
echo ""
echo "========================================"
echo "添加步骤："
echo "1. 登录 https://github.com/settings/keys"
echo "2. 点击 New SSH key"
echo "3. Title 填写: hello-avlcode-worker"
echo "4. Key 粘贴上面的内容"
echo "5. 点击 Add SSH key"
echo "========================================"
echo ""

# 5. 等待用户确认
read -p "请确认已添加公钥到 GitHub，然后按回车继续..."

# 6. 测试 SSH 连接
echo ""
echo "🔗 测试 GitHub SSH 连接..."
ssh -T git@github.com -o StrictHostKeyChecking=no || true
echo ""

# 7. 修改 git remote 为 SSH
echo "📦 配置 Git 远程仓库..."
cd "$REPO_DIR"
git remote set-url origin git@github.com:sansure/avlcodesite.git
echo "✅ 远程地址已修改为 SSH 格式"
git remote -v

# 8. 推送代码
echo ""
echo "🚀 开始推送代码到 GitHub..."
git push origin main

echo ""
echo "========================================"
echo "  ✅ 推送完成！"
echo "========================================"
echo ""
echo "接下来："
echo "1. 访问 Cloudflare Dashboard → Workers & Pages"
echo "2. 创建 Worker 并连接 GitHub 仓库"
echo "3. 选择 sansure/avlcodesite，自动部署"
echo ""

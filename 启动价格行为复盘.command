#!/bin/zsh

cd "$(dirname "$0")"

echo "正在启动价格行为复盘训练工具..."
echo "项目目录: $(pwd)"
echo ""

if [ ! -d "node_modules" ]; then
  echo "首次运行，正在安装依赖..."
  npm install
  if [ $? -ne 0 ]; then
    echo ""
    echo "依赖安装失败，请检查 Node.js / npm 是否可用。"
    read -k 1 "?按任意键关闭..."
    exit 1
  fi
fi

PORT=5173
URL="http://127.0.0.1:${PORT}/"

echo "服务地址: ${URL}"
echo "如果提示端口被占用，请先关闭之前打开的复盘窗口或终端。"
echo ""

npm run dev -- --host 127.0.0.1 --port "${PORT}" --strictPort &
SERVER_PID=$!

cleanup() {
  if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1
  fi
}
trap cleanup INT TERM EXIT

for i in {1..30}; do
  if curl -s "${URL}" >/dev/null 2>&1; then
    open "${URL}" >/dev/null 2>&1
    wait "${SERVER_PID}"
    exit $?
  fi
  sleep 1
done

echo "启动超时，请检查上面的错误信息。"
wait "${SERVER_PID}"

echo ""
read -k 1 "?服务已停止，按任意键关闭..."

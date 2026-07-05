# 价格行为 K 线复盘与 AI 交易点评工具

一个面向价格行为交易学习者的本地复盘工作台。项目以 K 线回放、模拟交易和历史订单归档为基础，重点接入 AI 点评能力，帮助用户从市场周期、多空力量、价格行为结构和 Al Brooks 风格规则角度复盘单笔交易。

本项目基于 Vue 3、Vite、Electron 和 `@mg-exchange/charts` 构建，可作为 Web 应用运行，也可以打包为桌面应用。

## 功能特性

### K 线回放

- 支持 BTCUSDT 最新 K 线数据加载。
- 支持 `1m`、`5m`、`15m`、`30m`、`1H`、`4H`、`1D` 等周期。
- 支持 CSV 导入历史 K 线。
- 按 `Space` 或点击按钮推进下一根 K 线。
- 支持上一根、重置、自动播放。
- EMA20 只基于已回放 K 线实时计算，不提前显示未来数据。
- 支持 K 线编号，日内周期按北京时间早上 8 点重新计数，可设置显示间隔。
- 鼠标滚轮横向缩放 K 线，缩放幅度较细，接近 TradingView 手感。
- 鼠标左键拖动图表可上下左右平移：左右移动时间轴，上下移动价格轴。
- 切换周期时按当前 K 线时间锚定，尽量保持切换前价格在图表中心。

### 画线与图表工具

- 支持趋势线、水平线、射线、平行通道、矩形、箭头、文字等画线工具。
- 支持 TradingView 风格多头/空头风险收益位置工具。
- 支持磁吸 OHLC。
- 画线或选中画线时会暂停图表缩放与拖动，避免误操作。
- 可用 Delete 或 Backspace 删除选中画线。
- 图表右键菜单支持复制当前价格。

### 模拟交易

- 支持市价做多、做空。
- 支持限价单、止损单、突破单。
- 支持委托线拖动修改价格。
- 支持撤销单笔委托或全部委托。
- 支持开仓后手动设置止盈、止损，并在图表上显示对应线条。
- 支持自定义初始资金、下单数量或下单金额。
- 默认初始资金为 `1000 USDT`，可一键重置。

### 交易执行与历史复盘分离

- 右侧只保留两个主要模块：`交易` 和 `报告`。
- `交易` 页面聚焦当前模拟下单、持仓、委托和当前单临时点评。
- `报告` 页面展示绩效统计和历史订单复盘档案。
- 历史订单可筛选多空、盈亏、疑问单、已点评和错误标签。
- 已完成订单在图表对应 K 线位置显示标记：
  - 做多为向上箭头。
  - 做空为向下箭头。
  - 盈利为绿色。
  - 亏损为红色。
- 点击历史订单或图表订单标记，会定位到对应订单，但不会提前显示尚未复盘的未来 K 线。

### AI 交易点评

- 支持 DeepSeek、OpenAI 或自定义 OpenAI 兼容代理接口。
- AI 点评基于选中订单、账户信息、相关 K 线窗口、交易备注和本地规则卡生成。
- 点评结构包含：
  - 开盘背景
  - 市场周期转换
  - 逐 K 分析
  - 本次交易 Setup
  - 操作建议
  - 常见错误
  - 总结
  - 评分和错误标签
- 已点评订单默认查看旧结果，只有点击重新点评才覆盖。
- 支持对同一笔订单继续追问，追问记录会保存到该订单档案中。
- 支持浏览器语音输入，用于交易备注和追问。

### 本地知识库

- 内置价格行为规则卡。
- 支持私有规则卡目录：

```text
knowledge_private/rule-cards/
```

- 私有规则卡不会提交到 Git。
- 规则卡格式示例见 `docs/RULE_CARD_JSON_EXAMPLE.json`。
- 可运行知识库校验，检查 JSON 合法性、重复 ID 和必填字段。

### 会话保存、导入与恢复

- 训练会话会自动保存到浏览器或桌面应用的 `localStorage`。
- 切换周期或刷新 BTC 数据时，会保留历史订单、AI 点评、追问和疑问标记。
- 支持导出复盘 JSON。
- 支持导入复盘 JSON。
- 提供 Electron 本地会话恢复脚本：

```bash
npm run build
node scripts/recover-electron-session.cjs
```

恢复出的 `recovered-pa-session*.json` 已加入 `.gitignore`，不会上传。

## 运行方式

安装依赖：

```bash
npm install
```

启动 Web 开发环境：

```bash
npm run dev
```

默认打开：

```text
http://localhost:5173
```

启动桌面应用：

```bash
npm run desktop
```

打包 macOS 应用：

```bash
npm run package:mac
```

打包产物输出到 `release/`，该目录已被 Git 忽略。

## CSV 数据格式

最小示例：

```csv
time,open,high,low,close,volume
2026-01-01 09:30:00,100,102,99,101,1200
2026-01-01 09:35:00,101,103,100,102,980
```

支持的时间列名：

```text
time, timestamp, date, datetime, open_time
```

必需价格列：

```text
open, high, low, close
```

可选成交量列：

```text
volume, vol, qty
```

时间可以使用 Unix 秒、Unix 毫秒，或浏览器可解析的日期时间字符串。导入后会按时间升序排序，相同时间以后出现的数据为准。

## AI 设置

点击右上角 `AI设置`：

- DeepSeek：选择 DeepSeek，填写 DeepSeek API Key，模型默认 `deepseek-chat`。
- OpenAI：选择 OpenAI，填写 OpenAI API Key 和模型名。
- 自定义代理：填写兼容 OpenAI Chat Completions 格式的接口地址。

API Key 只保存在当前浏览器或 Electron 应用的 `localStorage`，不会写入源码或 Git 提交。

## 常用命令

```bash
npm run dev              # Web 开发环境
npm run desktop          # 桌面应用
npm run build            # 生产构建
npm run package:mac      # 打包 macOS 应用
npm run knowledge:check  # 校验本地知识库
```

## 项目结构

```text
src/
  App.vue                         # 主界面布局
  composables/useChart.js          # 图表、回放、交易、点评状态管理
  components/
    ReplayBar.vue                  # 回放控制条
    DrawingToolbar.vue             # 左侧画线工具栏
    TradePanel.vue                 # 当前交易执行面板
    ReportPanel.vue                # 绩效报告与历史订单复盘
    TradeMarkersOverlay.vue        # 图表历史订单标记
    AiSettingsModal.vue            # AI 接口设置
  coach/
    aiCoach.js                     # AI 点评和追问请求
    localCoach.js                  # 点评 payload 构建
    ruleCards.js                   # 规则卡读取与检索
  data/
    binanceData.js                 # BTC 最新 K 线加载
    csvBars.js                     # CSV K 线解析
    mockData.js                    # 内置模拟数据
docs/
  AI_REVIEW_WORKBENCH_REQUIREMENTS.md
  RULE_CARD_JSON_EXAMPLE.json
scripts/
  validate-knowledge.cjs
  recover-electron-session.cjs
```

## 隐私与 GitHub 上传说明

上传前请确认不要提交以下内容：

- 真实 API Key、Token、Secret。
- `.env` 或 `.env.*`。
- `knowledge_private/` 私有规则卡。
- `recovered-pa-session*.json` 恢复出的复盘记录。
- `dist/`、`release/`、`node_modules/`。

当前 `.gitignore` 已忽略上述敏感或生成目录。上传前建议执行：

```bash
git status --short
rg -n "api[_-]?key|secret|token|bearer|sk-|Authorization" -S . -g '!node_modules/**' -g '!dist/**' -g '!release/**' -g '!knowledge_private/**'
```

命中代码中的字段名、占位说明或请求头模板是正常的，但不应出现真实密钥值。

## 致谢

本项目基于开源 K 线回放项目继续改造，当前方向聚焦于 AI 辅助价格行为交易复盘。

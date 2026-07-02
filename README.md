# K线回放交易 Demo

基于 **Vue 3 + Vite + @mg-exchange/charts** 的前端 demo，演示K线回放、画线和模拟交易功能。

## 功能特性

### 🗂 历史数据与训练会话
- 顶部支持导入 CSV 历史K线，导入后自动隐藏未来数据并从前 200 根上下文开始回放
- 支持常见时间列：`time` / `timestamp` / `date` / `datetime` / `open_time`
- 必需价格列：`open` / `high` / `low` / `close`，可选成交量列：`volume` / `vol` / `qty`
- 训练会话会自动保存到浏览器 `localStorage`，刷新页面后恢复当前数据、回放进度、逐棒判断、委托、持仓和成交记录
- 可一键回到内置模拟数据

### 🧠 逐棒判断训练
- 右侧提供“训练 / 报告 / 教练 / 交易”标签页，默认进入逐棒判断面板
- 每根K线可记录：市场状态、K线角色、Always In、信号质量、交易计划、失效条件和判断理由
- 记录按K线时间绑定，推进或回退后会自动显示对应K线的判断
- 已判读数量会实时统计，为后续 AI 教练点评与错题本做数据准备

### 🧑‍🏫 本地教练与错题本
- “教练”页可基于当前K线判断生成本地规则点评，不依赖网络或模型API
- 点评会检查上下文缺失、铁丝网交易、低质量信号入场、逆 Always In、缺少失效条件等常见问题
- 支持把当前K线标记为错题，并记录错因
- 教练点评和错题标记都会随训练会话保存

### 📋 会话报告
- 汇总当前训练会话的判读覆盖率、交易数、胜率、总盈亏、平均盈亏
- 展示交易计划与市场状态分布
- 展示错题数量、盈利/亏损/保本数量、盈亏因子和最近成交

### 📊 K线回放
- 一次性预生成 600 根 K 线数据
- 初始只显示 200 根，后面的"未来数据"对图表不可见
- **下一根**：点击或按 `Space` 推进一根 K 线，图表通过 `chart.updateBar()` 推送新数据
- **自动播放**：每 400ms 自动前进一根（按 `P` 切换）
- **重置**：随时回到起点（按 `R`）
- 实时显示 OHLCV + 进度条

### ✏️ 画线功能
左侧工具栏提供 12 个常用画线工具：趋势线 / 水平线 / 射线 / 平行通道 / 斐波那契 / 矩形 / 椭圆 / 箭头 / 文字 / 多空头位置等。

支持：
- 切换画线工具（再次点击同一工具退出）
- "磁吸 OHLC" 模式，吸附到K线高低点
- 一键清除全部画线
- 用 `@mg-exchange/charts` 内置的 47 种画线工具

### 💰 模拟交易
- **快速下单**：右上角"市价做多 / 做空"按钮
- **画线下单**（核心）：
  - 在图表上**右键** → 弹出自定义菜单 → 选择"限价买入 / 卖出 / 止损单"
  - 委托单立刻在图表上画出**水平委托线**
  - **拖动委托线**即可修改委托价格（`orderLineMoved` 事件）
  - K线推进时自动撮合：触及限价/止损价立即成交
- **持仓覆盖层**：使用 `setPositionOverlays()` 显示入场价位 + 盈亏
- **账户面板**：余额 / 浮动盈亏 / 已实现盈亏 / 总权益
- **历史成交**记录

### ⌨️ 快捷键
- `Space` → 前进一根 K 线
- `P` → 切换自动播放
- `R` → 重置回放

## 运行

```bash
npm install
npm run dev
```

打开 http://localhost:5173

## CSV 格式

最小示例：

```csv
time,open,high,low,close,volume
2026-01-01 09:30:00,100,102,99,101,1200
2026-01-01 09:35:00,101,103,100,102,980
```

时间列可以使用 Unix 秒、Unix 毫秒，或可被浏览器解析的日期时间字符串。导入后会按时间升序排序，相同时间的K线以后出现的记录为准。

## AI 点评接口

前端不会保存或暴露 OpenAI API Key。交易点评会向可配置的后端代理发送请求：

- 环境变量：`VITE_AI_REVIEW_ENDPOINT`
- 或浏览器本地配置：`localStorage.setItem('pa-ai-review-endpoint', 'https://your-domain/api/review')`

请求体包含：

- `systemPrompt`：Al Brooks 价格行为复盘教练系统提示词
- `sectionPrompts`：开盘背景、市场周期转换、逐K分析、本次交易 Setup、操作建议、常见错误、总结
- `payload`：选中交易、上下文 K 线、账户/持仓/备注等结构化数据

接口返回 JSON：

```json
{
  "summary": "一句话核心结论",
  "score": 82,
  "sections": [{ "title": "逐K分析", "body": "...", "items": ["..."] }],
  "issues": [{ "severity": "warn", "title": "问题", "detail": "..." }],
  "suggestions": ["下一次执行规则"]
}
```

成交历史中选中交易后可使用浏览器语音输入记录交易备注，点击“点评”时备注会随同交易上下文一起发给 AI 接口。

## 项目结构

```
src/
├── main.js                       # Vue 入口
├── App.vue                       # 主页面（三栏布局）
├── styles/global.css             # 全局样式
├── data/mockData.js              # K线数据生成器（确定性伪随机）
├── composables/
│   └── useChart.js               # 核心 composable：Chart 实例 + 状态管理
└── components/
    ├── ReplayBar.vue             # 顶部回放控制条
    ├── DrawingToolbar.vue        # 左侧画线工具栏
    └── TradePanel.vue            # 右侧交易/账户面板
```

## 关键实现说明

### 回放机制（`useChart.js`）

```
allBars[600]  ←─── 一次性生成的完整数据
              ↓
   replayIndex ───→ 暴露给图表的"最新已显示"索引
              ↓
   datafeed.getBars() 只返回 [0..replayIndex] 内的数据
              ↓
   replayNext() ⇒ replayIndex++ + chart.updateBar(allBars[replayIndex])
              ⇒ 触发挂单撮合 matchPendingOrders()
              ⇒ 刷新 setPositionOverlays() 浮盈
```

### 画线下单

`chart.setTradeMode(true, { contextMenuItems })` 注册自定义右键菜单。
用户点击菜单项后 `tradeRequested` 事件携带 `{ side, price, action }`，由 `onTradeRequested()` 路由到对应的下单函数，调用 `chart.addOrderLine()` 在图表上画出委托线。

### 撮合引擎

每根新 K 线推进时遍历待成交挂单：

- **限价买**：`bar.low <= order.price`
- **限价卖**：`bar.high >= order.price`
- **止损买**：`bar.high >= order.price`
- **止损卖**：`bar.low <= order.price`

触发后从挂单列表移除，并以委托价创建持仓。

## 依赖

- vue ^3.4
- vite ^5.4
- @mg-exchange/charts ^0.1.1

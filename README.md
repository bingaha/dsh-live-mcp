# dsh-live-mcp

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的会话级 MCP 控制插件：**在任意对话中按会话启停 MCP，工具集下一轮请求即刻生效**，保持会话连续性，开箱即用。

MCP 为真实连接：启用的服务器通过 `@deepseek-ai/dsh-mcp-client` 真正连接，工具以 `mcp__<server>__<tool>` 注入模型上下文。

## 亮点

* **会话级控制，实时生效** — 每个会话独立选择需要的 MCP，会话中途在设置页或输入框上方的状态条切换，下一轮模型请求即刻体现，轨迹中以 `Tools Updated` 呈现工具集变化。
* **会话状态一目了然** — 输入框上方常驻「MCP / 技能」能力状态条，当前会话可用的 MCP 与技能数量、名称、策略一目了然，MCP 支持按会话点选启停，状态随会话持久化。
* **完整的技能与 MCP 管理** — 浏览器内完成技能浏览、搜索、导入、删除与策略可视化；MCP 支持 `stdio` 与 `streamable-http` 两种形态的表单或 JSON 新建、测试连接、编辑、启停与删除。
* **零侵入，可靠持久** — 基于官方 SDK 构建，完整保留 DSH 源码与 `SKILL.md` 原状；MCP 配置持久化到 `~/.dsh/mcp.json`，会话级选择随会话归档自动清理。

## 界面展示

### 对话中途实时生效的 MCP 工具

会话进行中调整 MCP，右侧面板展示本轮实际生效的工具集变化，输入框上方的状态条同步更新。

![对话中途实时调整生效的 MCP 工具](docs/images/showcase-mcp-tools-injection.png)

### 会话能力状态条

「MCP」与「技能」两组 chip 展示当前会话的可用能力，MCP 支持按会话点选控制。

![会话能力状态条](docs/images/showcase-status-bar.png)

### 设置页 · Skills / MCP

Skills 支持扫描导入、搜索过滤、策略标签、详情展开与删除；MCP 支持实时连接状态、启停、编辑、删除与表单或 JSON 新建。

![设置页 Skills 技能](docs/images/showcase-settings-skills.png)

![设置页 MCP 服务](docs/images/showcase-settings-mcp.png)

## 技能策略可视化

插件以只读方式解析 `SKILL.md` frontmatter 中的调用策略并以颜色呈现，便于快速判断技能的可用方式：

* `disable-model-invocation: true` — 模型不可自动调用
* `user-invocable: false` — 用户不可通过斜杠菜单等手动调用

组合呈现四种状态：绿 = 均可调用；黄 = 模型不可、用户可；橙 = 用户不可、模型可；红 = 均不可调用。无限制的技能保持简洁无标签，策略由技能作者在 `SKILL.md` 中定义，插件仅做可视化呈现。

## 功能

### 技能

* 按来源分组浏览项目级与用户级技能（`.dsh/skills`、`.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`）
* 按名称搜索，按「全部 / 模型不可用 / 用户不可用」过滤
* 导入：扫描任意目录，选择技能后以软链接或拷贝方式导入到 `~/.dsh/skills`
* 详情：同卡片内展开，预览 `description`、`whenToUse` 与正文
* 删除：两步确认，软链接仅删除链接，保留源文件

### MCP 服务

* 支持 `stdio`（`command / args / env / cwd`）与 `streamable-http`（`url / headers`）两种服务形态，支持表单与 JSON 两种新建方式
* 测试连接、编辑、删除（两步确认），配置持久化到 `~/.dsh/mcp.json`
* 启用即真实连接并注册工具，禁用即断开并注销工具，实时展示连接状态（连接中 / 运行中 / 失败 / 已停止），失败附具体原因

### 会话状态条

* 技能 chip 为只读呈现，颜色对应作者定义的调用策略
* MCP chip 支持按会话点选控制，切换后仅影响当前会话，配置随会话持久化，归档即清理
* 设置页的变更通过同页通知即时同步到已打开会话的状态条

## 使用

前置：Node.js >= 22.19，已安装 `dsh` 命令行。

```bash
git clone https://github.com/bingaha/dsh-live-mcp.git
cd dsh-live-mcp
dsh plugin --profile web add link:$(pwd)
dsh web
```

入口：

* 设置页 →「技能与 MCP」管理技能与服务器
* 任意会话输入框上方 → 能力状态条查看与按会话控制 MCP

## 致谢

本项目 fork 自 [zebbkira/dsh-skills-mcp-manager](https://github.com/zebbkira/dsh-skills-mcp-manager)，感谢上游的原创工作。

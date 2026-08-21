# dsh-skills-mcp-manager

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的「技能与 MCP」管理器插件：在设置页新增一个「技能与 MCP」页面，并在每个会话输入框上方提供一条能力状态条。

MCP 为**真实连接**：启用的服务器会真正连上，其工具注册为 `mcp__<server>__<tool>`。

## 界面展示

### 会话能力状态条

每个会话输入框上方都有一条状态条，「MCP」和「技能」两组 chip 一览当前可用能力；MCP 可点击按会话屏蔽。

![会话能力状态条](docs/images/showcase-status-bar.png)

### 设置页 · Skills 技能

设置页「技能与 MCP → Skills 技能」：扫描导入（软链接 / 拷贝）、按名称搜索与调用策略过滤、状态点与「模型不可用 / 用户不可用」标签、详情展开与删除。

![设置页 Skills 技能](docs/images/showcase-settings-skills.png)

### 设置页 · MCP 服务

设置页「技能与 MCP → MCP 服务」：服务器列表实时显示连接状态，可启用 / 禁用（真实连接 / 断开）、编辑、删除；下方以表单或 JSON 新建服务器（stdio：command / args / env / cwd）。

![设置页 MCP 服务](docs/images/showcase-settings-mcp.png)

## 功能

### 技能（Skills）

- 浏览项目级与用户级技能，按来源分组（`.dsh/skills`、`.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`）。
- **只读展示作者策略**。颜色与标签来自 SKILL.md 的 `disable-model-invocation` / `user-invocable`；插件不改该文件，也不把前者当成「插件禁用」。
- 删除：两步确认；符号链接技能只删链接、不动源文件。
- 导入：扫描任意目录 → 选择技能 → 以「软链接 / 拷贝」导入到 `~/.dsh/skills`。
- 详情：点整行或「详情」，预览（description、whenToUse、正文）在**同一条边框**里向下展开。
- 搜索 / 过滤：按名称模糊搜索；过滤为「全部 / 模型不可用 / 用户不可用」（两轴都关的技能在后两个过滤里都能看到）。

设置页状态点与状态条同一套颜色：绿 = 模型和用户都能调；黄 = 仅模型不可用；橙 = 仅用户不可用；红 = 两轴都不可用。有限制才标「模型不可用」「用户不可用」，两轴都能调不标「正常」。

### MCP 服务

- 表单或 JSON 两种方式新建服务器（stdio：command / args / env / cwd；streamable-http：url / headers）。
- 测试连接：一键真实连接探测。
- 启用 / 禁用：真正连接 / 断开，实时显示状态（连接中 / 运行中 / 失败 / 已停止），失败时附具体原因。
- 名称搜索、编辑、删除（两步确认）。
- 配置持久化到 `~/.dsh/mcp.json`。

### 会话级能力状态条

每个会话输入框上方都有一条状态条，从左到右是「MCP」和「技能」两组 chip。没有「黑名单」「全部可用」「移出」字样。

- **技能 chip 只读、不可点**：颜色即作者策略（绿 / 黄 / 橙 / 红）。悬停短状态：可用 / 模型不可用 / 用户不可用 / 模型不可用，用户不可用。点技能不会从本会话拿掉工具或注入。
- **MCP 仍可按会话屏蔽**：点击某个 MCP，把它加入本会话屏蔽集 → 它的工具不再注入本会话；再点击即恢复。空屏蔽集 = 本会话可用所有全局启用的 MCP。改动从下一次模型请求生效。
- **MCP 颜色**：绿 = 可用（未屏蔽且运行中/已停止）；灰 = 已屏蔽（压过连接态）；红 = 未屏蔽但连接失败；琥珀 = 连接中。连接失败（红）的服务器仍可点成灰，防止它日后连上后漏入本会话。悬停短状态：可用 / 已屏蔽 / 连接失败 / 连接中。
- **每会话独立**：MCP 屏蔽随会话持久化，删除会话时一并清理。
- 本窗口在设置页保存/启停/删除 MCP，或导入/删除技能后，已打开会话的状态条会立刻重拉（同页通知，不轮询）。

本轮不把技能做成真隐藏：插件不改 SKILL.md、不控制 `disable-model-invocation`，也不拦截斜杠菜单或 `skill()`。已经注入过的技能正文仍可能留在历史里。

## 使用

### 安装

前置：Node.js >= 22.19，并已安装 dsh 命令行。

    git clone https://github.com/bingaha/dsh-skills-mcp-manager.git
    cd dsh-skills-mcp-manager
    dsh plugin --profile web add link:$(pwd)
    dsh web

### 入口

- **设置页**：打开 GUI →「设置」→「技能与 MCP」。在这里浏览、导入、删除技能（只读展示调用策略），以及新建 / 测试连接 / 启停 / 删除 MCP。
- **状态条**：任意会话的输入框上方。技能为只读一览；MCP 可按会话屏蔽。每条状态条只作用于当前会话，互不影响。

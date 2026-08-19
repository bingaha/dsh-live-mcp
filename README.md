# dsh-skills-mcp-manager

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是 DeepSeek 官方的 AI 编程助手框架，命令行工具叫 `dsh`，提供 Web UI、Headless 等运行模式，并通过插件机制扩展能力。

本插件是其中一个独立插件：在 DeepSeek Harness Web GUI 的「设置」页新增一个独立的「技能与 MCP」页面（一级导航入口，与「插件」等并列），用于管理技能（skills）与 MCP 服务器。

MCP 是**真实连接**：启用的服务器会通过 @deepseek-ai/dsh-mcp-client 真正连上，并把工具注册为 mcp__<server>__<tool>；启用 / 禁用会实际连接 / 断开。
<img width="778" height="789" alt="image" src="https://github.com/user-attachments/assets/f7492576-e806-427d-97e9-b3ec1d6770f7" />

## 功能

### Skills 技能

- 区分项目级 / 用户级，按来源分组（.dsh/skills、.agents/skills、~/.dsh/skills、~/.agents/skills）。
- 启用 / 禁用：改写 SKILL.md 前言的 disable-model-invocation + user-invocable，可逆。
  - 语义与 DSH 官方一致（`@deepseek-ai/dsh-skill-filesystem`）：`disable-model-invocation: true` 才表示禁用（模型不可调用）；`false` 或缺省 = 不禁用 = 生效。列表显示「生效」即模型可调用。
- 删除：两步确认，物理删除技能目录（bundle）或平铺 .md 文件；符号链接技能只删除链接、不动源文件。
- 导入：指定目录 → 扫描技能 → 选择「软链接 / 拷贝导入」到 ~/.dsh/skills。支持系统原生目录选择器与手写路径两种方式。
- 详情：查看 description、whenToUse 与完整正文。
- 搜索 / 过滤：按名称模糊搜索，按「已启用 / 未启用」过滤。

### MCP 服务

- 表单或 JSON 两种方式新建服务器（stdio 的 command/args/env/cwd，或 streamable-http 的 url/headers）。
- 测试连接：一键真实连接探测。
- 启用 / 禁用：真正连接 / 断开，状态实时显示（连接中 / 运行中 / 失败 / 已停止）。
- 名称搜索、编辑、删除（两步确认）。
- 配置持久化到 ~/.dsh/mcp.json。

## 安装

### 方式一：从 npm 安装（推荐）

前置条件：Node.js >= 22.19，并先装好 dsh 命令行。

    # 1. 全局安装 dsh（已装可跳过）
    npm install -g @deepseek-ai/dsh
    dsh --version      # 能打印版本号即成功

    # 2. 把本插件装进 web profile
    dsh plugin --profile web add @zebbkira/dsh-skills-mcp-manager@0.1.3

    # 3. 重启 dsh web
    dsh web

dsh plugin 会把包装进 profile 并自动把它加入插件层（本包声明了 dsh.bundle.patch），无需手动改任何配置。版本号 @0.1.3 可换成 npm 上的最新版。

### 方式二：从 GitHub 仓库安装（开发调试）

用于改代码调试，需要 Node.js >= 22 与 pnpm：

    # 1. 克隆仓库
    git clone https://github.com/zebbkira/dsh-skills-mcp-manager.git
    cd dsh-skills-mcp-manager

    # 2. 安装依赖并构建
    pnpm install
    pnpm build

    # 3. 链接进 web profile
    dsh plugin --profile web add link:$(pwd)

    # 4. 重启 dsh web
    dsh web

Windows PowerShell 下把第 3 步的 $(pwd) 换成完整路径，例如：

    dsh plugin --profile web add link:E:\path\to\dsh-skills-mcp-manager

改完源码后重跑 pnpm build 再重启 dsh web 即可。

## 使用

安装并重启后，打开 DeepSeek Harness Web GUI，打开「设置」，在左侧导航选择「技能与 MCP」（与「插件」并列的一级入口），即可看到管理界面。

## 目录结构

    src/
      index.ts                    # Host 半区入口（插件加载 + 设置命名空间 + Agent 公告）
      skills.ts                   # 技能文件系统引擎
      mcp.ts                      # MCP 配置存储 + 真连接管理器
      routes.ts                   # /api/dsh-skills-mcp 路由族
      protocol.ts                 # 共享类型与 API 路径
      client/
        index.ts                  # 浏览器半区入口
        SettingsCard.tsx          # 设置页面（一级入口的内容）
        manager.tsx               # Skills / MCP 管理界面
        api.ts                    # fetch 客户端
        locales.ts                # 双语字典
        settings-card.module.css
    scripts/wrap-client.mjs       # 把浏览器半区打成模块加载器格式
    cordis.patch.yml              # 插件注册行
    package.json                  # dsh.bundle.patch + dsh.client 清单

## MCP 真连接原理

Host 半区的 MCP 管理器在启动 / 保存配置时，把「已启用服务器」收敛成一组活跃连接：

- 每个启用的服务器通过 ctx.plugin(@deepseek-ai/dsh-mcp-client, config) 挂载一个实例，工具注册为 mcp__<server>__<tool>。
- 连接失败会在页面显示原因，点「测试连接」或重新保存可重试。
- 禁用 / 删除会断开连接并注销该服务器的全部工具。

服务器名（name）即 mcp-client 的命名空间，受 [A-Za-z0-9_-]{1,32} 约束且需全局唯一。

## 已知限制

- 只扫描四个可管理的技能根目录，不展示内置 / 运行时技能。
- 导入目的地固定为 ~/.dsh/skills，按目录名 / 文件名去重。
- MCP 服务器凭证（env / headers）以明文存于 ~/.dsh/mcp.json，请自行保证该文件权限（建议 0600）。

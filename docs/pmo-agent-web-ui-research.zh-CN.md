# PMO Agent Web UI 参考调研

生成日期：2026-06-02

## 结论先行

PMO Agent 不应该直接做成一个通用 ChatGPT clone。它的核心价值不是“能聊天”，而是把飞书项目、GitLab、飞书文档和沟通动作组织成一个可信的 PMO 工作台。

推荐方向：

```text
左侧：范围与视图切换
中间：日报 / 风险 / 需求 / 人员 / 证据链
右侧：Agent 对话与解释
底部或抽屉：审批队列、执行记录、运行日志
```

可以借鉴：

- Open WebUI 的左侧会话/工作区组织和权限后台。
- LobeHub 的 Agent workspace、schedule、report、project 概念。
- CopilotKit 的“Agent 不是只返回文本，而是驱动页面状态和工具卡片”。
- OpenGenerativeUI 的动态可视化思想，但只用于 PMO 图表/证据视图，不做开放式 UI 生成。
- AutoGen Studio 的 workflow/prototype 思路，但不直接照搬其生产架构。

## 评估维度

| 维度 | 对 PMO Agent 的意义 |
|---|---|
| 信息架构 | 能否把日报、风险、需求、人、证据、审批组织清楚 |
| Agent 交互 | 是否支持工具调用、状态同步、可解释执行 |
| 权限治理 | 是否支持团队范围、角色、群组、审计 |
| 工作流 | 是否支持审批、定时任务、历史运行、失败重试 |
| 可部署性 | 是否适合部署在 `pmo.hongliang.app` 的现有 Node 服务旁边 |
| 可读性 | 是否像 PMO 工作台，而不是聊天记录堆叠 |

## 参考 1：Open WebUI

链接：

- 项目：[open-webui/open-webui](https://github.com/open-webui/open-webui)
- 官方文档：[Open WebUI Docs](https://docs.openwebui.com/)
- 截图：[demo.png](https://github.com/open-webui/open-webui/raw/main/demo.png)

定位：

Open WebUI 是一个自托管 AI 平台，支持 Ollama/OpenAI-compatible API、RAG、工具、工作区、权限和多端响应式体验。仓库 README 强调它是 feature-rich、自托管、可离线运行的平台，并包含权限、RAG、工具、OpenTelemetry、WebSocket、SSO 等能力。

适合借鉴：

| 设计点 | 可借鉴方式 |
|---|---|
| 左侧导航 | PMO 可以做“日报、风险、需求、人员、审批、运行记录” |
| Workspace/Channels | 对应 MAAS_平台、open-platform、不同项目线 |
| 管理后台 | 对应 Bot 白名单、运行策略、日报收件人、模型配置 |
| RAG/文档入口 | 对应飞书文档上下文检索 |
| 视觉克制 | 暗色/浅色都适合内部工具，但 PMO 应优先浅色高密度 |

不建议照搬：

- 它仍然以聊天为中心；PMO Agent 的首页应该是状态工作台。
- 它的通用模型/知识库配置很多，第一版会淹没 PMO 的关键任务。

## 参考 2：LobeHub / LobeChat

链接：

- 项目：[lobehub/lobehub](https://github.com/lobehub/lobe-chat)
- 官网：[lobehub.com](https://lobehub.com/)

定位：

LobeHub 当前更强调 “Chief Agent Operator”，包括 agents as unit of work、IM Gateway、Schedule、Project、Workspace、Personal Memory 等概念。它的方向比传统聊天 UI 更接近 PMO Agent：Agent 被组织成可调度、可协作、可汇报的工作单元。

适合借鉴：

| 设计点 | 可借鉴方式 |
|---|---|
| Agent as unit of work | PMO Agent 不只是聊天窗口，而是一个每日运行的运营角色 |
| Schedule | 对应每天 09:00 自动核查、失败重试、补跑 |
| Project | 对应 MAAS_平台、需求维度、GitLab group |
| Report | 对应日报、周报、风险趋势 |
| IM Gateway | 对应飞书 Bot 入口 |
| Memory | 对应人/需求/历史风险/沟通偏好 |

不建议照搬：

- LobeHub 的通用 Agent team 概念很大，PMO Agent 第一版只需要一个 PMO 状态核查角色。
- 不应把“创建 agent”作为首页主流程。

## 参考 3：LibreChat

链接：

- 官网：[LibreChat](https://www.librechat.ai/about)
- Agents 文档：[LibreChat Agents](https://www.librechat.ai/docs/features/agents)

定位：

LibreChat 是多模型、多供应商、自托管聊天平台，强调 MIT、SSO/OAuth/SAML/LDAP、MCP support、自定义 endpoints、plugins、agents。

适合借鉴：

| 设计点 | 可借鉴方式 |
|---|---|
| 企业身份 | PMO 后续应接飞书身份或 SSO，而不是长期 Basic Auth |
| 多模型配置 | 区分日报总结模型、深度风险分析模型 |
| Agent Builder 权限 | 管理哪些人能触发补跑、审批、发送沟通 |
| 审计与限制 | 对应谁触发了什么命令、是否越权 |

不建议照搬：

- 它是聊天平台，不是项目状态工作台。
- 对 PMO 来说，模型选择不是主要交互，状态与证据才是。

## 参考 4：CopilotKit

链接：

- 项目：[CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit)
- 文档：[docs.copilotkit.ai](https://docs.copilotkit.ai/)

定位：

CopilotKit 是用于构建 agent-native applications 的前端栈，强调 generative UI、shared state、human-in-the-loop、工具调用渲染。它不是一个现成 PMO 页面，但它的交互模式很适合 PMO Agent。

适合借鉴：

| 设计点 | 可借鉴方式 |
|---|---|
| Shared State | Agent 对话能读当前选中的需求、风险、报告 |
| Human-in-the-loop | 审批发送、审批写回、确认补跑 |
| Tool Rendering | “生成日报”不只回文字，还出现运行卡片 |
| Agent Actions | 页面按钮和对话命令走同一套 action |

推荐 PMO 用法：

- 右侧 Agent Chat。
- 中间是确定性 UI：风险表、需求详情、证据链、运行卡片。
- Agent 触发动作时，页面出现可审计工具卡片：输入、状态、产物、下一步。

## 参考 5：OpenGenerativeUI

链接：

- 项目：[CopilotKit/OpenGenerativeUI](https://github.com/CopilotKit/OpenGenerativeUI)

定位：

OpenGenerativeUI 展示 agent 生成交互式 UI 的能力，包括图表、diagram、widget、iframe sandbox 等。它适合启发“Agent 输出不止 Markdown”，但 PMO Agent 不应该让模型自由生成核心业务 UI。

适合借鉴：

| 设计点 | 可借鉴方式 |
|---|---|
| 图表和 diagram | 风险趋势、需求状态流、人员负载可以动态可视化 |
| sandbox | 后续可隔离模型生成的临时分析视图 |
| 渐进展示 | 长任务运行时逐步展示阶段结果 |

不建议照搬：

- PMO 的核心报告必须稳定、可审计，不适合开放式随机 UI。
- 只把它用于“分析视图增强”，不作为主渲染框架。

## 参考 6：AutoGen Studio

链接：

- 项目说明：[AutoGen Studio README](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-studio/README.md)
- 文档：[AutoGen Studio](https://autogenhub.github.io/autogen/docs/autogen-studio/)

定位：

AutoGen Studio 用于原型化多 Agent workflow、skills、models 和交互测试。官方 README 明确提示它不是生产就绪应用，需要开发者自行实现认证、安全等生产要求。

适合借鉴：

| 设计点 | 可借鉴方式 |
|---|---|
| Workflow 可视化 | 展示每日核查 pipeline：读取需求、拉 GitLab、匹配、风险、渲染、发送 |
| Skills/Models 配置 | 展示日报模型、风险模型、工具状态 |
| 运行调试 | 对失败阶段提供重试 |

不建议照搬：

- 不直接采用它的应用架构。
- PMO Agent 的第一版 UI 不需要拖拽编排 Agent。

## PMO Agent 推荐信息架构

### 第一屏

| 区域 | 内容 |
|---|---|
| 顶部状态条 | 今日运行状态、最近成功时间、数据源健康、快捷补跑 |
| 总览指标 | 有实质进展、P0/P1 风险、信息缺失、孤立代码进展、建议沟通 |
| 重点风险 | 只展示 P0/P1/P2，按 why now 排序 |
| 今日进展 | 需求、证据、负责人、下一步 |
| Agent 侧栏 | 解释日报、查询需求、生成日报、准备沟通草稿 |

### 页面导航

| 页面 | 作用 |
|---|---|
| `/` | PMO 工作台首页 |
| `/reports` | 日报列表和最新日报 |
| `/risks` | 风险池和处理状态 |
| `/stories` | 需求列表，支持按 owner/status/risk 过滤 |
| `/people` | 人员视图：每个人负责什么、需要沟通什么 |
| `/evidence` | GitLab/飞书项目/飞书文档证据链 |
| `/approvals` | 发送沟通和项目字段写回审批 |
| `/runs` | 运行记录、失败阶段、重试 |
| `/settings` | 数据源、模型、Bot 白名单、日报规则 |

## 推荐交互模式

### 1. 不是聊天优先，而是工作台优先

首页先回答：

- 今天发生了什么？
- 哪些风险需要我看？
- 哪些人需要沟通？
- 哪些地方数据不可信？
- 哪些事项可以不打扰？

聊天只是解释、过滤、触发动作的入口。

### 2. Agent 输出结构化卡片

示例：

```text
用户：生成 2026-06-02 日报

页面：
[运行卡片]
状态：运行中
阶段：读取飞书项目 -> 读取 GitLab -> 匹配证据 -> 风险分析 -> 生成 HTML
产物：等待中
```

完成后：

```text
[运行卡片]
状态：成功
日报：打开
JSON：下载
建议沟通：10 条待审批
```

### 3. 所有危险动作必须可审批

危险动作包括：

- 发送单聊/群聊催办。
- 写回飞书项目字段。
- 批量标记需求风险。
- 修改日报规则。

UI 上必须有：

- 动作说明。
- 证据来源。
- 影响对象。
- 执行人。
- 审批按钮。
- 审计记录。

## 推荐视觉方向

| 方面 | 建议 |
|---|---|
| 风格 | 内部 SaaS / ops dashboard，不做营销页 |
| 信息密度 | 比当前 HTML 更高，但用卡片和表格分层 |
| 颜色 | 浅色为主，风险用红/橙/黄，成功用绿，信息用蓝/灰 |
| 布局 | 桌面优先，三栏：导航、主内容、Agent |
| 表格 | 支持筛选、排序、固定列、详情抽屉 |
| 移动端 | 基本可读即可，不优先做复杂操作 |

## 不应该做什么

- 不要把首页做成一个空聊天框。
- 不要把所有需求平铺成大表。
- 不要让模型自由生成日报结构。
- 不要把模型配置、prompt、provider 放到普通用户主路径。
- 不要允许 Bot 或网页直接执行写回/发送，必须经过审批。
- 不要长期依赖 Basic Auth；后续应接飞书身份或 SSO。

## 第一版网页建议

在 `pmo.hongliang.app` 下新增：

```text
https://pmo.hongliang.app/app
```

第一版只做：

- 工作台首页。
- 最新日报嵌入/入口。
- 风险与建议沟通列表。
- 运行记录。
- 右侧 Agent 命令面板。

不做：

- 通用多模型聊天。
- Agent marketplace。
- 自定义 prompt builder。
- 拖拽 workflow。

## 推荐技术实现

当前 PMO Agent 是 Node 22 + TypeScript 服务。最稳妥路径：

1. 保持现有 action server。
2. 增加 `/api/*` JSON endpoints，复用已有 runs/drafts/project-update/checkins。
3. 新增轻量前端：

```text
src/web/
  app.html
  app.css
  app.ts
```

或后续升级为 Vite/React：

```text
apps/web/
  React + TanStack Query + shadcn/ui 或自建 CSS
```

短期建议先不引入大框架，先做稳定可读的静态增强页面；当交互复杂到需要路由、状态缓存、表格组件时，再迁移到 React/Vite。

## 参考来源

- Open WebUI GitHub README: <https://github.com/open-webui/open-webui>
- Open WebUI Docs: <https://docs.openwebui.com/>
- LobeHub GitHub README: <https://github.com/lobehub/lobe-chat>
- LobeHub: <https://lobehub.com/>
- LibreChat About: <https://www.librechat.ai/about>
- LibreChat Agents: <https://www.librechat.ai/docs/features/agents>
- CopilotKit GitHub README: <https://github.com/CopilotKit/CopilotKit>
- CopilotKit Docs: <https://docs.copilotkit.ai/>
- OpenGenerativeUI GitHub README: <https://github.com/CopilotKit/OpenGenerativeUI>
- AutoGen Studio README: <https://github.com/microsoft/autogen/blob/main/python/packages/autogen-studio/README.md>

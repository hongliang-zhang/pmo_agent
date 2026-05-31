# PMO Agent 需求文档

状态：待确认草稿  
日期：2026-05-31  
仓库：`hongliang-zhang/pmo_agent`  
运行时基础：`z-mono` Agent Runtime

## 1. 产品主张

PMO Agent 应该是一个面向 MaaS 平台的低打扰项目智能体。

它需要持续回答两个核心问题：

1. 整个 MaaS 平台今天有哪些变化，涉及哪些 repo，由谁更新，这些更新推进了什么产品能力或工程能力？
2. 整个 MaaS 平台里每个人当前在做什么，进展如何，有哪些风险，下一步和时间点是什么？

这个产品的核心价值不是做一份更好看的 commit 摘要，而是把分散的工程信号转换成项目管理状态模型：工作流、负责人、进展、阻塞、风险、下一里程碑和置信度。只有当被动证据不足或互相矛盾时，agent 才应该去问人。

## 2. 当前上下文

### 2.1 GitHub 目标仓库

PMO Agent 仓库已经连接到：

- GitHub 仓库：https://github.com/hongliang-zhang/pmo_agent
- 本地 checkout：`/Users/zhanghongliang/Documents/PMO agent/pmo_agent`

这个仓库目前是一个新仓库，因此本文档是第一个产品资产。

### 2.2 z-mono 作为 agent 内核

本地 z-mono 仓库是一个 pnpm monorepo：

- `/Users/zhanghongliang/Documents/ai_emoloyee_platform_2/z-mono`

和 PMO Agent 相关的运行时结构：

- `packages/dispatcher`：接收 IM 事件，规范化消息，做消息去重，创建 sandbox runtime，并把回复发回 IM。
- `packages/gateway`：可信的 sandbox-facing API，负责 session events、LLM 代理、存储和 action 代理。
- `packages/actions`：可信的三方集成服务。GitHub、GitLab、飞书、日历和代码智能相关 action 应该放在这里扩展。
- `packages/agent-sdk`：让运行在 sandbox 中的 agent 使用 gateway、持久化文件、LLM adapter 和动态拉取的 action schema。
- `packages/db`：当前平台状态主要围绕 agents、IM configs、conversations、session events 和 IM message receipts。
- `packages/ai-employee-platform`：AI 员工工作流的产品原型界面，但在后端接通前，很多页面应视为 mock-driven。

继承自 z-mono 的重要架构约束：

- Sandbox 不可信，不能拿到平台密钥。
- Gateway 是所有 sandbox 可访问平台能力的可信入口。
- 三方凭证应放在 Actions Service，不应放进 sandbox，也最好不要直接放进 gateway。
- Session events 应成为用户消息、assistant 回复、tool 调用和 tool 结果的 append-only 追踪日志。
- 新增 PMO 集成时，应扩展 Actions Service 和存储 schema，不应破坏 dispatcher / gateway / sandbox 的信任边界。

## 3. 外部集成调研

GitHub 是第一个集成对象，因为当前需求首先来自 repo 活动。设计上应该采用“事件摄取 + 定时对账”的组合。

GitHub 相关能力：

- Webhooks 可以推送 `push`、`pull_request`、`pull_request_review`、`pull_request_review_comment`、`issues`、`deployment`、`deployment_status`、`status`、`workflow_job` 和 `workflow_run` 等事件。这些事件覆盖代码变更、review、issue 状态、部署状态和 CI 状态。来源：GitHub webhook event docs，https://docs.github.com/en/webhooks/webhook-events-and-payloads
- `push` 事件表示分支上的活动，包括 commits、tags、分支删除，或从 template 创建 repo。`pull_request` 事件表示 PR 活动，review comments、reviews 和 review threads 有独立事件。
- Commits REST API 支持列出 commits、获取单个 commit、查找某个 commit 关联的 PR，以及比较两个 refs。大范围 compare 需要分页；changed files 只包含在第一页，并且完整 compare 中有数量限制。来源：GitHub commits REST docs，https://docs.github.com/en/rest/commits/commits
- GraphQL commit object 暴露 `associatedPullRequests`，可以帮助把原始 commit 关联到已合并 PR 或 open PR，尤其适用于 commit 还没有进入默认分支的情况。来源：GitHub GraphQL commits docs，https://docs.github.com/en/graphql/reference/commits
- 生产自动化建议使用 GitHub App，而不是长期个人 token。GitHub 说明 GitHub App installation token 的 rate limit 会随仓库数和组织用户数扩展。来源：GitHub REST rate limit docs，https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Webhook 安全应使用 secret 校验 `X-Hub-Signature-256`，处理时应使用 delivery ID 做幂等和 redelivery 处理。来源：GitHub webhook best practices，https://docs.github.com/webhooks/using-webhooks/best-practices-for-using-webhooks 和 https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries

由于 z-mono 当前连接的是 GitLab（`https://dev.aminer.cn/open-platform/z-mono.git`），PMO Agent 从第一天起就应该按多 SCM 设计：

- Phase 1 可以先实现 GitHub，因为 `pmo_agent` 在 GitHub。
- 领域模型应使用 `scm_provider`，不要把 source 写死成 `github`。
- GitLab 支持应作为 provider module 接入，并复用同一套 normalized event model。

## 4. 产品原则

1. 被动优先，打扰最后。
   Agent 应该先从 commits、PRs、issues、reviews、CI、deployment events、docs 和历史对话中推断状态，只有必要时才问人。

2. 先有证据，再有总结。
   每个项目状态都应该能链接到来源证据：PR、commit、issue、deployment、CI run、doc 或 check-in 答复。

3. 置信度是一等信息。
   Agent 应明确说“已确认”“大概率”“未知”，而不是把猜测包装成事实。

4. 人不是 repo。
   一个人的状态应从工作流、owner 关系、review 活动、阻塞和计划下一步中推断，而不是简单统计 commit 数量。

5. 变更总结要有产品理解。
   Summary 应把 repo 变化映射到 MaaS 平台能力：runtime、gateway、dispatcher、actions、SDK、dashboard、agent templates、reliability、infra、security 和 product UI。

6. PMO 是状态系统，不只是聊天助手。
   Chat 只是一个入口，真正的资产是持续更新的项目图谱。

## 5. 核心用户故事

### 5.1 每日 repo 情报

作为 PM / 平台负责人，我希望可以问：

- “今天 MaaS 平台有哪些 repo 更新？”
- “每个 repo 谁更新了，更新了什么？”
- “哪些更新是功能，哪些是 bugfix / infra / refactor / docs？”
- “哪些改动可能影响发布、稳定性、安全或架构边界？”
- “今天有哪些 PR 还卡着？”

期望输出：

- 按产品领域分组的 repo 级 summary。
- 作者 / reviewer / merger 归因。
- PR 和 commit 证据链接。
- 变更分类和风险等级。
- 关键文件和受影响模块。
- 如果有 CI / deployment 数据，输出发布和部署影响。

### 5.2 人员进展情报

作为 PM / 负责人，我希望可以问：

- “每个人最近在做什么？”
- “当前进展如何？”
- “有什么风险？”
- “下一步预计什么时候？”
- “谁可能需要帮助或决策？”

期望输出：

- 人员维度的工作流列表。
- 有证据支撑的进展描述。
- 阻塞和风险信号。
- 下一步动作和时间。
- 置信度。
- 只有在需要时才给出最小 follow-up 问题。

### 5.3 低打扰 check-in

作为团队成员，我不应该被 PMO Agent 频繁打扰。

Agent 只有在以下情况下才应该问我：

- 我负责的工作流在配置阈值内没有新证据。
- PR、CI、部署或 review 信号与当前状态矛盾。
- deadline 临近，但缺少下一步证据。
- 可能存在 blocker，但尚未确认。
- 需要人做决策。

Check-in 应该足够短，并且一条消息就能回答：

- “我看到你在做 gateway session events，PR 还没合并。当前是开发中、等 review、还是被问题卡住？预计下一步时间是？”

Agent 应避免提问：

- 当某个人最近已经 push commits 或更新 PR，且状态清晰时。
- 当另一个信息源已经回答了同一个问题时。
- 在短时间窗口内对同一个人连续问多个问题。

## 6. 功能需求

### 6.1 Repo registry

Agent 需要维护一份 MaaS 平台 repo 清单。

必需字段：

- Provider：`github`，未来支持 `gitlab`。
- Owner / org / project path。
- Repo name。
- Default branch。
- Product area。
- Criticality：high / medium / low。
- Ownership hints：team、primary owner、fallback owner。
- Ingestion mode：webhook、scheduled poll、manual。
- Active status：active / archived / ignored。

初始配置应支持手写 YAML/JSON，因为自动 repo discovery 容易引入噪音。

### 6.2 SCM 事件摄取

系统应摄取：

- Push events。
- PR opened / synchronized / reopened / closed / merged。
- PR review submitted。
- PR review comments 和 unresolved threads。
- 如果团队用 issues 做工作跟踪，则摄取 issue creation / update / close。
- CI status 和 workflow run events。
- Deployment 和 deployment status events。
- Repository created / archived / visibility changed events。

摄取必须幂等：

- 存储 provider delivery ID。
- 存储 provider event ID 和 raw payload hash。
- 允许 redelivery replay。
- 同一个 delivery 不能被当成新事件重复处理。

### 6.3 定时对账

Webhooks 不够，agent 还需要定时对账：

- 按 repo 列出自上次 checkpoint 以来的 recent commits。
- 比较 default branch checkpoint 和当前 head。
- 拉取自上次 checkpoint 以来更新过的 PR。
- 为 orphan commits 拉取 associated PRs。
- 拉取 changed refs 对应的 workflow / deployment 状态。
- 系统停机后补齐缺失事件。

### 6.4 变更理解

对每次 repo 更新，agent 应推断：

- 改了什么：简洁的功能性 summary。
- 为什么可能这么改：基于 PR title/body、issue links、commit messages、touched files、tests、docs。
- 受影响领域：runtime、gateway、dispatcher、actions、SDK、DB、sandbox、UI、infra、docs、tests。
- 变更类型：feature、bugfix、reliability、security、refactor、docs、test、dependency、config。
- 风险等级：low / medium / high。
- 证据链接。
- 该变更是否需要在 digest 中提示人工关注。

对大 diff，第一版应先总结 metadata 和 changed files，再选择性拉取高影响文件的 patch 细节。

### 6.5 项目 / 工作流模型

Agent 应把活动归一化为 workstreams。

Workstream 字段：

- Title。
- Product area。
- Owning person。
- Supporting people。
- Linked repos。
- Linked PRs / issues / commits / docs。
- Status：not started、active、waiting review、blocked、at risk、done、shipped。
- Progress：叙述型进展，如果证据支持可以加百分比。
- Current milestone。
- Next step。
- Next expected time。
- Risks。
- Confidence。
- Last evidence timestamp。

Workstream 创建可以先从 PR、issue、branch name 开始，再由 agent summary 持续修正。

### 6.6 人员状态模型

Agent 应维护人员 profile：

- GitHub/GitLab usernames 和 emails。
- 后续飞书 / IM identity。
- Default team / role。
- Current workstreams。
- Recent authored commits。
- Recent PRs opened/updated/merged。
- Reviews requested / completed。
- Blocking dependencies。
- Check-in history 和 quiet hours。

输出时应区分：

- Author：写了 commits。
- PR owner：负责交付。
- Reviewer：负责解阻或提出阻塞。
- Merger / releaser：完成合并或发布。
- Mentioned / stakeholder：被提及或相关方，但不一定是 owner。

### 6.7 风险检测

风险信号：

- 高 criticality repo 出现未经过 PR 或 review 的变更。
- PR 有 unresolved review threads。
- CI 失败，或 pending 超过阈值。
- Deployment failed 或 stale。
- gateway / auth / db / actions / sandbox 文件出现大 diff。
- Migration 被修改。
- secrets / config / deploy 文件被修改。
- workstream 在 deadline 附近没有证据更新。
- 多个人被同一个 reviewer 阻塞。
- 反复 force-push / revert / hotfix。
- z-mono 架构边界风险，例如 sandbox 直接访问 DB，或 actions 被直接调用。

风险输出应包括：

- Signal。
- Evidence。
- Severity。
- Suggested next action。
- 是否需要打扰某个人。

### 6.8 Digest 和查询入口

每日 digest 应包括：

- Executive summary。
- Repo update table。
- Product-area summary。
- Person progress table。
- Risks and blockers。
- Decisions needed。
- “No need to ask” items，即证据充分、不需要打扰人的事项。
- Suggested check-ins。

临时查询应支持：

- “今天/昨天/本周 maas 有什么变化？”
- “z-mono 今天谁动了什么？”
- “某个人当前在做什么？”
- “哪些项目有风险？”
- “哪些 PR 卡住？”
- “某个模块最近变化原因是什么？”

### 6.9 最小 check-in 引擎

Agent 应基于以下因素决定是否提问：

- Evidence freshness。
- Workstream criticality。
- Deadline proximity。
- Contradiction level。
- Person quiet hours。
- Recent questions count。
- 是否已有团队级答案覆盖该问题。

问题预算：

- 默认每人每天最多 1 个问题。
- 默认每个 daily digest 周期最多 3 个问题。
- 高严重性发布 / 安全风险允许升级。

问题风格：

- 一条短消息。
- 包含 agent 已知信息。
- 要求结构化回答：status、blocker、next step、ETA。
- 避免泛泛地问“进展如何”。

## 7. 非功能需求

### 7.1 安全

- 生产环境使用 GitHub App installation token，而不是长期 PAT。
- Provider credentials 只存放在可信 service / action 环境中。
- 在解析业务逻辑前校验 webhook signature。
- 不把 SCM token 暴露给 sandbox。
- 记录 raw payload 时做 secret redaction。
- Provider permissions 采用最小权限原则。

### 7.2 可靠性

- Webhook endpoint 应快速确认请求，并把任务入队。
- Worker processing 应可重试。
- 幂等性应使用 provider delivery ID。
- 定时对账应修复漏掉的事件。
- 每份生成的 PM summary 都应能追溯到存储的 evidence。

### 7.3 隐私和打扰控制

- 维护每个人的 question ledger。
- 尊重 quiet hours 和周末。
- 允许用户表达“今天不要再问我这个 workstream”。
- 除非严重性或政策要求，否则避免公开升级。

### 7.4 可观测性

需要追踪：

- Ingestion lag。
- Events processed / failed / replayed。
- Reconciliation gaps。
- Summary generation success。
- Check-ins sent / answered / ignored。
- False-positive risk flags。
- 用户对 agent summary 的修正。

## 8. 基于 z-mono 的建议架构

### 8.1 Runtime flow

```text
GitHub/GitLab webhooks
  -> PMO ingestion API / worker
  -> normalized event store
  -> evidence graph
  -> PMO agent sandbox
       -> gateway
       -> actions service tools
       -> LLM reasoning
  -> daily digest / ad hoc answer / low-touch check-in
```

### 8.2 z-mono package 映射

建议拆分：

- `pmo_agent` 中放 PMO-specific product、schema 和 workers。
- 如果 PMO 作为 sandbox agent 运行，则扩展 z-mono Actions Service，增加 SCM actions：
  - `github_list_recent_activity`
  - `github_get_pr`
  - `github_get_commit`
  - `github_compare_refs`
  - `github_list_workflow_runs`
  - `github_search_issues_prs`
  - 未来的 `gitlab_*`
- 增加 PMO-specific storage，且放在 sandbox 外：
  - events
  - normalized changes
  - workstreams
  - people identities
  - digests
  - check-in ledger
- 使用 gateway / session events 记录 agent 对话和 tool-call trace。

PMO Agent 不应把 provider tokens 或 raw SCM access 放进 sandbox。Sandbox 应通过 gateway / actions 请求 SCM 事实。

### 8.3 建议数据模型

Tables / entities：

- `scm_providers`
- `repositories`
- `repo_owners`
- `provider_identities`
- `people`
- `webhook_deliveries`
- `scm_events`
- `commits`
- `pull_requests`
- `reviews`
- `ci_runs`
- `deployments`
- `change_summaries`
- `workstreams`
- `workstream_evidence`
- `person_workstream_states`
- `risks`
- `digests`
- `checkins`
- `agent_corrections`

关键设计选择：把 provider 原始事实和 agent 解释结果分开存储。这样 prompt / model 改进后，解释结果可以重新生成。

## 9. MVP 定义

### 9.1 MVP 目标

基于 GitHub 活动，产出可靠的 MaaS 平台每日 PM digest，并能用 evidence links 回答临时问题，同时只做最小人工 check-in。

### 9.2 MVP 范围

范围内：

- 手工 repo registry。
- 原型阶段使用本地 token 做 GitHub authentication，生产形态记录为 GitHub App。
- 定时拉取 recent commits 和 PRs。
- 如果有部署目标，可选实现 webhook receiver。
- Commit / PR normalization。
- Repo daily summary。
- Person daily summary。
- 针对 CI failure、stale PR、大型 / 高风险文件变更、workstream 无更新做风险信号检测。
- 生成 Markdown daily digest。
- CLI 或简单 agent chat entrypoint。
- 记录未来 GitLab 支持，因为 z-mono 当前托管在 GitLab。

不在 MVP 范围：

- 完全自动化飞书 check-ins。
- 双向项目管理系统更新。
- 完美 ETA 预测。
- 组织级 GitHub App installation UI。
- 完整 dashboard。
- 多租户 SaaS 控制。

### 9.3 MVP 成功标准

对于配置好的 repo list 和 date range，agent 能回答：

- 哪些 repos 有变化。
- 谁做了变化。
- 用自然语言说明改了什么。
- 哪些变化映射到哪些 MaaS capability area。
- 哪些 PR stale、failing 或 blocked。
- 每个活跃人员看起来正在做什么。
- Agent 对哪些地方不确定，以及应该问谁。

## 10. 确认后的实施计划

Phase 0：Repo bootstrap

- 添加项目 README。
- 添加 env template。
- 添加产品文档和架构说明。
- 确认它应该作为 standalone app，还是 z-mono package，再选择技术栈。

Phase 1：GitHub 数据摄取

- 定义 repo registry config。
- 实现 GitHub client。
- 实现 recent commits / PRs / compare ingestion。
- 持久化 normalized evidence。
- 添加幂等 checkpoints。

Phase 2：Summarization 和状态模型

- 构建 change classification。
- 构建 person attribution。
- 构建 workstream inference。
- 构建 risk rules。
- 生成 daily Markdown digest。

Phase 3：基于 z-mono runtime 的 agent interface

- 通过 Actions Service-compatible tools 暴露 PMO data/actions。
- 实现 PMO agent prompt 和 query workflows。
- 存储 query / session traces。

Phase 4：低打扰 check-ins

- 添加 uncertainty scoring。
- 添加 question budget。
- 添加 check-in ledger。
- 经确认后添加 Feishu / IM send action。

Phase 5：GitLab 和 MaaS 平台强化

- 添加 GitLab provider。
- 添加 z-mono-specific architecture boundary checks。
- 添加 deployment / CI integrations。
- 如需要，再添加 dashboard。

## 11. 待确认问题

1. Source control 范围：MVP 只监控 GitHub repos，还是因为 z-mono 当前在 `dev.aminer.cn`，必须立刻支持 GitLab？
2. Repo list：除了 z-mono，哪些 repo 是 MaaS 平台的事实来源？
3. 输出渠道：daily digest 第一版发到飞书、GitHub issue、本地 Markdown，还是 web page？
4. 身份映射：是否已有 GitHub/GitLab username 到真实团队成员的映射？
5. Check-ins：MVP 只推荐要问的问题，还是允许经审批后自动发飞书消息？
6. 时间窗口：daily digest 默认按中国时区自然日切分吗？
7. PM taxonomy：capability areas 先按 z-mono package names，还是按你的 MaaS 产品模块？

## 12. 我的当前理解

正确的第一版应该是一个 PMO intelligence loop：

1. 从 repo 摄取代码和协作证据。
2. 归一化成 repo / person / workstream 状态。
3. 生成有证据支撑的 daily summary 和 ad hoc answer。
4. 检测不确定性和风险。
5. 只有当证据不足时，才提出有针对性的 follow-up question。

技术上，这应该作为一个 PMO-specific product layer 来实现，并且可以运行在 z-mono 的 agent runtime 上。Agent 本身仍然是不可信的，应通过可信的 Actions Service tools 访问 GitHub/GitLab，从而保持 z-mono 的 gateway / actions / sandbox 边界。

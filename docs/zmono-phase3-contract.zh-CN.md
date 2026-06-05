# PMO Agent Phase 3 z-mono 接入契约

## 目标

PMO Agent 后续运行在 z-mono runtime 时，不能让 sandbox 直接拿 GitLab、飞书项目、飞书文档或模型凭证。所有外部系统访问都应该放在 z-mono Actions Service 可信区，sandbox 只通过 gateway 调用结构化 action。

## 模型策略

- Provider：z.ai（智谱）
- 日报总结模型：`glm-5-turbo`
- 深度风险分析模型：`glm-5.1`
- OpenAI 协议地址：`https://open.bigmodel.cn/api/coding/paas/v4`
- Anthropic 协议地址：`https://open.bigmodel.cn/api/anthropic`

API key 只允许通过 `ZAI_API_KEY` 注入本地 `.env.local` 或 Actions Service 环境变量，不进入代码、报告、manifest、contract JSON。

## Actions

当前 contract 由以下命令生成：

```bash
pnpm pmo:agent-contract
```

核心只读/本地可恢复 action：

| Action | 作用 | 写外部系统 |
|---|---|---|
| `pmo_preflight` | 检查 GitLab、飞书项目 MCP、lark-mcp、z.ai、scheduler 和 delivery guard readiness | 否 |
| `pmo_collect_facts` | 读取飞书项目需求和 GitLab 交付证据 | 否 |
| `pmo_enrich_context` | 读取需求关联飞书文档，抽取目标/验收/测试计划/排期/下一步候选补全 | 否 |
| `pmo_build_state_snapshot` | 生成 PMO audit report 和 project state snapshot | 否 |
| `pmo_render_local_report` | 写本地 Markdown/HTML/JSON 报告，可选上下文增强 | 否 |
| `pmo_run_agent_cycle` | 推荐运行入口：报告、可选上下文增强、草稿、ops dashboard、run stages | 否 |
| `pmo_scheduler_tick` | 到点触发完整 agent-cycle，未到点或当天已成功则跳过 | 否 |

## 后续接入步骤

1. 在 z-mono `packages/actions` 中新增 PMO action 文件，复用本仓库的 domain/state/render 逻辑，或把本仓库发布为内部 package 后引用。
2. 在 z-mono Actions Service 环境变量中配置 GitLab、飞书项目、飞书文档、z.ai model env。
3. 在 z-mono registry 中注册三个 PMO action。
4. 通过 gateway `/gateway/actions/list` 验证 sandbox 能看到 schema。
5. 通过 sandbox agent 调用 `pmo_collect_facts` -> `pmo_build_state_snapshot` -> `pmo_render_local_report`。
6. 第二阶段仍保持只读；发送飞书 IM、写飞书项目字段、写 GitLab 评论必须作为后续单独审批能力。

## 当前 smoke 验证方式

当前 z-mono 已通过 `PMO_AGENT_CWD` 调用本地 PMO Agent CLI，不需要 sandbox 直接接触 GitLab、飞书项目或 z.ai key。

Actions Service 调用的是结构化 bridge：

```bash
pnpm --silent pmo:action -- --action pmo_render_local_report --input-json '{"date":"2026-05-31"}'
```

该命令只输出 JSON envelope，避免 z-mono action 解析人类可读日报 stdout。

也可以把 PMO Agent 作为 HTTP action server 启动：

```bash
PORT=3201 pnpm pmo:serve-actions
```

z-mono Actions Service 优先通过 `PMO_AGENT_URL=http://localhost:3201` 调用该服务；如果没有配置 `PMO_AGENT_URL`，才 fallback 到 `PMO_AGENT_CWD` + `pnpm --silent pmo:action`。

HTTP server 还提供运行历史入口：

- `GET /preflight`：返回结构化 readiness，包括 GitLab、飞书项目 MCP、lark-mcp、z.ai 模型、scheduler 和 Feishu IM delivery guard；输出会脱敏 credential。
- `POST /runs/daily`：执行一次 PMO 日报任务，并把运行结果写入 `reports/runs.json`。
- `POST /runs/agent-cycle`：推荐的 PMO agent 运行入口；生成本地报告，可在显式传入 `enrichContext: true` 时读取关联飞书文档并抽取候选补全，可在显式传入 `analyzeWithModels: true` 时运行日报总结模型和深度风险模型，创建待审批沟通草稿，可在显式传入 `createFeishuDoc: true` 时创建飞书文档，刷新 `ops-dashboard.html`/`ops-dashboard.json`，并把 `render_report`、可选 `enrich_context`、可选 `analyze_with_models`、`create_communication_drafts`、可选 `create_feishu_doc` 等阶段状态写入 `reports/runs.json`。
- `GET /runs?reportsDir=reports`：读取运行历史，供调度器、z-mono agent 或后续 UI 查询。
- `GET /runs/:runId?reportsDir=reports`：读取单次运行详情，包括 stage 状态、summary 和 artifacts。
- `POST /runs/:runId/retry-stage`：重试可恢复 stage；当前支持 `create_communication_drafts`，复用已有 report artifact，不重新跑 GitLab/飞书项目采集。
- `POST /scheduler/tick`：按北京时间日调度判断是否应运行；未到时间或当天已成功运行则返回 skipped。到点运行前默认执行 preflight gate，GitLab/飞书项目/z.ai 等硬失败会返回 `503` 和 blocking checks；只有人工 smoke 才建议显式传入 `skipPreflight: true`。默认执行完整 `agent_cycle`；只有显式 `runMode: "daily_audit"` 时才走旧的只生成日报路径。
- `POST /drafts/from-report`：从报告中的 `communicationPlan` 生成飞书 IM 草稿，状态为 `pending_approval`，不发送消息。可传 `personDirectory` 写入收件人身份映射元数据；可传 `policy` 执行每人每日预算、quiet hours、同需求重复追问窗口等低打扰控制。
- `GET /drafts?reportsDir=reports`：读取待审批沟通草稿。
- `POST /drafts/approve`：把本地沟通草稿标记为 `approved` 并记录审批审计日志，不发送消息。
- `POST /drafts/reject`：把本地沟通草稿标记为 `rejected` 并记录驳回审计日志。
- `GET /drafts/audit?reportsDir=reports`：读取本地沟通草稿审批/驳回审计日志。
- `POST /drafts/deliver`：只允许对 `approved` 草稿执行发送流程；z-mono 默认以 dry-run 调用。真实飞书 IM 发送在 `PMO_FEISHU_IM_DELIVERY_ENABLED=true`、飞书 IM 发送权限、收件人 `open_id` 映射和已验证 delivery adapter 都完成前会 fail closed。
- `POST /checkins/record`：记录沟通回复并解析 status、blocker、next step、ETA、是否需要更新飞书项目；只写本地 `checkins.json`，不更新外部系统。
- `GET /checkins?reportsDir=reports`：读取本地 check-in 回复记录，供后续 agent 状态和 PMO 运维面板使用。

本地启动 Actions Service：

PMO Agent 自身的本地端到端 smoke：

```bash
pnpm pmo:smoke-local -- \
  --date 2026-05-31 \
  --storiesFixture tests/fixtures/stories.json \
  --maxProjects 0 \
  --reportsDir reports/smoke \
  --now 2026-05-31T01:01:00Z \
  --skipPreflight
```

该命令会临时启动 PMO HTTP server，跑 `/health`、`/scheduler/tick`、`/runs/:runId`、`/drafts`、`/actions/invoke`，并验证报告与 ops dashboard artifacts，结束后自动关闭 server。`--skipPreflight` 只用于本地 fixture smoke。

运行成功后可打开 `reports/<dir>/ops-dashboard.html` 查看运维状态。Dashboard 包含 readiness、latest smoke、失败 stage 的 recovery endpoint、run history、待审批沟通草稿和草稿审批审计事件。

z-mono actions 侧 smoke：

```bash
# terminal 1: in pmo_agent
PORT=3201 pnpm pmo:serve-actions

# terminal 2: in z-mono
PMO_AGENT_URL=http://localhost:3201 \
pnpm --filter @aaas/actions pmo:smoke -- \
  --date 2026-05-31 \
  --reportsDir reports/smoke \
  --storiesFixture tests/fixtures/stories.json \
  --maxProjects 0 \
  --now 2026-05-31T01:01:00Z \
  --skipPreflight
```

这条链路通过 z-mono action registry 调用 `pmo_preflight`、`pmo_scheduler_tick`、`pmo_get_run`、`pmo_list_communication_drafts`，用于验证 z-mono 到 PMO Agent 的边界契约。

```bash
PORT=3102 \
INTERNAL_API_KEY=pmo-smoke-key \
PMO_AGENT_URL=http://localhost:3201 \
pnpm --filter @aaas/actions exec tsx src/index.ts
```

本地启动 Gateway：

```bash
PORT=3101 \
JWT_SECRET=test-secret-32-chars-minimum-len \
DATABASE_URL=mysql://user:pass@localhost:3306/test \
LLM_API_KEY=dummy \
ACTIONS_SERVICE_URL=http://localhost:3102 \
INTERNAL_API_KEY=pmo-smoke-key \
pnpm --filter @aaas/gateway exec tsx src/index.ts
```

已验证：

- `/gateway/actions/list` 能看到 `pmo_render_local_report`。
- `/gateway/actions/invoke` 能调用 `pmo_render_local_report`。
- z-mono action `pmo_preflight` 能读取结构化 readiness，适合作为调度前置检查。
- z-mono action `pmo_run_agent_cycle` 能触发推荐运行闭环，并返回每个 stage 的状态与 artifact；默认不调用模型和不创建飞书文档，传入 `analyzeWithModels: true` 后启用可选 `analyze_with_models` stage，传入 `createFeishuDoc: true` 后启用可选 `create_feishu_doc` stage。
- 本地 `ops-dashboard.html` 能展示 runs、stage 状态、待审批草稿和草稿审计日志，作为 Phase 3 运维入口。
- z-mono actions `pmo_get_run` 和 `pmo_retry_run_stage` 能查询单次运行并恢复草稿生成阶段。
- z-mono action `pmo_scheduler_tick` 能通过 `PMO_AGENT_URL` 触发 tick，默认调度完整 agent-cycle 并保留 preflight gate；首次 due 执行，第二次同日跳过。
- z-mono action `pmo_enrich_context` 和 `enrichContext: true` run 参数能把关联飞书文档里的目标、测试计划和下一步候选写入 `storyAudit.context` / `stateSnapshot.stories[].candidateCompletions`，并进入低打扰沟通草稿。
- z-mono actions `pmo_create_communication_drafts`、`pmo_approve_communication_draft`、`pmo_reject_communication_draft`、`pmo_list_communication_draft_audit` 和 `pmo_deliver_communication_draft` 能完成本地草稿审批与 dry-run delivery 闭环；真实发送仍被 PMO Agent delivery guard 拦住。
- z-mono actions `pmo_record_checkin_reply` 和 `pmo_list_checkins` 能记录/读取沟通回复解析结果；所有回复只进入本地 agent 状态，不自动写飞书项目。
- 调用结果包含结构化 `report`、`artifacts` 和 `ProjectStateSnapshot`。
- smoke 输出中未发现 z.ai API key。

# PMO Agent

Phase 1 builds a PMO status-audit CLI for the MAAS platform. Phase 2 adds a reusable project-state snapshot. Phase 3 defines the z-mono Actions Service contract. Phase 3.5 adds low-disturbance communication controls, check-in closed loop, Feishu Project writeback wrappers, and production worker packaging.

The main object is a Feishu Project story in the `MAAS_平台` space. GitLab `dev.aminer.cn/open-platform` is treated as delivery evidence, not as the source of project truth.

## Current Capabilities

- Reads GitLab `open-platform` projects, merge requests, commits, and pipelines.
- Normalizes Feishu Project MCP story records into a stable `Story` model.
- Matches GitLab evidence to stories by story id, story link, title keywords, branch text, commit/MR text, and owner hints.
- Detects missing goal, owner, schedule, test plan, next step, stale status, failed pipeline, blocked MR, and delivery/status mismatch risks.
- Builds a `ProjectStateSnapshot` with story health, workstream health, a Feishu communication plan, and no-disturb decisions.
- Renders a PMO audit report to the local filesystem under `reports/` as Markdown, JSON, browser-readable HTML, latest copies, and a manifest.
- Exports a z-mono-compatible agent contract for report, scheduler, draft, check-in, and project-update queue actions.
- Can also create a Feishu document through Feishu OpenAPI, or through `lark-mcp` after Feishu user OAuth and document scopes are valid.
- Can map people through Feishu Project MCP people fields plus Feishu Contacts OpenAPI email lookup.
- Can deliver approved Feishu IM drafts through Feishu OpenAPI when explicitly enabled and outside quiet hours.
- Can run as a long-lived worker with visible `worker-events.json` and `ops-dashboard.html` output.

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Set `GITLAB_TOKEN` in `.env.local`, or rely on the existing macOS git credential for `dev.aminer.cn`.

Feishu Project MCP must be enabled for the `MAAS_平台` space before real stories can be read:

- MCP URL: `https://project.feishu.cn/mcp_server/v1`
- Space: `MAAS_平台`
- Space URL: `https://project.feishu.cn/7358164361912909827_1719375156/story/homepage`

The CLI intentionally fails with setup instructions if Feishu Project MCP is not authorized. It does not use fake data unless `--stories-fixture` is explicitly provided.

If HTTP OAuth is not usable in the current environment, the CLI also supports header-based Feishu Project MCP auth:

```bash
FEISHU_PROJECT_MCP_TOKEN=project-mcp-token
```

This maps to the Feishu Project MCP `X-Mcp-Token` header. For custom headers, use:

```bash
FEISHU_PROJECT_MCP_BEARER_TOKEN=project-token
```

or:

```bash
FEISHU_PROJECT_MCP_AUTH_HEADER='Authorization=Bearer project-token;X-Custom=value'
```

The CLI loads `.env.local` and `.env` automatically. `FEISHU_PROJECT_PROJECT_KEY` is optional; when omitted, the adapter resolves it from the configured Feishu Project space URL by calling `search_project_info`.

By default the live audit focuses on active stories only:

```bash
FEISHU_PROJECT_ACTIVE_STATUSES=开发阶段,测试阶段,上线阶段,进行中
```

Adjust this list if the MAAS_平台 workflow changes or if the first report should include earlier states such as `开始`.

Model policy for later z-mono runtime integration:

```bash
ZAI_API_KEY=your-local-key
ZAI_ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
ZAI_OPENAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
PMO_DAILY_MODEL=glm-5-turbo
PMO_RISK_MODEL=glm-5.1
```

The default provider is z.ai. Daily summary work should use `PMO_DAILY_MODEL`; deeper risk analysis should use `PMO_RISK_MODEL`. The key must stay in `.env.local` or the z-mono Actions Service environment. It is never written to reports or the z-mono contract output.

After configuring `ZAI_API_KEY`, verify both model endpoints independently:

```bash
pnpm pmo:model-smoke -- --reportsDir reports/model-smoke
```

The smoke writes `reports/model-smoke/<date>-pmo-model-analysis.json` and prints only provider, model names, character counts, and the artifact path. It does not print the API key or model response text to stdout.

## Commands

Run tests:

```bash
pnpm test
```

Type-check:

```bash
pnpm build
```

Check local setup before running a live audit:

```bash
pnpm pmo:doctor
```

`pmo:doctor` now reports the full production readiness set: GitLab, Feishu Project MCP, `lark-mcp`, z.ai model credential, Feishu OpenAPI Contacts/IM credential, IM delivery guard, and scheduler. It exits non-zero when a required dependency is not ready.

For Feishu document output, prefer the Feishu OpenAPI mode when `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are configured:

```bash
PMO_FEISHU_DOC_OUTPUT_MODE=openapi
```

This creates a docx document through Feishu OpenAPI and appends the rendered report as text blocks. Optional:

```bash
PMO_FEISHU_DOC_TITLE=MAAS_平台 PMO 状态核查日报
PMO_FEISHU_DOC_FOLDER_TOKEN=<folder_token>
PMO_FEISHU_DOC_WEB_BASE_URL=https://zhipu-ai.feishu.cn/docx
```

The legacy `lark-mcp` output is still supported. Make sure the `lark-mcp` app used by the PMO Agent is the same app you authorized. If `~/.codex/config.toml` points to a different app, set an explicit override in `.env.local`:

```bash
LARK_MCP_COMMAND=npx
LARK_MCP_ARGS='-y @larksuiteoapi/lark-mcp mcp -a <app_id> -s <app_secret> --oauth'
```

Then re-login with document scopes:

```bash
npx -y @larksuiteoapi/lark-mcp login \
  -a <app_id> \
  -s '<app_secret>' \
  --scope 'docx:document drive:drive docs:doc auth:user.id:read'
```

If `pmo:doctor` reports `npx timed out`, run the underlying check directly:

```bash
npx -y @larksuiteoapi/lark-mcp whoami
```

If it is just slow in the current network, increase the diagnostic timeout:

```bash
PMO_LARK_MCP_TIMEOUT_MS=60000 pnpm pmo:doctor
```

For Contacts lookup and real Feishu IM delivery, configure either a tenant token or app credentials after the Feishu app has Contacts and IM permissions:

```bash
FEISHU_TENANT_ACCESS_TOKEN=<tenant_access_token>
# or
FEISHU_APP_ID=<app_id>
FEISHU_APP_SECRET=<app_secret>
```

Then verify Contacts lookup without printing real identifiers:

```bash
pnpm pmo:feishu-openapi-smoke -- --email user@aminer.cn
```

After you approve a real message smoke, send only to the resolved receiver:

```bash
pnpm pmo:feishu-openapi-smoke -- \
  --receiveIdType open_id \
  --receiveId <resolved_open_id> \
  --sendText 'PMO Agent IM smoke test'
```

For group delivery, use `--receiveIdType chat_id` and a Feishu `chat_id`. Production delivery still requires an approved draft and `PMO_FEISHU_IM_DELIVERY_ENABLED=true`.

Review and approve communication drafts from the local report store:

```bash
pnpm pmo:approvals -- refresh --reportsDir reports
pnpm pmo:approvals -- list --reportsDir reports
pnpm pmo:approvals -- show --reportsDir reports --id <approval_id>
pnpm pmo:drafts -- list --reportsDir reports
pnpm pmo:drafts -- show --reportsDir reports --draftId <draft_id> --actor 张鸿亮
pnpm pmo:drafts -- approve --reportsDir reports --draftId <draft_id> --actor 张鸿亮 --note '同意发送'
pnpm pmo:drafts -- deliver --reportsDir reports --draftId <draft_id> --actor 张鸿亮 --dryRun
```

`pmo:approvals` refreshes `approval-center.html/json` and prints the current pending approval summary plus copyable next commands. `show --id` resolves a pending communication draft or project writeback approval and prints the exact approve/reject/dry-run commands. It never approves, sends, or writes back anything by itself.

Real Feishu IM delivery still requires both an approved draft and:

```bash
PMO_FEISHU_IM_DELIVERY_ENABLED=true
```

When a new daily report delivery draft is created for the same recipient and channel, older pending `daily_report_delivery` drafts are automatically marked `auto_closed` with reason `superseded_by_newer_daily_report_delivery_draft`. This prevents the approval center from accumulating duplicate daily report sends.

For Feishu Project writeback field mapping, list story fields and get suggested `.env.local` entries:

```bash
pnpm pmo:feishu-project-fields
```

The command reads Feishu Project MCP `list_workitem_field_config`, suggests mappings for goal, test plan, next step, due date, and status, and prints candidate `PMO_FEISHU_FIELD_*` lines. Review the output before copying it into `.env.local`; status updates should still prefer the `transition_node` wrapper.

If `PMO_FEISHU_FIELD_NEXT_STEP` is empty, approved project update actions that only contain `nextStep` use a Feishu Project comment fallback instead of failing. This keeps check-in replies actionable while MAAS_平台 has no explicit next-step field.

Review and approve Feishu Project writeback actions from check-in replies:

```bash
pnpm pmo:project-updates -- list --reportsDir reports
pnpm pmo:project-updates -- show --reportsDir reports --actionId <action_id> --actor 张鸿亮
pnpm pmo:project-updates -- approve --reportsDir reports --actionId <action_id> --actor 张鸿亮 --note '同意写回'
pnpm pmo:project-updates -- apply --reportsDir reports --actionId <action_id> --actor 张鸿亮 --dryRun
```

Only after the dry-run preview is correct, apply the approved action to Feishu Project:

```bash
pnpm pmo:project-updates -- apply --reportsDir reports --actionId <action_id> --actor 张鸿亮 --real
```

Print the z-mono agent/action contract:

```bash
pnpm pmo:agent-contract
```

Execute a z-mono-facing PMO action bridge and return a JSON envelope:

```bash
pnpm pmo:action -- --action pmo_build_state_snapshot --input-json '{"factsPath":"reports/2026-05-31-pmo-audit.json"}'
```

Run the same bridge as a local HTTP service:

```bash
PORT=3201 pnpm pmo:serve-actions
```

Expose the Feishu bot webhook from the same HTTP service:

```text
POST https://pmo.hongliang.app/feishu/events
```

Setup details: [docs/feishu-bot-setup.zh-CN.md](docs/feishu-bot-setup.zh-CN.md).

Web UI product research: [docs/pmo-agent-web-ui-research.zh-CN.md](docs/pmo-agent-web-ui-research.zh-CN.md).

Run the production-style worker loop locally:

```bash
pnpm pmo:worker
```

The worker evaluates `PMO_DAILY_RUN_AT`, runs the agent cycle when due, appends `reports/worker-events.json`, and refreshes `reports/ops-dashboard.html`.

Run the production service shape locally:

```bash
pnpm pmo:prod
```

This starts both the PMO HTTP action server and the scheduler worker in one long-running process. Docker uses the same production entrypoint by default. Visible production output is written under `PMO_REPORTS_DIR`:

- `ops-dashboard.html` and `ops-dashboard.json`: readiness, active alerts, runs, retry actions, drafts, check-ins, writeback queue, worker events.
- `approval-center.html` and `approval-center.json`: human review queue for pending Feishu IM drafts and Feishu Project writeback actions, with copyable local approval commands.
- `ops-alerts.json`: machine-readable active alert queue for failed preflight checks, failed runs/stages, worker errors, and pending approval backlog.
- `worker-events.json`: worker start, skipped ticks, preflight blocks, run completion, worker errors.
- `runs.json`: resumable run records and failed stage details.
- `communication-drafts.json`, `communication-draft-audit.json`, `checkins.json`, `project-update-actions.json`: approval and closed-loop state.
- `live-validation.json`: non-secret evidence that live dependencies were validated, used by `pmo:acceptance`.

Set `PMO_SERVE_REPORTS=true` to expose read-only report files under `/reports/<file>`. In any public environment, also set `PMO_HTTP_BASIC_AUTH=username:password`; this protects reports and action APIs while keeping `GET /health` public for uptime checks.

For the Open WebUI deployment, set `PMO_OPENAI_API_KEY` and run `docker compose --env-file .env.production -f docker-compose.openwebui.yml up -d --build`. Open WebUI connects to PMO Agent through the OpenAI-compatible endpoints `GET /v1/models` and `POST /v1/chat/completions`; see `docs/open-webui-migration.zh-CN.md`.

For Tencent Cloud packaging, this repo includes a standalone `Dockerfile` and `deploy.sh` aligned with the internal `agent-hub` convention: build on Node 22 and keep reports under `/persistent/reports`. The Dockerfile uses public `node:22-slim` so the lightweight server can build without private base-image credentials.

Deployment details and production acceptance steps are documented in `docs/tencent-cloud-deployment.zh-CN.md`.

The current Phase 3.5 requirement-by-requirement acceptance audit is tracked in `docs/phase3.5-acceptance-audit.zh-CN.md`.

Print a machine-readable Phase 3.5 acceptance status from local evidence:

```bash
pnpm pmo:acceptance -- --reportsDir reports
pnpm pmo:acceptance -- --reportsDir reports --write
```

The command reports the 9 requested requirements, their current status, evidence paths, and remaining live validation actions. It is read-only. With `--write`, it also writes `phase3.5-acceptance.json` and `phase3.5-acceptance.md` under the reports directory. If `reports/live-validation.json` exists, the command uses it as non-secret evidence for live IM, Tencent Cloud, Feishu Doc, and production scheduler validation.

Run the Phase 3 local end-to-end smoke without leaving a server running:

```bash
pnpm pmo:smoke-local -- \
  --date 2026-05-31 \
  --storiesFixture tests/fixtures/stories.json \
  --maxProjects 0 \
  --reportsDir reports/smoke \
  --now 2026-05-31T01:01:00Z \
  --skipPreflight
```

The smoke starts an ephemeral PMO HTTP server, checks `/health`, runs `/scheduler/tick`, reads the run back through `/runs/:runId`, lists local communication drafts, invokes `/actions/invoke` as a z-mono-facing bridge call, and verifies the report plus ops dashboard artifacts. It prints one JSON result and stops the server before exiting. Use `--skipPreflight` only for local fixture smoke tests.

After a successful smoke or agent cycle, open `reports/<dir>/ops-dashboard.html` to inspect operational state. The dashboard includes readiness checks, the latest smoke result, failed run stages with retry endpoints, run history, pending communication drafts, draft approval audit events, and parsed check-in replies. Open `reports/<dir>/approval-center.html` to review only the items that require human approval before Feishu IM delivery or Feishu Project writeback.

The HTTP service exposes `GET /health`, `GET /preflight`, and `POST /actions/invoke`. z-mono Actions Service should prefer `PMO_AGENT_URL=http://localhost:3201` in deployed environments and only use `PMO_AGENT_CWD` as a local fallback.

It also exposes productized run endpoints for a scheduler or z-mono agent:

- `GET /preflight` returns a structured readiness report for GitLab, Feishu Project MCP, lark-mcp, z.ai models, scheduler, and Feishu IM delivery guard. It redacts credentials and is the recommended check before enabling scheduled runs.
- `POST /runs/daily` runs one PMO daily audit and records the run in `reports/runs.json`.
- `POST /runs/agent-cycle` runs the recommended PMO agent cycle: render the report, optionally read linked Feishu documents and extract candidate completions when `enrichContext: true`, optionally run model analysis when `analyzeWithModels: true`, build a recipient directory from Feishu Project people plus Feishu Contacts API when credentials are available, create pending approval communication drafts, optionally create a Feishu document when `createFeishuDoc: true`, refresh `ops-dashboard.html`/`ops-dashboard.json`, and persist stage records in `reports/runs.json`. OpenAPI Feishu Doc output converts Markdown tables into native Feishu table/cell blocks and splits large tables before writeback.
- Pass `createReportDeliveryDraft: true` to `POST /runs/agent-cycle` or `/scheduler/tick` to create a pending approval daily report delivery draft for the configured recipient. For 张鸿亮, `PMO_DAILY_REPORT_RECIPIENT_USER_ID=test-user-id` is supported as `receive_id_type=user_id`; if Contacts API later resolves `open_id`, set `PMO_DAILY_REPORT_RECIPIENT_OPEN_ID` instead.
- `GET /runs?reportsDir=reports` lists recent run records.
- `GET /runs/:runId?reportsDir=reports` returns one persisted run record with stage status and artifacts.
- `POST /runs/:runId/retry-stage` retries a recoverable stage. Phase 3 currently supports `create_communication_drafts`, reusing the existing report artifact instead of rerunning GitLab/Feishu collection.
- `POST /scheduler/tick` evaluates the daily schedule and either runs once or returns a skipped decision. Due runs execute a preflight gate by default and return `503` with blocking checks when required dependencies fail; pass `skipPreflight: true` only for manual smoke tests. By default it runs the full `agent_cycle`; pass `runMode: "daily_audit"` only for legacy report-only runs. Pass `enrichContext: true` to enable linked Feishu document context extraction before communication draft generation. Configure the daily China-local run time with `PMO_DAILY_RUN_AT=09:00`.
- `POST /drafts/from-report` creates pending approval Feishu IM drafts from a report communication plan. It does not send messages. Optional `personDirectory` adds recipient identity metadata, and optional `policy` enforces low-disturbance controls such as per-person daily budget, quiet hours, and same-story repeat windows.
- `GET /drafts?reportsDir=reports` lists pending communication drafts.
- `POST /drafts/approve` marks a local draft as approved and records an audit event. It does not send messages.
- `POST /drafts/reject` marks a local draft as rejected and records an audit event.
- `GET /drafts/audit?reportsDir=reports` lists local draft approval audit events.
- `POST /drafts/deliver` attempts delivery for an approved draft. It defaults to dry-run behavior, refuses unapproved drafts, blocks real delivery during quiet hours, and requires `PMO_FEISHU_IM_DELIVERY_ENABLED=true` plus Feishu OpenAPI credential and recipient mapping.
- `POST /checkins/record` records a check-in reply, parses status/goal/blocker/test plan/next step/ETA, auto-closes related drafts when the reply answers the question, and creates a pending project-update action when the reply asks to update Feishu Project. It does not directly update Feishu Project.
- `GET /checkins?reportsDir=reports` lists local check-in reply records.
- `GET /project-update-actions?reportsDir=reports` lists pending Feishu Project writeback actions generated by replies.
- `POST /project-update-actions/approve` approves one pending writeback action.
- `POST /project-update-actions/reject` rejects one pending writeback action.
- `POST /project-update-actions/apply` applies an approved writeback action through Feishu Project MCP `update_field` and then writes an audit comment. It requires explicit field mapping through the request body or `PMO_FEISHU_FIELD_GOAL`, `PMO_FEISHU_FIELD_TEST_PLAN`, `PMO_FEISHU_FIELD_NEXT_STEP`, `PMO_FEISHU_FIELD_DUE_DATE`, and `PMO_FEISHU_FIELD_STATUS`.

The current MAAS_平台 field discovery result is documented in `docs/feishu-project-field-mapping.zh-CN.md`. Do not enable field writeback until the exact field semantics and update format are verified for the target story type.

The doctor checks GitLab credentials, Feishu Project MCP access, and the current `lark-mcp` OAuth session. It exits non-zero only for hard failures; missing Feishu document scopes are reported as a warning because local Markdown reports still work.

Run a local development audit with fixture stories and real GitLab evidence:

```bash
FEISHU_PROJECT_MCP_URL=https://project.feishu.cn/mcp_server/v1 \
pnpm pmo:audit -- --date 2026-05-31 --dry-run \
  --stories-fixture tests/fixtures/stories.json \
  --max-projects 3
```

Run against real Feishu Project MCP:

```bash
FEISHU_PROJECT_MCP_URL=https://project.feishu.cn/mcp_server/v1 \
pnpm pmo:audit -- --date 2026-05-31 --dry-run
```

The local filesystem output is the primary Phase 1 delivery path while Feishu document permissions are pending. A successful run writes:

- `reports/YYYY-MM-DD-pmo-audit.md`
- `reports/YYYY-MM-DD-pmo-audit.json`
- `reports/YYYY-MM-DD-pmo-audit.html`
- `reports/YYYY-MM-DD-pmo-audit-manifest.json`
- `reports/latest-pmo-audit.md`
- `reports/latest-pmo-audit.html`
- `reports/index.html`
- `reports/index.json`

The JSON report also includes `stateSnapshot`, which is the Phase 2 machine-readable project state model used by later agent workflows.

Enable Phase 2 context enrichment when linked Feishu documents should be searched/read for missing project fields:

```bash
pnpm pmo:audit -- --date 2026-05-31 --dry-run --enrich-context
```

For local smoke tests, pass a document fixture instead of calling `lark-mcp`:

```bash
pnpm pmo:audit -- --date 2026-05-31 --dry-run \
  --stories-fixture tests/fixtures/stories.json \
  --docs-fixture tests/fixtures/docs.json \
  --enrich-context \
  --max-projects 0
```

When enabled, PMO Agent reads each story's linked Feishu docs, creates `feishu_doc` evidence, extracts candidate completions for goal, acceptance criteria, test plan, schedule, and next step, and stores them under each `storyAudit.context` plus `stateSnapshot.stories[].candidateCompletions`. It does not write those candidates back to Feishu Project; Phase 3 communication drafts ask the owner to confirm the candidate first.

Phase 3.5 low-disturbance communication controls are local and fail-closed:

- Human approval is required before any delivery attempt.
- Draft creation can map display names to Feishu `openId`/email/user id metadata via `personDirectory`.
- Default proactive touch policy is max 5 per person per day, same story no repeat within 24 hours, and quiet hours 22:00-10:00 Asia/Shanghai. Drafts may still be generated during quiet hours because they do not disturb anyone; real delivery is blocked during quiet hours.
- Suppressed drafts are recorded as `draft_suppressed` audit events with a reason such as `daily_budget_exhausted` or `repeat_story_window`.
- Check-in replies are stored in `reports/checkins.json`; parsed fields reduce the same story's missing next-step/schedule/stale-status risks in the next report and can create pending project-update actions in `reports/project-update-actions.json`.

Enable optional model analysis for a run after `ZAI_API_KEY` is configured:

```bash
curl -X POST http://localhost:3201/runs/agent-cycle \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-05-31","analyzeWithModels":true}'
```

This writes `reports/YYYY-MM-DD-pmo-model-analysis.json` and records an `analyze_with_models` stage. The daily summary uses `PMO_DAILY_MODEL`; deep risk analysis uses `PMO_RISK_MODEL`. The model credential is never written to reports.

Create a Feishu document report after both Feishu Project MCP and Feishu document output are authorized:

```bash
FEISHU_PROJECT_MCP_URL=https://project.feishu.cn/mcp_server/v1 \
pnpm pmo:audit -- --date 2026-05-31 --output feishu-doc
```

With `PMO_FEISHU_DOC_OUTPUT_MODE=openapi`, document creation uses Feishu OpenAPI `docx/v1/documents` and document block append APIs. Without that mode, `lark-mcp` document creation requires the Feishu app to have a user-identity document permission such as `docx:document`, `docs:doc`, or `drive:drive`. If Feishu returns `99991672`, open the app permission page from the error message, add a document/drive scope, publish the app permission change if required, then run `lark-mcp login` again with an explicit scope, for example `--scope "offline_access docx:document drive:drive docs:doc"`, so the refreshed token includes the new scope. The HTTP/z-mono agent cycle keeps Feishu document creation disabled by default; pass `createFeishuDoc: true` only after `pmo_preflight` confirms document output readiness.

## Safety Boundaries

The default implementation is still fail-closed for external writes.

- It does not send Feishu messages unless the draft is approved, `PMO_FEISHU_IM_DELIVERY_ENABLED=true`, a recipient mapping exists, and current time is outside quiet hours.
- It can call Feishu Project MCP write tools (`transition_node`, `add_comment`, `update_field`) through explicit wrappers, but generated writeback actions stay pending approval by default.
- It does not write GitLab comments.
- It only creates a Feishu document when `--output feishu-doc` is requested, or when the HTTP/z-mono agent cycle is explicitly called with `createFeishuDoc: true`.

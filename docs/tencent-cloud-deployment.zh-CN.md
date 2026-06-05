# PMO Agent 腾讯云部署说明

## 部署定位

PMO Agent 不是普通 `agent-hub` sandbox agent。它需要长期运行、定时核查、保存报告和审批队列，并持有 GitLab、飞书项目 MCP、飞书 OpenAPI、z.ai 等服务凭证。因此第一版建议作为**独立长期服务**部署到腾讯云，而不是放进按会话销毁的 sandbox。

与 `/Users/zhanghongliang/Documents/agent-hub` 对齐的约定：

| 项 | agent-hub 约定 | PMO Agent 做法 |
|---|---|---|
| 镜像仓库 | `maas-images-register.tencentcloudcr.com/wudao/<agent>` | `maas-images-register.tencentcloudcr.com/wudao/pmo-agent` |
| 构建镜像 | Node 22 builder | public `node:22-slim` builder |
| 运行端口 | sandbox agent 默认 `8080` | PMO action server 默认 `3201` |
| 持久化目录 | `/persistent/shared`、`/persistent/conversation` | `/persistent/reports` |
| 启动入口 | sandbox-base/s6 dispatcher | `node dist/src/cli/production.js`，同时启动 HTTP action server 和 scheduler worker |

## 镜像构建和推送

```bash
cd /Users/zhanghongliang/Documents/PMO\ agent/pmo_agent
bash deploy.sh
```

默认推送：

```text
maas-images-register.tencentcloudcr.com/wudao/pmo-agent:<git-sha>
maas-images-register.tencentcloudcr.com/wudao/pmo-agent:latest
```

如需切换 registry：

```bash
TENCENT_REGISTRY=<registry-host> bash deploy.sh
```

## 生产服务形态

容器默认执行：

```bash
node dist/src/cli/production.js
```

该入口会同时启动：

1. HTTP action server：默认监听 `PORT=3201`。
2. scheduler worker：按 `PMO_DAILY_RUN_AT` 检查是否需要运行日报。
3. ops 输出刷新：写入 `/persistent/reports` 下的报告、run 记录、worker 事件和告警。

健康检查：

```bash
curl http://<host>:3201/health
```

应返回：

```json
{"ok":true}
```

生产 preflight：

```bash
curl http://<host>:3201/preflight
```

如果 required 依赖失败，scheduler 默认不会执行 due run。

## 必要环境变量

生产环境建议显式配置：

```bash
NODE_ENV=production
PORT=3201
PMO_REPORTS_DIR=/persistent/reports
PMO_DAILY_RUN_AT=09:00
PMO_WORKER_TICK_MS=300000
PMO_WORKER_ENRICH_CONTEXT=true
PMO_WORKER_BUILD_PERSON_DIRECTORY=true
PMO_WORKER_CREATE_FEISHU_DOC=false
PMO_WORKER_CREATE_REPORT_DM_DRAFT=true
PMO_WORKER_ANALYZE_WITH_MODELS=false
PMO_WORKER_SKIP_PREFLIGHT=false
PMO_SERVE_REPORTS=true
PMO_HTTP_BASIC_AUTH=<username:password>
PMO_TENCENT_CLOUD_DEPLOYED=true
```

真实依赖凭证：

```bash
GITLAB_BASE_URL=https://dev.aminer.cn
GITLAB_GROUP=open-platform
GITLAB_TOKEN=<secret>

FEISHU_PROJECT_MCP_URL=https://project.feishu.cn/mcp_server/v1
FEISHU_PROJECT_MCP_TOKEN=<secret>
FEISHU_PROJECT_SPACE_NAME=MAAS_平台
FEISHU_PROJECT_SPACE_URL=https://project.feishu.cn/7358164361912909827_1719375156/story/homepage

FEISHU_APP_ID=<secret>
FEISHU_APP_SECRET=<secret>
# 或 FEISHU_TENANT_ACCESS_TOKEN=<secret>

ZAI_API_KEY=<secret>
ZAI_OPENAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
ZAI_ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
PMO_DAILY_MODEL=glm-5-turbo
PMO_RISK_MODEL=glm-5.1
PMO_FEISHU_DOC_OUTPUT_MODE=openapi
PMO_FEISHU_DOC_WEB_BASE_URL=https://zhipu-ai.feishu.cn/docx
```

日报单聊接收人：

```bash
PMO_DAILY_REPORT_RECIPIENT_NAME=张鸿亮
PMO_DAILY_REPORT_RECIPIENT_USER_ID=test-user-id
```

飞书项目字段映射见 `docs/feishu-project-field-mapping.zh-CN.md`。没有确认字段语义前，不建议打开自动字段写回。

## 持久化和可见输出

必须把 `/persistent/reports` 挂载为持久卷，否则重启后会丢失审批队列和历史报告。

关键输出：

| 文件 | 用途 |
|---|---|
| `latest-pmo-audit.html` | 最新 PMO 日报 |
| `ops-dashboard.html` | 运维入口：readiness、active alerts、runs、草稿、写回队列 |
| `ops-alerts.json` | 机器可读告警队列 |
| `worker-events.json` | worker 运行事件 |
| `runs.json` | 每次 agent cycle 的 stage 记录 |
| `communication-drafts.json` | 待审批沟通/日报投递草稿 |
| `communication-draft-audit.json` | 草稿审批/拒绝/发送审计 |
| `checkins.json` | 沟通回复闭环记录 |
| `project-update-actions.json` | 待审批飞书项目写回动作 |
| `live-validation.json` | 非敏感 live 验收事实，供 `pmo:acceptance` 判断是否 9/9 完成 |

## 公网访问保护

当前服务只建议临时开放公网用于验收。若 `PMO_SERVE_REPORTS=true`，必须同时配置：

```bash
PMO_HTTP_BASIC_AUTH=<username:password>
```

启用后：

- `GET /health` 保持公开，供健康检查使用。
- `/reports/*`、`/preflight`、`/runs/*`、`/drafts/*`、`/project-update-actions/*` 等都需要 Basic Auth。
- 后续正式生产建议再叠加腾讯云防火墙来源 IP 限制、VPN/Tailscale 或 Nginx/HTTPS。

## 推荐验收顺序

1. 部署容器，但保持：
   - `PMO_WORKER_CREATE_FEISHU_DOC=false`
   - `PMO_FEISHU_IM_DELIVERY_ENABLED=false`
   - `PMO_WORKER_ANALYZE_WITH_MODELS=false`
2. 访问 `/health`。
3. 访问 `/preflight`，确认 GitLab 和 Feishu Project MCP 通过。
4. 手动触发一次：

```bash
curl -X POST http://<host>:3201/runs/agent-cycle \
  -H 'Content-Type: application/json' \
  -d '{
    "date": "2026-06-02",
    "enrichContext": true,
    "buildPersonDirectory": true,
    "createCommunicationDrafts": true,
    "createReportDeliveryDraft": true
  }'
```

5. 打开 `/persistent/reports/ops-dashboard.html`，确认 run、草稿、告警都可见。
6. 配置 Feishu OpenAPI 后再打开 `PMO_WORKER_CREATE_FEISHU_DOC=true`。OpenAPI 文档输出会把 Markdown 表格转换为飞书原生表格，并自动拆分超大表。
7. 完成 Feishu OpenAPI IM 权限和一次 approved dry-run 后，再打开 `PMO_FEISHU_IM_DELIVERY_ENABLED=true`。
8. 完成 z.ai key 配置和模型 smoke 后，再打开 `PMO_WORKER_ANALYZE_WITH_MODELS=true`。
9. 写入非敏感 live 验收事实后运行 acceptance：

```bash
sudo docker run --rm --env-file /opt/pmo_agent/.env.production \
  -v /persistent/reports:/persistent/reports \
  pmo-agent:latest node dist/src/cli/acceptance.js \
  --reportsDir /persistent/reports --write
```

期望结果：

```json
{"summary":{"total":9,"complete":9,"pending":0,"blocked":0}}
```

## 告警处理

当前告警不是外部推送，而是写入本地可见产物：

- `ops-dashboard.html` 的 `Active Alerts`
- `ops-alerts.json`

已覆盖：

- preflight 失败
- run 失败
- stage 失败
- worker error / preflight blocked
- 项目写回待审批积压
- 沟通草稿待审批积压

后续如果需要接入企业告警系统，可以从 `ops-alerts.json` 读取 active alerts，再投递到 Grafana/飞书群/内部告警平台。

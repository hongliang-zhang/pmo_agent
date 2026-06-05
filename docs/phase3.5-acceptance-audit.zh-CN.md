# PMO Agent Phase 3.5 验收审计

审计时间：2026-06-02。

本文件记录 Phase 3.5 目标的当前真实验收状态。结论以当前代码、测试、云上运行结果和 live 依赖状态为准。

## 结论

Phase 3.5 已完成并通过验收：

- `9/9` 项目标完成。
- `0` 项待 live 验证。
- `0` 项 blocked。
- 腾讯云服务已长期运行，容器名 `pmo-agent-prod`，`--restart unless-stopped`。
- 云上报告目录为 `/persistent/reports`。
- 云上健康检查为 `http://<server-ip>/health`。
- 报告/API 已启用 Basic Auth；`/health` 保持公开。

## Live Readiness

最近云上 preflight 结果：

| 检查项 | 状态 | 说明 |
|---|---|---|
| GitLab open-platform | PASS | 已连接，可读取 `92` 个 projects。 |
| Feishu Project MCP | PASS | 已连接，可读取 `MAAS_平台` `50` 个 active stories。 |
| Feishu document output | PASS | OpenAPI 模式已创建完整日报飞书文档；原生表格验证通过。 |
| z.ai models | PASS | provider 为 z.ai；日报模型 `glm-5-turbo`，风险模型 `glm-5.1`。 |
| Feishu OpenAPI Contacts/IM | PASS | OpenAPI credential 可用；云上 agent cycle 映射 `30` 人。 |
| Feishu IM delivery | PASS | 已完成一次 approved daily report DM 真实发送；生产定时任务仍默认不自动发送，继续遵守人工审批。 |
| scheduler | PASS | 云上 worker 已启动，写入 `/persistent/reports/worker-events.json` 和 ops dashboard。 |

## Live Validation Evidence

非敏感 live 验收事实写入：

- 本地：[reports/live-validation.json](/Users/zhanghongliang/Documents/PMO%20agent/pmo_agent/reports/live-validation.json)
- 云上：`/persistent/reports/live-validation.json`

关键事实：

| 项 | 证据 |
|---|---|
| 腾讯云已部署 | `tencentCloudDeployed=true` |
| 云上健康检查通过 | `http://<server-ip>/health` 返回 `{"ok":true}` |
| 云上 preflight 通过 | `tencentCloudPreflightPassed=true` |
| 生产 scheduler 运行 | `productionSchedulerRunning=true` |
| Basic Auth 已启用 | 未认证访问报告/API 返回 `401`，带认证返回 `200` |
| 飞书单聊 live 发送 | `feishuImSent=true`，时间 `2026-06-02T10:39:45.795Z` |
| 飞书文档 live 输出 | `https://zhipu-ai.feishu.cn/docx/L6UQdVp1ioFg9nxg6BJcKJSknut` |
| 飞书文档原生表格 | OpenAPI 反查 `27` 个 table block、`4904` 个 table cell block |

## 目标逐项验收

| # | 目标 | 状态 | 证据 |
|---:|---|---|---|
| 1 | 人员映射来源：飞书通讯录 API + 飞书项目 MCP 人员字段，按邮箱等对应 | 完成 | `src/people/directory.ts`；`tests/person-directory.test.ts`；云上 cycle `people=30`、`mappedForDelivery=30` |
| 2 | 默认打扰策略：每人每天 <=5、同需求 24h 不重复、quiet hours 22:00-10:00 | 完成 | `src/server/drafts.ts`；`tests/drafts.test.ts` |
| 3 | 消息发送：允许私聊/群消息，第一版必须人工审批 | 完成 | `src/server/delivery.ts`；`tests/delivery.test.ts`；approved 后真实 Feishu IM 已发送 |
| 4 | 飞书项目回写：评论、目标/测试计划/下一步字段、状态；live case `7005303241` 到需求评审并评论 | 完成 | `src/feishu/project-mcp.ts`；`src/server/project-updates.ts`；`tests/project-updates.test.ts`；live case 已执行 |
| 5 | 部署方式：腾讯云服务，参考 agent-hub | 完成 | `Dockerfile`；`src/cli/production.ts`；`docs/tencent-cloud-deployment.zh-CN.md`；云上容器运行 |
| 6 | 报告接收位置：HTML、飞书文档、飞书单聊给张鸿亮 | 完成 | 云上 HTML；飞书文档 `L6UQdVp1ioFg9nxg6BJcKJSknut`；飞书单聊 live sent |
| 7 | 回复自动进入闭环：影响下一轮风险、关闭草稿、生成项目字段更新动作 | 完成 | `src/server/checkins.ts`；`src/server/project-updates.ts`；`tests/checkins.test.ts` |
| 8 | 生产调度部署：长期运行、定时器、日志、告警、可见输出 | 完成 | `src/cli/production.ts`；`src/server/worker.ts`；云上 `ops-dashboard.html`、`approval-center.html`、`ops-alerts.json`、`worker-events.json` |
| 9 | 报告内容精调：调研并给出优质 PM 方法论结构 | 完成 | `docs/pmo-report-methodology.zh-CN.md`；`src/render/markdown.ts`；`tests/renderer.test.ts` |

## 云上入口

需要 Basic Auth 的入口：

- 最新日报 HTML：`http://<server-ip>/reports/latest-pmo-audit.html`
- 运维面板：`http://<server-ip>/reports/ops-dashboard.html`
- 审批中心：`http://<server-ip>/reports/approval-center.html`
- Acceptance：`http://<server-ip>/reports/phase3.5-acceptance.html` 暂未生成 HTML，可查看 `phase3.5-acceptance.md/json`。

公开入口：

- 健康检查：`http://<server-ip>/health`

## 已验证命令

本地：

```bash
pnpm vitest run tests/acceptance-cli.test.ts
pnpm test
pnpm build
pnpm pmo:acceptance -- --reportsDir reports --write
```

结果：

- `39` 个测试文件通过。
- `115` 个测试通过。
- TypeScript build 通过。
- Acceptance：`9/9 complete`。

云上：

```bash
sudo docker ps --filter name=pmo-agent-prod
sudo docker run --rm --env-file /opt/pmo_agent/.env.production \
  -v /persistent/reports:/persistent/reports \
  pmo-agent:latest node dist/src/cli/acceptance.js --reportsDir /persistent/reports --write
```

结果：

- `pmo-agent-prod` 正常运行。
- Acceptance：`9/9 complete`。

## 后续建议

Phase 3.5 已完成。后续不属于本阶段验收阻塞项，但建议进入下一阶段：

1. 绑定域名和 HTTPS，替代公网 IP。
2. 用腾讯云防火墙或 VPN 限制访问来源。
3. 将飞书 IM 的真实发送继续保持人工审批，按次开启或通过审批中心触发。
4. 将报告质量调优进入下一阶段：减少风险表噪声，按目标/里程碑/阻塞聚类，而不是单纯列出所有缺失字段。

# PMO Agent Web UI 与飞书 Bot 使用说明

## 入口

- Web 控制台：`https://pmo.hongliang.app/app`
- 风险分诊：`https://pmo.hongliang.app/app/risks`
- 需求视图：`https://pmo.hongliang.app/app/stories`
- 人员视图：`https://pmo.hongliang.app/app/people`
- 运行记录：`https://pmo.hongliang.app/app/runs`
- 审批中心：`https://pmo.hongliang.app/app/approvals`
- 设置与权限状态：`https://pmo.hongliang.app/app/settings`
- Agent 对话说明：`https://pmo.hongliang.app/app/agent`
- 最新日报：`https://pmo.hongliang.app/reports/latest-pmo-audit.html`
- 报告索引：`https://pmo.hongliang.app/reports/index.html`
- 健康检查：`https://pmo.hongliang.app/health`

除健康检查外，Web 入口都使用 HTTP Basic Auth。当前线上用户名和密码由服务器环境变量 `PMO_HTTP_BASIC_AUTH` 控制。

## Web 控制台能力

Web 控制台从本地报告目录读取真实产物，不额外引入数据库。

- 总览：展示聚焦需求、今日有进展、风险需求、P0/P1 风险、建议沟通、近期交付证据。
- 报告：展示历史日报 HTML、Markdown、JSON 入口。
- 风险：展示风险优先级、需求、风险说明、建议动作、建议联系人。
- 需求：展示需求状态、负责人、健康、风险数、证据数和下一步线索。
- 人员：按人聚合相关需求、风险数量、建议沟通数量和首要问题。
- 交付证据：展示 GitLab MR、commit、pipeline 等证据，并标记是否已关联飞书需求。
- 审批：展示沟通草稿、待审批沟通、待审批项目字段更新。
- 运行：展示日报/agent cycle 运行记录和报告产物入口。
- 运维：展示 ops alerts、Bot webhook 审计、worker 事件和失败运行。
- 设置：只读展示数据源、能力边界、访问控制和产物状态。
- Agent：展示自然语言入口的能力、示例和安全边界。

## Agent 问答能力

Web 控制台右侧的“问 PMO”和飞书 Bot 复用同一套规则型问答逻辑。当前支持：

- `最新日报`
- `今天有哪些风险？`
- `谁需要沟通？`
- `王建辉在做什么？`
- `代码有进展但需求没同步的有哪些？`
- `服务健康怎么样？`
- `下一步怎么推进？`

所有结论来自最新日报 JSON、运行记录、审批中心、草稿、Bot 审计和 ops 数据。高风险动作只会生成草稿或进入审批，不会直接发送飞书消息，也不会直接修改飞书项目字段。

## 飞书 Bot 命令

飞书 Bot 保留明确命令：

- `帮助`
- `最新日报`
- `健康`
- `生成日报 YYYY-MM-DD`

也支持自然语言问答，例如：

- `今天有哪些风险？`
- `建议沟通清单`
- `代码有进展但需求没同步的有哪些？`

Bot 使用飞书事件用户白名单和可选群白名单限制访问。未在白名单内的用户不会得到 PMO 数据。

## 本地验证

```bash
pnpm build
pnpm test
PMO_SERVE_REPORTS=true PMO_HTTP_BASIC_AUTH='USER:PASSWORD' PMO_REPORTS_DIR=reports PMO_PUBLIC_BASE_URL='http://127.0.0.1:3201' pnpm pmo:serve-actions -- --port 3201
```

然后打开：

```text
http://127.0.0.1:3201/app
```

## 线上验证

```bash
curl -I https://pmo.hongliang.app/health
curl -u 'USER:PASSWORD' -I https://pmo.hongliang.app/app
curl -u 'USER:PASSWORD' https://pmo.hongliang.app/api/app/state
```

如果公网 `https://pmo.hongliang.app` TLS 握手失败，但服务器本机下面这些命令正常，则问题不在 PMO Agent 应用层，而在公网 443 / 云访问层 / 域名代理层：

```bash
curl -i http://127.0.0.1:3201/health
curl --resolve pmo.hongliang.app:443:127.0.0.1 -k -u 'USER:PASSWORD' https://pmo.hongliang.app/app/settings
```

这时优先检查腾讯云轻量服务器防火墙/安全组是否放通 HTTPS、域名是否被备案或云防护策略拦截、Cloudflare 是否需要开启代理或调整 SSL 模式。

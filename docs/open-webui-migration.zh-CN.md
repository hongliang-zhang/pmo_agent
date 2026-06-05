# PMO Agent 迁移到 Open WebUI

## 目标

把自研 `/app` 聊天入口迁移为 Open WebUI。PMO Agent 继续负责读取飞书项目、GitLab、报告和审批数据；Open WebUI 负责账号、会话、模型选择、聊天体验和后续团队成员访问控制。

## 架构

- `open-webui`：对外 Web UI，运行在容器内 `8080`，宿主机只监听 `127.0.0.1:3000`。
- `pmo-agent`：PMO 后端服务，运行在容器内 `3201`，暴露 OpenAI-compatible 接口：
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- `Nginx`：公网入口，`https://pmo.hongliang.app/` 反代到 `open-webui:3000`；保留 `/health`、`/reports/` 等 PMO 运维入口时再按路径反代到 `pmo-agent:3201`。

## 为什么这样做

Open WebUI 官方推荐通过 OpenAI-compatible Chat Completions 连接外部模型。PMO Agent 现在已经实现这一层，因此 Open WebUI 会把 `pmo-agent` 当作一个可选模型使用，而不是再维护单独的聊天前端。

参考：

- Open WebUI 支持 OpenAI-compatible API：`https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/`
- Open WebUI Docker 快速启动：`https://docs.openwebui.com/`
- Open WebUI 环境变量：`https://docs.openwebui.com/getting-started/env-configuration/`

## 本地验证

```bash
pnpm test -- openai-compatible
pnpm build
PMO_REPORTS_DIR=reports PMO_OPENAI_API_KEY=local-test pnpm pmo:prod
curl -H 'Authorization: Bearer local-test' http://127.0.0.1:3201/v1/models
```

## 部署步骤

1. 在服务器放置 `.env.production`，必须包含现有 GitLab、飞书、模型配置，并新增：

```bash
PMO_OPENAI_API_KEY=<生成一个随机长 token>
WEBUI_ADMIN_EMAIL=<首个管理员邮箱>
WEBUI_ADMIN_PASSWORD=<首个管理员密码>
```

2. 启动容器：

```bash
docker compose --env-file .env.production -f docker-compose.openwebui.yml up -d --build
```

3. 配置 Nginx：

```nginx
server {
  listen 80;
  server_name pmo.hongliang.app;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name pmo.hongliang.app;

  ssl_certificate /etc/letsencrypt/live/pmo.hongliang.app/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/pmo.hongliang.app/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  location = /health {
    proxy_pass http://127.0.0.1:3201/health;
  }
}
```

4. 打开 `https://pmo.hongliang.app`，创建第一个管理员账号。后续把允许使用的人加入 Open WebUI 用户列表或开启企业 SSO。

## 访问控制

- Open WebUI 层：关闭公开注册，团队成员由管理员创建或审核。
- PMO OpenAI-compatible 层：使用 `PMO_OPENAI_API_KEY`，只让 Open WebUI 容器持有。
- PMO 运维入口：`/health` 可公开，报告和管理 API 应继续加 Basic Auth 或只走内网。

## 后续增强

- 把日报生成、审批、草稿发送等动作作为 Open WebUI Tools 暴露，默认只读，写操作必须审批。
- 为 PMO Agent 增加真正的多轮上下文，而不是只取最后一条用户消息。
- 把 `/app` 自研前端标记为 legacy，等 Open WebUI 验收稳定后再下线。

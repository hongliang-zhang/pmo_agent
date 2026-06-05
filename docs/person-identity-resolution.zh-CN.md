# PMO Agent 人员身份解析规则

## 目标

PMO Agent 不应该在日报和 Web UI 里直接展示 GitLab 哈希用户名、拼音用户名或系统账号。只要能从飞书项目或飞书通讯录找到人员信息，就应展示中文姓名，并保留 GitLab 原始账号作为证据来源。

## 典型案例

`666a3d38` 是 GitLab MR author username；GitLab MR author name 为 `xiaxueyan`。仅靠 MR 接口无法得到中文名。

正确解析链路：

1. 从 GitLab MR 得到 `author.username = 666a3d38`、`author.name = xiaxueyan`。
2. 从同时间窗口 GitLab commit 得到 `author_name = xiaxueyan`、`author_email = xueyan.xia@aminer.cn`。
3. 用 `xueyan.xia@aminer.cn` 调飞书项目 MCP `search_user_info`。
4. 飞书项目 MCP 返回 `name_cn = 夏雪妍`、`user_key`、`lark_user_id`。
5. 日报和 Web UI 展示 `夏雪妍`，metadata 保留 `authorUsername = 666a3d38`、`authorEmail = xueyan.xia@aminer.cn`、`identitySource = feishu_project_email`。

## 解析优先级

1. GitLab commit email + 飞书项目 MCP `search_user_info` 邮箱匹配。
2. GitLab evidence metadata 中已有 `authorName` 且为中文名。
3. 飞书项目需求 owner/creator email 与 GitLab `authorEmail` 匹配。
4. 明确维护的人工 alias，用于历史报告或缺失 commit email 的账号。
5. GitLab `author.name`。
6. GitLab `author.username`。

不得把时间相近、名字相似、需求相关但邮箱不一致的人强行合并。例如 `xiaxueyan / xueyan.xia@aminer.cn` 不能映射为 `高严 / yan.gao@aminer.cn`。

## 使用的接口

GitLab：

- MR：`GET /api/v4/projects/:id/merge_requests`
- Commit：`GET /api/v4/projects/:id/repository/commits`

飞书项目 MCP：

- MCP endpoint：`https://project.feishu.cn/mcp_server/v1`
- Tool：`search_user_info`
- 入参：`project_key`、`user_keys`
- 推荐 `user_keys`：优先传 GitLab commit email。

飞书通讯录 OpenAPI：

- `POST /contact/v3/users/batch_get_id`
- 用于补 open_id/user_id/union_id，主要服务飞书 IM 发送。
- 当前不作为中文姓名主来源，因为该接口可能只返回 email/id，不保证返回 `name_cn`。

## 失败降级

- 如果 GitLab 找不到 commit email：保留 GitLab `author.name`，metadata 标记 `identitySource = gitlab_author`。
- 如果飞书项目 MCP 查询失败：保留 GitLab 名称，metadata 写入 `identityResolutionError`。
- 如果飞书项目 MCP 只返回 email、不返回 `name_cn`：保留 GitLab 名称，不做错误合并。
- 如果人工 alias 与邮箱匹配结果冲突：以邮箱匹配结果为准。

## 当前实现

- `src/identity/gitlab-feishu.ts`
  - `attachGitLabEmailsFromCommits`：用 commit authorName/email 给 MR 补 authorEmail。
  - `enrichGitLabEvidenceAuthors`：用飞书项目 MCP 按邮箱查中文名并写回 Evidence。
- `src/feishu/project-mcp.ts`
  - `normalizeProjectUser` 优先读取 `name_cn`。
- `src/cli/daily-audit.ts` 和 `src/actions/bridge.ts`
  - 日报生成和服务端运行链路都调用身份解析。
- `src/server/app-data.ts`
  - 保留少量历史 alias，兼容旧 JSON 报告。

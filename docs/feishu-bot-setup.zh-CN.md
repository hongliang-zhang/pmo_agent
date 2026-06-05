# PMO Agent 飞书 Bot 接入说明

## 目标

让 PMO Agent 作为飞书 Bot 被授权人员访问。第一版只提供只读和低风险操作：

- `帮助`
- `最新日报`
- `健康`
- `生成日报 YYYY-MM-DD`

Bot 不会自动更新飞书项目字段，不会绕过审批中心发送催办消息。

## 服务入口

线上事件订阅地址：

```text
https://pmo.hongliang.app/feishu/events
```

这个入口不使用网站 Basic Auth。安全控制由飞书事件 Verification Token、可选签名校验、用户/群白名单共同完成。

## 飞书开放平台配置

1. 进入飞书开放平台应用后台。
2. 打开「事件订阅」。
3. 请求地址填：

```text
https://pmo.hongliang.app/feishu/events
```

4. 设置 Verification Token，并同步写入服务端环境变量：

```env
PMO_FEISHU_EVENT_VERIFICATION_TOKEN=你的飞书事件 Verification Token
```

5. 第一版先不要开启 Encrypt Key 加密投递。如果已开启，需要先关闭；当前服务会拒绝 `encrypt` payload，避免误处理不可读事件。
6. 订阅事件：

```text
im.message.receive_v1
```

7. 确认应用具备发送消息权限。当前已验证 PMO Agent 可以通过 Feishu OpenAPI 给你发送 IM。

## 服务端白名单

至少配置一个用户白名单。支持 user_id、open_id、union_id：

```env
PMO_FEISHU_BOT_ALLOWED_USER_IDS=test-user-id
PMO_FEISHU_BOT_ALLOWED_OPEN_IDS=
PMO_FEISHU_BOT_ALLOWED_UNION_IDS=
```

如果要允许群聊使用，再配置群 ID：

```env
PMO_FEISHU_BOT_ALLOWED_CHAT_IDS=oc_xxx,oc_yyy
PMO_FEISHU_BOT_OPEN_ID=ou_xxx
PMO_FEISHU_BOT_USER_ID=
```

当配置了群白名单时，群消息必须同时满足：

- 发送人命中用户白名单。
- 群 ID 命中群白名单。
- 群消息里 @ 了 Bot。若配置了 `PMO_FEISHU_BOT_OPEN_ID` 或 `PMO_FEISHU_BOT_USER_ID`，则必须命中该 Bot 身份。

默认未授权用户会被静默忽略。如需回复无权限提示：

```env
PMO_FEISHU_BOT_DENY_REPLY=true
```

## 当前命令

| 命令 | 行为 | 风险级别 |
|---|---|---|
| `帮助` | 返回可用命令 | 低 |
| `最新日报` | 返回日报、索引、运行面板、审批中心链接 | 低 |
| `健康` | 返回 health 和最新日报入口 | 低 |
| `生成日报 2026-06-02` | 触发指定日期日报生成，输出本地 HTML/JSON/MD | 中 |

`生成日报` 会读取飞书项目、GitLab 和本地配置，可能耗时较长。它不会写飞书项目字段，也不会自动发催办消息。

服务端会按飞书 `event_id` 做进程内去重，避免飞书重试时重复回复或重复触发日报生成。容器重启后去重缓存会清空。

## 验证步骤

1. 飞书事件订阅后台点击「保存」或「验证」，应通过 challenge 校验。
2. 给 Bot 私聊发送：

```text
帮助
```

3. 发送：

```text
最新日报
```

应收到 `https://pmo.hongliang.app/reports/latest-pmo-audit.html` 等链接。

4. 发送：

```text
生成日报 2026-06-02
```

应生成指定日期日报，并返回报告链接。

## 后续增强

- 支持群聊中仅在 @Bot 时响应。
- 支持事件去重，避免飞书重试导致重复生成日报。
- 支持加密事件 payload 解密。
- 支持长任务异步队列，先回「已开始」，完成后再回结果。
- 支持审批中心动作：批准/拒绝草稿、批准/拒绝项目字段写回。

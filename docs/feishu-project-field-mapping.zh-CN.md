# MAAS_平台飞书项目字段映射

## 目的

PMO Agent 可以在人工审批后写回飞书项目，但字段写回必须使用飞书项目真实字段 key。字段 key 不属于 secret，可以写入配置；MCP token、OpenAPI token、模型 key 不能写入文档或报告。

## 已探测字段

探测时间：2026-06-02。

工具：飞书项目 MCP `list_workitem_field_config`。

空间：`MAAS_平台`。

工作项类型：`story` / `需求`。

| 逻辑字段 | 建议字段 key | 飞书字段名 | 当前判断 |
|---|---|---|---|
| 目标 | `description` | 描述 | 可作为需求目标/背景的第一版承载字段；写回前建议人工确认不会覆盖已有描述。 |
| 测试计划 | `field_7f3085` | 测试方式 | 飞书项目里没有名为“测试计划”的字段；当前只有“测试方式”，可作为第一版候选，但不应自动写入，需审批。 |
| 下一步 | 暂无 | 暂无 | 未发现明确“下一步”字段；第一版建议通过评论记录，或后续新增字段。 |
| 排期/截止时间 | `schedule` 或 `field_810cee` | 排期 / 计划完成时间 | `schedule` 是系统排期字段，`field_810cee` 是计划完成时间；实际写回格式需 live smoke 验证。 |
| 状态 | `work_item_status` | 需求状态 | 状态流转应优先使用 `transition_node`，不要默认通过 `update_field` 改状态。 |

## 建议 `.env.local` 配置

在确认字段语义和更新格式后再启用：

```bash
PMO_FEISHU_FIELD_GOAL=description
PMO_FEISHU_FIELD_TEST_PLAN=field_7f3085
PMO_FEISHU_FIELD_NEXT_STEP=
PMO_FEISHU_FIELD_DUE_DATE=field_810cee
PMO_FEISHU_FIELD_STATUS=
```

## 写回原则

1. 所有 agent 生成的字段写回先进入 `Project Writeback Queue`。
2. 必须由用户审批后，才能调用 `POST /project-update-actions/apply`。
3. 缺少字段 key 的逻辑字段不会被写入；如果一个写回动作没有任何可映射字段，执行会失败并提示配置缺失。
4. 状态更新优先走节点流转，已验证 `7005303241` 可以流转到 `需求评审` 并写评论。
5. 对可能覆盖长文本的字段，例如 `description`，审批时应确认“追加”还是“覆盖”；当前 `update_field` 封装按字段值更新，不做自动合并。

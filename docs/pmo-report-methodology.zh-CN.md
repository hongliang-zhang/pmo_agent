# PMO 状态核查报告结构方法论

## 调研来源

本方法论结合了以下公开项目管理实践，并按 MAAS 平台的实际数据源和低打扰要求做了裁剪：

| 来源 | 采用点 | 对 PMO Agent 的落地 |
|---|---|---|
| Atlassian / Confluence 项目状态报告实践 | 用统一模板表达项目健康度、近期进展、风险、blocker、时间线和下一步 | 报告先给 Executive Snapshot，再给 portfolio/workstream，再给明细 |
| Asana 项目状态报告实践 | 关注 health、accomplishments、blockers、risks、next steps，并减少手工整理 | 从飞书项目、GitLab、飞书文档和 check-in 自动生成 |
| PMI / PMBOK 风险与问题管理思路 | 风险/问题要记录 owner、影响、响应动作、升级路径 | 风险表必须包含严重度、影响、建议动作、找谁 |
| RAID log 实践 | Risks、Assumptions、Issues、Dependencies/Decisions 分开管理 | 将风险、问题、决策缺口、数据质量问题合并进入 RID 表，但保留类型 |
| 软件交付状态报告实践 | 状态不能只看主观汇报，需要结合代码、CI、review、文档证据 | 每条结论必须带 evidence 或 confidence，不把推断写成事实 |

参考链接：

- [Atlassian: Project status report template](https://www.atlassian.com/software/confluence/templates/project-status)
- [Atlassian: How to write a project status report](https://www.atlassian.com/work-management/project-management/project-status-report)
- [Asana: Project status reports](https://asana.com/resources/project-status-report)
- [PMI: Risk management](https://www.pmi.org/learning/library/risk-management-approach-projects-8345)
- [APM: RAID log](https://www.apm.org.uk/resources/what-is-project-management/what-is-a-raid-log/)

## 设计结论

PMO Agent 的日报不应该只是“列事实”，而应帮助管理动作发生。第一阶段的报告必须同时回答四个问题：

1. **现在整体健康吗？**  
   用 Green / Yellow / Red 表达组合健康度，并说明触发原因。

2. **今天/本轮真正变化了什么？**  
   只突出状态变化、交付证据、风险变化、信息补齐，不把全量需求流水账放在前面。

3. **哪些事需要人处理？**  
   风险、信息缺失、待审批沟通、待审批写回必须都有 owner、建议动作和证据来源。

4. **哪些事不该打扰？**  
   少打扰不是隐藏信息，而是明确记录“已有证据、暂无风险、无需追问”的判断。

## 推荐报告结构

### 1. Executive Snapshot

面向管理者，一屏内读完。

| 字段 | 含义 |
|---|---|
| 总体健康度 | Green / Yellow / Red |
| 关键变化 | 本轮状态、风险、交付证据的变化 |
| 需要审批 | 待发送 IM、待写飞书项目字段、待创建飞书文档 |
| 需要介入 | 跨团队依赖、目标不清、长期缺 owner、阻塞 |
| 不需要打扰 | 证据充分且已有 owner/下一步/时间的事项 |

排序规则：

1. Red > Yellow > Green。
2. 高风险和阻塞先于普通信息缺失。
3. 需要用户审批的动作先于可观察信息。

### 2. Portfolio Health

按工作流/产品域聚合，而不是直接铺开所有需求。

| 工作流 | 健康度 | 需求数 | 活跃/完成 | 风险 | 阻塞 |
|---|---|---:|---:|---:|---:|

健康度规则：

- Red：存在 high 风险、CI failed、MR blocked、长期缺 owner/目标/排期。
- Yellow：存在 medium 风险、信息缺失、状态滞后。
- Green：有 owner、有下一步、有时间、有证据，且没有未处理风险。

### 3. Progress Since Last Report

只展示有证据的进展。

| 需求 | 当前状态 | 负责人 | 证据数 | 进展摘要 | 置信度 |
|---|---|---|---:|---|---|

证据优先级：

1. 飞书项目字段/状态变更。
2. GitLab MR / commit / pipeline。
3. 飞书文档中的方案、测试计划、时间。
4. 飞书评论或人工 check-in 回复。
5. Agent 推断。

### 4. Risks, Issues, Decisions

风险表必须可行动。

| 类型 | 需求 | 严重度 | 触发证据 | 影响 | 建议动作 | 找谁 |
|---|---|---|---|---|---|---|

类型定义：

- `Risk`：还未发生，但可能影响交付。
- `Issue`：已经发生，正在影响交付，例如 CI failed、MR blocked。
- `Decision`：缺少明确决策导致推进困难。
- `Data Quality`：目标、owner、排期、测试计划、下一步缺失。

PMO Agent 当前以 risk type 承载分类，后续可以扩展为更显式的 `riskCategory`。

### 5. Missing Information

信息缺失必须说明“已查哪里”和“下一步找谁”。

| 需求 | 缺失信息 | 已查来源 | 候选结论 | 建议处理 | 找谁 |
|---|---|---|---|---|---|

候选结论来源：

- 飞书文档抽取出的目标、测试计划、下一步、排期。
- 最近 check-in 回复。
- GitLab MR title/body/commit message 中可推断的信息。

如果只是推断，必须保留 `待确认`，不能直接写成事实。

### 6. Communication Queue

主动触达必须低打扰、可审批。

| 人 | 渠道 | 需求 | 问题 | 为什么问 | 优先级 | 策略状态 | 是否需审批 |
|---|---|---|---|---|---|---|---|

策略状态：

- `allowed`
- `quiet_hours_suppressed`
- `daily_budget_exhausted`
- `repeat_story_window`
- `auto_closed_by_reply`

默认策略：

- 每人每天主动触达不超过 5 次。
- 同一需求 24 小时不重复追问。
- quiet hours：22:00-10:00。
- 被动回复不计入主动触达次数。

### 7. Project Writeback Queue

所有写飞书项目动作都必须可审计。

| 需求 | 字段 | 候选值 | 来源 | 置信度 | 状态 |
|---|---|---|---|---|---|

写回边界：

- 写评论：允许。
- 更新目标/测试计划/下一步字段：允许，但必须审批。
- 更新状态：允许，但优先走节点流转 `transition_node`。
- 自动写回默认关闭；只执行已审批动作。

### 8. Delivery Evidence

GitLab 证据分为“匹配需求”和“孤立进展”。

| 类型 | 标题 | 作者 | 时间 | 置信度 |
|---|---|---|---|---|

孤立进展不是坏事，但需要被 PMO 看到：

- 可能是飞书项目没建需求。
- 可能是 MR/commit 没带需求 ID。
- 可能是需求标题与代码标题不一致。

### 9. No-Disturb Decisions

少打扰事项必须显式列出。

展示条件：

- 需求有 owner。
- 有下一步或可确认的最近进展。
- 有时间/排期或暂无交付风险。
- 最近没有 high risk 或阻塞证据。

### 10. Appendix

保留机器可追溯信息：

- 原始证据链接。
- 模型分析摘要。
- check-in 原文。
- 草稿审批/拒绝/发送审计。
- worker 运行日志和 active alerts。

## 对当前 PMO Agent 的落地要求

1. Markdown、HTML、飞书文档保持同构章节，避免不同渠道看到不同结论。
2. 每条结论必须带证据或置信度。
3. 所有主动 IM 必须先进入 Communication Queue，人工审批后才能发送。
4. 所有飞书项目写回必须先进入 Project Writeback Queue，除非用户明确指定单条 live case。
5. Check-in 回复必须影响下一轮报告：关闭草稿、降低已补齐字段风险、生成待审批写回动作。
6. Ops Dashboard 必须展示 active alerts，避免生产问题只藏在日志里。

## 当前实现对照

| 章节 | 当前状态 |
|---|---|
| Executive Snapshot | 已实现 |
| Portfolio Health | 已实现 |
| Progress Since Last Report | 已实现 |
| Risks, Issues, Decisions | 已实现类型、严重度、证据、动作、找谁 |
| Missing Information | 已实现缺失项、已查来源、候选结论、建议处理、找谁 |
| Communication Queue | 已实现渠道、策略状态、审批标记 |
| Project Writeback Queue | 已实现候选写回队列 |
| Delivery Evidence | 已实现 GitLab 证据和孤立进展 |
| No-Disturb Decisions | 已实现 |
| Appendix | 已实现 |

import type { AuditReport, Evidence, StoryAudit, SuggestedContact } from '../domain.js'

export function renderAuditMarkdown(report: AuditReport): string {
  return [
    `# ${report.title}`,
    '',
    `日期：${report.date}`,
    '范围：飞书项目 MAAS_平台 + GitLab open-platform',
    '',
    '## 1. 今日结论摘要',
    '',
    renderExecutiveSnapshot(report),
    '',
    '## 2. 需要关注的风险',
    '',
    renderRiskTable(report.riskyStories),
    '',
    '## 3. 今日/本周实质进展',
    '',
    renderStoryTable(report.progressedStories),
    '',
    '## 4. 代码有进展但需求未同步',
    '',
    renderEvidenceTable(report.isolatedEvidence),
    '',
    '## 5. 需求有变化但代码无交付证据',
    '',
    '暂无。',
    '',
    '## 6. 信息维护缺口',
    '',
    renderMissingTable(report.incompleteStories),
    '',
    '## 7. 建议沟通清单',
    '',
    renderContactTable(report.suggestedContacts),
    '',
    '## 8. 可以不打扰的事项',
    '',
    report.noNeedToDisturb.length
      ? report.noNeedToDisturb.map(item => `- ${link(item.story.title, item.story.url)}：${escapeCell(noDisturbReason(item))}`).join('\n')
      : '- 暂无。',
    '',
    '## 9. 附录',
    '',
    '### 9.1 工作流健康',
    '',
    renderStateSnapshot(report),
    '',
    '### 9.2 飞书项目写回候选',
    '',
    renderProjectWritebackQueue(report),
    '',
    '### 9.3 GitLab 证据摘要',
    '',
    renderEvidenceTable(report.gitlabEvidence),
    '',
    '### 9.4 被降噪的长期需求',
    '',
    renderSuppressedStories(report),
    '',
    '### 9.5 生成信息',
    '',
    renderAppendix(report),
    '',
  ].join('\n')
}

function renderExecutiveSnapshot(report: AuditReport): string {
  const health = report.summary.risky > 0 ? (report.riskyStories.some(item => item.risks.some(risk => risk.severity === 'high')) ? 'Red' : 'Yellow') : 'Green'
  return [
    '| 项 | 结论 |',
    '|---|---|',
    `| 总体健康度 | ${health} |`,
    `| 全量需求 | ${report.summary.stories} |`,
    `| 入主报告需求 | ${report.summary.focused ?? report.summary.progressed + report.summary.risky} |`,
    `| 降噪需求 | ${report.summary.suppressed ?? 0} |`,
    `| 今日/本周实质进展 | ${report.summary.progressed} |`,
    `| 需关注风险 | ${report.summary.highPriorityRisks ?? report.summary.risky} |`,
    `| 信息维护缺口 | ${report.summary.incomplete} |`,
    `| 建议沟通 | ${report.summary.suggestedContacts} |`,
    `| 今日判断 | ${report.summary.highPriorityRisks || report.summary.risky ? '优先处理 P0/P1 风险，再补充影响推进判断的信息。' : '暂无必须升级事项，保持观察。'} |`,
  ].join('\n')
}

function renderStateSnapshot(report: AuditReport): string {
  const snapshot = report.stateSnapshot
  if (!snapshot) return '暂无。'
  return [
    '| 指标 | 数量 |',
    '|---|---:|',
    `| 健康需求 | ${snapshot.summary.greenStories} |`,
    `| 需关注需求 | ${snapshot.summary.yellowStories} |`,
    `| 高风险需求 | ${snapshot.summary.redStories} |`,
    `| 工作流数量 | ${snapshot.summary.workstreams} |`,
    `| 计划沟通人数 | ${snapshot.summary.communications} |`,
    '',
    '| 工作流 | 健康度 | 需求数 | 活跃/完成 | 风险 | 阻塞 |',
    '|---|---|---:|---:|---:|---:|',
    ...snapshot.workstreams.map(item => `| ${escapeCell(item.name)} | ${item.health} | ${item.stories} | ${item.activeStories} | ${item.riskyStories} | ${item.blockedStories} |`),
  ].join('\n')
}

function renderStoryTable(items: StoryAudit[]): string {
  if (items.length === 0) return '暂无。'
  return [
    '| 需求 | 当前状态 | 负责人 | 进展摘要 | 证据 | 下一步 | 置信度 |',
    '|---|---|---|---|---|---|---|',
    ...items.map(item => `| ${link(item.story.title, item.story.url)} | ${escapeCell(item.story.status)} | ${owners(item)} | ${escapeCell(item.progressSummary)} | ${evidenceSummary(item)} | ${escapeCell(String(item.story.fields.nextStep ?? '待确认'))} | ${item.confidence} |`),
  ].join('\n')
}

function renderRiskTable(items: StoryAudit[]): string {
  const risks = items.flatMap(item => item.risks.map(risk => ({ item, risk })))
  if (risks.length === 0) return '暂无。'
  return [
    '| 优先级 | 类型 | 需求 | 为什么现在关注 | 建议动作 | 找谁 | 置信度 |',
    '|---|---|---|---|---|---|---|',
    ...risks.map(({ item, risk }) => `| ${risk.priority ?? severityToPriority(risk.severity)} | ${risk.category ?? risk.type} | ${link(item.story.title, item.story.url)} | ${escapeCell(risk.whyNow ?? risk.description)} | ${escapeCell(risk.suggestedAction)} | ${escapeCell(risk.ownerToContact?.name ?? owners(item))} | ${item.confidence} |`),
  ].join('\n')
}

function renderMissingTable(items: StoryAudit[]): string {
  const rows = items.flatMap(item => item.risks.filter(risk => risk.type.startsWith('missing_')).map(risk => ({ item, risk })))
  if (rows.length === 0) return '暂无。'
  return [
    '| 优先级 | 需求 | 缺失信息 | 为什么影响判断 | 已查来源 | 建议动作 |',
    '|---|---|---|---|---|---|',
    ...rows.map(({ item, risk }) => `| ${risk.priority ?? severityToPriority(risk.severity)} | ${link(item.story.title, item.story.url)} | ${risk.type} | ${escapeCell(risk.whyNow ?? risk.description)} | ${sourceSummary(item, risk.type)} | ${escapeCell(risk.suggestedAction)} |`),
  ].join('\n')
}

function renderEvidenceTable(items: Evidence[]): string {
  if (items.length === 0) return '暂无。'
  return [
    '| 类型 | 标题 | 作者 | 时间 | 置信度 |',
    '|---|---|---|---|---|',
    ...items.slice(0, 30).map(item => `| ${item.type} | ${link(item.title, item.url)} | ${escapeCell(item.author ?? '')} | ${escapeCell(item.updatedAt)} | ${item.confidence} |`),
    ...(items.length > 30 ? [`| 省略 | 另有 ${items.length - 30} 条证据 |  |  |  |`] : []),
  ].join('\n')
}

function renderContactTable(items: SuggestedContact[]): string {
  if (items.length === 0) return '暂无。'
  return [
    '| 优先级 | 找谁 | 需求 | 问什么 | 期望产出 | 是否需审批 |',
    '|---|---|---|---|---|---|',
    ...items.map(item => `| ${item.priority} | ${escapeCell(item.person)} | ${escapeCell(item.storyTitle)} | ${escapeCell(item.question)} | ${expectedOutcome(item.reason)} | 是 |`),
  ].join('\n')
}

function renderProjectWritebackQueue(report: AuditReport): string {
  const candidates = (report.storyAudits ?? []).flatMap(audit =>
    (audit.context?.candidates ?? []).map(candidate => ({ audit, candidate })),
  )
  if (candidates.length === 0) return '暂无待审批写回动作。'
  return [
    '| 需求 | 字段 | 候选值 | 来源 | 置信度 | 状态 |',
    '|---|---|---|---|---|---|',
    ...candidates.map(({ audit, candidate }) => `| ${link(audit.story.title, audit.story.url)} | ${candidate.field} | ${escapeCell(candidate.value)} | ${link(candidate.sourceTitle, candidate.sourceUrl)} | ${candidate.confidence} | 待人工确认 |`),
  ].join('\n')
}

function renderAppendix(report: AuditReport): string {
  return [
    `- 报告生成时间：${escapeCell(report.stateSnapshot?.generatedAt ?? '')}`,
    `- 状态窗口：${escapeCell(report.stateSnapshot?.window.since ?? '')} ~ ${escapeCell(report.stateSnapshot?.window.until ?? '')}`,
    `- GitLab 证据数：${report.gitlabEvidence.length}`,
    `- 孤立代码进展数：${report.isolatedEvidence.length}`,
    `- 被降噪需求数：${report.suppressedStories?.length ?? 0}`,
    '- 所有结论应以飞书项目字段、GitLab 证据、飞书文档、飞书评论或人工 check-in 为准；推断需保留置信度。',
  ].join('\n')
}

function renderSuppressedStories(report: AuditReport): string {
  const items = report.suppressedStories ?? []
  if (items.length === 0) return '暂无。'
  return [
    `本轮共降噪 ${items.length} 个长期无变化或无近期交付证据的需求。`,
    '',
    '| 需求 | 状态 | 负责人 | 降噪原因 | 最近更新 |',
    '|---|---|---|---|---|',
    ...items.slice(0, 10).map(item => `| ${escapeCell(item.storyTitle)} | ${escapeCell(item.status)} | ${escapeCell(item.ownerNames.join(', ') || '未维护')} | ${escapeCell(item.reason)} | ${escapeCell(item.updatedAt ?? '')} |`),
    ...(items.length > 10 ? [`| 省略 |  |  | 另有 ${items.length - 10} 个降噪需求 |  |`] : []),
  ].join('\n')
}

function owners(item: StoryAudit): string {
  return item.story.owners.map(owner => owner.name).join(', ') || '未维护'
}

function evidenceSummary(item: StoryAudit): string {
  const mr = item.evidence.filter(evidence => evidence.type === 'gitlab_mr').length
  const commit = item.evidence.filter(evidence => evidence.type === 'gitlab_commit').length
  const pipeline = item.evidence.filter(evidence => evidence.type === 'gitlab_pipeline').length
  return `${mr} MR / ${commit} commit / ${pipeline} pipeline`
}

function sourceSummary(item: StoryAudit, riskType: string): string {
  const candidate = candidateForRisk(item, riskType)
  if (candidate !== '待确认') return `关联文档候选：${candidate}`
  return item.evidence.length ? `${item.evidence.length} 条交付证据` : '飞书项目字段'
}

function noDisturbReason(item: StoryAudit): string {
  if (item.evidence.length > 0) return '已有交付证据且暂无 P0/P1 风险，先观察不主动打扰。'
  return '暂无需要主动沟通的风险。'
}

function expectedOutcome(reason: string): string {
  if (/owner|负责人/.test(reason)) return '明确 owner'
  if (/排期|ETA|时间/.test(reason)) return '补充排期/ETA'
  if (/目标|验收/.test(reason)) return '确认目标/验收标准'
  return '确认状态、blocker、下一步'
}

function severityToPriority(severity: 'low' | 'medium' | 'high'): 'P1' | 'P2' | 'P3' {
  return severity === 'high' ? 'P1' : severity === 'medium' ? 'P2' : 'P3'
}

function candidateForRisk(item: StoryAudit, riskType: string): string {
  const target = riskType.replace(/^missing_/, '')
  const candidate = item.context?.candidates.find(candidate => candidate.field === target)
  return candidate ? escapeCell(candidate.value) : '待确认'
}

function link(text: string, url?: string): string {
  const escaped = escapeCell(text)
  return url ? `[${escaped}](${url})` : escaped
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

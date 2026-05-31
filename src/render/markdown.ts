import type { AuditReport, Evidence, StoryAudit, SuggestedContact } from '../domain.js'

export function renderAuditMarkdown(report: AuditReport): string {
  return [
    `# ${report.title}`,
    '',
    `日期：${report.date}`,
    '范围：飞书项目 MAAS_平台 + GitLab open-platform',
    '',
    '## 1. 总览',
    '',
    '| 指标 | 数量 |',
    '|---|---:|',
    `| 进行中需求数 | ${report.summary.stories} |`,
    `| 今日有进展需求数 | ${report.summary.progressed} |`,
    `| 有风险需求数 | ${report.summary.risky} |`,
    `| 信息不完整需求数 | ${report.summary.incomplete} |`,
    `| 建议沟通人数 | ${report.summary.suggestedContacts} |`,
    '',
    '## 2. 今日有进展的需求',
    '',
    renderStoryTable(report.progressedStories),
    '',
    '## 3. 风险需求',
    '',
    renderRiskTable(report.riskyStories),
    '',
    '## 4. 信息缺失需求',
    '',
    renderMissingTable(report.incompleteStories),
    '',
    '## 5. GitLab 交付证据',
    '',
    renderEvidenceTable(report.gitlabEvidence),
    '',
    '## 6. 建议沟通清单',
    '',
    renderContactTable(report.suggestedContacts),
    '',
    '## 7. 孤立代码进展',
    '',
    renderEvidenceTable(report.isolatedEvidence),
    '',
    '## 8. 不需要打扰的事项',
    '',
    report.noNeedToDisturb.length
      ? report.noNeedToDisturb.map(item => `- ${link(item.story.title, item.story.url)}：证据充分且暂无风险。`).join('\n')
      : '- 暂无。',
    '',
  ].join('\n')
}

function renderStoryTable(items: StoryAudit[]): string {
  if (items.length === 0) return '暂无。'
  return [
    '| 需求 | 当前状态 | 负责人 | 证据数 | 进展摘要 | 置信度 |',
    '|---|---|---|---:|---|---|',
    ...items.map(item => `| ${link(item.story.title, item.story.url)} | ${escapeCell(item.story.status)} | ${owners(item)} | ${item.evidence.length} | ${escapeCell(item.progressSummary)} | ${item.confidence} |`),
  ].join('\n')
}

function renderRiskTable(items: StoryAudit[]): string {
  const risks = items.flatMap(item => item.risks.map(risk => ({ item, risk })))
  if (risks.length === 0) return '暂无。'
  return [
    '| 需求 | 风险 | 证据 | 影响 | 建议动作 | 找谁 |',
    '|---|---|---|---|---|---|',
    ...risks.map(({ item, risk }) => `| ${link(item.story.title, item.story.url)} | ${risk.type} | ${risk.evidenceIds.length ? risk.evidenceIds.join(', ') : '飞书项目字段'} | ${escapeCell(risk.description)} | ${escapeCell(risk.suggestedAction)} | ${escapeCell(risk.ownerToContact?.name ?? owners(item))} |`),
  ].join('\n')
}

function renderMissingTable(items: StoryAudit[]): string {
  const rows = items.flatMap(item => item.risks.filter(risk => risk.type.startsWith('missing_')).map(risk => ({ item, risk })))
  if (rows.length === 0) return '暂无。'
  return [
    '| 需求 | 缺失信息 | 已查证据 | 候选结论 | 建议处理 |',
    '|---|---|---|---|---|',
    ...rows.map(({ item, risk }) => `| ${link(item.story.title, item.story.url)} | ${risk.type} | ${item.evidence.length} 条证据 | 待确认 | ${escapeCell(risk.suggestedAction)} |`),
  ].join('\n')
}

function renderEvidenceTable(items: Evidence[]): string {
  if (items.length === 0) return '暂无。'
  return [
    '| 类型 | 标题 | 作者 | 时间 | 置信度 |',
    '|---|---|---|---|---|',
    ...items.map(item => `| ${item.type} | ${link(item.title, item.url)} | ${escapeCell(item.author ?? '')} | ${escapeCell(item.updatedAt)} | ${item.confidence} |`),
  ].join('\n')
}

function renderContactTable(items: SuggestedContact[]): string {
  if (items.length === 0) return '暂无。'
  return [
    '| 人 | 需求 | 问题 | 为什么问 | 优先级 |',
    '|---|---|---|---|---|',
    ...items.map(item => `| ${escapeCell(item.person)} | ${escapeCell(item.storyTitle)} | ${escapeCell(item.question)} | ${escapeCell(item.reason)} | ${item.priority} |`),
  ].join('\n')
}

function owners(item: StoryAudit): string {
  return item.story.owners.map(owner => owner.name).join(', ') || '未维护'
}

function link(text: string, url?: string): string {
  const escaped = escapeCell(text)
  return url ? `[${escaped}](${url})` : escaped
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

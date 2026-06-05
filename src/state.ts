import type {
  AuditReport,
  DateWindow,
  PlannedCommunication,
  ProjectStateSnapshot,
  Risk,
  StoryAudit,
  StoryHealth,
  StoryState,
  WorkstreamState,
} from './domain.js'

export interface BuildProjectStateSnapshotInput {
  report: AuditReport
  window: DateWindow
  generatedAt?: Date
}

export function buildProjectStateSnapshot(input: BuildProjectStateSnapshotInput): ProjectStateSnapshot {
  const storyAudits = uniqueAudits(input.report.storyAudits ?? [
    ...input.report.progressedStories,
    ...input.report.riskyStories,
    ...input.report.incompleteStories,
    ...input.report.noNeedToDisturb,
  ])
  const stories = storyAudits.map(toStoryState)
  const workstreams = buildWorkstreams(stories)
  const communicationPlan = buildCommunicationPlan(storyAudits)
  const label = input.report.date

  return {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    window: {
      label,
      since: input.window.since.toISOString(),
      until: input.window.until.toISOString(),
    },
    summary: {
      stories: stories.length,
      greenStories: stories.filter(item => item.health === 'green').length,
      yellowStories: stories.filter(item => item.health === 'yellow').length,
      redStories: stories.filter(item => item.health === 'red').length,
      unknownStories: stories.filter(item => item.health === 'unknown').length,
      workstreams: workstreams.length,
      communications: communicationPlan.length,
    },
    stories,
    workstreams,
    communicationPlan,
    noDisturbStories: stories.filter(item => !item.needsHumanContact && item.health === 'green'),
  }
}

function uniqueAudits(audits: StoryAudit[]): StoryAudit[] {
  const byId = new Map<string, StoryAudit>()
  for (const audit of audits) byId.set(audit.story.id, audit)
  return [...byId.values()].sort((a, b) => healthRank(toHealth(b.risks)) - healthRank(toHealth(a.risks)) || a.story.title.localeCompare(b.story.title))
}

function toStoryState(audit: StoryAudit): StoryState {
  const highRiskCount = audit.risks.filter(risk => risk.severity === 'high').length
  const health = toHealth(audit.risks)
  const latestEvidenceAt = audit.evidence
    .map(item => item.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
  const done = ['已结束', '已上线', '完成', 'Done'].includes(audit.story.status)
  const blocked = audit.risks.some(risk => risk.type === 'pipeline_failed' || risk.type === 'mr_blocked')
  const progress = done ? 'done' : blocked ? 'blocked' : audit.evidence.length > 0 ? 'active' : audit.risks.length > 0 ? 'stalled' : 'unknown'

  return {
    storyId: audit.story.id,
    title: audit.story.title,
    url: audit.story.url,
    status: audit.story.status,
    owners: audit.story.owners,
    workstream: workstreamName(audit),
    health,
    progress,
    evidenceCount: audit.evidence.length,
    riskCount: audit.risks.length,
    highRiskCount,
    latestEvidenceAt,
    goalStatus: audit.story.fields.goal || audit.story.fields.successCriteria || audit.story.fields.acceptanceCriteria ? 'present' : 'missing',
    nextStepStatus: audit.story.fields.nextStep ? 'present' : 'missing',
    contextSummary: audit.context?.summary,
    candidateCompletions: audit.context?.candidates ?? [],
    needsHumanContact: health === 'red' || highRiskCount > 0,
    reasons: audit.risks.map(risk => risk.description),
  }
}

function toHealth(risks: Risk[]): StoryHealth {
  if (risks.some(risk => risk.severity === 'high')) return 'red'
  if (risks.some(risk => risk.severity === 'medium')) return 'yellow'
  if (risks.length > 0) return 'yellow'
  return 'green'
}

function healthRank(health: StoryHealth): number {
  return { red: 3, yellow: 2, unknown: 1, green: 0 }[health]
}

function workstreamName(audit: StoryAudit): string {
  const explicit = audit.story.fields.productArea
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const title = audit.story.title
  if (/套餐|购买|退款|账单|计费|充值|支付|结算/.test(title)) return '商业化'
  if (/客服|工单|agent/i.test(title)) return '客服 Agent'
  if (/体验中心|历史记录|场景示例/.test(title)) return '体验中心'
  if (/安全|越权|IDOR|风险/.test(title)) return '安全与风控'
  if (/扩容|ingress|apisix|TDSQL|数据库|基础设施/.test(title)) return '基础设施'
  return '未归类'
}

function buildWorkstreams(stories: StoryState[]): WorkstreamState[] {
  const groups = new Map<string, StoryState[]>()
  for (const story of stories) {
    const current = groups.get(story.workstream) ?? []
    current.push(story)
    groups.set(story.workstream, current)
  }
  return [...groups.entries()].map(([name, items]) => {
    const blockedStories = items.filter(item => item.progress === 'blocked').length
    const riskyStories = items.filter(item => item.health === 'red' || item.health === 'yellow').length
    const health: StoryHealth = items.some(item => item.health === 'red')
      ? 'red'
      : items.some(item => item.health === 'yellow')
        ? 'yellow'
        : 'green'
    return {
      name,
      stories: items.length,
      activeStories: items.filter(item => item.progress === 'active' || item.progress === 'done').length,
      riskyStories,
      blockedStories,
      health,
    }
  }).sort((a, b) => healthRank(b.health) - healthRank(a.health) || b.stories - a.stories || a.name.localeCompare(b.name))
}

function buildCommunicationPlan(audits: StoryAudit[]): PlannedCommunication[] {
  const byPerson = new Map<string, { risks: Risk[]; audits: StoryAudit[] }>()
  for (const audit of audits) {
    const contactRisk = audit.risks.find(risk => risk.severity === 'high')
    if (!contactRisk) continue
    const person = contactRisk.ownerToContact?.name ?? audit.story.owners[0]?.name ?? audit.story.creator?.name
    if (!person) continue
    const entry = byPerson.get(person) ?? { risks: [], audits: [] }
    entry.risks.push(contactRisk)
    entry.audits.push(audit)
    byPerson.set(person, entry)
  }

  return [...byPerson.entries()].map(([person, entry]) => {
    const storyIds = [...new Set(entry.audits.map(audit => audit.story.id))]
    const storyTitles = [...new Set(entry.audits.map(audit => audit.story.title))]
    const firstRisk = entry.risks[0]!
    return {
      person,
      channel: 'feishu' as const,
      storyIds,
      storyTitles,
      priority: 'high' as const,
      question: communicationQuestion(entry.audits, storyTitles, firstRisk),
      reason: communicationReason(entry.audits, firstRisk),
    }
  }).sort((a, b) => b.storyIds.length - a.storyIds.length || a.person.localeCompare(b.person)).slice(0, 10)
}

function communicationQuestion(audits: StoryAudit[], storyTitles: string[], firstRisk: Risk): string {
  const candidate = audits.flatMap(audit => audit.context?.candidates ?? [])[0]
  if (candidate) {
    return `请确认 ${storyTitles.slice(0, 3).join('、')} 是否可以按关联文档候选补充 ${candidate.field}：「${candidate.value}」。`
  }
  return `请确认 ${storyTitles.slice(0, 3).join('、')} 的当前状态、blocker、下一步和 ETA。`
}

function communicationReason(audits: StoryAudit[], firstRisk: Risk): string {
  const candidate = audits.flatMap(audit => audit.context?.candidates ?? [])[0]
  if (!candidate) return firstRisk.suggestedAction
  return `${firstRisk.suggestedAction} 来源：${candidate.sourceTitle}。`
}

import type { AuditReport, Evidence, Risk, Story, StoryAudit, StoryContext, SuggestedContact, SuppressedStory } from './domain.js'
import { matchEvidenceToStories } from './matching.js'
import { assessStoryRisks } from './risks.js'

export interface BuildAuditReportInput {
  date: string
  stories: Story[]
  evidence: Evidence[]
  storyContexts?: StoryContext[]
  now: Date
}

export function buildAuditReport(input: BuildAuditReportInput): AuditReport {
  const contextByStory = new Map((input.storyContexts ?? []).map(context => [context.storyId, context]))
  const contextEvidence = (input.storyContexts ?? []).flatMap(context => context.evidence)
  const matches = matchEvidenceToStories(input.stories, [...input.evidence, ...contextEvidence])
  const audits: StoryAudit[] = input.stories.map(story => {
    const storyEvidence = matches.storyEvidence.get(story.id) ?? []
    const context = contextByStory.get(story.id)
    const risks = prioritizeRisks(withContextualActions(assessStoryRisks(story, storyEvidence, input.now), context), storyEvidence)
    return {
      story,
      evidence: storyEvidence,
      risks,
      confidence: storyEvidence.length || risks.length === 0 ? 'confirmed' : 'unknown',
      progressSummary: summarizeProgress(story, storyEvidence),
      context,
    }
  })

  const actionableAudits = audits.filter(audit => shouldFocusAudit(audit, input.now))
  const suppressedStories = audits
    .filter(audit => !shouldFocusAudit(audit, input.now))
    .map(audit => suppressAudit(audit))
  const progressedStories = actionableAudits.filter(audit => audit.evidence.length > 0)
  const riskyStories = actionableAudits
    .filter(audit => audit.risks.some(isMainReportRisk))
    .map(audit => ({ ...audit, risks: topRisksForMainReport(audit.risks).sort(compareRiskPriority) }))
    .sort(compareAuditPriority)
  const incompleteStories = actionableAudits
    .filter(audit => audit.risks.some(risk => risk.type.startsWith('missing_') && risk.priority !== 'P3'))
    .map(audit => ({ ...audit, risks: audit.risks.filter(risk => risk.type.startsWith('missing_') && risk.priority !== 'P3').sort(compareRiskPriority) }))
  const suggestedContacts = buildSuggestedContacts(riskyStories)
  const noNeedToDisturb = audits.filter(audit => audit.evidence.length > 0 && audit.risks.every(risk => risk.priority === 'P3'))
  const focusedStoryIds = new Set([
    ...progressedStories,
    ...riskyStories,
    ...incompleteStories,
    ...noNeedToDisturb,
  ].map(audit => audit.story.id))

  return {
    title: `MAAS_平台 PMO 状态核查日报 ${input.date}`,
    date: input.date,
    summary: {
      stories: input.stories.length,
      focused: focusedStoryIds.size,
      suppressed: suppressedStories.length,
      highPriorityRisks: riskyStories.flatMap(audit => audit.risks).filter(risk => risk.priority === 'P0' || risk.priority === 'P1').length,
      progressed: progressedStories.length,
      risky: riskyStories.length,
      incomplete: incompleteStories.length,
      suggestedContacts: suggestedContacts.length,
    },
    storyAudits: audits,
    progressedStories,
    riskyStories,
    incompleteStories,
    gitlabEvidence: input.evidence.filter(item => item.type.startsWith('gitlab_')),
    isolatedEvidence: matches.isolatedEvidence,
    suggestedContacts,
    noNeedToDisturb,
    suppressedStories,
  }
}

function prioritizeRisks(risks: Risk[], evidence: Evidence[]): Risk[] {
  return risks.map(risk => {
    const patch = classifyRisk(risk, evidence)
    return { ...risk, ...patch }
  })
}

function classifyRisk(risk: Risk, evidence: Evidence[]): Pick<Risk, 'priority' | 'category' | 'whyNow'> {
  const hasGitlabEvidence = evidence.some(item => item.type.startsWith('gitlab_'))
  if (risk.type === 'pipeline_failed' || risk.type === 'mr_blocked') {
    return {
      priority: 'P0',
      category: 'Issue',
      whyNow: 'GitLab MR 或 pipeline 证据显示当前可能阻塞，需要当天确认。',
    }
  }
  if (risk.type === 'state_delivery_mismatch') {
    return {
      priority: 'P1',
      category: 'Mismatch',
      whyNow: '代码已有交付进展，但飞书项目状态未同步。',
    }
  }
  if (risk.type === 'missing_owner') {
    return {
      priority: 'P1',
      category: 'Data Quality',
      whyNow: hasGitlabEvidence ? '需求有交付证据但缺负责人，无法闭环推进。' : '需求缺负责人，会影响后续沟通和状态维护。',
    }
  }
  if (risk.type === 'missing_goal') {
    return {
      priority: hasGitlabEvidence ? 'P1' : 'P3',
      category: 'Data Quality',
      whyNow: hasGitlabEvidence ? '需求已有代码进展但目标/验收不清，影响判断是否按预期交付。' : '长期信息缺失，当前无近期交付证据，先降噪。',
    }
  }
  if (risk.type === 'missing_schedule' || risk.type === 'missing_next_step' || risk.type === 'missing_test_plan') {
    return {
      priority: hasGitlabEvidence ? 'P2' : 'P3',
      category: 'Data Quality',
      whyNow: hasGitlabEvidence ? '需求有近期证据，但缺少排期、下一步或测试计划会影响 PMO 判断。' : '普通信息维护缺口，当前不进入主报告。',
    }
  }
  if (risk.type === 'stale_status') {
    return {
      priority: hasGitlabEvidence ? 'P1' : 'P3',
      category: 'Risk',
      whyNow: hasGitlabEvidence ? '需求状态滞后且有代码进展，可能需要同步飞书项目。' : '长期无变化，先放入降噪摘要。',
    }
  }
  return {
    priority: risk.severity === 'high' ? 'P1' : risk.severity === 'medium' ? 'P2' : 'P3',
    category: 'Risk',
    whyNow: '风险规则命中，需要结合证据确认。',
  }
}

function shouldFocusAudit(audit: StoryAudit, now: Date): boolean {
  if (audit.evidence.length > 0) return true
  if (audit.risks.some(risk => risk.priority === 'P0' || risk.priority === 'P1')) return true
  if (audit.risks.some(risk => risk.type === 'missing_owner')) return true
  const updatedAt = audit.story.updatedAt ? new Date(audit.story.updatedAt) : undefined
  if (updatedAt && daysBetween(updatedAt, now) <= 3 && audit.risks.some(risk => risk.type === 'missing_goal')) return true
  return false
}

function suppressAudit(audit: StoryAudit): SuppressedStory {
  const ownerNames = audit.story.owners.map(owner => owner.name).filter(Boolean)
  const missingCount = audit.risks.filter(risk => risk.type.startsWith('missing_')).length
  const stale = audit.risks.some(risk => risk.type === 'stale_status')
  const reason = [
    '长期无变化或无近期交付证据',
    missingCount ? `${missingCount} 个普通信息缺口已降噪` : '',
    stale ? '状态滞后仅保留在附录摘要' : '',
  ].filter(Boolean).join('；')
  return {
    storyId: audit.story.id,
    storyTitle: audit.story.title,
    status: audit.story.status,
    ownerNames,
    reason,
    updatedAt: audit.story.updatedAt,
  }
}

function isMainReportRisk(risk: Risk): boolean {
  return risk.priority === 'P0' || risk.priority === 'P1'
}

function topRisksForMainReport(risks: Risk[]): Risk[] {
  const main = risks.filter(isMainReportRisk)
  const p0 = main.filter(risk => risk.priority === 'P0')
  if (p0.length > 0) return p0
  return main
}

function compareRiskPriority(a: Risk, b: Risk): number {
  return riskRank(a) - riskRank(b) || a.type.localeCompare(b.type)
}

function compareAuditPriority(a: StoryAudit, b: StoryAudit): number {
  return Math.min(...a.risks.map(riskRank)) - Math.min(...b.risks.map(riskRank)) || a.story.title.localeCompare(b.story.title)
}

function riskRank(risk: Risk): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[risk.priority ?? 'P3']
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
}

function withContextualActions(risks: ReturnType<typeof assessStoryRisks>, context: StoryContext | undefined): ReturnType<typeof assessStoryRisks> {
  if (!context?.candidates.length) return risks
  return risks.map(risk => {
    const field = riskField(risk.type)
    const candidate = field ? context.candidates.find(item => item.field === field) : undefined
    if (!candidate) return risk
    return {
      ...risk,
      evidenceIds: [...new Set([...risk.evidenceIds, candidate.evidenceId])],
      suggestedAction: `关联文档已有候选「${candidate.value}」，请 ${risk.ownerToContact?.name ?? '负责人'} 确认后补到飞书项目。`,
    }
  })
}

function riskField(type: string): string | undefined {
  if (type === 'missing_goal') return 'goal'
  if (type === 'missing_test_plan') return 'testPlan'
  if (type === 'missing_next_step') return 'nextStep'
  if (type === 'missing_schedule') return 'dueDate'
  return undefined
}

function summarizeProgress(story: Story, evidence: Evidence[]): string {
  if (evidence.length === 0) return '未找到今日交付证据，需结合飞书项目状态判断。'
  const mrCount = evidence.filter(item => item.type === 'gitlab_mr').length
  const commitCount = evidence.filter(item => item.type === 'gitlab_commit').length
  const pipelineCount = evidence.filter(item => item.type === 'gitlab_pipeline').length
  return `${story.title} 今日关联 ${mrCount} 个 MR、${commitCount} 个 commit、${pipelineCount} 条 pipeline 证据。`
}

function buildSuggestedContacts(audits: StoryAudit[]): SuggestedContact[] {
  return audits.slice(0, 10).map(audit => {
    const firstRisk = audit.risks[0]!
    const person = firstRisk.ownerToContact?.name ?? audit.story.owners[0]?.name ?? audit.story.creator?.name ?? '需求相关负责人'
    return {
      person,
      storyId: audit.story.id,
      storyTitle: audit.story.title,
      question: `需求「${audit.story.title}」存在「${firstRisk.description}」请确认当前状态、blocker、下一步和 ETA。`,
      reason: firstRisk.suggestedAction,
      priority: firstRisk.severity,
    }
  })
}

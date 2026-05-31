import type { AuditReport, Evidence, Story, StoryAudit, SuggestedContact } from './domain.js'
import { matchEvidenceToStories } from './matching.js'
import { assessStoryRisks } from './risks.js'

export interface BuildAuditReportInput {
  date: string
  stories: Story[]
  evidence: Evidence[]
  now: Date
}

export function buildAuditReport(input: BuildAuditReportInput): AuditReport {
  const matches = matchEvidenceToStories(input.stories, input.evidence)
  const audits: StoryAudit[] = input.stories.map(story => {
    const storyEvidence = matches.storyEvidence.get(story.id) ?? []
    const risks = assessStoryRisks(story, storyEvidence, input.now)
    return {
      story,
      evidence: storyEvidence,
      risks,
      confidence: storyEvidence.length || risks.length === 0 ? 'confirmed' : 'unknown',
      progressSummary: summarizeProgress(story, storyEvidence),
    }
  })

  const progressedStories = audits.filter(audit => audit.evidence.length > 0)
  const riskyStories = audits.filter(audit => audit.risks.length > 0)
  const incompleteStories = audits.filter(audit => audit.risks.some(risk => risk.type.startsWith('missing_')))
  const suggestedContacts = buildSuggestedContacts(riskyStories)
  const noNeedToDisturb = audits.filter(audit => audit.evidence.length > 0 && audit.risks.length === 0)

  return {
    title: `MAAS_平台 PMO 状态核查日报 ${input.date}`,
    date: input.date,
    summary: {
      stories: input.stories.length,
      progressed: progressedStories.length,
      risky: riskyStories.length,
      incomplete: incompleteStories.length,
      suggestedContacts: suggestedContacts.length,
    },
    progressedStories,
    riskyStories,
    incompleteStories,
    gitlabEvidence: input.evidence.filter(item => item.type.startsWith('gitlab_')),
    isolatedEvidence: matches.isolatedEvidence,
    suggestedContacts,
    noNeedToDisturb,
  }
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

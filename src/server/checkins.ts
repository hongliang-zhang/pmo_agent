import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuditReport, Risk, StoryAudit } from '../domain.js'
import { closeCommunicationDraftsForCheckIn, type CommunicationDraft } from './drafts.js'
import { listProjectUpdateActions, writeProjectUpdateActions } from './project-updates.js'

export interface ParsedCheckInReply {
  status?: 'active' | 'blocked' | 'done' | 'unknown'
  goal?: string
  blocker?: string
  testPlan?: string
  nextStep?: string
  eta?: string
  shouldUpdateProject: boolean
}

export interface CheckInRecord {
  id: string
  storyId: string
  draftId?: string
  responder: string
  text: string
  parsed: ParsedCheckInReply
  externalWrites: []
  closedDraftIds: string[]
  followUpActionIds: string[]
  createdAt: string
}

export interface ProjectUpdateAction {
  id: string
  status: 'pending_approval' | 'approved' | 'applied' | 'rejected'
  type: 'update_project_fields'
  storyId: string
  draftId?: string
  responder: string
  proposedFields: {
    goal?: string
    testPlan?: string
    nextStep?: string
    dueDate?: string
    status?: string
  }
  sourceCheckInId: string
  createdAt: string
  approvedBy?: string
  approvedAt?: string
  approvalNote?: string
  rejectedBy?: string
  rejectedAt?: string
  rejectionNote?: string
  appliedBy?: string
  appliedAt?: string
  appliedFields?: Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; fieldKey: string; value: string }>
}

export function parseCheckInReply(text: string): ParsedCheckInReply {
  const statusRaw = findValue(text, ['状态', 'status'])
  return {
    status: normalizeStatus(statusRaw),
    goal: findValue(text, ['目标', 'goal']),
    blocker: findValue(text, ['blocker', '阻塞', '风险']),
    testPlan: findValue(text, ['测试计划', 'test plan', 'testPlan']),
    nextStep: findValue(text, ['下一步', 'next step', 'nextStep']),
    eta: findValue(text, ['ETA', 'eta', '预计时间', '时间']),
    shouldUpdateProject: /需要更新飞书项目|请更新飞书项目|update\s+feishu\s+project/i.test(text),
  }
}

export async function recordCheckInReply(input: {
  reportsDir: string
  storyId: string
  draftId?: string
  responder: string
  text: string
  now?: Date
}): Promise<CheckInRecord> {
  const createdAt = (input.now ?? new Date()).toISOString()
  const parsed = parseCheckInReply(input.text)
  const closedDrafts = shouldCloseDraft(parsed)
    ? await closeCommunicationDraftsForCheckIn({
        reportsDir: input.reportsDir,
        storyId: input.storyId,
        draftId: input.draftId,
        actor: input.responder,
        reason: 'check_in_reply_received',
        now: input.now,
      })
    : []
  const followUpActions = parsed.shouldUpdateProject
    ? await appendProjectUpdateAction(input.reportsDir, {
        storyId: input.storyId,
        draftId: input.draftId,
        responder: input.responder,
        parsed,
        sourceCheckInId: `${createdAt}-${input.storyId}-${input.responder}`,
        createdAt,
      })
    : []
  const record: CheckInRecord = {
    id: `${createdAt}-${input.storyId}-${input.responder}`,
    storyId: input.storyId,
    draftId: input.draftId,
    responder: input.responder,
    text: input.text,
    parsed,
    externalWrites: [],
    closedDraftIds: closedDrafts.map(draft => draft.id),
    followUpActionIds: followUpActions.map(action => action.id),
    createdAt,
  }
  await mkdir(input.reportsDir, { recursive: true })
  const existing = await listCheckInRecords(input.reportsDir)
  await writeFile(checkinsPath(input.reportsDir), `${JSON.stringify([record, ...existing], null, 2)}\n`, 'utf8')
  return record
}

export async function applyCheckInsToReport(input: {
  report: AuditReport
  checkIns: CheckInRecord[]
  maxAgeHours?: number
  now?: Date
}): Promise<AuditReport> {
  const now = input.now ?? new Date()
  const maxAgeHours = input.maxAgeHours ?? 72
  const latestByStory = latestRelevantCheckIns(input.checkIns, now, maxAgeHours)
  if (latestByStory.size === 0) return input.report

  const transform = (audit: StoryAudit): StoryAudit => {
    const checkIn = latestByStory.get(audit.story.id)
    if (!checkIn) return audit
    const risks = reduceRisksWithCheckIn(audit.risks, checkIn)
    const evidence = [...audit.evidence, {
      id: `checkin-${checkIn.id}`,
      type: 'feishu_project_comment' as const,
      title: `沟通回复：${checkIn.responder}`,
      summary: [
        checkIn.parsed.status ? `状态：${checkIn.parsed.status}` : '',
        checkIn.parsed.goal ? `目标：${checkIn.parsed.goal}` : '',
        checkIn.parsed.testPlan ? `测试计划：${checkIn.parsed.testPlan}` : '',
        checkIn.parsed.nextStep ? `下一步：${checkIn.parsed.nextStep}` : '',
        checkIn.parsed.eta ? `ETA：${checkIn.parsed.eta}` : '',
        checkIn.parsed.blocker ? `阻塞：${checkIn.parsed.blocker}` : '',
      ].filter(Boolean).join('；') || '收到沟通回复',
      url: audit.story.url ?? '',
      author: checkIn.responder,
      createdAt: checkIn.createdAt,
      updatedAt: checkIn.createdAt,
      confidence: 'confirmed' as const,
      metadata: { source: 'check_in_reply', checkInId: checkIn.id },
    }]
    return {
      ...audit,
      evidence,
      risks,
      progressSummary: summarizeCheckInProgress(audit.progressSummary, checkIn),
    }
  }

  const storyAudits = (input.report.storyAudits ?? [
    ...input.report.progressedStories,
    ...input.report.riskyStories,
    ...input.report.incompleteStories,
    ...input.report.noNeedToDisturb,
  ]).map(transform)
  const riskyStories = storyAudits.filter(audit => audit.risks.length > 0)
  const incompleteStories = storyAudits.filter(audit => audit.risks.some(risk => risk.type.startsWith('missing_')))
  const progressedStories = storyAudits.filter(audit => audit.evidence.length > 0)
  const noNeedToDisturb = storyAudits.filter(audit => audit.risks.length === 0)
  return {
    ...input.report,
    storyAudits,
    progressedStories,
    riskyStories,
    incompleteStories,
    noNeedToDisturb,
    summary: {
      ...input.report.summary,
      progressed: progressedStories.length,
      risky: riskyStories.length,
      incomplete: incompleteStories.length,
    },
  }
}

export async function listCheckInRecords(reportsDir: string): Promise<CheckInRecord[]> {
  try {
    const records = JSON.parse(await readFile(checkinsPath(reportsDir), 'utf8')) as CheckInRecord[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

function findValue(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^\\s*${escaped}\\s*[:：]\\s*(.+)$`, 'im').exec(text)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

function normalizeStatus(value: string | undefined): ParsedCheckInReply['status'] {
  if (!value) return undefined
  if (/blocked|block|阻塞|卡住|风险/.test(value)) return 'blocked'
  if (/done|完成|已上线|结束/.test(value)) return 'done'
  if (/active|进行|开发|联调|测试/.test(value)) return 'active'
  return 'unknown'
}

function shouldCloseDraft(parsed: ParsedCheckInReply): boolean {
  return Boolean(parsed.nextStep || parsed.eta || parsed.status === 'done' || parsed.status === 'active' || parsed.status === 'blocked')
}

async function appendProjectUpdateAction(
  reportsDir: string,
  input: {
    storyId: string
    draftId?: string
    responder: string
    parsed: ParsedCheckInReply
    sourceCheckInId: string
    createdAt: string
  },
): Promise<ProjectUpdateAction[]> {
  const proposedFields: ProjectUpdateAction['proposedFields'] = {
    goal: input.parsed.goal,
    testPlan: input.parsed.testPlan,
    nextStep: input.parsed.nextStep,
    dueDate: input.parsed.eta,
    status: input.parsed.status,
  }
  const action: ProjectUpdateAction = {
    id: `${input.createdAt}-project-update-${input.storyId}`,
    status: 'pending_approval',
    type: 'update_project_fields',
    storyId: input.storyId,
    draftId: input.draftId,
    responder: input.responder,
    proposedFields,
    sourceCheckInId: input.sourceCheckInId,
    createdAt: input.createdAt,
  }
  await mkdir(reportsDir, { recursive: true })
  const existing = await listProjectUpdateActions(reportsDir)
  await writeProjectUpdateActions(reportsDir, [action, ...existing])
  return [action]
}

function latestRelevantCheckIns(records: CheckInRecord[], now: Date, maxAgeHours: number): Map<string, CheckInRecord> {
  const byStory = new Map<string, CheckInRecord>()
  for (const record of records) {
    const ageHours = Math.abs(now.getTime() - new Date(record.createdAt).getTime()) / 3_600_000
    if (ageHours > maxAgeHours) continue
    const current = byStory.get(record.storyId)
    if (!current || current.createdAt < record.createdAt) byStory.set(record.storyId, record)
  }
  return byStory
}

function reduceRisksWithCheckIn(risks: Risk[], checkIn: CheckInRecord): Risk[] {
  return risks.filter(risk => {
    if (risk.type === 'missing_next_step' && checkIn.parsed.nextStep) return false
    if (risk.type === 'missing_schedule' && checkIn.parsed.eta) return false
    if (risk.type === 'missing_goal' && checkIn.parsed.goal) return false
    if (risk.type === 'missing_test_plan' && checkIn.parsed.testPlan) return false
    if (risk.type === 'stale_status' && checkIn.parsed.status) return false
    if (risk.type === 'missing_goal' && checkIn.parsed.status === 'done') return false
    return true
  })
}

function summarizeCheckInProgress(previous: string, checkIn: CheckInRecord): string {
  const details = [
    checkIn.parsed.status ? `状态 ${checkIn.parsed.status}` : '',
    checkIn.parsed.goal ? `目标：${checkIn.parsed.goal}` : '',
    checkIn.parsed.testPlan ? `测试计划：${checkIn.parsed.testPlan}` : '',
    checkIn.parsed.nextStep ? `下一步：${checkIn.parsed.nextStep}` : '',
    checkIn.parsed.eta ? `ETA：${checkIn.parsed.eta}` : '',
  ].filter(Boolean).join('；')
  if (!details) return previous
  return `${previous}\n沟通回复已确认：${details}`
}

function checkinsPath(reportsDir: string): string {
  return join(reportsDir, 'checkins.json')
}

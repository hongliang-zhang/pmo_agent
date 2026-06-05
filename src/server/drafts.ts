import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuditReport, PlannedCommunication } from '../domain.js'

export interface PersonIdentity {
  openId?: string
  email?: string
  userId?: string
  chatId?: string
  gitlabUsername?: string
}

export type PersonDirectory = Record<string, PersonIdentity>

export interface CommunicationPolicy {
  maxQuestionsPerPersonPerDay: number
  repeatStoryWindowHours: number
  enforceQuietHoursOnDraftCreation?: boolean
  quietHours?: {
    start: string
    end: string
    timezone: string
  }
}

export interface CommunicationDraft {
  id: string
  status: 'pending_approval' | 'approved' | 'rejected' | 'auto_closed'
  channel: 'feishu_im' | 'feishu_group'
  recipient: string
  recipientIdentity?: PersonIdentity
  priority: PlannedCommunication['priority']
  storyIds: string[]
  storyTitles: string[]
  reason: string
  message: string
  sourceReportPath: string
  createdAt: string
  budget?: {
    status: 'allowed'
    dailyCount: number
    dailyLimit: number
  }
  approvedBy?: string
  approvedAt?: string
  approvalNote?: string
  rejectedBy?: string
  rejectedAt?: string
  rejectionNote?: string
  closedBy?: string
  closedAt?: string
  closeReason?: string
}

export interface CommunicationDraftAuditEvent {
  id: string
  draftId: string
  action: 'approved' | 'rejected' | 'draft_suppressed' | 'delivery_blocked' | 'delivery_dry_run' | 'delivery_sent' | 'auto_closed'
  actor: string
  note?: string
  at: string
}

export async function createCommunicationDraftsFromReport(input: {
  reportsDir: string
  reportPath: string
  now?: Date
  personDirectory?: PersonDirectory
  policy?: CommunicationPolicy
}): Promise<CommunicationDraft[]> {
  const report = JSON.parse(await readFile(input.reportPath, 'utf8')) as AuditReport
  const plan = report.stateSnapshot?.communicationPlan ?? []
  const createdAt = (input.now ?? new Date()).toISOString()
  const existing = await listCommunicationDrafts(input.reportsDir)
  const policy = input.policy ?? defaultCommunicationPolicy()
  const drafts: CommunicationDraft[] = []
  const dailyCounts = countDraftsByPersonForChinaDay(existing, input.now ?? new Date())
  for (const item of plan) {
    const decision = evaluateDraftPolicy({
      item,
      existing: [...existing, ...drafts],
      dailyCounts,
      now: input.now ?? new Date(),
      policy,
    })
    if (!decision.allowed) {
      await appendDraftAuditEvent(input.reportsDir, {
        id: `${createdAt}-draft_suppressed-${item.person}-${item.storyIds.join('-')}`,
        draftId: `${item.person}-${item.storyIds.join('-')}`,
        action: 'draft_suppressed',
        actor: 'pmo-agent',
        note: decision.reason,
        at: createdAt,
      })
      continue
    }
    const draft = toDraft(item, input.reportPath, createdAt, input.personDirectory?.[item.person], {
      dailyCount: (dailyCounts.get(item.person) ?? 0) + 1,
      dailyLimit: policy.maxQuestionsPerPersonPerDay,
    })
    drafts.push(draft)
    dailyCounts.set(item.person, (dailyCounts.get(item.person) ?? 0) + 1)
  }
  await appendDrafts(input.reportsDir, drafts)
  return drafts
}

export async function createReportDeliveryDraft(input: {
  reportsDir: string
  reportPath: string
  recipient: string
  recipientIdentity: PersonIdentity
  now?: Date
  channel?: CommunicationDraft['channel']
  feishuDocUrl?: string
  reportHtmlPath?: string
}): Promise<CommunicationDraft> {
  const report = JSON.parse(await readFile(input.reportPath, 'utf8')) as AuditReport
  const createdAt = (input.now ?? new Date()).toISOString()
  const draft: CommunicationDraft = {
    id: `${createdAt}-daily-report-${input.recipient}`,
    status: 'pending_approval',
    channel: input.channel ?? 'feishu_im',
    recipient: input.recipient,
    recipientIdentity: input.recipientIdentity,
    priority: 'high',
    storyIds: [],
    storyTitles: [],
    reason: 'daily_report_delivery',
    message: renderReportDeliveryMessage(report, input),
    sourceReportPath: input.reportPath,
    createdAt,
    budget: {
      status: 'allowed',
      dailyCount: 0,
      dailyLimit: defaultCommunicationPolicy().maxQuestionsPerPersonPerDay,
    },
  }
  await appendReportDeliveryDraft(input.reportsDir, draft)
  return draft
}

export async function listCommunicationDrafts(reportsDir: string): Promise<CommunicationDraft[]> {
  try {
    const records = JSON.parse(await readFile(draftsPath(reportsDir), 'utf8')) as CommunicationDraft[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

export async function approveCommunicationDraft(input: {
  reportsDir: string
  draftId: string
  actor: string
  note?: string
  now?: Date
}): Promise<CommunicationDraft> {
  return updateDraftReviewState({
    ...input,
    action: 'approved',
  })
}

export async function rejectCommunicationDraft(input: {
  reportsDir: string
  draftId: string
  actor: string
  note?: string
  now?: Date
}): Promise<CommunicationDraft> {
  return updateDraftReviewState({
    ...input,
    action: 'rejected',
  })
}

export async function closeCommunicationDraftsForCheckIn(input: {
  reportsDir: string
  storyId: string
  draftId?: string
  actor: string
  reason: string
  now?: Date
}): Promise<CommunicationDraft[]> {
  const drafts = await listCommunicationDrafts(input.reportsDir)
  const at = (input.now ?? new Date()).toISOString()
  const closed: CommunicationDraft[] = []
  const updated = drafts.map(draft => {
    if (draft.status !== 'pending_approval' && draft.status !== 'approved') return draft
    const matches = input.draftId ? draft.id === input.draftId : draft.storyIds.includes(input.storyId)
    if (!matches) return draft
    const next: CommunicationDraft = {
      ...draft,
      status: 'auto_closed',
      closedBy: input.actor,
      closedAt: at,
      closeReason: input.reason,
    }
    closed.push(next)
    return next
  })
  if (closed.length === 0) return []
  await writeDrafts(input.reportsDir, updated)
  for (const draft of closed) {
    await appendDraftAuditEvent(input.reportsDir, {
      id: `${at}-auto_closed-${draft.id}`,
      draftId: draft.id,
      action: 'auto_closed',
      actor: input.actor,
      note: input.reason,
      at,
    })
  }
  return closed
}

export async function listCommunicationDraftAuditEvents(reportsDir: string): Promise<CommunicationDraftAuditEvent[]> {
  try {
    const records = JSON.parse(await readFile(draftAuditPath(reportsDir), 'utf8')) as CommunicationDraftAuditEvent[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

export async function recordCommunicationDraftAuditEvent(
  reportsDir: string,
  event: CommunicationDraftAuditEvent,
): Promise<void> {
  await appendDraftAuditEvent(reportsDir, event)
}

async function appendDrafts(reportsDir: string, drafts: CommunicationDraft[]): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  const existing = await listCommunicationDrafts(reportsDir)
  await writeDrafts(reportsDir, [...drafts, ...existing])
}

async function appendReportDeliveryDraft(reportsDir: string, draft: CommunicationDraft): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  const existing = await listCommunicationDrafts(reportsDir)
  const updatedExisting: CommunicationDraft[] = []
  const closed: CommunicationDraft[] = []
  for (const item of existing) {
    if (
      item.status === 'pending_approval'
      && item.reason === 'daily_report_delivery'
      && item.recipient === draft.recipient
      && item.channel === draft.channel
    ) {
      const next: CommunicationDraft = {
        ...item,
        status: 'auto_closed',
        closedBy: 'pmo-agent',
        closedAt: draft.createdAt,
        closeReason: 'superseded_by_newer_daily_report_delivery_draft',
      }
      closed.push(next)
      updatedExisting.push(next)
      continue
    }
    updatedExisting.push(item)
  }
  await writeDrafts(reportsDir, [draft, ...updatedExisting])
  for (const item of closed) {
    await appendDraftAuditEvent(reportsDir, {
      id: `${draft.createdAt}-auto_closed-${item.id}`,
      draftId: item.id,
      action: 'auto_closed',
      actor: 'pmo-agent',
      note: `superseded_by:${draft.id}`,
      at: draft.createdAt,
    })
  }
}

async function updateDraftReviewState(input: {
  reportsDir: string
  draftId: string
  actor: string
  note?: string
  now?: Date
  action: CommunicationDraftAuditEvent['action']
}): Promise<CommunicationDraft> {
  const drafts = await listCommunicationDrafts(input.reportsDir)
  const index = drafts.findIndex(draft => draft.id === input.draftId)
  if (index < 0) {
    throw new Error(`Communication draft not found: ${input.draftId}`)
  }

  const at = (input.now ?? new Date()).toISOString()
  const current = drafts[index]
  const updated: CommunicationDraft = input.action === 'approved'
    ? {
        ...current,
        status: 'approved',
        approvedBy: input.actor,
        approvedAt: at,
        approvalNote: input.note,
      }
    : {
        ...current,
        status: 'rejected',
        rejectedBy: input.actor,
        rejectedAt: at,
        rejectionNote: input.note,
      }

  drafts[index] = updated
  await writeDrafts(input.reportsDir, drafts)
  await appendDraftAuditEvent(input.reportsDir, {
    id: `${at}-${input.action}-${input.draftId}`,
    draftId: input.draftId,
    action: input.action,
    actor: input.actor,
    note: input.note,
    at,
  })
  return updated
}

async function writeDrafts(reportsDir: string, drafts: CommunicationDraft[]): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  await writeFile(draftsPath(reportsDir), `${JSON.stringify(drafts, null, 2)}\n`, 'utf8')
}

async function appendDraftAuditEvent(reportsDir: string, event: CommunicationDraftAuditEvent): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  const existing = await listCommunicationDraftAuditEvents(reportsDir)
  await writeFile(draftAuditPath(reportsDir), `${JSON.stringify([event, ...existing], null, 2)}\n`, 'utf8')
}

function renderReportDeliveryMessage(
  report: AuditReport,
  input: { feishuDocUrl?: string; reportHtmlPath?: string },
): string {
  const lines = [
    report.title,
    '',
    `总览：进行中需求 ${report.summary.stories} 个，有进展 ${report.summary.progressed} 个，风险 ${report.summary.risky} 个，信息缺失 ${report.summary.incomplete} 个，建议沟通 ${report.summary.suggestedContacts} 人。`,
    input.feishuDocUrl ? `飞书文档：${input.feishuDocUrl}` : '',
    input.reportHtmlPath ? `本地 HTML：${input.reportHtmlPath}` : '',
    '',
    '当前仅生成日报单聊草稿，未自动发送。审批后再由发送流程处理。',
  ].filter(Boolean)
  return lines.join('\n')
}

function toDraft(
  item: PlannedCommunication,
  sourceReportPath: string,
  createdAt: string,
  recipientIdentity: PersonIdentity | undefined,
  budget: { dailyCount: number; dailyLimit: number },
): CommunicationDraft {
  return {
    id: `${createdAt}-${item.person}-${item.storyIds.join('-')}`,
    status: 'pending_approval',
    channel: 'feishu_im',
    recipient: item.person,
    recipientIdentity,
    priority: item.priority,
    storyIds: item.storyIds,
    storyTitles: item.storyTitles,
    reason: item.reason,
    message: [
      `请确认：${item.question}`,
      '',
      `涉及需求：${item.storyTitles.join('、')}`,
      `原因：${item.reason}`,
      '',
      '当前仅生成草稿，未自动发送。确认后再由后续发送流程处理。',
    ].join('\n'),
    sourceReportPath,
    createdAt,
    budget: {
      status: 'allowed',
      dailyCount: budget.dailyCount,
      dailyLimit: budget.dailyLimit,
    },
  }
}

function defaultCommunicationPolicy(): CommunicationPolicy {
  return {
    maxQuestionsPerPersonPerDay: 5,
    repeatStoryWindowHours: 24,
    quietHours: { start: '22:00', end: '10:00', timezone: 'Asia/Shanghai' },
  }
}

function evaluateDraftPolicy(input: {
  item: PlannedCommunication
  existing: CommunicationDraft[]
  dailyCounts: Map<string, number>
  now: Date
  policy: CommunicationPolicy
}): { allowed: true } | { allowed: false; reason: string } {
  if (input.policy.enforceQuietHoursOnDraftCreation && input.policy.quietHours && isQuietHour(input.now, input.policy.quietHours)) {
    return { allowed: false, reason: 'quiet_hours' }
  }

  const repeated = input.existing.find(draft =>
    draft.recipient === input.item.person
    && draft.storyIds.some(storyId => input.item.storyIds.includes(storyId))
    && draft.status !== 'auto_closed'
    && hoursBetween(new Date(draft.createdAt), input.now) < input.policy.repeatStoryWindowHours
  )
  if (repeated) return { allowed: false, reason: `repeat_story_window:${repeated.id}` }

  const currentCount = input.dailyCounts.get(input.item.person) ?? 0
  if (currentCount >= input.policy.maxQuestionsPerPersonPerDay) {
    return { allowed: false, reason: 'daily_budget_exhausted' }
  }

  return { allowed: true }
}

function countDraftsByPersonForChinaDay(drafts: CommunicationDraft[], now: Date): Map<string, number> {
  const day = chinaDay(now)
  const counts = new Map<string, number>()
  for (const draft of drafts) {
    if (chinaDay(new Date(draft.createdAt)) !== day) continue
    counts.set(draft.recipient, (counts.get(draft.recipient) ?? 0) + 1)
  }
  return counts
}

function isQuietHour(now: Date, quietHours: NonNullable<CommunicationPolicy['quietHours']>): boolean {
  const minutes = localMinutes(now, quietHours.timezone)
  const start = hhmmToMinutes(quietHours.start)
  const end = hhmmToMinutes(quietHours.end)
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function hhmmToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return (hour ?? 0) * 60 + (minute ?? 0)
}

function chinaDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 3_600_000
}

function draftsPath(reportsDir: string): string {
  return join(reportsDir, 'communication-drafts.json')
}

function draftAuditPath(reportsDir: string): string {
  return join(reportsDir, 'communication-draft-audit.json')
}

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveCommunicationDraft, createCommunicationDraftsFromReport, createReportDeliveryDraft, listCommunicationDraftAuditEvents, listCommunicationDrafts, rejectCommunicationDraft } from '../src/server/drafts.js'
import type { AuditReport } from '../src/domain.js'

describe('communication drafts', () => {
  it('creates pending Feishu IM drafts from state communication plan without sending anything', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-drafts-'))
    const reportPath = join(reportsDir, 'report.json')
    const report: AuditReport = {
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 0, risky: 1, incomplete: 1, suggestedContacts: 1 },
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
      stateSnapshot: {
        generatedAt: '2026-05-31T01:00:00.000Z',
        window: { label: '2026-05-31', since: '2026-05-30T16:00:00.000Z', until: '2026-05-31T16:00:00.000Z' },
        summary: { stories: 1, greenStories: 0, yellowStories: 0, redStories: 1, unknownStories: 0, workstreams: 1, communications: 1 },
        stories: [],
        workstreams: [],
        communicationPlan: [{
          person: '王建辉',
          channel: 'feishu',
          storyIds: ['S1'],
          storyTitles: ['企业套餐购买'],
          priority: 'high',
          question: '请确认企业套餐购买的当前状态、blocker、下一步和 ETA。',
          reason: 'CI failed',
        }],
        noDisturbStories: [],
      },
    }
    await writeFile(reportPath, JSON.stringify(report), 'utf8')

    const drafts = await createCommunicationDraftsFromReport({ reportsDir, reportPath, now: new Date('2026-05-31T03:00:00Z') })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      status: 'pending_approval',
      channel: 'feishu_im',
      recipient: '王建辉',
      sourceReportPath: reportPath,
    })
    expect(drafts[0].message).toContain('请确认企业套餐购买')
    expect(drafts[0].message).not.toMatch(/已发送|sent/i)

    const stored = await listCommunicationDrafts(reportsDir)
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toMatch(/token|secret|password|api[_-]?key/i)
    expect(JSON.parse(await readFile(join(reportsDir, 'communication-drafts.json'), 'utf8'))).toHaveLength(1)
  })

  it('applies person mapping, daily budget, quiet hours, and same-story repeat suppression', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-draft-policy-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify(reportWithPlan([
      {
        person: '王建辉',
        channel: 'feishu',
        storyIds: ['S1'],
        storyTitles: ['企业套餐购买'],
        priority: 'high',
        question: '请确认企业套餐购买的验收标准。',
        reason: '缺验收标准',
      },
      {
        person: '王建辉',
        channel: 'feishu',
        storyIds: ['S2'],
        storyTitles: ['退款流程'],
        priority: 'high',
        question: '请确认退款流程的测试计划。',
        reason: '缺测试计划',
      },
    ] satisfies NonNullable<AuditReport['stateSnapshot']>['communicationPlan'])), 'utf8')

    const first = await createCommunicationDraftsFromReport({
      reportsDir,
      reportPath,
      now: new Date('2026-05-31T02:00:00Z'),
      personDirectory: {
        王建辉: { openId: 'ou_wjh', email: 'wjh@example.com' },
      },
      policy: {
        maxQuestionsPerPersonPerDay: 1,
        quietHours: { start: '21:00', end: '08:00', timezone: 'Asia/Shanghai' },
        repeatStoryWindowHours: 24,
      },
    })

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      recipient: '王建辉',
      recipientIdentity: { openId: 'ou_wjh', email: 'wjh@example.com' },
      budget: { status: 'allowed' },
    })

    const second = await createCommunicationDraftsFromReport({
      reportsDir,
      reportPath,
      now: new Date('2026-05-31T03:00:00Z'),
      personDirectory: { 王建辉: { openId: 'ou_wjh' } },
      policy: {
        maxQuestionsPerPersonPerDay: 1,
        quietHours: { start: '21:00', end: '08:00', timezone: 'Asia/Shanghai' },
        repeatStoryWindowHours: 24,
      },
    })

    expect(second).toHaveLength(0)
    const events = await listCommunicationDraftAuditEvents(reportsDir)
    expect(events.map(event => event.action)).toContain('draft_suppressed')
    expect(events.map(event => event.note).join('\n')).toContain('daily_budget_exhausted')

    const quiet = await createCommunicationDraftsFromReport({
      reportsDir,
      reportPath,
      now: new Date('2026-05-31T15:30:00Z'),
      policy: {
        maxQuestionsPerPersonPerDay: 3,
        enforceQuietHoursOnDraftCreation: true,
        quietHours: { start: '21:00', end: '08:00', timezone: 'Asia/Shanghai' },
        repeatStoryWindowHours: 24,
      },
    })
    expect(quiet).toHaveLength(0)
    expect((await listCommunicationDraftAuditEvents(reportsDir)).map(event => event.note).join('\n')).toContain('quiet_hours')
  })

  it('approves and rejects drafts with local audit events without sending messages', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-draft-approval-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 0, risky: 1, incomplete: 1, suggestedContacts: 1 },
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
      stateSnapshot: {
        generatedAt: '2026-05-31T01:00:00.000Z',
        window: { label: '2026-05-31', since: '2026-05-30T16:00:00.000Z', until: '2026-05-31T16:00:00.000Z' },
        summary: { stories: 1, greenStories: 0, yellowStories: 0, redStories: 1, unknownStories: 0, workstreams: 1, communications: 1 },
        stories: [],
        workstreams: [],
        communicationPlan: [{
          person: '王建辉',
          channel: 'feishu',
          storyIds: ['S1'],
          storyTitles: ['企业套餐购买'],
          priority: 'high',
          question: '请确认企业套餐购买的当前状态、blocker、下一步和 ETA。',
          reason: 'CI failed',
        }],
        noDisturbStories: [],
      },
    } satisfies AuditReport), 'utf8')
    const [draft] = await createCommunicationDraftsFromReport({ reportsDir, reportPath, now: new Date('2026-05-31T03:00:00Z') })

    const approved = await approveCommunicationDraft({ reportsDir, draftId: draft.id, actor: 'PMO Owner', note: '可以发送' })

    expect(approved.status).toBe('approved')
    expect(approved.approvedBy).toBe('PMO Owner')
    expect(JSON.stringify(approved)).not.toMatch(/已发送|sent/i)

    const rejected = await rejectCommunicationDraft({ reportsDir, draftId: draft.id, actor: 'PMO Owner', note: '先不打扰' })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectedBy).toBe('PMO Owner')

    const events = await listCommunicationDraftAuditEvents(reportsDir)
    expect(events.map(event => event.action)).toEqual(['rejected', 'approved'])
    expect(JSON.stringify(events)).not.toMatch(/token|secret|password|api[_-]?key/i)
  })

  it('auto-closes older pending daily report delivery drafts for the same recipient', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-report-delivery-dedup-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify(reportWithPlan([])), 'utf8')

    const first = await createReportDeliveryDraft({
      reportsDir,
      reportPath,
      recipient: '张鸿亮',
      recipientIdentity: { userId: 'test-user-id' },
      now: new Date('2026-06-02T01:00:00Z'),
    })
    const second = await createReportDeliveryDraft({
      reportsDir,
      reportPath,
      recipient: '张鸿亮',
      recipientIdentity: { userId: 'test-user-id' },
      now: new Date('2026-06-02T02:00:00Z'),
    })

    const drafts = await listCommunicationDrafts(reportsDir)
    expect(drafts).toHaveLength(2)
    expect(drafts.find(draft => draft.id === second.id)).toMatchObject({ status: 'pending_approval' })
    expect(drafts.find(draft => draft.id === first.id)).toMatchObject({
      status: 'auto_closed',
      closedBy: 'pmo-agent',
      closeReason: 'superseded_by_newer_daily_report_delivery_draft',
    })

    const events = await listCommunicationDraftAuditEvents(reportsDir)
    expect(events[0]).toMatchObject({
      draftId: first.id,
      action: 'auto_closed',
      actor: 'pmo-agent',
      note: `superseded_by:${second.id}`,
    })
  })
})

function reportWithPlan(communicationPlan: NonNullable<AuditReport['stateSnapshot']>['communicationPlan']): AuditReport {
  return {
    title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
    date: '2026-05-31',
    summary: { stories: 1, progressed: 0, risky: 1, incomplete: 1, suggestedContacts: communicationPlan.length },
    progressedStories: [],
    riskyStories: [],
    incompleteStories: [],
    gitlabEvidence: [],
    isolatedEvidence: [],
    suggestedContacts: [],
    noNeedToDisturb: [],
    stateSnapshot: {
      generatedAt: '2026-05-31T01:00:00.000Z',
      window: { label: '2026-05-31', since: '2026-05-30T16:00:00.000Z', until: '2026-05-31T16:00:00.000Z' },
      summary: { stories: 1, greenStories: 0, yellowStories: 0, redStories: 1, unknownStories: 0, workstreams: 1, communications: communicationPlan.length },
      stories: [],
      workstreams: [],
      communicationPlan,
      noDisturbStories: [],
    },
  }
}

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyCheckInsToReport, listCheckInRecords, parseCheckInReply, recordCheckInReply } from '../src/server/checkins.js'
import { createCommunicationDraftsFromReport, listCommunicationDrafts } from '../src/server/drafts.js'
import { listProjectUpdateActions } from '../src/server/project-updates.js'
import type { AuditReport } from '../src/domain.js'

describe('check-in replies', () => {
  it('parses structured status, blocker, next step, and ETA from a reply', () => {
    const parsed = parseCheckInReply([
      '状态：blocked',
      '目标：完成企业套餐购买闭环验收',
      'blocker：等支付回调联调',
      '测试计划：支付回调、套餐生效、失败重试各跑一轮',
      '下一步：今天修复回调幂等',
      'ETA：2026-06-03',
      '需要更新飞书项目',
    ].join('\n'))

    expect(parsed).toMatchObject({
      status: 'blocked',
      goal: '完成企业套餐购买闭环验收',
      blocker: '等支付回调联调',
      testPlan: '支付回调、套餐生效、失败重试各跑一轮',
      nextStep: '今天修复回调幂等',
      eta: '2026-06-03',
      shouldUpdateProject: true,
    })
  })

  it('records parsed check-in replies as local agent state without updating Feishu Project', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-checkins-'))

    const record = await recordCheckInReply({
      reportsDir,
      storyId: 'S1',
      draftId: 'D1',
      responder: '王建辉',
      text: '状态：active\n下一步：完成联调\nETA：2026-06-03',
      now: new Date('2026-05-31T02:00:00Z'),
    })

    expect(record).toMatchObject({
      storyId: 'S1',
      draftId: 'D1',
      responder: '王建辉',
      parsed: {
        status: 'active',
        nextStep: '完成联调',
        eta: '2026-06-03',
        shouldUpdateProject: false,
      },
      externalWrites: [],
      closedDraftIds: [],
      followUpActionIds: [],
    })
    await expect(readFile(join(reportsDir, 'checkins.json'), 'utf8')).resolves.toContain('完成联调')

    const records = await listCheckInRecords(reportsDir)
    expect(records).toHaveLength(1)
    expect(JSON.stringify(records)).not.toMatch(/token|secret|password|api[_-]?key/i)
  })

  it('closes related drafts and creates approved-writeback follow-up actions from replies', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-checkin-loop-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify(reportWithMissingNextStep()), 'utf8')
    const [draft] = await createCommunicationDraftsFromReport({
      reportsDir,
      reportPath,
      now: new Date('2026-05-31T03:00:00Z'),
    })

    const record = await recordCheckInReply({
      reportsDir,
      storyId: 'S1',
      draftId: draft.id,
      responder: '王建辉',
      text: '状态：active\n目标：完成企业套餐灰度上线\n测试计划：覆盖购买、退款、套餐到期\n下一步：补充灰度方案\nETA：2026-06-03\n需要更新飞书项目',
      now: new Date('2026-05-31T04:00:00Z'),
    })

    expect(record.closedDraftIds).toEqual([draft.id])
    expect(record.followUpActionIds).toHaveLength(1)
    await expect(listCommunicationDrafts(reportsDir)).resolves.toMatchObject([{ status: 'auto_closed' }])
    await expect(listProjectUpdateActions(reportsDir)).resolves.toMatchObject([{
      status: 'pending_approval',
      type: 'update_project_fields',
      storyId: 'S1',
      proposedFields: {
        goal: '完成企业套餐灰度上线',
        testPlan: '覆盖购买、退款、套餐到期',
        nextStep: '补充灰度方案',
        dueDate: '2026-06-03',
      },
    }])
  })

  it('uses recent check-ins to reduce next-step and schedule risks in the next report', async () => {
    const report = reportWithMissingNextStep()
    const adjusted = await applyCheckInsToReport({
      report,
      checkIns: [{
        id: 'C1',
        storyId: 'S1',
        responder: '王建辉',
        text: '下一步：补充灰度方案',
        parsed: { nextStep: '补充灰度方案', eta: '2026-06-03', shouldUpdateProject: false },
        externalWrites: [],
        closedDraftIds: [],
        followUpActionIds: [],
        createdAt: '2026-05-31T04:00:00.000Z',
      }],
      now: new Date('2026-05-31T05:00:00Z'),
    })

    expect(adjusted.riskyStories).toHaveLength(0)
    expect(adjusted.incompleteStories).toHaveLength(0)
    expect(adjusted.progressedStories[0]?.progressSummary).toContain('沟通回复已确认')
  })
})

function reportWithMissingNextStep(): AuditReport {
  return {
    title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
    date: '2026-05-31',
    summary: { stories: 1, progressed: 0, risky: 1, incomplete: 1, suggestedContacts: 1 },
    storyAudits: [{
      story: {
        id: 'S1',
        title: '企业套餐购买',
        status: '开发阶段',
        owners: [{ name: '王建辉' }],
        linkedDocs: [],
        fields: {},
      },
      evidence: [],
      risks: [{
        id: 'S1-missing-next-step',
        storyId: 'S1',
        type: 'missing_next_step',
        severity: 'high',
        description: '需求缺少下一步动作。',
        evidenceIds: [],
        suggestedAction: '确认下一步。',
        ownerToContact: { name: '王建辉' },
      }, {
        id: 'S1-missing-schedule',
        storyId: 'S1',
        type: 'missing_schedule',
        severity: 'high',
        description: '需求缺少时间。',
        evidenceIds: [],
        suggestedAction: '确认 ETA。',
        ownerToContact: { name: '王建辉' },
      }],
      confidence: 'unknown',
      progressSummary: '暂无进展。',
    }],
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
        reason: '缺下一步和 ETA',
      }],
      noDisturbStories: [],
    },
  }
}

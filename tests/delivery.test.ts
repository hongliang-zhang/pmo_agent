import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuditReport } from '../src/domain.js'
import { approveCommunicationDraft, createCommunicationDraftsFromReport, listCommunicationDraftAuditEvents } from '../src/server/drafts.js'
import { deliverCommunicationDraft } from '../src/server/delivery.js'

const oldDeliveryEnabled = process.env.PMO_FEISHU_IM_DELIVERY_ENABLED

afterEach(() => {
  if (oldDeliveryEnabled === undefined) delete process.env.PMO_FEISHU_IM_DELIVERY_ENABLED
  else process.env.PMO_FEISHU_IM_DELIVERY_ENABLED = oldDeliveryEnabled
})

describe('communication delivery guard', () => {
  it('blocks delivery when a draft has not been approved', async () => {
    const { reportsDir, draftId } = await createDraftFixture()

    const result = await deliverCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner', dryRun: true })

    expect(result).toMatchObject({
      success: false,
      error: { code: 'draft_not_approved' },
    })
    expect(JSON.stringify(result)).not.toMatch(/已发送|sent/i)

    const events = await listCommunicationDraftAuditEvents(reportsDir)
    expect(events[0]).toMatchObject({ action: 'delivery_blocked', draftId, actor: 'PMO Owner' })
  })

  it('allows dry-run delivery for approved drafts without sending Feishu IM', async () => {
    const { reportsDir, draftId } = await createDraftFixture()
    await approveCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner', now: new Date('2026-05-31T01:00:00Z') })

    const result = await deliverCommunicationDraft({
      reportsDir,
      draftId,
      actor: 'PMO Owner',
      dryRun: true,
      now: new Date('2026-05-31T01:01:00Z'),
    })

    expect(result).toMatchObject({
      success: true,
      mode: 'dry_run',
      draftId,
      channel: 'feishu_im',
      recipient: '王建辉',
    })
    expect(JSON.stringify(result)).not.toMatch(/已发送|sent/i)

    const events = await listCommunicationDraftAuditEvents(reportsDir)
    expect(events[0]).toMatchObject({ action: 'delivery_dry_run', draftId, actor: 'PMO Owner' })
  })

  it('fails closed for real Feishu IM delivery until delivery credentials and mapping are configured', async () => {
    const { reportsDir, draftId } = await createDraftFixture()
    await approveCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner' })
    delete process.env.PMO_FEISHU_IM_DELIVERY_ENABLED

    const result = await deliverCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner', dryRun: false })

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'feishu_im_delivery_not_configured',
      },
    })
    expect(result.success ? '' : result.error.nextStep).toContain('PMO_FEISHU_IM_DELIVERY_ENABLED=true')
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|api[_-]?key/i)
  })

  it('sends approved Feishu IM drafts only when delivery is explicitly enabled and recipient mapping exists', async () => {
    const { reportsDir, draftId } = await createDraftFixture({ recipientIdentity: { openId: 'ou_wjh', email: 'wjh@example.com' } })
    await approveCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner' })
    process.env.PMO_FEISHU_IM_DELIVERY_ENABLED = 'true'
    const feishuClient = {
      sendTextMessage: async (input: any) => ({ message_id: 'om_1', input }),
    }

    const result = await deliverCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner', dryRun: false, feishuClient, now: new Date('2026-05-31T03:30:00Z') })

    expect(result).toMatchObject({
      success: true,
      mode: 'feishu_im',
      receiveIdType: 'open_id',
      recipient: '王建辉',
    })
    const events = await listCommunicationDraftAuditEvents(reportsDir)
    expect(events[0]).toMatchObject({ action: 'delivery_sent', draftId })
    expect(events[0].note).toBe('open_id:[present]')
    expect(JSON.stringify(events)).not.toContain('ou_wjh')
  })

  it('supports approved Feishu group delivery through chat_id mapping', async () => {
    const { reportsDir, draftId } = await createDraftFixture({ recipientIdentity: { chatId: 'oc_group' } })
    await approveCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner' })
    process.env.PMO_FEISHU_IM_DELIVERY_ENABLED = 'true'
    const feishuClient = {
      sendTextMessage: async (input: any) => ({ message_id: 'om_2', input }),
    }

    const result = await deliverCommunicationDraft({ reportsDir, draftId, actor: 'PMO Owner', dryRun: false, feishuClient, now: new Date('2026-05-31T03:30:00Z') })

    expect(result).toMatchObject({
      success: true,
      mode: 'feishu_im',
      receiveIdType: 'chat_id',
    })
  })
})

async function createDraftFixture(options: { recipientIdentity?: { openId?: string; email?: string; userId?: string; chatId?: string } } = {}): Promise<{ reportsDir: string; draftId: string }> {
  const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-delivery-'))
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
  const [draft] = await createCommunicationDraftsFromReport({
    reportsDir,
    reportPath,
    now: new Date('2026-05-31T03:00:00Z'),
    personDirectory: options.recipientIdentity ? { 王建辉: options.recipientIdentity } : undefined,
  })
  return { reportsDir, draftId: draft.id }
}

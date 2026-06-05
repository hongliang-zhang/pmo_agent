import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFeishuBotHandler, extractFeishuMessageText, isFeishuBotAllowed, verifyFeishuEvent } from '../src/server/feishu-bot.js'

describe('Feishu bot event handler', () => {
  it('answers Feishu URL verification challenges after verification token check', async () => {
    const result = await verifyFeishuEvent({
      body: { token: 'verify-token', challenge: 'challenge-code' },
      verificationToken: 'verify-token',
    })

    expect(result).toEqual({ type: 'challenge', challenge: 'challenge-code' })
  })

  it('rejects events with a mismatched verification token', async () => {
    await expect(verifyFeishuEvent({
      body: { token: 'wrong-token', challenge: 'challenge-code' },
      verificationToken: 'verify-token',
    })).rejects.toThrow('verification token')
  })

  it('extracts text from plain and mention-wrapped Feishu message content', () => {
    expect(extractFeishuMessageText({
      message_type: 'text',
      content: JSON.stringify({ text: '@_user_1 生成日报 2026-06-02' }),
      mentions: [{ key: '@_user_1', name: 'PMO Agent' }],
    })).toBe('生成日报 2026-06-02')
    expect(extractFeishuMessageText({
      message_type: 'text',
      content: JSON.stringify({ text: 'latest report' }),
    })).toBe('latest report')
  })

  it('checks both sender and group allowlists', () => {
    expect(isFeishuBotAllowed({
      sender: { userId: 'u1' },
      chatId: 'chat1',
      chatType: 'p2p',
      allowedUserIds: new Set(),
      allowedChatIds: new Set(),
    })).toBe(false)

    expect(isFeishuBotAllowed({
      sender: { userId: 'u1' },
      chatId: 'chat1',
      chatType: 'group',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(['chat1']),
    })).toBe(true)

    expect(isFeishuBotAllowed({
      sender: { userId: 'u2' },
      chatId: 'chat1',
      chatType: 'group',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(['chat1']),
    })).toBe(false)

    expect(isFeishuBotAllowed({
      sender: { userId: 'u1' },
      chatId: 'chat2',
      chatType: 'group',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(['chat1']),
    })).toBe(false)
  })

  it('replies to allowed users with latest report links and does not run writeback actions', async () => {
    const sent: Array<{ receiveIdType: string; receiveId: string; text: string }> = []
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(),
      publicBaseUrl: 'https://pmo.hongliang.app',
      sendText: async input => {
        sent.push(input)
      },
      runDaily: vi.fn(),
    })

    const result = await handler.handle({
      body: feishuMessageEvent({
        token: 'verify-token',
        text: '最新日报',
        userId: 'u1',
        openId: 'ou1',
        chatId: 'ou1',
        chatType: 'p2p',
      }),
    })

    expect(result).toEqual({ status: 200, body: { success: true } })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ receiveIdType: 'open_id', receiveId: 'ou1' })
    expect(sent[0]?.text).toContain('latest-pmo-audit.html')
    expect(sent[0]?.text).toContain('ops-dashboard.html')
  })

  it('runs a daily report command for an allowed sender and sends completion summary', async () => {
    const sent: Array<{ text: string }> = []
    const runDaily = vi.fn(async () => ({
      id: 'run-2026-06-02',
      status: 'success',
      date: '2026-06-02',
      startedAt: '2026-06-02T01:00:00.000Z',
      finishedAt: '2026-06-02T01:01:00.000Z',
      artifacts: { reportHtmlPath: '/persistent/reports/2026-06-02-pmo-audit.html' },
    } as const))
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(),
      publicBaseUrl: 'https://pmo.hongliang.app',
      sendText: async input => {
        sent.push({ text: input.text })
      },
      runDaily,
    })

    const result = await handler.handle({
      body: feishuMessageEvent({
        token: 'verify-token',
        text: '生成日报 2026-06-02',
        userId: 'u1',
        openId: 'ou1',
        chatId: 'ou1',
        chatType: 'p2p',
      }),
    })

    expect(result.status).toBe(200)
    expect(runDaily).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-06-02' }))
    expect(sent.at(-1)?.text).toContain('日报已生成')
    expect(sent.at(-1)?.text).toContain('2026-06-02-pmo-audit.html')
  })

  it('answers natural language PMO questions from the latest local report', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-bot-natural-'))
    await writeFile(join(reportsDir, '2026-06-02-pmo-audit.json'), JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-06-02',
      date: '2026-06-02',
      summary: { stories: 1, focused: 1, suppressed: 0, highPriorityRisks: 1, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
      storyAudits: [{
        story: { id: 'S1', title: '企业套餐购买', status: '开发阶段', owners: [{ name: '王建辉' }], linkedDocs: [], fields: {} },
        evidence: [],
        risks: [{
          id: 'S1:missing_goal',
          storyId: 'S1',
          type: 'missing_goal',
          severity: 'high',
          priority: 'P1',
          description: '需求缺少明确目标。',
          evidenceIds: [],
          suggestedAction: '找 owner 补目标。',
          ownerToContact: { name: '王建辉' },
        }],
        confidence: 'confirmed',
        progressSummary: 'MR 已打开。',
      }],
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
    }))
    const sent: Array<{ text: string }> = []
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(),
      reportsDir,
      publicBaseUrl: 'https://pmo.hongliang.app',
      sendText: async input => {
        sent.push({ text: input.text })
      },
      runDaily: vi.fn(),
    })

    const result = await handler.handle({
      body: feishuMessageEvent({
        token: 'verify-token',
        text: '今天有哪些风险？',
        userId: 'u1',
        openId: 'ou1',
        chatId: 'ou1',
        chatType: 'p2p',
      }),
    })

    expect(result.status).toBe(200)
    expect(sent.at(-1)?.text).toContain('企业套餐购买')
    expect(sent.at(-1)?.text).toContain('找 owner 补目标')
  })

  it('deduplicates repeated Feishu events by event id', async () => {
    const sent: Array<{ text: string }> = []
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      publicBaseUrl: 'https://pmo.hongliang.app',
      sendText: async input => {
        sent.push({ text: input.text })
      },
    })
    const body = feishuMessageEvent({
      token: 'verify-token',
      text: '最新日报',
      userId: 'u1',
      openId: 'ou1',
      chatId: 'ou1',
      chatType: 'p2p',
      eventId: 'ev-duplicate',
    })

    await handler.handle({ body })
    const repeated = await handler.handle({ body })

    expect(sent).toHaveLength(1)
    expect(repeated).toEqual({ status: 200, body: { success: true, skipped: true, reason: 'duplicate_event' } })
  })

  it('ignores group messages that do not mention the bot', async () => {
    const sent: Array<{ text: string }> = []
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(['chat1']),
      botOpenId: 'ou_bot',
      sendText: async input => {
        sent.push({ text: input.text })
      },
    })

    const result = await handler.handle({
      body: feishuMessageEvent({
        token: 'verify-token',
        text: '最新日报',
        userId: 'u1',
        openId: 'ou1',
        chatId: 'chat1',
        chatType: 'group',
        mentions: [],
      }),
    })

    expect(result).toEqual({ status: 200, body: { success: true, skipped: true, reason: 'not_mentioned' } })
    expect(sent).toHaveLength(0)
  })
})

function feishuMessageEvent(input: {
  token: string
  text: string
  userId: string
  openId: string
  chatId: string
  chatType: 'p2p' | 'group'
  eventId?: string
  mentions?: Array<Record<string, unknown>>
}): unknown {
  return {
    schema: '2.0',
    header: {
      token: input.token,
      event_id: input.eventId ?? `ev-${input.text}`,
      event_type: 'im.message.receive_v1',
    },
    event: {
      sender: {
        sender_id: {
          user_id: input.userId,
          open_id: input.openId,
        },
      },
      message: {
        message_id: `om-${input.text}`,
        chat_id: input.chatId,
        chat_type: input.chatType,
        message_type: 'text',
        content: JSON.stringify({ text: input.text }),
        mentions: input.mentions,
      },
    },
  }
}

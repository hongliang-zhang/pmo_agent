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

  it('routes natural language PMO questions to the Open WebUI-compatible agent', async () => {
    const sent: Array<{ text: string }> = []
    const answerQuestion = vi.fn(async () => ({
      intent: 'model_grounded_pmo_answer',
      confidence: 'medium',
      text: '### 实时判断\n企业套餐购买存在目标缺失风险。',
    } as const))
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      allowedChatIds: new Set(),
      publicBaseUrl: 'https://pmo.hongliang.app',
      sendText: async input => {
        sent.push({ text: input.text })
      },
      runDaily: vi.fn(),
      answerQuestion,
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
    expect(answerQuestion).toHaveBeenCalledWith(expect.objectContaining({
      latestMessage: '今天有哪些风险？',
      messages: [{ role: 'user', content: '今天有哪些风险？' }],
    }))
    expect(sent.at(-1)?.text).toContain('企业套餐购买')
    expect(sent.at(-1)?.text).not.toContain('我还不能可靠理解这个问题')
  })

  it('adds an ack reaction to the incoming message and removes it after replying', async () => {
    const sent: Array<{ text: string }> = []
    const addReaction = vi.fn(async () => ({ reactionId: 'reaction-1', raw: {} }))
    const deleteReaction = vi.fn(async () => undefined)
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      sendText: async input => {
        sent.push({ text: input.text })
      },
      addReaction,
      deleteReaction,
      answerQuestion: vi.fn(async () => ({
        intent: 'model_grounded_pmo_answer',
        confidence: 'medium',
        text: '### 回复\n已收到并处理。',
      } as const)),
    })

    await handler.handle({
      body: feishuMessageEvent({
        token: 'verify-token',
        text: 'hi',
        userId: 'u1',
        openId: 'ou1',
        chatId: 'ou1',
        chatType: 'p2p',
        eventId: 'ev-ack',
      }),
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).not.toBe('👀')
    expect(addReaction).toHaveBeenCalledWith({ messageId: 'om-hi', emojiType: 'SMILE' })
    expect(deleteReaction).toHaveBeenCalledWith({ messageId: 'om-hi', reactionId: 'reaction-1' })
  })

  it('keeps Feishu conversation history for follow-up questions', async () => {
    const sent: Array<{ text: string }> = []
    const answerQuestion = vi.fn(async input => ({
      intent: 'model_grounded_pmo_answer',
      confidence: 'medium',
      text: input.latestMessage.includes('他在 gitlab')
        ? '### GitLab 进展\n根据上一轮的“王建辉”继续查询。'
        : '### 人员状态\n王建辉最近在企业套餐购买需求上有进展。',
    } as const))
    const handler = createFeishuBotHandler({
      verificationToken: 'verify-token',
      allowedUserIds: new Set(['u1']),
      sendText: async input => {
        sent.push({ text: input.text })
      },
      answerQuestion,
    })

    await handler.handle({
      body: feishuMessageEvent({
        token: 'verify-token',
        text: '王建辉在做什么？',
        userId: 'u1',
        openId: 'ou1',
        chatId: 'ou1',
        chatType: 'p2p',
        eventId: 'ev-person',
      }),
    })
    await handler.handle({
      body: feishuMessageEvent({
        token: 'verify-token',
        text: '他在 gitlab 里有没有更新？',
        userId: 'u1',
        openId: 'ou1',
        chatId: 'ou1',
        chatType: 'p2p',
        eventId: 'ev-follow-up',
      }),
    })

    expect(sent).toHaveLength(2)
    expect(answerQuestion).toHaveBeenCalledTimes(2)
    expect(answerQuestion.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: '王建辉在做什么？' },
      expect.objectContaining({ role: 'assistant', content: expect.stringContaining('王建辉最近') }),
      { role: 'user', content: '他在 gitlab 里有没有更新？' },
    ])
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

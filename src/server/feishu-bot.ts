import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { FeishuOpenApiClient } from '../feishu/openapi.js'
import { runDailyAgentCycle, type PmoRunRecord } from './runs.js'
import type { PmoAgentAnswer } from './agent-chat.js'
import { answerPmoQuestionForOpenWebUi, renderAnswerForChat } from './openai-compatible.js'

export interface FeishuBotSender {
  openId?: string
  userId?: string
  unionId?: string
}

export interface FeishuBotHandleResult {
  status: number
  body: unknown
}

export interface FeishuBotHandlerOptions {
  verificationToken?: string
  encryptKey?: string
  allowedUserIds?: Set<string>
  allowedOpenIds?: Set<string>
  allowedUnionIds?: Set<string>
  allowedChatIds?: Set<string>
  botOpenId?: string
  botUserId?: string
  ackReactionEmoji?: string
  processedEventIds?: Set<string>
  publicBaseUrl?: string
  reportsDir?: string
  sendText?: (input: { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; receiveId: string; text: string }) => Promise<unknown>
  sendMarkdownCard?: (input: { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; receiveId: string; title?: string; markdown: string }) => Promise<unknown>
  addReaction?: (input: { messageId: string; emojiType: string }) => Promise<{ reactionId?: string; raw: unknown }>
  deleteReaction?: (input: { messageId: string; reactionId: string }) => Promise<unknown>
  runDaily?: (input: { date: string; reportsDir: string }) => Promise<PmoRunRecord>
  answerQuestion?: (input: { latestMessage: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }) => Promise<PmoAgentAnswer>
}

export interface FeishuEventVerificationInput {
  body: any
  verificationToken?: string
  encryptKey?: string
  headers?: Record<string, string | string[] | undefined>
  rawBody?: string
}

export type FeishuEventVerificationResult =
  | { type: 'challenge'; challenge: string }
  | { type: 'event'; body: any }

export function createFeishuBotHandler(options: FeishuBotHandlerOptions = {}): {
  handle: (input: { body: any; headers?: Record<string, string | string[] | undefined>; rawBody?: string }) => Promise<FeishuBotHandleResult>
} {
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl ?? process.env.PMO_PUBLIC_BASE_URL ?? 'https://pmo.hongliang.app')
  const reportsDir = options.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
  const processedEventIds = options.processedEventIds ?? new Set<string>()
  const botOpenId = options.botOpenId ?? process.env.PMO_FEISHU_BOT_OPEN_ID
  const botUserId = options.botUserId ?? process.env.PMO_FEISHU_BOT_USER_ID
  const ackReactionEmoji = options.ackReactionEmoji ?? process.env.PMO_FEISHU_BOT_ACK_REACTION ?? 'SMILE'
  const feishuClient = new FeishuOpenApiClient()
  const sendText = options.sendText ?? (async input => feishuClient.sendTextMessage(input))
  const sendMarkdownCard = options.sendMarkdownCard
    ?? (options.sendText
      ? (async input => options.sendText?.({ receiveIdType: input.receiveIdType, receiveId: input.receiveId, text: markdownToPlainText(input.markdown) }))
      : (async input => feishuClient.sendMarkdownCardMessage(input)))
  const addReaction = options.addReaction
    ?? (options.sendText ? (async () => ({ raw: { skipped: true } })) : (async input => feishuClient.addMessageReaction(input)))
  const deleteReaction = options.deleteReaction
    ?? (options.sendText ? (async () => undefined) : (async input => feishuClient.deleteMessageReaction(input)))
  const answerQuestion = options.answerQuestion ?? answerPmoQuestionForOpenWebUi
  const conversationByThread = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>()
  const runDaily = options.runDaily ?? (async input => runDailyAgentCycle({
    date: input.date,
    reportsDir: input.reportsDir,
    createCommunicationDrafts: true,
    buildPersonDirectory: true,
    createFeishuDoc: false,
    createReportDeliveryDraft: false,
    analyzeWithModels: false,
    enrichContext: true,
  }))

  return {
    async handle(input) {
      const verified = await verifyFeishuEvent({
        body: input.body,
        verificationToken: options.verificationToken ?? process.env.PMO_FEISHU_EVENT_VERIFICATION_TOKEN,
        encryptKey: options.encryptKey ?? process.env.PMO_FEISHU_EVENT_ENCRYPT_KEY,
        headers: input.headers,
        rawBody: input.rawBody,
      })
      if (verified.type === 'challenge') {
        return { status: 200, body: { challenge: verified.challenge } }
      }

      const event = normalizeMessageEvent(verified.body)
      if (!event) return { status: 200, body: { success: true, skipped: true, reason: 'unsupported_event' } }
      if (event.eventId && processedEventIds.has(event.eventId)) {
        await appendBotAuditEvent(reportsDir, { event, decision: 'skipped', reason: 'duplicate_event' })
        return { status: 200, body: { success: true, skipped: true, reason: 'duplicate_event' } }
      }
      if (event.eventId) rememberEventId(processedEventIds, event.eventId)

      const allowed = isFeishuBotAllowed({
        sender: event.sender,
        chatId: event.chatId,
        chatType: event.chatType,
        allowedUserIds: options.allowedUserIds ?? csvSet(process.env.PMO_FEISHU_BOT_ALLOWED_USER_IDS),
        allowedOpenIds: options.allowedOpenIds ?? csvSet(process.env.PMO_FEISHU_BOT_ALLOWED_OPEN_IDS),
        allowedUnionIds: options.allowedUnionIds ?? csvSet(process.env.PMO_FEISHU_BOT_ALLOWED_UNION_IDS),
        allowedChatIds: options.allowedChatIds ?? csvSet(process.env.PMO_FEISHU_BOT_ALLOWED_CHAT_IDS),
      })
      if (!allowed) {
        await appendBotAuditEvent(reportsDir, { event, decision: 'skipped', reason: 'not_allowed' })
        if (process.env.PMO_FEISHU_BOT_DENY_REPLY === 'true') {
          await sendText({ ...replyTarget(event), text: '你暂时没有 PMO Agent 的使用权限。' })
        }
        return { status: 200, body: { success: true, skipped: true, reason: 'not_allowed' } }
      }

      if (event.chatType === 'group' && !isGroupMessageAddressedToBot(event.message, { botOpenId, botUserId })) {
        await appendBotAuditEvent(reportsDir, { event, decision: 'skipped', reason: 'not_mentioned' })
        return { status: 200, body: { success: true, skipped: true, reason: 'not_mentioned' } }
      }

      const text = extractFeishuMessageText(event.message)
      if (!text) {
        await appendBotAuditEvent(reportsDir, { event, decision: 'skipped', reason: 'empty_text' })
        return { status: 200, body: { success: true, skipped: true, reason: 'empty_text' } }
      }

      const target = replyTarget(event)
      const ack = await addAckReaction({ addReaction, messageId: event.message?.message_id, emojiType: ackReactionEmoji })
      try {
        const reply = await executeBotCommand({
          text,
          event,
          publicBaseUrl,
          reportsDir,
          runDaily,
          answerQuestion,
          conversationByThread,
        })
        await sendFormattedReply({ sendMarkdownCard, sendText, target, markdown: reply })
      } finally {
        if (ack?.reactionId && event.message?.message_id) {
          await removeAckReaction({ deleteReaction, messageId: event.message.message_id, reactionId: ack.reactionId })
        }
      }
      await appendBotAuditEvent(reportsDir, { event, decision: 'replied', command: summarizeCommand(text) })
      return { status: 200, body: { success: true } }
    },
  }
}

export async function verifyFeishuEvent(input: FeishuEventVerificationInput): Promise<FeishuEventVerificationResult> {
  if (input.body?.encrypt) {
    throw new Error('Encrypted Feishu events are not supported yet. Disable Encrypt Key for this endpoint or add PMO_FEISHU_EVENT_ENCRYPT_KEY decryption support before enabling encrypted delivery.')
  }

  if (!input.verificationToken) {
    throw new Error('PMO_FEISHU_EVENT_VERIFICATION_TOKEN is required before enabling the Feishu bot webhook.')
  }

  const token = input.body?.token ?? input.body?.header?.token
  if (token !== input.verificationToken) {
    throw new Error('Feishu event verification token mismatch.')
  }

  if (input.encryptKey && input.headers && input.rawBody) {
    verifyFeishuSignature({
      encryptKey: input.encryptKey,
      headers: input.headers,
      rawBody: input.rawBody,
    })
  }

  const challenge = input.body?.challenge
  if (typeof challenge === 'string' && challenge) return { type: 'challenge', challenge }
  return { type: 'event', body: input.body }
}

export function extractFeishuMessageText(message: any): string {
  if (message?.message_type !== 'text') return ''
  let text = ''
  try {
    const parsed = JSON.parse(String(message.content ?? '{}'))
    text = String(parsed.text ?? '')
  } catch {
    text = String(message.content ?? '')
  }
  for (const mention of message.mentions ?? []) {
    if (mention?.key) text = text.replace(String(mention.key), '')
  }
  return text.trim()
}

export function isFeishuBotAllowed(input: {
  sender: FeishuBotSender
  chatId?: string
  chatType?: string
  allowedUserIds?: Set<string>
  allowedOpenIds?: Set<string>
  allowedUnionIds?: Set<string>
  allowedChatIds?: Set<string>
}): boolean {
  const hasUserAllowlist = Boolean(input.allowedUserIds?.size || input.allowedOpenIds?.size || input.allowedUnionIds?.size)
  const hasChatAllowlist = Boolean(input.allowedChatIds?.size)
  if (!hasUserAllowlist) return false
  const senderAllowed = Boolean(input.sender.userId && input.allowedUserIds?.has(input.sender.userId))
      || Boolean(input.sender.openId && input.allowedOpenIds?.has(input.sender.openId))
      || Boolean(input.sender.unionId && input.allowedUnionIds?.has(input.sender.unionId))
  const chatAllowed = !hasChatAllowlist || (Boolean(input.chatId && input.allowedChatIds?.has(input.chatId)))
  return senderAllowed && chatAllowed
}

function normalizeMessageEvent(body: any): {
  eventId?: string
  sender: FeishuBotSender
  chatId: string
  chatType: string
  message: any
} | undefined {
  const eventType = body?.header?.event_type
  if (eventType && eventType !== 'im.message.receive_v1') return undefined
  const event = body?.event
  const message = event?.message
  if (!message) return undefined
  const senderId = event?.sender?.sender_id ?? {}
  return {
    eventId: body?.header?.event_id,
    sender: {
      openId: senderId.open_id,
      userId: senderId.user_id,
      unionId: senderId.union_id,
    },
    chatId: message.chat_id,
    chatType: message.chat_type,
    message,
  }
}

function isGroupMessageAddressedToBot(message: any, bot: { botOpenId?: string; botUserId?: string }): boolean {
  const mentions = Array.isArray(message?.mentions) ? message.mentions : []
  if (mentions.length === 0) return false
  if (!bot.botOpenId && !bot.botUserId) return true
  return mentions.some((mention: any) => {
    const id = mention?.id ?? mention?.mention_id ?? mention?.sender_id ?? {}
    return Boolean(
      (bot.botOpenId && (id.open_id === bot.botOpenId || mention.open_id === bot.botOpenId))
        || (bot.botUserId && (id.user_id === bot.botUserId || mention.user_id === bot.botUserId)),
    )
  })
}

function rememberEventId(processedEventIds: Set<string>, eventId: string): void {
  processedEventIds.add(eventId)
  if (processedEventIds.size <= 1000) return
  const first = processedEventIds.values().next().value as string | undefined
  if (first) processedEventIds.delete(first)
}

async function executeBotCommand(input: {
  text: string
  event: { sender: FeishuBotSender; chatId: string; chatType: string; message: any }
  publicBaseUrl: string
  reportsDir: string
  runDaily: (input: { date: string; reportsDir: string }) => Promise<PmoRunRecord>
  answerQuestion: (input: { latestMessage: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }) => Promise<PmoAgentAnswer>
  conversationByThread: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>
}): Promise<string> {
  const text = input.text.trim()
  if (/^(help|帮助|菜单)$/i.test(text)) return helpMessage()
  if (/^(health|健康|状态)$/i.test(text)) {
    return [
      'PMO Agent 服务正常。',
      `健康检查：${input.publicBaseUrl}/health`,
      `最新日报：${input.publicBaseUrl}/reports/latest-pmo-audit.html`,
    ].join('\n')
  }
  if (/^(latest|最新日报|日报|报告|今日日报)$/i.test(text)) return latestReportMessage(input.publicBaseUrl)

  const runMatch = /^(?:生成日报|跑日报|run report|generate report)\s+(\d{4}-\d{2}-\d{2})$/i.exec(text)
  if (runMatch?.[1]) {
    const date = runMatch[1]
    const run = await input.runDaily({ date, reportsDir: input.reportsDir })
    if (run.status === 'success') {
      const reportPath = (run.artifacts && typeof run.artifacts === 'object' ? (run.artifacts as any).reportHtmlPath : undefined) as string | undefined
      const reportName = reportPath ? basename(reportPath) : `${date}-pmo-audit.html`
      return [
        `日报已生成：${date}`,
        `查看：${input.publicBaseUrl}/reports/${reportName}`,
        `运行记录：${run.id}`,
      ].join('\n')
    }
    return `日报生成失败：${run.error ? JSON.stringify(run.error) : 'unknown error'}`
  }

  const threadKey = feishuConversationKey(input.event)
  const history = input.conversationByThread.get(threadKey) ?? []
  const messages = [...history, { role: 'user' as const, content: text }]
  const answer = await input.answerQuestion({ latestMessage: text, messages })
  const reply = renderAnswerForChat(answer)
  input.conversationByThread.set(threadKey, [...messages, { role: 'assistant' as const, content: reply }].slice(-10))
  return reply
}

function latestReportMessage(publicBaseUrl: string): string {
  return [
    'PMO Agent 最新产物：',
    `日报：${publicBaseUrl}/reports/latest-pmo-audit.html`,
    `报告索引：${publicBaseUrl}/reports/index.html`,
    `运行面板：${publicBaseUrl}/reports/ops-dashboard.html`,
    `审批中心：${publicBaseUrl}/reports/approval-center.html`,
  ].join('\n')
}

function helpMessage(): string {
  return [
    'PMO Agent 已接入 Open WebUI 同款自由对话链路。',
    '你可以直接问项目、人员、风险、GitLab 进展、飞书需求同步等问题。',
    '',
    '保留的运维命令：',
    '最新日报：返回最新日报、索引、运行面板、审批中心链接。',
    '健康：返回服务健康检查入口。',
    '生成日报 YYYY-MM-DD：生成指定中国自然日的本地日报，不自动写飞书项目字段。',
    '',
    '也可以直接问：今天有哪些风险？谁需要沟通？王建辉在做什么？代码有进展但需求没同步的有哪些？',
    '高风险动作只会生成草稿或进入审批，不会直接发送消息或改飞书项目字段。',
  ].join('\n')
}

function replyTarget(event: { sender: FeishuBotSender; chatId: string; chatType: string }): { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; receiveId: string } {
  if (event.chatType === 'group') return { receiveIdType: 'chat_id', receiveId: event.chatId }
  if (event.sender.openId) return { receiveIdType: 'open_id', receiveId: event.sender.openId }
  if (event.sender.userId) return { receiveIdType: 'user_id', receiveId: event.sender.userId }
  if (event.sender.unionId) return { receiveIdType: 'union_id', receiveId: event.sender.unionId }
  return { receiveIdType: 'chat_id', receiveId: event.chatId }
}

function feishuConversationKey(event: { sender: FeishuBotSender; chatId: string; chatType: string }): string {
  const sender = event.sender.openId ?? event.sender.userId ?? event.sender.unionId ?? 'unknown'
  return `${event.chatType}:${event.chatId}:${sender}`
}

async function sendFormattedReply(input: {
  sendMarkdownCard: (message: { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; receiveId: string; title?: string; markdown: string }) => Promise<unknown>
  sendText: (message: { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; receiveId: string; text: string }) => Promise<unknown>
  target: { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; receiveId: string }
  markdown: string
}): Promise<void> {
  try {
    await input.sendMarkdownCard({ ...input.target, title: 'PMO Agent', markdown: input.markdown })
  } catch (error) {
    process.stderr.write(`[pmo-feishu] card_reply_failed ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`)
    await input.sendText({ ...input.target, text: markdownToPlainText(input.markdown) })
  }
}

async function addAckReaction(input: {
  addReaction: (message: { messageId: string; emojiType: string }) => Promise<{ reactionId?: string; raw: unknown }>
  messageId?: string
  emojiType?: string
}): Promise<{ reactionId?: string } | undefined> {
  if (!input.messageId || !input.emojiType) return undefined
  try {
    return await input.addReaction({ messageId: input.messageId, emojiType: input.emojiType })
  } catch (error) {
    process.stderr.write(`[pmo-feishu] ack_reaction_failed ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`)
    return undefined
  }
}

async function removeAckReaction(input: {
  deleteReaction: (message: { messageId: string; reactionId: string }) => Promise<unknown>
  messageId: string
  reactionId: string
}): Promise<void> {
  try {
    await input.deleteReaction({ messageId: input.messageId, reactionId: input.reactionId })
  } catch (error) {
    process.stderr.write(`[pmo-feishu] ack_reaction_delete_failed ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`)
  }
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1：$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
}

function verifyFeishuSignature(input: {
  encryptKey: string
  headers: Record<string, string | string[] | undefined>
  rawBody: string
}): void {
  const timestamp = firstHeader(input.headers, 'x-lark-request-timestamp')
  const nonce = firstHeader(input.headers, 'x-lark-request-nonce')
  const signature = firstHeader(input.headers, 'x-lark-signature')
  if (!timestamp || !nonce || !signature) return
  const digest = createHmac('sha256', input.encryptKey).update(`${timestamp}${nonce}${input.rawBody}`).digest('hex')
  const expected = Buffer.from(digest)
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Feishu event signature mismatch.')
  }
}

function firstHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map(item => item.trim()).filter(Boolean))
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

async function appendBotAuditEvent(
  reportsDir: string,
  input: {
    event: { eventId?: string; sender: FeishuBotSender; chatId: string; chatType: string; message: any }
    decision: 'replied' | 'skipped'
    reason?: string
    command?: string
  },
): Promise<void> {
  try {
    const path = `${reportsDir.replace(/\/+$/, '')}/feishu-bot-events.json`
    await mkdir(reportsDir, { recursive: true })
    let existing: unknown[] = []
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      if (Array.isArray(parsed)) existing = parsed
    } catch {
      existing = []
    }
    const record = {
      at: new Date().toISOString(),
      eventId: input.event.eventId,
      decision: input.decision,
      reason: input.reason,
      command: input.command,
      chatType: input.event.chatType,
      chatId: redactId(input.event.chatId),
      sender: {
        userId: redactId(input.event.sender.userId),
        openId: redactId(input.event.sender.openId),
        unionId: redactId(input.event.sender.unionId),
      },
      messageType: input.event.message?.message_type,
      hasMentions: Array.isArray(input.event.message?.mentions) && input.event.message.mentions.length > 0,
    }
    await writeFile(path, `${JSON.stringify([record, ...existing].slice(0, 200), null, 2)}\n`, 'utf8')
  } catch {
    // Bot replies should not fail just because local audit persistence failed.
  }
}

function redactId(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function summarizeCommand(text: string): string {
  if (/^(help|帮助|菜单)$/i.test(text)) return 'help'
  if (/^(latest|最新日报|日报|报告|今日日报)$/i.test(text)) return 'latest_report'
  if (/^(health|健康|状态)$/i.test(text)) return 'health'
  if (/^(?:生成日报|跑日报|run report|generate report)\s+\d{4}-\d{2}-\d{2}$/i.test(text)) return 'generate_report'
  return 'natural_language'
}

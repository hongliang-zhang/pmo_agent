import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadConfig, type AppConfig } from '../config.js'
import { FeishuProjectMcpClient } from '../feishu/project-mcp.js'
import { collectGitLabEvidence } from '../gitlab/collector.js'
import { GitLabClient, type GitLabProject, type GitLabUser, type GitLabUserEvent } from '../gitlab/client.js'
import { enrichGitLabEvidenceAuthors } from '../identity/gitlab-feishu.js'
import type { Evidence } from '../domain.js'
import type { PmoAgentAnswer } from './agent-chat.js'

const MODEL_ID = 'pmo-agent'

export async function handleOpenAiCompatibleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const pathname = new URL(req.url ?? '', 'http://localhost').pathname
  if (!pathname.startsWith('/v1/')) return false

  if (!isOpenAiAuthorized(req)) {
    sendJson(res, 401, { error: { message: 'Invalid PMO OpenAI-compatible API key', type: 'authentication_error' } })
    return true
  }

  if (req.method === 'GET' && pathname === '/v1/models') {
    sendJson(res, 200, {
      object: 'list',
      data: [{
        id: MODEL_ID,
        object: 'model',
        created: 0,
        owned_by: 'pmo-agent',
      }],
    })
    return true
  }

  if (req.method === 'POST' && pathname === '/v1/chat/completions') {
    const body = await readJson(req)
    const messages = Array.isArray(body?.messages) ? body.messages : []
    const message = extractLatestUserMessage(messages)
    if (!message) {
      sendJson(res, 400, { error: { message: 'messages must include a user message', type: 'invalid_request_error' } })
      return true
    }

    const answer = isOpenWebUiMetaTask(message)
      ? openWebUiMetaTaskAnswer(message)
      : await answerPmoQuestionForOpenWebUi({ latestMessage: message, messages })
    const content = renderAnswerForChat(answer)
    logChatRequest({ model: body?.model ?? MODEL_ID, message, answer })

    if (body?.stream === true) {
      sendChatCompletionStream(res, body?.model ?? MODEL_ID, content)
    } else {
      sendJson(res, 200, chatCompletion(body?.model ?? MODEL_ID, content))
    }
    return true
  }

  sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } })
  return true
}

export async function answerPmoQuestionForOpenWebUi(input: { latestMessage: string; messages: any[] }): Promise<PmoAgentAnswer> {
  if (!process.env.ZAI_API_KEY) {
    return llmUnavailableAnswer('缺少 ZAI_API_KEY，无法进行 LLM 分析。')
  }

  try {
    const config = await loadConfig()
    const standaloneQuestion = await buildStandaloneQuestionFromMessages(input.messages, input.latestMessage)
    if (standaloneQuestion !== input.latestMessage) {
      process.stdout.write(`[pmo-openai] standalone_question ${JSON.stringify({ original: input.latestMessage.slice(0, 300), rewritten: standaloneQuestion.slice(0, 300) })}\n`)
    }
    const liveContext = await buildLiveQuestionContext(standaloneQuestion, config, {
      originalQuestion: input.latestMessage,
      conversation: compactConversationForModel(input.messages),
    })
    const modelAnswer = await answerWithZaiModel(standaloneQuestion, liveContext)
    if (modelAnswer) return modelAnswer
  } catch (error) {
    process.stderr.write(`[pmo-openai] zai_answer_failed ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`)
    return llmUnavailableAnswer(`LLM 分析失败：${error instanceof Error ? error.message : String(error)}`)
  }

  return llmUnavailableAnswer('LLM 未返回有效内容，无法生成可信回答。')
}

function llmUnavailableAnswer(reason: string): PmoAgentAnswer {
  return {
    intent: 'llm_unavailable',
    confidence: 'low',
    text: [
      '当前问题没有生成 PMO 结论。',
      reason,
      '为避免答非所问，我不会使用关键词规则或通用列表代替 LLM 分析。请稍后重试，或先检查模型服务/API key 配置。',
    ].join('\n'),
  }
}

function isOpenWebUiMetaTask(message: string): boolean {
  return /^### Task:\s*(Suggest|Generate)\b/i.test(message.trim())
}

function openWebUiMetaTaskAnswer(message: string): PmoAgentAnswer {
  if (/title/i.test(message)) {
    return { intent: 'openwebui_meta', confidence: 'high', text: 'PMO 状态核查' }
  }
  if (/tag/i.test(message)) {
    return { intent: 'openwebui_meta', confidence: 'high', text: '项目管理, PMO, GitLab' }
  }
  return {
    intent: 'openwebui_meta',
    confidence: 'high',
    text: [
      '可以继续问：',
      '1. 他在 GitLab 里有没有更新？',
      '2. 这个需求现在有什么风险？',
      '3. 下一步应该找谁确认？',
    ].join('\n'),
  }
}

async function answerWithZaiModel(message: string, context: Record<string, unknown>): Promise<PmoAgentAnswer | undefined> {
  const apiKey = process.env.ZAI_API_KEY
  if (!apiKey) return undefined

  const baseUrl = (process.env.ZAI_OPENAI_BASE_URL ?? 'https://open.bigmodel.cn/api/coding/paas/v4').replace(/\/$/, '')
  const model = process.env.PMO_CHAT_MODEL ?? process.env.PMO_RISK_MODEL ?? process.env.PMO_DAILY_MODEL ?? 'glm-5.1'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PMO_CHAT_MODEL_TIMEOUT_MS ?? 90_000))
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            '你是 MAAS_平台 PMO 状态核查 agent。',
            '只能基于用户提供的 PMO_CONTEXT 回答，不要编造不存在的需求、人员、进展或风险。',
            'PMO_CONTEXT 是本次请求实时查询结果，不是日报快照。',
            '如果上下文里找不到用户问的对象，例如某个版本号、项目名或人名，必须明确说“本次实时查询未找到相关记录”，并说明你检索了哪些实时字段。',
            '回答要直接对应用户问题；如果用户带限定条件，必须先应用限定条件，再总结风险和下一步。',
            '每条结论必须给出证据字段或置信度。不要输出通用风险列表来替代限定查询。',
            '如果涉及发送消息、更新字段、删除数据，只能给草稿或建议，不能声称已经执行。',
            '输出要克制：默认使用三级 Markdown 标题（###）；结构较多时可少量使用二级标题（##）；只有特别长且复杂的报告才使用一级标题（#）。',
            '事实源优先级：1) referencedFeishuWorkItems 实时详情；2) liveFeishuStories 实时飞书项目列表；3) liveGitLabEvidence 实时 GitLab 交付证据。',
            '当用户问某个人时，必须区分“该人的直接 GitLab 记录”和“他创建/负责需求相关 owner 的 GitLab 记录”；如果 liveGitLabEvidence 中存在 type=gitlab_user_event 且 author/authorName 指向该人，不得回答该人没有 GitLab 更新。',
            '描述 GitLab 记录时，必须尽量列出可点击链接、项目、MR/commit 标题、分支、commit SHA、变更文件；如果只有标题没有 diff，要明确说明证据粒度有限。',
            '如果 liveFeishuStories.selectedCount 大于 0，必须先列出这些飞书需求，不能回答“飞书项目未找到相关记录”。',
            '不要引用“日报”作为事实源；如果用户问为什么日报没有，说明当前回答没有使用日报数据。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `PMO_CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nUSER_QUESTION:\n${message}`,
        },
      ],
    }),
  }).finally(() => clearTimeout(timeout))

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`ZAI chat completion failed: ${response.status} ${raw.slice(0, 300)}`)
  }
  const data = JSON.parse(raw)
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) return undefined

  return {
    intent: 'model_grounded_pmo_answer',
    confidence: 'medium',
    text: text.trim(),
    links: commonLinks(),
  }
}

async function buildLiveQuestionContext(
  message: string,
  config: AppConfig,
  conversationContext: { originalQuestion?: string; conversation?: Array<{ role: string; content: string }> } = {},
): Promise<Record<string, unknown>> {
  const retrievalProfile = await buildRetrievalProfile(message)
  const [personIdentities, referencedFeishuWorkItems, liveFeishuStories] = await Promise.all([
    timedLiveStep('person_identities', () => resolvePeopleIdentities(retrievalProfile, config), Number(process.env.PMO_CHAT_PERSON_TIMEOUT_MS ?? 20_000)),
    timedLiveStep('referenced_feishu_work_items', () => fetchReferencedFeishuWorkItems(message, config), Number(process.env.PMO_CHAT_REFERENCED_ITEM_TIMEOUT_MS ?? 30_000)),
    timedLiveStep('live_feishu_stories', () => fetchLiveFeishuStories(config), Number(process.env.PMO_CHAT_FEISHU_TIMEOUT_MS ?? 90_000)),
  ])
  const profileWithProjectUsers = expandRetrievalProfileWithStoryPeople(
    expandRetrievalProfileWithPeople(retrievalProfile, personIdentities),
    liveFeishuStories,
  )
  const liveGitLabEvidence = await timedLiveStep(
    'live_gitlab_evidence',
    () => fetchLiveGitLabEvidence(config, profileWithProjectUsers),
    Number(process.env.PMO_CHAT_GITLAB_TIMEOUT_MS ?? 90_000),
  )
  const focused = focusLiveContext({ retrievalProfile: profileWithProjectUsers, referencedFeishuWorkItems, liveFeishuStories, liveGitLabEvidence })
  return {
    sourcePolicy: 'This context is fetched live for every request. Do not use PMO daily report snapshots as facts.',
    fetchedAt: new Date().toISOString(),
    originalQuestion: conversationContext.originalQuestion,
    standaloneQuestion: message,
    recentConversation: conversationContext.conversation ?? [],
    retrievalProfile: profileWithProjectUsers,
    personIdentities,
    referencedIds: extractFeishuWorkItemIds(message),
    ...focused,
  }
}

interface RetrievalProfile {
  questionSummary: string
  focusTerms: string[]
  requiredStoryIds: string[]
  people: string[]
  timeHints: string[]
  personIdentityTerms?: string[]
  retrievalError?: string
}

interface PersonIdentityMatch {
  query: string
  name: string
  email?: string
  userKey?: string
  larkUserId?: string
  openId?: string
}

async function buildRetrievalProfile(message: string): Promise<RetrievalProfile> {
  const apiKey = process.env.ZAI_API_KEY
  if (!apiKey) throw new Error('缺少 ZAI_API_KEY，无法理解问题并生成实时检索画像。')
  const startedAt = Date.now()
  const baseUrl = (process.env.ZAI_OPENAI_BASE_URL ?? 'https://open.bigmodel.cn/api/coding/paas/v4').replace(/\/$/, '')
  const model = process.env.PMO_CHAT_RETRIEVAL_MODEL ?? process.env.PMO_CHAT_MODEL ?? 'glm-5-turbo'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PMO_CHAT_RETRIEVAL_TIMEOUT_MS ?? 20_000))
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: Number(process.env.PMO_CHAT_RETRIEVAL_MAX_TOKENS ?? 800),
        messages: [
          {
            role: 'system',
            content: [
              '你是 PMO Agent 的实时检索规划器。',
              '把用户问题转成极短 JSON，不要回答业务结论，不要解释。',
              '输出字段：questionSummary, focusTerms, requiredStoryIds, people, timeHints。',
              'focusTerms 包含版本号、项目名、模块名、需求标题关键词、英文别名、中文别名；不要加入泛化词，比如 风险、进展、需求。',
            ].join('\n'),
          },
          { role: 'user', content: message },
        ],
      }),
    }).finally(() => clearTimeout(timeout))
    const raw = await response.text()
    if (!response.ok) throw new Error(`ZAI retrieval profile failed: ${response.status} ${raw.slice(0, 300)}`)
    const text = JSON.parse(raw)?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) throw new Error('ZAI retrieval profile returned empty content')
    const parsed = safeJsonObject(text)
    const profile = normalizeRetrievalProfile(parsed, message)
    process.stdout.write(`[pmo-openai] retrieval_profile ${JSON.stringify({ source: 'llm', focusTerms: profile.focusTerms, requiredStoryIds: profile.requiredStoryIds, people: profile.people, durationMs: Date.now() - startedAt })}\n`)
    return profile
  } catch (error) {
    const profile = fallbackRetrievalProfile(message, error instanceof Error ? error.message : String(error))
    process.stderr.write(`[pmo-openai] retrieval_profile ${JSON.stringify({ source: 'fallback_after_llm_failure', error: profile.retrievalError, focusTerms: profile.focusTerms, requiredStoryIds: profile.requiredStoryIds, people: profile.people, durationMs: Date.now() - startedAt })}\n`)
    return profile
  }
}

export async function buildStandaloneQuestionFromMessages(
  messages: any[],
  latestMessage: string = extractLatestUserMessage(messages) ?? '',
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const conversation = compactConversationForModel(messages)
  const previous = conversation.slice(0, -1)
  if (!previous.length || !/(他|她|\bta\b|这个|该需求|这件事|它)/i.test(latestMessage)) {
    return latestMessage.trim()
  }

  const apiKey = process.env.ZAI_API_KEY
  if (!apiKey) return latestMessage.trim()
  const baseUrl = (process.env.ZAI_OPENAI_BASE_URL ?? 'https://open.bigmodel.cn/api/coding/paas/v4').replace(/\/$/, '')
  const model = process.env.PMO_CHAT_RETRIEVAL_MODEL ?? process.env.PMO_CHAT_MODEL ?? 'glm-5-turbo'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PMO_CHAT_REWRITE_TIMEOUT_MS ?? 15_000))
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: Number(process.env.PMO_CHAT_REWRITE_MAX_TOKENS ?? 300),
        messages: [
          {
            role: 'system',
            content: [
              '你是 PMO Agent 的多轮问题消解器。',
              '根据最近对话，把最新用户问题改写成一个可独立检索的问题。',
              '必须解析“他/她/ta/这个/该需求/这件事”等指代，替换成明确的人名、需求标题或需求 ID。',
              '不要回答问题，不要补充不存在的信息。只输出改写后的单句问题。',
              '如果历史无法确定指代对象，原样输出最新问题。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `RECENT_CONVERSATION:\n${JSON.stringify(conversation, null, 2)}\n\nLATEST_USER_QUESTION:\n${latestMessage}`,
          },
        ],
      }),
    }).finally(() => clearTimeout(timeout))
    const raw = await response.text()
    if (!response.ok) throw new Error(`rewrite failed: ${response.status} ${raw.slice(0, 200)}`)
    const text = JSON.parse(raw)?.choices?.[0]?.message?.content
    const rewritten = typeof text === 'string' ? text.trim().replace(/^["“]|["”]$/g, '') : ''
    return resolveRemainingPronouns(rewritten || latestMessage.trim(), previous)
  } catch (error) {
    process.stderr.write(`[pmo-openai] standalone_question_failed ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`)
    return resolveRemainingPronouns(latestMessage.trim(), previous)
  }
}

function resolveRemainingPronouns(question: string, previousConversation: Array<{ role: string; content: string }>): string {
  if (!/(他|她|\bta\b|这个|该需求|这件事|它)/i.test(question)) return question
  const entity = findRecentConversationEntity(previousConversation, question)
  if (!entity) return question
  const replaced = question
    .replace(/\bta\b/ig, entity)
    .replace(/他|她/g, entity)
    .replace(/这个|该需求|这件事|它/g, entity)
  return replaced === question ? question : replaced
}

function findRecentConversationEntity(previousConversation: Array<{ role: string; content: string }>, question: string): string | undefined {
  const preferPerson = /(他|她|\bta\b)/i.test(question)
  for (let index = previousConversation.length - 1; index >= 0; index -= 1) {
    const content = previousConversation[index]?.content ?? ''
    const people = extractFallbackPeople(content).filter(name => !/^(他|她|它)$/.test(name))
    const fullName = people.find(name => name.length >= 3)
    const person = fullName ?? people[0]
    if (preferPerson && person) return person
    const storyId = extractFeishuWorkItemIds(content)[0]
    if (storyId) return storyId
    if (person) return person
  }
  return undefined
}

function compactConversationForModel(messages: any[]): Array<{ role: string; content: string }> {
  return messages
    .filter(message => message?.role === 'user' || message?.role === 'assistant')
    .map(message => ({ role: String(message.role), content: stringifyMessageContent(message.content).slice(0, 1200) }))
    .filter(message => message.content && !isOpenWebUiMetaTask(message.content))
    .slice(-8)
}

function normalizeRetrievalProfile(parsed: Record<string, unknown>, message: string): RetrievalProfile {
  return {
    questionSummary: String(parsed.questionSummary ?? message).slice(0, 300),
    focusTerms: normalizeStringList(parsed.focusTerms),
    requiredStoryIds: [...new Set([...normalizeStringList(parsed.requiredStoryIds), ...extractFeishuWorkItemIds(message)])],
    people: normalizeStringList(parsed.people),
    timeHints: normalizeStringList(parsed.timeHints),
  }
}

export function fallbackRetrievalProfile(message: string, retrievalError?: string): RetrievalProfile {
  const people = extractFallbackPeople(message)
  return {
    questionSummary: message.slice(0, 300),
    focusTerms: [...extractFeishuWorkItemIds(message), ...people],
    requiredStoryIds: extractFeishuWorkItemIds(message),
    people: [...new Set(people)],
    timeHints: /最近|这周|本周/.test(message) ? ['最近'] : [],
    retrievalError,
  }
}

function extractFallbackPeople(message: string): string[] {
  const blocked = new Set(['给我', '一下', '最近', '需求', '项目', '代码', '更新', '什么', '没有', '无法', '判断', '飞书', '这个', '那个', '他在', '她在'])
  const patterns = [
    /(?:看一下|看看|查一下|查查|关于|分析)?([\u4e00-\u9fa5]{2,4}?)(?:最近|这周|本周|在做|负责|的需求)/g,
    /([\u4e00-\u9fa5]{2,4})(?:在\s*)?(?:gitlab|GitLab|代码|仓库|MR|commit|pipeline)/g,
    /([\u4e00-\u9fa5]{2,4})(?:有没有|是否有|有无).*(?:更新|提交|MR|commit|代码)/g,
  ]
  const people = patterns.flatMap(pattern => [...message.matchAll(pattern)].map(match => match[1] ?? ''))
    .map(name => name.trim())
    .filter(name => name.length >= 2 && !blocked.has(name) && !/^(他|她|它|这个|那个)$/.test(name) && !/(最近|这里|那里|里最|有没有|是否)/.test(name))
  return [...new Set(people)]
}

export function expandRetrievalProfileWithPeople(profile: RetrievalProfile, personIdentities: unknown): RetrievalProfile {
  const identities = Array.isArray(personIdentities) ? personIdentities as PersonIdentityMatch[] : []
  const identityTerms = normalizeStringList([
    ...(profile.personIdentityTerms ?? []),
    ...identities.flatMap(identity => [
      identity.name,
      identity.email,
      identity.userKey,
      identity.larkUserId,
      identity.openId,
    ]),
  ])
  return {
    ...profile,
    personIdentityTerms: identityTerms,
  }
}

export function expandRetrievalProfileWithStoryPeople(profile: RetrievalProfile, liveFeishuStories: unknown): RetrievalProfile {
  const storySource = liveFeishuStories as any
  const stories = Array.isArray(storySource?.stories) ? storySource.stories : []
  const personTerms = [
    ...profile.people,
    ...profile.focusTerms.filter(term => isLikelyPersonAlias(term)),
  ].map(normalizeForMatch).filter(Boolean)
  if (!personTerms.length || !stories.length) return profile

  const selectedStories = selectRelevantItems(stories, personTerms, profile.requiredStoryIds, 80)
  const matchedIdentities: PersonIdentityMatch[] = []
  for (const story of selectedStories as any[]) {
    const people = [
      ...(Array.isArray(story?.owners) ? story.owners : []),
      story?.creator,
    ].filter(Boolean) as Array<Record<string, unknown>>
    for (const person of people) {
      const text = normalizeForMatch([
        stringValue(person.name),
        stringValue(person.email),
        stringValue(person.username),
        stringValue(person.userKey),
        stringValue(person.larkUserId),
        stringValue(person.openId),
      ].filter(Boolean).join(' '))
      const matchedTerm = personTerms.find(term => text.includes(term))
      if (!matchedTerm) continue
      matchedIdentities.push({
        query: matchedTerm,
        name: stringValue(person.name) ?? '',
        email: stringValue(person.email),
        userKey: stringValue(person.userKey),
        larkUserId: stringValue(person.larkUserId),
        openId: stringValue(person.openId),
      })
    }
  }
  return expandRetrievalProfileWithPeople(profile, matchedIdentities)
}

function isLikelyPersonAlias(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(text)) return true
  return /^[a-z][a-z._-]{2,30}$/i.test(text) && !/(gitlab|github|需求|项目|代码|更新|风险|进展)/i.test(text)
}

export function focusLiveContext(input: {
  retrievalProfile: RetrievalProfile
  referencedFeishuWorkItems: unknown
  liveFeishuStories: unknown
  liveGitLabEvidence: unknown
}): Record<string, unknown> {
  const terms = [
    ...input.retrievalProfile.focusTerms,
    ...input.retrievalProfile.requiredStoryIds,
    ...input.retrievalProfile.people,
    ...(input.retrievalProfile.personIdentityTerms ?? []),
  ].map(normalizeForMatch).filter(Boolean)
  const storySource = input.liveFeishuStories as any
  const evidenceSource = input.liveGitLabEvidence as any
  const stories = Array.isArray(storySource?.stories) ? storySource.stories : []
  const evidence = Array.isArray(evidenceSource?.evidence) ? evidenceSource.evidence : []
  const selectedStories = selectRelevantItems(stories, terms, input.retrievalProfile.requiredStoryIds, 40).map(compactStoryForModel)
  const storyPersonTerms = extractPersonTermsFromStories(selectedStories)
  const evidenceLimit = input.retrievalProfile.people.length ? 30 : 80
  const directPersonTerms = [
    ...input.retrievalProfile.people,
    ...(input.retrievalProfile.personIdentityTerms ?? []),
  ].map(normalizeForMatch).filter(Boolean)
  const evidenceTerms = [...terms, ...storyPersonTerms.map(normalizeForMatch).filter(Boolean)]
  const directPersonEvidence = directPersonTerms.length
    ? selectRelevantItems(evidence, directPersonTerms, [], Math.min(15, evidenceLimit))
    : []
  const selectedEvidence = mergeUniqueEvidence([
    ...directPersonEvidence,
    ...selectRelevantItems(evidence, evidenceTerms, [], evidenceLimit),
  ]).slice(0, evidenceLimit).map(compactEvidenceForModel)
  return {
    selectionSummary: {
      people: input.retrievalProfile.people,
      personIdentityTerms: input.retrievalProfile.personIdentityTerms ?? [],
      storyPersonTerms,
      feishuStoryIds: selectedStories.map(story => story.id),
      gitLabEvidenceIds: selectedEvidence.map(item => item.id),
    },
    liveFeishuStories: {
      fetchedAt: storySource?.fetchedAt,
      scope: storySource?.scope,
      totalFetched: storySource?.count ?? stories.length,
      selectedCount: selectedStories.length,
      selectionPolicy: 'All stories were fetched live, then LLM-planned query terms selected the evidence sent to the final model to stay within context limits.',
      stories: selectedStories,
      error: storySource?.error,
    },
    referencedFeishuWorkItems: input.referencedFeishuWorkItems,
    liveGitLabEvidence: {
      fetchedAt: evidenceSource?.fetchedAt,
      lookbackDays: evidenceSource?.lookbackDays,
      group: evidenceSource?.group,
      totalFetched: evidenceSource?.count ?? evidence.length,
      selectedCount: selectedEvidence.length,
      selectionPolicy: 'GitLab was queried live for active repositories in the time window, then LLM-planned query terms selected evidence for final reasoning.',
      evidence: selectedEvidence,
      error: evidenceSource?.error,
    },
  }
}

function mergeUniqueEvidence(items: any[]): any[] {
  const seen = new Set<string>()
  const merged: any[] = []
  for (const item of items) {
    const id = String(item?.id ?? JSON.stringify(item))
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(item)
  }
  return merged
}

function extractPersonTermsFromStories(stories: Array<Record<string, unknown>>): string[] {
  const terms: string[] = []
  for (const story of stories) {
    const people = [
      ...(Array.isArray(story.owners) ? story.owners : []),
      story.creator,
    ].filter(Boolean) as Array<Record<string, unknown>>
    for (const person of people) {
      terms.push(...normalizeStringList([
        stringValue(person.name),
        stringValue(person.email),
        stringValue(person.username),
        stringValue(person.userKey),
        stringValue(person.larkUserId),
      ]))
    }
  }
  return normalizeStringList(terms)
}

function selectRelevantItems<T>(items: T[], terms: string[], requiredIds: string[], limit: number): T[] {
  const required = new Set(requiredIds.map(normalizeForMatch).filter(Boolean))
  return items
    .map(item => ({ item, score: relevanceScore(item, terms, required) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item)
}

function relevanceScore(item: unknown, terms: string[], requiredIds: Set<string>): number {
  const text = normalizeForMatch(JSON.stringify(item))
  let score = 0
  for (const id of requiredIds) {
    if (id && text.includes(id)) score += 100
  }
  for (const term of terms) {
    if (!term) continue
    if (text.includes(term)) score += term.length >= 6 ? 10 : 3
  }
  return score
}

function compactStoryForModel(story: any): Record<string, unknown> {
  return {
    id: story.id,
    title: story.title,
    status: story.status,
    owners: story.owners,
    creator: story.creator,
    priority: story.priority,
    updatedAt: story.updatedAt,
    createdAt: story.createdAt,
    url: story.url,
    goal: compactText(story.goal, 500),
    testPlan: compactText(story.testPlan, 300),
    dueDate: story.dueDate,
    nextStep: compactText(story.nextStep, 300),
  }
}

function compactEvidenceForModel(item: any): Record<string, unknown> {
  return {
    id: item.id,
    type: item.type,
    title: compactText(item.title, 220),
    summary: compactText(item.summary, 400),
    author: item.author,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    url: item.url,
    metadata: {
      project: item.metadata?.project,
      branch: item.metadata?.branch,
      state: item.metadata?.state,
      ref: item.metadata?.ref,
      status: item.metadata?.status,
      message: compactText(item.metadata?.message, 300),
      description: compactText(item.metadata?.description, 300),
      authorEmail: item.metadata?.authorEmail,
      authorUsername: item.metadata?.authorUsername,
      authorName: item.metadata?.authorName,
      actionName: item.metadata?.actionName,
      targetType: item.metadata?.targetType,
      targetTitle: item.metadata?.targetTitle,
      targetId: item.metadata?.targetId,
      targetIid: item.metadata?.targetIid,
      mergeRequestUrl: item.metadata?.mergeRequestUrl,
      commitUrl: item.metadata?.commitUrl,
      commitSha: item.metadata?.commitSha,
      changedFiles: item.metadata?.changedFiles,
      projectId: item.metadata?.projectId,
      withinConfiguredGroup: item.metadata?.withinConfiguredGroup,
      pushData: item.metadata?.pushData,
    },
  }
}

function compactText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function normalizeStringList(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : []
  return [...new Set(arr.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '')
}

function safeJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return {}
    try {
      const parsed = JSON.parse(match[0])
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
}

async function timedLiveStep<T>(name: string, fn: () => Promise<T>, timeoutMs: number): Promise<T | Record<string, unknown>> {
  const startedAt = Date.now()
  try {
    const result = await withTimeout(fn(), timeoutMs, name)
    process.stdout.write(`[pmo-openai] live_step ${JSON.stringify({ name, status: 'ok', durationMs: Date.now() - startedAt })}\n`)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[pmo-openai] live_step ${JSON.stringify({ name, status: 'failed', durationMs: Date.now() - startedAt, error: message })}\n`)
    return { error: message, source: name, fetchedAt: new Date().toISOString() }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function fetchLiveFeishuStories(config: AppConfig): Promise<Record<string, unknown>> {
  const client = new FeishuProjectMcpClient({
    mcpUrl: config.feishuProject.mcpUrl,
    headers: config.feishuProject.headers,
  })
  const stories = await client.listStories(
    config.feishuProject.spaceName,
    config.feishuProject.projectKey,
    config.feishuProject.activeStatuses,
  )
  return {
    fetchedAt: new Date().toISOString(),
    scope: {
      spaceName: config.feishuProject.spaceName,
      activeStatuses: config.feishuProject.activeStatuses,
    },
    count: stories.length,
    stories: stories.map(story => ({
      id: story.id,
      title: story.title,
      status: story.status,
      owners: story.owners.map(owner => ({
        name: owner.name,
        email: owner.email,
        username: owner.username,
        userKey: owner.userKey,
        larkUserId: owner.larkUserId,
      })).filter(owner => owner.name),
      creator: story.creator ? {
        name: story.creator.name,
        email: story.creator.email,
        username: story.creator.username,
        userKey: story.creator.userKey,
        larkUserId: story.creator.larkUserId,
      } : undefined,
      priority: story.priority,
      updatedAt: story.updatedAt,
      createdAt: story.createdAt,
      url: story.url,
      goal: story.fields.goal,
      testPlan: story.fields.testPlan,
      dueDate: story.fields.dueDate,
      nextStep: story.fields.nextStep,
    })),
  }
}

async function resolvePeopleIdentities(profile: RetrievalProfile, config: AppConfig): Promise<PersonIdentityMatch[]> {
  const people = normalizeStringList(profile.people)
  if (!people.length || !config.feishuProject.projectKey) return []
  const client = new FeishuProjectMcpClient({
    mcpUrl: config.feishuProject.mcpUrl,
    headers: config.feishuProject.headers,
  })
  const users = await client.searchUsers({
    projectKey: config.feishuProject.projectKey,
    userKeys: people,
  })
  return users.map(user => ({
    query: people.find(person => user.name === person || user.email === person) ?? people[0]!,
    name: user.name,
    email: user.email,
    userKey: user.userKey,
    larkUserId: user.larkUserId,
    openId: user.openId,
  }))
}

function extractFeishuWorkItemIds(message: string): string[] {
  const ids = new Set<string>()
  for (const match of message.matchAll(/story\/detail\/(\d{6,})/g)) ids.add(match[1]!)
  for (const match of message.matchAll(/\b(6\d{9}|7\d{9})\b/g)) ids.add(match[1]!)
  return [...ids]
}

async function fetchReferencedFeishuWorkItems(message: string, config: AppConfig): Promise<unknown[]> {
  const ids = extractFeishuWorkItemIds(message)
  if (!ids.length) return []
  if (!config.feishuProject.projectKey) return ids.map(id => ({ id, error: 'missing Feishu project key' }))
  const client = new FeishuProjectMcpClient({
    mcpUrl: config.feishuProject.mcpUrl,
    headers: config.feishuProject.headers,
  })
  const items: unknown[] = []
  for (const id of ids.slice(0, 5)) {
    try {
      items.push({ id, raw: await client.getWorkItemBrief({ projectKey: config.feishuProject.projectKey, workItemId: id }) })
    } catch (error) {
      items.push({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return items
}

async function fetchLiveGitLabEvidence(config: AppConfig, profile: RetrievalProfile): Promise<Record<string, unknown>> {
  const lookbackDays = gitLabLookbackDaysForProfile(profile)
  const until = new Date()
  const since = new Date(until.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
  const client = new GitLabClient({
    baseUrl: config.gitlab.baseUrl,
    token: config.gitlab.token,
  })
  const evidence = await collectGitLabEvidence({
    client,
    group: config.gitlab.group,
    window: { since, until },
    maxProjects: process.env.PMO_CHAT_GITLAB_MAX_PROJECTS ? Number(process.env.PMO_CHAT_GITLAB_MAX_PROJECTS) : undefined,
  })
  const userEventEvidence = await fetchPersonGitLabEventEvidence({
    client,
    group: config.gitlab.group,
    profile,
    since,
  })
  const projectClient = new FeishuProjectMcpClient({
    mcpUrl: config.feishuProject.mcpUrl,
    headers: config.feishuProject.headers,
  })
  const enrichedEvidence = await enrichGitLabEvidenceAuthors({
    evidence: [...evidence, ...userEventEvidence],
    projectClient,
    projectKey: config.feishuProject.projectKey,
  })
  return {
    fetchedAt: new Date().toISOString(),
    lookbackDays,
    group: config.gitlab.group,
    count: enrichedEvidence.length,
    evidence: enrichedEvidence.map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      summary: item.summary,
      author: item.author,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      confidence: item.confidence,
      url: item.url,
      metadata: item.metadata,
    })),
  }
}

async function fetchPersonGitLabEventEvidence(input: {
  client: GitLabClient
  group: string
  profile: RetrievalProfile
  since: Date
}): Promise<Evidence[]> {
  const queries = normalizeStringList([
    ...input.profile.people,
    ...(input.profile.personIdentityTerms ?? []),
  ]).filter(term => term.length >= 2 && !/^ou_|^on_|^user_/i.test(term))
  if (!queries.length) return []

  let projects: GitLabProject[] = []
  try {
    projects = await input.client.listGroupProjects(input.group)
  } catch {
    projects = []
  }
  const allowedProjectIds = new Set(projects.map(project => project.id))
  const projectById = new Map(projects.map(project => [project.id, project]))
  const users = await searchGitLabUsersForPeople(input.client, queries)
  const evidence: Evidence[] = []
  for (const user of users.slice(0, 5)) {
    let events: GitLabUserEvent[] = []
    try {
      events = await input.client.listUserEvents(user.id, input.since)
    } catch {
      continue
    }
    for (const event of events) {
      if (!isDeliveryUserEvent(event)) continue
      const project = event.projectId ? await getGitLabProjectForEvent(input.client, event.projectId, projectById) : undefined
      const detail = await getGitLabUserEventDetail(input.client, event, project)
      evidence.push(gitLabUserEventToEvidence(user, event, {
        project,
        detail,
        withinConfiguredGroup: event.projectId ? allowedProjectIds.has(event.projectId) : undefined,
      }))
    }
  }
  return evidence
}

async function getGitLabProjectForEvent(
  client: GitLabClient,
  projectId: number,
  projectById: Map<number, GitLabProject>,
): Promise<GitLabProject | undefined> {
  const existing = projectById.get(projectId)
  if (existing) return existing
  try {
    const project = await client.getProject(projectId)
    projectById.set(projectId, project)
    return project
  } catch {
    return undefined
  }
}

async function searchGitLabUsersForPeople(client: GitLabClient, queries: string[]): Promise<GitLabUser[]> {
  const byId = new Map<number, GitLabUser>()
  for (const query of queries.slice(0, 10)) {
    let users: GitLabUser[] = []
    try {
      users = await client.searchUsers(query)
    } catch {
      continue
    }
    for (const user of users) {
      const text = normalizeForMatch([user.name, user.username, user.publicEmail].filter(Boolean).join(' '))
      const normalizedQuery = normalizeForMatch(query)
      if (!normalizedQuery || !text.includes(normalizedQuery)) continue
      byId.set(user.id, user)
    }
  }
  return [...byId.values()]
}

function isDeliveryUserEvent(event: GitLabUserEvent): boolean {
  return /pushed|opened|merged|accepted|closed|reopened/i.test(event.actionName)
    && (/MergeRequest/i.test(event.targetType ?? '') || Boolean(event.pushData?.commitTitle || event.pushData?.commitCount))
}

function gitLabUserEventToEvidence(
  user: GitLabUser,
  event: GitLabUserEvent,
  options: { project?: GitLabProject; detail?: GitLabUserEventDetail; withinConfiguredGroup?: boolean } = {},
): Evidence {
  const title = event.targetTitle
    || event.pushData?.commitTitle
    || `${event.actionName} ${event.pushData?.ref ?? ''}`.trim()
  const url = options.detail?.mergeRequestUrl
    ?? options.detail?.commitUrl
    ?? gitLabBranchUrl(options.project, event.pushData?.ref)
    ?? options.project?.webUrl
    ?? user.webUrl
  return {
    id: `gitlab-user-event-${user.id}-${Date.parse(event.createdAt) || event.createdAt}-${normalizeForMatch(title).slice(0, 60)}`,
    type: 'gitlab_user_event',
    title: title || 'GitLab user event',
    summary: [
      `${user.name || user.username} ${event.actionName}${event.targetType ? ` ${event.targetType}` : ''}${title ? `: ${title}` : ''}`,
      options.project?.pathWithNamespace ? `project=${options.project.pathWithNamespace}` : '',
      event.pushData?.ref ? `branch=${event.pushData.ref}` : '',
      options.detail?.commitSha ? `commit=${options.detail.commitSha.slice(0, 12)}` : '',
      options.detail?.changedFiles?.length ? `changedFiles=${options.detail.changedFiles.slice(0, 8).join(', ')}` : '',
    ].filter(Boolean).join(' | '),
    url,
    author: user.name || user.username,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    confidence: 'confirmed',
    metadata: {
      authorUsername: user.username,
      authorName: user.name,
      authorEmail: user.publicEmail,
      project: options.project?.pathWithNamespace,
      projectId: event.projectId,
      withinConfiguredGroup: options.withinConfiguredGroup,
      actionName: event.actionName,
      targetId: event.targetId,
      targetIid: event.targetIid,
      targetType: event.targetType,
      targetTitle: event.targetTitle,
      mergeRequestUrl: options.detail?.mergeRequestUrl,
      commitUrl: options.detail?.commitUrl,
      commitSha: options.detail?.commitSha,
      changedFiles: options.detail?.changedFiles,
      pushData: event.pushData,
    },
  }
}

interface GitLabUserEventDetail {
  mergeRequestUrl?: string
  commitUrl?: string
  commitSha?: string
  changedFiles?: string[]
}

async function getGitLabUserEventDetail(
  client: GitLabClient,
  event: GitLabUserEvent,
  project?: GitLabProject,
): Promise<GitLabUserEventDetail> {
  if (!event.projectId || !project) return {}
  const projectId = event.projectId
  if (/MergeRequest/i.test(event.targetType ?? '') && event.targetIid) {
    const targetIid = event.targetIid
    const changedFiles = await safeChangedFiles(() => client.listMergeRequestChanges(projectId, targetIid))
    return {
      mergeRequestUrl: `${project.webUrl}/-/merge_requests/${targetIid}`,
      changedFiles,
    }
  }
  const commitSha = event.pushData?.commitTo
  if (commitSha) {
    const changedFiles = await safeChangedFiles(() => client.listCommitDiffFiles(projectId, commitSha))
    return {
      commitSha,
      commitUrl: `${project.webUrl}/-/commit/${commitSha}`,
      changedFiles,
    }
  }
  return {}
}

async function safeChangedFiles(fetchFiles: () => Promise<string[]>): Promise<string[] | undefined> {
  try {
    const files = await fetchFiles()
    return files.length ? files.slice(0, 20) : undefined
  } catch {
    return undefined
  }
}

function gitLabBranchUrl(project: GitLabProject | undefined, ref: string | undefined): string | undefined {
  if (!project || !ref) return undefined
  return `${project.webUrl}/-/tree/${encodeURIComponent(ref)}`
}

export function gitLabLookbackDaysForProfile(profile: RetrievalProfile): number {
  const defaultDays = Number(process.env.PMO_CHAT_GITLAB_LOOKBACK_DAYS ?? 7)
  if (!profile.people.length) return defaultDays
  return Number(process.env.PMO_CHAT_GITLAB_PERSON_LOOKBACK_DAYS ?? 60)
}

function commonLinks(): Array<{ label: string; url: string }> {
  const baseUrl = process.env.PMO_PUBLIC_BASE_URL ?? 'https://pmo.hongliang.app'
  return [
    { label: 'Open WebUI', url: baseUrl },
    { label: '旧版 PMO 控制台', url: `${baseUrl}/app` },
  ]
}

function logChatRequest(input: { model: string; message: string; answer: PmoAgentAnswer }): void {
  const compactMessage = input.message.replace(/\s+/g, ' ').slice(0, 300)
  process.stdout.write(`[pmo-openai] chat ${JSON.stringify({
    model: input.model,
    message: compactMessage,
    intent: input.answer.intent,
    confidence: input.answer.confidence,
  })}\n`)
}

function isOpenAiAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.PMO_OPENAI_API_KEY
  if (!expected) return true
  const header = req.headers.authorization
  return header === `Bearer ${expected}`
}

function extractLatestUserMessage(messages: any[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    return stringifyMessageContent(message.content)
  }
  return undefined
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('\n')
    .trim()
}

export function renderAnswerForChat(answer: PmoAgentAnswer): string {
  const links = answer.links?.length
    ? `\n\n相关入口：\n${answer.links.map(link => `- [${link.label}](${link.url})`).join('\n')}`
    : ''
  const confidence = `\n\n置信度：${answer.confidence}；意图：${answer.intent}`
  return `${normalizeChatMarkdownHeadings(answer.text)}${links}${confidence}`
}

export function normalizeChatMarkdownHeadings(text: string): string {
  return text.replace(/^#{1,2}[^\S\r\n]+(.+?)[^\S\r\n]*$/gm, '### $1')
}

function chatCompletion(model: string, content: string): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: `chatcmpl-pmo-${now}`,
    object: 'chat.completion',
    created: now,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  }
}

function sendChatCompletionStream(res: ServerResponse, model: string, content: string): void {
  const now = Math.floor(Date.now() / 1000)
  const id = `chatcmpl-pmo-${now}`
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(`data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: now,
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  })}\n\n`)
  res.write(`data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: now,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`)
  res.write(`data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: now,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`)
  res.end('data: [DONE]\n\n')
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body)}\n`)
}

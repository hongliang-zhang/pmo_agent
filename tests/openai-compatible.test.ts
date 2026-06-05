import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPmoActionServer } from '../src/server/action-server.js'
import { buildStandaloneQuestionFromMessages, expandRetrievalProfileWithPeople, expandRetrievalProfileWithStoryPeople, fallbackRetrievalProfile, focusLiveContext, gitLabLookbackDaysForProfile, normalizeChatMarkdownHeadings } from '../src/server/openai-compatible.js'

describe('OpenAI-compatible PMO endpoint', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('lists the PMO model with bearer auth', async () => {
    process.env.PMO_OPENAI_API_KEY = 'test-key'
    const server = createPmoActionServer()
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { authorization: 'Bearer test-key' },
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data[0].id).toBe('pmo-agent')
    } finally {
      server.close()
    }
  })

  it('does not fall back to keyword matching when the LLM is unavailable', async () => {
    const reportsDir = await writeFixtureReports()
    process.env.PMO_REPORTS_DIR = reportsDir
    process.env.PMO_PUBLIC_BASE_URL = 'https://pmo.hongliang.app'
    process.env.PMO_OPENAI_API_KEY = 'test-key'
    delete process.env.ZAI_API_KEY
    const server = createPmoActionServer()
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'pmo-agent',
          messages: [{ role: 'user', content: '今天有哪些风险？' }],
        }),
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.choices[0].message.content).toContain('缺少 ZAI_API_KEY')
      expect(body.choices[0].message.content).toContain('不会使用关键词规则')
      expect(body.choices[0].message.content).not.toContain('P1')
    } finally {
      server.close()
    }
  })

  it('streams chat completions for Open WebUI', async () => {
    const reportsDir = await writeFixtureReports()
    process.env.PMO_REPORTS_DIR = reportsDir
    const server = createPmoActionServer()
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'pmo-agent',
          stream: true,
          messages: [{ role: 'user', content: '最新日报' }],
        }),
      })
      const text = await response.text()

      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(text).toContain('chat.completion.chunk')
      expect(text).toContain('[DONE]')
    } finally {
      server.close()
    }
  })

  it('rejects invalid API keys when configured', async () => {
    process.env.PMO_OPENAI_API_KEY = 'test-key'
    const server = createPmoActionServer()
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { authorization: 'Bearer wrong-key' },
      })

      expect(response.status).toBe(401)
    } finally {
      server.close()
    }
  })

  it('resolves people by exact Feishu identity terms before filtering GitLab evidence', () => {
    const profile = expandRetrievalProfileWithPeople({
      questionSummary: '看巩超最近在做什么',
      focusTerms: [],
      requiredStoryIds: [],
      people: ['巩超'],
      timeHints: ['最近'],
    }, [{
      query: '巩超',
      name: '巩超',
      email: 'chao.gong@aminer.cn',
      userKey: 'gong-user',
    }])

    const context = focusLiveContext({
      retrievalProfile: profile,
      referencedFeishuWorkItems: [],
      liveFeishuStories: {
        count: 2,
        stories: [
          { id: '6924913068', title: '【三期】海外三方API', status: '开发阶段', owners: [{ name: '巩超', email: 'chao.gong@aminer.cn' }] },
          { id: '6977295580', title: 'MaaS平台与飞书、CRM开票打通', status: '技术方案输出', owners: [{ name: '曹俊超', email: 'junchao.cao@aminer.cn' }] },
        ],
      },
      liveGitLabEvidence: {
        count: 2,
        evidence: [
          { id: 'gong-commit', type: 'gitlab_commit', title: 'Merge branch fix/safety', summary: 'safety', author: '巩超', createdAt: '2026-04-21', updatedAt: '2026-04-21', url: 'https://gitlab/gong', metadata: { authorEmail: 'chao.gong@aminer.cn', project: 'open-platform/vlm-mcp-server', identitySource: 'feishu_project_email' } },
          { id: 'cao-mr', type: 'gitlab_mr', title: 'Feature/add total seats', summary: 'finance', author: '曹俊超', createdAt: '2026-06-04', updatedAt: '2026-06-04', url: 'https://gitlab/cao', metadata: { authorEmail: 'junchao.cao@aminer.cn', authorUsername: 'caojunchao', project: 'open-platform/platform-finance', identitySource: 'feishu_project_email' } },
        ],
      },
    }) as any

    expect(profile.personIdentityTerms).toContain('chao.gong@aminer.cn')
    expect(profile.personIdentityTerms).not.toContain('chao')
    expect(context.selectionSummary.feishuStoryIds).toEqual(['6924913068'])
    expect(context.liveFeishuStories.stories.map((story: any) => story.id)).toEqual(['6924913068'])
    expect(context.liveGitLabEvidence.evidence.map((item: any) => item.id)).toEqual(['gong-commit'])
  })

  it('rewrites pronoun follow-ups with recent chat history before live retrieval', async () => {
    process.env.ZAI_API_KEY = 'test-zai-key'
    const calls: any[] = []
    const rewritten = await buildStandaloneQuestionFromMessages([
      { role: 'user', content: '最近鸿亮在做什么需求' },
      { role: 'assistant', content: '张鸿亮最近关联需求包括 7008214903 和 7008260302。' },
      { role: 'user', content: '他在 gitlab 里有没有更新' },
    ], '他在 gitlab 里有没有更新', (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)))
      return jsonResponse({
        choices: [{ message: { content: '张鸿亮在 GitLab 里最近有没有更新？' } }],
      })
    }) as typeof fetch)

    expect(rewritten).toBe('张鸿亮在 GitLab 里最近有没有更新？')
    expect(calls[0].messages[1].content).toContain('张鸿亮最近关联需求')
  })

  it('falls back to recent conversation entities when the rewrite model leaves pronouns unresolved', async () => {
    process.env.ZAI_API_KEY = 'test-zai-key'
    const rewritten = await buildStandaloneQuestionFromMessages([
      { role: 'user', content: '最近鸿亮在做什么需求' },
      { role: 'assistant', content: '张鸿亮最近关联需求包括 7008214903 和 7008260302。' },
      { role: 'user', content: '他在 gitlab 里有没有更新' },
    ], '他在 gitlab 里有没有更新', (async () => jsonResponse({
      choices: [{ message: { content: '他在 gitlab 里有没有更新' } }],
    })) as typeof fetch)

    expect(rewritten).toBe('张鸿亮在 gitlab 里有没有更新')
  })

  it('uses matched Feishu story people as GitLab author identity terms for short names', () => {
    const context = focusLiveContext({
      retrievalProfile: {
        questionSummary: '最近鸿亮在做什么需求',
        focusTerms: ['鸿亮'],
        requiredStoryIds: [],
        people: ['鸿亮'],
        timeHints: ['最近'],
      },
      referencedFeishuWorkItems: [],
      liveFeishuStories: {
        count: 1,
        stories: [
          {
            id: '7008214903',
            title: 'PMO Agent 优化',
            status: '开发阶段',
            owners: [{ name: '张鸿亮', email: 'user@aminer.cn', userKey: 'u_hl' }],
            creator: { name: '产品同学' },
          },
        ],
      },
      liveGitLabEvidence: {
        count: 2,
        evidence: [
          { id: 'hl-commit', type: 'gitlab_commit', title: 'fix pmo chat history', summary: 'chat history', author: 'Hongliang Zhang', createdAt: '2026-06-05', updatedAt: '2026-06-05', url: 'https://gitlab/hl', metadata: { authorEmail: 'user@aminer.cn', project: 'open-platform/pmo' } },
          { id: 'other-commit', type: 'gitlab_commit', title: 'other change', summary: 'other', author: 'Other', createdAt: '2026-06-05', updatedAt: '2026-06-05', url: 'https://gitlab/other', metadata: { authorEmail: 'other@aminer.cn', project: 'open-platform/pmo' } },
        ],
      },
    }) as any

    expect(context.selectionSummary.storyPersonTerms).toContain('user@aminer.cn')
    expect(context.liveFeishuStories.stories.map((story: any) => story.id)).toEqual(['7008214903'])
    expect(context.liveGitLabEvidence.evidence.map((item: any) => item.id)).toEqual(['hl-commit'])
  })

  it('expands short person aliases from matched Feishu story people before GitLab lookup', () => {
    const profile = expandRetrievalProfileWithStoryPeople({
      questionSummary: '最近鸿亮在做什么需求',
      focusTerms: ['鸿亮'],
      requiredStoryIds: [],
      people: ['鸿亮'],
      timeHints: ['最近'],
    }, {
      count: 2,
      stories: [
        {
          id: '7008214903',
          title: 'GLM-5.2 协议改造',
          status: '技术方案输出',
          owners: [{ name: '曹鹏程', email: 'pengcheng.cao@aminer.cn' }],
          creator: { name: '张鸿亮', email: 'user@aminer.cn', userKey: 'u_hl' },
        },
        {
          id: '7008260302',
          title: 'coding plan 兼容 codex response API',
          status: '开发阶段',
          owners: [{ name: '靳海阳', email: 'haiyang.jin@aminer.cn' }],
          creator: { name: '张鸿亮', email: 'user@aminer.cn', userKey: 'u_hl' },
        },
      ],
    })

    expect(profile.personIdentityTerms).toContain('张鸿亮')
    expect(profile.personIdentityTerms).toContain('user@aminer.cn')
    expect(profile.personIdentityTerms).not.toContain('曹鹏程')
    expect(profile.personIdentityTerms).not.toContain('haiyang.jin@aminer.cn')
  })

  it('uses a broader GitLab lookback for people questions', () => {
    const original = process.env.PMO_CHAT_GITLAB_PERSON_LOOKBACK_DAYS
    process.env.PMO_CHAT_GITLAB_PERSON_LOOKBACK_DAYS = '60'
    try {
      expect(gitLabLookbackDaysForProfile({
        questionSummary: '看巩超最近在做什么',
        focusTerms: [],
        requiredStoryIds: [],
        people: ['巩超'],
        timeHints: ['最近'],
      })).toBe(60)
    } finally {
      if (original === undefined) delete process.env.PMO_CHAT_GITLAB_PERSON_LOOKBACK_DAYS
      else process.env.PMO_CHAT_GITLAB_PERSON_LOOKBACK_DAYS = original
    }
  })

  it('keeps the final LLM path usable when retrieval-profile LLM fails on a people query', () => {
    const profile = fallbackRetrievalProfile('给我看一下巩超最近在做什么需求', 'retrieval timeout')

    expect(profile.people).toEqual(['巩超'])
    expect(profile.timeHints).toEqual(['最近'])
    expect(profile.retrievalError).toBe('retrieval timeout')
  })

  it('keeps the person target when retrieval-profile LLM times out on a GitLab follow-up', () => {
    const profile = fallbackRetrievalProfile('张鸿亮在 GitLab 里最近有没有更新？', 'retrieval timeout')

    expect(profile.people).toEqual(['张鸿亮'])
    expect(profile.focusTerms).toContain('张鸿亮')
    expect(gitLabLookbackDaysForProfile(profile)).toBe(Number(process.env.PMO_CHAT_GITLAB_PERSON_LOOKBACK_DAYS ?? 60))
  })

  it('keeps moderate markdown headings for chat answers', () => {
    expect(normalizeChatMarkdownHeadings([
      '# 复杂专题分析',
      '## 张鸿亮最近负责/发起的需求',
      '',
      '### 直接 GitLab 记录',
      '- 有 4 条记录。',
    ].join('\n'))).toBe([
      '### 复杂专题分析',
      '### 张鸿亮最近负责/发起的需求',
      '',
      '### 直接 GitLab 记录',
      '- 有 4 条记录。',
    ].join('\n'))
  })
})

async function listen(server: ReturnType<typeof createPmoActionServer>): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server did not listen on a TCP port')
  return `http://127.0.0.1:${address.port}`
}

async function writeFixtureReports(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pmo-openai-'))
  await writeFile(join(dir, '2026-06-02-pmo-audit.json'), JSON.stringify({
    title: 'MAAS_平台 PMO 状态核查日报 2026-06-02',
    date: '2026-06-02',
    summary: { stories: 1, focused: 1, suppressed: 0, highPriorityRisks: 1, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
    storyAudits: [storyAudit()],
    progressedStories: [storyAudit()],
    riskyStories: [storyAudit()],
    incompleteStories: [storyAudit()],
    gitlabEvidence: [],
    isolatedEvidence: [],
    suggestedContacts: [],
    noNeedToDisturb: [],
    suppressedStories: [],
  }, null, 2))
  await writeFile(join(dir, '2026-06-02-pmo-audit.html'), '<!doctype html><title>Report</title>')
  await writeFile(join(dir, '2026-06-02-pmo-audit.md'), '# Report')
  return dir
}

function storyAudit(): unknown {
  return {
    story: {
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/S1',
      updatedAt: '2026-06-02',
    },
    evidence: [],
    risks: [{
      id: 'S1:risk',
      storyId: 'S1',
      type: 'missing_goal',
      severity: 'high',
      priority: 'P1',
      category: 'Data Quality',
      description: '需求缺少明确目标。',
      evidenceIds: [],
      suggestedAction: '找 owner 补目标。',
      ownerToContact: { name: '王建辉' },
    }],
    confidence: 'confirmed',
    progressSummary: 'MR 已打开。',
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
}

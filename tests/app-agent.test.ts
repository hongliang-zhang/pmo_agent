import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { answerPmoQuestion } from '../src/server/agent-chat.js'
import { loadPmoAppState } from '../src/server/app-data.js'

describe('PMO app state and agent chat', () => {
  it('loads report, ops artifacts, people, risks, and evidence into one app state', async () => {
    const dir = await writeFixtureReports()
    const state = await loadPmoAppState({ reportsDir: dir, publicBaseUrl: 'https://pmo.hongliang.app' })

    expect(state.latestReport?.date).toBe('2026-06-02')
    expect(state.dashboard).toMatchObject({ focused: 1, risky: 1, progressed: 1, failedRuns: 1, pendingDrafts: 1, pendingApprovals: 2 })
    expect(state.stories[0]).toMatchObject({ id: 'S1', title: '企业套餐购买', owners: ['王建辉'] })
    expect(state.risks[0]).toMatchObject({ priority: 'P1', storyTitle: '企业套餐购买' })
    expect(state.people[0]).toMatchObject({ name: '王建辉', suggestedContacts: 1 })
    expect(state.evidence.map(item => item.title)).toContain('feat: enterprise subscription')
    expect(state.settings.dataSources.map(item => item.name)).toContain('飞书项目 MAAS_平台')
    expect(state.settings.capabilities.map(item => item.name)).toContain('自然语言问答')
    expect(JSON.stringify(state)).not.toMatch(/token|secret|password|api[_-]?key/i)
  })

  it('answers natural PMO questions without executing high-risk actions', async () => {
    const dir = await writeFixtureReports()
    const state = await loadPmoAppState({ reportsDir: dir, publicBaseUrl: 'https://pmo.hongliang.app' })

    expect(answerPmoQuestion('今天有哪些风险？', state)).toMatchObject({ intent: 'risks', confidence: 'high' })
    expect(answerPmoQuestion('客服 / 销售 Agent MVP 当前整体是绿灯黄灯还是红灯？为什么？', state).text).toContain('黄灯')
    expect(answerPmoQuestion('本周有哪些实质进展？', state).text).toContain('MR 已打开')
    expect(answerPmoQuestion('王建辉在做什么？', state).text).toContain('企业套餐购买')
    expect(answerPmoQuestion('今天 GitLab 上谁有交付证据？', state).text).toContain('dev')
    expect(answerPmoQuestion('代码有进展但需求没同步的有哪些？', state).text).toContain('orphan MR')
    expect(answerPmoQuestion('哪些信息缺失导致你无法判断状态？', state).text).toContain('需求缺少明确目标')
    expect(answerPmoQuestion('哪些事项可以不打扰？', state).text).toContain('体验中心文档整理')
    expect(answerPmoQuestion('建议沟通清单', state).text).toContain('不会直接发送')
    expect(answerPmoQuestion('最近一次运行是否成功？', state)).toMatchObject({ intent: 'run_status' })
    expect(answerPmoQuestion('帮我把这个风险直接发给客户', state).text).toContain('不会直接发送')
    expect(answerPmoQuestion('这个呢？', state).text).toContain('请补充具体需求')
  })
})

async function writeFixtureReports(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pmo-app-agent-'))
  await writeFile(join(dir, '2026-06-02-pmo-audit.json'), JSON.stringify({
    title: 'MAAS_平台 PMO 状态核查日报 2026-06-02',
    date: '2026-06-02',
    summary: { stories: 2, focused: 1, suppressed: 1, highPriorityRisks: 1, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
    storyAudits: [storyAudit()],
    progressedStories: [storyAudit()],
    riskyStories: [storyAudit()],
    incompleteStories: [storyAudit()],
    gitlabEvidence: [],
    isolatedEvidence: [{
      id: 'orphan-1',
      type: 'gitlab_mr',
      title: 'orphan MR',
      summary: 'opened MR without story link',
      url: 'https://dev.aminer.cn/open-platform/repo/-/merge_requests/1',
      author: 'dev',
      createdAt: '2026-06-02T01:00:00Z',
      updatedAt: '2026-06-02T02:00:00Z',
      confidence: 'likely',
    }],
    suggestedContacts: [{
      person: '王建辉',
      storyId: 'S1',
      storyTitle: '企业套餐购买',
      question: '请确认目标和 ETA。',
      reason: '缺少目标字段。',
      priority: 'high',
    }],
    noNeedToDisturb: [quietStoryAudit()],
    suppressedStories: [],
  }, null, 2))
  await writeFile(join(dir, '2026-06-02-pmo-audit.html'), '<!doctype html><title>Report</title>')
  await writeFile(join(dir, '2026-06-02-pmo-audit.md'), '# Report')
  await writeFile(join(dir, 'runs.json'), JSON.stringify([{ id: 'run-1', date: '2026-06-02', status: 'failed' }]))
  await writeFile(join(dir, 'communication-drafts.json'), JSON.stringify([{ id: 'draft-1', status: 'pending' }]))
  await writeFile(join(dir, 'approval-center.json'), JSON.stringify({ summary: { totalPendingApprovals: 2 } }))
  await writeFile(join(dir, 'feishu-bot-events.json'), JSON.stringify([{ at: '2026-06-02T01:00:00Z' }]))
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
    evidence: [{
      id: 'mr-1',
      type: 'gitlab_mr',
      title: 'feat: enterprise subscription',
      summary: 'opened MR for enterprise subscription',
      url: 'https://dev.aminer.cn/open-platform/repo/-/merge_requests/2',
      author: 'dev',
      createdAt: '2026-06-02T01:00:00Z',
      updatedAt: '2026-06-02T02:00:00Z',
      confidence: 'confirmed',
    }],
    risks: [{
      id: 'S1:missing_goal',
      storyId: 'S1',
      type: 'missing_goal',
      severity: 'high',
      priority: 'P1',
      category: 'Data Quality',
      description: '需求缺少明确目标。',
      whyNow: '已有代码进展但目标不清。',
      evidenceIds: [],
      suggestedAction: '找 owner 补目标。',
      ownerToContact: { name: '王建辉' },
    }],
    confidence: 'confirmed',
    progressSummary: 'MR 已打开。',
  }
}

function quietStoryAudit(): unknown {
  return {
    story: {
      id: 'S2',
      title: '体验中心文档整理',
      status: '开发阶段',
      owners: [{ name: '李四' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/S2',
      updatedAt: '2026-06-02',
    },
    evidence: [{
      id: 'doc-1',
      type: 'feishu_doc',
      title: '测试计划已补齐',
      summary: '测试计划已更新。',
      createdAt: '2026-06-02T01:00:00Z',
      updatedAt: '2026-06-02T02:00:00Z',
      confidence: 'confirmed',
    }],
    risks: [],
    confidence: 'confirmed',
    progressSummary: '文档和测试计划已补齐，无需打扰。',
  }
}

import { describe, expect, it } from 'vitest'
import { renderAuditMarkdown } from '../src/render/markdown.js'
import type { AuditReport } from '../src/domain.js'

describe('renderAuditMarkdown', () => {
  it('renders stable PMO report sections', () => {
    const report: AuditReport = {
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
      progressedStories: [],
      riskyStories: [storyAuditFixture()],
      incompleteStories: [storyAuditFixture()],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [{ person: 'Alice', storyId: 'S1', storyTitle: '计费', priority: 'high', question: '确认状态', reason: 'CI failed' }],
      noNeedToDisturb: [],
      stateSnapshot: {
        generatedAt: '2026-05-31T04:00:00.000Z',
        window: { label: '2026-05-31', since: '2026-05-30T16:00:00.000Z', until: '2026-05-31T16:00:00.000Z' },
        summary: { stories: 1, greenStories: 0, yellowStories: 0, redStories: 1, unknownStories: 0, workstreams: 1, communications: 1 },
        stories: [],
        workstreams: [{ name: '商业化', stories: 1, activeStories: 0, riskyStories: 1, blockedStories: 1, health: 'red' }],
        communicationPlan: [{ person: 'Alice', channel: 'feishu', storyIds: ['S1'], storyTitles: ['计费'], priority: 'high', question: '确认状态', reason: 'CI failed' }],
        noDisturbStories: [],
      },
    }

    const markdown = renderAuditMarkdown(report)

    expect(markdown).toContain('# MAAS_平台 PMO 状态核查日报 2026-05-31')
    expect(markdown).toContain('## 1. 今日结论摘要')
    expect(markdown).toContain('## 2. 需要关注的风险')
    expect(markdown).toContain('## 3. 今日/本周实质进展')
    expect(markdown).toContain('## 7. 建议沟通清单')
    expect(markdown).toContain('| 优先级 | 类型 | 需求 | 为什么现在关注 | 建议动作 | 找谁 | 置信度 |')
    expect(markdown).toContain('| 优先级 | 需求 | 缺失信息 | 为什么影响判断 | 已查来源 | 建议动作 |')
    expect(markdown).toContain('| 优先级 | 找谁 | 需求 | 问什么 | 期望产出 | 是否需审批 |')
    expect(markdown).toContain('| 项 | 结论 |')
  })
})

function storyAuditFixture(): AuditReport['riskyStories'][number] {
  return {
    story: {
      id: 'S1',
      title: '计费',
      status: '开发阶段',
      owners: [{ name: 'Alice' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/S1',
    },
    evidence: [],
    risks: [{
      id: 'S1-missing-goal',
      storyId: 'S1',
      type: 'missing_goal',
      severity: 'high',
      priority: 'P1',
      category: 'Data Quality',
      whyNow: '缺目标影响交付判断。',
      description: '缺少明确目标。',
      evidenceIds: [],
      suggestedAction: '请 owner 补齐目标。',
      ownerToContact: { name: 'Alice' },
    }],
    confidence: 'unknown',
    progressSummary: '暂无。',
    context: {
      storyId: 'S1',
      summary: '候选目标来自方案文档。',
      evidence: [],
      candidates: [{
        field: 'goal',
        value: '明确计费上线目标',
        sourceTitle: '方案文档',
        sourceUrl: 'https://example.com/doc',
        evidenceId: 'doc-1',
        confidence: 'likely',
        needsConfirmation: true,
      }],
      contradictions: [],
    },
  }
}

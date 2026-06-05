import { describe, expect, it } from 'vitest'
import { buildAuditReport } from '../src/audit.js'
import type { Evidence, Story } from '../src/domain.js'

describe('report curation', () => {
  it('keeps the main report focused on active progress and actionable risks', () => {
    const stories: Story[] = [
      story('ACTIVE', '企业套餐购买', {}, [], '开发阶段', '2026-06-02T02:00:00Z'),
      story('STALE', '历史沉积需求', {}, [{ name: 'Owner' }], '开发阶段', '2026-05-01T02:00:00Z'),
      story('NO_OWNER', '缺负责人高风险需求', { goal: '修复安全风险', testPlan: '回归', nextStep: '确认 owner', dueDate: '2026-06-05' }, [], '开发阶段', '2026-06-02T02:00:00Z'),
      story('QUIET', '可观察需求', { goal: '提升体验', testPlan: '回归', nextStep: '测试中', dueDate: '2026-06-04' }, [{ name: 'Cara' }], '测试阶段', '2026-06-02T02:00:00Z'),
    ]
    const evidence: Evidence[] = [
      ev('mr-active', 'gitlab_mr', 'ACTIVE 企业套餐购买 MR', { state: 'opened', detailedMergeStatus: 'blocked_status' }),
      ev('mr-quiet', 'gitlab_mr', 'QUIET 可观察需求进展', { state: 'opened', detailedMergeStatus: 'mergeable' }),
      ev('mr-isolated', 'gitlab_mr', 'orphan backend change', { state: 'opened' }),
    ]

    const report = buildAuditReport({
      date: '2026-06-02',
      stories,
      evidence,
      now: new Date('2026-06-02T12:00:00+08:00'),
    })

    expect(report.progressedStories.map(item => item.story.id)).toEqual(['ACTIVE', 'QUIET'])
    expect(report.riskyStories.map(item => item.story.id)).toEqual(['ACTIVE', 'NO_OWNER'])
    expect(report.incompleteStories.map(item => item.story.id)).toEqual(['ACTIVE', 'NO_OWNER'])
    expect(report.noNeedToDisturb.map(item => item.story.id)).toEqual(['QUIET'])
    expect(report.suggestedContacts.map(item => item.storyId)).toEqual(['ACTIVE', 'NO_OWNER'])
    expect(report.summary.stories).toBe(4)
    expect(report.summary.focused).toBe(3)
    expect(report.summary.suppressed).toBe(1)
    expect(report.summary.highPriorityRisks).toBe(2)

    expect(report.riskyStories[0]?.risks[0]).toMatchObject({
      priority: 'P0',
      category: 'Issue',
      whyNow: expect.stringContaining('MR'),
    })
    expect(report.riskyStories[1]?.risks[0]).toMatchObject({
      priority: 'P1',
      category: 'Data Quality',
    })
    expect(report.suppressedStories?.[0]).toMatchObject({
      storyId: 'STALE',
      reason: expect.stringContaining('长期无变化'),
    })
  })
})

function story(
  id: string,
  title: string,
  fields: Story['fields'],
  owners: Story['owners'],
  status: string,
  updatedAt: string,
): Story {
  return {
    id,
    title,
    status,
    owners,
    linkedDocs: [],
    fields,
    url: `https://project.feishu.cn/story/detail/${id}`,
    updatedAt,
  }
}

function ev(id: string, type: Evidence['type'], title: string, metadata: Record<string, unknown>): Evidence {
  return {
    id,
    type,
    title,
    summary: title,
    url: `https://dev.aminer.cn/${id}`,
    author: 'dev',
    createdAt: '2026-06-02T03:00:00Z',
    updatedAt: '2026-06-02T03:00:00Z',
    confidence: 'confirmed',
    metadata,
  }
}

import { describe, expect, it } from 'vitest'
import { buildAuditReport } from '../src/audit.js'
import { buildProjectStateSnapshot } from '../src/state.js'
import type { Evidence, Story } from '../src/domain.js'

describe('buildProjectStateSnapshot', () => {
  it('turns an audit report into story health, workstream state, and a deduped communication plan', () => {
    const stories: Story[] = [
      story('S1', '企业套餐购买', { productArea: '商业化', goal: '支持企业套餐购买' }, [{ name: '王建辉' }]),
      story('S2', '客服agent工单自动分类', { productArea: '客服 Agent', goal: '降低人工分类成本', testPlan: '回归测试', nextStep: '联调', startDate: '2026-05-30', dueDate: '2026-06-03' }, [{ name: '孟茜' }]),
      story('S3', '体验中心-历史记录', { productArea: '体验中心', goal: '提升体验中心留存', testPlan: '回归测试', nextStep: '发布', startDate: '2026-05-28', dueDate: '2026-05-31' }, [{ name: '刘叶舟' }], '已结束'),
    ]
    const evidence: Evidence[] = [
      ev('mr-s1', 'gitlab_mr', 'S1 企业套餐购买 MR', { branch: 'feat/S1', state: 'opened' }),
      ev('pipe-s1', 'gitlab_pipeline', 'S1 failed pipeline', { status: 'failed' }),
      ev('mr-s2', 'gitlab_mr', 'S2 客服agent工单自动分类', { branch: 'feat/S2', state: 'merged' }),
      ev('mr-s3', 'gitlab_mr', 'S3 体验中心-历史记录', { branch: 'feat/S3', state: 'merged' }),
    ]
    const report = buildAuditReport({ date: '2026-05-31', stories, evidence, now: new Date('2026-05-31T12:00:00+08:00') })

    const snapshot = buildProjectStateSnapshot({
      report,
      window: { since: new Date('2026-05-31T00:00:00+08:00'), until: new Date('2026-06-01T00:00:00+08:00') },
    })

    expect(snapshot.window.label).toBe('2026-05-31')
    expect(snapshot.summary.stories).toBe(3)
    expect(snapshot.summary.redStories).toBe(1)
    expect(snapshot.summary.greenStories).toBe(2)
    expect(snapshot.stories.find(item => item.storyId === 'S1')?.health).toBe('red')
    expect(snapshot.stories.find(item => item.storyId === 'S2')?.needsHumanContact).toBe(false)
    expect(snapshot.workstreams.find(item => item.name === '商业化')?.health).toBe('red')
    expect(snapshot.communicationPlan).toHaveLength(1)
    expect(snapshot.communicationPlan[0]).toMatchObject({
      person: '王建辉',
      channel: 'feishu',
      priority: 'high',
    })
    expect(snapshot.noDisturbStories.map(item => item.storyId)).toContain('S2')
  })
})

function story(id: string, title: string, fields: Story['fields'], owners: Story['owners'], status = '开发阶段'): Story {
  return {
    id,
    title,
    status,
    owners,
    linkedDocs: [],
    fields,
    url: `https://project.feishu.cn/story/detail/${id}`,
    updatedAt: '2026-05-31T02:00:00Z',
  }
}

function ev(id: string, type: Evidence['type'], title: string, metadata: Record<string, unknown>): Evidence {
  return {
    id,
    type,
    title,
    summary: title,
    url: `https://dev.aminer.cn/open-platform/project/-/merge_requests/${id}`,
    author: 'dev',
    createdAt: '2026-05-31T03:00:00Z',
    updatedAt: '2026-05-31T04:00:00Z',
    confidence: 'confirmed',
    metadata,
  }
}

import { describe, expect, it } from 'vitest'
import { buildAuditReport } from '../src/audit.js'
import type { Evidence, Story } from '../src/domain.js'

describe('buildAuditReport fixture integration', () => {
  it('builds a report with risks, missing info, suggested contact, isolated evidence, and no-disturb item', () => {
    const stories: Story[] = [
      story('S1', 'PMO 状态核查', {}),
      story('S2', '计费优化', { goal: '提升计费稳定性', testPlan: '回归测试', nextStep: '发布', startDate: '2026-05-30', dueDate: '2026-06-01' }, [{ name: 'Bob' }], '已上线'),
      story('S3', '搜索增强', { goal: '提升搜索成功率', testPlan: '回归测试', nextStep: '排期', startDate: '2026-06-01', dueDate: '2026-06-03' }, [{ name: 'Cara' }]),
    ]
    const evidence: Evidence[] = [
      ev('mr-1', 'gitlab_mr', 'S1 状态核查 MR', { branch: 'feat/S1', state: 'opened' }),
      ev('pipeline-1', 'gitlab_pipeline', 'S1 failed pipeline', { status: 'failed' }),
      ev('mr-2', 'gitlab_mr', 'S2 计费优化合并', { branch: 'feat/S2', state: 'merged' }),
      ev('mr-3', 'gitlab_mr', 'unmatched change', { branch: 'feat/unmatched' }),
    ]

    const report = buildAuditReport({
      date: '2026-05-31',
      stories,
      evidence,
      now: new Date('2026-05-31T12:00:00+08:00'),
    })

    expect(report.riskyStories).toHaveLength(1)
    expect(report.incompleteStories.length).toBeGreaterThanOrEqual(1)
    expect(report.suggestedContacts).toHaveLength(1)
    expect(report.isolatedEvidence).toHaveLength(1)
    expect(report.noNeedToDisturb).toHaveLength(1)
  })
})

function story(id: string, title: string, fields: Story['fields'], owners: Story['owners'] = [], status = '开发中'): Story {
  return {
    id,
    title,
    status,
    owners,
    linkedDocs: [],
    fields,
    url: `https://project.feishu.cn/${id}`,
    updatedAt: '2026-05-31T02:00:00Z',
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
    createdAt: '2026-05-31T03:00:00Z',
    updatedAt: '2026-05-31T03:00:00Z',
    confidence: 'confirmed',
    metadata,
  }
}

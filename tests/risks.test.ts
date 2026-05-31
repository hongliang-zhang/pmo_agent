import { describe, expect, it } from 'vitest'
import { assessStoryRisks } from '../src/risks.js'
import type { Evidence, Story } from '../src/domain.js'

describe('assessStoryRisks', () => {
  it('detects missing project fields and delivery risks', () => {
    const story: Story = {
      id: 'S1',
      title: '需求一',
      status: '开发中',
      owners: [],
      linkedDocs: [],
      fields: {},
      updatedAt: '2026-05-20T00:00:00Z',
    }
    const evidence: Evidence[] = [
      {
        id: 'pipeline-1',
        type: 'gitlab_pipeline',
        title: 'failed pipeline',
        summary: 'failed',
        url: 'pipeline',
        createdAt: '2026-05-31T01:00:00Z',
        updatedAt: '2026-05-31T01:00:00Z',
        confidence: 'confirmed',
        metadata: { status: 'failed' },
      },
    ]

    const risks = assessStoryRisks(story, evidence, new Date('2026-05-31T00:00:00Z'))

    expect(risks.map(r => r.type)).toEqual(expect.arrayContaining(['missing_goal', 'missing_owner', 'missing_schedule', 'missing_test_plan', 'stale_status', 'pipeline_failed']))
  })
})

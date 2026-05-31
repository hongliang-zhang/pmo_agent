import { describe, expect, it } from 'vitest'
import { matchEvidenceToStories } from '../src/matching.js'
import type { Evidence, Story } from '../src/domain.js'

describe('matchEvidenceToStories', () => {
  const stories: Story[] = [
    story('ABC-1', '支持 PMO 状态核查'),
    story('XYZ-2', '优化计费链路'),
  ]

  it('matches evidence by story id, title keyword, and branch text', () => {
    const evidence: Evidence[] = [
      ev('mr-1', 'gitlab_mr', 'ABC-1 add audit', 'feat/ABC-1-audit'),
      ev('mr-2', 'gitlab_mr', '实现 状态核查 页面', 'feat/status-audit'),
      ev('mr-3', 'gitlab_mr', 'unrelated', 'feat/none'),
    ]

    const result = matchEvidenceToStories(stories, evidence)

    expect(result.storyEvidence.get('ABC-1')?.map(e => e.id)).toEqual(['mr-1', 'mr-2'])
    expect(result.isolatedEvidence.map(e => e.id)).toEqual(['mr-3'])
  })
})

function story(id: string, title: string): Story {
  return {
    id,
    title,
    status: '开发中',
    owners: [],
    linkedDocs: [],
    fields: {},
    url: `https://project.feishu.cn/${id}`,
    updatedAt: '2026-05-31T00:00:00Z',
  }
}

function ev(id: string, type: Evidence['type'], title: string, branch: string): Evidence {
  return {
    id,
    type,
    title,
    summary: title,
    url: `https://dev.aminer.cn/${id}`,
    author: 'alice',
    createdAt: '2026-05-31T01:00:00Z',
    updatedAt: '2026-05-31T01:00:00Z',
    confidence: 'confirmed',
    metadata: { branch },
  }
}

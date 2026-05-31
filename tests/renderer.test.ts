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
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
    }

    const markdown = renderAuditMarkdown(report)

    expect(markdown).toContain('# MAAS_平台 PMO 状态核查日报 2026-05-31')
    expect(markdown).toContain('## 1. 总览')
    expect(markdown).toContain('## 6. 建议沟通清单')
    expect(markdown).toContain('| 指标 | 数量 |')
  })
})

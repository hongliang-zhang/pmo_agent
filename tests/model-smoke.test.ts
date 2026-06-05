import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import type { AuditReport } from '../src/domain.js'
import { createStaticModelAnalyzer } from '../src/models/analysis.js'
import { runModelSmoke } from '../src/smoke/model.js'

describe('model smoke', () => {
  it('verifies daily and risk model outputs without exposing credentials', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-model-smoke-'))

    const result = await runModelSmoke({
      reportsDir,
      report: minimalReport(),
      analyzer: createStaticModelAnalyzer({
        dailySummary: '今日 PMO 摘要可生成。',
        riskAssessment: '深度风险分析可生成。',
      }),
      config: testConfig(),
    })

    expect(result).toMatchObject({
      success: true,
      provider: 'z.ai',
      dailyModel: 'glm-5-turbo',
      riskModel: 'glm-5.1',
      dailySummaryChars: '今日 PMO 摘要可生成。'.length,
      riskAssessmentChars: 10,
    })
    expect(result.analysisPath).toContain('model-smoke')

    const stored = await readFile(result.analysisPath, 'utf8')
    expect(stored).toContain('今日 PMO 摘要可生成。')
    expect(stored).toContain('深度风险分析可生成。')
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(stored).not.toContain('secret-value')
  })
})

function minimalReport(): AuditReport {
  return {
    title: 'MAAS_平台 PMO 模型 smoke',
    date: '2026-06-02',
    summary: { stories: 1, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
    progressedStories: [],
    riskyStories: [],
    incompleteStories: [],
    gitlabEvidence: [],
    isolatedEvidence: [],
    suggestedContacts: [],
    noNeedToDisturb: [],
  }
}

function testConfig(): Pick<AppConfig, 'models'> {
  return {
    models: {
      provider: 'z.ai',
      apiKey: 'secret-value',
      daily: { protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-5-turbo' },
      risk: { protocol: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.1' },
    },
  }
}

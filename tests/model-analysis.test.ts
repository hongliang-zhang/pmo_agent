import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import { createStaticModelAnalyzer, writeModelAnalysisArtifact } from '../src/models/analysis.js'

describe('model analysis', () => {
  it('writes separate daily summary and deep risk model outputs without exposing credentials', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-model-analysis-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 2, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
      riskyStories: [],
      incompleteStories: [],
      isolatedEvidence: [],
      suggestedContacts: [],
    }), 'utf8')

    const artifact = await writeModelAnalysisArtifact({
      reportPath,
      reportsDir,
      analyzer: createStaticModelAnalyzer({
        dailySummary: '今日重点是企业套餐购买进入联调。',
        riskAssessment: '最高风险是测试计划缺失，需要 owner 补齐。',
      }),
      config: testConfig(),
    })

    expect(artifact.analysisPath).toContain('2026-05-31-pmo-model-analysis.json')
    const stored = JSON.parse(await readFile(artifact.analysisPath, 'utf8')) as any
    expect(stored).toMatchObject({
      date: '2026-05-31',
      provider: 'z.ai',
      daily: {
        model: 'glm-5-turbo',
        summary: '今日重点是企业套餐购买进入联调。',
      },
      risk: {
        model: 'glm-5.1',
        assessment: '最高风险是测试计划缺失，需要 owner 补齐。',
      },
    })
    expect(JSON.stringify(stored)).not.toContain('secret-value')
    expect(JSON.stringify(stored)).not.toMatch(/api[_-]?key|token|password|secret/i)
  })
})

function testConfig(): AppConfig {
  return {
    gitlab: { baseUrl: 'https://dev.aminer.cn', group: 'open-platform', token: 'secret-value' },
    feishuProject: {
      mcpUrl: 'https://project.feishu.cn/mcp_server/v1',
      spaceName: 'MAAS_平台',
      spaceUrl: 'https://project.feishu.cn/space',
      activeStatuses: ['开发阶段'],
    },
    audit: { timezone: 'Asia/Shanghai', reportsDir: 'reports' },
    models: {
      provider: 'z.ai',
      apiKey: 'secret-value',
      daily: { protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-5-turbo' },
      risk: { protocol: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.1' },
    },
  }
}

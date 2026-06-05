import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/config.js'
import { buildPreflightReport } from '../src/preflight.js'

describe('PMO preflight', () => {
  it('summarizes dependency readiness without exposing secrets', () => {
    const report = buildPreflightReport({
      config: testConfig(),
      checks: [
        { name: 'GitLab open-platform', status: 'pass', detail: 'Connected with token secret-value.' },
        { name: 'Feishu Project MCP', status: 'pass', detail: 'Connected.' },
        { name: 'lark-mcp OAuth', status: 'warn', detail: 'Missing docs:doc.', nextStep: 'Add docs:doc.' },
      ],
      env: {
        ZAI_API_KEY: 'secret-value',
        PMO_FEISHU_IM_DELIVERY_ENABLED: 'false',
        FEISHU_TENANT_ACCESS_TOKEN: 'secret-value',
        PMO_FEISHU_FIELD_GOAL: 'field_goal',
        PMO_FEISHU_FIELD_TEST_PLAN: 'field_test_plan',
        PMO_FEISHU_FIELD_NEXT_STEP: 'field_next_step',
        PMO_FEISHU_FIELD_DUE_DATE: 'field_due_date',
      },
      generatedAt: new Date('2026-05-31T01:00:00.000Z'),
    })

    expect(report.status).toBe('warn')
    expect(report.generatedAt).toBe('2026-05-31T01:00:00.000Z')
    expect(report.summary).toMatchObject({ passed: 6, warnings: 2, failed: 0 })
    expect(report.checks.map(check => check.name)).toEqual([
      'GitLab open-platform',
      'Feishu Project MCP',
      'lark-mcp OAuth',
      'z.ai models',
      'Feishu OpenAPI Contacts/IM',
      'Feishu IM delivery',
      'Feishu Project writeback mapping',
      'scheduler',
    ])
    expect(report.checks.find(check => check.name === 'z.ai models')).toMatchObject({
      status: 'pass',
      detail: 'Configured provider z.ai with daily model glm-5-turbo and risk model glm-5.1.',
    })
    expect(report.checks.find(check => check.name === 'Feishu IM delivery')).toMatchObject({
      status: 'warn',
      detail: 'Real Feishu IM delivery is disabled. Dry-run delivery remains available.',
    })
    expect(JSON.stringify(report)).not.toContain('secret-value')
    expect(JSON.stringify(report)).not.toMatch(/token|password|api[_-]?key/i)
  })

  it('fails when z.ai API key is missing because analysis models are not ready', () => {
    const report = buildPreflightReport({
      config: { ...testConfig(), models: { ...testConfig().models, apiKey: undefined } },
      checks: [],
      env: {},
    })

    expect(report.status).toBe('fail')
    expect(report.checks.find(check => check.name === 'z.ai models')).toMatchObject({
      status: 'fail',
    })
  })

  it('fails closed when real Feishu IM delivery is enabled without OpenAPI credentials', () => {
    const report = buildPreflightReport({
      config: testConfig(),
      checks: [],
      env: { PMO_FEISHU_IM_DELIVERY_ENABLED: 'true' },
    })

    expect(report.status).toBe('fail')
    expect(report.checks.find(check => check.name === 'Feishu IM delivery')).toMatchObject({
      status: 'fail',
    })
  })

  it('warns when approved project writeback field mapping is incomplete', () => {
    const report = buildPreflightReport({
      config: testConfig(),
      checks: [],
      env: {},
    })

    expect(report.checks.find(check => check.name === 'Feishu Project writeback mapping')).toMatchObject({
      status: 'warn',
    })
  })

  it('does not fail preflight on expired lark-mcp when Feishu document output uses OpenAPI', () => {
    const report = buildPreflightReport({
      config: testConfig(),
      checks: [
        { name: 'lark-mcp OAuth', status: 'fail', detail: 'user_access_token is expired' },
      ],
      env: {
        PMO_FEISHU_DOC_OUTPUT_MODE: 'openapi',
        FEISHU_APP_ID: 'app',
        FEISHU_APP_SECRET: 'secret-value',
        ZAI_API_KEY: 'secret-value',
      },
    })

    expect(report.checks.find(check => check.name === 'lark-mcp OAuth')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('OpenAPI'),
    })
    expect(report.status).toBe('warn')
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
      headers: { 'X-Mcp-Token': 'secret-value' },
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

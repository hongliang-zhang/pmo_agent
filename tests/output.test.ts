import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeLocalReport, writeLocalReportArtifacts } from '../src/output/local.js'
import type { AuditReport } from '../src/domain.js'
import { createFeishuDocOutput, createFeishuOpenApiDocOutput, defaultLarkMcpLaunchFromEnv, ensureMcpToolSucceeded, extractDocumentResult, explainFeishuDocSetupFailure, FeishuDocSetupError } from '../src/feishu/docs-output.js'

describe('report output', () => {
  it('writes local markdown reports to the configured directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-report-'))
    try {
      const path = await writeLocalReport({ reportsDir: dir, date: '2026-05-31', markdown: '# Report' })

      await expect(readFile(path, 'utf8')).resolves.toBe('# Report')
      expect(path).toContain('2026-05-31-pmo-audit.md')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes a complete filesystem artifact set for local delivery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-artifacts-'))
    const report: AuditReport = {
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 2, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
    }
    try {
      const artifacts = await writeLocalReportArtifacts({
        reportsDir: dir,
        date: '2026-05-31',
        markdown: '# Report',
        report,
      })

      await expect(readFile(artifacts.markdownPath, 'utf8')).resolves.toBe('# Report')
      await expect(readFile(artifacts.latestMarkdownPath, 'utf8')).resolves.toBe('# Report')

      const html = await readFile(artifacts.htmlPath, 'utf8')
      expect(html).toContain('<!doctype html>')
      expect(html).toContain('<title>MAAS_平台 PMO 状态核查日报 2026-05-31</title>')
      expect(html).not.toContain('<pre># Report</pre>')
      expect(html).toContain('class="pmo-shell"')
      expect(html).toContain('PMO 状态核查')
      expect(html).toContain('class="metric-grid"')
      await expect(readFile(artifacts.latestHtmlPath, 'utf8')).resolves.toBe(html)

      const json = JSON.parse(await readFile(artifacts.jsonPath, 'utf8'))
      expect(json.summary.stories).toBe(2)

      const manifest = JSON.parse(await readFile(artifacts.manifestPath, 'utf8'))
      expect(manifest.date).toBe('2026-05-31')
      expect(manifest.files.markdown).toBe(artifacts.markdownPath)
      expect(manifest.files.html).toBe(artifacts.htmlPath)
      expect(manifest.files.index).toBe(artifacts.indexPath)
      expect(manifest.files.indexJson).toBe(artifacts.indexJsonPath)
      expect(manifest.files.latestHtml).toBe(artifacts.latestHtmlPath)
      expect(manifest.summary.risky).toBe(1)
      expect(manifest.generatedAt).toMatch(/T/)

      const indexJson = JSON.parse(await readFile(artifacts.indexJsonPath, 'utf8'))
      expect(indexJson.latest.date).toBe('2026-05-31')
      expect(indexJson.reports[0].files.html).toBe(artifacts.htmlPath)

      const indexHtml = await readFile(artifacts.indexPath, 'utf8')
      expect(indexHtml).toContain('<title>PMO Agent Reports</title>')
      expect(indexHtml).toContain('MAAS_平台 PMO 状态核查日报 2026-05-31')
      expect(indexHtml).toContain('2026-05-31-pmo-audit.html')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps historical report entries in the local index', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-index-history-'))
    try {
      await writeLocalReportArtifacts({
        reportsDir: dir,
        date: '2026-05-31',
        markdown: '# Old',
        report: testReport('2026-05-31', 2),
        generatedAt: new Date('2026-05-31T08:00:00.000Z'),
      })
      await writeLocalReportArtifacts({
        reportsDir: dir,
        date: '2026-06-01',
        markdown: '# New',
        report: testReport('2026-06-01', 3),
        generatedAt: new Date('2026-06-01T08:00:00.000Z'),
      })

      const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))
      expect(index.latest.date).toBe('2026-06-01')
      expect(index.reports.map((report: any) => report.date)).toEqual(['2026-06-01', '2026-05-31'])
      expect(index.reports[1].summary.stories).toBe(2)

      const indexHtml = await readFile(join(dir, 'index.html'), 'utf8')
      expect(indexHtml).toContain('2026-06-01-pmo-audit.html')
      expect(indexHtml).toContain('2026-05-31-pmo-audit.html')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('renders structured report HTML instead of replaying markdown tables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-readable-html-'))
    try {
      const artifacts = await writeLocalReportArtifacts({
        reportsDir: dir,
        date: '2026-06-01',
        markdown: [
          '# PMO Report',
          '',
          '## 风险需求',
          '',
          '| 需求 | 风险 | 建议 |',
          '|---|---|---|',
          '| [企业套餐购买](https://project.feishu.cn/story/detail/1) | missing_goal | 补目标 |',
          '',
          '- 暂无。',
        ].join('\n'),
        report: testReport('2026-06-01', 1),
      })

      const html = await readFile(artifacts.htmlPath, 'utf8')
      expect(html).toContain('class="section-grid"')
      expect(html).toContain('class="risk-list"')
      expect(html).toContain('class="evidence-pill"')
      expect(html).not.toContain('| 需求 | 风险 | 建议 |')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('explains how to configure lark-mcp when Feishu doc output cannot start', async () => {
    const output = createFeishuDocOutput({ codexConfigPath: '/missing/config.toml' })

    await expect(output.createDocument('# Report')).rejects.toBeInstanceOf(FeishuDocSetupError)
  })

  it('does not treat Feishu app authorization URLs as report document URLs', () => {
    const result = extractDocumentResult({
      content: [{
        type: 'text',
        text: 'Authorization https://open.feishu.cn/app/cli_x/safe\\n{"document_id":"docxABC123456789","url":"https://zhipu-ai.feishu.cn/docx/docxABC123456789"}',
      }],
    })

    expect(result.documentId).toBe('docxABC123456789')
    expect(result.url).toBe('https://zhipu-ai.feishu.cn/docx/docxABC123456789')
  })

  it('treats MCP tool isError responses as setup failures', async () => {
    expect(() => ensureMcpToolSucceeded({ isError: true, content: [{ type: 'text', text: 'token expired' }] }))
      .toThrow(FeishuDocSetupError)
  })

  it('treats lark-mcp document import failure text as setup failures', () => {
    expect(() => ensureMcpToolSucceeded({ content: [{ type: 'text', text: '{"msg":"Document import failed, please try again later"}' }] }))
      .toThrow(FeishuDocSetupError)
  })

  it('builds lark-mcp launch args from Feishu app credentials when explicit args are absent', () => {
    const launch = defaultLarkMcpLaunchFromEnv({
      FEISHU_APP_ID: 'cli_app',
      FEISHU_APP_SECRET: 'app-secret',
    })

    expect(launch).toEqual({
      command: 'npx',
      args: ['-y', '@larksuiteoapi/lark-mcp', 'mcp', '-a', 'cli_app', '-s', 'app-secret', '--oauth'],
    })
  })

  it('creates Feishu documents through OpenAPI when selected', async () => {
    const output = createFeishuOpenApiDocOutput({
      client: {
        async createDocxDocumentFromMarkdown(input) {
          expect(input.title).toBe('MAAS_平台 PMO 状态核查日报')
          expect(input.markdown).toBe('# Report')
          return { documentId: 'docx_1', url: 'https://zhipu-ai.feishu.cn/docx/docx_1', raw: { ok: true } }
        },
      },
    })

    await expect(output.createDocument('# Report')).resolves.toEqual({
      documentId: 'docx_1',
      url: 'https://zhipu-ai.feishu.cn/docx/docx_1',
      raw: { ok: true },
    })
  })

  it('selects OpenAPI document output from env mode', async () => {
    const output = createFeishuDocOutput({
      env: {
        PMO_FEISHU_DOC_OUTPUT_MODE: 'openapi',
        FEISHU_TENANT_ACCESS_TOKEN: 'tenant-token',
        PMO_FEISHU_DOC_WEB_BASE_URL: 'https://zhipu-ai.feishu.cn/docx',
      },
      openApiClient: {
        async createDocxDocumentFromMarkdown() {
          return { documentId: 'docx_env', raw: {} }
        },
      },
    })

    await expect(output.createDocument('# Report')).resolves.toMatchObject({
      documentId: 'docx_env',
      url: 'https://zhipu-ai.feishu.cn/docx/docx_env',
    })
  })

  it('turns Feishu permission errors into actionable setup guidance', () => {
    const message = explainFeishuDocSetupFailure('{"code":99991672,"msg":"Access denied. One of the following scopes is required: [docs:doc, drive:drive]","url":"https://open.feishu.cn/app/cli_x/auth?q=docs:doc"}')

    expect(message).toContain('Feishu app permissions are missing')
    expect(message).toContain('docs:doc')
    expect(message).toContain('rerun lark-mcp login')
  })
})

function testReport(date: string, stories: number): AuditReport {
  return {
    title: `MAAS_平台 PMO 状态核查日报 ${date}`,
    date,
    summary: { stories, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
    progressedStories: [],
    riskyStories: [],
    incompleteStories: [],
    gitlabEvidence: [],
    isolatedEvidence: [],
    suggestedContacts: [],
    noNeedToDisturb: [],
  }
}

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeLocalReport } from '../src/output/local.js'
import { createFeishuDocOutput, ensureMcpToolSucceeded, extractDocumentResult, explainFeishuDocSetupFailure, FeishuDocSetupError } from '../src/feishu/docs-output.js'

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

  it('turns Feishu permission errors into actionable setup guidance', () => {
    const message = explainFeishuDocSetupFailure('{"code":99991672,"msg":"Access denied. One of the following scopes is required: [docs:doc, drive:drive]","url":"https://open.feishu.cn/app/cli_x/auth?q=docs:doc"}')

    expect(message).toContain('Feishu app permissions are missing')
    expect(message).toContain('docs:doc')
    expect(message).toContain('rerun lark-mcp login')
  })
})

import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { AuditReport } from '../src/domain.js'
import { createReportDeliveryDraft } from '../src/server/drafts.js'

const execFileAsync = promisify(execFile)

describe('communication drafts CLI', () => {
  it('lists, approves, and dry-run delivers a report delivery draft', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-drafts-cli-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify(testReport()), 'utf8')
    const draft = await createReportDeliveryDraft({
      reportsDir,
      reportPath,
      recipient: '张鸿亮',
      recipientIdentity: { userId: 'test-user-id' },
      now: new Date('2026-06-02T03:00:00Z'),
      feishuDocUrl: 'https://zhipu-ai.feishu.cn/docx/docx_1',
      reportHtmlPath: 'reports/2026-06-02-pmo-audit.html',
    })

    const listed = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/drafts.ts',
      '--',
      'list',
      '--reportsDir',
      reportsDir,
    ], { cwd: process.cwd() })).stdout)
    expect(listed.success).toBe(true)
    expect(listed.drafts[0]).toMatchObject({ id: draft.id, status: 'pending_approval', recipient: '张鸿亮' })

    const shown = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/drafts.ts',
      '--',
      'show',
      '--reportsDir',
      reportsDir,
      '--draftId',
      draft.id,
    ], { cwd: process.cwd() })).stdout)
    expect(shown).toMatchObject({
      success: true,
      draft: {
        id: draft.id,
        status: 'pending_approval',
        recipient: '张鸿亮',
      },
      nextCommands: {
        approve: expect.stringContaining('pmo:drafts -- approve'),
        dryRun: expect.stringContaining('pmo:drafts -- deliver'),
      },
    })
    expect(shown.draft.message).toContain('飞书文档')
    expect(JSON.stringify(shown)).not.toMatch(/token|secret|password|api[_-]?key/i)

    const approved = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/drafts.ts',
      '--',
      'approve',
      '--reportsDir',
      reportsDir,
      '--draftId',
      draft.id,
      '--actor',
      '张鸿亮',
      '--note',
      '同意发送日报',
    ], { cwd: process.cwd() })).stdout)
    expect(approved).toMatchObject({ success: true, draft: { id: draft.id, status: 'approved' } })

    const delivered = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/drafts.ts',
      '--',
      'deliver',
      '--reportsDir',
      reportsDir,
      '--draftId',
      draft.id,
      '--actor',
      '张鸿亮',
      '--dryRun',
    ], { cwd: process.cwd() })).stdout)
    expect(delivered).toMatchObject({ success: true, mode: 'dry_run', draftId: draft.id })
    expect(JSON.stringify(delivered)).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)
})

function testReport(): AuditReport {
  return {
    title: 'MAAS_平台 PMO 状态核查日报 2026-06-02',
    date: '2026-06-02',
    summary: { stories: 50, progressed: 3, risky: 5, incomplete: 4, suggestedContacts: 2 },
    progressedStories: [],
    riskyStories: [],
    incompleteStories: [],
    gitlabEvidence: [],
    isolatedEvidence: [],
    suggestedContacts: [],
    noNeedToDisturb: [],
  }
}

import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { AuditReport } from '../src/domain.js'
import { createReportDeliveryDraft } from '../src/server/drafts.js'

const execFileAsync = promisify(execFile)

describe('approval center CLI', () => {
  it('refreshes and lists pending approvals without exposing credentials', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-approvals-cli-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify(testReport()), 'utf8')
    const draft = await createReportDeliveryDraft({
      reportsDir,
      reportPath,
      recipient: '张鸿亮',
      recipientIdentity: { userId: 'test-user-id' },
      now: new Date('2026-06-02T03:00:00Z'),
    })

    const refreshed = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/approvals.ts',
      '--',
      'refresh',
      '--reportsDir',
      reportsDir,
    ], { cwd: process.cwd() })).stdout)
    expect(refreshed).toMatchObject({
      success: true,
      artifacts: {
        approvalHtmlPath: expect.stringContaining('approval-center.html'),
        approvalJsonPath: expect.stringContaining('approval-center.json'),
      },
      summary: {
        pendingCommunicationDrafts: 1,
        pendingProjectUpdates: 0,
        totalPendingApprovals: 1,
      },
    })

    const listed = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/approvals.ts',
      '--',
      'list',
      '--reportsDir',
      reportsDir,
    ], { cwd: process.cwd() })).stdout)
    expect(listed).toMatchObject({
      success: true,
      summary: { totalPendingApprovals: 1 },
      pendingCommunicationDrafts: [{ id: draft.id, recipient: '张鸿亮' }],
      nextCommands: {
        refresh: expect.stringContaining('pmo:approvals -- refresh'),
        showDraft: expect.stringContaining('pmo:drafts -- show'),
      },
    })
    expect(JSON.stringify(listed)).not.toMatch(/token|secret|password|api[_-]?key/i)

    const shown = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/approvals.ts',
      '--',
      'show',
      '--reportsDir',
      reportsDir,
      '--id',
      draft.id,
    ], { cwd: process.cwd() })).stdout)
    expect(shown).toMatchObject({
      success: true,
      approval: {
        type: 'communication_draft',
        id: draft.id,
        item: { recipient: '张鸿亮', reason: 'daily_report_delivery' },
      },
      nextCommands: {
        show: expect.stringContaining('pmo:drafts -- show'),
        approve: expect.stringContaining('pmo:drafts -- approve'),
        dryRun: expect.stringContaining('pmo:drafts -- deliver'),
      },
    })
    expect(JSON.stringify(shown)).not.toMatch(/token|secret|password|api[_-]?key/i)
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

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('phase 3.5 acceptance CLI', () => {
  it('prints requirement-by-requirement status from local evidence without leaking credentials', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-acceptance-cli-'))
    await writeFile(join(reportsDir, 'approval-center.json'), JSON.stringify({
      generatedAt: '2026-06-02T10:00:00.000Z',
      summary: { pendingCommunicationDrafts: 1, pendingProjectUpdates: 0, totalPendingApprovals: 1 },
      pendingCommunicationDrafts: [{ id: 'D1', recipient: '张鸿亮', reason: 'daily_report_delivery' }],
      pendingProjectUpdates: [],
      commands: [],
    }), 'utf8')
    await writeFile(join(reportsDir, 'ops-dashboard.json'), JSON.stringify({
      generatedAt: '2026-06-02T10:00:00.000Z',
      summary: { runs: 1, failedRuns: 0, drafts: 1, pendingDrafts: 1, alerts: 0 },
    }), 'utf8')

    const result = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/acceptance.ts',
      '--',
      '--reportsDir',
      reportsDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PMO_FEISHU_IM_DELIVERY_ENABLED: 'false',
      },
    })).stdout)

    expect(result).toMatchObject({
      success: true,
      summary: {
        total: 9,
        complete: expect.any(Number),
        pending: expect.any(Number),
        blocked: 0,
      },
      requirements: [
        { id: 1, title: expect.stringContaining('人员映射'), status: 'complete' },
        { id: 2, title: expect.stringContaining('打扰策略'), status: 'complete' },
        { id: 3, title: expect.stringContaining('消息发送'), status: 'pending_live_validation' },
        { id: 4, title: expect.stringContaining('飞书项目回写'), status: 'complete' },
        { id: 5, title: expect.stringContaining('腾讯云'), status: 'pending_live_validation' },
        { id: 6, title: expect.stringContaining('报告接收'), status: 'pending_live_validation' },
        { id: 7, title: expect.stringContaining('回复自动进入闭环'), status: 'complete' },
        { id: 8, title: expect.stringContaining('生产调度'), status: 'pending_live_validation' },
        { id: 9, title: expect.stringContaining('报告内容'), status: 'complete' },
      ],
    })
    expect(result.remainingActions.join('\n')).toContain('PMO_FEISHU_IM_DELIVERY_ENABLED=true')
    expect(result.remainingActions.join('\n')).toContain('腾讯云')
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|api[_-]?key/i)

    const written = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/acceptance.ts',
      '--',
      '--reportsDir',
      reportsDir,
      '--write',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PMO_FEISHU_IM_DELIVERY_ENABLED: 'false',
      },
    })).stdout)
    expect(written).toMatchObject({
      success: true,
      artifacts: {
        jsonPath: expect.stringContaining('phase3.5-acceptance.json'),
        markdownPath: expect.stringContaining('phase3.5-acceptance.md'),
      },
    })

    const markdown = await readFile(written.artifacts.markdownPath, 'utf8')
    expect(markdown).toContain('PMO Agent Phase 3.5 Acceptance')
    expect(markdown).toContain('| 3 | 消息发送')
    expect(markdown).toContain('pending_live_validation')
    expect(markdown).toContain('PMO_FEISHU_IM_DELIVERY_ENABLED=true')
    expect(markdown).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)

  it('marks IM delivery requirements complete after a delivery_sent audit event and no pending approvals', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-acceptance-delivered-'))
    await writeFile(join(reportsDir, 'approval-center.json'), JSON.stringify({
      generatedAt: '2026-06-02T10:00:00.000Z',
      summary: { pendingCommunicationDrafts: 0, pendingProjectUpdates: 0, totalPendingApprovals: 0 },
      pendingCommunicationDrafts: [],
      pendingProjectUpdates: [],
      commands: [],
    }), 'utf8')
    await writeFile(join(reportsDir, 'ops-dashboard.json'), JSON.stringify({
      generatedAt: '2026-06-02T10:00:00.000Z',
      summary: { runs: 1, failedRuns: 0, drafts: 1, pendingDrafts: 0, alerts: 0 },
    }), 'utf8')
    await writeFile(join(reportsDir, 'communication-draft-audit.json'), JSON.stringify([{
      id: 'E1',
      draftId: 'D1',
      action: 'delivery_sent',
      actor: '张鸿亮',
      note: 'user_id:[present]',
      at: '2026-06-02T10:39:45.795Z',
    }]), 'utf8')
    await writeFile(join(reportsDir, 'live-validation.json'), JSON.stringify({
      feishuDocUrl: 'https://zhipu-ai.feishu.cn/docx/docx123',
      feishuDocHasNativeTables: true,
    }), 'utf8')

    const result = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/acceptance.ts',
      '--',
      '--reportsDir',
      reportsDir,
    ], { cwd: process.cwd() })).stdout)

    expect(result.requirements.find((item: any) => item.id === 3)).toMatchObject({ status: 'complete' })
    expect(result.requirements.find((item: any) => item.id === 6)).toMatchObject({ status: 'complete' })
    expect(result.summary).toMatchObject({ complete: 7, pending: 2, blocked: 0 })
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)

  it('marks all requirements complete from non-secret live validation evidence', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-acceptance-live-'))
    await writeFile(join(reportsDir, 'approval-center.json'), JSON.stringify({
      generatedAt: '2026-06-02T10:00:00.000Z',
      summary: { pendingCommunicationDrafts: 3, pendingProjectUpdates: 0, totalPendingApprovals: 3 },
      pendingCommunicationDrafts: [],
      pendingProjectUpdates: [],
      commands: [],
    }), 'utf8')
    await writeFile(join(reportsDir, 'ops-dashboard.json'), JSON.stringify({
      generatedAt: '2026-06-02T10:00:00.000Z',
      summary: { runs: 3, failedRuns: 0, drafts: 3, pendingDrafts: 3, alerts: 0 },
    }), 'utf8')
    await writeFile(join(reportsDir, 'live-validation.json'), JSON.stringify({
      feishuImSent: true,
      feishuImSentAt: '2026-06-02T10:39:45.795Z',
      tencentCloudDeployed: true,
      tencentCloudHealthUrl: 'http://<server-ip>/health',
      tencentCloudPreflightPassed: true,
      productionSchedulerRunning: true,
      basicAuthEnabled: true,
      feishuDocUrl: 'https://zhipu-ai.feishu.cn/docx/L6UQdVp1ioFg9nxg6BJcKJSknut',
      feishuDocHasNativeTables: true,
    }), 'utf8')

    const result = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/acceptance.ts',
      '--',
      '--reportsDir',
      reportsDir,
    ], { cwd: process.cwd() })).stdout)

    expect(result.summary).toMatchObject({ total: 9, complete: 9, pending: 0, blocked: 0 })
    expect(result.remainingActions).toEqual([])
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)
})

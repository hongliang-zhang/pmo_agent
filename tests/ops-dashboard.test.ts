import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeOpsDashboard } from '../src/output/ops-dashboard.js'

describe('ops dashboard output', () => {
  it('writes a local PMO ops dashboard with runs, drafts, audit events, and no secrets', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-ops-dashboard-'))
    await writeFile(join(reportsDir, 'runs.json'), JSON.stringify([{
      id: 'R1',
      date: '2026-05-31',
      status: 'success',
      startedAt: '2026-05-31T01:00:00.000Z',
      finishedAt: '2026-05-31T01:01:00.000Z',
      summary: { stories: 3, draftsCreated: 2 },
      artifacts: { reportHtmlPath: join(reportsDir, '2026-05-31-pmo-audit.html') },
      stages: [
        { name: 'render_report', status: 'success', startedAt: '2026-05-31T01:00:00.000Z', finishedAt: '2026-05-31T01:00:30.000Z' },
        { name: 'create_communication_drafts', status: 'success', startedAt: '2026-05-31T01:00:30.000Z', finishedAt: '2026-05-31T01:01:00.000Z', summary: { draftsCreated: 2 } },
      ],
    }, {
      id: 'R2',
      date: '2026-06-01',
      status: 'failed',
      startedAt: '2026-06-01T01:00:00.000Z',
      finishedAt: '2026-06-01T01:01:00.000Z',
      stages: [
        { name: 'render_report', status: 'success', startedAt: '2026-06-01T01:00:00.000Z', finishedAt: '2026-06-01T01:00:30.000Z' },
        { name: 'create_communication_drafts', status: 'failed', startedAt: '2026-06-01T01:00:30.000Z', finishedAt: '2026-06-01T01:01:00.000Z', error: { message: 'draft failed' } },
      ],
    }]), 'utf8')
    await writeFile(join(reportsDir, 'communication-drafts.json'), JSON.stringify([{
      id: 'D1',
      status: 'pending_approval',
      channel: 'feishu_im',
      recipient: '王建辉',
      priority: 'high',
      storyIds: ['S1'],
      storyTitles: ['企业套餐购买'],
      reason: 'missing_next_step',
      message: '请确认下一步',
      sourceReportPath: join(reportsDir, '2026-05-31-pmo-audit.json'),
      createdAt: '2026-05-31T01:01:00.000Z',
    }]), 'utf8')
    await writeFile(join(reportsDir, 'communication-draft-audit.json'), JSON.stringify([{
      id: 'E1',
      draftId: 'D1',
      action: 'approved',
      actor: 'PMO Owner',
      at: '2026-05-31T01:02:00.000Z',
    }]), 'utf8')
    await writeFile(join(reportsDir, 'checkins.json'), JSON.stringify([{
      id: 'C1',
      storyId: 'S1',
      draftId: 'D1',
      responder: '王建辉',
      text: '状态：active\n下一步：完成联调',
      parsed: { status: 'active', nextStep: '完成联调', shouldUpdateProject: false },
      externalWrites: [],
      createdAt: '2026-05-31T01:04:00.000Z',
    }]), 'utf8')
    await writeFile(join(reportsDir, 'project-update-actions.json'), JSON.stringify([{
      id: 'PU1',
      status: 'pending_approval',
      type: 'update_project_fields',
      storyId: 'S1',
      responder: '王建辉',
      proposedFields: { nextStep: '完成联调' },
      sourceCheckInId: 'C1',
      createdAt: '2026-05-31T01:05:00.000Z',
    }]), 'utf8')
    await writeFile(join(reportsDir, 'worker-events.json'), JSON.stringify([{
      at: '2026-06-01T01:02:00.000Z',
      type: 'preflight_blocked',
      detail: 'preflight failed',
    }]), 'utf8')

    const artifacts = await writeOpsDashboard({
      reportsDir,
      generatedAt: new Date('2026-05-31T01:03:00.000Z'),
      preflight: {
        status: 'warn',
        generatedAt: '2026-05-31T01:02:00.000Z',
        summary: { passed: 4, warnings: 1, failed: 1 },
        checks: [
          { name: 'lark-mcp OAuth', status: 'warn', detail: 'Missing docx:document.' },
          { name: 'z.ai models', status: 'fail', detail: 'Missing credential.', nextStep: 'Set local model credential.' },
        ],
      },
      latestSmoke: {
        success: true,
        baseUrl: 'http://127.0.0.1:3201',
        runId: 'R1',
        steps: [
          { name: 'health', status: 'success' },
          { name: 'scheduler_tick', status: 'success' },
        ],
        summary: { runStatus: 'success', drafts: 1, actionsInvoked: 1 },
      },
    })

    expect(artifacts.htmlPath).toContain('ops-dashboard.html')
    expect(artifacts.jsonPath).toContain('ops-dashboard.json')
    expect(artifacts.alertsPath).toContain('ops-alerts.json')
    expect(artifacts.approvalHtmlPath).toContain('approval-center.html')
    expect(artifacts.approvalJsonPath).toContain('approval-center.json')
    const html = await readFile(artifacts.htmlPath, 'utf8')
    expect(html).toContain('<title>PMO Agent Ops</title>')
    expect(html).toContain('R1')
    expect(html).toContain('render_report')
    expect(html).toContain('Readiness')
    expect(html).toContain('lark-mcp OAuth')
    expect(html).toContain('Latest Smoke')
    expect(html).toContain('Active Alerts')
    expect(html).toContain('Preflight failed: z.ai models')
    expect(html).toContain('Worker event: preflight_blocked')
    expect(html).toContain('Pending project writeback actions')
    expect(html).toContain('scheduler_tick')
    expect(html).toContain('Recovery Actions')
    expect(html).toContain('create_communication_drafts')
    expect(html).toContain('retry-stage')
    expect(html).toContain('pending_approval')
    expect(html).toContain('企业套餐购买')
    expect(html).toContain('approved')
    expect(html).toContain('Check-ins')
    expect(html).toContain('完成联调')
    expect(html).not.toMatch(/token|secret|password|api[_-]?key/i)

    const json = JSON.parse(await readFile(artifacts.jsonPath, 'utf8'))
    expect(json.summary).toMatchObject({ runs: 2, failedRuns: 1, drafts: 1, pendingDrafts: 1, auditEvents: 1, checkins: 1, recoveryActions: 1, alerts: 5 })
    expect(json.readiness.status).toBe('warn')
    expect(json.latestSmoke.success).toBe(true)
    expect(json.alerts.map((alert: any) => alert.source)).toEqual(expect.arrayContaining(['preflight', 'run', 'stage', 'project_writeback', 'worker']))
    expect(json.recoveryActions[0]).toMatchObject({
      runId: 'R2',
      stage: 'create_communication_drafts',
      endpoint: '/runs/R2/retry-stage',
    })
    const alerts = JSON.parse(await readFile(artifacts.alertsPath, 'utf8'))
    expect(alerts).toHaveLength(5)
    expect(JSON.stringify(alerts)).not.toMatch(/token|secret|password|api[_-]?key/i)

    const approvalHtml = await readFile(artifacts.approvalHtmlPath, 'utf8')
    expect(approvalHtml).toContain('<title>PMO Approval Center</title>')
    expect(approvalHtml).toContain('Communication Draft Approvals')
    expect(approvalHtml).toContain('Project Writeback Approvals')
    expect(approvalHtml).toContain('pnpm pmo:drafts -- show')
    expect(approvalHtml).toContain('pnpm pmo:project-updates -- show')
    expect(approvalHtml).toContain('企业套餐购买')
    expect(approvalHtml).toContain('完成联调')
    expect(approvalHtml).not.toMatch(/token|secret|password|api[_-]?key/i)

    const approval = JSON.parse(await readFile(artifacts.approvalJsonPath, 'utf8'))
    expect(approval.summary).toMatchObject({ pendingCommunicationDrafts: 1, pendingProjectUpdates: 1, totalPendingApprovals: 2 })
    expect(approval.pendingCommunicationDrafts[0]).toMatchObject({ id: 'D1', recipient: '王建辉' })
    expect(approval.pendingProjectUpdates[0]).toMatchObject({ id: 'PU1', storyId: 'S1' })
    expect(JSON.stringify(approval)).not.toMatch(/token|secret|password|api[_-]?key/i)
  })
})

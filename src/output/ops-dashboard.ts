import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommunicationDraft, CommunicationDraftAuditEvent } from '../server/drafts.js'
import type { CheckInRecord, ProjectUpdateAction } from '../server/checkins.js'
import type { PmoRunRecord, PmoRunStage } from '../server/runs.js'
import type { PreflightReport } from '../preflight.js'
import type { LocalSmokeResult } from '../smoke/local.js'

export interface OpsDashboardArtifacts {
  htmlPath: string
  jsonPath: string
  alertsPath: string
  approvalHtmlPath: string
  approvalJsonPath: string
}

interface OpsDashboardData {
  generatedAt: string
  summary: {
    runs: number
    failedRuns: number
    drafts: number
    pendingDrafts: number
    auditEvents: number
    checkins: number
    recoveryActions: number
    projectUpdateActions: number
    workerEvents: number
    alerts: number
  }
  readiness?: PreflightReport
  latestSmoke?: LocalSmokeResult
  alerts: OpsAlert[]
  recoveryActions: RecoveryAction[]
  runs: PmoRunRecord[]
  drafts: CommunicationDraft[]
  auditEvents: CommunicationDraftAuditEvent[]
  checkins: CheckInRecord[]
  projectUpdateActions: ProjectUpdateAction[]
  workerEvents: Array<{ at: string; type: string; detail: string }>
}

interface ApprovalCenterData {
  generatedAt: string
  summary: {
    pendingCommunicationDrafts: number
    pendingProjectUpdates: number
    totalPendingApprovals: number
  }
  pendingCommunicationDrafts: CommunicationDraft[]
  pendingProjectUpdates: ProjectUpdateAction[]
  commands: Array<{ type: 'communication_draft' | 'project_update'; id: string; label: string; command: string }>
}

interface RecoveryAction {
  runId: string
  stage: string
  endpoint: string
  reason: string
}

interface OpsAlert {
  id: string
  severity: 'critical' | 'high' | 'medium'
  source: 'preflight' | 'run' | 'stage' | 'drafts' | 'project_writeback' | 'worker'
  title: string
  detail: string
  action: string
  createdAt: string
}

export async function writeOpsDashboard(input: {
  reportsDir: string
  generatedAt?: Date
  preflight?: PreflightReport
  latestSmoke?: LocalSmokeResult
}): Promise<OpsDashboardArtifacts> {
  await mkdir(input.reportsDir, { recursive: true })
  const data = await buildOpsDashboardData({
    reportsDir: input.reportsDir,
    generatedAt: input.generatedAt ?? new Date(),
    preflight: input.preflight,
    latestSmoke: input.latestSmoke,
  })
  const htmlPath = join(input.reportsDir, 'ops-dashboard.html')
  const jsonPath = join(input.reportsDir, 'ops-dashboard.json')
  const alertsPath = join(input.reportsDir, 'ops-alerts.json')
  const approvalHtmlPath = join(input.reportsDir, 'approval-center.html')
  const approvalJsonPath = join(input.reportsDir, 'approval-center.json')
  const approvalCenter = buildApprovalCenterData(data)
  await Promise.all([
    writeFile(htmlPath, renderOpsDashboardHtml(data), 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8'),
    writeFile(alertsPath, `${JSON.stringify(data.alerts, null, 2)}\n`, 'utf8'),
    writeFile(approvalHtmlPath, renderApprovalCenterHtml(approvalCenter), 'utf8'),
    writeFile(approvalJsonPath, `${JSON.stringify(approvalCenter, null, 2)}\n`, 'utf8'),
  ])
  return { htmlPath, jsonPath, alertsPath, approvalHtmlPath, approvalJsonPath }
}

async function buildOpsDashboardData(input: {
  reportsDir: string
  generatedAt: Date
  preflight?: PreflightReport
  latestSmoke?: LocalSmokeResult
}): Promise<OpsDashboardData> {
  const reportsDir = input.reportsDir
  const runs = await readJsonArray<PmoRunRecord>(join(reportsDir, 'runs.json'))
  const drafts = await readJsonArray<CommunicationDraft>(join(reportsDir, 'communication-drafts.json'))
  const auditEvents = await readJsonArray<CommunicationDraftAuditEvent>(join(reportsDir, 'communication-draft-audit.json'))
  const checkins = await readJsonArray<CheckInRecord>(join(reportsDir, 'checkins.json'))
  const projectUpdateActions = await readJsonArray<ProjectUpdateAction>(join(reportsDir, 'project-update-actions.json'))
  const workerEvents = await readJsonArray<{ at: string; type: string; detail: string }>(join(reportsDir, 'worker-events.json'))
  const recoveryActions = buildRecoveryActions(runs)
  const alerts = buildOpsAlerts({
    generatedAt: input.generatedAt.toISOString(),
    readiness: input.preflight,
    runs,
    drafts,
    projectUpdateActions,
    workerEvents,
  })
  return {
    generatedAt: input.generatedAt.toISOString(),
    summary: {
      runs: runs.length,
      failedRuns: runs.filter(run => run.status === 'failed').length,
      drafts: drafts.length,
      pendingDrafts: drafts.filter(draft => draft.status === 'pending_approval').length,
      auditEvents: auditEvents.length,
      checkins: checkins.length,
      recoveryActions: recoveryActions.length,
      projectUpdateActions: projectUpdateActions.length,
      workerEvents: workerEvents.length,
      alerts: alerts.length,
    },
    readiness: input.preflight,
    latestSmoke: input.latestSmoke,
    alerts,
    recoveryActions,
    runs,
    drafts,
    auditEvents,
    checkins,
    projectUpdateActions,
    workerEvents,
  }
}

function buildOpsAlerts(input: {
  generatedAt: string
  readiness?: PreflightReport
  runs: PmoRunRecord[]
  drafts: CommunicationDraft[]
  projectUpdateActions: ProjectUpdateAction[]
  workerEvents: Array<{ at: string; type: string; detail: string }>
}): OpsAlert[] {
  const alerts: OpsAlert[] = []
  for (const check of input.readiness?.checks ?? []) {
    if (check.status !== 'fail') continue
    alerts.push({
      id: `preflight-${check.name}`,
      severity: 'critical',
      source: 'preflight',
      title: `Preflight failed: ${check.name}`,
      detail: check.detail,
      action: check.nextStep ?? 'Fix the failing preflight check before enabling scheduled production runs.',
      createdAt: input.generatedAt,
    })
  }
  for (const run of input.runs.filter(item => item.status === 'failed').slice(0, 10)) {
    alerts.push({
      id: `run-${run.id}`,
      severity: 'high',
      source: 'run',
      title: `PMO run failed: ${run.date}`,
      detail: runErrorMessage(run),
      action: 'Open ops-dashboard.html, inspect failed stages, and retry recoverable stages when available.',
      createdAt: run.finishedAt,
    })
    for (const stage of (run.stages ?? []).filter(item => item.status === 'failed')) {
      alerts.push({
        id: `stage-${run.id}-${stage.name}`,
        severity: 'high',
        source: 'stage',
        title: `PMO stage failed: ${stage.name}`,
        detail: stageErrorMessage(stage),
        action: stage.name === 'create_communication_drafts'
          ? `POST /runs/${run.id}/retry-stage with stage=create_communication_drafts.`
          : 'Fix the stage dependency and rerun the agent cycle.',
        createdAt: stage.finishedAt,
      })
    }
  }
  const pendingDrafts = input.drafts.filter(draft => draft.status === 'pending_approval')
  if (pendingDrafts.length >= 10) {
    alerts.push({
      id: 'drafts-pending-approval',
      severity: 'medium',
      source: 'drafts',
      title: `Pending communication drafts: ${pendingDrafts.length}`,
      detail: 'Communication queue has accumulated pending approval drafts.',
      action: 'Review drafts in Communication Drafts, approve/reject stale items, and deliver approved items outside quiet hours.',
      createdAt: input.generatedAt,
    })
  }
  const pendingProjectUpdates = input.projectUpdateActions.filter(action => action.status === 'pending_approval')
  if (pendingProjectUpdates.length > 0) {
    alerts.push({
      id: 'project-writeback-pending-approval',
      severity: 'medium',
      source: 'project_writeback',
      title: `Pending project writeback actions: ${pendingProjectUpdates.length}`,
      detail: 'Project writeback queue has actions waiting for human approval.',
      action: 'Review Project Update Actions and approve/reject each writeback before applying fields to Feishu Project.',
      createdAt: input.generatedAt,
    })
  }
  for (const event of input.workerEvents.filter(event => event.type === 'preflight_blocked' || event.type === 'worker_error').slice(0, 10)) {
    alerts.push({
      id: `worker-${event.at}-${event.type}`,
      severity: event.type === 'worker_error' ? 'high' : 'critical',
      source: 'worker',
      title: `Worker event: ${event.type}`,
      detail: event.detail,
      action: event.type === 'preflight_blocked' ? 'Run pnpm pmo:doctor and fix blocking dependencies.' : 'Inspect worker logs and restart after the root cause is fixed.',
      createdAt: event.at,
    })
  }
  return alerts
}

function buildRecoveryActions(runs: PmoRunRecord[]): RecoveryAction[] {
  const actions: RecoveryAction[] = []
  for (const run of runs) {
    for (const stage of run.stages ?? []) {
      if (stage.status !== 'failed') continue
      if (stage.name === 'create_communication_drafts') {
        actions.push({
          runId: run.id,
          stage: stage.name,
          endpoint: `/runs/${run.id}/retry-stage`,
          reason: stage.error && typeof stage.error === 'object' && 'message' in stage.error ? String((stage.error as any).message) : 'stage failed',
        })
      }
    }
  }
  return actions
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  try {
    const records = JSON.parse(await readFile(path, 'utf8')) as T[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

function renderOpsDashboardHtml(data: OpsDashboardData): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>PMO Agent Ops</title>',
    '<style>',
    ':root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328;background:#f4f6f8;line-height:1.5}',
    'body{margin:0;padding:28px;background:#f4f6f8}',
    'main{max-width:1320px;margin:0 auto}',
    'header{margin-bottom:20px}.title{font-size:28px;margin:0 0 4px}.meta{color:#57606a;font-size:14px;margin:0}',
    '.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:18px 0 24px}',
    '.metric{background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:14px}.metric strong{display:block;font-size:24px}.metric span{color:#57606a;font-size:13px}',
    'section{background:#fff;border:1px solid #d8dee4;border-radius:8px;margin:16px 0;padding:18px}',
    'h2{font-size:18px;margin:0 0 12px}',
    '.table-wrap{overflow-x:auto;border:1px solid #d8dee4;border-radius:8px}',
    'table{width:100%;min-width:840px;border-collapse:collapse;font-size:14px}th,td{padding:10px 12px;border-bottom:1px solid #d8dee4;text-align:left;vertical-align:top}th{background:#f6f8fa;color:#57606a;font-weight:650}tr:last-child td{border-bottom:0}',
    '.status{font-weight:650}.success{color:#1a7f37}.failed{color:#cf222e}.skipped,.pending_approval{color:#9a6700}.approved{color:#1a7f37}.rejected{color:#cf222e}',
    'code{background:#f6f8fa;border:1px solid #d8dee4;border-radius:4px;padding:1px 4px}',
    'a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<header>',
    '<h1 class="title">PMO Agent Ops</h1>',
    `<p class="meta">Generated at ${escapeHtml(data.generatedAt)}</p>`,
    '<p class="meta"><a href="approval-center.html">Open approval center</a></p>',
    '</header>',
    renderSummary(data),
    renderAlerts(data.alerts),
    renderReadiness(data.readiness),
    renderLatestSmoke(data.latestSmoke),
    renderRecoveryActions(data.recoveryActions),
    renderRuns(data.runs),
    renderDrafts(data.drafts),
    renderAuditEvents(data.auditEvents),
    renderCheckIns(data.checkins),
    renderProjectUpdateActions(data.projectUpdateActions),
    renderWorkerEvents(data.workerEvents),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function buildApprovalCenterData(data: OpsDashboardData): ApprovalCenterData {
  const pendingCommunicationDrafts = data.drafts.filter(draft => draft.status === 'pending_approval')
  const pendingProjectUpdates = data.projectUpdateActions.filter(action => action.status === 'pending_approval')
  const commands = [
    ...pendingCommunicationDrafts.flatMap(draft => [
      {
        type: 'communication_draft' as const,
        id: draft.id,
        label: 'Show draft',
        command: `pnpm pmo:drafts -- show --reportsDir reports --draftId ${shellQuote(draft.id)} --actor 张鸿亮`,
      },
      {
        type: 'communication_draft' as const,
        id: draft.id,
        label: 'Approve draft',
        command: `pnpm pmo:drafts -- approve --reportsDir reports --draftId ${shellQuote(draft.id)} --actor 张鸿亮 --note '同意发送'`,
      },
      {
        type: 'communication_draft' as const,
        id: draft.id,
        label: 'Dry-run delivery',
        command: `pnpm pmo:drafts -- deliver --reportsDir reports --draftId ${shellQuote(draft.id)} --actor 张鸿亮 --dryRun`,
      },
    ]),
    ...pendingProjectUpdates.flatMap(action => [
      {
        type: 'project_update' as const,
        id: action.id,
        label: 'Show writeback',
        command: `pnpm pmo:project-updates -- show --reportsDir reports --actionId ${shellQuote(action.id)} --actor 张鸿亮`,
      },
      {
        type: 'project_update' as const,
        id: action.id,
        label: 'Approve writeback',
        command: `pnpm pmo:project-updates -- approve --reportsDir reports --actionId ${shellQuote(action.id)} --actor 张鸿亮 --note '同意写回'`,
      },
      {
        type: 'project_update' as const,
        id: action.id,
        label: 'Dry-run apply',
        command: `pnpm pmo:project-updates -- apply --reportsDir reports --actionId ${shellQuote(action.id)} --actor 张鸿亮 --dryRun`,
      },
    ]),
  ]
  return {
    generatedAt: data.generatedAt,
    summary: {
      pendingCommunicationDrafts: pendingCommunicationDrafts.length,
      pendingProjectUpdates: pendingProjectUpdates.length,
      totalPendingApprovals: pendingCommunicationDrafts.length + pendingProjectUpdates.length,
    },
    pendingCommunicationDrafts,
    pendingProjectUpdates,
    commands,
  }
}

function renderApprovalCenterHtml(data: ApprovalCenterData): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>PMO Approval Center</title>',
    '<style>',
    ':root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328;background:#f4f6f8;line-height:1.5}',
    'body{margin:0;padding:28px;background:#f4f6f8}main{max-width:1180px;margin:0 auto}',
    'header{margin-bottom:20px}.title{font-size:28px;margin:0 0 4px}.meta{color:#57606a;font-size:14px;margin:0}',
    '.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0 24px}',
    '.metric{background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:14px}.metric strong{display:block;font-size:24px}.metric span{color:#57606a;font-size:13px}',
    'section{background:#fff;border:1px solid #d8dee4;border-radius:8px;margin:16px 0;padding:18px}',
    'h2{font-size:18px;margin:0 0 12px}.table-wrap{overflow-x:auto;border:1px solid #d8dee4;border-radius:8px}',
    'table{width:100%;min-width:820px;border-collapse:collapse;font-size:14px}th,td{padding:10px 12px;border-bottom:1px solid #d8dee4;text-align:left;vertical-align:top}th{background:#f6f8fa;color:#57606a;font-weight:650}tr:last-child td{border-bottom:0}',
    'code{display:inline-block;max-width:760px;white-space:normal;overflow-wrap:anywhere;background:#f6f8fa;border:1px solid #d8dee4;border-radius:4px;padding:2px 4px}',
    'a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<header>',
    '<h1 class="title">PMO Approval Center</h1>',
    `<p class="meta">Generated at ${escapeHtml(data.generatedAt)} · <a href="ops-dashboard.html">Back to ops dashboard</a></p>`,
    '</header>',
    renderApprovalSummary(data),
    renderApprovalDrafts(data.pendingCommunicationDrafts),
    renderApprovalProjectUpdates(data.pendingProjectUpdates),
    renderApprovalCommands(data.commands),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function renderApprovalSummary(data: ApprovalCenterData): string {
  const items = [
    ['Total pending approvals', data.summary.totalPendingApprovals],
    ['Communication drafts', data.summary.pendingCommunicationDrafts],
    ['Project writebacks', data.summary.pendingProjectUpdates],
  ]
  return `<div class="summary">${items.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>`
}

function renderApprovalDrafts(drafts: CommunicationDraft[]): string {
  const rows = drafts.map(draft => [
    '<tr>',
    `<td><code>${escapeHtml(draft.id)}</code></td>`,
    `<td>${escapeHtml(draft.recipient)}</td>`,
    `<td>${escapeHtml(draft.priority)}</td>`,
    `<td>${draft.storyTitles.map(escapeHtml).join('<br>')}</td>`,
    `<td>${escapeHtml(draft.reason)}</td>`,
    `<td>${escapeHtml(draft.message)}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Communication Draft Approvals', ['Draft ID', 'Recipient', 'Priority', 'Stories', 'Reason', 'Message'], rows || emptyRow(6))
}

function renderApprovalProjectUpdates(actions: ProjectUpdateAction[]): string {
  const rows = actions.map(action => [
    '<tr>',
    `<td><code>${escapeHtml(action.id)}</code></td>`,
    `<td>${escapeHtml(action.storyId)}</td>`,
    `<td>${escapeHtml(action.responder)}</td>`,
    `<td>${escapeHtml(action.sourceCheckInId)}</td>`,
    `<td>${escapeHtml(JSON.stringify(action.proposedFields))}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Project Writeback Approvals', ['Action ID', 'Story ID', 'Responder', 'Source check-in', 'Proposed fields'], rows || emptyRow(5))
}

function renderApprovalCommands(commands: ApprovalCenterData['commands']): string {
  const rows = commands.map(command => [
    '<tr>',
    `<td>${escapeHtml(command.type)}</td>`,
    `<td><code>${escapeHtml(command.id)}</code></td>`,
    `<td>${escapeHtml(command.label)}</td>`,
    `<td><code>${escapeHtml(command.command)}</code></td>`,
    '</tr>',
  ].join('')).join('')
  return section('Approval Commands', ['Type', 'ID', 'Step', 'Command'], rows || emptyRow(4))
}

function renderSummary(data: OpsDashboardData): string {
  const items = [
    ['Runs', data.summary.runs],
    ['Failed runs', data.summary.failedRuns],
    ['Drafts', data.summary.drafts],
    ['Pending drafts', data.summary.pendingDrafts],
    ['Audit events', data.summary.auditEvents],
    ['Check-ins', data.summary.checkins],
    ['Recovery actions', data.summary.recoveryActions],
    ['Project updates', data.summary.projectUpdateActions],
    ['Worker events', data.summary.workerEvents],
    ['Active alerts', data.summary.alerts],
  ]
  return `<div class="summary">${items.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>`
}

function renderAlerts(alerts: OpsAlert[]): string {
  const rows = alerts.map(alert => [
    '<tr>',
    `<td>${escapeHtml(alert.createdAt)}</td>`,
    `<td class="status ${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</td>`,
    `<td>${escapeHtml(alert.source)}</td>`,
    `<td>${escapeHtml(alert.title)}</td>`,
    `<td>${escapeHtml(alert.detail)}</td>`,
    `<td>${escapeHtml(alert.action)}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Active Alerts', ['Time', 'Severity', 'Source', 'Title', 'Detail', 'Action'], rows || emptyRow(6))
}

function renderProjectUpdateActions(actions: ProjectUpdateAction[]): string {
  const rows = actions.map(action => [
    '<tr>',
    `<td>${escapeHtml(action.createdAt)}</td>`,
    `<td><code>${escapeHtml(action.id)}</code></td>`,
    `<td class="status ${escapeHtml(action.status)}">${escapeHtml(action.status)}</td>`,
    `<td>${escapeHtml(action.storyId)}</td>`,
    `<td>${escapeHtml(action.responder)}</td>`,
    `<td>${escapeHtml(JSON.stringify(action.proposedFields))}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Project Update Actions', ['Time', 'Action ID', 'Status', 'Story ID', 'Responder', 'Proposed fields'], rows || emptyRow(6))
}

function renderWorkerEvents(events: Array<{ at: string; type: string; detail: string }>): string {
  const rows = events.map(event => [
    '<tr>',
    `<td>${escapeHtml(event.at)}</td>`,
    `<td class="status ${escapeHtml(event.type)}">${escapeHtml(event.type)}</td>`,
    `<td>${escapeHtml(event.detail)}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Worker Events', ['Time', 'Type', 'Detail'], rows || emptyRow(3))
}

function renderReadiness(readiness: PreflightReport | undefined): string {
  if (!readiness) return section('Readiness', ['Status', 'Check', 'Detail', 'Next step'], emptyRow(4))
  const rows = readiness.checks.map(check => [
    '<tr>',
    `<td class="status ${escapeHtml(check.status)}">${escapeHtml(check.status)}</td>`,
    `<td>${escapeHtml(check.name)}</td>`,
    `<td>${escapeHtml(check.detail)}</td>`,
    `<td>${escapeHtml(check.nextStep ?? '')}</td>`,
    '</tr>',
  ].join('')).join('')
  return section(`Readiness (${readiness.status})`, ['Status', 'Check', 'Detail', 'Next step'], rows || emptyRow(4))
}

function renderLatestSmoke(smoke: LocalSmokeResult | undefined): string {
  if (!smoke) return section('Latest Smoke', ['Step', 'Status', 'Detail'], emptyRow(3))
  const rows = smoke.steps.map(step => [
    '<tr>',
    `<td>${escapeHtml(step.name)}</td>`,
    `<td class="status ${escapeHtml(step.status)}">${escapeHtml(step.status)}</td>`,
    `<td>${escapeHtml(step.detail ?? '')}</td>`,
    '</tr>',
  ].join('')).join('')
  return section(`Latest Smoke (${smoke.success ? 'success' : 'failed'})`, ['Step', 'Status', 'Detail'], rows || emptyRow(3))
}

function renderRecoveryActions(actions: RecoveryAction[]): string {
  const rows = actions.map(action => [
    '<tr>',
    `<td><code>${escapeHtml(action.runId)}</code></td>`,
    `<td>${escapeHtml(action.stage)}</td>`,
    `<td><code>${escapeHtml(action.endpoint)}</code></td>`,
    `<td>${escapeHtml(action.reason)}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Recovery Actions', ['Run ID', 'Stage', 'Endpoint', 'Reason'], rows || emptyRow(4))
}

function renderRuns(runs: PmoRunRecord[]): string {
  const rows = runs.map(run => {
    const artifacts = run.artifacts as { reportHtmlPath?: string } | undefined
    const report = artifacts?.reportHtmlPath ? linkToFile(artifacts.reportHtmlPath, 'report') : ''
    return [
      '<tr>',
      `<td><code>${escapeHtml(run.id)}</code></td>`,
      `<td>${escapeHtml(run.date)}</td>`,
      `<td class="status ${escapeHtml(run.status)}">${escapeHtml(run.status)}</td>`,
      `<td>${escapeHtml(run.startedAt)}<br>${escapeHtml(run.finishedAt)}</td>`,
      `<td>${renderStages(run.stages ?? [])}</td>`,
      `<td>${report}</td>`,
      '</tr>',
    ].join('')
  }).join('')
  return section('Runs', ['Run ID', 'Date', 'Status', 'Time', 'Stages', 'Artifacts'], rows || emptyRow(6))
}

function renderStages(stages: PmoRunStage[]): string {
  if (!stages.length) return ''
  return stages.map(stage => `<div><span class="status ${escapeHtml(stage.status)}">${escapeHtml(stage.status)}</span> ${escapeHtml(stage.name)}</div>`).join('')
}

function renderDrafts(drafts: CommunicationDraft[]): string {
  const rows = drafts.map(draft => [
    '<tr>',
    `<td><code>${escapeHtml(draft.id)}</code></td>`,
    `<td class="status ${escapeHtml(draft.status)}">${escapeHtml(draft.status)}</td>`,
    `<td>${escapeHtml(draft.recipient)}</td>`,
    `<td>${escapeHtml(draft.priority)}</td>`,
    `<td>${draft.storyTitles.map(escapeHtml).join('<br>')}</td>`,
    `<td>${escapeHtml(draft.reason)}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Communication Drafts', ['Draft ID', 'Status', 'Recipient', 'Priority', 'Stories', 'Reason'], rows || emptyRow(6))
}

function renderAuditEvents(events: CommunicationDraftAuditEvent[]): string {
  const rows = events.map(event => [
    '<tr>',
    `<td>${escapeHtml(event.at)}</td>`,
    `<td><code>${escapeHtml(event.draftId)}</code></td>`,
    `<td class="status ${escapeHtml(event.action)}">${escapeHtml(event.action)}</td>`,
    `<td>${escapeHtml(event.actor)}</td>`,
    `<td>${escapeHtml(event.note ?? '')}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Draft Audit Events', ['Time', 'Draft ID', 'Action', 'Actor', 'Note'], rows || emptyRow(5))
}

function renderCheckIns(records: CheckInRecord[]): string {
  const rows = records.map(record => [
    '<tr>',
    `<td>${escapeHtml(record.createdAt)}</td>`,
    `<td>${escapeHtml(record.storyId)}</td>`,
    `<td>${escapeHtml(record.responder)}</td>`,
    `<td class="status ${escapeHtml(record.parsed.status ?? 'unknown')}">${escapeHtml(record.parsed.status ?? 'unknown')}</td>`,
    `<td>${escapeHtml(record.parsed.blocker ?? '')}</td>`,
    `<td>${escapeHtml(record.parsed.nextStep ?? '')}</td>`,
    `<td>${escapeHtml(record.parsed.eta ?? '')}</td>`,
    '</tr>',
  ].join('')).join('')
  return section('Check-ins', ['Time', 'Story ID', 'Responder', 'Status', 'Blocker', 'Next step', 'ETA'], rows || emptyRow(7))
}

function runErrorMessage(run: PmoRunRecord): string {
  if (run.error && typeof run.error === 'object' && 'message' in run.error) return String((run.error as any).message)
  if (run.error) return JSON.stringify(run.error)
  const failedStage = run.stages?.find(stage => stage.status === 'failed')
  return failedStage ? stageErrorMessage(failedStage) : 'Run failed without a structured error.'
}

function stageErrorMessage(stage: PmoRunStage): string {
  if (stage.error && typeof stage.error === 'object' && 'message' in stage.error) return String((stage.error as any).message)
  if (stage.error) return JSON.stringify(stage.error)
  return 'Stage failed without a structured error.'
}

function section(title: string, headers: string[], rows: string): string {
  return [
    '<section>',
    `<h2>${escapeHtml(title)}</h2>`,
    '<div class="table-wrap"><table>',
    `<thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>`,
    `<tbody>${rows}</tbody>`,
    '</table></div>',
    '</section>',
  ].join('')
}

function emptyRow(columns: number): string {
  return `<tr><td colspan="${columns}">No records.</td></tr>`
}

function linkToFile(path: string, label: string): string {
  const file = path.split('/').pop() ?? path
  return `<a href="${escapeHtml(file)}">${escapeHtml(label)}</a>`
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

import { once } from 'node:events'
import { access } from 'node:fs/promises'
import type { Server } from 'node:http'
import { writeOpsDashboard } from '../output/ops-dashboard.js'
import { runPreflight, type PreflightReport } from '../preflight.js'
import { createPmoActionServer } from '../server/action-server.js'

export interface LocalSmokeInput {
  date: string
  reportsDir: string
  storiesFixture?: string
  maxProjects?: number
  runAt?: string
  now?: string
  skipPreflight?: boolean
  analyzeWithModels?: boolean
  createFeishuDoc?: boolean
  enrichContext?: boolean
  docsFixture?: string
  preflight?: () => Promise<PreflightReport>
}

export interface LocalSmokeResult {
  success: boolean
  baseUrl: string
  runId?: string
  steps: Array<{ name: string; status: 'success' | 'failed'; detail?: string }>
  summary?: {
    runStatus?: string
    drafts?: number
    actionsInvoked: number
  }
  artifacts?: Record<string, string>
  error?: unknown
}

export async function runLocalSmoke(input: LocalSmokeInput): Promise<LocalSmokeResult> {
  const steps: LocalSmokeResult['steps'] = []
  const server = createPmoActionServer()
  let baseUrl = ''
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
    baseUrl = `http://127.0.0.1:${address.port}`
    steps.push({ name: 'start_server', status: 'success', detail: baseUrl })

    const health = await getJson(`${baseUrl}/health`)
    if (!health.ok) throw new Error('Health check did not return ok')
    steps.push({ name: 'health', status: 'success' })

    const tick = await postJson(`${baseUrl}/scheduler/tick`, {
      now: input.now,
      runAt: input.runAt ?? '09:00',
      reportsDir: input.reportsDir,
      maxProjects: input.maxProjects,
      storiesFixture: input.storiesFixture,
      docsFixture: input.docsFixture,
      skipPreflight: input.skipPreflight === true,
      analyzeWithModels: input.analyzeWithModels === true,
      createFeishuDoc: input.createFeishuDoc === true,
      enrichContext: input.enrichContext === true,
    })
    if (!tick.success) throw new Error(`Scheduler tick failed: ${JSON.stringify(tick)}`)
    let run = tick.run
    if (tick.skipped && tick.decision?.reason === 'already_ran') {
      const runs = await getJson(`${baseUrl}/runs?reportsDir=${encodeURIComponent(input.reportsDir)}`)
      run = runs.runs?.find((record: any) => record.date === input.date && record.status === 'success')
      if (!run) throw new Error(`Scheduler skipped as already_ran but no successful run was found: ${JSON.stringify(tick)}`)
      steps.push({ name: 'scheduler_tick', status: 'success', detail: 'already_ran' })
    } else if (tick.skipped) {
      throw new Error(`Scheduler tick did not run: ${JSON.stringify(tick)}`)
    } else {
      steps.push({ name: 'scheduler_tick', status: 'success' })
    }

    const runId = run?.id
    if (!runId) throw new Error('Scheduler response did not include run id')

    const found = await getJson(`${baseUrl}/runs/${encodeURIComponent(runId)}?reportsDir=${encodeURIComponent(input.reportsDir)}`)
    if (!found.success || found.run?.id !== runId) throw new Error(`Run lookup failed: ${JSON.stringify(found)}`)
    steps.push({ name: 'get_run', status: 'success' })

    const drafts = await getJson(`${baseUrl}/drafts?reportsDir=${encodeURIComponent(input.reportsDir)}`)
    if (!Array.isArray(drafts.drafts)) throw new Error(`Draft list failed: ${JSON.stringify(drafts)}`)
    steps.push({ name: 'list_drafts', status: 'success' })

    const action = await postJson(`${baseUrl}/actions/invoke`, {
      action: 'pmo_build_state_snapshot',
      input: { factsPath: run.artifacts.reportJsonPath },
    })
    if (!action.success) throw new Error(`Action bridge invocation failed: ${JSON.stringify(action)}`)
    steps.push({ name: 'action_invoke', status: 'success' })

    const artifacts = run.artifacts as Record<string, string>
    await Promise.all([
      assertPath(artifacts.reportJsonPath),
      assertPath(artifacts.reportMarkdownPath),
      assertPath(artifacts.reportHtmlPath),
      assertPath(artifacts.opsDashboardHtmlPath),
      assertPath(artifacts.opsDashboardJsonPath),
    ])
    steps.push({ name: 'verify_artifacts', status: 'success' })

    const smokeResult = sanitizeResult({
      success: true,
      baseUrl,
      runId,
      steps,
      summary: {
        runStatus: run.status,
        drafts: drafts.drafts.length,
        actionsInvoked: 1,
      },
      artifacts,
    })
    const preflight = await (input.preflight ?? runPreflight)().catch(error => ({
      status: 'fail' as const,
      generatedAt: new Date().toISOString(),
      summary: { passed: 0, warnings: 0, failed: 1 },
      checks: [{ name: 'preflight', status: 'fail' as const, detail: error instanceof Error ? error.message : String(error) }],
    }))
    await writeOpsDashboard({
      reportsDir: input.reportsDir,
      preflight,
      latestSmoke: smokeResult,
    })
    return smokeResult
  } catch (error) {
    steps.push({ name: steps.length ? 'failed' : 'start_server', status: 'failed', detail: error instanceof Error ? error.message : String(error) })
    return sanitizeResult({
      success: false,
      baseUrl,
      steps,
      error: { message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    await closeServer(server)
  }
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url)
  return response.json()
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

async function assertPath(path: string | undefined): Promise<void> {
  if (!path) throw new Error('Missing artifact path')
  await access(path)
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

function sanitizeResult<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(/\b(token|password|api[_-]?key|secret)\b/gi, 'credential')) as T
}

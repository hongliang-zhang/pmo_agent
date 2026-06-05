import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeOpsDashboard } from '../output/ops-dashboard.js'
import { runPreflight } from '../preflight.js'
import { runDailyAgentCycle } from './runs.js'
import { evaluateDailySchedule } from './scheduler.js'

export interface WorkerOptions {
  reportsDir: string
  runAt: string
  tickIntervalMs: number
  createFeishuDoc: boolean
  createReportDeliveryDraft: boolean
  buildPersonDirectory: boolean
  analyzeWithModels: boolean
  enrichContext: boolean
  maxProjects?: number
  skipPreflight?: boolean
}

export interface WorkerTickResult {
  due: boolean
  date?: string
  runId?: string
  status?: 'success' | 'failed'
}

export async function runWorkerTick(options: WorkerOptions, now = new Date()): Promise<WorkerTickResult> {
  const runs = await readJsonArray<{ date: string; status: string }>(join(options.reportsDir, 'runs.json'))
  const decision = evaluateDailySchedule({ now, runAt: options.runAt, runs: runs as any })
  if (!decision.due) {
    await appendWorkerEvent(options.reportsDir, { at: now.toISOString(), type: 'tick_skipped', detail: decision.reason ?? 'not_due' })
    await writeOpsDashboard({ reportsDir: options.reportsDir })
    return { due: false, date: decision.date }
  }
  if (!options.skipPreflight) {
    const preflight = await runPreflight()
    await writeOpsDashboard({ reportsDir: options.reportsDir, preflight })
    if (preflight.status === 'fail') {
      await appendWorkerEvent(options.reportsDir, { at: now.toISOString(), type: 'preflight_blocked', detail: 'preflight failed' })
      return { due: true, date: decision.date, status: 'failed' }
    }
  }
  const run = await runDailyAgentCycle({
    date: decision.date,
    reportsDir: options.reportsDir,
    maxProjects: options.maxProjects,
    createCommunicationDrafts: true,
    buildPersonDirectory: options.buildPersonDirectory,
    createFeishuDoc: options.createFeishuDoc,
    createReportDeliveryDraft: options.createReportDeliveryDraft,
    analyzeWithModels: options.analyzeWithModels,
    enrichContext: options.enrichContext,
  })
  await appendWorkerEvent(options.reportsDir, { at: now.toISOString(), type: 'run_finished', detail: `${run.id}:${run.status}` })
  await writeOpsDashboard({ reportsDir: options.reportsDir })
  return { due: true, date: decision.date, runId: run.id, status: run.status }
}

export async function startWorker(options: WorkerOptions): Promise<void> {
  await mkdir(options.reportsDir, { recursive: true })
  await appendWorkerEvent(options.reportsDir, { at: new Date().toISOString(), type: 'worker_started', detail: `runAt=${options.runAt};intervalMs=${options.tickIntervalMs}` })
  await runWorkerTick(options)
  setInterval(() => {
    runWorkerTick(options).catch(error => {
      appendWorkerEvent(options.reportsDir, {
        at: new Date().toISOString(),
        type: 'worker_error',
        detail: error instanceof Error ? error.message : String(error),
      }).catch(() => {})
    })
  }, options.tickIntervalMs)
}

async function appendWorkerEvent(reportsDir: string, event: { at: string; type: string; detail: string }): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  const events = await readJsonArray(join(reportsDir, 'worker-events.json'))
  await writeFile(join(reportsDir, 'worker-events.json'), `${JSON.stringify([event, ...events].slice(0, 500), null, 2)}\n`, 'utf8')
}

async function readJsonArray<T = any>(path: string): Promise<T[]> {
  try {
    const records = JSON.parse(await readFile(path, 'utf8')) as T[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

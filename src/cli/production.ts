import { loadEnvFiles } from '../config.js'
import { createPmoActionServer } from '../server/action-server.js'
import { startWorker } from '../server/worker.js'

await loadEnvFiles()

const port = Number(process.env.PORT ?? process.env.PMO_ACTION_PORT ?? 3201)
const reportsDir = process.env.PMO_REPORTS_DIR ?? 'reports'

const server = createPmoActionServer()
server.listen(port, () => {
  process.stdout.write(`PMO production service listening on ${port}\n`)
})

await startWorker({
  reportsDir,
  runAt: process.env.PMO_DAILY_RUN_AT ?? '09:00',
  tickIntervalMs: Number(process.env.PMO_WORKER_TICK_MS ?? 5 * 60 * 1000),
  createFeishuDoc: process.env.PMO_WORKER_CREATE_FEISHU_DOC === 'true',
  createReportDeliveryDraft: process.env.PMO_WORKER_CREATE_REPORT_DM_DRAFT === 'true',
  buildPersonDirectory: process.env.PMO_WORKER_BUILD_PERSON_DIRECTORY !== 'false',
  analyzeWithModels: process.env.PMO_WORKER_ANALYZE_WITH_MODELS === 'true',
  enrichContext: process.env.PMO_WORKER_ENRICH_CONTEXT !== 'false',
  maxProjects: process.env.PMO_WORKER_MAX_PROJECTS ? Number(process.env.PMO_WORKER_MAX_PROJECTS) : undefined,
  skipPreflight: process.env.PMO_WORKER_SKIP_PREFLIGHT === 'true',
})

process.stdout.write(`PMO worker active; reportsDir=${reportsDir}\n`)

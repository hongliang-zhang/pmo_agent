import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runPmoBridgeAction } from '../actions/bridge.js'
import { createFeishuDocOutput, type FeishuDocOutput } from '../feishu/docs-output.js'
import { FeishuOpenApiClient } from '../feishu/openapi.js'
import { FeishuProjectMcpClient } from '../feishu/project-mcp.js'
import { createZaiModelAnalyzer, defaultModelConfigFromEnv, type ModelAnalyzer, writeModelAnalysisArtifact } from '../models/analysis.js'
import { writeOpsDashboard } from '../output/ops-dashboard.js'
import { buildPersonDirectory } from '../people/directory.js'
import { loadConfig } from '../config.js'
import { createCommunicationDraftsFromReport, createReportDeliveryDraft, type PersonIdentity } from './drafts.js'

export interface PmoRunRecord {
  id: string
  date: string
  status: 'success' | 'failed'
  startedAt: string
  finishedAt: string
  summary?: unknown
  artifacts?: unknown
  stages?: PmoRunStage[]
  error?: unknown
}

export interface PmoRunStage {
  name: 'render_report' | 'enrich_context' | 'analyze_with_models' | 'build_person_directory' | 'create_communication_drafts' | 'create_report_delivery_draft' | 'create_feishu_doc'
  status: 'success' | 'failed' | 'skipped'
  startedAt: string
  finishedAt: string
  summary?: unknown
  artifacts?: unknown
  error?: unknown
}

export async function runDailyAudit(input: {
  date: string
  reportsDir: string
  maxProjects?: number
  storiesFixture?: string
}): Promise<PmoRunRecord> {
  const startedAt = new Date().toISOString()
  const result = await runPmoBridgeAction('pmo_render_local_report', {
    date: input.date,
    maxProjects: input.maxProjects,
    storiesFixture: input.storiesFixture,
    reportsDir: input.reportsDir,
  }) as any
  const finishedAt = new Date().toISOString()
  const record: PmoRunRecord = result.success
    ? {
      id: `${input.date}-${startedAt}`,
      date: input.date,
      status: 'success',
      startedAt,
      finishedAt,
      summary: result.result?.report?.summary,
      artifacts: result.result?.artifacts,
    }
    : {
      id: `${input.date}-${startedAt}`,
      date: input.date,
      status: 'failed',
      startedAt,
      finishedAt,
      error: result.error,
    }
  await appendRunRecord(input.reportsDir, record)
  return record
}

export async function runDailyAgentCycle(input: {
  date: string
  reportsDir: string
  maxProjects?: number
  storiesFixture?: string
  createCommunicationDrafts?: boolean
  buildPersonDirectory?: boolean
  personDirectoryBuilder?: (stories: any[]) => Promise<Record<string, PersonIdentity>>
  createFeishuDoc?: boolean
  feishuDocOutput?: FeishuDocOutput
  createReportDeliveryDraft?: boolean
  reportRecipient?: { name: string; identity: PersonIdentity; channel?: 'feishu_im' | 'feishu_group' }
  analyzeWithModels?: boolean
  modelAnalyzer?: ModelAnalyzer
  enrichContext?: boolean
  docsFixture?: string
}): Promise<PmoRunRecord> {
  const startedAt = new Date().toISOString()
  const stages: PmoRunStage[] = []
  const id = `${input.date}-${startedAt}`

  const renderStageStartedAt = new Date().toISOString()
  const result = await runPmoBridgeAction('pmo_render_local_report', {
    date: input.date,
    maxProjects: input.maxProjects,
    storiesFixture: input.storiesFixture,
    reportsDir: input.reportsDir,
    enrichContext: input.enrichContext === true,
    docsFixture: input.docsFixture,
  }) as any
  const renderStageFinishedAt = new Date().toISOString()

  if (!result.success) {
    stages.push({
      name: 'render_report',
      status: 'failed',
      startedAt: renderStageStartedAt,
      finishedAt: renderStageFinishedAt,
      error: result.error,
    })
    const failedRecord: PmoRunRecord = {
      id,
      date: input.date,
      status: 'failed',
      startedAt,
      finishedAt: renderStageFinishedAt,
      stages,
      error: result.error,
    }
    await appendRunRecord(input.reportsDir, failedRecord)
    return failedRecord
  }

  const artifacts = result.result?.artifacts ?? {}
  stages.push({
    name: 'render_report',
    status: 'success',
    startedAt: renderStageStartedAt,
    finishedAt: renderStageFinishedAt,
    summary: result.result?.report?.summary,
    artifacts: {
      reportJsonPath: artifacts.jsonPath,
      reportMarkdownPath: artifacts.markdownPath,
      reportHtmlPath: artifacts.htmlPath,
    },
  })

  if (input.enrichContext) {
    const contextCount = result.result?.report?.storyAudits
      ?.filter((audit: any) => audit.context?.evidence?.length || audit.context?.candidates?.length)
      .length ?? 0
    stages.push({
      name: 'enrich_context',
      status: 'success',
      startedAt: renderStageStartedAt,
      finishedAt: renderStageFinishedAt,
      summary: {
        storiesWithContext: contextCount,
      },
    })
  }

  let modelAnalysisArtifacts: { modelAnalysisPath?: string } = {}
  if (input.analyzeWithModels) {
    const modelStageStartedAt = new Date().toISOString()
    try {
      const config = defaultModelConfigFromEnv()
      const artifact = await writeModelAnalysisArtifact({
        reportPath: artifacts.jsonPath,
        reportsDir: input.reportsDir,
        analyzer: input.modelAnalyzer ?? createZaiModelAnalyzer(config),
        config,
      })
      modelAnalysisArtifacts = { modelAnalysisPath: artifact.analysisPath }
      stages.push({
        name: 'analyze_with_models',
        status: 'success',
        startedAt: modelStageStartedAt,
        finishedAt: new Date().toISOString(),
        summary: {
          dailyModel: config.models.daily.model,
          riskModel: config.models.risk.model,
        },
        artifacts: modelAnalysisArtifacts,
      })
    } catch (error) {
      stages.push({
        name: 'analyze_with_models',
        status: 'failed',
        startedAt: modelStageStartedAt,
        finishedAt: new Date().toISOString(),
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  let personDirectory: Record<string, PersonIdentity> | undefined
  if (input.buildPersonDirectory !== false) {
    const personStageStartedAt = new Date().toISOString()
    if (!input.personDirectoryBuilder && !hasFeishuOpenApiCredential()) {
      stages.push({
        name: 'build_person_directory',
        status: 'skipped',
        startedAt: personStageStartedAt,
        finishedAt: new Date().toISOString(),
        summary: { reason: 'feishu_openapi_not_configured' },
      })
    } else {
      try {
        const report = result.result?.report
        const stories = (report?.storyAudits ?? []).map((audit: any) => audit.story).filter(Boolean)
        if (input.personDirectoryBuilder) {
          personDirectory = await input.personDirectoryBuilder(stories)
        } else {
          const config = await loadConfig()
          personDirectory = await buildPersonDirectory({
            stories,
            projectKey: config.feishuProject.projectKey ?? config.feishuProject.spaceUrl.split('/')[3],
            projectClient: new FeishuProjectMcpClient({ mcpUrl: config.feishuProject.mcpUrl, headers: config.feishuProject.headers }),
            openApiClient: new FeishuOpenApiClient(),
          })
        }
        stages.push({
          name: 'build_person_directory',
          status: 'success',
          startedAt: personStageStartedAt,
          finishedAt: new Date().toISOString(),
          summary: {
            people: Object.keys(personDirectory).length,
            mappedForDelivery: Object.values(personDirectory).filter(identity => identity.openId || identity.userId || identity.email || identity.chatId).length,
          },
        })
      } catch (error) {
        stages.push({
          name: 'build_person_directory',
          status: 'skipped',
          startedAt: personStageStartedAt,
          finishedAt: new Date().toISOString(),
          summary: { reason: 'person_directory_build_failed', message: error instanceof Error ? error.message : String(error) },
        })
      }
    }
  }

  let draftsCreated = 0
  if (input.createCommunicationDrafts !== false) {
    const draftStageStartedAt = new Date().toISOString()
    try {
      const drafts = await createCommunicationDraftsFromReport({ reportsDir: input.reportsDir, reportPath: artifacts.jsonPath, personDirectory })
      draftsCreated = drafts.length
      stages.push({
        name: 'create_communication_drafts',
        status: 'success',
        startedAt: draftStageStartedAt,
        finishedAt: new Date().toISOString(),
        summary: { draftsCreated },
        artifacts: {
          communicationDraftsPath: join(input.reportsDir, 'communication-drafts.json'),
        },
      })
    } catch (error) {
      stages.push({
        name: 'create_communication_drafts',
        status: 'failed',
        startedAt: draftStageStartedAt,
        finishedAt: new Date().toISOString(),
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  } else {
    const now = new Date().toISOString()
    stages.push({
      name: 'create_communication_drafts',
      status: 'skipped',
      startedAt: now,
      finishedAt: now,
      summary: { reason: 'disabled' },
    })
  }

  let feishuDocArtifacts: { feishuDocUrl?: string; feishuDocumentId?: string } = {}
  if (input.createFeishuDoc) {
    const docStageStartedAt = new Date().toISOString()
    try {
      const markdown = await readFile(artifacts.markdownPath, 'utf8')
      const doc = await (input.feishuDocOutput ?? createFeishuDocOutput({
        command: process.env.LARK_MCP_COMMAND,
        args: parseOptionalArgs(process.env.LARK_MCP_ARGS),
      })).createDocument(markdown)
      feishuDocArtifacts = {
        feishuDocUrl: doc.url,
        feishuDocumentId: doc.documentId,
      }
      stages.push({
        name: 'create_feishu_doc',
        status: 'success',
        startedAt: docStageStartedAt,
        finishedAt: new Date().toISOString(),
        summary: { created: true },
        artifacts: feishuDocArtifacts,
      })
    } catch (error) {
      stages.push({
        name: 'create_feishu_doc',
        status: 'failed',
        startedAt: docStageStartedAt,
        finishedAt: new Date().toISOString(),
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  let reportDeliveryDraftsCreated = 0
  if (input.createReportDeliveryDraft) {
    const deliveryDraftStartedAt = new Date().toISOString()
    try {
      const recipient = input.reportRecipient ?? reportRecipientFromEnv()
      if (!recipient) throw new Error('PMO daily report recipient is not configured. Set PMO_DAILY_REPORT_RECIPIENT_NAME and one of PMO_DAILY_REPORT_RECIPIENT_USER_ID, PMO_DAILY_REPORT_RECIPIENT_OPEN_ID, PMO_DAILY_REPORT_RECIPIENT_CHAT_ID, or PMO_DAILY_REPORT_RECIPIENT_EMAIL.')
      await createReportDeliveryDraft({
        reportsDir: input.reportsDir,
        reportPath: artifacts.jsonPath,
        recipient: recipient.name,
        recipientIdentity: recipient.identity,
        channel: recipient.channel,
        reportHtmlPath: artifacts.htmlPath,
        feishuDocUrl: feishuDocArtifacts.feishuDocUrl,
        now: new Date(),
      })
      reportDeliveryDraftsCreated = 1
      stages.push({
        name: 'create_report_delivery_draft',
        status: 'success',
        startedAt: deliveryDraftStartedAt,
        finishedAt: new Date().toISOString(),
        summary: { draftsCreated: 1, recipient: recipient.name },
        artifacts: { communicationDraftsPath: join(input.reportsDir, 'communication-drafts.json') },
      })
    } catch (error) {
      stages.push({
        name: 'create_report_delivery_draft',
        status: 'failed',
        startedAt: deliveryDraftStartedAt,
        finishedAt: new Date().toISOString(),
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  const finishedAt = new Date().toISOString()
  const failedStage = stages.find(stage => stage.status === 'failed')
  const recordBase: PmoRunRecord = {
    id,
    date: input.date,
    status: failedStage ? 'failed' : 'success',
    startedAt,
    finishedAt,
    summary: {
      ...(result.result?.report?.summary ?? {}),
      draftsCreated,
      reportDeliveryDraftsCreated,
    },
    artifacts: {
      reportJsonPath: artifacts.jsonPath,
      reportMarkdownPath: artifacts.markdownPath,
      reportHtmlPath: artifacts.htmlPath,
      ...modelAnalysisArtifacts,
      communicationDraftsPath: input.createCommunicationDrafts === false ? undefined : join(input.reportsDir, 'communication-drafts.json'),
      ...feishuDocArtifacts,
    },
    stages,
    error: failedStage?.error,
  }
  const record = await refreshOpsDashboardForRecord(input.reportsDir, recordBase)
  return record
}

function hasFeishuOpenApiCredential(): boolean {
  return Boolean(process.env.FEISHU_TENANT_ACCESS_TOKEN || (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) || (process.env.LARK_APP_ID && process.env.LARK_APP_SECRET))
}

function reportRecipientFromEnv(): { name: string; identity: PersonIdentity; channel?: 'feishu_im' | 'feishu_group' } | undefined {
  const name = process.env.PMO_DAILY_REPORT_RECIPIENT_NAME
  if (!name) return undefined
  const identity: PersonIdentity = {
    openId: process.env.PMO_DAILY_REPORT_RECIPIENT_OPEN_ID,
    userId: process.env.PMO_DAILY_REPORT_RECIPIENT_USER_ID,
    chatId: process.env.PMO_DAILY_REPORT_RECIPIENT_CHAT_ID,
    email: process.env.PMO_DAILY_REPORT_RECIPIENT_EMAIL,
  }
  if (!identity.openId && !identity.userId && !identity.chatId && !identity.email) return undefined
  return {
    name,
    identity,
    channel: identity.chatId ? 'feishu_group' : 'feishu_im',
  }
}

export async function listRunRecords(reportsDir: string): Promise<PmoRunRecord[]> {
  try {
    const records = JSON.parse(await readFile(runsPath(reportsDir), 'utf8')) as PmoRunRecord[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

export async function getRunRecord(reportsDir: string, runId: string): Promise<PmoRunRecord | undefined> {
  const records = await listRunRecords(reportsDir)
  return records.find(record => record.id === runId)
}

export async function retryRunStage(input: {
  reportsDir: string
  runId: string
  stage: 'create_communication_drafts'
}): Promise<PmoRunRecord> {
  const records = await listRunRecords(input.reportsDir)
  const index = records.findIndex(record => record.id === input.runId)
  if (index < 0) throw new Error(`Run not found: ${input.runId}`)

  const run = records[index]!
  if (input.stage !== 'create_communication_drafts') throw new Error(`Unsupported retry stage: ${input.stage}`)
  const artifacts = run.artifacts as { reportJsonPath?: string } | undefined
  if (!artifacts?.reportJsonPath) {
    throw new Error(`Run ${input.runId} does not have reportJsonPath for communication draft retry`)
  }

  const startedAt = new Date().toISOString()
  const stages = [...(run.stages ?? [])]
  let draftsCreated = 0
  let stage: PmoRunStage
  try {
    const drafts = await createCommunicationDraftsFromReport({ reportsDir: input.reportsDir, reportPath: artifacts.reportJsonPath })
    draftsCreated = drafts.length
    stage = {
      name: 'create_communication_drafts',
      status: 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: { draftsCreated },
      artifacts: { communicationDraftsPath: join(input.reportsDir, 'communication-drafts.json') },
    }
  } catch (error) {
    stage = {
      name: 'create_communication_drafts',
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: { message: error instanceof Error ? error.message : String(error) },
    }
  }

  const existingStageIndex = stages.findIndex(item => item.name === input.stage)
  if (existingStageIndex >= 0) stages[existingStageIndex] = stage
  else stages.push(stage)

  const failedStage = stages.find(item => item.status === 'failed')
  const updatedBase: PmoRunRecord = {
    ...run,
    status: failedStage ? 'failed' : 'success',
    finishedAt: new Date().toISOString(),
    stages,
    summary: {
      ...((run.summary && typeof run.summary === 'object') ? run.summary : {}),
      draftsCreated,
    },
    artifacts: {
      ...((run.artifacts && typeof run.artifacts === 'object') ? run.artifacts : {}),
      communicationDraftsPath: join(input.reportsDir, 'communication-drafts.json'),
    },
    error: failedStage?.error,
  }
  const updated = await refreshOpsDashboardForRecord(input.reportsDir, updatedBase, records, index)
  records[index] = updated
  await writeRunRecords(input.reportsDir, records)
  return updated
}

async function refreshOpsDashboardForRecord(
  reportsDir: string,
  record: PmoRunRecord,
  existingRecords?: PmoRunRecord[],
  recordIndex?: number,
): Promise<PmoRunRecord> {
  if (existingRecords && recordIndex !== undefined) {
    existingRecords[recordIndex] = record
    await writeRunRecords(reportsDir, existingRecords)
  } else {
    await appendRunRecord(reportsDir, record)
  }
  const dashboard = await writeOpsDashboard({ reportsDir })
  const artifacts = {
    ...((record.artifacts && typeof record.artifacts === 'object') ? record.artifacts : {}),
    opsDashboardHtmlPath: dashboard.htmlPath,
    opsDashboardJsonPath: dashboard.jsonPath,
    opsAlertsPath: dashboard.alertsPath,
  }
  const updated = { ...record, artifacts }
  if (existingRecords && recordIndex !== undefined) {
    existingRecords[recordIndex] = updated
  } else {
    const records = await listRunRecords(reportsDir)
    const index = records.findIndex(item => item.id === record.id)
    if (index >= 0) {
      records[index] = updated
      await writeRunRecords(reportsDir, records)
    }
  }
  return updated
}

async function appendRunRecord(reportsDir: string, record: PmoRunRecord): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  const records = await listRunRecords(reportsDir)
  records.unshift(record)
  await writeRunRecords(reportsDir, records)
}

async function writeRunRecords(reportsDir: string, records: PmoRunRecord[]): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  await writeFile(runsPath(reportsDir), `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

function runsPath(reportsDir: string): string {
  return join(reportsDir, 'runs.json')
}

function parseOptionalArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as string[]
  return [...trimmed.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3]!)
}

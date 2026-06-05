import { readFile } from 'node:fs/promises'
import { buildAuditReport } from '../audit.js'
import { dateWindowForChinaDay, loadConfig, loadEnvFiles } from '../config.js'
import type { AuditReport, Story } from '../domain.js'
import { FeishuProjectMcpClient } from '../feishu/project-mcp.js'
import { collectGitLabEvidence } from '../gitlab/collector.js'
import { GitLabClient } from '../gitlab/client.js'
import { enrichGitLabEvidenceAuthors } from '../identity/gitlab-feishu.js'
import { writeLocalReportArtifacts } from '../output/local.js'
import { renderAuditMarkdown } from '../render/markdown.js'
import { buildProjectStateSnapshot } from '../state.js'
import { maybeEnrichStoryContexts } from '../context/load.js'
import { applyCheckInsToReport, listCheckInRecords } from '../server/checkins.js'
import { runDailyAgentCycle } from '../server/runs.js'

export type PmoBridgeActionName = 'pmo_collect_facts' | 'pmo_enrich_context' | 'pmo_build_state_snapshot' | 'pmo_render_local_report' | 'pmo_run_agent_cycle'

export interface PmoBridgeEnvelope {
  success: boolean
  action: PmoBridgeActionName
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

export async function runPmoBridgeAction(action: PmoBridgeActionName, input: unknown): Promise<PmoBridgeEnvelope> {
  try {
    if (action === 'pmo_build_state_snapshot') {
      const { factsPath } = input as { factsPath?: string }
      if (!factsPath) return inputError(action, 'factsPath is required')
      const report = JSON.parse(await readFile(factsPath, 'utf8')) as AuditReport
      return {
        success: true,
        action,
        result: report.stateSnapshot ?? buildProjectStateSnapshot({ report, window: dateWindowForChinaDay(report.date) }),
      }
    }

    if (action === 'pmo_run_agent_cycle') {
      const body = input as any
      if (!body.date) return inputError(action, 'date is required')
      const run = await runDailyAgentCycle({
        date: body.date,
        reportsDir: body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports',
        maxProjects: body.maxProjects,
        storiesFixture: body.storiesFixture,
        docsFixture: body.docsFixture,
        enrichContext: body.enrichContext === true,
        createCommunicationDrafts: body.createCommunicationDrafts === true,
        buildPersonDirectory: body.buildPersonDirectory,
        analyzeWithModels: body.analyzeWithModels === true,
        createFeishuDoc: body.createFeishuDoc === true,
        createReportDeliveryDraft: body.createReportDeliveryDraft === true,
        reportRecipient: body.reportRecipient,
      })
      return { success: true, action, result: run }
    }

    if (action === 'pmo_collect_facts' || action === 'pmo_enrich_context' || action === 'pmo_render_local_report') {
      const { date, maxProjects, storiesFixture, reportsDir, enrichContext, docsFixture } = input as {
        date?: string
        maxProjects?: number
        storiesFixture?: string
        reportsDir?: string
        enrichContext?: boolean
        docsFixture?: string
      }
      if (!date) return inputError(action, 'date is required')
      const { report, artifacts, storyContexts } = await runAudit({
        date,
        maxProjects,
        storiesFixture,
        reportsDir,
        writeReport: action === 'pmo_render_local_report',
        enrichContext: action === 'pmo_enrich_context' || enrichContext === true,
        docsFixture,
      })
      return {
        success: true,
        action,
        result: action === 'pmo_enrich_context'
          ? { storyContexts }
          : action === 'pmo_collect_facts'
          ? { report }
          : { report, artifacts },
      }
    }

    return inputError(action, `Unsupported action ${action}`)
  } catch (error) {
    return {
      success: false,
      action,
      error: {
        code: 'pmo_action_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

async function runAudit(input: {
  date: string
  maxProjects?: number
  storiesFixture?: string
  reportsDir?: string
  enrichContext?: boolean
  docsFixture?: string
  writeReport: boolean
}): Promise<{ report: AuditReport; artifacts?: unknown; storyContexts?: unknown }> {
  await loadEnvFiles()
  const config = await loadConfig()
  const window = dateWindowForChinaDay(input.date)
  const projectClient = new FeishuProjectMcpClient({ mcpUrl: config.feishuProject.mcpUrl, headers: config.feishuProject.headers })
  const stories = input.storiesFixture
    ? await readStoriesFixture(input.storiesFixture)
    : await projectClient.listStories(config.feishuProject.spaceName, config.feishuProject.projectKey, config.feishuProject.activeStatuses)
  const rawEvidence = await collectGitLabEvidence({
    client: new GitLabClient(config.gitlab),
    group: config.gitlab.group,
    window,
    maxProjects: input.maxProjects,
  })
  const evidence = await enrichGitLabEvidenceAuthors({
    evidence: rawEvidence,
    projectClient: input.storiesFixture ? undefined : projectClient,
    projectKey: config.feishuProject.projectKey,
  })
  const storyContexts = await maybeEnrichStoryContexts({
    stories,
    enabled: input.enrichContext,
    docsFixture: input.docsFixture,
  })
  let report = buildAuditReport({ date: input.date, stories, evidence, storyContexts, now: new Date() })
  const checkIns = await listCheckInRecords(input.reportsDir ?? config.audit.reportsDir)
  report = await applyCheckInsToReport({ report, checkIns, now: new Date() })
  report.stateSnapshot = buildProjectStateSnapshot({ report, window })

  if (!input.writeReport) return { report, storyContexts }

  const markdown = renderAuditMarkdown(report)
  const artifacts = await writeLocalReportArtifacts({ reportsDir: input.reportsDir ?? config.audit.reportsDir, date: input.date, markdown, report })
  return { report, artifacts, storyContexts }
}

async function readStoriesFixture(path: string): Promise<Story[]> {
  return JSON.parse(await readFile(path, 'utf8')) as Story[]
}

function inputError(action: PmoBridgeActionName, message: string): PmoBridgeEnvelope {
  return {
    success: false,
    action,
    error: { code: 'invalid_input', message },
  }
}

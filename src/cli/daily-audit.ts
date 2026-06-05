import { readFile } from 'node:fs/promises'
import { buildAuditReport } from '../audit.js'
import { parseArgs } from './args.js'
import { dateWindowForChinaDay, loadConfig, loadEnvFiles } from '../config.js'
import type { Story } from '../domain.js'
import { createFeishuDocOutput } from '../feishu/docs-output.js'
import { FeishuProjectMcpClient } from '../feishu/project-mcp.js'
import { collectGitLabEvidence } from '../gitlab/collector.js'
import { GitLabClient } from '../gitlab/client.js'
import { enrichGitLabEvidenceAuthors } from '../identity/gitlab-feishu.js'
import { renderAuditMarkdown } from '../render/markdown.js'
import { writeLocalReportArtifacts } from '../output/local.js'
import { buildProjectStateSnapshot } from '../state.js'
import { maybeEnrichStoryContexts } from '../context/load.js'

async function main() {
  await loadEnvFiles()
  const args = parseArgs(process.argv.slice(2))
  const config = await loadConfig()
  const window = dateWindowForChinaDay(args.date)
  const projectClient = new FeishuProjectMcpClient({ mcpUrl: config.feishuProject.mcpUrl, headers: config.feishuProject.headers })
  const stories = args.storiesFixture
    ? await readStoriesFixture(args.storiesFixture)
    : await projectClient
      .listStories(config.feishuProject.spaceName, config.feishuProject.projectKey, config.feishuProject.activeStatuses)

  const gitlab = new GitLabClient(config.gitlab)
  const rawEvidence = await collectGitLabEvidence({
    client: gitlab,
    group: config.gitlab.group,
    window,
    maxProjects: args.maxProjects,
  })
  const evidence = await enrichGitLabEvidenceAuthors({
    evidence: rawEvidence,
    projectClient: args.storiesFixture ? undefined : projectClient,
    projectKey: config.feishuProject.projectKey,
  })
  const storyContexts = await maybeEnrichStoryContexts({
    stories,
    enabled: args.enrichContext,
    docsFixture: args.docsFixture,
  })

  const report = buildAuditReport({ date: args.date, stories, evidence, storyContexts, now: new Date() })
  report.stateSnapshot = buildProjectStateSnapshot({ report, window })
  const markdown = renderAuditMarkdown(report)
  const artifacts = await writeLocalReportArtifacts({ reportsDir: config.audit.reportsDir, date: args.date, markdown, report })

  if (args.dryRun || args.output === 'markdown') {
    process.stdout.write(`${markdown}\n\nLocal report: ${artifacts.markdownPath}\nLocal JSON: ${artifacts.jsonPath}\nLocal HTML: ${artifacts.htmlPath}\nLatest report: ${artifacts.latestMarkdownPath}\nLatest HTML: ${artifacts.latestHtmlPath}\nIndex: ${artifacts.indexPath}\nIndex JSON: ${artifacts.indexJsonPath}\nManifest: ${artifacts.manifestPath}\n`)
    return
  }

  try {
    const doc = await createFeishuDocOutput({
      command: process.env.LARK_MCP_COMMAND,
      args: parseOptionalArgs(process.env.LARK_MCP_ARGS),
    }).createDocument(markdown)
    process.stdout.write(`Local report: ${artifacts.markdownPath}\nLocal JSON: ${artifacts.jsonPath}\nLocal HTML: ${artifacts.htmlPath}\nLatest report: ${artifacts.latestMarkdownPath}\nLatest HTML: ${artifacts.latestHtmlPath}\nIndex: ${artifacts.indexPath}\nIndex JSON: ${artifacts.indexJsonPath}\nManifest: ${artifacts.manifestPath}\nFeishu document: ${doc.url ?? doc.documentId ?? JSON.stringify(doc.raw)}\n`)
  } catch (error) {
    process.stderr.write(`Local report was generated before Feishu document creation failed: ${artifacts.markdownPath}\nLocal JSON: ${artifacts.jsonPath}\nLocal HTML: ${artifacts.htmlPath}\nLatest report: ${artifacts.latestMarkdownPath}\nLatest HTML: ${artifacts.latestHtmlPath}\nIndex: ${artifacts.indexPath}\nIndex JSON: ${artifacts.indexJsonPath}\nManifest: ${artifacts.manifestPath}\n`)
    throw error
  }
}

async function readStoriesFixture(path: string): Promise<Story[]> {
  return JSON.parse(await readFile(path, 'utf8')) as Story[]
}

function parseOptionalArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as string[]
  return splitShellLike(trimmed)
}

function splitShellLike(value: string): string[] {
  const matches = [...value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
  return matches.map(match => match[1] ?? match[2] ?? match[3]!)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

import { readFile } from 'node:fs/promises'
import { buildAuditReport } from '../audit.js'
import { parseArgs } from './args.js'
import { dateWindowForChinaDay, loadConfig, loadEnvFiles } from '../config.js'
import type { Story } from '../domain.js'
import { createFeishuDocOutput } from '../feishu/docs-output.js'
import { FeishuProjectMcpClient } from '../feishu/project-mcp.js'
import { collectGitLabEvidence } from '../gitlab/collector.js'
import { GitLabClient } from '../gitlab/client.js'
import { renderAuditMarkdown } from '../render/markdown.js'
import { writeLocalReport } from '../output/local.js'

async function main() {
  await loadEnvFiles()
  const args = parseArgs(process.argv.slice(2))
  const config = await loadConfig()
  const window = dateWindowForChinaDay(args.date)
  const stories = args.storiesFixture
    ? await readStoriesFixture(args.storiesFixture)
    : await new FeishuProjectMcpClient({ mcpUrl: config.feishuProject.mcpUrl, headers: config.feishuProject.headers })
      .listStories(config.feishuProject.spaceName, config.feishuProject.projectKey, config.feishuProject.activeStatuses)

  const gitlab = new GitLabClient(config.gitlab)
  const evidence = await collectGitLabEvidence({
    client: gitlab,
    group: config.gitlab.group,
    window,
    maxProjects: args.maxProjects,
  })

  const report = buildAuditReport({ date: args.date, stories, evidence, now: new Date() })
  const markdown = renderAuditMarkdown(report)
  const localPath = await writeLocalReport({ reportsDir: config.audit.reportsDir, date: args.date, markdown })

  if (args.dryRun || args.output === 'markdown') {
    process.stdout.write(`${markdown}\n\nLocal report: ${localPath}\n`)
    return
  }

  const doc = await createFeishuDocOutput({
    command: process.env.LARK_MCP_COMMAND,
    args: parseOptionalArgs(process.env.LARK_MCP_ARGS),
  }).createDocument(markdown)
  process.stdout.write(`Local report: ${localPath}\nFeishu document: ${doc.url ?? doc.documentId ?? JSON.stringify(doc.raw)}\n`)
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

import { readFile } from 'node:fs/promises'
import { buildAuditReport } from '../audit.js'
import { parseArgs } from './args.js'
import { dateWindowForChinaDay, loadConfig } from '../config.js'
import type { Story } from '../domain.js'
import { createFeishuDocOutput } from '../feishu/docs-output.js'
import { FeishuProjectMcpClient } from '../feishu/project-mcp.js'
import { collectGitLabEvidence } from '../gitlab/collector.js'
import { GitLabClient } from '../gitlab/client.js'
import { renderAuditMarkdown } from '../render/markdown.js'
import { writeLocalReport } from '../output/local.js'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = await loadConfig()
  const window = dateWindowForChinaDay(args.date)
  const stories = args.storiesFixture
    ? await readStoriesFixture(args.storiesFixture)
    : await new FeishuProjectMcpClient({ mcpUrl: config.feishuProject.mcpUrl }).listStories(config.feishuProject.spaceName)

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

  const doc = await createFeishuDocOutput().createDocument(markdown)
  process.stdout.write(`Local report: ${localPath}\nFeishu document: ${doc.url ?? doc.documentId ?? JSON.stringify(doc.raw)}\n`)
}

async function readStoriesFixture(path: string): Promise<Story[]> {
  return JSON.parse(await readFile(path, 'utf8')) as Story[]
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

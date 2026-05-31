import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuditReport } from '../domain.js'

export async function writeLocalReport(input: { reportsDir: string; date: string; markdown: string }): Promise<string> {
  await mkdir(input.reportsDir, { recursive: true })
  const path = join(input.reportsDir, `${input.date}-pmo-audit.md`)
  await writeFile(path, input.markdown, 'utf8')
  return path
}

export interface LocalReportArtifacts {
  markdownPath: string
  jsonPath: string
  latestMarkdownPath: string
  manifestPath: string
}

export async function writeLocalReportArtifacts(input: {
  reportsDir: string
  date: string
  markdown: string
  report: AuditReport
  generatedAt?: Date
}): Promise<LocalReportArtifacts> {
  await mkdir(input.reportsDir, { recursive: true })
  const markdownPath = join(input.reportsDir, `${input.date}-pmo-audit.md`)
  const jsonPath = join(input.reportsDir, `${input.date}-pmo-audit.json`)
  const latestMarkdownPath = join(input.reportsDir, 'latest-pmo-audit.md')
  const manifestPath = join(input.reportsDir, `${input.date}-pmo-audit-manifest.json`)
  const generatedAt = (input.generatedAt ?? new Date()).toISOString()
  const manifest = {
    title: input.report.title,
    date: input.date,
    generatedAt,
    summary: input.report.summary,
    files: {
      markdown: markdownPath,
      json: jsonPath,
      latestMarkdown: latestMarkdownPath,
      manifest: manifestPath,
    },
  }

  await Promise.all([
    writeFile(markdownPath, input.markdown, 'utf8'),
    writeFile(latestMarkdownPath, input.markdown, 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8'),
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ])

  return { markdownPath, jsonPath, latestMarkdownPath, manifestPath }
}

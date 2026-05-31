import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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
  htmlPath: string
  latestMarkdownPath: string
  latestHtmlPath: string
  manifestPath: string
  indexPath: string
  indexJsonPath: string
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
  const htmlPath = join(input.reportsDir, `${input.date}-pmo-audit.html`)
  const latestMarkdownPath = join(input.reportsDir, 'latest-pmo-audit.md')
  const latestHtmlPath = join(input.reportsDir, 'latest-pmo-audit.html')
  const manifestPath = join(input.reportsDir, `${input.date}-pmo-audit-manifest.json`)
  const indexPath = join(input.reportsDir, 'index.html')
  const indexJsonPath = join(input.reportsDir, 'index.json')
  const generatedAt = (input.generatedAt ?? new Date()).toISOString()
  const html = renderLocalHtml(input.report, input.markdown, generatedAt)
  const manifest = {
    title: input.report.title,
    date: input.date,
    generatedAt,
    summary: input.report.summary,
    files: {
      markdown: markdownPath,
      json: jsonPath,
      html: htmlPath,
      latestMarkdown: latestMarkdownPath,
      latestHtml: latestHtmlPath,
      manifest: manifestPath,
      index: indexPath,
      indexJson: indexJsonPath,
    },
  }
  const index = await buildReportIndex(input.reportsDir, manifest)
  const indexHtml = renderIndexHtml(index)

  await Promise.all([
    writeFile(markdownPath, input.markdown, 'utf8'),
    writeFile(latestMarkdownPath, input.markdown, 'utf8'),
    writeFile(htmlPath, html, 'utf8'),
    writeFile(latestHtmlPath, html, 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8'),
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(indexJsonPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8'),
    writeFile(indexPath, indexHtml, 'utf8'),
  ])

  return { markdownPath, jsonPath, htmlPath, latestMarkdownPath, latestHtmlPath, manifestPath, indexPath, indexJsonPath }
}

async function buildReportIndex(reportsDir: string, currentManifest: ReportManifest): Promise<ReportIndex> {
  const manifests = new Map<string, ReportIndexEntry>()
  for (const existing of await readExistingManifests(reportsDir)) {
    manifests.set(existing.date, manifestToIndexEntry(existing))
  }
  manifests.set(currentManifest.date, manifestToIndexEntry(currentManifest))
  const reports = [...manifests.values()].sort((a, b) =>
    b.date.localeCompare(a.date) || b.generatedAt.localeCompare(a.generatedAt)
  )
  return { latest: reports[0]!, reports }
}

async function readExistingManifests(reportsDir: string): Promise<ReportManifest[]> {
  let files: string[]
  try {
    files = await readdir(reportsDir)
  } catch {
    return []
  }
  const manifests = await Promise.all(files
    .filter(file => /^\d{4}-\d{2}-\d{2}-pmo-audit-manifest\.json$/.test(file))
    .map(async file => {
      try {
        return JSON.parse(await readFile(join(reportsDir, file), 'utf8')) as ReportManifest
      } catch {
        return undefined
      }
    }))
  return manifests.filter((manifest): manifest is ReportManifest => Boolean(manifest?.date && manifest.files?.html))
}

function manifestToIndexEntry(manifest: ReportManifest): ReportIndexEntry {
  return {
    title: manifest.title,
    date: manifest.date,
    generatedAt: manifest.generatedAt,
    summary: manifest.summary,
    files: {
      markdown: manifest.files.markdown,
      json: manifest.files.json,
      html: manifest.files.html,
      manifest: manifest.files.manifest,
    },
  }
}

function renderLocalHtml(report: AuditReport, markdown: string, generatedAt: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(report.title)}</title>`,
    '<style>',
    ':root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}',
    'body{margin:0;padding:32px;background:#f6f7f9;color:#1f2328}',
    'main{max-width:1180px;margin:0 auto;background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:28px}',
    'h1{font-size:24px;margin:0 0 4px}',
    '.meta{color:#57606a;margin:0 0 24px}',
    'pre{white-space:pre-wrap;word-break:break-word;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:0}',
    '@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}main{background:#161b22;border-color:#30363d}.meta{color:#8b949e}}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(report.title)}</h1>`,
    `<p class="meta">Generated at ${escapeHtml(generatedAt)}</p>`,
    `<pre>${escapeHtml(markdown)}</pre>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface ReportManifest {
  title: string
  date: string
  generatedAt: string
  summary: AuditReport['summary']
  files: {
    markdown: string
    json: string
    html: string
    latestMarkdown?: string
    latestHtml?: string
    manifest: string
    index?: string
    indexJson?: string
  }
}

interface ReportIndexEntry {
  title: string
  date: string
  generatedAt: string
  summary: AuditReport['summary']
  files: { markdown: string; json: string; html: string; manifest: string }
}

interface ReportIndex {
  latest: ReportIndexEntry
  reports: ReportIndexEntry[]
}

function renderIndexHtml(index: ReportIndex): string {
  const rows = index.reports.map(report => [
    '<tr>',
    `<td>${escapeHtml(report.date)}</td>`,
    `<td><a href="${escapeHtml(relativeReportPath(report.files.html))}">${escapeHtml(report.title)}</a></td>`,
    `<td>${report.summary.stories}</td>`,
    `<td>${report.summary.risky}</td>`,
    `<td>${report.summary.suggestedContacts}</td>`,
    `<td><a href="${escapeHtml(relativeReportPath(report.files.markdown))}">Markdown</a> · <a href="${escapeHtml(relativeReportPath(report.files.json))}">JSON</a></td>`,
    '</tr>',
  ].join('')).join('\n')
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>PMO Agent Reports</title>',
    '<style>',
    ':root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}',
    'body{margin:0;padding:32px;background:#f6f7f9;color:#1f2328}',
    'main{max-width:1180px;margin:0 auto;background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:28px}',
    'h1{font-size:24px;margin:0 0 12px}',
    'table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #d8dee4;padding:10px;text-align:left;vertical-align:top}th{font-size:13px;color:#57606a}',
    'a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}',
    '@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}main{background:#161b22;border-color:#30363d}th,td{border-color:#30363d}th{color:#8b949e}a{color:#58a6ff}}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>PMO Agent Reports</h1>',
    '<table>',
    '<thead><tr><th>日期</th><th>报告</th><th>需求</th><th>风险</th><th>建议沟通</th><th>文件</th></tr></thead>',
    `<tbody>${rows}</tbody>`,
    '</table>',
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function relativeReportPath(path: string): string {
  return path.split('/').pop() ?? path
}

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
  const body = renderMarkdownHtml(markdown)
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(report.title)}</title>`,
    '<style>',
    ':root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;color:#1f2328;background:#f4f6f8}',
    'body{margin:0;padding:28px;background:linear-gradient(180deg,#f7f8fa 0,#eef2f6 100%)}',
    'main{max-width:1280px;margin:0 auto;background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:28px;box-shadow:0 18px 45px rgba(31,35,40,.08)}',
    '.hero{border-bottom:1px solid #d8dee4;margin-bottom:24px;padding-bottom:18px}',
    '.hero h1{font-size:28px;line-height:1.2;margin:0 0 6px;letter-spacing:0}',
    '.meta{color:#57606a;margin:0;font-size:14px}',
    '.content h1{font-size:24px;margin:28px 0 12px}.content h2{font-size:20px;margin:28px 0 12px}.content h3{font-size:17px;margin:22px 0 10px}',
    '.content p{margin:10px 0}.content ul{margin:10px 0 18px;padding-left:22px}.content li{margin:6px 0}',
    '.table-wrap{overflow-x:auto;margin:14px 0 24px;border:1px solid #d8dee4;border-radius:8px;background:#fff}',
    'table{width:100%;min-width:760px;border-collapse:collapse;font-size:14px}th,td{padding:10px 12px;border-bottom:1px solid #d8dee4;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#f6f8fa;color:#57606a;font-weight:650}tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#fbfcfd}',
    'a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}code{background:#f6f8fa;border:1px solid #d8dee4;border-radius:4px;padding:1px 4px}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<section class="hero">',
    `<h1>${escapeHtml(report.title)}</h1>`,
    `<p class="meta">Generated at ${escapeHtml(generatedAt)}</p>`,
    '</section>',
    `<section class="content">${body}</section>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function renderMarkdownHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const blocks: string[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      i++
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2]!)}</h${level}>`)
      i++
      continue
    }
    if (isTableStart(lines, i)) {
      const tableLines: string[] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) {
        tableLines.push(lines[i]!)
        i++
      }
      blocks.push(renderMarkdownTable(tableLines))
      continue
    }
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*-\s+/.test(lines[i] ?? '')) {
        items.push(`<li>${renderInlineMarkdown((lines[i] ?? '').replace(/^\s*-\s+/, ''))}</li>`)
        i++
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i]?.trim() && !/^(#{1,3})\s+/.test(lines[i]!) && !isTableStart(lines, i) && !/^\s*-\s+/.test(lines[i]!)) {
      paragraph.push(lines[i]!.trim())
      i++
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
  }
  return blocks.join('\n')
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? ''
  const divider = lines[index + 1] ?? ''
  return /^\s*\|.*\|\s*$/.test(header) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider)
}

function renderMarkdownTable(lines: string[]): string {
  const [headerLine, _divider, ...bodyLines] = lines
  const headers = splitMarkdownTableRow(headerLine ?? '')
  const rows = bodyLines.map(splitMarkdownTableRow)
  const thead = `<thead><tr>${headers.map(cell => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<div class="table-wrap"><table>${thead}${tbody}</table></div>`
}

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function renderInlineMarkdown(value: string): string {
  const escaped = escapeHtml(value)
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
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

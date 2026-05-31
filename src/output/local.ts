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
  htmlPath: string
  latestMarkdownPath: string
  latestHtmlPath: string
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
  const htmlPath = join(input.reportsDir, `${input.date}-pmo-audit.html`)
  const latestMarkdownPath = join(input.reportsDir, 'latest-pmo-audit.md')
  const latestHtmlPath = join(input.reportsDir, 'latest-pmo-audit.html')
  const manifestPath = join(input.reportsDir, `${input.date}-pmo-audit-manifest.json`)
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
    },
  }

  await Promise.all([
    writeFile(markdownPath, input.markdown, 'utf8'),
    writeFile(latestMarkdownPath, input.markdown, 'utf8'),
    writeFile(htmlPath, html, 'utf8'),
    writeFile(latestHtmlPath, html, 'utf8'),
    writeFile(jsonPath, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8'),
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ])

  return { markdownPath, jsonPath, htmlPath, latestMarkdownPath, latestHtmlPath, manifestPath }
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

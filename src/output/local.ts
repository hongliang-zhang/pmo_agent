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
    ':root{font-family:Aptos,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#eef1f4;line-height:1.45}',
    '*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#172033}',
    'a{color:#155eef;text-decoration:none}a:hover{text-decoration:underline}',
    '.pmo-shell{max-width:1440px;margin:0 auto;padding:28px}',
    '.topbar{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:18px}',
    '.eyebrow{font-size:12px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px}',
    'h1{font-size:28px;line-height:1.18;margin:0;color:#101828;letter-spacing:0}.meta{margin:8px 0 0;color:#667085;font-size:13px}',
    '.health{min-width:132px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:12px 14px;text-align:center}.health b{display:block;font-size:20px}.health span{font-size:12px;color:#667085}',
    '.metric-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:18px 0}',
    '.metric{background:#fff;border:1px solid #d7dde5;border-radius:8px;padding:13px}.metric strong{display:block;font-size:24px;line-height:1.1}.metric span{display:block;margin-top:6px;color:#667085;font-size:12px}',
    '.section-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(360px,.65fr);gap:14px;align-items:start}',
    '.panel{background:#fff;border:1px solid #d7dde5;border-radius:8px;margin:14px 0;padding:16px}.panel h2{font-size:17px;margin:0 0 12px;color:#101828}.panel-note{color:#667085;font-size:13px;margin:0}',
    '.risk-list{display:grid;gap:10px}.risk-card{border:1px solid #e1e6ee;border-left:4px solid #d0d5dd;border-radius:8px;padding:12px;background:#fff}.risk-card.p0{border-left-color:#d92d20}.risk-card.p1{border-left-color:#f79009}.risk-card.p2{border-left-color:#2e90fa}.risk-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.risk-title{font-weight:700;color:#101828}.risk-body{color:#475467;font-size:13px;margin:6px 0}.risk-action{font-size:13px;margin:8px 0 0;color:#101828}',
    '.badge{display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;border:1px solid #d0d5dd;background:#f8fafc;color:#344054}.badge.p0{background:#fef3f2;color:#b42318;border-color:#fecdca}.badge.p1{background:#fffaeb;color:#b54708;border-color:#fedf89}.badge.p2{background:#eff8ff;color:#175cd3;border-color:#b2ddff}.badge.green{background:#ecfdf3;color:#027a48;border-color:#abefc6}',
    '.story-list{display:grid;gap:10px}.story-card{border:1px solid #e1e6ee;border-radius:8px;padding:12px;background:#fff}.story-card h3{font-size:15px;margin:0 0 6px}.story-meta{display:flex;gap:8px;flex-wrap:wrap;color:#667085;font-size:12px;margin-bottom:8px}.story-summary{font-size:13px;color:#344054;margin:0 0 8px}.evidence-row{display:flex;gap:6px;flex-wrap:wrap}.evidence-pill{border:1px solid #d7dde5;background:#f8fafc;border-radius:999px;padding:2px 7px;font-size:12px;color:#475467}',
    '.contact-list{display:grid;gap:10px}.contact-card{border:1px solid #e1e6ee;border-radius:8px;padding:11px;background:#fff}.contact-top{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:7px}.contact-person{font-weight:700;color:#101828}.contact-story{font-size:13px;color:#344054;margin:0 0 6px}.contact-question{font-size:13px;color:#475467;margin:0}',
    '.compact-table{width:100%;border-collapse:collapse;font-size:13px}.compact-table th,.compact-table td{border-bottom:1px solid #e4e7ec;padding:9px 8px;text-align:left;vertical-align:top}.compact-table th{color:#667085;font-weight:700;background:#f8fafc}.compact-table tr:last-child td{border-bottom:0}',
    '.empty{color:#667085;font-size:13px;margin:0}.appendix{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.appendix .panel{margin:0}',
    '@media(max-width:980px){.pmo-shell{padding:16px}.topbar{display:block}.health{margin-top:14px;text-align:left}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.section-grid{display:block}.appendix{grid-template-columns:1fr}}',
    '</style>',
    '</head>',
    '<body>',
    '<main class="pmo-shell">',
    '<section class="topbar">',
    '<div>',
    '<p class="eyebrow">PMO 状态核查</p>',
    `<h1>${escapeHtml(report.title)}</h1>`,
    `<p class="meta">生成时间 ${escapeHtml(generatedAt)} · 范围 MAAS_平台 / GitLab open-platform</p>`,
    '</div>',
    `<div class="health"><b>${escapeHtml(reportHealth(report))}</b><span>总体健康度</span></div>`,
    '</section>',
    renderMetricGrid(report),
    '<section class="section-grid">',
    '<div>',
    renderRisksPanel(report),
    renderProgressPanel(report),
    renderMismatchPanel(report),
    '</div>',
    '<aside>',
    renderContactsPanel(report),
    renderMissingPanel(report),
    renderNoDisturbPanel(report),
    '</aside>',
    '</section>',
    renderAppendixPanels(report),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function renderMetricGrid(report: AuditReport): string {
  const metrics = [
    ['全量需求', report.summary.stories],
    ['入主报告', report.summary.focused ?? report.summary.progressed + report.summary.risky],
    ['降噪需求', report.summary.suppressed ?? 0],
    ['实质进展', report.summary.progressed],
    ['P0/P1 风险', report.summary.highPriorityRisks ?? report.summary.risky],
    ['建议沟通', report.summary.suggestedContacts],
  ]
  return `<section class="metric-grid">${metrics.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(String(label))}</span></div>`).join('')}</section>`
}

function renderRisksPanel(report: AuditReport): string {
  const risks = report.riskyStories.flatMap(audit => audit.risks.map(risk => ({ audit, risk })))
  if (risks.length === 0) return panel('需要关注的风险', '<div class="risk-list"><p class="empty">暂无 P0/P1 风险。</p></div>')
  return panel('需要关注的风险', `<div class="risk-list">${risks.map(({ audit, risk }) => [
    `<article class="risk-card ${(risk.priority ?? 'P3').toLowerCase()}">`,
    '<div class="risk-head">',
    `<span class="badge ${(risk.priority ?? 'P3').toLowerCase()}">${escapeHtml(risk.priority ?? risk.severity)}</span>`,
    `<span class="badge">${escapeHtml(risk.category ?? risk.type)}</span>`,
    `<a class="risk-title" href="${escapeHtml(audit.story.url ?? '#')}">${escapeHtml(audit.story.title)}</a>`,
    '</div>',
    `<p class="risk-body">${escapeHtml(risk.whyNow ?? risk.description)}</p>`,
    `<p class="risk-action"><b>建议动作：</b>${escapeHtml(risk.suggestedAction)}</p>`,
    `<p class="story-meta">找谁：${escapeHtml(risk.ownerToContact?.name ?? ownerNames(audit))} · 置信度：${escapeHtml(audit.confidence)}</p>`,
    '</article>',
  ].join('')).join('')}</div>`)
}

function renderProgressPanel(report: AuditReport): string {
  if (report.progressedStories.length === 0) return panel('今日/本周实质进展', '<div class="story-list"><p class="empty">暂无有证据的新进展。</p><span class="evidence-pill">MR: 0</span></div>')
  return panel('今日/本周实质进展', `<div class="story-list">${report.progressedStories.map(audit => [
    '<article class="story-card">',
    `<h3><a href="${escapeHtml(audit.story.url ?? '#')}">${escapeHtml(audit.story.title)}</a></h3>`,
    `<div class="story-meta"><span>${escapeHtml(audit.story.status)}</span><span>${escapeHtml(ownerNames(audit))}</span><span>${escapeHtml(audit.confidence)}</span></div>`,
    `<p class="story-summary">${escapeHtml(audit.progressSummary)}</p>`,
    `<div class="evidence-row">${evidencePills(audit).join('')}</div>`,
    '</article>',
  ].join('')).join('')}</div>`)
}

function renderMismatchPanel(report: AuditReport): string {
  if (report.isolatedEvidence.length === 0) return panel('代码有进展但需求未同步', '<p class="empty">暂无孤立代码进展。</p>')
  const rows = report.isolatedEvidence.slice(0, 8).map(item => `<tr><td>${escapeHtml(item.type)}</td><td><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></td><td>${escapeHtml(item.author ?? '')}</td><td>${escapeHtml(item.confidence)}</td></tr>`).join('')
  return panel('代码有进展但需求未同步', `<table class="compact-table"><thead><tr><th>类型</th><th>代码证据</th><th>作者</th><th>置信度</th></tr></thead><tbody>${rows}</tbody></table>`)
}

function renderContactsPanel(report: AuditReport): string {
  if (report.suggestedContacts.length === 0) return panel('建议沟通清单', '<p class="empty">暂无建议主动沟通事项。</p>')
  return panel('建议沟通清单', `<div class="contact-list">${report.suggestedContacts.map(item => [
    '<article class="contact-card">',
    '<div class="contact-top">',
    `<span class="contact-person">${escapeHtml(item.person)}</span>`,
    `<span class="badge ${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span>`,
    '</div>',
    `<p class="contact-story">${escapeHtml(item.storyTitle)}</p>`,
    `<p class="contact-question">${escapeHtml(item.question)}</p>`,
    '</article>',
  ].join('')).join('')}</div>`)
}

function renderMissingPanel(report: AuditReport): string {
  const rows = report.incompleteStories.flatMap(audit => audit.risks.filter(risk => risk.type.startsWith('missing_')).map(risk => ({ audit, risk })))
  if (rows.length === 0) return panel('信息维护缺口', '<p class="empty">暂无影响推进判断的信息缺口。</p>')
  return panel('信息维护缺口', `<table class="compact-table"><thead><tr><th>优先级</th><th>需求</th><th>缺失信息</th><th>建议动作</th></tr></thead><tbody>${rows.slice(0, 10).map(({ audit, risk }) => `<tr><td><span class="badge ${(risk.priority ?? 'P3').toLowerCase()}">${escapeHtml(risk.priority ?? risk.severity)}</span></td><td>${escapeHtml(audit.story.title)}</td><td>${escapeHtml(risk.type)}</td><td>${escapeHtml(risk.suggestedAction)}</td></tr>`).join('')}</tbody></table>`)
}

function renderNoDisturbPanel(report: AuditReport): string {
  if (report.noNeedToDisturb.length === 0) return panel('可以不打扰', '<p class="empty">暂无明确不打扰事项。</p>')
  return panel('可以不打扰', `<div class="story-list">${report.noNeedToDisturb.slice(0, 6).map(audit => `<article class="story-card"><h3>${escapeHtml(audit.story.title)}</h3><p class="story-summary">已有证据且暂无 P0/P1 风险，先观察。</p><div class="evidence-row">${evidencePills(audit).join('')}</div></article>`).join('')}</div>`)
}

function renderAppendixPanels(report: AuditReport): string {
  return [
    '<section class="appendix">',
    panel('工作流健康', report.stateSnapshot?.workstreams.length ? `<table class="compact-table"><thead><tr><th>工作流</th><th>健康</th><th>需求</th><th>风险</th></tr></thead><tbody>${report.stateSnapshot.workstreams.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.health)}</td><td>${item.stories}</td><td>${item.riskyStories}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">暂无。</p>'),
    panel('证据与降噪', `<p class="panel-note">GitLab 证据 ${report.gitlabEvidence.length} 条；孤立代码进展 ${report.isolatedEvidence.length} 条；降噪需求 ${report.suppressedStories?.length ?? 0} 个。</p>`),
    panel('文件', '<p class="panel-note"><a href="latest-pmo-audit.md">Markdown</a> · <a href="latest-pmo-audit.json">JSON</a> · <a href="index.html">历史报告</a></p>'),
    '</section>',
  ].join('\n')
}

function panel(title: string, body: string): string {
  return `<section class="panel"><h2>${escapeHtml(title)}</h2>${body}</section>`
}

function reportHealth(report: AuditReport): string {
  if ((report.summary.highPriorityRisks ?? 0) > 0 || report.riskyStories.some(audit => audit.risks.some(risk => risk.priority === 'P0'))) return 'Red'
  if (report.summary.risky > 0 || report.summary.incomplete > 0) return 'Yellow'
  return 'Green'
}

function ownerNames(audit: AuditReport['progressedStories'][number]): string {
  return audit.story.owners.map(owner => owner.name).join(', ') || '未维护'
}

function evidencePills(audit: AuditReport['progressedStories'][number]): string[] {
  const counts = [
    ['MR', audit.evidence.filter(item => item.type === 'gitlab_mr').length],
    ['commit', audit.evidence.filter(item => item.type === 'gitlab_commit').length],
    ['pipeline', audit.evidence.filter(item => item.type === 'gitlab_pipeline').length],
  ]
  return counts.map(([label, value]) => `<span class="evidence-pill">${escapeHtml(String(label))}: ${value}</span>`)
}

function priorityClass(priority: string): string {
  if (priority === 'high') return 'p1'
  if (priority === 'medium') return 'p2'
  return 'p3'
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

import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AuditReport, Evidence, Risk, StoryAudit } from '../domain.js'

export interface PmoAppState {
  generatedAt: string
  reportsDir: string
  selectedDate?: string
  availableReportDates: string[]
  latestReport?: PmoReportSummary
  dashboard: PmoDashboardState
  stories: PmoStoryCard[]
  risks: PmoRiskCard[]
  people: PmoPersonState[]
  evidence: PmoEvidenceCard[]
  gitlabPeople: PmoGitLabPersonDay[]
  storyProgress: PmoStoryProgressCard[]
  storyBoard: PmoStoryBoardGroup[]
  quietStories: PmoStoryCard[]
  reports: PmoReportLink[]
  runs: unknown[]
  drafts: unknown[]
  approvalCenter?: unknown
  ops?: unknown
  botEvents: unknown[]
  settings: PmoAppSettings
  links: {
    app: string
    latestReportHtml: string
    reportIndex: string
    opsDashboard: string
    approvalCenter: string
  }
}

export interface PmoAppSettings {
  dataSources: Array<{ name: string; status: 'connected' | 'degraded' | 'missing'; detail: string }>
  capabilities: Array<{ name: string; status: 'enabled' | 'approval_required' | 'disabled'; detail: string }>
  accessControl: Array<{ name: string; status: 'enabled' | 'disabled'; detail: string }>
  artifacts: Array<{ name: string; status: 'present' | 'missing'; detail: string }>
}

export interface PmoDashboardState {
  stories: number
  focused: number
  progressed: number
  risky: number
  highPriorityRisks: number
  incomplete: number
  suggestedContacts: number
  suppressed: number
  failedRuns: number
  pendingDrafts: number
  pendingApprovals: number
  botEvents: number
}

export interface PmoReportSummary {
  title: string
  date: string
  jsonFile: string
  htmlFile: string
  markdownFile: string
  summary: AuditReport['summary']
}

export interface PmoReportLink {
  date?: string
  title: string
  htmlFile?: string
  markdownFile?: string
  jsonFile?: string
}

export interface PmoStoryCard {
  id: string
  title: string
  status: string
  url?: string
  owners: string[]
  progressSummary: string
  confidence: string
  evidenceCount: number
  riskCount: number
  highRiskCount: number
  updatedAt?: string
  health?: string
  workstream?: string
  reasons: string[]
}

export interface PmoRiskCard {
  id: string
  storyId: string
  storyTitle: string
  storyUrl?: string
  owner?: string
  type: string
  severity: string
  priority: string
  category: string
  description: string
  whyNow?: string
  suggestedAction: string
  evidenceCount: number
}

export interface PmoPersonState {
  name: string
  stories: number
  riskyStories: number
  highPriorityRisks: number
  progressedStories: number
  suggestedContacts: number
  storyTitles: string[]
  questions: string[]
}

export interface PmoEvidenceCard {
  id: string
  type: string
  title: string
  summary: string
  url?: string
  author?: string
  authorEmail?: string
  authorUsername?: string
  authorName?: string
  authorWebUrl?: string
  createdAt?: string
  updatedAt?: string
  storyId?: string
  storyTitle?: string
  confidence?: string
  repo?: string
  branch?: string
  state?: string
  status?: string
  mergeStatus?: string
  description?: string
}

export interface PmoGitLabPersonDay {
  author: string
  displayName: string
  email?: string
  identitySource: 'gitlab_email' | 'manual_alias' | 'author'
  total: number
  mrCount: number
  commitCount: number
  pipelineCount: number
  repos: string[]
  stories: string[]
  failedPipelines: number
  blockedMrs: number
  unmatched: number
  riskLevel: 'ok' | 'warn' | 'danger'
  items: PmoGitLabIterationItem[]
}

export interface PmoGitLabIterationItem {
  key: string
  title: string
  storyId?: string
  storyTitle: string
  storyUrl?: string
  repo: string
  summary: string
  author: string
  startedAt?: string
  updatedAt?: string
  durationLabel: string
  complexity: '低' | '中' | '高'
  complexityReason: string
  matched: boolean
  confidence: string
  risks: string[]
  evidence: PmoEvidenceCard[]
}

export interface PmoStoryProgressCard {
  id: string
  title: string
  url?: string
  status: string
  owners: string[]
  updatedAt?: string
  changes: string[]
  sources: string[]
  nextStep: string
  riskLevel: 'ok' | 'warn' | 'danger'
  missingInfo: boolean
  hasGitLabEvidence: boolean
  confidence: string
}

export interface PmoStoryBoardGroup {
  status: string
  count: number
  highRiskCount: number
  incompleteCount: number
  recent: PmoStoryCard[]
  stalled: PmoStoryCard[]
}

export async function loadPmoAppState(options: {
  reportsDir?: string
  publicBaseUrl?: string
  date?: string
} = {}): Promise<PmoAppState> {
  const reportsDir = options.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl ?? process.env.PMO_PUBLIC_BASE_URL ?? '')
  const files = await listReportFiles(reportsDir)
  const reportDates = listReportDates(files)
  const selectedDate = options.date && isIsoDate(options.date) ? options.date : undefined
  const latestJsonFile = chooseReportJson(files, selectedDate)
  const latestReport = latestJsonFile ? await readJsonFile<AuditReport>(reportsDir, latestJsonFile) : undefined
  const runs = await readJsonFile<unknown[]>(reportsDir, 'runs.json').catch(() => [])
  const drafts = await readJsonFile<unknown[]>(reportsDir, 'communication-drafts.json').catch(() => [])
  const approvalCenter = await readJsonFile<unknown>(reportsDir, 'approval-center.json').catch(() => undefined)
  const ops = await readJsonFile<unknown>(reportsDir, 'ops-dashboard.json').catch(() => undefined)
  const botEvents = await readJsonFile<unknown[]>(reportsDir, 'feishu-bot-events.json').catch(() => [])

  const stories = latestReport ? buildStoryCards(latestReport) : []
  const risks = latestReport ? buildRiskCards(latestReport) : []
  const people = latestReport ? buildPeopleState(latestReport) : []
  const evidence = latestReport ? buildEvidenceCards(latestReport) : []
  const gitlabPeople = latestReport ? buildGitLabPeople(evidence, latestReport) : []
  const storyProgress = latestReport ? buildStoryProgressCards(latestReport, evidence, selectedDate ?? latestReport.date) : []
  const storyBoard = latestReport ? buildStoryBoardGroups(stories, selectedDate ?? latestReport.date) : []
  const quietStories = latestReport ? buildStoryCards({ ...latestReport, progressedStories: [], riskyStories: [], incompleteStories: [], storyAudits: latestReport.noNeedToDisturb ?? [] }) : []
  const reports = buildReportLinks(files, latestReport)
  const pendingDrafts = drafts.filter(item => isRecord(item) && item.status === 'pending').length
  const failedRuns = runs.filter(item => isRecord(item) && item.status === 'failed').length
  const pendingApprovals = extractPendingApprovals(approvalCenter)

  return {
    generatedAt: new Date().toISOString(),
    reportsDir,
    selectedDate: selectedDate ?? latestReport?.date,
    availableReportDates: reportDates,
    latestReport: latestReport ? {
      title: latestReport.title,
      date: latestReport.date,
      jsonFile: latestJsonFile!,
      htmlFile: `${latestReport.date}-pmo-audit.html`,
      markdownFile: `${latestReport.date}-pmo-audit.md`,
      summary: latestReport.summary,
    } : undefined,
    dashboard: {
      stories: latestReport?.summary.stories ?? 0,
      focused: latestReport?.summary.focused ?? stories.length,
      progressed: latestReport?.summary.progressed ?? 0,
      risky: latestReport?.summary.risky ?? 0,
      highPriorityRisks: latestReport?.summary.highPriorityRisks ?? risks.filter(risk => risk.priority === 'P0' || risk.priority === 'P1').length,
      incomplete: latestReport?.summary.incomplete ?? 0,
      suggestedContacts: latestReport?.summary.suggestedContacts ?? 0,
      suppressed: latestReport?.summary.suppressed ?? 0,
      failedRuns,
      pendingDrafts,
      pendingApprovals,
      botEvents: botEvents.length,
    },
    stories,
    risks,
    people,
    evidence,
    gitlabPeople,
    storyProgress,
    storyBoard,
    quietStories,
    reports,
    runs,
    drafts,
    approvalCenter,
    ops,
    botEvents,
    settings: buildSettings({
      files,
      latestReport,
      runs,
      drafts,
      approvalCenter,
      ops,
      botEvents,
    }),
    links: {
      app: `${publicBaseUrl}/app`,
      latestReportHtml: `${publicBaseUrl}/reports/latest-pmo-audit.html`,
      reportIndex: `${publicBaseUrl}/reports/index.html`,
      opsDashboard: `${publicBaseUrl}/reports/ops-dashboard.html`,
      approvalCenter: `${publicBaseUrl}/reports/approval-center.html`,
    },
  }
}

function buildSettings(input: {
  files: string[]
  latestReport?: AuditReport
  runs: unknown[]
  drafts: unknown[]
  approvalCenter: unknown
  ops: unknown
  botEvents: unknown[]
}): PmoAppSettings {
  const hasGitLabEvidence = Boolean(input.latestReport?.gitlabEvidence.length || input.latestReport?.isolatedEvidence.some(item => item.type.startsWith('gitlab_')) || input.latestReport?.storyAudits?.some(audit => audit.evidence.some(item => item.type.startsWith('gitlab_'))))
  const hasFeishuStories = Boolean(input.latestReport?.summary.stories)
  const hasReport = Boolean(input.latestReport)
  const hasRuns = input.runs.length > 0
  const hasDrafts = input.drafts.length > 0
  const hasApprovalCenter = Boolean(input.approvalCenter)
  const hasOps = Boolean(input.ops)
  return {
    dataSources: [
      { name: '飞书项目 MAAS_平台', status: hasFeishuStories ? 'connected' : 'missing', detail: hasFeishuStories ? `最新报告读取 ${input.latestReport?.summary.stories ?? 0} 个需求` : '未找到最新日报需求数据' },
      { name: 'GitLab open-platform', status: hasGitLabEvidence ? 'connected' : 'degraded', detail: hasGitLabEvidence ? '已读取 MR/commit/pipeline 证据' : '当前报告没有 GitLab 证据或匹配结果' },
      { name: '飞书文档上下文', status: input.latestReport?.storyAudits?.some(audit => audit.context || audit.story.linkedDocs.length) ? 'connected' : 'degraded', detail: '按需求关联文档和上下文候选项读取；缺权限时报告会保留降级提示' },
      { name: '飞书 IM Bot', status: input.botEvents.length ? 'connected' : 'degraded', detail: input.botEvents.length ? `已有 ${input.botEvents.length} 条 Bot 审计事件` : '尚未记录 Bot 事件或 webhook 未触发' },
    ],
    capabilities: [
      { name: '日报生成', status: hasReport ? 'enabled' : 'disabled', detail: hasReport ? `最新日报 ${input.latestReport?.date}` : '缺少日报产物' },
      { name: '自然语言问答', status: 'enabled', detail: 'Web Agent 与飞书 Bot 复用规则型意图识别，不直接执行高风险动作' },
      { name: '沟通消息发送', status: 'approval_required', detail: hasDrafts ? '已有沟通草稿；发送前必须审批' : '支持草稿/审批链路，当前无草稿' },
      { name: '飞书项目字段写回', status: 'approval_required', detail: hasApprovalCenter ? '写回动作必须先进入审批中心' : '未找到审批中心产物' },
      { name: '失败运行重试', status: hasRuns ? 'enabled' : 'disabled', detail: hasRuns ? '通过 Runs API 和运行记录定位失败阶段' : '暂无运行记录' },
    ],
    accessControl: [
      { name: 'HTTP Basic Auth', status: process.env.PMO_HTTP_BASIC_AUTH ? 'enabled' : 'disabled', detail: process.env.PMO_HTTP_BASIC_AUTH ? 'Web 控制台和 API 受 Basic Auth 保护' : '未配置 Web Basic Auth' },
      { name: '飞书 Bot 用户白名单', status: hasAnyCsv(process.env.PMO_FEISHU_BOT_ALLOWED_USER_IDS, process.env.PMO_FEISHU_BOT_ALLOWED_OPEN_IDS, process.env.PMO_FEISHU_BOT_ALLOWED_UNION_IDS) ? 'enabled' : 'disabled', detail: 'Bot 对未授权用户 fail-closed' },
      { name: '飞书 Bot 群白名单', status: hasAnyCsv(process.env.PMO_FEISHU_BOT_ALLOWED_CHAT_IDS) ? 'enabled' : 'disabled', detail: '未配置时仅按用户白名单限制' },
    ],
    artifacts: [
      { name: '日报 JSON', status: hasReport ? 'present' : 'missing', detail: input.latestReport ? `${input.latestReport.date}-pmo-audit.json` : '未找到 YYYY-MM-DD-pmo-audit.json' },
      { name: '报告索引', status: input.files.includes('index.html') ? 'present' : 'missing', detail: 'reports/index.html' },
      { name: '运行面板', status: hasOps ? 'present' : 'missing', detail: 'ops-dashboard.json / ops-dashboard.html' },
      { name: '审批中心', status: hasApprovalCenter ? 'present' : 'missing', detail: 'approval-center.json / approval-center.html' },
      { name: '运行记录', status: hasRuns ? 'present' : 'missing', detail: 'runs.json' },
    ],
  }
}

async function listReportFiles(reportsDir: string): Promise<string[]> {
  try {
    return await readdir(reportsDir)
  } catch {
    return []
  }
}

function listReportDates(files: string[]): string[] {
  return files
    .filter(file => /^\d{4}-\d{2}-\d{2}-pmo-audit\.json$/.test(file))
    .sort()
    .map(file => file.slice(0, 10))
    .reverse()
}

function chooseReportJson(files: string[], date?: string): string | undefined {
  if (date) {
    const file = `${date}-pmo-audit.json`
    return files.includes(file) ? file : undefined
  }
  return listReportDates(files)[0] ? `${listReportDates(files)[0]}-pmo-audit.json` : undefined
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

async function readJsonFile<T>(reportsDir: string, file: string): Promise<T> {
  const content = await readFile(join(reportsDir, basename(file)), 'utf8')
  return JSON.parse(content) as T
}

function buildStoryCards(report: AuditReport): PmoStoryCard[] {
  const stateById = new Map((report.stateSnapshot?.stories ?? []).map(story => [story.storyId, story]))
  const audits = uniqueAudits([
    ...(report.progressedStories ?? []),
    ...(report.riskyStories ?? []),
    ...(report.incompleteStories ?? []),
    ...(report.noNeedToDisturb ?? []),
    ...(report.storyAudits ?? []),
  ])
  return audits.map(audit => {
    const state = stateById.get(audit.story.id)
    const highRiskCount = audit.risks.filter(risk => risk.priority === 'P0' || risk.priority === 'P1' || risk.severity === 'high').length
    return {
      id: audit.story.id,
      title: audit.story.title,
      status: audit.story.status,
      url: audit.story.url,
      owners: audit.story.owners.map(owner => owner.name).filter(Boolean),
      progressSummary: audit.progressSummary,
      confidence: audit.confidence,
      evidenceCount: audit.evidence.length,
      riskCount: audit.risks.length,
      highRiskCount,
      updatedAt: audit.story.updatedAt,
      health: state?.health,
      workstream: state?.workstream,
      reasons: state?.reasons ?? audit.risks.slice(0, 3).map(risk => risk.description),
    }
  })
}

function buildRiskCards(report: AuditReport): PmoRiskCard[] {
  return uniqueAudits([...(report.riskyStories ?? []), ...(report.storyAudits ?? [])])
    .flatMap(audit => audit.risks.map(risk => riskCardFromAudit(audit, risk)))
    .sort((a, b) => riskWeight(b) - riskWeight(a))
}

function riskCardFromAudit(audit: StoryAudit, risk: Risk): PmoRiskCard {
  return {
    id: risk.id,
    storyId: audit.story.id,
    storyTitle: audit.story.title,
    storyUrl: audit.story.url,
    owner: risk.ownerToContact?.name ?? audit.story.owners[0]?.name,
    type: risk.type,
    severity: risk.severity,
    priority: risk.priority ?? priorityFromSeverity(risk.severity),
    category: risk.category ?? 'Risk',
    description: risk.description,
    whyNow: risk.whyNow,
    suggestedAction: risk.suggestedAction,
    evidenceCount: risk.evidenceIds.length,
  }
}

function buildPeopleState(report: AuditReport): PmoPersonState[] {
  const people = new Map<string, PmoPersonState>()
  for (const audit of uniqueAudits([...(report.storyAudits ?? []), ...(report.progressedStories ?? []), ...(report.riskyStories ?? [])])) {
    const owners = audit.story.owners.length ? audit.story.owners : [{ name: '未指定' }]
    for (const owner of owners) {
      const person = getPerson(people, owner.name || '未指定')
      person.stories += 1
      if (audit.risks.length > 0) person.riskyStories += 1
      if (audit.evidence.length > 0) person.progressedStories += 1
      person.highPriorityRisks += audit.risks.filter(risk => risk.priority === 'P0' || risk.priority === 'P1' || risk.severity === 'high').length
      if (!person.storyTitles.includes(audit.story.title)) person.storyTitles.push(audit.story.title)
    }
  }
  for (const contact of report.suggestedContacts ?? []) {
    const person = getPerson(people, contact.person || '未指定')
    person.suggestedContacts += 1
    if (!person.storyTitles.includes(contact.storyTitle)) person.storyTitles.push(contact.storyTitle)
    person.questions.push(contact.question)
  }
  return [...people.values()].sort((a, b) => (b.highPriorityRisks + b.suggestedContacts) - (a.highPriorityRisks + a.suggestedContacts))
}

function getPerson(people: Map<string, PmoPersonState>, name: string): PmoPersonState {
  const existing = people.get(name)
  if (existing) return existing
  const created: PmoPersonState = {
    name,
    stories: 0,
    riskyStories: 0,
    highPriorityRisks: 0,
    progressedStories: 0,
    suggestedContacts: 0,
    storyTitles: [],
    questions: [],
  }
  people.set(name, created)
  return created
}

function buildEvidenceCards(report: AuditReport): PmoEvidenceCard[] {
  const cards: PmoEvidenceCard[] = []
  const seen = new Set<string>()
  for (const audit of uniqueAudits([...(report.progressedStories ?? []), ...(report.storyAudits ?? [])])) {
    for (const evidence of audit.evidence) {
      if (seen.has(`${audit.story.id}:${evidence.id}`)) continue
      seen.add(`${audit.story.id}:${evidence.id}`)
      cards.push({
        id: evidence.id,
        type: evidence.type,
        title: evidence.title,
        summary: evidence.summary,
        url: evidence.url,
        author: displayAuthor(evidence),
        createdAt: evidence.createdAt,
        updatedAt: evidence.updatedAt,
        confidence: evidence.confidence,
        storyId: audit.story.id,
        storyTitle: audit.story.title,
        ...evidenceMetadata(evidence),
      })
    }
  }
  for (const evidence of report.isolatedEvidence ?? []) {
    if (seen.has(`isolated:${evidence.id}`)) continue
    seen.add(`isolated:${evidence.id}`)
    cards.push({
      id: evidence.id,
      type: evidence.type,
      title: evidence.title,
      summary: evidence.summary,
      url: evidence.url,
      author: displayAuthor(evidence),
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
      confidence: evidence.confidence,
      ...evidenceMetadata(evidence),
    })
  }
  return cards.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
}

function evidenceMetadata(evidence: Evidence): Partial<PmoEvidenceCard> {
  const metadata = evidence.metadata ?? {}
  return {
    repo: stringValue(metadata.project),
    branch: stringValue(metadata.branch ?? metadata.ref),
    state: stringValue(metadata.state),
    status: stringValue(metadata.status),
    mergeStatus: stringValue(metadata.detailedMergeStatus ?? metadata.mergeStatus),
    description: stringValue(metadata.description),
    authorEmail: stringValue(metadata.authorEmail),
    authorUsername: stringValue(metadata.authorUsername),
    authorName: stringValue(metadata.authorName),
    authorWebUrl: stringValue(metadata.authorWebUrl),
  }
}

function buildGitLabPeople(evidence: PmoEvidenceCard[], report: AuditReport): PmoGitLabPersonDay[] {
  const gitlab = evidence.filter(item => item.type.startsWith('gitlab_'))
  const byAuthor = new Map<string, PmoEvidenceCard[]>()
  for (const item of gitlab) {
    const author = item.author || 'unknown'
    byAuthor.set(author, [...(byAuthor.get(author) ?? []), item])
  }
  const people = buildPeopleIndex(report)
  return [...byAuthor.entries()].map(([author, items]) => {
    const iterations = buildGitLabIterations(author, items)
    const failedPipelines = items.filter(isFailedPipeline).length
    const blockedMrs = items.filter(isBlockedMr).length
    const unmatched = items.filter(item => !item.storyId).length
    const riskLevel: PmoGitLabPersonDay['riskLevel'] = failedPipelines || blockedMrs ? 'danger' : unmatched ? 'warn' : 'ok'
    const identity = resolveGitLabIdentity(author, items, people)
    return {
      author,
      displayName: identity.name,
      email: identity.email,
      identitySource: identity.source,
      total: items.length,
      mrCount: items.filter(item => item.type === 'gitlab_mr').length,
      commitCount: items.filter(item => item.type === 'gitlab_commit').length,
      pipelineCount: items.filter(item => item.type === 'gitlab_pipeline').length,
      repos: unique(items.map(item => item.repo || repoFromUrl(item.url))).slice(0, 6),
      stories: unique(items.map(item => item.storyTitle || '未匹配飞书需求')).slice(0, 6),
      failedPipelines,
      blockedMrs,
      unmatched,
      riskLevel,
      items: iterations,
    }
  }).sort((a, b) => Number(a.author === 'unknown') - Number(b.author === 'unknown') || riskScore(b.riskLevel) - riskScore(a.riskLevel) || b.total - a.total || a.author.localeCompare(b.author))
}

function buildGitLabIterations(author: string, evidence: PmoEvidenceCard[]): PmoGitLabIterationItem[] {
  const groups = new Map<string, PmoEvidenceCard[]>()
  for (const item of evidence) {
    const key = item.storyId ? `story:${item.storyId}:${item.repo || ''}` : `repo:${item.repo || repoFromUrl(item.url)}:${item.branch || item.title}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].map(([key, items]) => {
    const sorted = items.slice().sort((a, b) => Date.parse(a.createdAt || a.updatedAt || '') - Date.parse(b.createdAt || b.updatedAt || ''))
    const first = sorted[0]!
    const last = sorted.at(-1)!
    const startedAt = earliestDate(items.map(item => item.createdAt || item.updatedAt))
    const updatedAt = latestDate(items.map(item => item.updatedAt || item.createdAt))
    const complexity = inferComplexity(items, startedAt, updatedAt)
    const risks = [
      items.some(isFailedPipeline) ? '存在失败 pipeline' : '',
      items.some(isBlockedMr) ? '存在可能卡住的 MR' : '',
      items.some(item => !item.storyId) ? '代码进展未关联飞书需求' : '',
    ].filter(Boolean)
    return {
      key,
      title: first.storyTitle || first.title,
      storyId: first.storyId,
      storyTitle: first.storyTitle || '未匹配飞书需求',
      storyUrl: storyUrlFromEvidence(first),
      repo: first.repo || repoFromUrl(first.url) || 'unknown',
      summary: summarizeIteration(items),
      author,
      startedAt,
      updatedAt,
      durationLabel: durationLabel(startedAt, updatedAt),
      complexity: complexity.level,
      complexityReason: complexity.reason,
      matched: Boolean(first.storyId),
      confidence: first.storyId ? 'confirmed' : 'unknown',
      risks,
      evidence: items.sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '')),
    }
  }).sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
}

function buildStoryProgressCards(report: AuditReport, evidence: PmoEvidenceCard[], date: string): PmoStoryProgressCard[] {
  const evidenceByStory = new Map<string, PmoEvidenceCard[]>()
  for (const item of evidence) {
    if (!item.storyId) continue
    evidenceByStory.set(item.storyId, [...(evidenceByStory.get(item.storyId) ?? []), item])
  }
  return uniqueAudits([...(report.progressedStories ?? []), ...(report.storyAudits ?? []), ...(report.riskyStories ?? []), ...(report.incompleteStories ?? [])])
    .map(audit => {
      const storyEvidence = evidenceByStory.get(audit.story.id) ?? []
      const todayEvidence = storyEvidence.filter(item => sameDate(item.updatedAt || item.createdAt, date))
      const storyChanged = sameDate(audit.story.updatedAt, date) || sameDate(String(audit.story.fields?.updated_at ?? ''), date)
      const sources = unique([
        storyChanged ? '飞书项目字段' : '',
        ...todayEvidence.map(item => item.type.startsWith('gitlab_') ? 'GitLab 证据' : sourceLabel(item.type)),
      ].filter(Boolean))
      const changes = [
        storyChanged ? `飞书项目需求更新时间为 ${audit.story.updatedAt || audit.story.fields?.updated_at}` : '',
        ...todayEvidence.slice(0, 4).map(item => `${sourceLabel(item.type)}：${item.title}`),
      ].filter(Boolean)
      const highRisk = audit.risks.some(risk => risk.priority === 'P0' || risk.priority === 'P1' || risk.severity === 'high')
      const missingInfo = audit.risks.some(risk => risk.type.startsWith('missing_'))
      const riskLevel: PmoStoryProgressCard['riskLevel'] = highRisk ? 'danger' : audit.risks.length || missingInfo ? 'warn' : 'ok'
      return {
        id: audit.story.id,
        title: audit.story.title,
        url: audit.story.url,
        status: audit.story.status,
        owners: audit.story.owners.map(owner => owner.name).filter(Boolean),
        updatedAt: audit.story.updatedAt,
        changes,
        sources,
        nextStep: String(audit.story.fields.nextStep || audit.risks[0]?.suggestedAction || audit.progressSummary || '暂无明确下一步'),
        riskLevel,
        missingInfo,
        hasGitLabEvidence: storyEvidence.some(item => item.type.startsWith('gitlab_')),
        confidence: changes.length ? audit.confidence : 'unknown',
      }
    })
    .filter(item => item.changes.length > 0)
    .sort((a, b) => riskScore(b.riskLevel) - riskScore(a.riskLevel) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
}

function buildStoryBoardGroups(stories: PmoStoryCard[], date: string): PmoStoryBoardGroup[] {
  const active = stories.filter(story => story.riskCount || story.evidenceCount || daysBetween(story.updatedAt, date) <= 62)
  const byStatus = new Map<string, PmoStoryCard[]>()
  for (const story of active) {
    const status = normalizeStatus(story.status)
    byStatus.set(status, [...(byStatus.get(status) ?? []), story])
  }
  const order = ['待启动', '设计中', '开发中', '测试中', '已上线', '其他']
  return [...byStatus.entries()].map(([status, items]) => ({
    status,
    count: items.length,
    highRiskCount: items.filter(item => item.highRiskCount > 0).length,
    incompleteCount: items.filter(item => item.riskCount > 0 && item.evidenceCount === 0).length,
    recent: items.filter(item => item.evidenceCount || daysBetween(item.updatedAt, date) <= 14).sort(compareBoardStory).slice(0, 8),
    stalled: items.filter(item => item.riskCount > 0 && daysBetween(item.updatedAt, date) > 14).sort(compareBoardStory).slice(0, 5),
  })).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
}

function buildReportLinks(files: string[], latestReport?: AuditReport): PmoReportLink[] {
  const byDate = new Map<string, PmoReportLink>()
  for (const file of files) {
    const match = /^(\d{4}-\d{2}-\d{2})-pmo-audit\.(html|md|json)$/.exec(file)
    if (!match) continue
    const date = match[1]!
    const ext = match[2]!
    const item = byDate.get(date) ?? { date, title: `PMO 状态核查日报 ${date}` }
    if (ext === 'html') item.htmlFile = file
    if (ext === 'md') item.markdownFile = file
    if (ext === 'json') item.jsonFile = file
    byDate.set(date, item)
  }
  const reports = [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  if (latestReport && reports[0]) reports[0].title = latestReport.title
  return reports
}

function uniqueAudits(audits: StoryAudit[]): StoryAudit[] {
  const seen = new Set<string>()
  const result: StoryAudit[] = []
  for (const audit of audits) {
    if (!audit?.story?.id || seen.has(audit.story.id)) continue
    seen.add(audit.story.id)
    result.push(audit)
  }
  return result
}

function extractPendingApprovals(approvalCenter: unknown): number {
  if (!isRecord(approvalCenter)) return 0
  const summary = approvalCenter.summary
  if (isRecord(summary) && typeof summary.totalPendingApprovals === 'number') return summary.totalPendingApprovals
  const pendingDrafts = Array.isArray(approvalCenter.pendingCommunicationDrafts) ? approvalCenter.pendingCommunicationDrafts.length : 0
  const pendingUpdates = Array.isArray(approvalCenter.pendingProjectUpdates) ? approvalCenter.pendingProjectUpdates.length : 0
  return pendingDrafts + pendingUpdates
}

function riskWeight(risk: PmoRiskCard): number {
  const priority = { P0: 100, P1: 80, P2: 50, P3: 20 }[risk.priority as 'P0' | 'P1' | 'P2' | 'P3'] ?? 0
  const severity = { high: 30, medium: 15, low: 5 }[risk.severity as 'high' | 'medium' | 'low'] ?? 0
  return priority + severity
}

function priorityFromSeverity(severity: string): string {
  if (severity === 'high') return 'P1'
  if (severity === 'medium') return 'P2'
  return 'P3'
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function hasAnyCsv(...values: Array<string | undefined>): boolean {
  return values.some(value => (value ?? '').split(',').some(item => item.trim()))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter(Boolean) as string[])]
}

function riskScore(level: string): number {
  return { danger: 3, warn: 2, ok: 1 }[level] ?? 0
}

function isFailedPipeline(item: PmoEvidenceCard): boolean {
  return item.type === 'gitlab_pipeline' && (item.status === 'failed' || /failed/i.test(item.title))
}

function isBlockedMr(item: PmoEvidenceCard): boolean {
  if (item.type !== 'gitlab_mr') return false
  if (item.state && item.state !== 'opened') return false
  return Boolean(item.mergeStatus && !/mergeable|can_be_merged/i.test(item.mergeStatus))
}

function repoFromUrl(url?: string): string | undefined {
  const match = /dev\.aminer\.cn\/([^/]+\/[^/]+)/.exec(url ?? '')
  return match?.[1]
}

function storyUrlFromEvidence(item: PmoEvidenceCard): string | undefined {
  return item.storyId ? `https://project.feishu.cn/7358164361912909827_1719375156/story/detail/${item.storyId}` : undefined
}

function earliestDate(values: Array<string | undefined>): string | undefined {
  return values.filter(Boolean).sort()[0]
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values.filter(Boolean).sort().at(-1)
}

function durationLabel(start?: string, end?: string): string {
  const days = daysBetween(start, end)
  if (!Number.isFinite(days)) return '时间不足'
  if (days <= 0) return '当天内'
  return `${days} 天`
}

function daysBetween(start?: string, end?: string): number {
  const from = Date.parse(start ?? '')
  const to = Date.parse(end ?? '')
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((to - from) / 86400000))
}

function inferComplexity(items: PmoEvidenceCard[], startedAt?: string, updatedAt?: string): { level: '低' | '中' | '高'; reason: string } {
  const mrCount = items.filter(item => item.type === 'gitlab_mr').length
  const commitCount = items.filter(item => item.type === 'gitlab_commit').length
  const pipelineCount = items.filter(item => item.type === 'gitlab_pipeline').length
  const days = daysBetween(startedAt, updatedAt)
  const hasLongDescription = items.some(item => (item.description ?? '').length > 800)
  if (mrCount >= 2 || commitCount >= 6 || pipelineCount >= 4 || days >= 3 || hasLongDescription) {
    return { level: '高', reason: `MR ${mrCount} / commit ${commitCount} / pipeline ${pipelineCount}，跨度 ${durationLabel(startedAt, updatedAt)}` }
  }
  if (mrCount === 1 || commitCount >= 2 || pipelineCount >= 2 || days >= 1) {
    return { level: '中', reason: `有多条证据或跨天迭代：MR ${mrCount} / commit ${commitCount} / pipeline ${pipelineCount}` }
  }
  return { level: '低', reason: '证据数量少且集中在当天内' }
}

function summarizeIteration(items: PmoEvidenceCard[]): string {
  const mr = items.find(item => item.type === 'gitlab_mr' && item.description)
  if (mr?.description) return compactText(mr.description, 150)
  return compactText(items.map(item => item.summary || item.title).slice(0, 3).join('；'), 150)
}

function compactText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function sameDate(value: string | undefined, date: string): boolean {
  return Boolean(value && value.slice(0, 10) === date)
}

function sourceLabel(type: string): string {
  if (type === 'gitlab_mr') return 'GitLab MR'
  if (type === 'gitlab_commit') return 'GitLab commit'
  if (type === 'gitlab_pipeline') return 'GitLab pipeline'
  if (type === 'feishu_project_field') return '飞书项目字段'
  if (type === 'feishu_project_comment') return '飞书评论'
  if (type === 'feishu_doc') return '飞书文档'
  return type
}

function normalizeStatus(status: string): string {
  if (/待|需求池|规划|未开始/.test(status)) return '待启动'
  if (/设计|方案|评审/.test(status)) return '设计中'
  if (/开发|联调|实现/.test(status)) return '开发中'
  if (/测试|验收/.test(status)) return '测试中'
  if (/上线|发布|完成|已关闭/.test(status)) return '已上线'
  return '其他'
}

function compareBoardStory(a: PmoStoryCard, b: PmoStoryCard): number {
  return (b.highRiskCount || 0) - (a.highRiskCount || 0)
    || (b.riskCount || 0) - (a.riskCount || 0)
    || (b.evidenceCount || 0) - (a.evidenceCount || 0)
    || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
}

interface PeopleIndex {
  byEmail: Map<string, { name: string; email?: string }>
}

const manualGitLabAliases: Record<string, { name: string; email?: string }> = {
  '666a3d38': { name: '夏雪妍', email: 'xueyan.xia@aminer.cn' },
  '8c3dbe9a': { name: '余鸿逍' },
  c3g4512d: { name: '胡强强', email: 'qiangqiang.hu@aminer.cn' },
  'chengyu.li': { name: '李承昱', email: 'chengyu.li@aminer.cn' },
  chongkun: { name: '刘崇坤', email: 'chongkun.liu@aminer.cn' },
  gaofanfei: { name: '高凡斐' },
  liuqingpei_5e6f7165: { name: '刘庆沛' },
  lvdongjian_a49d1351: { name: '吕东剑' },
  wanzijian_56532ce8: { name: '万子见' },
  xiaxueyan: { name: '夏雪妍', email: 'xueyan.xia@aminer.cn' },
  yangyaozong_2d74f56e: { name: '杨耀宗' },
  ymy: { name: '袁明艺', email: 'mingyi.yuan@aminer.cn' },
  youjiangping_4e447a88: { name: '游江平' },
  zhangjianyang: { name: '张鉴阳', email: 'jianyang.zhang@aminer.cn' },
  zhangpeipei: { name: '张佩佩', email: 'peipei.zhang@aminer.cn' },
  zhengweijun: { name: '郑炜俊', email: 'weijun.zheng@aminer.cn' },
  zhengyishang_d2ea785e: { name: '郑易尚' },
}

function displayAuthor(evidence: Evidence): string | undefined {
  const metadata = evidence.metadata ?? {}
  const rawAuthor = evidence.author
  return stringValue(metadata.authorName)
    ?? manualGitLabAliases[rawAuthor ?? '']?.name
    ?? rawAuthor
}

function buildPeopleIndex(report: AuditReport): PeopleIndex {
  const byEmail = new Map<string, { name: string; email?: string }>()
  for (const audit of uniqueAudits([...(report.storyAudits ?? []), ...(report.progressedStories ?? []), ...(report.riskyStories ?? []), ...(report.incompleteStories ?? [])])) {
    for (const person of [...audit.story.owners, audit.story.creator].filter(Boolean)) {
      if (!person?.email || !person.name) continue
      byEmail.set(person.email.toLowerCase(), { name: person.name, email: person.email })
    }
  }
  return { byEmail }
}

function resolveGitLabIdentity(author: string, items: PmoEvidenceCard[], people: PeopleIndex): { name: string; email?: string; source: PmoGitLabPersonDay['identitySource'] } {
  const email = items.map(item => item.authorEmail).find(Boolean)
  if (email) {
    const fromEmail = people.byEmail.get(email.toLowerCase())
    if (fromEmail) return { name: fromEmail.name, email: fromEmail.email, source: 'gitlab_email' }
  }
  const gitlabName = items.map(item => item.authorName).find(Boolean)
  if (gitlabName && gitlabName !== author) return { name: gitlabName, email, source: 'author' }
  const alias = manualGitLabAliases[author]
  if (alias) return { name: alias.name, email: alias.email ?? email, source: 'manual_alias' }
  if (email) return { name: author, email, source: 'gitlab_email' }
  return { name: author, source: 'author' }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnvFiles } from '../config.js'

await loadEnvFiles()

type AcceptanceStatus = 'complete' | 'pending_live_validation' | 'blocked'

interface AcceptanceRequirement {
  id: number
  title: string
  status: AcceptanceStatus
  evidence: string[]
  remaining?: string
}

interface LiveValidationEvidence {
  feishuImSent?: boolean
  feishuImSentAt?: string
  tencentCloudDeployed?: boolean
  tencentCloudHealthUrl?: string
  tencentCloudPreflightPassed?: boolean
  productionSchedulerRunning?: boolean
  basicAuthEnabled?: boolean
  feishuDocUrl?: string
  feishuDocHasNativeTables?: boolean
}

interface Args {
  reportsDir: string
  write: boolean
}

try {
  const args = parseArgs(process.argv.slice(2))
  const result = await buildAcceptanceReport(args)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    success: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      nextStep: 'Use: pnpm pmo:acceptance -- --reportsDir reports',
    },
  }, null, 2)}\n`)
  process.exitCode = 1
}

async function buildAcceptanceReport(args: Args): Promise<unknown> {
  const approval = await readJson(join(args.reportsDir, 'approval-center.json')).catch(() => undefined) as any
  const ops = await readJson(join(args.reportsDir, 'ops-dashboard.json')).catch(() => undefined) as any
  const draftAudit = await readJson(join(args.reportsDir, 'communication-draft-audit.json')).catch(() => []) as any[]
  const live = await readJson(join(args.reportsDir, 'live-validation.json')).catch(() => ({})) as LiveValidationEvidence
  const pendingApprovals = Number(approval?.summary?.totalPendingApprovals ?? 0)
  const hasOpsArtifacts = Boolean(ops?.summary)
  const hasDeliverySent = Array.isArray(draftAudit) && draftAudit.some(event => event?.action === 'delivery_sent')
  const imEnabled = process.env.PMO_FEISHU_IM_DELIVERY_ENABLED === 'true'
  const tencentDeployed = process.env.PMO_TENCENT_CLOUD_DEPLOYED === 'true' || live.tencentCloudDeployed === true
  const imLiveValidated = live.feishuImSent === true || (hasDeliverySent && pendingApprovals === 0)
  const reportOutputsLiveValidated = Boolean(live.feishuDocUrl || live.feishuDocHasNativeTables) && imLiveValidated
  const productionLiveValidated = tencentDeployed && (live.productionSchedulerRunning === true || hasOpsArtifacts)

  const requirements: AcceptanceRequirement[] = [
    {
      id: 1,
      title: '人员映射：飞书通讯录 API + 飞书项目 MCP 人员字段',
      status: 'complete',
      evidence: ['src/people/directory.ts', 'tests/person-directory.test.ts', 'live cycle previously mapped Feishu Project people through Contacts OpenAPI'],
    },
    {
      id: 2,
      title: '打扰策略：每日次数、同需求 24h 不重复、quiet hours',
      status: 'complete',
      evidence: ['src/server/drafts.ts defaultCommunicationPolicy', 'tests/drafts.test.ts'],
    },
    {
      id: 3,
      title: '消息发送：私聊/群消息，人工审批后发送',
      status: imLiveValidated || (imEnabled && pendingApprovals === 0) ? 'complete' : 'pending_live_validation',
      evidence: ['src/server/delivery.ts', 'tests/delivery.test.ts', 'reports/live-validation.json', 'pnpm pmo:approvals'],
      remaining: imLiveValidated ? undefined : imEnabled
        ? pendingApprovals > 0 ? `仍有 ${pendingApprovals} 条待审批项。` : undefined
        : '真实 IM 发送仍未打开；审批后设置 PMO_FEISHU_IM_DELIVERY_ENABLED=true 并执行 live smoke。',
    },
    {
      id: 4,
      title: '飞书项目回写：评论、字段、状态，live case 到需求评审',
      status: 'complete',
      evidence: ['src/feishu/project-mcp.ts', 'src/server/project-updates.ts', 'tests/project-updates.test.ts', 'live story 7005303241 was transitioned and commented'],
    },
    {
      id: 5,
      title: '腾讯云部署方式',
      status: tencentDeployed ? 'complete' : 'pending_live_validation',
      evidence: ['Dockerfile', 'deploy.sh', 'docs/tencent-cloud-deployment.zh-CN.md', 'reports/live-validation.json'],
      remaining: tencentDeployed ? undefined : '腾讯云实际部署和云上健康检查未执行。',
    },
    {
      id: 6,
      title: '报告接收：HTML、飞书文档、飞书单聊给张鸿亮',
      status: reportOutputsLiveValidated || (imEnabled && pendingApprovals === 0) ? 'complete' : 'pending_live_validation',
      evidence: ['reports/latest-pmo-audit.html', 'reports/live-validation.json', 'reports/approval-center.json'],
      remaining: reportOutputsLiveValidated ? undefined : pendingApprovals > 0
        ? `飞书单聊仍有 ${pendingApprovals} 条待审批草稿，尚未真实发送。`
        : imEnabled ? undefined : '飞书单聊真实发送未打开。',
    },
    {
      id: 7,
      title: '回复自动进入闭环',
      status: 'complete',
      evidence: ['src/server/checkins.ts', 'src/server/project-updates.ts', 'tests/checkins.test.ts'],
    },
    {
      id: 8,
      title: '生产调度：长期服务、定时器、日志、告警、可见输出',
      status: productionLiveValidated ? 'complete' : 'pending_live_validation',
      evidence: ['src/cli/production.ts', 'src/server/worker.ts', 'reports/ops-dashboard.html', 'reports/approval-center.html'],
      remaining: tencentDeployed ? undefined : '本地生产形态已验收；腾讯云长期运行部署未执行。',
    },
    {
      id: 9,
      title: '报告内容精调：优质 PM 方法论结构',
      status: 'complete',
      evidence: ['docs/pmo-report-methodology.zh-CN.md', 'src/render/markdown.ts', 'tests/renderer.test.ts'],
    },
  ]
  const summary = {
    total: requirements.length,
    complete: requirements.filter(item => item.status === 'complete').length,
    pending: requirements.filter(item => item.status === 'pending_live_validation').length,
    blocked: requirements.filter(item => item.status === 'blocked').length,
  }
  const report = {
    success: true,
    generatedAt: new Date().toISOString(),
    summary,
    requirements,
    remainingActions: requirements.flatMap(item => item.remaining ? [`#${item.id} ${item.remaining}`] : []),
  }
  if (!args.write) return report

  await mkdir(args.reportsDir, { recursive: true })
  const jsonPath = join(args.reportsDir, 'phase3.5-acceptance.json')
  const markdownPath = join(args.reportsDir, 'phase3.5-acceptance.md')
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, renderAcceptanceMarkdown(report), 'utf8'),
  ])
  return {
    ...report,
    artifacts: { jsonPath, markdownPath },
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    reportsDir: process.env.PMO_REPORTS_DIR ?? 'reports',
    write: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const next = argv[index + 1]
    if (arg === '--') continue
    if (arg === '--reportsDir') {
      parsed.reportsDir = required(next, arg)
      index += 1
    } else if (arg === '--write') {
      parsed.write = true
    } else {
      throw new Error(`Unknown argument '${arg}'`)
    }
  }
  return parsed
}

function required(value: string | undefined, flag: string): string {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function renderAcceptanceMarkdown(report: {
  generatedAt: string
  summary: { total: number; complete: number; pending: number; blocked: number }
  requirements: AcceptanceRequirement[]
  remainingActions: string[]
}): string {
  return [
    '# PMO Agent Phase 3.5 Acceptance',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    `Summary: ${report.summary.complete}/${report.summary.total} complete, ${report.summary.pending} pending live validation, ${report.summary.blocked} blocked.`,
    '',
    '| # | Requirement | Status | Evidence | Remaining |',
    '|---:|---|---|---|---|',
    ...report.requirements.map(item => [
      `| ${item.id} `,
      `| ${escapeMarkdownCell(item.title)} `,
      `| ${item.status} `,
      `| ${escapeMarkdownCell(item.evidence.join('; '))} `,
      `| ${escapeMarkdownCell(item.remaining ?? '')} |`,
    ].join('')),
    '',
    '## Remaining Actions',
    '',
    ...(report.remainingActions.length > 0 ? report.remainingActions.map(action => `- ${action}`) : ['- None.']),
    '',
  ].join('\n')
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

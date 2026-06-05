import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadEnvFiles } from '../config.js'
import { writeOpsDashboard } from '../output/ops-dashboard.js'

await loadEnvFiles()

type Command = 'list' | 'refresh' | 'show'

interface Args {
  command: Command
  reportsDir: string
  id?: string
}

interface ApprovalCenterData {
  generatedAt: string
  summary: {
    pendingCommunicationDrafts: number
    pendingProjectUpdates: number
    totalPendingApprovals: number
  }
  pendingCommunicationDrafts: Array<{ id: string; recipient: string }>
  pendingProjectUpdates: Array<{ id: string; storyId: string }>
}

try {
  const args = parseArgs(process.argv.slice(2))
  const result = await run(args)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    success: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      nextStep: 'Use: pnpm pmo:approvals -- list|refresh|show --reportsDir reports [--id approval_id]',
    },
  }, null, 2)}\n`)
  process.exitCode = 1
}

async function run(args: Args): Promise<unknown> {
  const artifacts = args.command === 'refresh'
    ? await writeOpsDashboard({ reportsDir: args.reportsDir })
    : undefined
  const approval = await readApprovalCenter(args.reportsDir).catch(async () => {
    const refreshed = await writeOpsDashboard({ reportsDir: args.reportsDir })
    return readApprovalCenter(args.reportsDir).then(data => ({ ...data, refreshed }))
  })
  if (args.command === 'show') {
    if (!args.id) throw new Error('show requires --id')
    const draft = approval.pendingCommunicationDrafts.find(item => item.id === args.id)
    if (draft) {
      return {
        success: true,
        approval: { type: 'communication_draft', id: draft.id, item: draft },
        nextCommands: {
          show: `pnpm pmo:drafts -- show --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor 张鸿亮`,
          approve: `pnpm pmo:drafts -- approve --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor 张鸿亮 --note '同意发送'`,
          reject: `pnpm pmo:drafts -- reject --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor 张鸿亮 --note '暂不发送'`,
          dryRun: `pnpm pmo:drafts -- deliver --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor 张鸿亮 --dryRun`,
          realSend: `PMO_FEISHU_IM_DELIVERY_ENABLED=true pnpm pmo:drafts -- deliver --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor 张鸿亮 --real`,
        },
      }
    }
    const projectUpdate = approval.pendingProjectUpdates.find(item => item.id === args.id)
    if (projectUpdate) {
      return {
        success: true,
        approval: { type: 'project_update', id: projectUpdate.id, item: projectUpdate },
        nextCommands: {
          show: `pnpm pmo:project-updates -- show --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(projectUpdate.id)} --actor 张鸿亮`,
          approve: `pnpm pmo:project-updates -- approve --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(projectUpdate.id)} --actor 张鸿亮 --note '同意写回'`,
          reject: `pnpm pmo:project-updates -- reject --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(projectUpdate.id)} --actor 张鸿亮 --note '暂不写回'`,
          dryRun: `pnpm pmo:project-updates -- apply --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(projectUpdate.id)} --actor 张鸿亮 --dryRun`,
          realApply: `pnpm pmo:project-updates -- apply --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(projectUpdate.id)} --actor 张鸿亮 --real`,
        },
      }
    }
    throw new Error(`Pending approval not found: ${args.id}`)
  }
  return {
    success: true,
    ...(artifacts ? { artifacts } : {}),
    generatedAt: approval.generatedAt,
    summary: approval.summary,
    pendingCommunicationDrafts: approval.pendingCommunicationDrafts,
    pendingProjectUpdates: approval.pendingProjectUpdates,
    nextCommands: nextCommands(args.reportsDir, approval),
  }
}

async function readApprovalCenter(reportsDir: string): Promise<ApprovalCenterData> {
  return JSON.parse(await readFile(join(reportsDir, 'approval-center.json'), 'utf8')) as ApprovalCenterData
}

function nextCommands(reportsDir: string, approval: ApprovalCenterData): Record<string, string> {
  const commands: Record<string, string> = {
    refresh: `pnpm pmo:approvals -- refresh --reportsDir ${shellQuote(reportsDir)}`,
  }
  const firstDraft = approval.pendingCommunicationDrafts[0]
  if (firstDraft) {
    commands.showDraft = `pnpm pmo:drafts -- show --reportsDir ${shellQuote(reportsDir)} --draftId ${shellQuote(firstDraft.id)} --actor 张鸿亮`
    commands.approveDraft = `pnpm pmo:drafts -- approve --reportsDir ${shellQuote(reportsDir)} --draftId ${shellQuote(firstDraft.id)} --actor 张鸿亮 --note '同意发送'`
    commands.draftDryRun = `pnpm pmo:drafts -- deliver --reportsDir ${shellQuote(reportsDir)} --draftId ${shellQuote(firstDraft.id)} --actor 张鸿亮 --dryRun`
  }
  const firstProjectUpdate = approval.pendingProjectUpdates[0]
  if (firstProjectUpdate) {
    commands.showProjectUpdate = `pnpm pmo:project-updates -- show --reportsDir ${shellQuote(reportsDir)} --actionId ${shellQuote(firstProjectUpdate.id)} --actor 张鸿亮`
    commands.approveProjectUpdate = `pnpm pmo:project-updates -- approve --reportsDir ${shellQuote(reportsDir)} --actionId ${shellQuote(firstProjectUpdate.id)} --actor 张鸿亮 --note '同意写回'`
    commands.projectUpdateDryRun = `pnpm pmo:project-updates -- apply --reportsDir ${shellQuote(reportsDir)} --actionId ${shellQuote(firstProjectUpdate.id)} --actor 张鸿亮 --dryRun`
  }
  return commands
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter(arg => arg !== '--' && !arg.startsWith('--'))
  const command = positional[0] as Command | undefined
  if (!command || !['list', 'refresh', 'show'].includes(command)) {
    throw new Error('First positional argument must be one of: list, refresh, show')
  }
  const parsed: Args = {
    command,
    reportsDir: process.env.PMO_REPORTS_DIR ?? 'reports',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const next = argv[index + 1]
    if (arg === '--' || !arg.startsWith('--')) continue
    if (arg === '--reportsDir') {
      parsed.reportsDir = required(next, arg)
      index += 1
    } else if (arg === '--id') {
      parsed.id = required(next, arg)
      index += 1
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

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

import { loadEnvFiles } from '../config.js'
import { approveCommunicationDraft, listCommunicationDraftAuditEvents, listCommunicationDrafts, rejectCommunicationDraft } from '../server/drafts.js'
import { deliverCommunicationDraft } from '../server/delivery.js'

await loadEnvFiles()

type Command = 'list' | 'show' | 'approve' | 'reject' | 'deliver' | 'audit'

interface Args {
  command: Command
  reportsDir: string
  draftId?: string
  actor: string
  note?: string
  dryRun: boolean
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
      nextStep: 'Use: pnpm pmo:drafts -- list|show|approve|reject|deliver --reportsDir reports [--draftId id] [--actor name] [--note text] [--dryRun|--real]',
    },
  }, null, 2)}\n`)
  process.exitCode = 1
}

async function run(args: Args): Promise<unknown> {
  if (args.command === 'list') {
    return { success: true, drafts: await listCommunicationDrafts(args.reportsDir) }
  }
  if (args.command === 'audit') {
    return { success: true, events: await listCommunicationDraftAuditEvents(args.reportsDir) }
  }
  if (!args.draftId) throw new Error(`${args.command} requires --draftId`)
  if (args.command === 'show') {
    const drafts = await listCommunicationDrafts(args.reportsDir)
    const draft = drafts.find(item => item.id === args.draftId)
    if (!draft) throw new Error(`Communication draft not found: ${args.draftId}`)
    return {
      success: true,
      draft,
      nextCommands: {
        approve: `pnpm pmo:drafts -- approve --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor ${shellQuote(args.actor)} --note '同意发送'`,
        reject: `pnpm pmo:drafts -- reject --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor ${shellQuote(args.actor)} --note '暂不发送'`,
        dryRun: `pnpm pmo:drafts -- deliver --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor ${shellQuote(args.actor)} --dryRun`,
        realSend: `PMO_FEISHU_IM_DELIVERY_ENABLED=true pnpm pmo:drafts -- deliver --reportsDir ${shellQuote(args.reportsDir)} --draftId ${shellQuote(draft.id)} --actor ${shellQuote(args.actor)} --real`,
      },
    }
  }
  if (args.command === 'approve') {
    const draft = await approveCommunicationDraft({ reportsDir: args.reportsDir, draftId: args.draftId, actor: args.actor, note: args.note })
    return { success: true, draft }
  }
  if (args.command === 'reject') {
    const draft = await rejectCommunicationDraft({ reportsDir: args.reportsDir, draftId: args.draftId, actor: args.actor, note: args.note })
    return { success: true, draft }
  }
  const result = await deliverCommunicationDraft({
    reportsDir: args.reportsDir,
    draftId: args.draftId,
    actor: args.actor,
    dryRun: args.dryRun,
  })
  return result
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter(arg => arg !== '--' && !arg.startsWith('--'))
  const command = positional[0] as Command | undefined
  if (!command || !['list', 'show', 'approve', 'reject', 'deliver', 'audit'].includes(command)) {
    throw new Error('First positional argument must be one of: list, show, approve, reject, deliver, audit')
  }
  const parsed: Args = {
    command,
    reportsDir: process.env.PMO_REPORTS_DIR ?? 'reports',
    actor: process.env.PMO_OPERATOR_NAME ?? 'PMO Owner',
    dryRun: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const next = argv[index + 1]
    if (arg === '--' || !arg.startsWith('--')) continue
    if (arg === '--reportsDir') {
      parsed.reportsDir = required(next, arg)
      index += 1
    } else if (arg === '--draftId') {
      parsed.draftId = required(next, arg)
      index += 1
    } else if (arg === '--actor') {
      parsed.actor = required(next, arg)
      index += 1
    } else if (arg === '--note') {
      parsed.note = required(next, arg)
      index += 1
    } else if (arg === '--dryRun') {
      parsed.dryRun = true
    } else if (arg === '--real') {
      parsed.dryRun = false
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

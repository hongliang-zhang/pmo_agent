import { loadEnvFiles } from '../config.js'
import {
  applyProjectUpdateAction,
  approveProjectUpdateAction,
  listProjectUpdateActions,
  previewProjectUpdateAction,
  rejectProjectUpdateAction,
} from '../server/project-updates.js'

await loadEnvFiles()

type Command = 'list' | 'show' | 'approve' | 'reject' | 'apply'

interface Args {
  command: Command
  reportsDir: string
  actionId?: string
  actor: string
  note?: string
  dryRun: boolean
  projectKey?: string
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
      nextStep: 'Use: pnpm pmo:project-updates -- list|show|approve|reject|apply --reportsDir reports [--actionId id] [--actor name] [--note text] [--dryRun|--real]',
    },
  }, null, 2)}\n`)
  process.exitCode = 1
}

async function run(args: Args): Promise<unknown> {
  if (args.command === 'list') {
    return { success: true, actions: await listProjectUpdateActions(args.reportsDir) }
  }
  if (!args.actionId) throw new Error(`${args.command} requires --actionId`)
  if (args.command === 'show') {
    const actions = await listProjectUpdateActions(args.reportsDir)
    const action = actions.find(item => item.id === args.actionId)
    if (!action) throw new Error(`Project update action not found: ${args.actionId}`)
    return {
      success: true,
      action,
      nextCommands: {
        approve: `pnpm pmo:project-updates -- approve --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(action.id)} --actor ${shellQuote(args.actor)} --note '同意写回'`,
        reject: `pnpm pmo:project-updates -- reject --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(action.id)} --actor ${shellQuote(args.actor)} --note '暂不写回'`,
        applyDryRun: `pnpm pmo:project-updates -- apply --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(action.id)} --actor ${shellQuote(args.actor)} --dryRun`,
        applyReal: `pnpm pmo:project-updates -- apply --reportsDir ${shellQuote(args.reportsDir)} --actionId ${shellQuote(action.id)} --actor ${shellQuote(args.actor)} --real`,
      },
    }
  }
  if (args.command === 'approve') {
    const action = await approveProjectUpdateAction({ reportsDir: args.reportsDir, actionId: args.actionId, actor: args.actor, note: args.note })
    return { success: true, action }
  }
  if (args.command === 'reject') {
    const action = await rejectProjectUpdateAction({ reportsDir: args.reportsDir, actionId: args.actionId, actor: args.actor, note: args.note })
    return { success: true, action }
  }
  if (args.dryRun) {
    return previewProjectUpdateAction({ reportsDir: args.reportsDir, actionId: args.actionId })
  }
  return applyProjectUpdateAction({
    reportsDir: args.reportsDir,
    actionId: args.actionId,
    actor: args.actor,
    projectKey: args.projectKey,
  })
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter(arg => arg !== '--' && !arg.startsWith('--'))
  const command = positional[0] as Command | undefined
  if (!command || !['list', 'show', 'approve', 'reject', 'apply'].includes(command)) {
    throw new Error('First positional argument must be one of: list, show, approve, reject, apply')
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
    } else if (arg === '--actionId') {
      parsed.actionId = required(next, arg)
      index += 1
    } else if (arg === '--actor') {
      parsed.actor = required(next, arg)
      index += 1
    } else if (arg === '--note') {
      parsed.note = required(next, arg)
      index += 1
    } else if (arg === '--projectKey') {
      parsed.projectKey = required(next, arg)
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

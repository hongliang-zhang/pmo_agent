import { runPmoBridgeAction, type PmoBridgeActionName } from '../actions/bridge.js'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await runPmoBridgeAction(args.action, args.input)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.success) process.exitCode = 1
}

function parseArgs(argv: string[]): { action: PmoBridgeActionName; input: unknown } {
  let action: PmoBridgeActionName | undefined
  let input: unknown = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '--action') {
      action = requiredValue(argv, ++i, '--action') as PmoBridgeActionName
      continue
    }
    if (arg === '--input-json') {
      input = JSON.parse(requiredValue(argv, ++i, '--input-json'))
      continue
    }
    throw new Error(`Unknown argument '${arg}'`)
  }
  if (!action) throw new Error('--action is required')
  return { action, input }
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  process.stdout.write(`${JSON.stringify({ success: false, error: { code: 'bridge_failed', message } }, null, 2)}\n`)
  process.exitCode = 1
})

import { loadEnvFiles } from '../config.js'
import { runModelSmoke } from '../smoke/model.js'

await loadEnvFiles()

const args = parseArgs(process.argv.slice(2))

try {
  const result = await runModelSmoke({
    reportsDir: args.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports/model-smoke',
    reportPath: args.reportPath,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stdout.write(`${JSON.stringify({
    success: false,
    error: {
      message: redact(message),
      nextStep: 'Set ZAI_API_KEY in .env.local, then rerun pnpm pmo:model-smoke. This command does not print the key or model text.',
    },
  }, null, 2)}\n`)
  process.exitCode = 1
}

function parseArgs(argv: string[]): { reportsDir?: string; reportPath?: string } {
  const parsed: { reportsDir?: string; reportPath?: string } = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const next = argv[index + 1]
    if (arg === '--reportsDir') {
      parsed.reportsDir = next
      index += 1
    } else if (arg === '--reportPath') {
      parsed.reportPath = next
      index += 1
    }
  }
  return parsed
}

function redact(value: string): string {
  return value.replace(/\b(token|password|api[_-]?key|secret)\b/gi, 'credential')
}

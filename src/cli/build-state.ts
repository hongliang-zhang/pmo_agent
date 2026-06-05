import { readFile } from 'node:fs/promises'
import type { AuditReport } from '../domain.js'
import { dateWindowForChinaDay } from '../config.js'
import { buildProjectStateSnapshot } from '../state.js'

async function main() {
  const input = parseInputPath(process.argv.slice(2))
  const report = JSON.parse(await readFile(input, 'utf8')) as AuditReport
  const snapshot = report.stateSnapshot ?? buildProjectStateSnapshot({
    report,
    window: dateWindowForChinaDay(report.date),
  })
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
}

function parseInputPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '--input') {
      const value = argv[++i]
      if (!value) throw new Error('--input requires a value')
      return value
    }
    throw new Error(`Unknown argument '${arg}'`)
  }
  throw new Error('--input is required')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

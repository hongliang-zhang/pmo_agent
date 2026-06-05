import { loadEnvFiles } from '../config.js'
import { renderDiagnostics } from '../diagnostics.js'
import { runPreflight } from '../preflight.js'

async function main() {
  await loadEnvFiles()
  const preflight = await runPreflight()
  process.stdout.write(`${renderDiagnostics(preflight.checks)}\n`)
  process.exitCode = preflight.status === 'fail' ? 1 : 0
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

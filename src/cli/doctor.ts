import { loadConfig, loadEnvFiles } from '../config.js'
import { renderDiagnostics, runDiagnostics } from '../diagnostics.js'

async function main() {
  await loadEnvFiles()
  const config = await loadConfig()
  const checks = await runDiagnostics(config)
  process.stdout.write(`${renderDiagnostics(checks)}\n`)
  process.exitCode = checks.some(check => check.status === 'fail') ? 1 : 0
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

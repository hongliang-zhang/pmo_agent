import { runLocalSmoke } from '../smoke/local.js'

const args = parseArgs(process.argv.slice(2))
const result = await runLocalSmoke({
  date: args.date ?? chinaToday(),
  reportsDir: args.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports',
  storiesFixture: args.storiesFixture,
  maxProjects: args.maxProjects === undefined ? undefined : Number(args.maxProjects),
  runAt: args.runAt,
  now: args.now,
  skipPreflight: args.skipPreflight === 'true',
  analyzeWithModels: args.analyzeWithModels === 'true',
  createFeishuDoc: args.createFeishuDoc === 'true',
  enrichContext: args.enrichContext === 'true',
  docsFixture: args.docsFixture,
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.success) process.exitCode = 1

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) parsed[key] = 'true'
    else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}

function chinaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

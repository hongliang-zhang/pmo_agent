export interface CliArgs {
  date: string
  dryRun: boolean
  output: 'markdown' | 'feishu-doc'
  storiesFixture?: string
  docsFixture?: string
  maxProjects?: number
  enrichContext: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    date: todayInChina(),
    dryRun: false,
    output: 'markdown',
    enrichContext: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') continue
    else if (arg === '--date') args.date = requiredValue(argv, ++i, '--date')
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--output') {
      const value = requiredValue(argv, ++i, '--output')
      if (value !== 'markdown' && value !== 'feishu-doc') throw new Error(`Invalid --output '${value}', expected markdown or feishu-doc`)
      args.output = value
    } else if (arg === '--stories-fixture') args.storiesFixture = requiredValue(argv, ++i, '--stories-fixture')
    else if (arg === '--docs-fixture') args.docsFixture = requiredValue(argv, ++i, '--docs-fixture')
    else if (arg === '--enrich-context') args.enrichContext = true
    else if (arg === '--max-projects') args.maxProjects = Number(requiredValue(argv, ++i, '--max-projects'))
    else throw new Error(`Unknown argument '${arg}'`)
  }
  return args
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function todayInChina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

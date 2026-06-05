import { readFile } from 'node:fs/promises'
import { loadConfig, loadEnvFiles } from '../config.js'
import { discoverFieldConfigs, suggestFieldMappings } from '../feishu/field-mapping.js'
import { FeishuProjectMcpClient, type FeishuProjectFieldConfig } from '../feishu/project-mcp.js'

interface Args {
  fieldsFixture?: string
  projectKey?: string
  workItemType?: string
  fieldQuery?: string
}

await loadEnvFiles()

const args = parseArgs(process.argv.slice(2))

try {
  const fields = args.fieldsFixture ? await readFixture(args.fieldsFixture) : await readLiveFields(args)
  const suggestions = suggestFieldMappings(fields)
  const envSuggestions = Object.values(suggestions)
    .flatMap(items => items[0] ? [`${items[0].envName}=${items[0].key}`] : [])
  process.stdout.write(`${JSON.stringify({
    success: true,
    fieldsRead: fields.length,
    suggestions,
    envSuggestions,
    note: 'Review suggestions before writing .env.local. Status transitions should prefer transition_node even when PMO_FEISHU_FIELD_STATUS is shown.',
  }, null, 2)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    success: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      nextStep: 'Check FEISHU_PROJECT_MCP_TOKEN/project config, or run with --fieldsFixture for local verification.',
    },
  }, null, 2)}\n`)
  process.exitCode = 1
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    const value = argv[index + 1]
    if (arg === '--fieldsFixture') {
      parsed.fieldsFixture = value
      index += 1
    } else if (arg === '--projectKey') {
      parsed.projectKey = value
      index += 1
    } else if (arg === '--workItemType') {
      parsed.workItemType = value
      index += 1
    } else if (arg === '--fieldQuery') {
      parsed.fieldQuery = value
      index += 1
    }
  }
  return parsed
}

async function readFixture(path: string): Promise<FeishuProjectFieldConfig[]> {
  return JSON.parse(await readFile(path, 'utf8')) as FeishuProjectFieldConfig[]
}

async function readLiveFields(args: Args): Promise<FeishuProjectFieldConfig[]> {
  const config = await loadConfig()
  const client = new FeishuProjectMcpClient({
    mcpUrl: config.feishuProject.mcpUrl,
    headers: config.feishuProject.headers,
  })
  const projectKey = args.projectKey ?? config.feishuProject.projectKey
  if (!projectKey) throw new Error('Missing project key. Set FEISHU_PROJECT_PROJECT_KEY or pass --projectKey.')
  return discoverFieldConfigs({
    client,
    projectKey,
    workItemType: args.workItemType ?? 'story',
    fieldQuery: args.fieldQuery,
  })
}

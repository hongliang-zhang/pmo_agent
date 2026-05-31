import { spawn } from 'node:child_process'

export interface AppConfig {
  gitlab: {
    baseUrl: string
    group: string
    token: string
  }
  feishuProject: {
    mcpUrl: string
    spaceName: string
    spaceUrl: string
    headers?: Record<string, string>
  }
  audit: {
    timezone: string
    reportsDir: string
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  credentialFill?: () => Promise<string | undefined>
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfig> {
  const env = options.env ?? process.env
  const credentialFill = options.credentialFill ?? readGitLabTokenFromGitCredential
  const token = env.GITLAB_TOKEN || await credentialFill()
  if (!token) {
    throw new Error('Missing GitLab token. Set GITLAB_TOKEN or approve a dev.aminer.cn git credential.')
  }

  const mcpUrl = env.FEISHU_PROJECT_MCP_URL
  if (!mcpUrl) {
    throw new Error('Missing FEISHU_PROJECT_MCP_URL. Use https://project.feishu.cn/mcp_server/v1 after enabling Feishu Project MCP OAuth for MAAS_平台.')
  }

  return {
    gitlab: {
      baseUrl: env.GITLAB_BASE_URL ?? 'https://dev.aminer.cn',
      group: env.GITLAB_GROUP ?? 'open-platform',
      token,
    },
    feishuProject: {
      mcpUrl,
      spaceName: env.FEISHU_PROJECT_SPACE_NAME ?? 'MAAS_平台',
      spaceUrl: env.FEISHU_PROJECT_SPACE_URL ?? 'https://project.feishu.cn/7358164361912909827_1719375156/story/homepage',
      headers: parseHeaderConfig(env),
    },
    audit: {
      timezone: env.PMO_TIMEZONE ?? 'Asia/Shanghai',
      reportsDir: env.PMO_REPORTS_DIR ?? 'reports',
    },
  }
}

function parseHeaderConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  if (env.FEISHU_PROJECT_MCP_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${env.FEISHU_PROJECT_MCP_BEARER_TOKEN}`
  }
  for (const raw of splitHeaderEntries(env.FEISHU_PROJECT_MCP_AUTH_HEADER)) {
    const index = raw.indexOf('=')
    if (index <= 0) throw new Error('Invalid FEISHU_PROJECT_MCP_AUTH_HEADER. Use Header-Name=value;Other=value')
    headers[raw.slice(0, index).trim()] = raw.slice(index + 1).trim()
  }
  return Object.keys(headers).length ? headers : undefined
}

function splitHeaderEntries(value: string | undefined): string[] {
  if (!value) return []
  return value.split(';').map(part => part.trim()).filter(Boolean)
}

export async function readGitLabTokenFromGitCredential(): Promise<string | undefined> {
  return new Promise(resolve => {
    const child = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'ignore'] })
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(undefined)
    }, 5_000)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(stdout.match(/^password=(.+)$/m)?.[1])
    })
    child.stdin.end('protocol=https\nhost=dev.aminer.cn\n\n')
  })
}

export function dateWindowForChinaDay(date: string): { since: Date; until: Date } {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
  if (!valid) throw new Error(`Invalid date '${date}', expected YYYY-MM-DD`)
  const since = new Date(`${date}T00:00:00+08:00`)
  const until = new Date(since.getTime() + 24 * 60 * 60 * 1000)
  return { since, until }
}

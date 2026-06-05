import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { FeishuOpenApiClient, type FeishuDocxDocumentResult } from './openapi.js'

export class FeishuDocSetupError extends Error {
  constructor(reason: string) {
    super(`Feishu doc output is not configured: ${explainFeishuDocSetupFailure(reason)} Configure lark-mcp in Codex or set LARK_MCP_COMMAND/LARK_MCP_ARGS, then retry --output feishu-doc.`)
    this.name = 'FeishuDocSetupError'
  }
}

export interface FeishuDocOutput {
  createDocument(markdown: string): Promise<{ url?: string; documentId?: string; raw: unknown }>
}

export interface FeishuOpenApiDocClient {
  createDocxDocumentFromMarkdown(input: { title: string; markdown: string; folderToken?: string }): Promise<FeishuDocxDocumentResult>
}

export function createFeishuDocOutput(options: {
  codexConfigPath?: string
  command?: string
  args?: string[]
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  openApiClient?: FeishuOpenApiDocClient
} = {}): FeishuDocOutput {
  const env = options.env ?? process.env
  if (env.PMO_FEISHU_DOC_OUTPUT_MODE === 'openapi') {
    return createFeishuOpenApiDocOutput({
      client: options.openApiClient,
      title: env.PMO_FEISHU_DOC_TITLE,
      folderToken: env.PMO_FEISHU_DOC_FOLDER_TOKEN,
      webBaseUrl: env.PMO_FEISHU_DOC_WEB_BASE_URL,
    })
  }
  return {
    async createDocument(markdown: string) {
      const launch = options.command
        ? { command: options.command, args: options.args ?? [] }
        : defaultLarkMcpLaunchFromEnv(env) ?? await readLarkMcpLaunch(options.codexConfigPath ?? join(homedir(), '.codex/config.toml'))
      if (!launch) throw new FeishuDocSetupError('lark-mcp server entry not found')
      const raw = await callStdioMcpTool(launch.command, launch.args, 'docx_builtin_import', {
        data: { file_name: `MAAS_平台 PMO 状态核查日报.md`, markdown },
        useUAT: true,
      })
      ensureMcpToolSucceeded(raw)
      const parsed = extractDocumentResult(raw)
      return {
        raw,
        documentId: parsed.documentId,
        url: parsed.url,
      }
    },
  }
}

export function createFeishuOpenApiDocOutput(options: {
  client?: FeishuOpenApiDocClient
  title?: string
  folderToken?: string
  webBaseUrl?: string
} = {}): FeishuDocOutput {
  return {
    async createDocument(markdown: string) {
      const client = options.client ?? new FeishuOpenApiClient()
      const result = await client.createDocxDocumentFromMarkdown({
        title: options.title ?? 'MAAS_平台 PMO 状态核查日报',
        markdown,
        folderToken: options.folderToken,
      })
      return {
        raw: result.raw,
        documentId: result.documentId,
        url: result.url ?? buildDocumentUrl(options.webBaseUrl, result.documentId),
      }
    },
  }
}

function buildDocumentUrl(webBaseUrl: string | undefined, documentId: string): string | undefined {
  if (!webBaseUrl) return undefined
  return `${webBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(documentId)}`
}

export function ensureMcpToolSucceeded(raw: unknown): void {
  if (raw && typeof raw === 'object' && 'isError' in raw && (raw as any).isError) {
    throw new FeishuDocSetupError(collectText(raw))
  }
  const text = collectText(raw)
  if (/Document import failed|Current user_access_token is invalid or expired/i.test(text)) {
    throw new FeishuDocSetupError(text)
  }
}

export function defaultLarkMcpLaunchFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): { command: string; args: string[] } | undefined {
  const appId = env.FEISHU_APP_ID ?? env.LARK_APP_ID
  const appSecret = env.FEISHU_APP_SECRET ?? env.LARK_APP_SECRET
  if (!appId || !appSecret) return undefined
  return {
    command: 'npx',
    args: ['-y', '@larksuiteoapi/lark-mcp', 'mcp', '-a', appId, '-s', appSecret, '--oauth'],
  }
}

export function explainFeishuDocSetupFailure(reason: string): string {
  if (reason.includes('99991672') || /Access denied.*docs:doc|drive:drive/s.test(reason)) {
    const url = reason.match(/https:\/\/open\.feishu\.cn\/app\/[^\s"',}]+\/auth[^\s"',}]*/)?.[0]
    return [
      'Feishu app permissions are missing for document creation.',
      'Add a user-identity document permission such as docx:document, docs:doc, or drive:drive, publish/approve the permission change, then rerun lark-mcp login with --scope "offline_access docx:document drive:drive docs:doc" so the refreshed token includes the new scope.',
      url ? `Permission page: ${url}.` : '',
      `Raw error: ${reason}.`,
    ].filter(Boolean).join(' ')
  }
  if (/invalid or expired|token.*expired/i.test(reason)) {
    return `The lark-mcp user token is invalid or expired. Rerun lark-mcp login and authorize in the browser. Raw error: ${reason}.`
  }
  return `${reason}.`
}

export function extractDocumentResult(raw: unknown): { documentId?: string; url?: string } {
  const text = collectText(raw)
  const documentId = /document_id["']?\s*[:=]\s*["']([^"']+)/.exec(text)?.[1]
    ?? /documentId["']?\s*[:=]\s*["']([^"']+)/.exec(text)?.[1]
    ?? /(?:docx|doccn)[A-Za-z0-9_-]{8,}/.exec(text)?.[0]
  const urls = [...text.matchAll(/https:\/\/[^\s"'\\]+/g)].map(match => match[0])
  const url = urls.find(candidate => !candidate.includes('open.feishu.cn/app/'))
  return { documentId, url }
}

function collectText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && 'content' in raw && Array.isArray((raw as any).content)) {
    return (raw as any).content.map((item: any) => item?.text ?? JSON.stringify(item)).join('\n')
  }
  return JSON.stringify(raw)
}

async function readLarkMcpLaunch(path: string): Promise<{ command: string; args: string[] } | undefined> {
  try {
    const toml = await readFile(path, 'utf8')
    const section = /\[mcp_servers\.lark-mcp\]([\s\S]*?)(?:\n\[|$)/.exec(toml)?.[1]
    const command = /command\s*=\s*"([^"]+)"/.exec(section ?? '')?.[1]
    const argsText = /args\s*=\s*\[([\s\S]*?)\]/.exec(section ?? '')?.[1]
    if (!command || !argsText) return undefined
    const args = [...argsText.matchAll(/"([^"]*)"/g)].map(match => match[1]!)
    return { command, args }
  } catch {
    return undefined
  }
}

async function callStdioMcpTool(command: string, args: string[], toolName: string, toolArgs: unknown): Promise<unknown> {
  const client = new Client({ name: 'pmo-agent', version: '0.1.0' })
  const transport = new StdioClientTransport({ command, args })
  try {
    await client.connect(transport)
    return await client.callTool({ name: toolName, arguments: toolArgs as Record<string, unknown> })
  } catch (error) {
    throw error instanceof FeishuDocSetupError
      ? error
      : new FeishuDocSetupError(error instanceof Error ? error.message : String(error))
  } finally {
    await client.close().catch(() => {})
  }
}

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export class FeishuDocSetupError extends Error {
  constructor(reason: string) {
    super(`Feishu doc output is not configured: ${reason}. Configure lark-mcp in Codex or set LARK_MCP_COMMAND/LARK_MCP_ARGS, then retry --output feishu-doc.`)
    this.name = 'FeishuDocSetupError'
  }
}

export interface FeishuDocOutput {
  createDocument(markdown: string): Promise<{ url?: string; documentId?: string; raw: unknown }>
}

export function createFeishuDocOutput(options: {
  codexConfigPath?: string
  command?: string
  args?: string[]
} = {}): FeishuDocOutput {
  return {
    async createDocument(markdown: string) {
      const launch = options.command
        ? { command: options.command, args: options.args ?? [] }
        : await readLarkMcpLaunch(options.codexConfigPath ?? join(homedir(), '.codex/config.toml'))
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

export function ensureMcpToolSucceeded(raw: unknown): void {
  if (raw && typeof raw === 'object' && 'isError' in raw && (raw as any).isError) {
    throw new FeishuDocSetupError(collectText(raw))
  }
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

import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { FeishuDocContent, FeishuDocContextReader } from '../context/enrichment.js'
import type { LinkedDoc } from '../domain.js'

export type FeishuDocFixture = Record<string, { title?: string; url?: string; content: string }>

export function createFixtureFeishuDocReader(fixture: FeishuDocFixture): FeishuDocContextReader {
  return {
    async read(doc: LinkedDoc): Promise<FeishuDocContent> {
      const found = fixture[doc.url] ?? fixture[extractFeishuDocToken(doc.url) ?? '']
      if (!found) throw new Error(`No Feishu doc fixture found for ${doc.url}`)
      return {
        title: found.title ?? doc.title,
        url: found.url ?? doc.url,
        content: found.content,
      }
    },
  }
}

export async function createFixtureFeishuDocReaderFromFile(path: string): Promise<FeishuDocContextReader> {
  return createFixtureFeishuDocReader(JSON.parse(await readFile(path, 'utf8')) as FeishuDocFixture)
}

export function createLarkMcpFeishuDocReader(options: {
  command?: string
  args?: string[]
} = {}): FeishuDocContextReader {
  return {
    async read(doc: LinkedDoc): Promise<FeishuDocContent> {
      const token = extractFeishuDocToken(doc.url)
      if (!token) throw new Error(`Cannot extract Feishu document token from ${doc.url}`)
      const command = options.command ?? process.env.LARK_MCP_COMMAND ?? 'npx'
      const args = options.args ?? parseOptionalArgs(process.env.LARK_MCP_ARGS) ?? ['-y', '@larksuiteoapi/lark-mcp', 'mcp', '--oauth']
      const raw = await callStdioMcpTool(command, args, 'docx_v1_document_rawContent', {
        document_id: token,
        useUAT: false,
      })
      return {
        title: doc.title,
        url: doc.url,
        content: collectText(raw),
      }
    },
  }
}

export function extractFeishuDocToken(url: string): string | undefined {
  return /\/(?:docx|docs)\/([^/?#]+)/.exec(url)?.[1]
}

function parseOptionalArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as string[]
  const matches = [...trimmed.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
  return matches.map(match => match[1] ?? match[2] ?? match[3]!)
}

async function callStdioMcpTool(command: string, args: string[], toolName: string, toolArgs: unknown): Promise<unknown> {
  const client = new Client({ name: 'pmo-agent-doc-context', version: '0.1.0' })
  const transport = new StdioClientTransport({ command, args })
  try {
    await client.connect(transport)
    return await client.callTool({ name: toolName, arguments: toolArgs as Record<string, unknown> })
  } finally {
    await client.close().catch(() => {})
  }
}

function collectText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && 'content' in raw && Array.isArray((raw as any).content)) {
    return (raw as any).content.map((item: any) => item?.text ?? JSON.stringify(item)).join('\n')
  }
  return JSON.stringify(raw)
}

export interface FeishuOpenApiClientOptions {
  appId?: string
  appSecret?: string
  baseUrl?: string
  tenantAccessToken?: string
  fetch?: typeof fetch
}

export interface FeishuContactIdentity {
  email?: string
  mobile?: string
  openId?: string
  userId?: string
  unionId?: string
  raw: unknown
}

export interface FeishuDocxDocumentResult {
  documentId: string
  revisionId?: string | number
  url?: string
  raw: unknown
}

export interface FeishuPostMessageContent {
  post: {
    zh_cn: {
      title: string
      content: Array<Array<{ tag: 'text'; text: string } | { tag: 'a'; text: string; href: string }>>
    }
  }
}

type AppendOperation =
  | { type: 'children'; children: unknown[] }
  | { type: 'descendant'; childrenId: string[]; descendants: unknown[] }

const MAX_TABLE_ROWS_PER_OPERATION = 40

export class FeishuOpenApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeishuOpenApiError'
  }
}

export class FeishuOpenApiClient {
  private readonly appId?: string
  private readonly appSecret?: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private tenantAccessToken?: string

  constructor(options: FeishuOpenApiClientOptions = {}) {
    this.appId = options.appId ?? process.env.FEISHU_APP_ID ?? process.env.LARK_APP_ID
    this.appSecret = options.appSecret ?? process.env.FEISHU_APP_SECRET ?? process.env.LARK_APP_SECRET
    this.baseUrl = options.baseUrl ?? process.env.FEISHU_OPENAPI_BASE_URL ?? 'https://open.feishu.cn/open-apis'
    this.fetchImpl = options.fetch ?? fetch
    this.tenantAccessToken = options.tenantAccessToken ?? process.env.FEISHU_TENANT_ACCESS_TOKEN
  }

  async batchGetUserIdsByEmail(emails: string[], userIdType: 'open_id' | 'user_id' | 'union_id' = 'open_id'): Promise<FeishuContactIdentity[]> {
    if (emails.length === 0) return []
    const data = await this.request(
      `/contact/v3/users/batch_get_id?user_id_type=${encodeURIComponent(userIdType)}`,
      {
        method: 'POST',
        body: {
          emails,
          include_resigned: true,
        },
      },
    )
    const items = data?.data?.user_list ?? data?.data?.items ?? data?.user_list ?? []
    return items.map((item: any) => ({
      email: item.email,
      mobile: item.mobile,
      openId: item.open_id,
      userId: item.user_id,
      unionId: item.union_id,
      raw: item,
    }))
  }

  async sendTextMessage(input: { receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id'; receiveId: string; text: string }): Promise<unknown> {
    return this.request(`/im/v1/messages?receive_id_type=${encodeURIComponent(input.receiveIdType)}`, {
      method: 'POST',
      body: {
        receive_id: input.receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: input.text }),
      },
    })
  }

  async sendPostMessage(input: {
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id'
    receiveId: string
    title?: string
    markdown: string
  }): Promise<unknown> {
    return this.request(`/im/v1/messages?receive_id_type=${encodeURIComponent(input.receiveIdType)}`, {
      method: 'POST',
      body: {
        receive_id: input.receiveId,
        msg_type: 'post',
        content: JSON.stringify(markdownToFeishuPost(input.markdown, input.title ?? 'PMO Agent')),
      },
    })
  }

  async sendMarkdownCardMessage(input: {
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id'
    receiveId: string
    title?: string
    markdown: string
  }): Promise<unknown> {
    return this.request(`/im/v1/messages?receive_id_type=${encodeURIComponent(input.receiveIdType)}`, {
      method: 'POST',
      body: {
        receive_id: input.receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(markdownToFeishuCard(input.markdown, input.title ?? 'PMO Agent')),
      },
    })
  }

  async addMessageReaction(input: { messageId: string; emojiType: string }): Promise<{ reactionId?: string; raw: unknown }> {
    const data = await this.request(`/im/v1/messages/${encodeURIComponent(input.messageId)}/reactions`, {
      method: 'POST',
      body: {
        reaction_type: {
          emoji_type: input.emojiType,
        },
      },
    })
    return {
      reactionId: data?.data?.reaction_id,
      raw: data,
    }
  }

  async deleteMessageReaction(input: { messageId: string; reactionId: string }): Promise<unknown> {
    return this.request(`/im/v1/messages/${encodeURIComponent(input.messageId)}/reactions/${encodeURIComponent(input.reactionId)}`, {
      method: 'DELETE',
    })
  }

  async createDocxDocumentFromMarkdown(input: { title: string; markdown: string; folderToken?: string }): Promise<FeishuDocxDocumentResult> {
    const created = await this.request('/docx/v1/documents', {
      method: 'POST',
      body: {
        title: input.title,
        ...(input.folderToken ? { folder_token: input.folderToken } : {}),
      },
    })
    const document = created?.data?.document ?? created?.document ?? created?.data ?? {}
    const documentId = String(document.document_id ?? document.documentId ?? '')
    if (!documentId) throw new FeishuOpenApiError('Feishu OpenAPI document creation did not return document_id.')
    const revisionId = document.revision_id ?? document.revisionId
    const operations = markdownToAppendOperations(input.markdown)
    for (const operation of operations) {
      const revisionQuery = revisionId === undefined ? '' : `?document_revision_id=${encodeURIComponent(String(revisionId))}`
      if (operation.type === 'children') {
        for (let index = 0; index < operation.children.length; index += 50) {
          const children = operation.children.slice(index, index + 50)
          await this.request(`/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children${revisionQuery}`, {
            method: 'POST',
            body: {
              index: -1,
              children,
            },
          })
        }
      } else {
        await this.request(`/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/descendant${revisionQuery}`, {
          method: 'POST',
          body: {
            index: -1,
            children_id: operation.childrenId,
            descendants: operation.descendants,
          },
        })
      }
    }
    return {
      documentId,
      revisionId,
      url: document.url,
      raw: created,
    }
  }

  private async request(path: string, input: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<any> {
    const token = await this.getTenantAccessToken()
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    const data = await res.json().catch(async () => ({ code: res.status, msg: await res.text() }))
    if (!res.ok || (typeof data?.code === 'number' && data.code !== 0)) {
      throw new FeishuOpenApiError(`Feishu OpenAPI request failed: ${data?.msg ?? data?.message ?? res.status}`)
    }
    return data
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken) return this.tenantAccessToken
    if (!this.appId || !this.appSecret) {
      throw new FeishuOpenApiError('Missing FEISHU_APP_ID/FEISHU_APP_SECRET or FEISHU_TENANT_ACCESS_TOKEN for Feishu OpenAPI.')
    }
    const res = await this.fetchImpl(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    })
    const data = await res.json().catch(async () => ({ code: res.status, msg: await res.text() }))
    if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
      throw new FeishuOpenApiError(`Cannot get tenant_access_token: ${data?.msg ?? data?.message ?? res.status}`)
    }
    const token = String(data.tenant_access_token)
    this.tenantAccessToken = token
    return token
  }
}

export function markdownToFeishuCard(markdown: string, title = 'PMO Agent'): Record<string, unknown> {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: title,
      },
      template: 'blue',
    },
    body: {
      elements: [{
        tag: 'markdown',
        element_id: 'pmo_agent_reply',
        content: normalizeCardMarkdown(markdown),
        text_size: 'normal',
      }],
    },
  }
}

function normalizeCardMarkdown(markdown: string): string {
  return markdown
    .replace(/^#{1,2}[^\S\r\n]+(.+?)[^\S\r\n]*$/gm, '### $1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function markdownToFeishuPost(markdown: string, title = 'PMO Agent'): FeishuPostMessageContent {
  const lines = markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())

  const content = lines.flatMap(line => {
    if (!line.trim()) return [[{ tag: 'text' as const, text: ' ' }]]
    return [markdownLineToPostElements(line)]
  })

  return {
    post: {
      zh_cn: {
        title,
        content: content.length ? content : [[{ tag: 'text', text: ' ' }]],
      },
    },
  }
}

function markdownLineToPostElements(line: string): Array<{ tag: 'text'; text: string } | { tag: 'a'; text: string; href: string }> {
  let text = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '• ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')

  const elements: Array<{ tag: 'text'; text: string } | { tag: 'a'; text: string; href: string }> = []
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let lastIndex = 0
  for (const match of text.matchAll(linkPattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) elements.push({ tag: 'text', text: text.slice(lastIndex, index) })
    elements.push({ tag: 'a', text: match[1] ?? match[2] ?? '链接', href: match[2] ?? '' })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) elements.push({ tag: 'text', text: text.slice(lastIndex) })
  if (elements.length === 0) elements.push({ tag: 'text', text })
  return elements.filter(element => element.tag === 'a' || element.text.length > 0)
}

function markdownToAppendOperations(markdown: string): AppendOperation[] {
  const operations: AppendOperation[] = []
  let pendingTextBlocks: unknown[] = []
  const flushText = () => {
    if (pendingTextBlocks.length === 0) return
    operations.push({ type: 'children', children: pendingTextBlocks })
    pendingTextBlocks = []
  }

  const lines = markdown.split(/\r?\n/).map(line => line.trimEnd())
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!line.trim()) continue

    const table = parseMarkdownTable(lines, index)
    if (table) {
      flushText()
      operations.push(...markdownTableToDescendantOperations(table.rows, operations.length))
      index = table.endIndex
      continue
    }

    pendingTextBlocks.push(textBlock(line))
  }
  flushText()
  return operations
}

function parseMarkdownTable(lines: string[], startIndex: number): { rows: string[][]; endIndex: number } | undefined {
  const header = parseMarkdownTableRow(lines[startIndex] ?? '')
  const separator = parseMarkdownTableRow(lines[startIndex + 1] ?? '')
  if (!header || !separator || !separator.every(isMarkdownTableSeparatorCell)) return undefined

  const rows = [header]
  let endIndex = startIndex + 1
  for (let index = startIndex + 2; index < lines.length; index += 1) {
    const row = parseMarkdownTableRow(lines[index] ?? '')
    if (!row) break
    rows.push(row)
    endIndex = index
  }
  if (rows.length < 2) return undefined
  const columnSize = Math.max(...rows.map(row => row.length))
  return {
    rows: rows.map(row => normalizeRow(row, columnSize)),
    endIndex,
  }
}

function parseMarkdownTableRow(line: string): string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return undefined
  const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return splitMarkdownTableCells(withoutOuterPipes).map(cell => cell.trim())
}

function splitMarkdownTableCells(row: string): string[] {
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const char of row) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

function isMarkdownTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim())
}

function normalizeRow(row: string[], columnSize: number): string[] {
  return Array.from({ length: columnSize }, (_, index) => row[index] ?? '')
}

function markdownTableToDescendantOperations(rows: string[][], sequence: number): AppendOperation[] {
  if (rows.length <= MAX_TABLE_ROWS_PER_OPERATION) {
    return [markdownTableToDescendantOperation(rows, sequence)]
  }
  const header = rows[0]!
  const dataRows = rows.slice(1)
  const chunkSize = MAX_TABLE_ROWS_PER_OPERATION - 1
  const operations: AppendOperation[] = []
  for (let index = 0; index < dataRows.length; index += chunkSize) {
    operations.push(markdownTableToDescendantOperation([header, ...dataRows.slice(index, index + chunkSize)], sequence + operations.length))
  }
  return operations
}

function markdownTableToDescendantOperation(rows: string[][], sequence: number): AppendOperation {
  const rowSize = rows.length
  const columnSize = Math.max(...rows.map(row => row.length))
  const tableId = `pmo_table_${sequence}`
  const cellIds: string[] = []
  const descendants: any[] = []

  descendants.push({
    block_id: tableId,
    block_type: 31,
    table: {
      property: {
        row_size: rowSize,
        column_size: columnSize,
      },
    },
    children: cellIds,
  })

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const cellId = `${tableId}_cell_${rowIndex}_${columnIndex}`
      const textId = `${cellId}_text`
      cellIds.push(cellId)
      descendants.push({
        block_id: cellId,
        block_type: 32,
        table_cell: {},
        children: [textId],
      })
      descendants.push({
        block_id: textId,
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: markdownCellToPlainText(cell),
              text_element_style: rowIndex === 0 ? { bold: true } : {},
            },
          }],
          style: {},
        },
        children: [],
      })
    })
  })

  return { type: 'descendant', childrenId: [tableId], descendants }
}

function markdownCellToPlainText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim()
}

function textBlock(content: string): unknown {
  return {
    block_type: 2,
    text: {
      elements: [{
        text_run: {
          content,
          text_element_style: {},
        },
      }],
      style: {},
    },
  }
}

import type { LinkedDoc, PersonRef, Story } from '../domain.js'

export class FeishuProjectSetupError extends Error {
  constructor(reason: string) {
    super(`Feishu Project MCP is not connected for MAAS_平台: ${reason}. Enable/install the MAAS_平台 MCP plugin and authorize HTTP OAuth at https://project.feishu.cn/mcp_server/v1 before running Phase 1 against real stories.`)
    this.name = 'FeishuProjectSetupError'
  }
}

export function normalizeStoryFromMcp(raw: any): Story {
  const fields = normalizeFields(raw.fields ?? raw.custom_fields ?? raw)
  const owners = normalizePeople(raw.owners ?? raw.owner ?? raw.assignees ?? raw.assignee)
  const linkedDocs = normalizeDocs(raw.documents ?? raw.docs ?? raw.linked_docs ?? raw.related_docs)
  return {
    id: String(raw.id ?? raw.story_id ?? raw.key ?? raw.uuid),
    title: String(raw.name ?? raw.title ?? raw.summary ?? ''),
    status: String(raw.status?.name ?? raw.status ?? raw.state?.name ?? raw.state ?? ''),
    owners,
    creator: normalizePerson(raw.creator ?? raw.created_by),
    priority: raw.priority?.name ?? raw.priority,
    linkedDocs,
    fields,
    url: raw.url ?? raw.web_url ?? raw.link,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt ?? raw.modified_at,
  }
}

function normalizeFields(raw: Record<string, unknown>): Story['fields'] {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = raw[key]
      if (typeof value === 'string' && value.trim()) return value
      if (value && typeof value === 'object' && 'value' in value && typeof (value as any).value === 'string') return (value as any).value
    }
    return undefined
  }
  return {
    goal: get('目标', 'goal', 'Goal'),
    problem: get('问题', 'problem'),
    successCriteria: get('成功标准', 'successCriteria', 'success_criteria'),
    acceptanceCriteria: get('验收标准', 'acceptanceCriteria', 'acceptance_criteria'),
    testPlan: get('测试计划', 'testPlan', 'test_plan'),
    nextStep: get('下一步', 'nextStep', 'next_step'),
    startDate: get('开始时间', 'startDate', 'start_time'),
    dueDate: get('结束时间', '截止时间', 'dueDate', 'end_time'),
    ...raw,
  }
}

function normalizePeople(raw: unknown): PersonRef[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.map(normalizePerson).filter((p): p is PersonRef => Boolean(p?.name))
}

function normalizePerson(raw: any): PersonRef | undefined {
  if (!raw) return undefined
  if (typeof raw === 'string') return { name: raw }
  const name = raw.name ?? raw.display_name ?? raw.username ?? raw.email
  if (!name) return undefined
  return { name: String(name), email: raw.email, username: raw.username }
}

function normalizeDocs(raw: unknown): LinkedDoc[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.flatMap((doc: any) => {
    const url = doc?.url ?? doc?.link ?? doc?.web_url
    const title = doc?.title ?? doc?.name ?? url
    return url ? [{ title: String(title), url: String(url) }] : []
  })
}

interface FeishuProjectMcpClientOptions {
  mcpUrl: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  storyListTool?: string
}

export class FeishuProjectMcpClient {
  private readonly mcpUrl: string
  private readonly headers: Record<string, string>
  private readonly fetchImpl: typeof fetch
  private readonly storyListTool?: string

  constructor(options: FeishuProjectMcpClientOptions) {
    this.mcpUrl = options.mcpUrl
    this.headers = options.headers ?? {}
    this.fetchImpl = options.fetch ?? fetch
    this.storyListTool = options.storyListTool
  }

  async listStories(spaceName: string): Promise<Story[]> {
    try {
      const toolName = this.storyListTool ?? await this.discoverStoryListTool()
      const result = await this.callTool(toolName, { space_name: spaceName, object_type: 'story' })
      const rows = extractRows(result)
      return rows.map(normalizeStoryFromMcp).filter(story => story.id && story.title)
    } catch (error) {
      if (error instanceof FeishuProjectSetupError) throw error
      throw new FeishuProjectSetupError(error instanceof Error ? error.message : String(error))
    }
  }

  private async discoverStoryListTool(): Promise<string> {
    const tools = await this.rpc('tools/list', {})
    const candidates = (tools.tools ?? []) as Array<{ name: string }>
    const found = candidates.find(tool => /story|work.?item|requirement|需求/i.test(tool.name) && /list|search|query|find|列表|查询/i.test(tool.name))
      ?? candidates.find(tool => /story|work.?item|requirement|需求/i.test(tool.name))
    if (!found) throw new Error('no story/list tool found in Feishu Project MCP tools/list')
    return found.name
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc('tools/call', { name, arguments: args })
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<any> {
    const res = await this.fetchImpl(this.mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...this.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    })
    if (res.status === 401 || res.status === 403) throw new FeishuProjectSetupError(`HTTP ${res.status}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const text = await res.text()
    const data = parseMcpBody(text)
    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error))
    return data.result
  }
}

function parseMcpBody(text: string): any {
  if (text.trim().startsWith('data:')) {
    const line = text.split('\n').find(part => part.startsWith('data:'))
    return JSON.parse(line!.replace(/^data:\s*/, ''))
  }
  return JSON.parse(text)
}

function extractRows(result: any): any[] {
  const content = result?.content
  if (Array.isArray(result?.stories)) return result.stories
  if (Array.isArray(result?.items)) return result.items
  if (Array.isArray(result?.data)) return result.data
  if (Array.isArray(content)) {
    return content.flatMap((item: any) => {
      if (item.type === 'text') {
        const parsed = JSON.parse(item.text)
        return Array.isArray(parsed) ? parsed : parsed.items ?? parsed.stories ?? parsed.data ?? []
      }
      return []
    })
  }
  return []
}

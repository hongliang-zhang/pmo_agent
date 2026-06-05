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

export function normalizeStoryFromMql(raw: any, projectSimpleName?: string): Story {
  const fields = Object.fromEntries((raw.moql_field_list ?? []).map((field: any) => [field.key, readMqlValue(field)]))
  const id = String(fields.work_item_id ?? raw.id ?? '')
  const status = String(fields.work_item_status ?? '')
  const owners = normalizePeople(fields.current_status_operator)
  const creator = normalizePerson(fields.owner)
  const linkedDocs = normalizeDocs([
    fields.wiki,
    fields.field_0bdd58,
    fields.field_a0719a,
    fields.field_9afbaa,
    fields.field_eba98f,
  ].filter(Boolean))
  return {
    id,
    title: String(fields.name ?? ''),
    status,
    owners,
    creator,
    priority: fields.priority ? String(fields.priority) : undefined,
    linkedDocs,
    fields: {
      goal: fields.description ? String(fields.description) : undefined,
      problem: fields.description ? String(fields.description) : undefined,
      testPlan: fields.field_eba98f ? String(fields.field_eba98f) : undefined,
      startDate: fields.schedule_start ? String(fields.schedule_start) : undefined,
      dueDate: fields.schedule_end ? String(fields.schedule_end) : undefined,
      ...fields,
    },
    url: projectSimpleName && id ? `https://project.feishu.cn/${projectSimpleName}/story/detail/${id}` : undefined,
    updatedAt: fields.updated_at ? String(fields.updated_at) : undefined,
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
  return {
    name: String(name),
    email: raw.email,
    username: raw.username,
    userKey: raw.user_key ?? raw.userKey ?? raw.key,
    larkUserId: raw.lark_user_id ?? raw.larkUserId,
    openId: raw.open_id ?? raw.openId,
  }
}

function normalizeDocs(raw: unknown): LinkedDoc[] {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.flatMap((doc: any) => {
    if (typeof doc === 'string') return doc ? [{ title: doc, url: doc }] : []
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

export interface FeishuProjectUser {
  name: string
  email?: string
  userKey?: string
  larkUserId?: string
  openId?: string
  raw: unknown
}

export interface FeishuProjectFieldConfig {
  key: string
  name: string
  type?: string
  raw: unknown
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

  async listStories(spaceName: string, projectKeyHint?: string, activeStatuses: string[] = []): Promise<Story[]> {
    try {
      const project = await this.resolveProject(spaceName, projectKeyHint)
      const toolName = this.storyListTool ?? 'search_by_mql'
      const rows: any[] = []
      const seen = new Set<string>()
      const pageSize = 100
      const statusQueries = activeStatuses.length > 1 ? activeStatuses.map(status => [status]) : [activeStatuses]
      for (const statuses of statusQueries) {
        for (let pageNum = 1; pageNum <= 10; pageNum += 1) {
          const result = await this.callTool(toolName, {
            project_key: project.projectKey,
            mql: storyListMql(project.name, statuses),
            group_pagination_list: [{ page_num: pageNum, page_size: pageSize }],
          })
          const pageRows = extractRows(result)
          let added = 0
          for (const row of pageRows) {
            const story = normalizeStoryFromMql(row, project.simpleName)
            if (!story.id || seen.has(story.id)) continue
            seen.add(story.id)
            rows.push(row)
            added += 1
          }
          if (pageRows.length < pageSize || added === 0) break
        }
      }
      return rows.map(row => normalizeStoryFromMql(row, project.simpleName)).filter(story => story.id && story.title)
    } catch (error) {
      if (error instanceof FeishuProjectSetupError) throw error
      throw new FeishuProjectSetupError(error instanceof Error ? error.message : String(error))
    }
  }

  async addComment(input: { projectKey: string; workItemId: string; content: string }): Promise<unknown> {
    return this.callTool('add_comment', {
      project_key: input.projectKey,
      work_item_id: input.workItemId,
      content: input.content,
    })
  }

  async updateFields(input: { projectKey: string; workItemId: string; fields: Array<{ fieldKey: string; fieldValue: string }> }): Promise<unknown> {
    return this.callTool('update_field', {
      project_key: input.projectKey,
      work_item_id: input.workItemId,
      fields: input.fields.map(field => ({
        field_key: field.fieldKey,
        field_value: field.fieldValue,
      })),
    })
  }

  async transitionNode(input: { projectKey: string; workItemId: string; nodeId: string; action?: 'confirm' | 'rollback'; rollbackReason?: string }): Promise<unknown> {
    return this.callTool('transition_node', {
      project_key: input.projectKey,
      work_item_id: input.workItemId,
      node_id: input.nodeId,
      action: input.action ?? 'confirm',
      rollback_reason: input.rollbackReason,
    })
  }

  async getWorkItemBrief(input: { projectKey: string; workItemId: string }): Promise<unknown> {
    return this.callTool('get_workitem_brief', {
      project_key: input.projectKey,
      work_item_id: input.workItemId,
    })
  }

  async searchUsers(input: { projectKey?: string; userKeys: string[] }): Promise<FeishuProjectUser[]> {
    const result = await this.callTool('search_user_info', {
      project_key: input.projectKey,
      user_keys: input.userKeys,
    })
    return extractUserRows(result).map(normalizeProjectUser).filter(user => user.name)
  }

  async listFieldConfigs(input: {
    projectKey: string
    workItemType: string
    fieldQuery?: string
    fieldKeys?: string[]
    fieldTypes?: string[]
    pageNum?: number
  }): Promise<FeishuProjectFieldConfig[]> {
    const result = await this.callTool('list_workitem_field_config', {
      project_key: input.projectKey,
      work_item_type: input.workItemType,
      page_num: input.pageNum ?? 1,
      ...(input.fieldQuery ? { field_query: input.fieldQuery } : {}),
      ...(input.fieldKeys ? { field_keys: input.fieldKeys } : {}),
      ...(input.fieldTypes ? { field_types: input.fieldTypes } : {}),
    })
    return extractFieldConfigRows(result).map(normalizeFieldConfig).filter(field => field.key && field.name)
  }

  private async resolveProject(spaceName: string, projectKeyHint?: string): Promise<{ projectKey: string; name: string; simpleName?: string }> {
    const candidates = [
      projectKeyHint ? await this.searchProject(projectKeyHint) : undefined,
      await this.searchProject(spaceName),
      await this.searchProject(),
    ].filter(Boolean).flat()
    const normalizedSpaceName = normalizeProjectName(spaceName)
    const matched = candidates.find(project =>
      project.project_key === projectKeyHint
      || project.simple_name === projectKeyHint
      || normalizeProjectName(project.name) === normalizedSpaceName
    ) ?? candidates[0]
    if (!matched?.project_key) throw new Error(`project_key not found for ${spaceName}`)
    return { projectKey: matched.project_key, name: matched.name, simpleName: matched.simple_name }
  }

  private async searchProject(projectKey?: string): Promise<any[]> {
    const result = await this.callTool('search_project_info', { page_num: 1, ...(projectKey ? { project_key: projectKey } : {}) })
    return extractProjectRows(result)
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
    if (data.result?.isError) throw new Error(collectMcpText(data.result))
    return data.result
  }
}

export function storyListMql(projectName: string, activeStatuses: string[] = []): string {
  const where = activeStatuses.length
    ? ` WHERE \`work_item_status\` in (${activeStatuses.map(quoteMqlString).join(',')})`
    : ''
  return [
    'SELECT `work_item_id`, `name`, `work_item_status`, `updated_at`, `schedule`, `priority`,',
    '`current_status_operator`, `owner`, `wiki`, `field_0bdd58`, `field_a0719a`, `field_9afbaa`, `field_eba98f`, `description`',
    `FROM \`${projectName}\`.\`需求\`${where} ORDER BY \`updated_at\` DESC`,
  ].join(' ')
}

function quoteMqlString(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`
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
        const parsed = safeJsonParse(item.text)
        if (!parsed) return []
        if (Array.isArray(parsed)) return parsed
        if (parsed.data && typeof parsed.data === 'object') return Object.values(parsed.data).flat() as any[]
        return parsed.items ?? parsed.stories ?? parsed.data ?? []
      }
      return []
    })
  }
  return []
}

function extractProjectRows(result: any): any[] {
  const content = result?.content
  if (!Array.isArray(content)) return []
  return content.flatMap((item: any) => {
    if (item.type !== 'text') return []
    const parsed = safeJsonParse(item.text)
    return parsed?.projects ?? []
  })
}

function extractUserRows(result: any): any[] {
  const content = result?.content
  if (Array.isArray(result?.users)) return result.users
  if (Array.isArray(result?.items)) return result.items
  if (Array.isArray(result?.list)) return result.list
  if (!Array.isArray(content)) return []
  return content.flatMap((item: any) => {
    if (item.type !== 'text') return []
    const parsed = safeJsonParse(item.text)
    if (!parsed) return []
    if (Array.isArray(parsed)) return parsed
    return parsed.users ?? parsed.list ?? parsed.items ?? []
  })
}

function extractFieldConfigRows(result: any): any[] {
  const content = result?.content
  if (Array.isArray(result?.fields)) return result.fields
  if (Array.isArray(result?.list)) return result.list
  if (Array.isArray(result?.items)) return result.items
  if (!Array.isArray(content)) return []
  return content.flatMap((item: any) => {
    if (item.type !== 'text' || !String(item.text).trim().startsWith('{')) return []
    const parsed = safeJsonParse(item.text)
    if (!parsed) return []
    if (Array.isArray(parsed)) return parsed
    return parsed.list ?? parsed.fields ?? parsed.items ?? []
  })
}

function normalizeProjectUser(raw: any): FeishuProjectUser {
  return {
    name: String(raw.name_cn ?? raw.cn_name ?? raw.name ?? raw.name_en ?? raw.en_name ?? raw.email ?? raw.user_key ?? raw.key ?? ''),
    email: raw.email,
    userKey: raw.user_key ?? raw.userKey ?? raw.key,
    larkUserId: raw.lark_user_id ?? raw.larkUserId,
    openId: raw.open_id ?? raw.openId,
    raw,
  }
}

function normalizeFieldConfig(raw: any): FeishuProjectFieldConfig {
  return {
    key: String(raw.field_key ?? raw.key ?? ''),
    name: String(raw.field_name ?? raw.name ?? raw.label ?? ''),
    type: raw.field_type_key ?? raw.type_key ?? raw.type,
    raw,
  }
}

function safeJsonParse(text: string): any | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function collectMcpText(result: any): string {
  if (!Array.isArray(result?.content)) return JSON.stringify(result)
  return result.content.map((item: any) => item?.text ?? JSON.stringify(item)).join('\n')
}

function readMqlValue(field: any): unknown {
  const value = field?.value
  if (!value || typeof value !== 'object') return undefined
  if ('string_value' in value) return value.string_value
  if ('long_value' in value) return value.long_value
  if ('double_value' in value) return value.double_value
  if ('bool_value' in value) return value.bool_value
  if ('user_value' in value) return normalizeMqlUser(value.user_value)
  if ('user_value_list' in value) return value.user_value_list?.map(normalizeMqlUser)
  if ('key_label_value' in value) return value.key_label_value?.label ?? value.key_label_value?.key
  if ('key_label_value_list' in value) return value.key_label_value_list?.map((item: any) => item.label ?? item.key).join(', ')
  if ('datetime_value' in value) return value.datetime_value
  if ('date_value' in value) return value.date_value
  return undefined
}

function normalizeMqlUser(user: any): PersonRef | undefined {
  if (!user) return undefined
  return {
    name: user.name_cn ?? user.name_en ?? user.email ?? user.user_key,
    email: user.email,
    username: user.user_key,
    userKey: user.user_key,
    larkUserId: user.lark_user_id,
    openId: user.open_id,
  }
}

function normalizeProjectName(name: string | undefined): string {
  return String(name ?? '').replace(/[_\s]/g, '').toLowerCase()
}

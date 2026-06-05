import type { FeishuProjectFieldConfig } from './project-mcp.js'

export type LogicalFeishuProjectField = 'goal' | 'testPlan' | 'nextStep' | 'dueDate' | 'status'

export interface FieldMappingSuggestion {
  logicalField: LogicalFeishuProjectField
  envName: string
  key: string
  name: string
  type?: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export type FieldMappingSuggestions = Record<LogicalFeishuProjectField, FieldMappingSuggestion[]>

export interface FieldConfigDiscoveryClient {
  listFieldConfigs(input: {
    projectKey: string
    workItemType: string
    fieldQuery?: string
  }): Promise<FeishuProjectFieldConfig[]>
}

export async function discoverFieldConfigs(input: {
  client: FieldConfigDiscoveryClient
  projectKey: string
  workItemType: string
  fieldQuery?: string
}): Promise<FeishuProjectFieldConfig[]> {
  const queries = input.fieldQuery
    ? [input.fieldQuery]
    : [undefined, '目标', '测试', '下一步', '排期', '完成时间', '截止']
  const seen = new Set<string>()
  const fields: FeishuProjectFieldConfig[] = []
  for (const fieldQuery of queries) {
    const rows = await input.client.listFieldConfigs({
      projectKey: input.projectKey,
      workItemType: input.workItemType,
      fieldQuery,
    })
    for (const row of rows) {
      if (seen.has(row.key)) continue
      seen.add(row.key)
      fields.push(row)
    }
  }
  return fields
}

const ENV_NAMES: Record<LogicalFeishuProjectField, string> = {
  goal: 'PMO_FEISHU_FIELD_GOAL',
  testPlan: 'PMO_FEISHU_FIELD_TEST_PLAN',
  nextStep: 'PMO_FEISHU_FIELD_NEXT_STEP',
  dueDate: 'PMO_FEISHU_FIELD_DUE_DATE',
  status: 'PMO_FEISHU_FIELD_STATUS',
}

export function suggestFieldMappings(fields: FeishuProjectFieldConfig[]): FieldMappingSuggestions {
  return {
    goal: rank(fields, 'goal'),
    testPlan: rank(fields, 'testPlan'),
    nextStep: rank(fields, 'nextStep'),
    dueDate: rank(fields, 'dueDate'),
    status: rank(fields, 'status'),
  }
}

function rank(fields: FeishuProjectFieldConfig[], logicalField: LogicalFeishuProjectField): FieldMappingSuggestion[] {
  return fields
    .map(field => score(field, logicalField))
    .filter((item): item is FieldMappingSuggestion & { score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN'))
    .map(({ score: _score, ...item }) => item)
}

function score(field: FeishuProjectFieldConfig, logicalField: LogicalFeishuProjectField): (FieldMappingSuggestion & { score: number }) | undefined {
  const key = field.key.toLowerCase()
  const name = field.name.toLowerCase()
  const haystack = `${key} ${name}`
  const mk = (confidence: FieldMappingSuggestion['confidence'], reason: string, scoreValue: number) => ({
    logicalField,
    envName: ENV_NAMES[logicalField],
    key: field.key,
    name: field.name,
    type: field.type,
    confidence,
    reason,
    score: scoreValue,
  })

  if (logicalField === 'goal') {
    if (/(目标|成功标准|验收标准|goal|objective|success|acceptance)/i.test(haystack)) return mk('high', '字段名直接命中目标/成功标准/验收标准。', 100)
    if (field.key === 'description' || /^(描述|需求描述)$/.test(field.name)) return mk('medium', 'MAAS 当前可用描述字段承载目标，但需要人工确认是否混有背景信息。', 70)
  }
  if (logicalField === 'testPlan') {
    if (/(测试计划|测试方式|test.?plan|qa)/i.test(haystack)) return mk('high', '字段名直接命中测试计划/测试方式。', 100)
    if (/测试/i.test(haystack)) return mk('medium', '字段与测试相关，但不一定是完整测试计划。', 70)
  }
  if (logicalField === 'nextStep') {
    if (/(下一步|下步|next.?step|行动项|action.?item|todo|待办)/i.test(haystack)) return mk('high', '字段名直接命中下一步/行动项。', 100)
  }
  if (logicalField === 'dueDate') {
    if (/(计划完成时间|截止|截止时间|due|deadline|target.?date)/i.test(haystack)) return mk('high', '字段名直接命中计划完成时间/截止时间。', 100)
    if (/^(schedule|finish_time|end_time|schedule_end)$/i.test(field.key) || /(排期|完成日期|结束时间)/i.test(field.name)) return mk('medium', '字段与排期相关，可能需要拆分开始/结束时间。', 70)
  }
  if (logicalField === 'status') {
    if (field.key === 'work_item_status' || /^(需求状态|状态)$/.test(field.name)) return mk('high', '字段名直接命中需求状态；状态变更仍应优先使用 transition_node。', 100)
  }
  return undefined
}

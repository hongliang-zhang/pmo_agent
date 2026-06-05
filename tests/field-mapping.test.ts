import { describe, expect, it } from 'vitest'
import { discoverFieldConfigs, suggestFieldMappings } from '../src/feishu/field-mapping.js'

describe('Feishu Project field mapping suggestions', () => {
  it('maps known MAAS story fields to PMO logical fields with confidence', () => {
    const suggestions = suggestFieldMappings([
      { key: 'description', name: '描述', raw: {} },
      { key: 'field_7f3085', name: '测试方式', raw: {} },
      { key: 'field_810cee', name: '计划完成时间', raw: {} },
      { key: 'schedule', name: '排期', raw: {} },
      { key: 'work_item_status', name: '需求状态', raw: {} },
    ])

    expect(suggestions.goal[0]).toMatchObject({ key: 'description', name: '描述', confidence: 'medium' })
    expect(suggestions.testPlan[0]).toMatchObject({ key: 'field_7f3085', name: '测试方式', confidence: 'high' })
    expect(suggestions.dueDate[0]).toMatchObject({ key: 'field_810cee', name: '计划完成时间', confidence: 'high' })
    expect(suggestions.status[0]).toMatchObject({ key: 'work_item_status', name: '需求状态', confidence: 'high' })
    expect(suggestions.nextStep).toEqual([])
  })

  it('does not suggest misleading technical-spec, owner, or completion fields as writeback mappings', () => {
    const suggestions = suggestFieldMappings([
      { key: 'field_9afbaa', name: '技术规格说明书', raw: {} },
      { key: 'current_status_operator', name: '当前负责人', raw: {} },
      { key: 'finish_status', name: '是否完成', raw: {} },
      { key: 'work_item_status', name: '需求状态', raw: {} },
    ])

    expect(suggestions.goal).toEqual([])
    expect(suggestions.status).toEqual([
      expect.objectContaining({ key: 'work_item_status', name: '需求状态' }),
    ])
  })

  it('discovers default fields plus targeted query fields and deduplicates them', async () => {
    const calls: Array<string | undefined> = []
    const fields = await discoverFieldConfigs({
      projectKey: 'space',
      workItemType: 'story',
      client: {
        async listFieldConfigs(input) {
          calls.push(input.fieldQuery)
          if (input.fieldQuery === '测试') return [{ key: 'field_7f3085', name: '测试方式', raw: {} }]
          if (input.fieldQuery === '排期') return [{ key: 'schedule', name: '排期', raw: {} }]
          return [{ key: 'description', name: '描述', raw: {} }, { key: 'schedule', name: '排期', raw: {} }]
        },
      },
    })

    expect(calls).toContain(undefined)
    expect(calls).toContain('测试')
    expect(fields.map(field => field.key)).toEqual(['description', 'schedule', 'field_7f3085'])
  })
})

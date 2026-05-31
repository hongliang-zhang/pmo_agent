import { describe, expect, it, vi } from 'vitest'
import { FeishuProjectMcpClient, FeishuProjectSetupError, normalizeStoryFromMcp, normalizeStoryFromMql } from '../src/feishu/project-mcp.js'
describe('Feishu Project MCP adapter', () => {
  it('normalizes raw MCP fields into a Story', () => {
    const story = normalizeStoryFromMcp({
      id: 'story-1',
      name: '需求 ABC 支持 PMO 核查',
      status: { name: '开发中' },
      owners: [{ name: 'Alice', email: 'alice@example.com' }],
      creator: { name: 'PM' },
      priority: 'P1',
      start_time: '2026-05-30',
      end_time: '2026-06-03',
      updated_at: '2026-05-31T06:00:00Z',
      url: 'https://project.feishu.cn/story-1',
      fields: { 目标: '提升项目透明度', 测试计划: '回归测试' },
      documents: [{ title: '方案文档', url: 'https://example.com/doc' }],
    })

    expect(story.id).toBe('story-1')
    expect(story.title).toContain('PMO')
    expect(story.owners[0]?.name).toBe('Alice')
    expect(story.fields.goal).toBe('提升项目透明度')
    expect(story.linkedDocs[0]?.title).toBe('方案文档')
  })

  it('uses a setup error that explains OAuth/plugin requirements', () => {
    const err = new FeishuProjectSetupError('not connected')

    expect(err.message).toContain('https://project.feishu.cn/mcp_server/v1')
    expect(err.message).toContain('MAAS_平台')
  })

  it('normalizes Feishu Project MQL rows into a Story', () => {
    const story = normalizeStoryFromMql({
      moql_field_list: [
        { key: 'work_item_id', value: { long_value: 7001 } },
        { key: 'name', value: { string_value: '企业套餐购买' } },
        { key: 'work_item_status', value: { key_label_value_list: [{ key: 'doing', label: '开发阶段' }] } },
        { key: 'priority', value: { key_label_value: { key: '1', label: 'P1' } } },
        { key: 'owner', value: { user_value: { name_cn: '张三', email: 'zhangsan@example.com' } } },
        { key: 'current_status_operator', value: { user_value_list: [{ name_cn: '李四' }] } },
        { key: 'wiki', value: { string_value: 'https://example.com/wiki' } },
      ],
    }, '7358164361912909827_1719375156')

    expect(story.id).toBe('7001')
    expect(story.title).toBe('企业套餐购买')
    expect(story.status).toBe('开发阶段')
    expect(story.owners[0]?.name).toBe('李四')
    expect(story.creator?.name).toBe('张三')
    expect(story.linkedDocs[0]?.url).toBe('https://example.com/wiki')
  })

  it('sends configured HTTP headers to the MCP endpoint', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.params?.name === 'search_project_info') {
        return jsonResponse({
          result: {
            content: [{ type: 'text', text: JSON.stringify({ projects: [{ project_key: 'project-key', name: 'MAAS平台', simple_name: 'space-simple' }] }) }],
          },
        })
      }
      return jsonResponse({
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              data: {
                1: [{ moql_field_list: [{ key: 'work_item_id', value: { long_value: 1 } }, { key: 'name', value: { string_value: '需求一' } }] }],
              },
            }),
          }],
        },
      })
    })
    const client = new FeishuProjectMcpClient({
      mcpUrl: 'https://project.feishu.cn/mcp_server/v1',
      headers: { Authorization: 'Bearer project-token', 'X-Custom': 'value' },
      fetch: fetch as unknown as typeof globalThis.fetch,
    })

    await client.listStories('MAAS_平台')

    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer project-token',
      'X-Custom': 'value',
    })
  })
})

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

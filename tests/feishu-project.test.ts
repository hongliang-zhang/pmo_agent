import { describe, expect, it } from 'vitest'
import { FeishuProjectSetupError, normalizeStoryFromMcp } from '../src/feishu/project-mcp.js'

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
})

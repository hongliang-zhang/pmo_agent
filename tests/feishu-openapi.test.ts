import { describe, expect, it, vi } from 'vitest'
import { FeishuOpenApiClient } from '../src/feishu/openapi.js'

describe('Feishu OpenAPI client', () => {
  it('uses Contacts API to map emails to open_id', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'tenant-token' })
      }
      expect(String(url)).toContain('/contact/v3/users/batch_get_id?user_id_type=open_id')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer tenant-token' })
      expect(JSON.parse(String(init?.body))).toMatchObject({ emails: ['user@aminer.cn'], include_resigned: true })
      return jsonResponse({ code: 0, data: { user_list: [{ email: 'user@aminer.cn', open_id: 'ou_hl', user_id: '7526' }] } })
    })

    const client = new FeishuOpenApiClient({ appId: 'app', appSecret: 'secret', fetch: fetch as unknown as typeof globalThis.fetch })
    const users = await client.batchGetUserIdsByEmail(['user@aminer.cn'])

    expect(users).toEqual([expect.objectContaining({ email: 'user@aminer.cn', openId: 'ou_hl', userId: '7526' })])
  })

  it('sends text messages through IM API with explicit receive id type', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain('/im/v1/messages?receive_id_type=open_id')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer tenant-token' })
      expect(JSON.parse(String(init?.body))).toMatchObject({ receive_id: 'ou_hl', msg_type: 'text' })
      return jsonResponse({ code: 0, data: { message_id: 'om_1' } })
    })

    const client = new FeishuOpenApiClient({ tenantAccessToken: 'tenant-token', fetch: fetch as unknown as typeof globalThis.fetch })
    await expect(client.sendTextMessage({ receiveIdType: 'open_id', receiveId: 'ou_hl', text: '日报已生成' })).resolves.toMatchObject({ data: { message_id: 'om_1' } })
  })

  it('creates a docx document and appends markdown tables as native table blocks', async () => {
    const calls: Array<{ url: string; body: any }> = []
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (String(url).includes('/docx/v1/documents') && !String(url).includes('/blocks/')) {
        expect(init?.method).toBe('POST')
        return jsonResponse({ code: 0, data: { document: { document_id: 'docx_1', revision_id: 7, url: 'https://zhipu-ai.feishu.cn/docx/docx_1' } } })
      }
      expect(String(url)).toMatch(/\/docx\/v1\/documents\/docx_1\/blocks\/docx_1\/(?:children|descendant)\?document_revision_id=7/)
      expect(init?.method).toBe('POST')
      return jsonResponse({ code: 0, data: { children: [] } })
    })

    const client = new FeishuOpenApiClient({ tenantAccessToken: 'tenant-token', fetch: fetch as unknown as typeof globalThis.fetch })
    const result = await client.createDocxDocumentFromMarkdown({
      title: 'MAAS_平台 PMO 状态核查日报 2026-06-02',
      markdown: [
        '# 标题',
        '',
        '| 需求 | 风险 | 建议 |',
        '|---|---|---|',
        '| 企业套餐购买 | missing_goal | 补目标 |',
        '',
        '## 风险',
        '- 缺测试计划',
      ].join('\n'),
    })

    expect(result).toMatchObject({ documentId: 'docx_1', url: 'https://zhipu-ai.feishu.cn/docx/docx_1' })
    expect(calls[0]?.body).toMatchObject({ title: 'MAAS_平台 PMO 状态核查日报 2026-06-02' })
    expect(calls[1]?.body.children).toEqual([
      textBlock('# 标题'),
    ])
    expect(calls[2]?.url).toContain('/descendant?document_revision_id=7')
    expect(calls[2]?.body).toMatchObject({
      index: -1,
      children_id: [expect.stringMatching(/^pmo_table_/) ],
    })
    expect(calls[2]?.body.descendants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        block_type: 31,
        table: { property: { row_size: 2, column_size: 3 } },
      }),
      expect.objectContaining({
        block_type: 32,
        table_cell: {},
      }),
      expect.objectContaining({
        block_type: 2,
        text: {
          elements: [expect.objectContaining({ text_run: expect.objectContaining({ content: '需求' }) })],
          style: {},
        },
      }),
      expect.objectContaining({
        block_type: 2,
        text: {
          elements: [expect.objectContaining({ text_run: expect.objectContaining({ content: '企业套餐购买' }) })],
          style: {},
        },
      }),
    ]))
    expect(calls[3]?.body.children).toEqual([
      textBlock('## 风险'),
      textBlock('- 缺测试计划'),
    ])
    expect(JSON.stringify(calls)).not.toContain('tenant-token')
  })

  it('splits large markdown tables into multiple native table requests', async () => {
    const calls: Array<{ url: string; body: any }> = []
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (String(url).includes('/docx/v1/documents') && !String(url).includes('/blocks/')) {
        return jsonResponse({ code: 0, data: { document: { document_id: 'docx_1', revision_id: 7 } } })
      }
      return jsonResponse({ code: 0, data: { children: [] } })
    })
    const rows = Array.from({ length: 85 }, (_, index) => `| S${index} | high | owner |`)
    const markdown = [
      '| 需求 | 风险 | 找谁 |',
      '|---|---|---|',
      ...rows,
    ].join('\n')

    const client = new FeishuOpenApiClient({ tenantAccessToken: 'tenant-token', fetch: fetch as unknown as typeof globalThis.fetch })
    await client.createDocxDocumentFromMarkdown({ title: 'Large Table', markdown })

    const tableCalls = calls.filter(call => call.url.includes('/descendant'))
    expect(tableCalls).toHaveLength(3)
    expect(tableCalls.map(call => call.body.descendants.find((block: any) => block.block_type === 31).table.property.row_size)).toEqual([40, 40, 8])
    expect(tableCalls.every(call => call.body.descendants.length < 600)).toBe(true)
  })
})

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
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

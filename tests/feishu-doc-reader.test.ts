import { describe, expect, it } from 'vitest'
import { extractFeishuDocToken, createFixtureFeishuDocReader } from '../src/feishu/doc-reader.js'

describe('Feishu document context reader', () => {
  it('extracts doc tokens from Feishu document URLs', () => {
    expect(extractFeishuDocToken('https://zhipu-ai.feishu.cn/docx/Tz1Pdg8c6oXLO1x14H4cgQWqnOd')).toBe('Tz1Pdg8c6oXLO1x14H4cgQWqnOd')
    expect(extractFeishuDocToken('https://zhipu-ai.feishu.cn/docs/doccnABC123456789?from=from_copylink')).toBe('doccnABC123456789')
  })

  it('reads fixture documents by linked document URL', async () => {
    const reader = createFixtureFeishuDocReader({
      'https://zhipu-ai.feishu.cn/docx/docxS1': {
        title: '企业套餐购买方案',
        content: '目标：支持企业客户自助购买套餐。',
      },
    })

    await expect(reader.read({ title: '方案', url: 'https://zhipu-ai.feishu.cn/docx/docxS1' })).resolves.toMatchObject({
      title: '企业套餐购买方案',
      content: '目标：支持企业客户自助购买套餐。',
    })
  })
})

import { describe, expect, it } from 'vitest'
import { buildAuditReport } from '../src/audit.js'
import { enrichStoryContexts } from '../src/context/enrichment.js'
import type { Story } from '../src/domain.js'

describe('context enrichment', () => {
  it('extracts candidate completions from linked Feishu document content without mutating project fields', async () => {
    const stories: Story[] = [{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [{ title: '企业套餐购买方案', url: 'https://zhipu-ai.feishu.cn/docx/docxS1' }],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/S1',
    }]

    const contexts = await enrichStoryContexts({
      stories,
      reader: {
        async read(doc) {
          return {
            title: doc.title,
            url: doc.url,
            content: [
              '目标：支持企业客户自助购买套餐并完成开票。',
              '验收标准：企业管理员可以完成下单、支付、开票三步。',
              '测试计划：覆盖套餐购买、退款、发票回归测试。',
              '下一步：5月31日前完成联调，6月3日提测。',
            ].join('\n'),
          }
        },
      },
    })

    expect(stories[0].fields.goal).toBeUndefined()
    expect(contexts[0]).toMatchObject({
      storyId: 'S1',
      summary: expect.stringContaining('企业客户自助购买套餐'),
    })
    expect(contexts[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'goal', value: '支持企业客户自助购买套餐并完成开票。', sourceUrl: 'https://zhipu-ai.feishu.cn/docx/docxS1' }),
      expect.objectContaining({ field: 'acceptanceCriteria', value: '企业管理员可以完成下单、支付、开票三步。' }),
      expect.objectContaining({ field: 'testPlan', value: '覆盖套餐购买、退款、发票回归测试。' }),
      expect.objectContaining({ field: 'nextStep', value: '5月31日前完成联调，6月3日提测。' }),
    ]))
    expect(contexts[0].evidence[0]).toMatchObject({
      type: 'feishu_doc',
      title: '企业套餐购买方案',
      confidence: 'likely',
    })
  })

  it('attaches context candidates to audit, state snapshot, and communication plan', async () => {
    const story: Story = {
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [{ title: '企业套餐购买方案', url: 'https://zhipu-ai.feishu.cn/docx/docxS1' }],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/S1',
    }
    const contexts = await enrichStoryContexts({
      stories: [story],
      reader: {
        async read(doc) {
          return {
            title: doc.title,
            url: doc.url,
            content: '目标：支持企业客户自助购买套餐。\n测试计划：购买和退款回归测试。\n下一步：确认验收标准。',
          }
        },
      },
    })

    const report = buildAuditReport({
      date: '2026-05-31',
      stories: [story],
      evidence: [],
      storyContexts: contexts,
      now: new Date('2026-05-31T12:00:00+08:00'),
    })

    const audit = report.storyAudits?.[0]
    expect(audit?.context?.candidates.map(candidate => candidate.field)).toEqual(expect.arrayContaining(['goal', 'testPlan', 'nextStep']))
    expect(audit?.evidence.map(item => item.type)).toContain('feishu_doc')
    expect(audit?.risks.find(risk => risk.type === 'missing_goal')?.suggestedAction).toContain('关联文档已有候选')
    expect(report.stateSnapshot).toBeUndefined()
  })

  it('skips unreadable linked documents without dropping readable context for the same story', async () => {
    const story: Story = {
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [
        { title: '知识库方案', url: 'https://zhipu-ai.feishu.cn/wiki/GA6qwGyoWikCPlkoQJzc5LSFnKe' },
        { title: '需求方案', url: 'https://zhipu-ai.feishu.cn/docx/docxS1' },
      ],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/S1',
    }

    const contexts = await enrichStoryContexts({
      stories: [story],
      reader: {
        async read(doc) {
          if (doc.url.includes('/wiki/')) throw new Error(`Cannot extract Feishu document token from ${doc.url}`)
          return {
            title: doc.title,
            url: doc.url,
            content: '目标：支持企业客户自助购买套餐。',
          }
        },
      },
    })

    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({
      storyId: 'S1',
      summary: expect.stringContaining('企业客户自助购买套餐'),
    })
    expect(contexts[0].evidence).toHaveLength(1)
    expect(contexts[0].evidence[0]).toMatchObject({
      title: '需求方案',
      url: 'https://zhipu-ai.feishu.cn/docx/docxS1',
    })
  })
})

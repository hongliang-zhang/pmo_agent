import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRunRecord, listRunRecords, retryRunStage, runDailyAgentCycle } from '../src/server/runs.js'

describe('PMO agent run cycle', () => {
  it('records report and communication draft stages in one resumable run record', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-cycle-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]), 'utf8')

    const run = await runDailyAgentCycle({
      date: '2026-05-31',
      reportsDir,
      maxProjects: 0,
      storiesFixture,
      buildPersonDirectory: false,
      createCommunicationDrafts: true,
    })

    expect(run.status).toBe('success')
    expect(run.stages).toBeDefined()
    const stages = run.stages!
    expect(stages.map(stage => stage.name)).toEqual(['render_report', 'create_communication_drafts'])
    expect(stages.find(stage => stage.name === 'render_report')).toMatchObject({ status: 'success' })
    expect(stages.find(stage => stage.name === 'create_communication_drafts')).toMatchObject({ status: 'success' })
    expect(run.artifacts).toMatchObject({
      reportJsonPath: expect.stringContaining('2026-05-31-pmo-audit.json'),
      communicationDraftsPath: expect.stringContaining('communication-drafts.json'),
      opsDashboardHtmlPath: expect.stringContaining('ops-dashboard.html'),
      opsDashboardJsonPath: expect.stringContaining('ops-dashboard.json'),
    })
    expect(run.summary).toMatchObject({ draftsCreated: expect.any(Number) })
    expect((run.summary as any).draftsCreated).toBeGreaterThan(0)

    const drafts = JSON.parse(await readFile(join(reportsDir, 'communication-drafts.json'), 'utf8')) as any[]
    expect(drafts[0]).toMatchObject({ status: 'pending_approval', channel: 'feishu_im' })
    await expect(readFile(join(reportsDir, 'ops-dashboard.html'), 'utf8')).resolves.toContain('PMO Agent Ops')

    const records = await listRunRecords(reportsDir)
    expect(records[0]).toMatchObject({
      id: run.id,
      status: 'success',
      stages: [{ name: 'render_report', status: 'success' }, { name: 'create_communication_drafts', status: 'success' }],
    })
    expect(JSON.stringify(records[0])).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)

  it('automatically applies Feishu person directory mapping to communication drafts when available', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-person-directory-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉', email: 'wjh@example.com' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]), 'utf8')

    const run = await runDailyAgentCycle({
      date: '2026-05-31',
      reportsDir,
      maxProjects: 0,
      storiesFixture,
      createCommunicationDrafts: true,
      personDirectoryBuilder: async stories => {
        expect(stories[0]).toMatchObject({ id: 'S1', title: '企业套餐购买' })
        return { 王建辉: { openId: 'ou_wjh', email: 'wjh@example.com' } }
      },
    })

    expect(run.stages?.find(stage => stage.name === 'build_person_directory')).toMatchObject({
      status: 'success',
      summary: { people: 1, mappedForDelivery: 1 },
    })
    const drafts = JSON.parse(await readFile(join(reportsDir, 'communication-drafts.json'), 'utf8')) as any[]
    expect(drafts[0]).toMatchObject({
      recipient: '王建辉',
      recipientIdentity: { openId: 'ou_wjh', email: 'wjh@example.com' },
    })
  }, 30_000)

  it('can run context enrichment as a tracked agent-cycle stage before drafting questions', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-context-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    const docsFixture = join(reportsDir, 'docs.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [{ title: '企业套餐购买方案', url: 'https://zhipu-ai.feishu.cn/docx/docxS1' }],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]), 'utf8')
    await writeFile(docsFixture, JSON.stringify({
      'https://zhipu-ai.feishu.cn/docx/docxS1': {
        title: '企业套餐购买方案',
        content: '目标：支持企业客户自助购买套餐。\n测试计划：购买和退款回归测试。\n下一步：确认验收标准。',
      },
    }), 'utf8')

    const run = await runDailyAgentCycle({
      date: '2026-05-31',
      reportsDir,
      maxProjects: 0,
      storiesFixture,
      docsFixture,
      enrichContext: true,
      createCommunicationDrafts: true,
    })

    expect(run.status).toBe('success')
    expect(run.stages?.map(stage => stage.name)).toEqual(['render_report', 'enrich_context', 'build_person_directory', 'create_communication_drafts'])
    expect(run.stages?.find(stage => stage.name === 'enrich_context')).toMatchObject({
      status: 'success',
      summary: { storiesWithContext: 1 },
    })

    const report = JSON.parse(await readFile(join(reportsDir, '2026-05-31-pmo-audit.json'), 'utf8')) as any
    expect(report.storyAudits[0].context.candidates.map((candidate: any) => candidate.field)).toEqual(expect.arrayContaining(['goal', 'testPlan', 'nextStep']))
    expect(report.stateSnapshot.stories[0].candidateCompletions).toHaveLength(3)

    const drafts = JSON.parse(await readFile(join(reportsDir, 'communication-drafts.json'), 'utf8')) as any[]
    expect(drafts[0].message).toContain('关联文档候选')
    expect(drafts[0].message).toContain('支持企业客户自助购买套餐')
  }, 30_000)

  it('looks up a run by id and retries communication draft creation without rerendering the report', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-retry-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]), 'utf8')

    const run = await runDailyAgentCycle({
      date: '2026-05-31',
      reportsDir,
      maxProjects: 0,
      storiesFixture,
      createCommunicationDrafts: false,
    })
    expect(run.stages?.find(stage => stage.name === 'create_communication_drafts')).toMatchObject({ status: 'skipped' })

    const found = await getRunRecord(reportsDir, run.id)
    expect(found).toMatchObject({ id: run.id, date: '2026-05-31' })

    const retried = await retryRunStage({
      reportsDir,
      runId: run.id,
      stage: 'create_communication_drafts',
    })

    expect(retried.status).toBe('success')
    expect(retried.stages?.find(stage => stage.name === 'create_communication_drafts')).toMatchObject({
      status: 'success',
      summary: { draftsCreated: expect.any(Number) },
    })
    expect(retried.artifacts).toMatchObject({
      opsDashboardHtmlPath: expect.stringContaining('ops-dashboard.html'),
      opsDashboardJsonPath: expect.stringContaining('ops-dashboard.json'),
    })
    expect((retried.summary as any).draftsCreated).toBeGreaterThan(0)

    const records = await listRunRecords(reportsDir)
    expect(records).toHaveLength(1)
    expect(records[0]?.id).toBe(run.id)
    expect(records[0]?.stages?.find(stage => stage.name === 'render_report')).toMatchObject({ status: 'success' })
  }, 30_000)

  it('can create a Feishu document as an optional run stage from the generated markdown', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-feishu-doc-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]), 'utf8')

    const run = await runDailyAgentCycle({
      date: '2026-05-31',
      reportsDir,
      maxProjects: 0,
      storiesFixture,
      createCommunicationDrafts: false,
      createFeishuDoc: true,
      feishuDocOutput: {
        async createDocument(markdown: string) {
          expect(markdown).toContain('MAAS_平台 PMO 状态核查日报 2026-05-31')
          return { url: 'https://zhipu-ai.feishu.cn/docx/docx123', documentId: 'docx123', raw: { ok: true } }
        },
      },
    })

    expect(run.status).toBe('success')
    expect(run.stages?.find(stage => stage.name === 'create_feishu_doc')).toMatchObject({
      status: 'success',
      artifacts: { feishuDocUrl: 'https://zhipu-ai.feishu.cn/docx/docx123', feishuDocumentId: 'docx123' },
    })
    expect(run.artifacts).toMatchObject({
      feishuDocUrl: 'https://zhipu-ai.feishu.cn/docx/docx123',
      feishuDocumentId: 'docx123',
    })
  }, 30_000)

  it('creates an approved-before-send daily report DM draft for the configured recipient', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-report-dm-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]), 'utf8')

    const run = await runDailyAgentCycle({
      date: '2026-05-31',
      reportsDir,
      maxProjects: 0,
      storiesFixture,
      createCommunicationDrafts: false,
      createFeishuDoc: true,
      createReportDeliveryDraft: true,
      reportRecipient: {
        name: '张鸿亮',
        identity: { userId: 'test-user-id' },
      },
      feishuDocOutput: {
        async createDocument() {
          return { url: 'https://zhipu-ai.feishu.cn/docx/docx123', documentId: 'docx123', raw: { ok: true } }
        },
      },
    })

    expect(run.status).toBe('success')
    expect(run.stages?.map(stage => stage.name)).toEqual(['render_report', 'build_person_directory', 'create_communication_drafts', 'create_feishu_doc', 'create_report_delivery_draft'])
    expect(run.stages?.find(stage => stage.name === 'create_report_delivery_draft')).toMatchObject({
      status: 'success',
      summary: { draftsCreated: 1, recipient: '张鸿亮' },
    })
    const drafts = JSON.parse(await readFile(join(reportsDir, 'communication-drafts.json'), 'utf8')) as any[]
    expect(drafts[0]).toMatchObject({
      status: 'pending_approval',
      channel: 'feishu_im',
      recipient: '张鸿亮',
      recipientIdentity: { userId: 'test-user-id' },
      reason: 'daily_report_delivery',
    })
    expect(drafts[0].message).toContain('飞书文档：https://zhipu-ai.feishu.cn/docx/docx123')
    expect(drafts[0].message).toContain('当前仅生成日报单聊草稿，未自动发送')
  }, 30_000)

  it('can run model analysis as an optional tracked stage', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-model-analysis-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]), 'utf8')

    const run = await runDailyAgentCycle({
      date: '2026-05-31',
      reportsDir,
      maxProjects: 0,
      storiesFixture,
      createCommunicationDrafts: false,
      analyzeWithModels: true,
      modelAnalyzer: {
        async analyze(report: any) {
          expect(report.title).toContain('MAAS_平台 PMO 状态核查日报')
          return {
            dailySummary: '企业套餐购买有进展。',
            riskAssessment: '测试计划缺失，需要 owner 补充。',
          }
        },
      },
    })

    expect(run.status).toBe('success')
    expect(run.stages?.map(stage => stage.name)).toEqual(['render_report', 'analyze_with_models', 'build_person_directory', 'create_communication_drafts'])
    expect(run.stages?.find(stage => stage.name === 'analyze_with_models')).toMatchObject({
      status: 'success',
      artifacts: { modelAnalysisPath: expect.stringContaining('2026-05-31-pmo-model-analysis.json') },
    })
    expect(run.artifacts).toMatchObject({
      modelAnalysisPath: expect.stringContaining('2026-05-31-pmo-model-analysis.json'),
    })
    const analysis = JSON.parse(await readFile(join(reportsDir, '2026-05-31-pmo-model-analysis.json'), 'utf8')) as any
    expect(analysis.daily.summary).toBe('企业套餐购买有进展。')
    expect(analysis.risk.assessment).toBe('测试计划缺失，需要 owner 补充。')
  }, 30_000)
})

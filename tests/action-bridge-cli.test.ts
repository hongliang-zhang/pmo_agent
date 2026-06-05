import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('pmo action bridge CLI', () => {
  it('executes pmo_build_state_snapshot as a structured JSON action', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-action-bridge-'))
    const reportPath = join(dir, 'report.json')
    await writeFile(reportPath, JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 0, risky: 0, incomplete: 0, suggestedContacts: 0 },
      storyAudits: [{
        story: { id: 'S1', title: '企业套餐购买', status: '开发阶段', owners: [{ name: '王建辉' }], linkedDocs: [], fields: { goal: '完成企业套餐购买闭环' } },
        evidence: [],
        risks: [],
        confidence: 'unknown',
        progressSummary: '未找到今日交付证据，需结合飞书项目状态判断。',
      }],
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
    }))

    const { stdout } = await execFileAsync('pnpm', [
      'tsx',
      'src/cli/action-bridge.ts',
      '--',
      '--action',
      'pmo_build_state_snapshot',
      '--input-json',
      JSON.stringify({ factsPath: reportPath }),
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    expect(result.success).toBe(true)
    expect(result.action).toBe('pmo_build_state_snapshot')
    expect(result.result.summary.stories).toBe(1)
    expect(result.result.workstreams[0].name).toBe('商业化')
    expect(stdout).not.toMatch(/token|secret|password|api[_-]?key/i)
  })

  it('executes pmo_enrich_context with linked document fixtures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-action-context-'))
    const storiesPath = join(dir, 'stories.json')
    const docsPath = join(dir, 'docs.json')
    await writeFile(storiesPath, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [{ title: '企业套餐购买方案', url: 'https://zhipu-ai.feishu.cn/docx/docxS1' }],
      fields: {},
    }]))
    await writeFile(docsPath, JSON.stringify({
      'https://zhipu-ai.feishu.cn/docx/docxS1': {
        title: '企业套餐购买方案',
        content: '目标：支持企业客户自助购买套餐。',
      },
    }))

    const { stdout } = await execFileAsync('pnpm', [
      'tsx',
      'src/cli/action-bridge.ts',
      '--',
      '--action',
      'pmo_enrich_context',
      '--input-json',
      JSON.stringify({ date: '2026-05-31', maxProjects: 0, storiesFixture: storiesPath, docsFixture: docsPath }),
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    expect(result.success).toBe(true)
    expect(result.action).toBe('pmo_enrich_context')
    expect(result.result.storyContexts[0].candidates[0]).toMatchObject({
      field: 'goal',
      value: '支持企业客户自助购买套餐。',
    })
    expect(stdout).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)

  it('executes pmo_run_agent_cycle and creates a pending report delivery draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-action-run-cycle-'))
    const storiesPath = join(dir, 'stories.json')
    await writeFile(storiesPath, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
    }]))

    const { stdout } = await execFileAsync('pnpm', [
      'tsx',
      'src/cli/action-bridge.ts',
      '--',
      '--action',
      'pmo_run_agent_cycle',
      '--input-json',
      JSON.stringify({
        date: '2026-06-02',
        reportsDir: dir,
        maxProjects: 0,
        storiesFixture: storiesPath,
        buildPersonDirectory: false,
        createCommunicationDrafts: false,
        createReportDeliveryDraft: true,
        reportRecipient: {
          name: '张鸿亮',
          identity: { userId: 'test-user-id' },
          channel: 'feishu_im',
        },
      }),
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    expect(result.success).toBe(true)
    expect(result.action).toBe('pmo_run_agent_cycle')
    expect(result.result.summary.reportDeliveryDraftsCreated).toBe(1)
    expect(result.result.stages).toContainEqual(expect.objectContaining({ name: 'create_report_delivery_draft', status: 'success' }))
    expect(stdout).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)
})

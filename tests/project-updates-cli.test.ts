import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { recordCheckInReply } from '../src/server/checkins.js'
import { listProjectUpdateActions } from '../src/server/project-updates.js'

const execFileAsync = promisify(execFile)

describe('project update actions CLI', () => {
  it('lists, shows, approves, and dry-run previews a project writeback action', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-project-updates-cli-'))
    await recordCheckInReply({
      reportsDir,
      storyId: '7005303241',
      responder: '张鸿亮',
      text: '目标：明确验收口径\n测试计划：补接口回归\n下一步：补文档\nETA：2026-06-05\n需要更新飞书项目',
      now: new Date('2026-06-02T04:00:00Z'),
    })
    const [action] = await listProjectUpdateActions(reportsDir)

    const listed = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/project-updates.ts',
      '--',
      'list',
      '--reportsDir',
      reportsDir,
    ], { cwd: process.cwd() })).stdout)
    expect(listed).toMatchObject({
      success: true,
      actions: [{ id: action.id, status: 'pending_approval', storyId: '7005303241' }],
    })

    const shown = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/project-updates.ts',
      '--',
      'show',
      '--reportsDir',
      reportsDir,
      '--actionId',
      action.id,
      '--actor',
      '张鸿亮',
    ], { cwd: process.cwd() })).stdout)
    expect(shown).toMatchObject({
      success: true,
      action: {
        id: action.id,
        status: 'pending_approval',
        proposedFields: {
          goal: '明确验收口径',
          testPlan: '补接口回归',
          nextStep: '补文档',
          dueDate: '2026-06-05',
        },
      },
      nextCommands: {
        approve: expect.stringContaining('pmo:project-updates -- approve'),
        applyDryRun: expect.stringContaining('pmo:project-updates -- apply'),
      },
    })
    expect(JSON.stringify(shown)).not.toMatch(/token|secret|password|api[_-]?key/i)

    const approved = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/project-updates.ts',
      '--',
      'approve',
      '--reportsDir',
      reportsDir,
      '--actionId',
      action.id,
      '--actor',
      '张鸿亮',
      '--note',
      '同意写回',
    ], { cwd: process.cwd() })).stdout)
    expect(approved).toMatchObject({ success: true, action: { id: action.id, status: 'approved' } })

    const preview = JSON.parse((await execFileAsync('pnpm', [
      'tsx',
      'src/cli/project-updates.ts',
      '--',
      'apply',
      '--reportsDir',
      reportsDir,
      '--actionId',
      action.id,
      '--actor',
      '张鸿亮',
      '--dryRun',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PMO_FEISHU_FIELD_GOAL: 'description',
        PMO_FEISHU_FIELD_TEST_PLAN: 'field_7f3085',
        PMO_FEISHU_FIELD_DUE_DATE: 'field_810cee',
        PMO_FEISHU_FIELD_STATUS: 'work_item_status',
        PMO_FEISHU_FIELD_NEXT_STEP: '',
      },
    })).stdout)
    expect(preview).toMatchObject({
      success: true,
      mode: 'dry_run',
      action: { id: action.id, status: 'approved' },
      appliedFields: [
        { logicalField: 'goal', fieldKey: 'description', value: '明确验收口径' },
        { logicalField: 'testPlan', fieldKey: 'field_7f3085', value: '补接口回归' },
        { logicalField: 'dueDate', fieldKey: 'field_810cee', value: '2026-06-05' },
      ],
      commentFallbackFields: [
        { logicalField: 'nextStep', label: '下一步', value: '补文档' },
      ],
    })
    expect(JSON.stringify(preview)).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)
})

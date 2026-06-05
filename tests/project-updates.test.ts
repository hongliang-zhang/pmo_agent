import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recordCheckInReply } from '../src/server/checkins.js'
import { applyProjectUpdateAction, approveProjectUpdateAction, listProjectUpdateActions, rejectProjectUpdateAction } from '../src/server/project-updates.js'

describe('project update actions', () => {
  it('approves, rejects, and applies Feishu Project writeback actions only after approval', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-project-updates-'))
    const checkIn = await recordCheckInReply({
      reportsDir,
      storyId: '7005303241',
      responder: '张鸿亮',
      text: '状态：active\n目标：需求评审通过并完成验收口径\n测试计划：补齐接口、回归、灰度验证\n下一步：补齐测试计划\nETA：2026-06-05\n需要更新飞书项目',
      now: new Date('2026-06-02T03:00:00Z'),
    })
    const [action] = await listProjectUpdateActions(reportsDir)
    expect(action).toMatchObject({ status: 'pending_approval', sourceCheckInId: checkIn.id })

    const rejected = await rejectProjectUpdateAction({ reportsDir, actionId: action.id, actor: 'PMO Owner', note: '先不写' })
    expect(rejected).toMatchObject({ status: 'rejected', rejectedBy: 'PMO Owner' })

    const approved = await approveProjectUpdateAction({ reportsDir, actionId: action.id, actor: 'PMO Owner', note: '允许写回' })
    expect(approved).toMatchObject({ status: 'approved', approvedBy: 'PMO Owner' })

    const calls: any[] = []
    const result = await applyProjectUpdateAction({
      reportsDir,
      actionId: action.id,
      actor: 'PMO Owner',
      projectKey: 'space',
      mapping: { goal: 'field_goal', testPlan: 'field_test_plan', nextStep: 'field_next_step', dueDate: 'field_due_date' },
      client: {
        updateFields: async input => {
          calls.push(['updateFields', input])
          return { ok: true }
        },
        addComment: async input => {
          calls.push(['addComment', input])
          return { ok: true }
        },
      },
    })

    expect(result).toMatchObject({ success: true, action: { status: 'applied' } })
    expect(result.appliedFields).toEqual([
      { logicalField: 'goal', fieldKey: 'field_goal', value: '需求评审通过并完成验收口径' },
      { logicalField: 'testPlan', fieldKey: 'field_test_plan', value: '补齐接口、回归、灰度验证' },
      { logicalField: 'nextStep', fieldKey: 'field_next_step', value: '补齐测试计划' },
      { logicalField: 'dueDate', fieldKey: 'field_due_date', value: '2026-06-05' },
    ])
    expect(calls[0]).toMatchObject(['updateFields', { projectKey: 'space', workItemId: '7005303241' }])
    expect(calls[1]).toMatchObject(['addComment', { projectKey: 'space', workItemId: '7005303241' }])
  })

  it('falls back to an approved comment when only nextStep has no configured field mapping', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-project-updates-mapping-'))
    await recordCheckInReply({
      reportsDir,
      storyId: 'S1',
      responder: '张鸿亮',
      text: '下一步：补文档\n需要更新飞书项目',
    })
    const [action] = await listProjectUpdateActions(reportsDir)
    await approveProjectUpdateAction({ reportsDir, actionId: action.id, actor: 'PMO Owner' })

    const calls: any[] = []
    const result = await applyProjectUpdateAction({
      reportsDir,
      actionId: action.id,
      actor: 'PMO Owner',
      projectKey: 'space',
      mapping: {},
      client: {
        updateFields: async input => {
          calls.push(['updateFields', input])
          return {}
        },
        addComment: async input => {
          calls.push(['addComment', input])
          return {}
        },
      },
    })

    expect(result).toMatchObject({ success: true, action: { status: 'applied' } })
    expect(result.appliedFields).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject(['addComment', {
      workItemId: 'S1',
      content: expect.stringContaining('下一步（评论 fallback）：补文档'),
    }])
  })
})

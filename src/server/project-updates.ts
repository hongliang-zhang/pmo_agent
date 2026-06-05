import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig, loadEnvFiles } from '../config.js'
import { FeishuProjectMcpClient } from '../feishu/project-mcp.js'
import type { ProjectUpdateAction } from './checkins.js'

export interface ProjectUpdateFieldMapping {
  goal?: string
  testPlan?: string
  nextStep?: string
  dueDate?: string
  status?: string
}

export interface ProjectUpdateApplyResult {
  success: true
  action: ProjectUpdateAction
  appliedFields: Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; fieldKey: string; value: string }>
  raw: unknown
}

export interface ProjectUpdatePreviewResult {
  success: true
  mode: 'dry_run'
  action: ProjectUpdateAction
  appliedFields: Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; fieldKey: string; value: string }>
  commentFallbackFields: Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; label: string; value: string; reason: string }>
}

export async function approveProjectUpdateAction(input: {
  reportsDir: string
  actionId: string
  actor: string
  note?: string
  now?: Date
}): Promise<ProjectUpdateAction> {
  return updateActionState({ ...input, status: 'approved' })
}

export async function rejectProjectUpdateAction(input: {
  reportsDir: string
  actionId: string
  actor: string
  note?: string
  now?: Date
}): Promise<ProjectUpdateAction> {
  return updateActionState({ ...input, status: 'rejected' })
}

export async function applyProjectUpdateAction(input: {
  reportsDir: string
  actionId: string
  actor: string
  mapping?: ProjectUpdateFieldMapping
  client?: Pick<FeishuProjectMcpClient, 'addComment' | 'updateFields'>
  projectKey?: string
  now?: Date
}): Promise<ProjectUpdateApplyResult> {
  const records = await listProjectUpdateActions(input.reportsDir)
  const index = records.findIndex(action => action.id === input.actionId)
  if (index < 0) throw new Error(`Project update action not found: ${input.actionId}`)
  const action = records[index]!
  if (action.status !== 'approved') throw new Error(`Project update action must be approved before apply. Current status: ${action.status}`)

  await loadEnvFiles()
  const mapping = input.mapping ?? projectUpdateFieldMappingFromEnv()
  const { appliedFields, commentFallbackFields } = previewFields(action, mapping)
  if (appliedFields.length === 0 && commentFallbackFields.length === 0) {
    throw new Error('No configured Feishu Project field mapping for proposed fields. Set PMO_FEISHU_FIELD_GOAL, PMO_FEISHU_FIELD_TEST_PLAN, PMO_FEISHU_FIELD_NEXT_STEP, PMO_FEISHU_FIELD_DUE_DATE, or PMO_FEISHU_FIELD_STATUS.')
  }

  const config = input.client && input.projectKey ? undefined : await loadConfig()
  const client = input.client ?? new FeishuProjectMcpClient({ mcpUrl: config!.feishuProject.mcpUrl, headers: config!.feishuProject.headers })
  const projectKey = input.projectKey ?? config?.feishuProject.projectKey ?? config?.feishuProject.spaceUrl.split('/')[3] ?? ''
  const rawUpdate = appliedFields.length > 0
    ? await client.updateFields({
        projectKey,
        workItemId: action.storyId,
        fields: appliedFields.map(field => ({ fieldKey: field.fieldKey, fieldValue: field.value })),
      })
    : undefined
  const rawComment = await client.addComment({
    projectKey,
    workItemId: action.storyId,
    content: renderApplyComment(action, appliedFields, commentFallbackFields, input.actor, true),
  })

  const at = (input.now ?? new Date()).toISOString()
  const updated: ProjectUpdateAction = {
    ...action,
    status: 'applied',
    approvedBy: action.approvedBy,
    appliedBy: input.actor,
    appliedAt: at,
    appliedFields,
  }
  records[index] = updated
  await writeProjectUpdateActions(input.reportsDir, records)
  return { success: true, action: updated, appliedFields, raw: { update: rawUpdate, comment: rawComment } }
}

export async function previewProjectUpdateAction(input: {
  reportsDir: string
  actionId: string
  mapping?: ProjectUpdateFieldMapping
}): Promise<ProjectUpdatePreviewResult> {
  const records = await listProjectUpdateActions(input.reportsDir)
  const action = records.find(item => item.id === input.actionId)
  if (!action) throw new Error(`Project update action not found: ${input.actionId}`)
  if (action.status !== 'approved') throw new Error(`Project update action must be approved before apply. Current status: ${action.status}`)

  await loadEnvFiles()
  const { appliedFields, commentFallbackFields } = previewFields(action, input.mapping ?? projectUpdateFieldMappingFromEnv())
  if (appliedFields.length === 0 && commentFallbackFields.length === 0) {
    throw new Error('No configured Feishu Project field mapping for proposed fields. Set PMO_FEISHU_FIELD_GOAL, PMO_FEISHU_FIELD_TEST_PLAN, PMO_FEISHU_FIELD_NEXT_STEP, PMO_FEISHU_FIELD_DUE_DATE, or PMO_FEISHU_FIELD_STATUS.')
  }
  return { success: true, mode: 'dry_run', action, appliedFields, commentFallbackFields }
}

export async function listProjectUpdateActions(reportsDir: string): Promise<ProjectUpdateAction[]> {
  try {
    const records = JSON.parse(await readFile(projectUpdateActionsPath(reportsDir), 'utf8')) as ProjectUpdateAction[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

export async function writeProjectUpdateActions(reportsDir: string, records: ProjectUpdateAction[]): Promise<void> {
  await mkdir(reportsDir, { recursive: true })
  await writeFile(projectUpdateActionsPath(reportsDir), `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

function updateActionState(input: {
  reportsDir: string
  actionId: string
  actor: string
  note?: string
  now?: Date
  status: 'approved' | 'rejected'
}): Promise<ProjectUpdateAction> {
  return (async () => {
    const records = await listProjectUpdateActions(input.reportsDir)
    const index = records.findIndex(action => action.id === input.actionId)
    if (index < 0) throw new Error(`Project update action not found: ${input.actionId}`)
    const at = (input.now ?? new Date()).toISOString()
    const current = records[index]!
    const updated: ProjectUpdateAction = input.status === 'approved'
      ? { ...current, status: 'approved', approvedBy: input.actor, approvedAt: at, approvalNote: input.note }
      : { ...current, status: 'rejected', rejectedBy: input.actor, rejectedAt: at, rejectionNote: input.note }
    records[index] = updated
    await writeProjectUpdateActions(input.reportsDir, records)
    return updated
  })()
}

function mappedFields(proposed: ProjectUpdateAction['proposedFields'], mapping: ProjectUpdateFieldMapping): Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; fieldKey: string; value: string }> {
  const fields: Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; fieldKey: string; value: string }> = []
  if (proposed.goal && mapping.goal) fields.push({ logicalField: 'goal', fieldKey: mapping.goal, value: proposed.goal })
  if (proposed.testPlan && mapping.testPlan) fields.push({ logicalField: 'testPlan', fieldKey: mapping.testPlan, value: proposed.testPlan })
  if (proposed.nextStep && mapping.nextStep) fields.push({ logicalField: 'nextStep', fieldKey: mapping.nextStep, value: proposed.nextStep })
  if (proposed.dueDate && mapping.dueDate) fields.push({ logicalField: 'dueDate', fieldKey: mapping.dueDate, value: proposed.dueDate })
  if (proposed.status && mapping.status) fields.push({ logicalField: 'status', fieldKey: mapping.status, value: proposed.status })
  return fields
}

function previewFields(action: ProjectUpdateAction, mapping: ProjectUpdateFieldMapping): Pick<ProjectUpdatePreviewResult, 'appliedFields' | 'commentFallbackFields'> {
  return {
    appliedFields: mappedFields(action.proposedFields, mapping),
    commentFallbackFields: unmappedCommentFallbackFields(action.proposedFields, mapping),
  }
}

function unmappedCommentFallbackFields(
  proposed: ProjectUpdateAction['proposedFields'],
  mapping: ProjectUpdateFieldMapping,
): Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; label: string; value: string; reason: string }> {
  const fields: Array<{ logicalField: keyof ProjectUpdateAction['proposedFields']; label: string; value: string; reason: string }> = []
  if (proposed.nextStep && !mapping.nextStep) {
    fields.push({
      logicalField: 'nextStep',
      label: '下一步',
      value: proposed.nextStep,
      reason: 'MAAS_平台暂无明确下一步字段，已按审批结果写入评论。',
    })
  }
  return fields
}

function renderApplyComment(
  action: ProjectUpdateAction,
  fields: Array<{ logicalField: string; fieldKey: string; value: string }>,
  fallbackFields: Array<{ logicalField: string; label: string; value: string; reason: string }>,
  actor: string,
  applied: boolean,
): string {
  return [
    applied ? 'PMO Agent 写回动作已审批并已同步字段：' : 'PMO Agent 写回动作已审批，待同步字段如下：',
    '',
    ...fields.map(field => `- ${field.logicalField} (${field.fieldKey})：${field.value}`),
    ...fallbackFields.map(field => `- ${field.label}（评论 fallback）：${field.value}\n  ${field.reason}`),
    '',
    `审批/执行人：${actor}`,
    `来源 check-in：${action.sourceCheckInId}`,
  ].join('\n')
}

function projectUpdateFieldMappingFromEnv(): ProjectUpdateFieldMapping {
  return {
    goal: process.env.PMO_FEISHU_FIELD_GOAL,
    testPlan: process.env.PMO_FEISHU_FIELD_TEST_PLAN,
    nextStep: process.env.PMO_FEISHU_FIELD_NEXT_STEP,
    dueDate: process.env.PMO_FEISHU_FIELD_DUE_DATE,
    status: process.env.PMO_FEISHU_FIELD_STATUS,
  }
}

function projectUpdateActionsPath(reportsDir: string): string {
  return join(reportsDir, 'project-update-actions.json')
}

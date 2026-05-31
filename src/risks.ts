import type { Evidence, Risk, Story } from './domain.js'

const STALE_STATUS_DAYS = 7

export function assessStoryRisks(story: Story, evidence: Evidence[], now: Date): Risk[] {
  const risks: Risk[] = []
  const add = (type: Risk['type'], severity: Risk['severity'], description: string, suggestedAction: string, evidenceIds: string[] = []) => {
    risks.push({
      id: `${story.id}:${type}`,
      storyId: story.id,
      type,
      severity,
      description,
      suggestedAction,
      evidenceIds,
      ownerToContact: story.owners[0],
    })
  }

  if (!story.fields.goal && !story.fields.successCriteria && !story.fields.acceptanceCriteria) {
    add('missing_goal', 'high', '需求缺少明确目标或验收/成功标准。', '先查关联文档；仍缺失时找需求 owner 补目标。')
  }
  if (story.owners.length === 0) {
    add('missing_owner', 'high', '需求缺少明确负责人。', '确认产品/研发 owner，并维护到飞书项目。')
  }
  if (!story.fields.startDate && !story.fields.dueDate) {
    add('missing_schedule', 'medium', '需求缺少开始/截止/里程碑时间。', '确认排期并维护到飞书项目。')
  }
  if (!story.fields.testPlan && story.linkedDocs.every(doc => !/测|test/i.test(doc.title))) {
    add('missing_test_plan', 'medium', '需求缺少测试计划证据。', '查找关联测试计划；没有则找 owner 或 QA 补充。')
  }
  if (!story.fields.nextStep) {
    add('missing_next_step', 'medium', '需求缺少下一步动作。', '根据 MR/评论推断下一步；不确定时找 owner 确认。')
  }
  if (story.updatedAt && daysBetween(new Date(story.updatedAt), now) > STALE_STATUS_DAYS) {
    add('stale_status', 'medium', `需求状态 ${STALE_STATUS_DAYS} 天以上未更新。`, '核对 GitLab 与评论进展，提示 owner 更新状态。')
  }

  const failedPipelines = evidence.filter(item => item.type === 'gitlab_pipeline' && String(item.metadata?.status).toLowerCase() === 'failed')
  for (const item of failedPipelines) {
    add('pipeline_failed', 'high', '关联 GitLab pipeline 失败。', '找最近提交人或 owner 确认失败原因和下一步。', [item.id])
  }

  const blockedMrs = evidence.filter(item => item.type === 'gitlab_mr' && /cannot|conflict|blocked|checking|unchecked/i.test(String(item.metadata?.detailedMergeStatus ?? item.metadata?.mergeStatus ?? '')))
  for (const item of blockedMrs) {
    add('mr_blocked', 'high', '关联 MR 可能被阻塞。', '找 MR author/reviewer 确认 blocker。', [item.id])
  }

  const mergedEvidence = evidence.some(item => item.type === 'gitlab_mr' && String(item.metadata?.state).toLowerCase() === 'merged')
  if (mergedEvidence && /开发中|进行中|待开发/.test(story.status)) {
    add('state_delivery_mismatch', 'medium', 'GitLab 显示已有合并进展，但飞书项目仍处于开发状态。', '提示 owner 核对并更新飞书项目状态。', evidence.filter(item => item.type === 'gitlab_mr').map(item => item.id))
  }

  return dedupeRisks(risks)
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
}

function dedupeRisks(risks: Risk[]): Risk[] {
  const seen = new Set<string>()
  return risks.filter(risk => {
    if (seen.has(risk.id)) return false
    seen.add(risk.id)
    return true
  })
}

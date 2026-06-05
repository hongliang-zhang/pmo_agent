import { createHash } from 'node:crypto'
import type { Evidence, FieldCompletionCandidate, LinkedDoc, Story, StoryContext } from '../domain.js'

export interface FeishuDocContent {
  title: string
  url: string
  content: string
}

export interface FeishuDocContextReader {
  read(doc: LinkedDoc): Promise<FeishuDocContent>
}

export async function enrichStoryContexts(input: {
  stories: Story[]
  reader: FeishuDocContextReader
  maxDocsPerStory?: number
}): Promise<StoryContext[]> {
  const contexts: StoryContext[] = []
  for (const story of input.stories) {
    const docs = story.linkedDocs.slice(0, input.maxDocsPerStory ?? 3)
    if (docs.length === 0) continue
    const evidence: Evidence[] = []
    const candidates: FieldCompletionCandidate[] = []
    const summaries: string[] = []

    for (const doc of docs) {
      let content: FeishuDocContent
      try {
        content = await input.reader.read(doc)
      } catch {
        continue
      }
      const evidenceId = `feishu-doc-${story.id}-${hash(content.url)}`
      evidence.push({
        id: evidenceId,
        type: 'feishu_doc',
        title: content.title || doc.title,
        summary: summarizeDoc(content.content),
        url: content.url || doc.url,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        confidence: 'likely',
        metadata: {
          storyId: story.id,
          source: 'linked_feishu_doc',
        },
      })
      summaries.push(summarizeDoc(content.content))
      candidates.push(...extractCandidates({
        story,
        doc: content,
        evidenceId,
      }))
    }

    if (evidence.length > 0 || candidates.length > 0) {
      contexts.push({
        storyId: story.id,
        summary: summaries.find(Boolean) ?? '已读取关联飞书文档，但未抽取到明确摘要。',
        evidence,
        candidates: dedupeCandidates(candidates),
        contradictions: [],
      })
    }
  }
  return contexts
}

function extractCandidates(input: {
  story: Story
  doc: FeishuDocContent
  evidenceId: string
}): FieldCompletionCandidate[] {
  const candidates: FieldCompletionCandidate[] = []
  const specs: Array<{ field: FieldCompletionCandidate['field']; labels: RegExp[] }> = [
    { field: 'goal', labels: [/^(?:目标|目的|项目目标|需求目标|业务目标)\s*[:：]\s*(.+)$/] },
    { field: 'acceptanceCriteria', labels: [/^(?:验收标准|验收条件|成功标准|完成标准)\s*[:：]\s*(.+)$/] },
    { field: 'successCriteria', labels: [/^(?:成功指标|成功度量|衡量指标)\s*[:：]\s*(.+)$/] },
    { field: 'testPlan', labels: [/^(?:测试计划|测试方案|QA计划|验证方案)\s*[:：]\s*(.+)$/i] },
    { field: 'nextStep', labels: [/^(?:下一步|后续计划|行动项|Action Items?)\s*[:：]\s*(.+)$/i] },
  ]

  const lines = input.doc.content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    for (const spec of specs) {
      if (input.story.fields[spec.field]) continue
      const value = firstMatch(line, spec.labels)
      if (!value) continue
      candidates.push(candidate(spec.field, cleanValue(value), input.doc, input.evidenceId))
    }

    if (!input.story.fields.startDate || !input.story.fields.dueDate) {
      const schedule = /^(?:排期|时间计划|里程碑|计划)\s*[:：]\s*(.+)$/.exec(line)?.[1]
      if (schedule) {
        if (!input.story.fields.startDate) candidates.push(candidate('startDate', cleanValue(schedule), input.doc, input.evidenceId))
        if (!input.story.fields.dueDate) candidates.push(candidate('dueDate', cleanValue(schedule), input.doc, input.evidenceId))
      }
    }
  }

  return candidates
}

function candidate(
  field: FieldCompletionCandidate['field'],
  value: string,
  doc: FeishuDocContent,
  evidenceId: string,
): FieldCompletionCandidate {
  return {
    field,
    value,
    sourceTitle: doc.title,
    sourceUrl: doc.url,
    evidenceId,
    confidence: 'likely',
    needsConfirmation: true,
  }
}

function firstMatch(line: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(line)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function cleanValue(value: string): string {
  return value.replace(/^[-*]\s*/, '').trim()
}

function summarizeDoc(content: string): string {
  const firstUsefulLine = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0)
  if (!firstUsefulLine) return ''
  return firstUsefulLine.length > 120 ? `${firstUsefulLine.slice(0, 117)}...` : firstUsefulLine
}

function dedupeCandidates(candidates: FieldCompletionCandidate[]): FieldCompletionCandidate[] {
  const seen = new Set<string>()
  return candidates.filter(item => {
    const key = `${item.field}:${item.value}:${item.sourceUrl}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10)
}

import type { Evidence, Story } from './domain.js'

export interface MatchResult {
  storyEvidence: Map<string, Evidence[]>
  isolatedEvidence: Evidence[]
}

export function matchEvidenceToStories(stories: Story[], evidence: Evidence[]): MatchResult {
  const storyEvidence = new Map<string, Evidence[]>(stories.map(story => [story.id, []]))
  const isolatedEvidence: Evidence[] = []
  for (const item of evidence) {
    const story = stories.find(candidate => evidenceMatchesStory(candidate, item))
    if (story) storyEvidence.get(story.id)!.push(item)
    else isolatedEvidence.push(item)
  }
  return { storyEvidence, isolatedEvidence }
}

function evidenceMatchesStory(story: Story, evidence: Evidence): boolean {
  const haystack = [
    evidence.title,
    evidence.summary,
    evidence.url,
    JSON.stringify(evidence.metadata ?? {}),
  ].join('\n').toLowerCase()

  if (haystack.includes(story.id.toLowerCase())) return true
  if (story.url && haystack.includes(story.url.toLowerCase())) return true

  const titleTokens = tokenize(story.title)
  if (titleTokens.length >= 2 && titleTokens.filter(token => haystack.includes(token)).length >= 2) return true
  if (titleTokens.length === 1 && titleTokens[0] && haystack.includes(titleTokens[0])) return true

  return story.owners.some(owner => {
    const ownerNeedle = (owner.username ?? owner.email ?? owner.name).toLowerCase()
    return ownerNeedle.length > 1 && haystack.includes(ownerNeedle)
  })
}

function tokenize(value: string): string[] {
  const ascii = value.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []
  const cjk = value.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  const cjkBigrams = cjk.flatMap(segment => Array.from({ length: Math.max(0, segment.length - 1) }, (_, i) => segment.slice(i, i + 2)))
  return [...new Set([...ascii, ...cjkBigrams])].slice(0, 12)
}

import { enrichStoryContexts } from './enrichment.js'
import { createFixtureFeishuDocReaderFromFile, createLarkMcpFeishuDocReader } from '../feishu/doc-reader.js'
import type { Story, StoryContext } from '../domain.js'

export async function maybeEnrichStoryContexts(input: {
  stories: Story[]
  enabled?: boolean
  docsFixture?: string
  maxDocsPerStory?: number
}): Promise<StoryContext[]> {
  if (!input.enabled) return []
  const reader = input.docsFixture
    ? await createFixtureFeishuDocReaderFromFile(input.docsFixture)
    : createLarkMcpFeishuDocReader()
  return enrichStoryContexts({
    stories: input.stories,
    reader,
    maxDocsPerStory: input.maxDocsPerStory,
  })
}

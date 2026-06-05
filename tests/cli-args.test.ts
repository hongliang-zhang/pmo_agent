import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/cli/args.js'

describe('parseArgs', () => {
  it('parses date, dry-run, output, optional fixture flags, and context enrichment flags', () => {
    const args = parseArgs([
      '--',
      '--date',
      '2026-05-31',
      '--dry-run',
      '--output',
      'feishu-doc',
      '--stories-fixture',
      'fixtures/stories.json',
      '--enrich-context',
      '--docs-fixture',
      'fixtures/docs.json',
    ])

    expect(args.date).toBe('2026-05-31')
    expect(args.dryRun).toBe(true)
    expect(args.output).toBe('feishu-doc')
    expect(args.storiesFixture).toBe('fixtures/stories.json')
    expect(args.enrichContext).toBe(true)
    expect(args.docsFixture).toBe('fixtures/docs.json')
  })
})

import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/cli/args.js'

describe('parseArgs', () => {
  it('parses date, dry-run, output, and optional fixture flags', () => {
    const args = parseArgs(['--', '--date', '2026-05-31', '--dry-run', '--output', 'feishu-doc', '--stories-fixture', 'fixtures/stories.json'])

    expect(args.date).toBe('2026-05-31')
    expect(args.dryRun).toBe(true)
    expect(args.output).toBe('feishu-doc')
    expect(args.storiesFixture).toBe('fixtures/stories.json')
  })
})

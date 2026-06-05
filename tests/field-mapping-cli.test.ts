import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('Feishu Project field mapping CLI', () => {
  it('prints mapping suggestions from a local field fixture without leaking credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-fields-'))
    const fixture = join(dir, 'fields.json')
    await writeFile(fixture, JSON.stringify([
      { key: 'description', name: '描述' },
      { key: 'field_7f3085', name: '测试方式' },
      { key: 'field_810cee', name: '计划完成时间' },
      { key: 'work_item_status', name: '需求状态' },
    ]))

    const { stdout } = await execFileAsync('pnpm', [
      'tsx',
      'src/cli/feishu-project-fields.ts',
      '--',
      '--fieldsFixture',
      fixture,
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    expect(result.success).toBe(true)
    expect(result.envSuggestions).toContain('PMO_FEISHU_FIELD_TEST_PLAN=field_7f3085')
    expect(result.envSuggestions).toContain('PMO_FEISHU_FIELD_DUE_DATE=field_810cee')
    expect(result.suggestions.nextStep).toEqual([])
    expect(stdout).not.toMatch(/token|secret|password|api[_-]?key/i)
  })
})

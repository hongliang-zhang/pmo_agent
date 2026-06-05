import { mkdtemp } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runLocalSmoke } from '../src/smoke/local.js'

describe('local PMO smoke runner', () => {
  it('runs a complete local HTTP and action-bridge smoke without leaking credentials', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-local-smoke-'))
    const result = await runLocalSmoke({
      date: '2026-05-31',
      reportsDir,
      storiesFixture: 'tests/fixtures/stories.json',
      maxProjects: 0,
      runAt: '09:00',
      now: '2026-05-31T01:01:00Z',
      skipPreflight: true,
      preflight: async () => ({
        status: 'warn',
        generatedAt: '2026-05-31T01:00:00.000Z',
        summary: { passed: 2, warnings: 1, failed: 0 },
        checks: [{ name: 'lark-mcp OAuth', status: 'warn', detail: 'Missing docx:document.' }],
      }),
    })

    expect(result.success).toBe(true)
    expect(result.steps.map(step => step.name)).toEqual([
      'start_server',
      'health',
      'scheduler_tick',
      'get_run',
      'list_drafts',
      'action_invoke',
      'verify_artifacts',
    ])
    expect(result.runId).toContain('2026-05-31')
    expect(result.artifacts).toMatchObject({
      reportJsonPath: expect.stringContaining('2026-05-31-pmo-audit.json'),
      opsDashboardHtmlPath: expect.stringContaining('ops-dashboard.html'),
      opsDashboardJsonPath: expect.stringContaining('ops-dashboard.json'),
    })
    expect(result.summary).toMatchObject({
      runStatus: 'success',
      drafts: expect.any(Number),
      actionsInvoked: 1,
    })
    const dashboard = JSON.parse(await readFile(result.artifacts!.opsDashboardJsonPath, 'utf8')) as any
    expect(dashboard.latestSmoke).toMatchObject({
      success: true,
      runId: result.runId,
    })
    expect(dashboard.readiness).toBeDefined()
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password|api[_-]?key/i)
  }, 30_000)

  it('reuses an existing successful run when scheduler reports already_ran', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-local-smoke-repeat-'))
    const baseInput = {
      date: '2026-05-31',
      reportsDir,
      storiesFixture: 'tests/fixtures/stories.json',
      maxProjects: 0,
      runAt: '09:00',
      now: '2026-05-31T01:01:00Z',
      skipPreflight: true,
      preflight: async () => ({
        status: 'warn' as const,
        generatedAt: '2026-05-31T01:00:00.000Z',
        summary: { passed: 2, warnings: 1, failed: 0 },
        checks: [{ name: 'lark-mcp OAuth', status: 'warn' as const, detail: 'Missing docx:document.' }],
      }),
    }
    const first = await runLocalSmoke(baseInput)
    const second = await runLocalSmoke(baseInput)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(second.steps.find(step => step.name === 'scheduler_tick')?.detail).toBe('already_ran')
    expect(second.runId).toBe(first.runId)
  }, 30_000)
})

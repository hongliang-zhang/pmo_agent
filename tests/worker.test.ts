import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWorkerTick } from '../src/server/worker.js'

describe('PMO worker', () => {
  it('writes visible worker events and ops dashboard on skipped ticks', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-worker-'))
    await writeFile(join(reportsDir, 'runs.json'), JSON.stringify([{
      id: 'run-1',
      date: '2026-05-31',
      status: 'success',
      startedAt: '2026-05-31T01:00:00.000Z',
      finishedAt: '2026-05-31T01:01:00.000Z',
    }]), 'utf8')

    const result = await runWorkerTick({
      reportsDir,
      runAt: '09:00',
      tickIntervalMs: 60_000,
      createFeishuDoc: false,
      createReportDeliveryDraft: false,
      buildPersonDirectory: true,
      analyzeWithModels: false,
      enrichContext: true,
      skipPreflight: true,
    }, new Date('2026-05-31T02:00:00Z'))

    expect(result).toMatchObject({ due: false, date: '2026-05-31' })
    await expect(readFile(join(reportsDir, 'worker-events.json'), 'utf8')).resolves.toContain('tick_skipped')
    await expect(readFile(join(reportsDir, 'ops-dashboard.html'), 'utf8')).resolves.toContain('Worker Events')
  })
})

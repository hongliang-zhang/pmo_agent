import { describe, expect, it } from 'vitest'
import { evaluateDailySchedule } from '../src/server/scheduler.js'

describe('evaluateDailySchedule', () => {
  it('skips before the configured China-local run time', () => {
    const decision = evaluateDailySchedule({
      now: new Date('2026-05-31T00:59:00Z'),
      runAt: '09:00',
      runs: [],
    })

    expect(decision).toMatchObject({
      due: false,
      reason: 'before_scheduled_time',
      date: '2026-05-31',
    })
  })

  it('runs once after configured time and skips after success for the same date', () => {
    const now = new Date('2026-05-31T01:01:00Z')
    expect(evaluateDailySchedule({ now, runAt: '09:00', runs: [] })).toMatchObject({
      due: true,
      date: '2026-05-31',
    })
    expect(evaluateDailySchedule({
      now,
      runAt: '09:00',
      runs: [{
        id: 'run-1',
        date: '2026-05-31',
        status: 'success',
        startedAt: '2026-05-31T01:00:00.000Z',
        finishedAt: '2026-05-31T01:01:00.000Z',
      }],
    })).toMatchObject({
      due: false,
      reason: 'already_ran',
    })
  })
})

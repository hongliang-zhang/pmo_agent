import type { PmoRunRecord } from './runs.js'

export interface DailyScheduleDecision {
  due: boolean
  date: string
  reason: 'due' | 'before_scheduled_time' | 'already_ran'
}

export function evaluateDailySchedule(input: {
  now: Date
  runAt: string
  runs: PmoRunRecord[]
}): DailyScheduleDecision {
  const date = formatChinaDate(input.now)
  if (input.runs.some(run => run.date === date && run.status === 'success')) {
    return { due: false, date, reason: 'already_ran' }
  }
  const currentMinutes = chinaTimeMinutes(input.now)
  const scheduledMinutes = parseRunAt(input.runAt)
  if (currentMinutes < scheduledMinutes) {
    return { due: false, date, reason: 'before_scheduled_time' }
  }
  return { due: true, date, reason: 'due' }
}

function formatChinaDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function chinaTimeMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function parseRunAt(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid schedule time '${value}', expected HH:mm`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error(`Invalid schedule time '${value}', expected HH:mm`)
  return hour * 60 + minute
}

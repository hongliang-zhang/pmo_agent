import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('pmo build-state CLI', () => {
  it('prints a ProjectStateSnapshot from an AuditReport JSON file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-build-state-'))
    const input = join(dir, 'report.json')
    await writeFile(input, JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 0, risky: 0, incomplete: 0, suggestedContacts: 0 },
      storyAudits: [{
        story: { id: 'S1', title: '客服agent工单自动分类', status: '开发阶段', owners: [{ name: '孟茜' }], linkedDocs: [], fields: { goal: '降低人工分类成本' } },
        evidence: [],
        risks: [],
        confidence: 'unknown',
        progressSummary: '未找到今日交付证据，需结合飞书项目状态判断。',
      }],
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
    }))

    const { stdout } = await execFileAsync('pnpm', ['tsx', 'src/cli/build-state.ts', '--', '--input', input], {
      cwd: process.cwd(),
    })

    const snapshot = JSON.parse(stdout)
    expect(snapshot.summary.stories).toBe(1)
    expect(snapshot.workstreams[0].name).toBe('客服 Agent')
  })
})

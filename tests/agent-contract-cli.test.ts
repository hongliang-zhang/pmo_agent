import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('pmo agent contract CLI', () => {
  it('prints the z-mono agent contract as JSON', async () => {
    const { stdout } = await execFileAsync('pnpm', ['tsx', 'src/cli/agent-contract.ts'], {
      cwd: process.cwd(),
      env: { ...process.env },
    })

    const contract = JSON.parse(stdout)
    expect(contract.agent.id).toBe('maas-pmo-status-auditor')
    expect(contract.actions.map((action: any) => action.name)).toEqual([
      'pmo_collect_facts',
      'pmo_enrich_context',
      'pmo_build_state_snapshot',
      'pmo_render_local_report',
      'pmo_run_agent_cycle',
      'pmo_scheduler_tick',
      'pmo_record_checkin_reply',
      'pmo_list_checkins',
      'pmo_list_project_update_actions',
      'pmo_approve_project_update_action',
      'pmo_reject_project_update_action',
      'pmo_apply_project_update_action',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { buildZMonoAgentContract } from '../src/zmono/contract.js'

describe('buildZMonoAgentContract', () => {
  it('exports read-only PMO actions compatible with z-mono Actions Service', () => {
    const contract = buildZMonoAgentContract({
      provider: 'z.ai',
      dailyModel: 'glm-5-turbo',
      riskModel: 'glm-5.1',
    })

    expect(contract.agent.id).toBe('maas-pmo-status-auditor')
    expect(contract.agent.modelPolicy.hardCodedModel).toBe(false)
    expect(contract.agent.modelPolicy.route).toBe('z-mono-gateway')
    expect(contract.agent.modelPolicy.provider).toBe('z.ai')
    expect(contract.agent.modelPolicy.dailySummaryModel).toBe('glm-5-turbo')
    expect(contract.agent.modelPolicy.deepRiskModel).toBe('glm-5.1')
    expect(contract.security.writeOperations).toEqual(['pmo_apply_project_update_action'])
    expect(contract.actions.map(action => action.name)).toEqual([
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
    for (const action of contract.actions.filter(action => action.name !== 'pmo_apply_project_update_action')) {
      expect(action.inputSchema.type).toBe('object')
      expect(action.safety.readOnly).toBe(true)
      expect(JSON.stringify(action)).not.toMatch(/token|secret|password/i)
    }
    expect(contract.actions.find(action => action.name === 'pmo_apply_project_update_action')?.safety).toMatchObject({
      readOnly: false,
      writesExternalSystems: true,
    })
  })
})

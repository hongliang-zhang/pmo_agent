import { buildZMonoAgentContract } from '../zmono/contract.js'

process.stdout.write(`${JSON.stringify(buildZMonoAgentContract({
  provider: 'z.ai',
  dailyModel: process.env.PMO_DAILY_MODEL ?? 'glm-5-turbo',
  riskModel: process.env.PMO_RISK_MODEL ?? 'glm-5.1',
}), null, 2)}\n`)

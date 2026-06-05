import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AppConfig } from '../config.js'
import type { AuditReport } from '../domain.js'

export interface ModelAnalysisResult {
  dailySummary: string
  riskAssessment: string
}

export interface ModelAnalyzer {
  analyze(report: AuditReport): Promise<ModelAnalysisResult>
}

export interface ModelAnalysisArtifact {
  analysisPath: string
  dailySummary: string
  riskAssessment: string
}

export function createStaticModelAnalyzer(result: ModelAnalysisResult): ModelAnalyzer {
  return {
    async analyze() {
      return result
    },
  }
}

export async function writeModelAnalysisArtifact(input: {
  reportPath: string
  reportsDir: string
  analyzer: ModelAnalyzer
  config: Pick<AppConfig, 'models'>
}): Promise<ModelAnalysisArtifact> {
  const report = JSON.parse(await readFile(input.reportPath, 'utf8')) as AuditReport
  const result = await input.analyzer.analyze(report)
  const output = {
    date: report.date,
    generatedAt: new Date().toISOString(),
    provider: input.config.models.provider,
    sourceReport: basename(input.reportPath),
    daily: {
      model: input.config.models.daily.model,
      summary: result.dailySummary,
    },
    risk: {
      model: input.config.models.risk.model,
      assessment: result.riskAssessment,
    },
  }
  await mkdir(input.reportsDir, { recursive: true })
  const analysisPath = join(input.reportsDir, `${report.date}-pmo-model-analysis.json`)
  await writeFile(analysisPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  return { analysisPath, dailySummary: result.dailySummary, riskAssessment: result.riskAssessment }
}

export function defaultModelConfigFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Pick<AppConfig, 'models'> {
  return {
    models: {
      provider: 'z.ai',
      apiKey: env.ZAI_API_KEY,
      daily: {
        protocol: 'openai',
        baseUrl: env.ZAI_OPENAI_BASE_URL ?? 'https://open.bigmodel.cn/api/coding/paas/v4',
        model: env.PMO_DAILY_MODEL ?? 'glm-5-turbo',
      },
      risk: {
        protocol: 'anthropic',
        baseUrl: env.ZAI_ANTHROPIC_BASE_URL ?? 'https://open.bigmodel.cn/api/anthropic',
        model: env.PMO_RISK_MODEL ?? 'glm-5.1',
      },
    },
  }
}

export function createZaiModelAnalyzer(config: Pick<AppConfig, 'models'>, fetchImpl: typeof fetch = fetch): ModelAnalyzer {
  if (!config.models.apiKey) {
    throw new Error('Missing ZAI_API_KEY for model analysis')
  }
  return {
    async analyze(report: AuditReport): Promise<ModelAnalysisResult> {
      const compactReport = compactReportForModel(report)
      const dailySummary = await callOpenAiCompatible({
        fetchImpl,
        apiKey: config.models.apiKey!,
        baseUrl: config.models.daily.baseUrl,
        model: config.models.daily.model,
        system: '你是 MAAS 平台 PMO 状态核查 agent。只基于输入证据输出简洁日报总结，不要编造事实。',
        user: `请用中文总结今天 PMO 状态，所有判断必须基于输入 JSON。\n${JSON.stringify(compactReport)}`,
      })
      const riskAssessment = await callAnthropicCompatible({
        fetchImpl,
        apiKey: config.models.apiKey!,
        baseUrl: config.models.risk.baseUrl,
        model: config.models.risk.model,
        system: '你是 MAAS 平台 PMO 风险分析 agent。只基于输入证据识别目标、排期、测试和交付风险。',
        user: `请用中文给出深度风险分析，区分事实和推断。\n${JSON.stringify(compactReport)}`,
      })
      return { dailySummary, riskAssessment }
    },
  }
}

function compactReportForModel(report: AuditReport): unknown {
  return {
    title: report.title,
    date: report.date,
    summary: report.summary,
    riskyStories: report.riskyStories.map(item => ({
      id: item.story.id,
      title: item.story.title,
      status: item.story.status,
      owners: item.story.owners.map(owner => owner.name),
      risks: item.risks.map(risk => ({ type: risk.type, severity: risk.severity, description: risk.description })),
      confidence: item.confidence,
    })),
    progressedStories: report.progressedStories.map(item => ({
      id: item.story.id,
      title: item.story.title,
      evidence: item.evidence.map(evidence => ({ type: evidence.type, title: evidence.title, confidence: evidence.confidence })),
    })),
    suggestedContacts: report.suggestedContacts,
    isolatedEvidence: report.isolatedEvidence.map(evidence => ({ type: evidence.type, title: evidence.title, author: evidence.author })),
  }
}

async function callOpenAiCompatible(input: {
  fetchImpl: typeof fetch
  apiKey: string
  baseUrl: string
  model: string
  system: string
  user: string
}): Promise<string> {
  const response = await input.fetchImpl(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      temperature: 0.2,
    }),
  })
  if (!response.ok) throw new Error(`z.ai daily model request failed with HTTP ${response.status}`)
  const body = await response.json() as any
  return String(body.choices?.[0]?.message?.content ?? '').trim()
}

async function callAnthropicCompatible(input: {
  fetchImpl: typeof fetch
  apiKey: string
  baseUrl: string
  model: string
  system: string
  user: string
}): Promise<string> {
  const response = await input.fetchImpl(`${input.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 1200,
      temperature: 0.2,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    }),
  })
  if (!response.ok) throw new Error(`z.ai risk model request failed with HTTP ${response.status}`)
  const body = await response.json() as any
  const text = Array.isArray(body.content)
    ? body.content.map((item: any) => item?.text ?? '').join('\n')
    : body.content
  return String(text ?? '').trim()
}

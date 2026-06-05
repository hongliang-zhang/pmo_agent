import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig } from '../config.js'
import type { AuditReport } from '../domain.js'
import { createZaiModelAnalyzer, defaultModelConfigFromEnv, type ModelAnalyzer, writeModelAnalysisArtifact } from '../models/analysis.js'

export interface ModelSmokeInput {
  reportsDir: string
  report?: AuditReport
  reportPath?: string
  analyzer?: ModelAnalyzer
  config?: Pick<AppConfig, 'models'>
}

export interface ModelSmokeResult {
  success: true
  provider: string
  dailyModel: string
  riskModel: string
  dailySummaryChars: number
  riskAssessmentChars: number
  analysisPath: string
}

export async function runModelSmoke(input: ModelSmokeInput): Promise<ModelSmokeResult> {
  const config = input.config ?? defaultModelConfigFromEnv()
  const analyzer = input.analyzer ?? createZaiModelAnalyzer(config)
  const reportPath = input.reportPath ?? await writeSmokeReport(input.reportsDir, input.report ?? defaultSmokeReport())
  const artifact = await writeModelAnalysisArtifact({
    reportPath,
    reportsDir: input.reportsDir,
    analyzer,
    config,
  })

  return {
    success: true,
    provider: config.models.provider,
    dailyModel: config.models.daily.model,
    riskModel: config.models.risk.model,
    dailySummaryChars: artifact.dailySummary.length,
    riskAssessmentChars: artifact.riskAssessment.length,
    analysisPath: artifact.analysisPath,
  }
}

async function writeSmokeReport(reportsDir: string, report: AuditReport): Promise<string> {
  await mkdir(reportsDir, { recursive: true })
  const reportPath = join(reportsDir, 'model-smoke-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return reportPath
}

function defaultSmokeReport(): AuditReport {
  return {
    title: 'MAAS_平台 PMO 模型 smoke',
    date: chinaToday(),
    summary: {
      stories: 1,
      progressed: 1,
      risky: 1,
      incomplete: 1,
      suggestedContacts: 1,
    },
    progressedStories: [],
    riskyStories: [],
    incompleteStories: [],
    gitlabEvidence: [],
    isolatedEvidence: [],
    suggestedContacts: [{
      person: '张鸿亮',
      storyId: 'model-smoke',
      storyTitle: '模型连通性验证',
      question: '请确认日报总结模型和深度风险模型均能生成基于证据的输出。',
      reason: '模型 smoke 需要同时验证两个模型配置。',
      priority: 'medium',
    }],
    noNeedToDisturb: [],
  }
}

function chinaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

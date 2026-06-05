import type { AppConfig } from './config.js'
import { loadConfig, loadEnvFiles } from './config.js'
import type { DiagnosticCheck } from './diagnostics.js'
import { runDiagnostics } from './diagnostics.js'

export interface PreflightReport {
  status: 'pass' | 'warn' | 'fail'
  generatedAt: string
  summary: {
    passed: number
    warnings: number
    failed: number
  }
  checks: DiagnosticCheck[]
}

export async function runPreflight(input: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
} = {}): Promise<PreflightReport> {
  await loadEnvFiles()
  const config = await loadConfig({ env: input.env })
  const checks = await runDiagnostics(config)
  return buildPreflightReport({ config, checks, env: input.env ?? process.env })
}

export function buildPreflightReport(input: {
  config: AppConfig
  checks: DiagnosticCheck[]
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  generatedAt?: Date
}): PreflightReport {
  const env = input.env ?? process.env
  const checks = [
    ...normalizeDocumentChecks(input.checks, env),
    modelCheck(input.config),
    feishuOpenApiCheck(env),
    deliveryCheck(env),
    projectWritebackMappingCheck(env),
    schedulerCheck(input.config, env),
  ].map(sanitizeCheck)

  const failed = checks.filter(check => check.status === 'fail').length
  const warnings = checks.filter(check => check.status === 'warn').length
  return {
    status: failed ? 'fail' : warnings ? 'warn' : 'pass',
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    summary: {
      passed: checks.length - failed - warnings,
      warnings,
      failed,
    },
    checks,
  }
}

function normalizeDocumentChecks(
  checks: DiagnosticCheck[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): DiagnosticCheck[] {
  if (env.PMO_FEISHU_DOC_OUTPUT_MODE !== 'openapi') return checks
  return checks.map(check => {
    if (check.name !== 'lark-mcp OAuth' || check.status !== 'fail') return check
    return {
      name: check.name,
      status: 'warn',
      detail: 'lark-mcp is not ready, but Feishu document output is configured to use OpenAPI mode.',
      nextStep: 'Keep PMO_FEISHU_DOC_OUTPUT_MODE=openapi for document output, or reauthorize lark-mcp if you want to use the legacy import path.',
    }
  })
}

function modelCheck(config: AppConfig): DiagnosticCheck {
  if (!config.models.apiKey) {
    return {
      name: 'z.ai models',
      status: 'fail',
      detail: `Missing z.ai credential for daily model ${config.models.daily.model} and risk model ${config.models.risk.model}.`,
      nextStep: 'Set the local z.ai credential in .env.local before enabling model-backed summaries or deep risk analysis.',
    }
  }
  return {
    name: 'z.ai models',
    status: 'pass',
    detail: `Configured provider ${config.models.provider} with daily model ${config.models.daily.model} and risk model ${config.models.risk.model}.`,
  }
}

function deliveryCheck(env: NodeJS.ProcessEnv | Record<string, string | undefined>): DiagnosticCheck {
  if (env.PMO_FEISHU_IM_DELIVERY_ENABLED === 'true') {
    if (!hasFeishuOpenApiCredential(env)) {
      return {
        name: 'Feishu IM delivery',
        status: 'fail',
        detail: 'Real Feishu IM delivery is enabled, but Feishu OpenAPI credential is missing.',
        nextStep: 'Set FEISHU_TENANT_ACCESS_TOKEN or FEISHU_APP_ID plus FEISHU_APP_SECRET before enabling real delivery.',
      }
    }
    return {
      name: 'Feishu IM delivery',
      status: 'warn',
      detail: 'Real Feishu IM delivery flag is enabled. Confirm Feishu app send permission and recipient open_id mapping before production use.',
      nextStep: 'Run an approved live smoke test and verify audit logs before scheduled production delivery.',
    }
  }
  return {
    name: 'Feishu IM delivery',
    status: 'warn',
    detail: 'Real Feishu IM delivery is disabled. Dry-run delivery remains available.',
    nextStep: 'Keep disabled until Feishu IM permission, recipient mapping, and live smoke tests are complete.',
  }
}

function feishuOpenApiCheck(env: NodeJS.ProcessEnv | Record<string, string | undefined>): DiagnosticCheck {
  if (!hasFeishuOpenApiCredential(env)) {
    return {
      name: 'Feishu OpenAPI Contacts/IM',
      status: 'warn',
      detail: 'Feishu OpenAPI credential is not configured. Contacts lookup and real IM delivery live smoke are unavailable.',
      nextStep: 'Set FEISHU_TENANT_ACCESS_TOKEN or FEISHU_APP_ID plus FEISHU_APP_SECRET after the Feishu app has Contacts and IM permissions.',
    }
  }
  return {
    name: 'Feishu OpenAPI Contacts/IM',
    status: 'pass',
    detail: 'Feishu OpenAPI credential is configured for Contacts lookup and guarded IM delivery.',
  }
}

function hasFeishuOpenApiCredential(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return Boolean(env.FEISHU_TENANT_ACCESS_TOKEN || (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) || (env.LARK_APP_ID && env.LARK_APP_SECRET))
}

function projectWritebackMappingCheck(env: NodeJS.ProcessEnv | Record<string, string | undefined>): DiagnosticCheck {
  const required = [
    'PMO_FEISHU_FIELD_GOAL',
    'PMO_FEISHU_FIELD_TEST_PLAN',
    'PMO_FEISHU_FIELD_NEXT_STEP',
    'PMO_FEISHU_FIELD_DUE_DATE',
  ]
  const missing = required.filter(key => !env[key])
  if (missing.length > 0) {
    return {
      name: 'Feishu Project writeback mapping',
      status: 'warn',
      detail: `Missing optional writeback field mapping: ${missing.join(', ')}. Approved comments and status transition wrappers still work, but field updates for these logical fields will be skipped/refused until mapped.`,
      nextStep: 'Verify MAAS_平台 story field keys through Feishu Project MCP field config and set PMO_FEISHU_FIELD_* in .env.local.',
    }
  }
  return {
    name: 'Feishu Project writeback mapping',
    status: 'pass',
    detail: 'Goal, test plan, next step, and due date field mappings are configured for approved Feishu Project writeback actions.',
  }
}

function schedulerCheck(config: AppConfig, env: NodeJS.ProcessEnv | Record<string, string | undefined>): DiagnosticCheck {
  return {
    name: 'scheduler',
    status: 'pass',
    detail: `Scheduler writes reports to ${config.audit.reportsDir} with China-local run time ${env.PMO_DAILY_RUN_AT ?? '09:00'} and default agent_cycle mode.`,
  }
}

function sanitizeCheck(check: DiagnosticCheck): DiagnosticCheck {
  return {
    ...check,
    detail: sanitizeText(check.detail),
    nextStep: check.nextStep ? sanitizeText(check.nextStep) : undefined,
  }
}

function sanitizeText(value: string): string {
  return value
    .replace(/\b(token|password|api[_-]?key|secret)\b/gi, 'credential')
    .replace(/([A-Za-z0-9_-]{8,}\.)?[A-Za-z0-9_-]{16,}/g, match => {
      if (/^[A-Z0-9_]+$/.test(match) && !/(TOKEN|SECRET|PASSWORD|API[_-]?KEY)/.test(match)) return match
      return '[redacted]'
    })
}

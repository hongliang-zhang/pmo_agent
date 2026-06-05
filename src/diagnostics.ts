import { spawn } from 'node:child_process'
import type { AppConfig } from './config.js'
import { FeishuProjectMcpClient } from './feishu/project-mcp.js'
import { GitLabClient } from './gitlab/client.js'

export interface DiagnosticCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
  nextStep?: string
}

export async function runDiagnostics(config: AppConfig): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = []
  checks.push(await checkGitLab(config))
  checks.push(await checkFeishuProject(config))
  checks.push(await checkLarkMcp())
  return checks
}

async function checkGitLab(config: AppConfig): Promise<DiagnosticCheck> {
  try {
    const projects = await new GitLabClient(config.gitlab).listGroupProjects(config.gitlab.group)
    return {
      name: 'GitLab open-platform',
      status: 'pass',
      detail: `Connected. Read ${projects.length} projects from ${config.gitlab.group}.`,
    }
  } catch (error) {
    return {
      name: 'GitLab open-platform',
      status: 'fail',
      detail: errorMessage(error),
      nextStep: 'Set GITLAB_TOKEN or refresh the macOS git credential for dev.aminer.cn.',
    }
  }
}

async function checkFeishuProject(config: AppConfig): Promise<DiagnosticCheck> {
  try {
    const stories = await new FeishuProjectMcpClient({
      mcpUrl: config.feishuProject.mcpUrl,
      headers: config.feishuProject.headers,
    }).listStories(config.feishuProject.spaceName, config.feishuProject.projectKey, config.feishuProject.activeStatuses)
    return {
      name: 'Feishu Project MCP',
      status: 'pass',
      detail: `Connected. Read ${stories.length} active stories from ${config.feishuProject.spaceName}.`,
    }
  } catch (error) {
    return {
      name: 'Feishu Project MCP',
      status: 'fail',
      detail: errorMessage(error),
      nextStep: 'Set FEISHU_PROJECT_MCP_TOKEN from the Feishu Project MCP HTTP Header X-Mcp-Token config, then rerun pnpm pmo:doctor.',
    }
  }
}

export async function checkLarkMcp(): Promise<DiagnosticCheck> {
  const timeoutMs = Number(process.env.PMO_LARK_MCP_TIMEOUT_MS ?? 30_000)
  try {
    const output = await runCommand('npx', ['-y', '@larksuiteoapi/lark-mcp', 'whoami'], timeoutMs)
    const session = parseLarkWhoami(output.stdout + output.stderr)
    if (!session.hasSession) {
      return {
        name: 'lark-mcp OAuth',
        status: 'fail',
        detail: 'No active lark-mcp login session found.',
        nextStep: 'Run npx -y @larksuiteoapi/lark-mcp login -a <app_id> -s <app_secret>, then authorize in the browser.',
      }
    }
    if (session.tokenExpired) {
      const nextStep = session.refreshTokenMissing
        ? 'Rerun lark-mcp login with document scopes. The current session has no refreshToken, so it cannot auto-renew; if Feishu asks for offline_access, approve/publish that permission first.'
        : 'Rerun lark-mcp login with document scopes, then retry Feishu document creation.'
      return {
        name: 'lark-mcp OAuth',
        status: 'fail',
        detail: `Logged in with document scope, but user_access_token is expired. Current scopes: ${session.scopes.join(', ') || 'unknown'}.`,
        nextStep,
      }
    }
    if (!session.hasDocumentScope) {
      return {
        name: 'lark-mcp OAuth',
        status: 'warn',
        detail: `Logged in, but document creation scope is missing. Current scopes: ${session.scopes.join(', ') || 'unknown'}.`,
        nextStep: 'Open the Feishu app permission page, add docx:document plus docs:doc or drive:drive as needed, publish/approve the change, then rerun lark-mcp login with --scope "offline_access docx:document drive:drive docs:doc".',
      }
    }
    return {
      name: 'lark-mcp OAuth',
      status: 'pass',
      detail: `Logged in with document scope. Current scopes: ${session.scopes.join(', ')}.`,
    }
  } catch (error) {
    const message = errorMessage(error)
    if (/timed out/i.test(message)) {
      return {
        name: 'lark-mcp OAuth',
        status: 'fail',
        detail: message,
        nextStep: 'Run `npx -y @larksuiteoapi/lark-mcp whoami` directly to inspect the hang. If the command is just slow, set PMO_LARK_MCP_TIMEOUT_MS=60000; otherwise rerun lark-mcp login with document scopes.',
      }
    }
    return {
      name: 'lark-mcp OAuth',
      status: 'fail',
      detail: message,
      nextStep: 'Install/reauthorize @larksuiteoapi/lark-mcp, confirm npx is available, then run `npx -y @larksuiteoapi/lark-mcp whoami` before retrying Feishu document creation.',
    }
  }
}

export function parseLarkWhoami(output: string): { hasSession: boolean; scopes: string[]; hasDocumentScope: boolean; tokenExpired: boolean; refreshTokenMissing: boolean } {
  if (/No active login sessions found/i.test(output)) {
    return { hasSession: false, scopes: [], hasDocumentScope: false, tokenExpired: false, refreshTokenMissing: false }
  }
  const scopes = [...output.matchAll(/"([^"]+)"/g)]
    .map(match => match[1]!)
    .filter(value => /^[a-z]+:[a-z0-9_.:-]+$/.test(value))
  const documentScopes = new Set(['docx:document', 'docs:doc', 'drive:drive', 'docs:document.media:upload'])
  return {
    hasSession: /Current login sessions|App ID|AccessToken Expired/i.test(output),
    scopes,
    hasDocumentScope: scopes.some(scope => documentScopes.has(scope)),
    tokenExpired: /AccessToken Expired:\s*true/i.test(output),
    refreshTokenMissing: /"refreshToken"\s*:\s*""/i.test(output),
  }
}

export function renderDiagnostics(checks: DiagnosticCheck[]): string {
  const lines = ['PMO Agent setup diagnostics', '']
  for (const check of checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL'
    lines.push(`[${icon}] ${check.name}`)
    lines.push(`  ${check.detail}`)
    if (check.nextStep) lines.push(`  Next: ${check.nextStep}`)
    lines.push('')
  }
  const failed = checks.filter(check => check.status === 'fail').length
  const warned = checks.filter(check => check.status === 'warn').length
  lines.push(`Summary: ${checks.length - failed - warned} passed, ${warned} warnings, ${failed} failed.`)
  return lines.join('\n')
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()))
    })
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

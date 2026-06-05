import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { runPmoBridgeAction, type PmoBridgeActionName } from '../actions/bridge.js'
import { getRunRecord, listRunRecords, retryRunStage, runDailyAgentCycle, runDailyAudit } from './runs.js'
import { evaluateDailySchedule } from './scheduler.js'
import { runPreflight, type PreflightReport } from '../preflight.js'
import {
  approveCommunicationDraft,
  createCommunicationDraftsFromReport,
  listCommunicationDraftAuditEvents,
  listCommunicationDrafts,
  rejectCommunicationDraft,
} from './drafts.js'
import { deliverCommunicationDraft } from './delivery.js'
import { listCheckInRecords, recordCheckInReply } from './checkins.js'
import { applyProjectUpdateAction, approveProjectUpdateAction, listProjectUpdateActions, rejectProjectUpdateAction } from './project-updates.js'
import { createFeishuBotHandler } from './feishu-bot.js'
import { loadPmoAppState } from './app-data.js'
import { answerPmoQuestion } from './agent-chat.js'
import { renderPmoAppHtml } from './app-static.js'
import { handleOpenAiCompatibleRequest } from './openai-compatible.js'

export function createPmoActionServer(options: {
  preflight?: () => Promise<PreflightReport>
} = {}): Server {
  return createServer(async (req, res) => {
    try {
      if (await handleOpenAiCompatibleRequest(req, res)) return

      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { ok: true })
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/login')) {
        sendLoginPage(req, res)
        return
      }
      if (req.method === 'POST' && req.url === '/login') {
        await handleLogin(req, res)
        return
      }
      if (req.method === 'GET' && req.url === '/logout') {
        res.writeHead(302, {
          'Set-Cookie': [
            sessionCookie('', { maxAge: 0 }),
            openWebUiTokenCookie('', { maxAge: 0 }),
          ],
          Location: '/login',
        })
        res.end()
        return
      }
      if (req.method === 'POST' && req.url === '/feishu/events') {
        const { raw, body } = await readRawJson(req)
        const result = await createFeishuBotHandler().handle({ body, rawBody: raw, headers: req.headers })
        sendJson(res, result.status, result.body)
        return
      }
      if (req.method === 'GET' && req.url === '/auth/session') {
        const authorizedEmail = getAuthorizedEmail(req)
        if (authorizedEmail) {
          res.writeHead(204, {
            'X-Auth-Email': authorizedEmail,
            'X-Auth-Name': authorizedEmail.split('@')[0] ?? authorizedEmail,
          })
          res.end()
        } else {
          sendAuthCheckUnauthorized(res)
        }
        return
      }
      if (req.method === 'POST' && req.url === '/api/v1/auths/signin') {
        await handleOpenWebUiTrustedSignin(req, res)
        return
      }
      if (!isAuthorized(req)) {
        sendUnauthorized(res)
        return
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && isAppRoute(req.url)) {
        sendHtml(res, 200, renderPmoAppHtml())
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/api/app/state')) {
        const url = new URL(req.url, 'http://localhost')
        const reportsDir = url.searchParams.get('reportsDir') ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const date = url.searchParams.get('date') ?? undefined
        sendJson(res, 200, await loadPmoAppState({ reportsDir, publicBaseUrl: process.env.PMO_PUBLIC_BASE_URL, date }))
        return
      }
      if (req.method === 'POST' && req.url === '/api/app/agent') {
        const body = await readJson(req)
        if (!body?.message || typeof body.message !== 'string') {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'message is required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const date = typeof body.date === 'string' ? body.date : undefined
        const state = await loadPmoAppState({ reportsDir, publicBaseUrl: process.env.PMO_PUBLIC_BASE_URL, date })
        sendJson(res, 200, { success: true, answer: answerPmoQuestion(body.message, state) })
        return
      }
      if (req.method === 'GET' && req.url === '/preflight') {
        const preflight = sanitizePreflightReport(await (options.preflight ?? runPreflight)())
        sendJson(res, preflight.status === 'fail' ? 503 : 200, { success: preflight.status !== 'fail', preflight })
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/reports/')) {
        if (await serveReportFile(req, res)) return
      }
      if (req.method === 'POST' && req.url === '/actions/invoke') {
        const body = await readJson(req)
        const action = body?.action as PmoBridgeActionName | undefined
        if (!action) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'action is required' } })
          return
        }
        const result = await runPmoBridgeAction(action, body.input ?? {})
        sendJson(res, result.success ? 200 : 400, result)
        return
      }
      if (req.method === 'POST' && req.url === '/runs/daily') {
        const body = await readJson(req)
        if (!body?.date) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'date is required' } })
          return
        }
        const run = await runDailyAudit({
          date: body.date,
          reportsDir: body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports',
          maxProjects: body.maxProjects,
          storiesFixture: body.storiesFixture,
        })
        sendJson(res, run.status === 'success' ? 200 : 500, { success: run.status === 'success', run })
        return
      }
      if (req.method === 'POST' && req.url === '/runs/agent-cycle') {
        const body = await readJson(req)
        if (!body?.date) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'date is required' } })
          return
        }
        const run = await runDailyAgentCycle({
          date: body.date,
          reportsDir: body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports',
          maxProjects: body.maxProjects,
          storiesFixture: body.storiesFixture,
          createCommunicationDrafts: body.createCommunicationDrafts !== false,
          buildPersonDirectory: body.buildPersonDirectory !== false,
          createFeishuDoc: body.createFeishuDoc === true,
          createReportDeliveryDraft: body.createReportDeliveryDraft === true,
          reportRecipient: body.reportRecipient,
          analyzeWithModels: body.analyzeWithModels === true,
          enrichContext: body.enrichContext === true,
          docsFixture: body.docsFixture,
        })
        sendJson(res, run.status === 'success' ? 200 : 500, { success: run.status === 'success', run })
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/runs')) {
        const url = new URL(req.url, 'http://localhost')
        const reportsDir = url.searchParams.get('reportsDir') ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const runDetail = /^\/runs\/([^/]+)$/.exec(url.pathname)
        if (runDetail) {
          const run = await getRunRecord(reportsDir, decodeURIComponent(runDetail[1]!))
          if (!run) {
            sendJson(res, 404, { success: false, error: { code: 'run_not_found', message: 'Run not found' } })
            return
          }
          sendJson(res, 200, { success: true, run })
          return
        }
        sendJson(res, 200, { runs: await listRunRecords(reportsDir) })
        return
      }
      if (req.method === 'POST' && req.url?.startsWith('/runs/')) {
        const url = new URL(req.url, 'http://localhost')
        const retryMatch = /^\/runs\/([^/]+)\/retry-stage$/.exec(url.pathname)
        if (retryMatch) {
          const body = await readJson(req)
          if (body?.stage !== 'create_communication_drafts') {
            sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'stage must be create_communication_drafts' } })
            return
          }
          const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
          const run = await retryRunStage({ reportsDir, runId: decodeURIComponent(retryMatch[1]!), stage: body.stage })
          sendJson(res, run.status === 'success' ? 200 : 500, { success: run.status === 'success', run })
          return
        }
      }
      if (req.method === 'POST' && req.url === '/scheduler/tick') {
        const body = await readJson(req)
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const decision = evaluateDailySchedule({
          now: body.now ? new Date(body.now) : new Date(),
          runAt: body.runAt ?? process.env.PMO_DAILY_RUN_AT ?? '09:00',
          runs: await listRunRecords(reportsDir),
        })
        if (!decision.due) {
          sendJson(res, 200, { success: true, skipped: true, decision })
          return
        }
        if (body.skipPreflight !== true) {
          const preflight = sanitizePreflightReport(await (options.preflight ?? runPreflight)())
          const guard = schedulerPreflightGuard(preflight, { createFeishuDoc: body.createFeishuDoc === true })
          if (guard.status === 'blocked') {
            sendJson(res, 503, { success: false, skipped: true, decision, guard, preflight })
            return
          }
        }
        const run = body.runMode === 'daily_audit'
          ? await runDailyAudit({
              date: decision.date,
              reportsDir,
              maxProjects: body.maxProjects,
              storiesFixture: body.storiesFixture,
            })
          : await runDailyAgentCycle({
              date: decision.date,
              reportsDir,
              maxProjects: body.maxProjects,
              storiesFixture: body.storiesFixture,
              createCommunicationDrafts: body.createCommunicationDrafts !== false,
              buildPersonDirectory: body.buildPersonDirectory !== false,
              createFeishuDoc: body.createFeishuDoc === true,
              createReportDeliveryDraft: body.createReportDeliveryDraft === true,
              reportRecipient: body.reportRecipient,
              analyzeWithModels: body.analyzeWithModels === true,
              enrichContext: body.enrichContext === true,
              docsFixture: body.docsFixture,
            })
        sendJson(res, run.status === 'success' ? 200 : 500, { success: run.status === 'success', skipped: false, decision, run })
        return
      }
      if (req.method === 'POST' && req.url === '/drafts/from-report') {
        const body = await readJson(req)
        if (!body?.reportPath) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'reportPath is required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const drafts = await createCommunicationDraftsFromReport({
          reportsDir,
          reportPath: body.reportPath,
          personDirectory: body.personDirectory,
          policy: body.policy,
          now: body.now ? new Date(body.now) : undefined,
        })
        sendJson(res, 200, { success: true, drafts })
        return
      }
      if (req.method === 'POST' && req.url === '/drafts/approve') {
        const body = await readJson(req)
        if (!body?.draftId || !body?.actor) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'draftId and actor are required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const draft = await approveCommunicationDraft({ reportsDir, draftId: body.draftId, actor: body.actor, note: body.note })
        sendJson(res, 200, { success: true, draft })
        return
      }
      if (req.method === 'POST' && req.url === '/drafts/reject') {
        const body = await readJson(req)
        if (!body?.draftId || !body?.actor) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'draftId and actor are required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const draft = await rejectCommunicationDraft({ reportsDir, draftId: body.draftId, actor: body.actor, note: body.note })
        sendJson(res, 200, { success: true, draft })
        return
      }
      if (req.method === 'POST' && req.url === '/drafts/deliver') {
        const body = await readJson(req)
        if (!body?.draftId || !body?.actor) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'draftId and actor are required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const result = await deliverCommunicationDraft({ reportsDir, draftId: body.draftId, actor: body.actor, dryRun: body.dryRun !== false })
        sendJson(res, result.success ? 200 : 400, result)
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/drafts/audit')) {
        const url = new URL(req.url, 'http://localhost')
        const reportsDir = url.searchParams.get('reportsDir') ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        sendJson(res, 200, { events: await listCommunicationDraftAuditEvents(reportsDir) })
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/drafts')) {
        const url = new URL(req.url, 'http://localhost')
        const reportsDir = url.searchParams.get('reportsDir') ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        sendJson(res, 200, { drafts: await listCommunicationDrafts(reportsDir) })
        return
      }
      if (req.method === 'POST' && req.url === '/checkins/record') {
        const body = await readJson(req)
        if (!body?.storyId || !body?.responder || !body?.text) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'storyId, responder, and text are required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const record = await recordCheckInReply({
          reportsDir,
          storyId: body.storyId,
          draftId: body.draftId,
          responder: body.responder,
          text: body.text,
          now: body.now ? new Date(body.now) : undefined,
        })
        sendJson(res, 200, { success: true, record })
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/checkins')) {
        const url = new URL(req.url, 'http://localhost')
        const reportsDir = url.searchParams.get('reportsDir') ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        sendJson(res, 200, { records: await listCheckInRecords(reportsDir) })
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/project-update-actions')) {
        const url = new URL(req.url, 'http://localhost')
        const reportsDir = url.searchParams.get('reportsDir') ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        sendJson(res, 200, { actions: await listProjectUpdateActions(reportsDir) })
        return
      }
      if (req.method === 'POST' && req.url === '/project-update-actions/approve') {
        const body = await readJson(req)
        if (!body?.actionId || !body?.actor) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'actionId and actor are required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const action = await approveProjectUpdateAction({ reportsDir, actionId: body.actionId, actor: body.actor, note: body.note })
        sendJson(res, 200, { success: true, action })
        return
      }
      if (req.method === 'POST' && req.url === '/project-update-actions/reject') {
        const body = await readJson(req)
        if (!body?.actionId || !body?.actor) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'actionId and actor are required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const action = await rejectProjectUpdateAction({ reportsDir, actionId: body.actionId, actor: body.actor, note: body.note })
        sendJson(res, 200, { success: true, action })
        return
      }
      if (req.method === 'POST' && req.url === '/project-update-actions/apply') {
        const body = await readJson(req)
        if (!body?.actionId || !body?.actor) {
          sendJson(res, 400, { success: false, error: { code: 'invalid_request', message: 'actionId and actor are required' } })
          return
        }
        const reportsDir = body.reportsDir ?? process.env.PMO_REPORTS_DIR ?? 'reports'
        const result = await applyProjectUpdateAction({ reportsDir, actionId: body.actionId, actor: body.actor, mapping: body.mapping, projectKey: body.projectKey })
        sendJson(res, 200, result)
        return
      }
      sendJson(res, 404, { success: false, error: { code: 'not_found', message: 'Not found' } })
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: {
          code: 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  })
}

function schedulerPreflightGuard(
  preflight: PreflightReport,
  options: { createFeishuDoc: boolean },
): {
  status: 'pass' | 'blocked'
  reason?: 'preflight_failed' | 'feishu_doc_preflight_not_ready'
  blockingChecks?: PreflightReport['checks']
} {
  const failedChecks = preflight.checks.filter(check => check.status === 'fail')
  if (failedChecks.length > 0) {
    return { status: 'blocked', reason: 'preflight_failed', blockingChecks: failedChecks }
  }

  if (options.createFeishuDoc) {
    const larkCheck = preflight.checks.find(check => check.name.toLowerCase().includes('lark-mcp'))
    if (!larkCheck || larkCheck.status !== 'pass') {
      return {
        status: 'blocked',
        reason: 'feishu_doc_preflight_not_ready',
        blockingChecks: larkCheck ? [larkCheck] : [],
      }
    }
  }

  return { status: 'pass' }
}

function sanitizePreflightReport(preflight: PreflightReport): PreflightReport {
  return {
    ...preflight,
    checks: preflight.checks.map(check => ({
      ...check,
      detail: sanitizeText(check.detail),
      nextStep: check.nextStep ? sanitizeText(check.nextStep) : undefined,
    })),
  }
}

function sanitizeText(value: string): string {
  return value
    .replace(/\b(token|password|api[_-]?key|secret)\b/gi, 'credential')
    .replace(/([A-Za-z0-9_-]{8,}\.)?[A-Za-z0-9_-]{16,}/g, '[redacted]')
}

function isAuthorized(req: IncomingMessage): boolean {
  return Boolean(getAuthorizedEmail(req))
}

function getAuthorizedEmail(req: IncomingMessage): string | undefined {
  const configured = process.env.PMO_HTTP_BASIC_AUTH
  if (!configured) return 'pmo-agent@local'
  const sessionUser = authorizedSessionUser(req)
  if (sessionUser) return sessionUser
  const header = req.headers.authorization
  if (!header?.startsWith('Basic ')) return undefined
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator < 0) return undefined
  const username = decoded.slice(0, separator).trim().toLowerCase()
  const password = decoded.slice(separator + 1)
  return isAllowedBasicAuthUser(username) && password === configuredPassword(configured) ? username : undefined
}

function configuredPassword(configured: string): string {
  const separator = configured.indexOf(':')
  return separator >= 0 ? configured.slice(separator + 1) : configured
}

function isAllowedBasicAuthUser(username: string): boolean {
  const normalized = username.trim().toLowerCase()
  return normalized === 'maas' || normalized.endsWith('@aminer.cn') || normalized.endsWith('@z.ai')
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readForm(req)
  const user = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const configured = process.env.PMO_HTTP_BASIC_AUTH
  const next = safeNextUrl(String(body.next ?? '/'))
  if (configured && isAllowedBasicAuthUser(user) && password === configuredPassword(configured)) {
    const openWebUiCookies = await createOpenWebUiSessionCookies(user)
    res.writeHead(302, {
      'Set-Cookie': [sessionCookie(createSessionToken(user), { maxAge: 7 * 24 * 60 * 60 }), ...openWebUiCookies],
      Location: next,
    })
    res.end()
    return
  }
  sendLoginPage(req, res, { error: '账号或密码不正确。允许 maas 管理员账号，以及 @aminer.cn / @z.ai 邮箱。', email: user })
}

async function createOpenWebUiSessionCookies(user: string): Promise<string[]> {
  const response = await signInOpenWebUiWithTrustedHeaders(user).catch(() => undefined)
  if (!response?.ok) return []
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (headers.getSetCookie) return headers.getSetCookie()
  const cookie = response.headers.get('set-cookie')
  return cookie ? [cookie] : []
}

async function handleOpenWebUiTrustedSignin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = getAuthorizedEmail(req)
  if (!user) {
    sendJson(res, 401, { detail: 'Not authenticated' })
    return
  }

  const response = await signInOpenWebUiWithTrustedHeaders(user).catch(error => {
    process.stderr.write(`[pmo-auth] openwebui_trusted_signin_failed ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n`)
    return undefined
  })
  if (!response) {
    sendJson(res, 502, { detail: 'Open WebUI trusted signin failed' })
    return
  }

  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = headers.getSetCookie ? headers.getSetCookie() : response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []
  res.writeHead(response.status, {
    'Content-Type': response.headers.get('content-type') ?? 'application/json',
    ...(setCookies.length ? { 'Set-Cookie': setCookies } : {}),
  })
  res.end(await response.text())
}

async function signInOpenWebUiWithTrustedHeaders(user: string): Promise<Response> {
  const baseUrl = process.env.PMO_OPEN_WEBUI_INTERNAL_URL
  if (!baseUrl) throw new Error('PMO_OPEN_WEBUI_INTERNAL_URL is not configured')
  const trustedIdentity = openWebUiTrustedIdentity(user)

  return fetch(new URL('/api/v1/auths/signin', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Email': trustedIdentity.email,
      'X-Forwarded-User': trustedIdentity.name,
    },
    body: JSON.stringify({ email: 'trusted-header@example.invalid', password: 'trusted-header' }),
  })
}

function openWebUiTrustedIdentity(user: string): { email: string; name: string } {
  const normalized = user.trim().toLowerCase()
  if (normalized === 'maas') return { email: 'maas@z.ai', name: 'maas' }
  return { email: normalized, name: normalized.split('@')[0] ?? normalized }
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
  return Object.fromEntries(params.entries())
}

function sendLoginPage(req: IncomingMessage, res: ServerResponse, options: { error?: string; email?: string } = {}): void {
  const next = safeNextUrl(new URL(req.url ?? '/login', 'http://localhost').searchParams.get('next') ?? '/')
  const error = options.error ? `<div class="error">${escapeHtml(options.error)}</div>` : ''
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PMO Agent 登录</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;color:#17202a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(420px,calc(100vw - 32px));background:white;border:1px solid #d8dee6;border-radius:8px;padding:28px;box-shadow:0 18px 45px rgba(23,32,42,.08)}
    h1{font-size:22px;margin:0 0 8px} p{margin:0 0 22px;color:#5d6978;line-height:1.5}
    label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}
    input{box-sizing:border-box;width:100%;height:42px;border:1px solid #cbd3dc;border-radius:6px;padding:0 12px;font-size:15px}
    button{width:100%;height:42px;border:0;border-radius:6px;margin-top:22px;background:#1f5eff;color:white;font-weight:700;font-size:15px;cursor:pointer}
    .hint{font-size:12px;color:#718096;margin-top:14px}.error{border:1px solid #ffc9c9;background:#fff1f1;color:#b42318;padding:10px 12px;border-radius:6px;margin:12px 0}
  </style>
</head>
<body>
  <main>
    <h1>PMO Agent 登录</h1>
          <p>使用 maas 管理员账号，或公司邮箱访问；密码统一为当前 PMO 访问密码。</p>
    ${error}
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}" />
      <label for="email">账号</label>
      <input id="email" name="email" type="text" autocomplete="username" required placeholder="maas 或 name@aminer.cn" value="${escapeHtml(options.email ?? '')}" />
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">登录</button>
    </form>
    <div class="hint">允许 maas 管理员账号、@aminer.cn 和 @z.ai 后缀邮箱。</div>
  </main>
</body>
</html>`
  sendHtml(res, options.error ? 401 : 200, html)
}

function isAuthorizedBySession(req: IncomingMessage): boolean {
  return Boolean(authorizedSessionUser(req))
}

function authorizedSessionUser(req: IncomingMessage): string | undefined {
  const token = parseCookies(req.headers.cookie).pmo_session
  if (!token) return undefined
  const user = verifySessionToken(token)
  return user && isAllowedBasicAuthUser(user) ? user : undefined
}

function createSessionToken(user: string): string {
  const payload = base64UrlEncode(JSON.stringify({ email: user, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }))
  return `${payload}.${signSessionPayload(payload)}`
}

function verifySessionToken(token: string): string | undefined {
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !timingSafeStringEqual(signature, signSessionPayload(payload))) return undefined
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string; exp?: number }
    if (!data.email || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return undefined
    return data.email
  } catch {
    return undefined
  }
}

function signSessionPayload(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
}

function sessionSecret(): string {
  return process.env.PMO_SESSION_SECRET ?? process.env.PMO_OPENAI_API_KEY ?? process.env.PMO_HTTP_BASIC_AUTH ?? 'pmo-agent-local-session'
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return cookies
}

function sessionCookie(value: string, options: { maxAge: number }): string {
  return `pmo_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${options.maxAge}`
}

function openWebUiTokenCookie(value: string, options: { maxAge: number }): string {
  return `token=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${options.maxAge}`
}

function safeNextUrl(value: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

function sendUnauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="PMO Agent"',
  })
  res.end(`${JSON.stringify({ success: false, error: { code: 'unauthorized', message: 'Authentication required' } })}\n`)
}

function sendAuthCheckUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify({ success: false, error: { code: 'unauthorized', message: 'Authentication required' } })}\n`)
}

function isAppRoute(url: string | undefined): boolean {
  if (!url) return false
  const pathname = new URL(url, 'http://localhost').pathname
  return pathname === '/app' || pathname.startsWith('/app/')
}

async function serveReportFile(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (process.env.PMO_SERVE_REPORTS !== 'true') return false
  const url = new URL(req.url ?? '', 'http://localhost')
  const rawName = decodeURIComponent(url.pathname.replace(/^\/reports\//, ''))
  if (!rawName || rawName !== basename(rawName) || rawName.startsWith('.')) return false
  const extension = extname(rawName)
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }
  const contentType = contentTypes[extension]
  if (!contentType) return false
  try {
    const reportsDir = process.env.PMO_REPORTS_DIR ?? 'reports'
    const content = await readFile(join(reportsDir, rawName))
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
    return true
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage): Promise<any> {
  return (await readRawJson(req)).body
}

async function readRawJson(req: IncomingMessage): Promise<{ raw: string; body: any }> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  return { raw, body: raw ? JSON.parse(raw) : {} }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body)}\n`)
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

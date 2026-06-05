import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPmoActionServer } from '../src/server/action-server.js'

describe('PMO action HTTP server', () => {
  it('handles structured action invoke requests without exposing secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-action-server-'))
    const reportPath = join(dir, 'report.json')
    await writeFile(reportPath, JSON.stringify({
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
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/actions/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pmo_build_state_snapshot', input: { factsPath: reportPath } }),
      })
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.result.summary.stories).toBe(1)
      expect(body.result.workstreams[0].name).toBe('客服 Agent')
      expect(JSON.stringify(body)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  })

  it('returns structured preflight readiness without exposing secrets', async () => {
    const server = createPmoActionServer({
      preflight: async () => ({
        status: 'warn',
        generatedAt: '2026-05-31T01:00:00.000Z',
        summary: { passed: 1, warnings: 1, failed: 0 },
        checks: [
          { name: 'GitLab open-platform', status: 'pass', detail: 'Connected.' },
          { name: 'Feishu IM delivery', status: 'warn', detail: 'Dry-run only.' },
        ],
      }),
    })
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/preflight`)
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body).toMatchObject({ success: true, preflight: { status: 'warn', summary: { warnings: 1 } } })
      expect(JSON.stringify(body)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  })

  it('serves generated report files only when explicitly enabled', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-static-reports-'))
    await writeFile(join(reportsDir, 'latest-pmo-audit.html'), '<!doctype html><title>PMO</title>')
    const previousServeReports = process.env.PMO_SERVE_REPORTS
    const previousReportsDir = process.env.PMO_REPORTS_DIR
    process.env.PMO_SERVE_REPORTS = 'true'
    process.env.PMO_REPORTS_DIR = reportsDir
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/reports/latest-pmo-audit.html`)
      const html = await res.text()
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      expect(html).toContain('<title>PMO</title>')

      const traversal = await fetch(`http://127.0.0.1:${address.port}/reports/../.env.local`)
      expect(traversal.status).toBe(404)
    } finally {
      server.close()
      if (previousServeReports === undefined) delete process.env.PMO_SERVE_REPORTS
      else process.env.PMO_SERVE_REPORTS = previousServeReports
      if (previousReportsDir === undefined) delete process.env.PMO_REPORTS_DIR
      else process.env.PMO_REPORTS_DIR = previousReportsDir
    }
  })

  it('protects reports and action APIs with optional HTTP basic auth', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-basic-auth-'))
    await writeFile(join(reportsDir, 'latest-pmo-audit.html'), '<!doctype html><title>PMO</title>')
    const previousServeReports = process.env.PMO_SERVE_REPORTS
    const previousReportsDir = process.env.PMO_REPORTS_DIR
    const previousAuth = process.env.PMO_HTTP_BASIC_AUTH
    process.env.PMO_SERVE_REPORTS = 'true'
    process.env.PMO_REPORTS_DIR = reportsDir
    process.env.PMO_HTTP_BASIC_AUTH = 'admin:secret'
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const health = await fetch(`http://127.0.0.1:${address.port}/health`)
      expect(health.status).toBe(200)

      const reportWithoutAuth = await fetch(`http://127.0.0.1:${address.port}/reports/latest-pmo-audit.html`)
      expect(reportWithoutAuth.status).toBe(401)

      const runsWithoutAuth = await fetch(`http://127.0.0.1:${address.port}/runs`)
      expect(runsWithoutAuth.status).toBe(401)

      const reportWithAminerAuth = await fetch(`http://127.0.0.1:${address.port}/reports/latest-pmo-audit.html`, {
        headers: { Authorization: `Basic ${Buffer.from('user@aminer.cn:secret').toString('base64')}` },
      })
      expect(reportWithAminerAuth.status).toBe(200)
      expect(await reportWithAminerAuth.text()).toContain('<title>PMO</title>')

      const reportWithZaiAuth = await fetch(`http://127.0.0.1:${address.port}/reports/latest-pmo-audit.html`, {
        headers: { Authorization: `Basic ${Buffer.from('user@z.ai:secret').toString('base64')}` },
      })
      expect(reportWithZaiAuth.status).toBe(200)

      const reportWithOtherDomain = await fetch(`http://127.0.0.1:${address.port}/reports/latest-pmo-audit.html`, {
        headers: { Authorization: `Basic ${Buffer.from('user@example.com:secret').toString('base64')}` },
      })
      expect(reportWithOtherDomain.status).toBe(401)

      const reportWithWrongPassword = await fetch(`http://127.0.0.1:${address.port}/reports/latest-pmo-audit.html`, {
        headers: { Authorization: `Basic ${Buffer.from('user@aminer.cn:wrong').toString('base64')}` },
      })
      expect(reportWithWrongPassword.status).toBe(401)
    } finally {
      server.close()
      if (previousServeReports === undefined) delete process.env.PMO_SERVE_REPORTS
      else process.env.PMO_SERVE_REPORTS = previousServeReports
      if (previousReportsDir === undefined) delete process.env.PMO_REPORTS_DIR
      else process.env.PMO_REPORTS_DIR = previousReportsDir
      if (previousAuth === undefined) delete process.env.PMO_HTTP_BASIC_AUTH
      else process.env.PMO_HTTP_BASIC_AUTH = previousAuth
    }
  })

  it('exposes a session auth check endpoint for the reverse proxy email-domain gate', async () => {
    const previousAuth = process.env.PMO_HTTP_BASIC_AUTH
    process.env.PMO_HTTP_BASIC_AUTH = 'maas:test-password'
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const aminer = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
        headers: { Authorization: `Basic ${Buffer.from('user@aminer.cn:test-password').toString('base64')}` },
      })
      expect(aminer.status).toBe(204)
      expect(aminer.headers.get('x-auth-email')).toBe('user@aminer.cn')

      const zai = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
        headers: { Authorization: `Basic ${Buffer.from('user@z.ai:test-password').toString('base64')}` },
      })
      expect(zai.status).toBe(204)
      expect(zai.headers.get('x-auth-email')).toBe('user@z.ai')

      const maas = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
        headers: { Authorization: `Basic ${Buffer.from('maas:test-password').toString('base64')}` },
      })
      expect(maas.status).toBe(204)
      expect(maas.headers.get('x-auth-email')).toBe('maas')

      const otherDomain = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
        headers: { Authorization: `Basic ${Buffer.from('user@example.com:test-password').toString('base64')}` },
      })
      expect(otherDomain.status).toBe(401)

      const wrongPassword = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
        headers: { Authorization: `Basic ${Buffer.from('user@aminer.cn:wrong').toString('base64')}` },
      })
      expect(wrongPassword.status).toBe(401)
    } finally {
      server.close()
      if (previousAuth === undefined) delete process.env.PMO_HTTP_BASIC_AUTH
      else process.env.PMO_HTTP_BASIC_AUTH = previousAuth
    }
  })

  it('sets a login session cookie for allowed company email domains', async () => {
    const previousAuth = process.env.PMO_HTTP_BASIC_AUTH
    const previousSecret = process.env.PMO_SESSION_SECRET
    process.env.PMO_HTTP_BASIC_AUTH = 'maas:test-password'
    process.env.PMO_SESSION_SECRET = 'test-session-secret'
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const loginPage = await fetch(`http://127.0.0.1:${address.port}/login?next=/app`)
      expect(loginPage.status).toBe(200)
      expect(await loginPage.text()).toContain('PMO Agent 登录')

      const login = await fetch(`http://127.0.0.1:${address.port}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'user@aminer.cn', password: 'test-password', next: '/app' }),
      })
      expect(login.status).toBe(302)
      expect(login.headers.get('location')).toBe('/app')
      const cookie = login.headers.get('set-cookie')
      expect(cookie).toContain('pmo_session=')

      const authCheck = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
        headers: { cookie: cookie ?? '' },
      })
      expect(authCheck.status).toBe(204)
      expect(authCheck.headers.get('x-auth-email')).toBe('user@aminer.cn')

      const adminLogin = await fetch(`http://127.0.0.1:${address.port}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'maas', password: 'test-password', next: '/app' }),
      })
      expect(adminLogin.status).toBe(302)
      expect(adminLogin.headers.get('location')).toBe('/app')
      const adminCookie = adminLogin.headers.get('set-cookie')
      expect(adminCookie).toContain('pmo_session=')

      const adminAuthCheck = await fetch(`http://127.0.0.1:${address.port}/auth/session`, {
        headers: { cookie: adminCookie ?? '' },
      })
      expect(adminAuthCheck.status).toBe(204)
      expect(adminAuthCheck.headers.get('x-auth-email')).toBe('maas')

      const denied = await fetch(`http://127.0.0.1:${address.port}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'user@example.com', password: 'test-password', next: '/app' }),
      })
      expect(denied.status).toBe(401)
    } finally {
      server.close()
      if (previousAuth === undefined) delete process.env.PMO_HTTP_BASIC_AUTH
      else process.env.PMO_HTTP_BASIC_AUTH = previousAuth
      if (previousSecret === undefined) delete process.env.PMO_SESSION_SECRET
      else process.env.PMO_SESSION_SECRET = previousSecret
    }
  })

  it('can attach an Open WebUI trusted-header session cookie during login', async () => {
    const previousAuth = process.env.PMO_HTTP_BASIC_AUTH
    const previousSecret = process.env.PMO_SESSION_SECRET
    const previousOpenWebUiUrl = process.env.PMO_OPEN_WEBUI_INTERNAL_URL
    process.env.PMO_HTTP_BASIC_AUTH = 'maas:test-password'
    process.env.PMO_SESSION_SECRET = 'test-session-secret'

    const openWebUiSigninCalls: { email?: string; name?: string }[] = []
    const openWebUi = createServer((req, res) => {
      openWebUiSigninCalls.push({
        email: String(req.headers['x-forwarded-email'] ?? ''),
        name: String(req.headers['x-forwarded-user'] ?? ''),
      })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'token=open-webui-session; Path=/; HttpOnly; SameSite=Lax',
      })
      res.end(JSON.stringify({ ok: true }))
    })
    openWebUi.listen(0)
    await once(openWebUi, 'listening')
    const openWebUiAddress = openWebUi.address()
    if (!openWebUiAddress || typeof openWebUiAddress === 'string') throw new Error('Expected tcp server address')
    process.env.PMO_OPEN_WEBUI_INTERNAL_URL = `http://127.0.0.1:${openWebUiAddress.port}`

    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const login = await fetch(`http://127.0.0.1:${address.port}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'user@aminer.cn', password: 'test-password', next: '/' }),
      })

      expect(login.status).toBe(302)
      const setCookies = login.headers.getSetCookie()
      expect(setCookies.some(cookie => cookie.startsWith('pmo_session='))).toBe(true)
      expect(setCookies.some(cookie => cookie.startsWith('token=open-webui-session'))).toBe(true)
      expect(openWebUiSigninCalls).toEqual([{ email: 'user@aminer.cn', name: 'user' }])

      const maasLogin = await fetch(`http://127.0.0.1:${address.port}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'maas', password: 'test-password', next: '/' }),
      })
      expect(maasLogin.status).toBe(302)
      expect(openWebUiSigninCalls.at(-1)).toEqual({ email: 'maas@z.ai', name: 'maas' })
    } finally {
      server.close()
      openWebUi.close()
      if (previousAuth === undefined) delete process.env.PMO_HTTP_BASIC_AUTH
      else process.env.PMO_HTTP_BASIC_AUTH = previousAuth
      if (previousSecret === undefined) delete process.env.PMO_SESSION_SECRET
      else process.env.PMO_SESSION_SECRET = previousSecret
      if (previousOpenWebUiUrl === undefined) delete process.env.PMO_OPEN_WEBUI_INTERNAL_URL
      else process.env.PMO_OPEN_WEBUI_INTERNAL_URL = previousOpenWebUiUrl
    }
  })

  it('clears both PMO and Open WebUI cookies on logout', async () => {
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const logout = await fetch(`http://127.0.0.1:${address.port}/logout`, { redirect: 'manual' })
      expect(logout.status).toBe(302)
      expect(logout.headers.get('location')).toBe('/login')
      const setCookies = logout.headers.getSetCookie()
      expect(setCookies.some(cookie => cookie.startsWith('pmo_session=') && cookie.includes('Max-Age=0'))).toBe(true)
      expect(setCookies.some(cookie => cookie.startsWith('token=') && cookie.includes('Max-Age=0'))).toBe(true)
    } finally {
      server.close()
    }
  })

  it('serves the PMO web app and app APIs behind HTTP basic auth', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-web-app-'))
    await writeFile(join(reportsDir, '2026-06-02-pmo-audit.json'), JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-06-02',
      date: '2026-06-02',
      summary: { stories: 1, focused: 1, suppressed: 0, highPriorityRisks: 1, progressed: 1, risky: 1, incomplete: 1, suggestedContacts: 1 },
      storyAudits: [{
        story: { id: 'S1', title: '企业套餐购买', status: '开发阶段', owners: [{ name: '王建辉' }], linkedDocs: [], fields: {}, url: 'https://project.feishu.cn/story/detail/S1' },
        evidence: [],
        risks: [{
          id: 'S1:missing_goal',
          storyId: 'S1',
          type: 'missing_goal',
          severity: 'high',
          priority: 'P1',
          description: '需求缺少明确目标。',
          evidenceIds: [],
          suggestedAction: '找 owner 补目标。',
        }],
        confidence: 'confirmed',
        progressSummary: 'MR 已打开。',
      }],
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
    }))
    const previousReportsDir = process.env.PMO_REPORTS_DIR
    const previousAuth = process.env.PMO_HTTP_BASIC_AUTH
    const previousBaseUrl = process.env.PMO_PUBLIC_BASE_URL
    process.env.PMO_REPORTS_DIR = reportsDir
    process.env.PMO_HTTP_BASIC_AUTH = 'admin:secret'
    process.env.PMO_PUBLIC_BASE_URL = 'https://pmo.hongliang.app'
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    const auth = { Authorization: `Basic ${Buffer.from('user@aminer.cn:secret').toString('base64')}` }
    try {
      const withoutAuth = await fetch(`http://127.0.0.1:${address.port}/app`)
      expect(withoutAuth.status).toBe(401)

      const app = await fetch(`http://127.0.0.1:${address.port}/app`, { headers: auth })
      const html = await app.text()
      expect(app.status).toBe(200)
      expect(html).toContain('PMO Agent')
      expect(html).toContain('/api/app/state')
      expect(html).toContain('data-view="stories"')
      expect(html).toContain('data-view="settings"')

      const deepLink = await fetch(`http://127.0.0.1:${address.port}/app/risks`, { headers: auth })
      expect(deepLink.status).toBe(200)
      expect(await deepLink.text()).toContain('pathViewMap')

      const chatLink = await fetch(`http://127.0.0.1:${address.port}/app/chat`, { headers: auth })
      expect(chatLink.status).toBe(200)
      const chatHtml = await chatLink.text()
      expect(chatHtml).toContain('data-view="chat"')
      expect(chatHtml).toContain('pmo-chat-composer')
      expect(chatHtml).toContain('Open WebUI')

      const settingsLink = await fetch(`http://127.0.0.1:${address.port}/app/settings`, { method: 'HEAD', headers: auth })
      expect(settingsLink.status).toBe(200)

      const stateRes = await fetch(`http://127.0.0.1:${address.port}/api/app/state`, { headers: auth })
      const state = await stateRes.json() as any
      expect(state.latestReport.date).toBe('2026-06-02')
      expect(state.risks[0].storyTitle).toBe('企业套餐购买')
      expect(state.settings.dataSources.length).toBeGreaterThan(0)

      const agentRes = await fetch(`http://127.0.0.1:${address.port}/api/app/agent`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '今天有哪些风险？', date: '2026-06-02' }),
      })
      const agent = await agentRes.json() as any
      expect(agent.answer.intent).toBe('risks')
      expect(agent.answer.text).toContain('企业套餐购买')
    } finally {
      server.close()
      if (previousReportsDir === undefined) delete process.env.PMO_REPORTS_DIR
      else process.env.PMO_REPORTS_DIR = previousReportsDir
      if (previousAuth === undefined) delete process.env.PMO_HTTP_BASIC_AUTH
      else process.env.PMO_HTTP_BASIC_AUTH = previousAuth
      if (previousBaseUrl === undefined) delete process.env.PMO_PUBLIC_BASE_URL
      else process.env.PMO_PUBLIC_BASE_URL = previousBaseUrl
    }
  })

  it('accepts Feishu bot event verification without HTTP basic auth', async () => {
    const previousAuth = process.env.PMO_HTTP_BASIC_AUTH
    const previousToken = process.env.PMO_FEISHU_EVENT_VERIFICATION_TOKEN
    process.env.PMO_HTTP_BASIC_AUTH = 'admin:secret'
    process.env.PMO_FEISHU_EVENT_VERIFICATION_TOKEN = 'verify-token'
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/feishu/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'verify-token', challenge: 'challenge-code' }),
      })
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body).toEqual({ challenge: 'challenge-code' })

      const reportWithoutAuth = await fetch(`http://127.0.0.1:${address.port}/runs`)
      expect(reportWithoutAuth.status).toBe(401)
    } finally {
      server.close()
      if (previousAuth === undefined) delete process.env.PMO_HTTP_BASIC_AUTH
      else process.env.PMO_HTTP_BASIC_AUTH = previousAuth
      if (previousToken === undefined) delete process.env.PMO_FEISHU_EVENT_VERIFICATION_TOKEN
      else process.env.PMO_FEISHU_EVENT_VERIFICATION_TOKEN = previousToken
    }
  })

  it('records daily run history for scheduler and agent follow-up', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-runs-'))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/runs/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-05-31',
          reportsDir,
          maxProjects: 0,
          storiesFixture: 'tests/fixtures/stories.json',
          createFeishuDoc: false,
          skipPreflight: true,
        }),
      })
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.run.status).toBe('success')
      expect(body.run.artifacts.jsonPath).toContain('2026-05-31-pmo-audit.json')

      const runs = JSON.parse(await readFile(join(reportsDir, 'runs.json'), 'utf8')) as any[]
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ date: '2026-05-31', status: 'success' })

      const listRes = await fetch(`http://127.0.0.1:${address.port}/runs?reportsDir=${encodeURIComponent(reportsDir)}`)
      const list = await listRes.json() as any
      expect(list.runs).toHaveLength(1)
    } finally {
      server.close()
    }
  }, 30_000)

  it('runs a full agent cycle with stage records and draft artifacts', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-cycle-server-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/runs/agent-cycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-05-31',
          reportsDir,
          maxProjects: 0,
          storiesFixture,
          createCommunicationDrafts: true,
          createFeishuDoc: false,
          analyzeWithModels: false,
        }),
      })
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.run.status).toBe('success')
      expect(body.run.stages.map((stage: any) => stage.name)).toEqual(['render_report', 'build_person_directory', 'create_communication_drafts'])
      expect(body.run.summary.draftsCreated).toBeGreaterThan(0)
      expect(body.run.artifacts.communicationDraftsPath).toContain('communication-drafts.json')
      expect(body.run.artifacts.opsDashboardHtmlPath).toContain('ops-dashboard.html')
      expect(body.run.artifacts.opsDashboardJsonPath).toContain('ops-dashboard.json')
      expect(JSON.stringify(body)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  }, 30_000)

  it('gets a run by id and retries the communication draft stage', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-run-retry-server-'))
    const storiesFixture = join(reportsDir, 'stories.json')
    await writeFile(storiesFixture, JSON.stringify([{
      id: 'S1',
      title: '企业套餐购买',
      status: '开发阶段',
      owners: [{ name: '王建辉' }],
      linkedDocs: [],
      fields: {},
      url: 'https://project.feishu.cn/story/detail/1',
      updatedAt: '2026-05-31T10:00:00Z',
    }]))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const runRes = await fetch(`http://127.0.0.1:${address.port}/runs/agent-cycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-05-31',
          reportsDir,
          maxProjects: 0,
          storiesFixture,
          createCommunicationDrafts: false,
          createFeishuDoc: false,
          analyzeWithModels: false,
        }),
      })
      const created = await runRes.json() as any
      const runId = created.run.id

      const getRes = await fetch(`http://127.0.0.1:${address.port}/runs/${encodeURIComponent(runId)}?reportsDir=${encodeURIComponent(reportsDir)}`)
      const found = await getRes.json() as any
      expect(getRes.status).toBe(200)
      expect(found.run).toMatchObject({ id: runId, status: 'success' })

      const retryRes = await fetch(`http://127.0.0.1:${address.port}/runs/${encodeURIComponent(runId)}/retry-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, stage: 'create_communication_drafts' }),
      })
      const retried = await retryRes.json() as any
      expect(retryRes.status).toBe(200)
      expect(retried.run.stages.find((stage: any) => stage.name === 'create_communication_drafts')).toMatchObject({
        status: 'success',
      })
      expect(retried.run.summary.draftsCreated).toBeGreaterThan(0)
      expect(JSON.stringify(retried)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  }, 30_000)

  it('ticks the daily scheduler only when due', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-scheduler-'))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const before = await fetch(`http://127.0.0.1:${address.port}/scheduler/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          now: '2026-05-31T00:59:00Z',
          runAt: '09:00',
          reportsDir,
          maxProjects: 0,
          storiesFixture: 'tests/fixtures/stories.json',
          createFeishuDoc: false,
          skipPreflight: true,
        }),
      })
      const beforeBody = await before.json() as any
      expect(beforeBody).toMatchObject({ success: true, skipped: true, decision: { reason: 'before_scheduled_time' } })

      const due = await fetch(`http://127.0.0.1:${address.port}/scheduler/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          now: '2026-05-31T01:01:00Z',
          runAt: '09:00',
          reportsDir,
          maxProjects: 0,
          storiesFixture: 'tests/fixtures/stories.json',
          createFeishuDoc: false,
          skipPreflight: true,
        }),
      })
      const dueBody = await due.json() as any
      expect(dueBody).toMatchObject({ success: true, skipped: false, run: { status: 'success', date: '2026-05-31' } })
      expect(dueBody.run.stages.map((stage: any) => stage.name)).toEqual(['render_report', 'build_person_directory', 'create_communication_drafts'])
      expect(dueBody.run.artifacts.opsDashboardHtmlPath).toContain('ops-dashboard.html')

      const again = await fetch(`http://127.0.0.1:${address.port}/scheduler/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          now: '2026-05-31T02:01:00Z',
          runAt: '09:00',
          reportsDir,
          maxProjects: 0,
          storiesFixture: 'tests/fixtures/stories.json',
        }),
      })
      const againBody = await again.json() as any
      expect(againBody).toMatchObject({ success: true, skipped: true, decision: { reason: 'already_ran' } })
    } finally {
      server.close()
    }
  }, 30_000)

  it('blocks scheduled agent cycles when required preflight checks fail', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-scheduler-preflight-'))
    const server = createPmoActionServer({
      preflight: async () => ({
        status: 'fail',
        generatedAt: '2026-05-31T01:00:00.000Z',
        summary: { passed: 1, warnings: 0, failed: 1 },
        checks: [
          { name: 'GitLab open-platform', status: 'pass', detail: 'Connected.' },
          { name: 'Feishu Project MCP', status: 'fail', detail: 'Unauthorized.', nextStep: 'Configure MCP token.' },
        ],
      }),
    })
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/scheduler/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          now: '2026-05-31T01:01:00Z',
          runAt: '09:00',
          reportsDir,
          maxProjects: 0,
          storiesFixture: 'tests/fixtures/stories.json',
          createFeishuDoc: false,
        }),
      })
      const body = await res.json() as any

      expect(res.status).toBe(503)
      expect(body).toMatchObject({
        success: false,
        skipped: true,
        decision: { due: true, reason: 'due' },
        guard: {
          status: 'blocked',
          reason: 'preflight_failed',
        },
      })
      expect(body.guard.blockingChecks).toEqual([
        expect.objectContaining({ name: 'Feishu Project MCP', status: 'fail' }),
      ])
      await expect(readFile(join(reportsDir, 'runs.json'), 'utf8')).rejects.toThrow()
      expect(JSON.stringify(body)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  })

  it('blocks scheduled Feishu document creation until lark-mcp preflight is pass', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-scheduler-doc-preflight-'))
    const server = createPmoActionServer({
      preflight: async () => ({
        status: 'warn',
        generatedAt: '2026-05-31T01:00:00.000Z',
        summary: { passed: 2, warnings: 1, failed: 0 },
        checks: [
          { name: 'GitLab open-platform', status: 'pass', detail: 'Connected.' },
          { name: 'Feishu Project MCP', status: 'pass', detail: 'Connected.' },
          { name: 'lark-mcp OAuth', status: 'warn', detail: 'Document creation scope is missing.' },
        ],
      }),
    })
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/scheduler/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          now: '2026-05-31T01:01:00Z',
          runAt: '09:00',
          reportsDir,
          maxProjects: 0,
          storiesFixture: 'tests/fixtures/stories.json',
          createFeishuDoc: true,
        }),
      })
      const body = await res.json() as any

      expect(res.status).toBe(503)
      expect(body).toMatchObject({
        success: false,
        skipped: true,
        guard: {
          status: 'blocked',
          reason: 'feishu_doc_preflight_not_ready',
        },
      })
      expect(body.guard.blockingChecks).toEqual([
        expect.objectContaining({ name: 'lark-mcp OAuth', status: 'warn' }),
      ])
      await expect(readFile(join(reportsDir, 'runs.json'), 'utf8')).rejects.toThrow()
    } finally {
      server.close()
    }
  })

  it('creates and lists pending communication drafts from a report', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-draft-server-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 0, risky: 1, incomplete: 1, suggestedContacts: 1 },
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
      stateSnapshot: {
        generatedAt: '2026-05-31T01:00:00.000Z',
        window: { label: '2026-05-31', since: '2026-05-30T16:00:00.000Z', until: '2026-05-31T16:00:00.000Z' },
        summary: { stories: 1, greenStories: 0, yellowStories: 0, redStories: 1, unknownStories: 0, workstreams: 1, communications: 1 },
        stories: [],
        workstreams: [],
        communicationPlan: [{
          person: '王建辉',
          channel: 'feishu',
          storyIds: ['S1'],
          storyTitles: ['企业套餐购买'],
          priority: 'high',
          question: '请确认企业套餐购买的当前状态、blocker、下一步和 ETA。',
          reason: 'CI failed',
        }],
        noDisturbStories: [],
      },
    }))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const createRes = await fetch(`http://127.0.0.1:${address.port}/drafts/from-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, reportPath }),
      })
      const created = await createRes.json() as any
      expect(createRes.status).toBe(200)
      expect(created.drafts).toHaveLength(1)
      expect(created.drafts[0]).toMatchObject({ status: 'pending_approval', channel: 'feishu_im' })

      const listRes = await fetch(`http://127.0.0.1:${address.port}/drafts?reportsDir=${encodeURIComponent(reportsDir)}`)
      const list = await listRes.json() as any
      expect(list.drafts).toHaveLength(1)
      expect(JSON.stringify(list)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  })

  it('approves and rejects communication drafts through local endpoints without sending messages', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-draft-review-server-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 0, risky: 1, incomplete: 1, suggestedContacts: 1 },
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
      stateSnapshot: {
        generatedAt: '2026-05-31T01:00:00.000Z',
        window: { label: '2026-05-31', since: '2026-05-30T16:00:00.000Z', until: '2026-05-31T16:00:00.000Z' },
        summary: { stories: 1, greenStories: 0, yellowStories: 0, redStories: 1, unknownStories: 0, workstreams: 1, communications: 1 },
        stories: [],
        workstreams: [],
        communicationPlan: [{
          person: '王建辉',
          channel: 'feishu',
          storyIds: ['S1'],
          storyTitles: ['企业套餐购买'],
          priority: 'high',
          question: '请确认企业套餐购买的当前状态、blocker、下一步和 ETA。',
          reason: 'CI failed',
        }],
        noDisturbStories: [],
      },
    }))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const createdRes = await fetch(`http://127.0.0.1:${address.port}/drafts/from-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, reportPath }),
      })
      const created = await createdRes.json() as any
      const draftId = created.drafts[0].id

      const approveRes = await fetch(`http://127.0.0.1:${address.port}/drafts/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, draftId, actor: 'PMO Owner', note: '可以发送' }),
      })
      const approved = await approveRes.json() as any
      expect(approved).toMatchObject({ success: true, draft: { status: 'approved', approvedBy: 'PMO Owner' } })
      expect(JSON.stringify(approved)).not.toMatch(/已发送|sent/i)

      const rejectRes = await fetch(`http://127.0.0.1:${address.port}/drafts/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, draftId, actor: 'PMO Owner', note: '先不打扰' }),
      })
      const rejected = await rejectRes.json() as any
      expect(rejected).toMatchObject({ success: true, draft: { status: 'rejected', rejectedBy: 'PMO Owner' } })

      const auditRes = await fetch(`http://127.0.0.1:${address.port}/drafts/audit?reportsDir=${encodeURIComponent(reportsDir)}`)
      const audit = await auditRes.json() as any
      expect(audit.events.map((event: any) => event.action)).toEqual(['rejected', 'approved'])
      expect(JSON.stringify(audit)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  })

  it('guards communication draft delivery behind approval and dry-run mode', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-draft-delivery-server-'))
    const reportPath = join(reportsDir, 'report.json')
    await writeFile(reportPath, JSON.stringify({
      title: 'MAAS_平台 PMO 状态核查日报 2026-05-31',
      date: '2026-05-31',
      summary: { stories: 1, progressed: 0, risky: 1, incomplete: 1, suggestedContacts: 1 },
      progressedStories: [],
      riskyStories: [],
      incompleteStories: [],
      gitlabEvidence: [],
      isolatedEvidence: [],
      suggestedContacts: [],
      noNeedToDisturb: [],
      stateSnapshot: {
        generatedAt: '2026-05-31T01:00:00.000Z',
        window: { label: '2026-05-31', since: '2026-05-30T16:00:00.000Z', until: '2026-05-31T16:00:00.000Z' },
        summary: { stories: 1, greenStories: 0, yellowStories: 0, redStories: 1, unknownStories: 0, workstreams: 1, communications: 1 },
        stories: [],
        workstreams: [],
        communicationPlan: [{
          person: '王建辉',
          channel: 'feishu',
          storyIds: ['S1'],
          storyTitles: ['企业套餐购买'],
          priority: 'high',
          question: '请确认企业套餐购买的当前状态、blocker、下一步和 ETA。',
          reason: 'CI failed',
        }],
        noDisturbStories: [],
      },
    }))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const createdRes = await fetch(`http://127.0.0.1:${address.port}/drafts/from-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, reportPath }),
      })
      const created = await createdRes.json() as any
      const draftId = created.drafts[0].id

      const blockedRes = await fetch(`http://127.0.0.1:${address.port}/drafts/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, draftId, actor: 'PMO Owner', dryRun: true }),
      })
      const blocked = await blockedRes.json() as any
      expect(blocked).toMatchObject({ success: false, error: { code: 'draft_not_approved' } })

      await fetch(`http://127.0.0.1:${address.port}/drafts/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, draftId, actor: 'PMO Owner' }),
      })

      const dryRunRes = await fetch(`http://127.0.0.1:${address.port}/drafts/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportsDir, draftId, actor: 'PMO Owner', dryRun: true }),
      })
      const dryRun = await dryRunRes.json() as any
      expect(dryRun).toMatchObject({ success: true, mode: 'dry_run', draftId, channel: 'feishu_im' })
      expect(JSON.stringify(dryRun)).not.toMatch(/已发送|sent/i)
    } finally {
      server.close()
    }
  })

  it('records and lists check-in replies as local agent state', async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), 'pmo-checkin-server-'))
    const server = createPmoActionServer()
    server.listen(0)
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected tcp server address')
    try {
      const recordRes = await fetch(`http://127.0.0.1:${address.port}/checkins/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportsDir,
          storyId: 'S1',
          draftId: 'D1',
          responder: '王建辉',
          text: '状态：blocked\nblocker：等支付回调联调\n下一步：修复回调幂等\nETA：2026-06-03',
        }),
      })
      const recorded = await recordRes.json() as any
      expect(recorded).toMatchObject({
        success: true,
        record: {
          storyId: 'S1',
          parsed: { status: 'blocked', blocker: '等支付回调联调', nextStep: '修复回调幂等' },
          externalWrites: [],
        },
      })

      const listRes = await fetch(`http://127.0.0.1:${address.port}/checkins?reportsDir=${encodeURIComponent(reportsDir)}`)
      const listed = await listRes.json() as any
      expect(listed.records).toHaveLength(1)
      expect(JSON.stringify(listed)).not.toMatch(/token|secret|password|api[_-]?key/i)
    } finally {
      server.close()
    }
  })
})

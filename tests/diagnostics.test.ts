import { describe, expect, it } from 'vitest'
import { checkLarkMcp, parseLarkWhoami, renderDiagnostics } from '../src/diagnostics.js'

describe('diagnostics', () => {
  it('detects missing lark-mcp login sessions', () => {
    expect(parseLarkWhoami('ℹ️ No active login sessions found')).toEqual({
      hasSession: false,
      scopes: [],
      hasDocumentScope: false,
      tokenExpired: false,
      refreshTokenMissing: false,
    })
  })

  it('detects lark-mcp document scopes', () => {
    const parsed = parseLarkWhoami(`
      👤 Current login sessions:
      📱 App ID: cli_x
      "scopes": [
        "auth:user.id:read",
        "docs:doc"
      ]
    `)

    expect(parsed.hasSession).toBe(true)
    expect(parsed.scopes).toContain('docs:doc')
    expect(parsed.hasDocumentScope).toBe(true)
    expect(parsed.tokenExpired).toBe(false)
    expect(parsed.refreshTokenMissing).toBe(false)
  })

  it('accepts the lark-mcp documented docx document OAuth scope', () => {
    const parsed = parseLarkWhoami(`
      👤 Current login sessions:
      📱 App ID: cli_x
      "scopes": [
        "auth:user.id:read",
        "docx:document"
      ]
    `)

    expect(parsed.hasSession).toBe(true)
    expect(parsed.scopes).toContain('docx:document')
    expect(parsed.hasDocumentScope).toBe(true)
  })

  it('detects expired lark-mcp user tokens', () => {
    const parsed = parseLarkWhoami(`
      👤 Current login sessions:
      📱 App ID: cli_x
      ⌚️ AccessToken Expired: true
      "scopes": ["docx:document"]
    `)

    expect(parsed.hasSession).toBe(true)
    expect(parsed.tokenExpired).toBe(true)
    expect(parsed.hasDocumentScope).toBe(true)
  })

  it('detects expired lark-mcp sessions that cannot refresh automatically', () => {
    const parsed = parseLarkWhoami(`
      👤 Current login sessions:
      📱 App ID: cli_x
      ⌚️ AccessToken Expired: true
      "scopes": ["auth:user.id:read", "docx:document", "drive:drive"]
      "refreshToken": ""
    `)

    expect(parsed.hasSession).toBe(true)
    expect(parsed.tokenExpired).toBe(true)
    expect(parsed.refreshTokenMissing).toBe(true)
  })

  it('renders actionable setup diagnostics', () => {
    const text = renderDiagnostics([
      { name: 'GitLab', status: 'pass', detail: 'Connected.' },
      { name: 'lark-mcp', status: 'warn', detail: 'Missing docs:doc.', nextStep: 'Add docs:doc.' },
    ])

    expect(text).toContain('[PASS] GitLab')
    expect(text).toContain('[WARN] lark-mcp')
    expect(text).toContain('Next: Add docs:doc.')
    expect(text).toContain('Summary: 1 passed, 1 warnings, 0 failed.')
  })

  it('exports lark-mcp checks for preflight gating', () => {
    expect(typeof checkLarkMcp).toBe('function')
  })
})

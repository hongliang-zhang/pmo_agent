import { describe, expect, it } from 'vitest'
import { checkLarkMcp, parseLarkWhoami, renderDiagnostics } from '../src/diagnostics.js'

describe('diagnostics', () => {
  it('detects missing lark-mcp login sessions', () => {
    expect(parseLarkWhoami('ℹ️ No active login sessions found')).toEqual({
      hasSession: false,
      scopes: [],
      hasDocumentScope: false,
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

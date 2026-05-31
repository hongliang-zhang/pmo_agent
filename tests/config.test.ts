import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadConfig, loadEnvFiles } from '../src/config.js'

describe('loadConfig', () => {
  it('loads GitLab token from environment first', async () => {
    const config = await loadConfig({
      env: {
        GITLAB_TOKEN: 'env-token',
        FEISHU_PROJECT_MCP_URL: 'https://project.feishu.cn/mcp_server/v1',
        FEISHU_PROJECT_MCP_AUTH_HEADER: 'Authorization=Bearer project-token',
      },
      credentialFill: async () => 'credential-token',
    })

    expect(config.gitlab.token).toBe('env-token')
    expect(config.gitlab.baseUrl).toBe('https://dev.aminer.cn')
    expect(config.audit.timezone).toBe('Asia/Shanghai')
    expect(config.feishuProject.headers).toEqual({ Authorization: 'Bearer project-token' })
  })

  it('falls back to git credential for GitLab token', async () => {
    const config = await loadConfig({
      env: {
        FEISHU_PROJECT_MCP_URL: 'https://project.feishu.cn/mcp_server/v1',
      },
      credentialFill: async () => 'credential-token',
    })

    expect(config.gitlab.token).toBe('credential-token')
  })

  it('supports Feishu Project X-Mcp-Token header shortcut', async () => {
    const config = await loadConfig({
      env: {
        GITLAB_TOKEN: 'env-token',
        FEISHU_PROJECT_MCP_URL: 'https://project.feishu.cn/mcp_server/v1',
        FEISHU_PROJECT_MCP_TOKEN: 'project-token',
      },
      credentialFill: async () => undefined,
    })

    expect(config.feishuProject.headers).toEqual({ 'X-Mcp-Token': 'project-token' })
  })

  it('returns a clear error when required setup is missing', async () => {
    await expect(loadConfig({ env: {}, credentialFill: async () => undefined }))
      .rejects
      .toThrow('Missing GitLab token')
  })

  it('loads .env-style files without overriding existing process env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pmo-env-'))
    const envPath = join(dir, '.env.local')
    const oldExisting = process.env.PMO_EXISTING
    try {
      process.env.PMO_EXISTING = 'already-set'
      delete process.env.PMO_FROM_FILE
      await writeFile(envPath, "PMO_FROM_FILE='from-file'\nPMO_EXISTING=from-file\n")

      await loadEnvFiles([envPath])

      expect(process.env.PMO_FROM_FILE).toBe('from-file')
      expect(process.env.PMO_EXISTING).toBe('already-set')
    } finally {
      if (oldExisting === undefined) delete process.env.PMO_EXISTING
      else process.env.PMO_EXISTING = oldExisting
      delete process.env.PMO_FROM_FILE
      await rm(dir, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  })
})

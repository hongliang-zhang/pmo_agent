import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('loads GitLab token from environment first', async () => {
    const config = await loadConfig({
      env: {
        GITLAB_TOKEN: 'env-token',
        FEISHU_PROJECT_MCP_URL: 'https://project.feishu.cn/mcp_server/v1',
      },
      credentialFill: async () => 'credential-token',
    })

    expect(config.gitlab.token).toBe('env-token')
    expect(config.gitlab.baseUrl).toBe('https://dev.aminer.cn')
    expect(config.audit.timezone).toBe('Asia/Shanghai')
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

  it('returns a clear error when required setup is missing', async () => {
    await expect(loadConfig({ env: {}, credentialFill: async () => undefined }))
      .rejects
      .toThrow('Missing GitLab token')
  })
})

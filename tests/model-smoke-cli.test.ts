import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('pmo model smoke CLI', () => {
  it('prints a structured setup failure when the z.ai key is missing', async () => {
    await expect(execFileAsync('pnpm', [
      'tsx',
      'src/cli/model-smoke.ts',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, ZAI_API_KEY: '' },
    })).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"success": false'),
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { buildPersonDirectory } from '../src/people/directory.js'

describe('person directory', () => {
  it('joins Feishu Project people and Feishu Contacts API identities by email', async () => {
    const projectClient = {
      searchUsers: vi.fn(async () => [{
        name: '张鸿亮',
        email: 'user@aminer.cn',
        userKey: '7526957403145830401',
        larkUserId: '7526957403145830401',
        raw: {},
      }]),
    }
    const openApiClient = {
      batchGetUserIdsByEmail: vi.fn(async () => [{
        email: 'user@aminer.cn',
        openId: 'ou_hl',
        userId: 'test-user-id',
        raw: {},
      }]),
    }

    const directory = await buildPersonDirectory({
      stories: [{
        id: 'S1',
        title: 'for pmo agent test',
        status: '需求评审',
        owners: [{ name: '张鸿亮', email: 'user@aminer.cn' }],
        linkedDocs: [],
        fields: {},
      }],
      projectClient: projectClient as any,
      openApiClient: openApiClient as any,
      projectKey: '7358164361912909827_1719375156',
    })

    expect(projectClient.searchUsers).toHaveBeenCalledWith(expect.objectContaining({
      projectKey: '7358164361912909827_1719375156',
      userKeys: expect.arrayContaining(['user@aminer.cn', '张鸿亮']),
    }))
    expect(openApiClient.batchGetUserIdsByEmail).toHaveBeenCalledWith(['user@aminer.cn'], 'open_id')
    expect(directory['张鸿亮']).toMatchObject({
      email: 'user@aminer.cn',
      openId: 'ou_hl',
      userId: 'test-user-id',
    })
  })
})

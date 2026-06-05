import { describe, expect, it, vi } from 'vitest'
import type { Evidence } from '../src/domain.js'
import { attachGitLabEmailsFromCommits, enrichGitLabEvidenceAuthors } from '../src/identity/gitlab-feishu.js'

describe('GitLab to Feishu identity enrichment', () => {
  it('uses commit author email to identify MR authors with hashed GitLab usernames', () => {
    const enriched = attachGitLabEmailsFromCommits([
      gitlabMr({ author: 'xiaxueyan', authorUsername: '666a3d38', authorName: 'xiaxueyan' }),
      gitlabCommit({ author: 'xiaxueyan', authorEmail: 'xueyan.xia@aminer.cn' }),
    ])

    expect(enriched[0].metadata).toMatchObject({
      authorEmail: 'xueyan.xia@aminer.cn',
      identitySource: 'gitlab_commit_email',
    })
  })

  it('looks up Feishu Project user by GitLab email and replaces author with Chinese name', async () => {
    const projectClient = {
      searchUsers: vi.fn(async () => [{
        name: '夏雪妍',
        email: 'xueyan.xia@aminer.cn',
        userKey: '7490505322264543233',
        larkUserId: '7490484609445511000',
        raw: {},
      }]),
    }

    const enriched = await enrichGitLabEvidenceAuthors({
      evidence: [
        gitlabMr({ author: 'xiaxueyan', authorUsername: '666a3d38', authorName: 'xiaxueyan' }),
        gitlabCommit({ author: 'xiaxueyan', authorEmail: 'xueyan.xia@aminer.cn' }),
      ],
      projectClient: projectClient as any,
      projectKey: 'MAAS_平台',
    })

    expect(projectClient.searchUsers).toHaveBeenCalledWith({
      projectKey: 'MAAS_平台',
      userKeys: ['xueyan.xia@aminer.cn'],
    })
    expect(enriched[0]).toMatchObject({
      author: '夏雪妍',
      metadata: {
        authorEmail: 'xueyan.xia@aminer.cn',
        authorName: '夏雪妍',
        feishuUserKey: '7490505322264543233',
        identitySource: 'feishu_project_email',
      },
    })
  })
})

function gitlabMr(input: { author: string; authorUsername: string; authorName: string }): Evidence {
  return {
    id: '1!1',
    type: 'gitlab_mr',
    title: 'Hotfix/ck',
    summary: 'opened MR',
    url: 'https://dev.aminer.cn/open-platform/platform-agent/-/merge_requests/131',
    author: input.author,
    createdAt: '2026-06-02T09:46:49.893Z',
    updatedAt: '2026-06-02T11:41:41.243Z',
    confidence: 'confirmed',
    metadata: {
      authorUsername: input.authorUsername,
      authorName: input.authorName,
    },
  }
}

function gitlabCommit(input: { author: string; authorEmail: string }): Evidence {
  return {
    id: 'sha',
    type: 'gitlab_commit',
    title: 'commit',
    summary: 'commit',
    url: 'https://dev.aminer.cn/open-platform/platform-agent/-/commit/sha',
    author: input.author,
    createdAt: '2026-06-02T10:00:00Z',
    updatedAt: '2026-06-02T10:00:00Z',
    confidence: 'confirmed',
    metadata: {
      authorEmail: input.authorEmail,
    },
  }
}

import { describe, expect, it } from 'vitest'
import { GitLabClient } from '../src/gitlab/client.js'

describe('GitLabClient', () => {
  it('reads paginated group projects', async () => {
    const requested: string[] = []
    const client = new GitLabClient({
      baseUrl: 'https://dev.aminer.cn',
      token: 'token',
      fetch: async (url) => {
        requested.push(String(url))
        if (new URL(String(url)).searchParams.get('page') === '1') {
          return jsonResponse([{ id: 1, path_with_namespace: 'open-platform/a', default_branch: 'main', web_url: 'u1', last_activity_at: '2026-05-31T01:00:00Z' }], { 'x-next-page': '2' })
        }
        return jsonResponse([{ id: 2, path_with_namespace: 'open-platform/b', default_branch: 'master', web_url: 'u2', last_activity_at: '2026-05-31T02:00:00Z' }], { 'x-next-page': '' })
      },
    })

    const projects = await client.listGroupProjects('open-platform')

    expect(projects.map(p => p.pathWithNamespace)).toEqual(['open-platform/a', 'open-platform/b'])
    expect(requested[0]).toContain('/api/v4/groups/open-platform/projects')
    expect(requested[1]).toContain('page=2')
  })

  it('normalizes merge requests, commits, and pipelines in a date window', async () => {
    const client = new GitLabClient({
      baseUrl: 'https://dev.aminer.cn',
      token: 'token',
      fetch: async (url) => {
        const value = String(url)
        if (value.includes('/merge_requests') && value.includes('/commits')) {
          return jsonResponse([{ id: 'mr-sha', short_id: 'mr-sha', title: 'MR commit', message: 'MR commit body', author_name: 'Alice', author_email: 'a@example.com', authored_date: '2026-05-31T03:20:00Z', web_url: 'mr-commit' }])
        }
        if (value.includes('/merge_requests')) {
          return jsonResponse([{ iid: 8, title: '需求 ABC 支持状态核查', description: 'story ABC', state: 'opened', web_url: 'mr', author: { username: 'alice', name: 'Alice' }, source_branch: 'feat/ABC', target_branch: 'main', updated_at: '2026-05-31T03:00:00Z', created_at: '2026-05-31T02:00:00Z', merge_status: 'can_be_merged', detailed_merge_status: 'mergeable' }])
        }
        if (value.includes('/repository/commits')) {
          return jsonResponse([{ id: 'sha', short_id: 'sha', title: 'ABC commit', message: 'ABC commit body', author_name: 'Alice', author_email: 'a@example.com', authored_date: '2026-05-31T03:30:00Z', web_url: 'commit' }])
        }
        return jsonResponse([{ id: 9, status: 'failed', ref: 'main', sha: 'sha', web_url: 'pipe', created_at: '2026-05-31T03:40:00Z', updated_at: '2026-05-31T03:41:00Z' }])
      },
    })

    const window = { since: new Date('2026-05-31T00:00:00Z'), until: new Date('2026-06-01T00:00:00Z') }

    await expect(client.listProjectMergeRequests(1, window)).resolves.toHaveLength(1)
    await expect(client.listProjectMergeRequests(1, window)).resolves.toMatchObject([{
      author: 'Alice',
      authorUsername: 'alice',
      authorName: 'Alice',
    }])
    await expect(client.listProjectCommits(1, 'main', window)).resolves.toHaveLength(1)
    await expect(client.listMergeRequestCommits(1, 8)).resolves.toMatchObject([{ authorEmail: 'a@example.com' }])
    await expect(client.listProjectPipelines(1, window)).resolves.toHaveLength(1)
  })

  it('normalizes user events and change details for person-level GitLab lookup', async () => {
    const requested: string[] = []
    const client = new GitLabClient({
      baseUrl: 'https://dev.aminer.cn',
      token: 'token',
      fetch: async (url) => {
        const value = String(url)
        requested.push(value)
        if (value.includes('/events')) {
          return jsonResponse([{
            action_name: 'opened',
            target_type: 'MergeRequest',
            target_title: 'fix: update batch upload copy',
            target_iid: 875,
            target_id: 90915,
            created_at: '2026-04-28T06:50:34.777Z',
            project_id: 1684,
          }, {
            action_name: 'pushed new',
            created_at: '2026-04-28T06:48:09.433Z',
            project_id: 1684,
            push_data: {
              commit_count: 1,
              action: 'created',
              ref_type: 'branch',
              commit_to: '92d87988c2d91b8753da59a7e0cf55537f59eedf',
              ref: 'fix/batch-upload-copy',
              commit_title: 'fix: update batch upload copy',
            },
          }])
        }
        if (value.includes('/merge_requests/875/changes')) {
          return jsonResponse({ changes: [{ old_path: 'src/upload.ts', new_path: 'src/upload.ts', new_file: false, deleted_file: false, renamed_file: false }] })
        }
        if (value.includes('/repository/commits/92d87988c2d91b8753da59a7e0cf55537f59eedf/diff')) {
          return jsonResponse([{ old_path: 'src/copy.ts', new_path: 'src/copy.ts', new_file: false, deleted_file: false, renamed_file: false }])
        }
        return jsonResponse([])
      },
    })

    await expect(client.listUserEvents(2420, new Date('2026-04-01'))).resolves.toMatchObject([{
      targetIid: 875,
      targetId: 90915,
    }, {
      pushData: { commitTo: '92d87988c2d91b8753da59a7e0cf55537f59eedf' },
    }])
    await expect(client.listMergeRequestChanges(1684, 875)).resolves.toEqual(['src/upload.ts'])
    await expect(client.listCommitDiffFiles(1684, '92d87988c2d91b8753da59a7e0cf55537f59eedf')).resolves.toEqual(['src/copy.ts'])
    expect(requested.some(url => url.includes('/merge_requests/875/changes'))).toBe(true)
  })
})

function jsonResponse(data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

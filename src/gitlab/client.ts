import type { DateWindow, Evidence } from '../domain.js'

export interface GitLabProject {
  id: number
  pathWithNamespace: string
  defaultBranch: string
  webUrl: string
  lastActivityAt: string
}

export interface GitLabMergeRequest {
  id: string
  iid: number
  title: string
  description: string
  state: string
  webUrl: string
  author?: string
  sourceBranch: string
  targetBranch: string
  createdAt: string
  updatedAt: string
  mergeStatus?: string
  detailedMergeStatus?: string
  projectId: number
}

export interface GitLabCommit {
  id: string
  shortId: string
  title: string
  message: string
  authorName: string
  authorEmail: string
  authoredDate: string
  webUrl: string
  projectId: number
}

export interface GitLabPipeline {
  id: number
  status: string
  ref: string
  sha: string
  webUrl: string
  createdAt: string
  updatedAt: string
  projectId: number
}

interface GitLabClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
}

export class GitLabClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: GitLabClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
  }

  async listGroupProjects(group: string): Promise<GitLabProject[]> {
    const rows = await this.getPaginated<any>(`/api/v4/groups/${encodeURIComponent(group)}/projects`, {
      simple: 'true',
      order_by: 'last_activity_at',
      sort: 'desc',
      per_page: '100',
    })
    return rows.map(row => ({
      id: row.id,
      pathWithNamespace: row.path_with_namespace,
      defaultBranch: row.default_branch,
      webUrl: row.web_url,
      lastActivityAt: row.last_activity_at,
    }))
  }

  async listProjectMergeRequests(projectId: number, window: DateWindow): Promise<GitLabMergeRequest[]> {
    const rows = await this.getPaginated<any>(`/api/v4/projects/${projectId}/merge_requests`, {
      updated_after: window.since.toISOString(),
      updated_before: window.until.toISOString(),
      scope: 'all',
      state: 'all',
      per_page: '100',
    })
    return rows.map(row => ({
      id: `${projectId}!${row.iid}`,
      iid: row.iid,
      title: row.title ?? '',
      description: row.description ?? '',
      state: row.state ?? '',
      webUrl: row.web_url ?? '',
      author: row.author?.username ?? row.author?.name,
      sourceBranch: row.source_branch ?? '',
      targetBranch: row.target_branch ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      mergeStatus: row.merge_status,
      detailedMergeStatus: row.detailed_merge_status,
      projectId,
    }))
  }

  async listProjectCommits(projectId: number, ref: string, window: DateWindow): Promise<GitLabCommit[]> {
    const rows = await this.getPaginated<any>(`/api/v4/projects/${projectId}/repository/commits`, {
      ref_name: ref,
      since: window.since.toISOString(),
      until: window.until.toISOString(),
      per_page: '100',
    })
    return rows.map(row => ({
      id: row.id,
      shortId: row.short_id,
      title: row.title ?? '',
      message: row.message ?? '',
      authorName: row.author_name ?? '',
      authorEmail: row.author_email ?? '',
      authoredDate: row.authored_date,
      webUrl: row.web_url ?? '',
      projectId,
    }))
  }

  async listProjectPipelines(projectId: number, window: DateWindow): Promise<GitLabPipeline[]> {
    const rows = await this.getPaginated<any>(`/api/v4/projects/${projectId}/pipelines`, {
      updated_after: window.since.toISOString(),
      updated_before: window.until.toISOString(),
      per_page: '100',
    })
    return rows.map(row => ({
      id: row.id,
      status: row.status ?? '',
      ref: row.ref ?? '',
      sha: row.sha ?? '',
      webUrl: row.web_url ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      projectId,
    }))
  }

  private async getPaginated<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const all: T[] = []
    let page = '1'
    do {
      const url = new URL(`${this.baseUrl}${path}`)
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
      url.searchParams.set('page', page)
      const res = await this.fetchImpl(url, { headers: { 'PRIVATE-TOKEN': this.token } })
      if (!res.ok) throw new Error(`GitLab API ${res.status}: ${await res.text()}`)
      all.push(...await res.json() as T[])
      page = res.headers.get('x-next-page') ?? ''
    } while (page)
    return all
  }
}

export function gitLabItemsToEvidence(input: {
  mergeRequests: GitLabMergeRequest[]
  commits: GitLabCommit[]
  pipelines: GitLabPipeline[]
}): Evidence[] {
  return [
    ...input.mergeRequests.map(mr => ({
      id: mr.id,
      type: 'gitlab_mr' as const,
      title: mr.title,
      summary: `${mr.state} MR ${mr.id}: ${mr.title}`,
      url: mr.webUrl,
      author: mr.author,
      createdAt: mr.createdAt,
      updatedAt: mr.updatedAt,
      confidence: 'confirmed' as const,
      metadata: { branch: mr.sourceBranch, state: mr.state, mergeStatus: mr.mergeStatus, detailedMergeStatus: mr.detailedMergeStatus, description: mr.description },
    })),
    ...input.commits.map(commit => ({
      id: commit.id,
      type: 'gitlab_commit' as const,
      title: commit.title,
      summary: commit.message || commit.title,
      url: commit.webUrl,
      author: commit.authorName,
      createdAt: commit.authoredDate,
      updatedAt: commit.authoredDate,
      confidence: 'confirmed' as const,
      metadata: { shortId: commit.shortId, message: commit.message, authorEmail: commit.authorEmail },
    })),
    ...input.pipelines.map(pipeline => ({
      id: `pipeline-${pipeline.id}`,
      type: 'gitlab_pipeline' as const,
      title: `Pipeline ${pipeline.status}`,
      summary: `Pipeline ${pipeline.id} on ${pipeline.ref} is ${pipeline.status}`,
      url: pipeline.webUrl,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
      confidence: 'confirmed' as const,
      metadata: { status: pipeline.status, ref: pipeline.ref, sha: pipeline.sha },
    })),
  ]
}

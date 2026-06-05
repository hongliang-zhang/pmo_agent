import type { DateWindow, Evidence } from '../domain.js'
import { gitLabItemsToEvidence, GitLabClient, type GitLabCommit, type GitLabMergeRequest } from './client.js'

export async function collectGitLabEvidence(input: {
  client: GitLabClient
  group: string
  window: DateWindow
  maxProjects?: number
}): Promise<Evidence[]> {
  const projects = await input.client.listGroupProjects(input.group)
  const activeProjects = projects.filter(project => {
    const lastActivityAt = Date.parse(project.lastActivityAt)
    return Number.isFinite(lastActivityAt) && lastActivityAt >= input.window.since.getTime()
  })
  const selected = typeof input.maxProjects === 'number' ? activeProjects.slice(0, input.maxProjects) : activeProjects
  const evidenceByProject = await mapWithConcurrency(selected, 5, async project => {
    const [mergeRequests, commits, pipelines] = await Promise.all([
      input.client.listProjectMergeRequests(project.id, input.window),
      input.client.listProjectCommits(project.id, project.defaultBranch, input.window),
      input.client.listProjectPipelines(project.id, input.window),
    ])
    const mergeRequestsWithEmail = await enrichMergeRequestAuthorEmails(input.client, mergeRequests)
    const items = gitLabItemsToEvidence({ mergeRequests: mergeRequestsWithEmail, commits, pipelines })
    for (const item of items) {
      item.metadata = { ...(item.metadata ?? {}), project: project.pathWithNamespace, defaultBranch: project.defaultBranch }
    }
    return items
  })
  return evidenceByProject.flat()
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function enrichMergeRequestAuthorEmails(client: GitLabClient, mergeRequests: GitLabMergeRequest[]): Promise<GitLabMergeRequest[]> {
  return Promise.all(mergeRequests.map(async mr => {
    if (mr.authorEmail) return mr
    try {
      const commits = await client.listMergeRequestCommits(mr.projectId, mr.iid)
      const email = findAuthorEmail(mr, commits)
      return email ? { ...mr, authorEmail: email } : mr
    } catch {
      return mr
    }
  }))
}

function findAuthorEmail(mr: GitLabMergeRequest, commits: GitLabCommit[]): string | undefined {
  const keys = [mr.author, mr.authorName, mr.authorUsername]
    .map(value => value?.toLowerCase())
    .filter(Boolean)
  return commits.find(commit => keys.includes(commit.authorName.toLowerCase()))?.authorEmail
    ?? commits.find(commit => keys.includes(commit.authorEmail.split('@')[0]?.toLowerCase() ?? ''))?.authorEmail
}

import type { DateWindow, Evidence } from '../domain.js'
import { gitLabItemsToEvidence, GitLabClient } from './client.js'

export async function collectGitLabEvidence(input: {
  client: GitLabClient
  group: string
  window: DateWindow
  maxProjects?: number
}): Promise<Evidence[]> {
  const projects = await input.client.listGroupProjects(input.group)
  const selected = typeof input.maxProjects === 'number' ? projects.slice(0, input.maxProjects) : projects
  const evidence: Evidence[] = []
  for (const project of selected) {
    const [mergeRequests, commits, pipelines] = await Promise.all([
      input.client.listProjectMergeRequests(project.id, input.window),
      input.client.listProjectCommits(project.id, project.defaultBranch, input.window),
      input.client.listProjectPipelines(project.id, input.window),
    ])
    const items = gitLabItemsToEvidence({ mergeRequests, commits, pipelines })
    for (const item of items) {
      item.metadata = { ...(item.metadata ?? {}), project: project.pathWithNamespace, defaultBranch: project.defaultBranch }
    }
    evidence.push(...items)
  }
  return evidence
}

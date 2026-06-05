import type { Evidence } from '../domain.js'
import type { FeishuProjectMcpClient } from '../feishu/project-mcp.js'

export async function enrichGitLabEvidenceAuthors(input: {
  evidence: Evidence[]
  projectClient?: Pick<FeishuProjectMcpClient, 'searchUsers'>
  projectKey?: string
}): Promise<Evidence[]> {
  const withGitLabEmail = attachGitLabEmailsFromCommits(input.evidence)
  if (!input.projectClient) return withGitLabEmail
  const emails = unique(withGitLabEmail.map(item => stringValue(item.metadata?.authorEmail)))
  if (emails.length === 0) return withGitLabEmail

  try {
    const users = await input.projectClient.searchUsers({ projectKey: input.projectKey, userKeys: emails })
    const byEmail = new Map(users.filter(user => user.email).map(user => [user.email!.toLowerCase(), user]))
    return withGitLabEmail.map(item => {
      const email = stringValue(item.metadata?.authorEmail)
      const user = email ? byEmail.get(email.toLowerCase()) : undefined
      if (!user?.name) return item
      return {
        ...item,
        author: user.name,
        metadata: {
          ...(item.metadata ?? {}),
          authorEmail: email,
          authorName: user.name,
          feishuUserKey: user.userKey,
          feishuLarkUserId: user.larkUserId,
          identitySource: 'feishu_project_email',
        },
      }
    })
  } catch (error) {
    return withGitLabEmail.map(item => ({
      ...item,
      metadata: {
        ...(item.metadata ?? {}),
        identityResolutionError: error instanceof Error ? error.message : String(error),
      },
    }))
  }
}

export function attachGitLabEmailsFromCommits(evidence: Evidence[]): Evidence[] {
  const emailByAuthor = new Map<string, string>()
  for (const item of evidence) {
    if (item.type !== 'gitlab_commit') continue
    const email = stringValue(item.metadata?.authorEmail)
    if (!email) continue
    for (const key of authorKeys(item)) emailByAuthor.set(key, email)
  }

  return evidence.map(item => {
    if (!item.type.startsWith('gitlab_')) return item
    const existing = stringValue(item.metadata?.authorEmail)
    if (existing) return item
    const email = authorKeys(item).map(key => emailByAuthor.get(key)).find(Boolean)
    if (!email) return item
    return {
      ...item,
      metadata: {
        ...(item.metadata ?? {}),
        authorEmail: email,
        identitySource: 'gitlab_commit_email',
      },
    }
  })
}

function authorKeys(item: Evidence): string[] {
  return unique([
    item.author,
    stringValue(item.metadata?.authorName),
    stringValue(item.metadata?.authorUsername),
  ].map(value => value?.toLowerCase()))
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter(Boolean) as string[])]
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

import type { Story } from '../domain.js'
import type { FeishuProjectMcpClient, FeishuProjectUser } from '../feishu/project-mcp.js'
import type { FeishuOpenApiClient } from '../feishu/openapi.js'
import type { PersonDirectory, PersonIdentity } from '../server/drafts.js'

export async function buildPersonDirectory(input: {
  stories: Story[]
  projectClient: FeishuProjectMcpClient
  openApiClient: FeishuOpenApiClient
  projectKey?: string
}): Promise<PersonDirectory> {
  const people = uniquePeopleFromStories(input.stories)
  const emails = [...new Set(people.map(person => person.email).filter((email): email is string => Boolean(email)))]
  const projectUsers = await input.projectClient.searchUsers({ projectKey: input.projectKey, userKeys: [...emails, ...people.map(person => person.name)] })
  const contactUsers = await input.openApiClient.batchGetUserIdsByEmail(emails, 'open_id')
  const byEmail = new Map<string, PersonIdentity>()
  for (const contact of contactUsers) {
    if (!contact.email) continue
    byEmail.set(contact.email.toLowerCase(), {
      email: contact.email,
      openId: contact.openId,
      userId: contact.userId,
    })
  }
  for (const projectUser of projectUsers) {
    if (projectUser.email) {
      byEmail.set(projectUser.email.toLowerCase(), mergeIdentity(byEmail.get(projectUser.email.toLowerCase()), identityFromProjectUser(projectUser)))
    }
  }

  const directory: PersonDirectory = {}
  for (const person of people) {
    const fromEmail = person.email ? byEmail.get(person.email.toLowerCase()) : undefined
    directory[person.name] = {
      ...fromEmail,
      email: person.email ?? fromEmail?.email,
      openId: fromEmail?.openId ?? person.openId,
      userId: fromEmail?.userId ?? person.larkUserId ?? person.userKey,
      gitlabUsername: person.username,
    }
  }
  return directory
}

function uniquePeopleFromStories(stories: Story[]): Array<NonNullable<Story['creator']>> {
  const people = new Map<string, NonNullable<Story['creator']>>()
  for (const story of stories) {
    for (const person of [...story.owners, story.creator].filter(Boolean) as Array<NonNullable<Story['creator']>>) {
      const key = (person.email ?? person.name).toLowerCase()
      people.set(key, person)
    }
  }
  return [...people.values()]
}

function identityFromProjectUser(user: FeishuProjectUser): PersonIdentity {
  return {
    email: user.email,
    openId: user.openId,
    userId: user.larkUserId ?? user.userKey,
  }
}

function mergeIdentity(left: PersonIdentity | undefined, right: PersonIdentity): PersonIdentity {
  return {
    ...left,
    ...right,
    openId: right.openId ?? left?.openId,
    userId: left?.userId ?? right.userId,
    email: right.email ?? left?.email,
  }
}

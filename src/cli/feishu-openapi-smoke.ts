import { loadEnvFiles } from '../config.js'
import { FeishuOpenApiClient } from '../feishu/openapi.js'

interface Args {
  email?: string
  sendText?: string
  receiveIdType?: 'open_id' | 'user_id' | 'email' | 'chat_id'
  receiveId?: string
}

await loadEnvFiles()

const args = parseArgs(process.argv.slice(2))
const client = new FeishuOpenApiClient()

if (args.email) {
  const users = await client.batchGetUserIdsByEmail([args.email], 'open_id')
  process.stdout.write(`${JSON.stringify({
    success: true,
    mode: 'contacts_lookup',
    users: users.map(user => ({
      email: user.email,
      openId: user.openId ? '[present]' : undefined,
      userId: user.userId ? '[present]' : undefined,
      unionId: user.unionId ? '[present]' : undefined,
    })),
  }, null, 2)}\n`)
}

if (args.sendText) {
  if (!args.receiveIdType || !args.receiveId) {
    throw new Error('--sendText requires --receiveIdType and --receiveId')
  }
  const raw = await client.sendTextMessage({
    receiveIdType: args.receiveIdType,
    receiveId: args.receiveId,
    text: args.sendText,
  })
  process.stdout.write(`${JSON.stringify({ success: true, mode: 'send_text', raw }, null, 2)}\n`)
}

if (!args.email && !args.sendText) {
  throw new Error('Use --email <email> for Contacts lookup, or --sendText <text> with --receiveIdType and --receiveId for IM smoke.')
}

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--email') {
      out.email = value
      index += 1
    } else if (key === '--sendText') {
      out.sendText = value
      index += 1
    } else if (key === '--receiveIdType') {
      out.receiveIdType = value as Args['receiveIdType']
      index += 1
    } else if (key === '--receiveId') {
      out.receiveId = value
      index += 1
    }
  }
  return out
}

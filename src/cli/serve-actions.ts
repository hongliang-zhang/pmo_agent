import { createPmoActionServer } from '../server/action-server.js'

const port = Number(process.env.PORT ?? process.env.PMO_ACTION_PORT ?? 3201)
const server = createPmoActionServer()

server.listen(port, () => {
  process.stdout.write(`PMO action server listening on ${port}\n`)
})

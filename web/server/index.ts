/**
 * 后端 API 服务入口(F3.1)
 *
 * Fastify 服务,提供经验 CRUD + 搜索 + 编译预览 API。
 *
 * 启动:
 *   npx tsx web/server/index.ts [experiences-dir] [port]
 *
 * 默认:
 *   experiences-dir = ./experiences
 *   port = 3001
 *
 * @see tasks/phase-f3/README.md F3.1
 */

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { join, resolve } from 'path'
import { FileSystemExperienceStore } from './services/experience-store.js'
import { SearchService } from './services/search-service.js'
import { registerExperienceRoutes } from './routes/experiences.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerOpRoutes } from './routes/ops.js'

// ============== 启动函数 ==============

export interface ServerOptions {
  experiencesDir?: string
  port?: number
}

export async function createServer(options: ServerOptions = {}) {
  const experiencesDir = resolve(options.experiencesDir ?? join(process.cwd(), 'experiences'))
  const port = options.port ?? 3001

  const store = new FileSystemExperienceStore(experiencesDir)
  const search = new SearchService(store)
  await search.init()

  const app = Fastify({ logger: true })

  // CORS(允许前端开发服务器访问)
  await app.register(cors, { origin: true })

  // 路由
  await registerExperienceRoutes(app, { store, search })
  await registerSearchRoutes(app, search)
  await registerOpRoutes(app)

  // 健康检查
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ status: 'ok', experiences: (await search.list()).length })
  })

  return { app, port, store, search }
}

// ============== 直接启动入口 ==============

async function main(): Promise<void> {
  const { app, port } = await createServer({
    experiencesDir: process.argv[2],
    port: process.argv[3] ? parseInt(process.argv[3], 10) : undefined
  })

  try {
    await app.listen({ port, host: '0.0.0.0' })
    console.log(`经验设计工具后端已启动: http://localhost:${port}`)
  } catch (e) {
    app.log.error(e)
    process.exit(1)
  }
}

// 仅在直接运行时启动(tsx 和 node 兼容)
const isMain = import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith('web/server/index.ts')
  || process.argv[1]?.endsWith('index.ts')
if (isMain) {
  main().catch(e => {
    console.error(e)
    process.exit(1)
  })
}

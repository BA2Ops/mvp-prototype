/**
 * 搜索 API 路由(F3.1)
 *
 * 端点:
 *   GET /api/search?q=<query>&k=<limit>
 *
 * @see tasks/phase-f3/README.md F3.1
 */

import type { FastifyInstance } from 'fastify'
import type { SearchService } from '../services/search-service.js'

export async function registerSearchRoutes(
  app: FastifyInstance,
  search: SearchService
): Promise<void> {
  app.get<{ Querystring: { q?: string; k?: string } }>(
    '/api/search',
    async (req, reply) => {
      const q = req.query.q ?? ''
      const k = req.query.k ? parseInt(req.query.k, 10) : 20
      const response = await search.search(q, k)
      return reply.send(response)
    }
  )
}

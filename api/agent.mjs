import { runAgentRequest } from '../server/index.mjs'

export const config = { maxDuration: 60 }

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(request.method)) {
    return response.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.OPENAI_API_KEY) {
    return response.status(503).json({ error: 'OPENAI_API_KEY is not configured' })
  }

  try {
    const input = request.method === 'GET'
      ? JSON.parse(String(request.query.payload || ''))
      : typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    if (!input || typeof input.prompt !== 'string') throw new Error('Invalid input')
    return response.status(200).json(await runAgentRequest(input))
  } catch (error) {
    console.error('Vercel Dance Agent failed:', error instanceof Error ? error.message : 'Unknown error')
    return response.status(502).json({ error: 'Agent request failed' })
  }
}

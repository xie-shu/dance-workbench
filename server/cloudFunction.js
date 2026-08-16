exports.main = async (event = {}) => {
  // CloudBase's HTTP gateway owns CORS for deployed functions. Adding the same
  // header here produces a comma-joined duplicate that browsers reject.
  const responseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  }
  const method = event.httpMethod || event.requestContext?.http?.method || 'POST'
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: responseHeaders, body: '' }
  }
  if (method !== 'POST') return { statusCode: 405, headers: responseHeaders, body: JSON.stringify({ error: 'Method not allowed' }) }
  if (!process.env.OPENAI_API_KEY) return { statusCode: 503, headers: responseHeaders, body: JSON.stringify({ error: 'OPENAI_API_KEY is not configured' }) }

  let input
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body
    input = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!input || typeof input.prompt !== 'string') throw new Error('Invalid input')
  } catch {
    return { statusCode: 400, headers: responseHeaders, body: JSON.stringify({ error: 'Invalid JSON request' }) }
  }

  try {
    const { runAgentRequest } = await import('./index.mjs')
    const result = await runAgentRequest(input)
    return { statusCode: 200, headers: responseHeaders, body: JSON.stringify(result) }
  } catch (error) {
    console.error('Dance Agent function failed:', error instanceof Error ? error.message : 'Unknown error')
    return { statusCode: 502, headers: responseHeaders, body: JSON.stringify({ error: 'AI provider request failed' }) }
  }
}

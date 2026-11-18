// Vercel serverless function: GET /api/scores?date=YYYY-MM-DD
import { scoresResponse } from '../src/scoresHandler.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { status, body } = await scoresResponse(url.searchParams.get('date'));
  // Let Vercel's CDN reuse a response for 15s so many viewers share one NHL API call.
  res.setHeader('cache-control', status === 200 ? 'public, s-maxage=15, stale-while-revalidate=30' : 'no-store');
  res.setHeader('content-type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

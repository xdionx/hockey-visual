// Shared by the local server (server.js) and the Vercel function (api/scores.js).
import { getScoreboard } from './nhlApi.js';
import { normalizeScoreboard } from './normalize.js';

/** Returns { status, body } for a requested date (YYYY-MM-DD) or today when empty. */
export async function scoresResponse(date) {
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 400, body: { error: 'date must be YYYY-MM-DD' } };
  }
  try {
    return { status: 200, body: normalizeScoreboard(await getScoreboard(date || undefined)) };
  } catch (err) {
    console.error(err);
    return { status: 502, body: { error: err.message } };
  }
}

// Where live data comes from. Empty = the static data/ files the GitHub Action saves.
// The publish workflow fills this in from the LIVE_API_URL repository variable
// (the Cloudflare Worker in worker/), e.g. https://hockey-visual-live.<you>.workers.dev
export const LIVE_API = '';

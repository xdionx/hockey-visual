// Where live data comes from: the Cloudflare Worker in worker/ (deployed by
// .github/workflows/worker.yml). Set to '' to use only the static data/ files the
// GitHub Action saves. The publish workflow can override it with the LIVE_API_URL
// repository variable.
export const LIVE_API = 'https://hockey-visual-live.xdionx.workers.dev';

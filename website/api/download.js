// Serves https://mapw.vercel.app/download → static file under our domain
// No GitHub in any copy (pre or post download). File lives in /public/download
// and is served from Vercel's edge (fast, 37 Mbps), not proxied.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // 302 to our own static asset keeps the domain as mapw.vercel.app
  return res.redirect(302, '/download/mapw-setup-0.1.27.exe');
}

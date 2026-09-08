// Serves https://mapw.vercel.app/download → static file under our domain
// No GitHub
// And is
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // 302 to
  return res.redirect(302, '/download/mapw-setup-0.1.28.exe');
}
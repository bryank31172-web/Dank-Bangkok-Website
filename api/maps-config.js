export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).json({ key: process.env.GOOGLE_MAPS_BROWSER_KEY || '' });
}

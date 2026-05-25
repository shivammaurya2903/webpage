const IMAGE_PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="Image unavailable">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#120d1b" />
      <stop offset="100%" stop-color="#24193a" />
    </linearGradient>
  </defs>
  <rect width="960" height="540" rx="40" fill="url(#bg)" />
  <rect x="56" y="56" width="848" height="428" rx="28" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="4" />
  <circle cx="250" cy="260" r="72" fill="rgba(212,175,55,0.18)" />
  <path d="M188 300c30-55 72-82 126-82 48 0 90 23 130 71l26 31h112c18 0 32 14 32 32v42c0 14-12 26-26 26h-34c-10 33-40 57-76 57s-66-24-76-57H348c-10 33-40 57-76 57s-66-24-76-57h-26c-14 0-26-12-26-26v-28c0-13 5-24 14-36z" fill="rgba(212,175,55,0.8)" />
  <text x="480" y="392" fill="#f6f1e7" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" text-anchor="middle">Image unavailable</text>
</svg>`;

const DEFAULT_IMAGE_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(IMAGE_PLACEHOLDER_SVG)}`;

function normalizeImageUrl(value) {
  return String(value || '').trim();
}

function isValidImageUrl(value) {
  const url = normalizeImageUrl(value);
  if (!url) return true;

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    const pathname = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (/\.(jpe?g|png|webp)(?:$|\?)/.test(pathname)) return true;

    const host = parsed.hostname.toLowerCase();
    return host === 'images.unsplash.com' || host === 'unsplash.com' || host.endsWith('.cloudinary.com') || host.includes('image');
  } catch (_) {
    return false;
  }
}

function sanitizeImageUrl(value, fallback = '') {
  const url = normalizeImageUrl(value);
  if (!url) return fallback;
  if (!isValidImageUrl(url)) {
    throw new Error('Image URL must be a direct JPG, JPEG, PNG, or WEBP link');
  }
  return url;
}

module.exports = {
  DEFAULT_IMAGE_URL,
  normalizeImageUrl,
  isValidImageUrl,
  sanitizeImageUrl
};
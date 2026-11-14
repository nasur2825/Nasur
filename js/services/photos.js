/* NASUR - Photo service (Phase 4): compression + timestamp/location watermark */
import { getUserConfig } from './config.js';

const DEFAULTS = { maxEdge: 1280, quality: 0.7 };

function cfgOpts() {
  const c = getUserConfig() || {};
  return {
    enabled: c.autoCompressPhotos !== false,
    maxEdge: Number(c.photoMaxEdge) || DEFAULTS.maxEdge,
    quality: Number(c.photoQuality) || DEFAULTS.quality
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function stampLines(meta) {
  const m = meta || {};
  const d = m.date instanceof Date ? m.date : new Date(m.date || Date.now());
  const date = isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const time = m.time || (isNaN(d.getTime()) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()));
  const lines = [];
  lines.push((m.label ? m.label + '  ' : '') + date + '  ' + time);
  if (m.location) lines.push(String(m.location));
  if (m.project) lines.push(String(m.project));
  if (m.obsNo) lines.push(String(m.obsNo));
  return lines.filter(Boolean);
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      /* fall through to Image */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Cannot read image'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function drawWatermark(ctx, w, h, lines) {
  if (!lines || !lines.length) return;
  const size = Math.max(14, Math.round(Math.min(w, h) / 38));
  const pad = Math.round(size * 0.6);
  ctx.font = '600 ' + size + 'px sans-serif';
  ctx.textBaseline = 'top';
  const lineH = Math.round(size * 1.3);
  let widest = 0;
  lines.forEach((l) => {
    widest = Math.max(widest, ctx.measureText(l).width);
  });
  const boxW = Math.min(w, Math.ceil(widest + pad * 2));
  const boxH = lines.length * lineH + pad * 2 - Math.round(size * 0.3);
  const x = 0;
  const y = h - boxH;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => {
    ctx.fillText(l, x + pad, y + pad + i * lineH, w - pad * 2);
  });
}

/* Returns a compressed JPEG data URL with the watermark burned in. */
export async function processPhoto(file, meta, opts) {
  if (!file) throw new Error('No photo selected');
  const base = cfgOpts();
  const o = { ...base, ...(opts || {}) };
  const bmp = await decode(file);
  const srcW = bmp.width || bmp.naturalWidth;
  const srcH = bmp.height || bmp.naturalHeight;
  const scale = o.enabled === false ? 1 : Math.min(1, o.maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  if (!opts || opts.watermark !== false) drawWatermark(ctx, w, h, stampLines(meta));
  return canvas.toDataURL('image/jpeg', Math.min(0.95, Math.max(0.3, o.quality)));
}

export function dataUrlBytes(dataUrl) {
  if (!dataUrl) return 0;
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

export function formatBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/* Small preview for sheet cells and lists */
export async function makeThumb(dataUrl, edge) {
  if (!dataUrl) return '';
  const size = edge || 160;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Bad image'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.6);
}

/* Opens the camera / gallery picker and resolves with the chosen File (or null). */
export function pickPhoto(capture) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const f = input.files && input.files[0] ? input.files[0] : null;
      input.remove();
      resolve(f);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

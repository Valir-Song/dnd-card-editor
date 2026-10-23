// Shrinks pictures before they enter the layout. A phone photo (3–5 MB) is
// far larger than a card background needs, and every byte is repeated in the
// browser save and the downloaded HTML. 1600 px on the long side is ~350 dpi
// across a full card and plenty for a picture on the sheet.
export const MAX_SIDE = 1600;
export const QUALITY = 0.85;

/** Size that fits within `max` on the long side, never enlarged.
 * @param {number} width @param {number} height */
export function fitWithin(width, height, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(width, height));
  return {width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k))};
}

/** @param {File} file @returns {Promise<string>} */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** @param {string} src @returns {Promise<HTMLImageElement>} */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error('Не удалось открыть картинку.'));
    img.src = src;
  });
}

// Vector and animated pictures lose what makes them special on a canvas.
const KEEP = /^data:image\/(svg\+xml|gif)[;,]/;

/**
 * Returns a smaller data URL for the picture, or the original when it is
 * already small, cannot be re-encoded well (SVG, GIF) or would not shrink.
 * Transparent pictures stay transparent (WebP, or PNG where WebP is missing).
 * @param {string} src
 * @returns {Promise<string>}
 */
export async function compressImage(src) {
  if (!src.startsWith('data:image/') || KEEP.test(src)) return src;
  const img = await loadImage(src);
  const size = fitWithin(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src; // no canvas available: keep the picture as it is
  ctx.drawImage(img, 0, 0, size.width, size.height);
  let result;
  if (hasTransparency(ctx, size)) {
    result = canvas.toDataURL('image/webp', QUALITY);
    if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/png');
  } else {
    result = canvas.toDataURL('image/jpeg', QUALITY);
  }
  return result.length < src.length ? result : src;
}

/** @param {CanvasRenderingContext2D} ctx @param {{width: number, height: number}} size */
function hasTransparency(ctx, {width, height}) {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/** File → compressed data URL. @param {File} file */
export async function readCompressed(file) {
  return compressImage(await readFile(file));
}

// =========================================================================
// optimizeFile.js — shrink documents before upload to save R2 space.
//
// Images (the common case: a phone photo of a marksheet, often 3–8 MB) are
// downscaled to a sane max dimension and re-encoded as JPEG (~0.72 quality),
// which typically cuts them to a few hundred KB. PDFs pass through unchanged
// (reliable in-browser PDF recompression isn't feasible) but must be under the
// cap. Only JPG/JPEG and PDF are accepted (per the office requirement); other
// image types a phone might produce (png/webp/heic) are still optimized to JPG
// where the browser can decode them.
// =========================================================================

const MAX_DIM = 1600;          // longest edge, px
const JPEG_QUALITY = 0.72;
export const SIZE_CAP = 8 * 1024 * 1024; // 8 MB hard cap (matches the edge fn)

export async function optimizeForUpload(file) {
  const type = (file.type || '').toLowerCase();

  if (type === 'application/pdf') {
    if (file.size > SIZE_CAP) {
      throw new Error('This PDF is over 8 MB. Please upload a smaller scan.');
    }
    return file; // pass-through
  }

  if (!type.startsWith('image/')) {
    throw new Error('Only JPG or PDF files are allowed.');
  }

  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    // e.g. HEIC on a browser that can't decode it — send the original if it fits.
    if (file.size > SIZE_CAP) {
      throw new Error('This image could not be optimized and is over 8 MB. Please upload a JPG under 8 MB.');
    }
    return file;
  }

  const srcW = bitmap.width || bitmap.naturalWidth;
  const srcH = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';       // flatten any transparency for JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) return file;

  const optimized = new File([blob], renameToJpg(file.name), { type: 'image/jpeg' });
  // If the original JPEG was already smaller (tiny image), keep it.
  if (type === 'image/jpeg' && file.size <= optimized.size) return file;
  if (optimized.size > SIZE_CAP) {
    throw new Error('Even after optimizing, this file is over 8 MB. Please upload a smaller image.');
  }
  return optimized;
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

function renameToJpg(name) {
  return (String(name).replace(/\.[^.]+$/, '') || 'document') + '.jpg';
}

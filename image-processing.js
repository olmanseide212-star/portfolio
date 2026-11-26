export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const TARGET_BYTES = 2 * 1024 * 1024;
export function validateSource(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。HEIC、PDF、PPT 请先导出为图片。');
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('原图需小于 50 MB，请先缩小后再选择');
}
export function fitDimensions(width, height, edge = 3200) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效');
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function formatSize(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function encode(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败，请换一张图片重试')), 'image/webp', quality));
}
export async function prepareImage(file, onProgress = () => {}) {
  validateSource(file);
  if (typeof createImageBitmap !== 'function') throw new Error('当前浏览器不支持自动压缩，请使用较新版本的 Safari、Chrome 或 Edge');
  onProgress('正在读取图片…');
  let bitmap, canvas;
  try {
    // EXIF orientation is applied by the decoder. No data URL or localStorage is used.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (bitmap.width * bitmap.height > 80000000) throw new Error('图片超过 8000 万像素，请先降低分辨率');
    const original = { width: bitmap.width, height: bitmap.height };
    let dimensions = fitDimensions(bitmap.width, bitmap.height);
    if (file.size <= TARGET_BYTES && dimensions.width === bitmap.width && dimensions.height === bitmap.height) {
      return { file, originalBytes: file.size, ...original, compressed: false };
    }
    canvas = document.createElement('canvas');
    let output;
    for (let pass = 0; pass < 5; pass++) {
      canvas.width = dimensions.width; canvas.height = dimensions.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法处理图片，请更换浏览器重试');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.82, 0.72]) {
        onProgress(`正在优化图片 · ${canvas.width} × ${canvas.height}`);
        output = await encode(canvas, quality);
        if (output.size <= TARGET_BYTES) break;
      }
      if (output.size <= TARGET_BYTES) break;
      dimensions = fitDimensions(canvas.width, canvas.height, Math.floor(Math.max(canvas.width, canvas.height) * 0.75));
    }
    if (!output || output.size > MAX_UPLOAD_BYTES) throw new Error('压缩后仍超过 8 MB，请裁剪图片后重试');
    if (file.size < output.size && file.size <= MAX_UPLOAD_BYTES) return { file, originalBytes: file.size, ...original, compressed: false };
    const extension = output.type === 'image/webp' ? 'webp' : 'png';
    const result = new File([output], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: output.type });
    return { file: result, originalBytes: file.size, width: canvas.width, height: canvas.height, compressed: true };
  } catch (error) {
    if (error.name === 'InvalidStateError' || error.name === 'EncodingError') throw new Error('无法解码这张图片，请重新导出为 JPG、PNG 或 WebP');
    throw error;
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

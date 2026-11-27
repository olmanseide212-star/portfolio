export const MAX_PAGES = 30;
const storagePath = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const localPath = /^images\/[a-zA-Z0-9._-]+$/;
export function projectPages(project) {
  if (Array.isArray(project.images)) return project.images.map(page => ({...page}));
  if (project.image_path) return [{path:project.image_path,caption:''}];
  if (project.static_image) return [{static_image:project.static_image,caption:''}];
  return [];
}
export function pageURL(page, baseURL) {
  if (page.path && storagePath.test(page.path) && baseURL) return `${baseURL}/storage/v1/object/public/portfolio/${page.path}`;
  if (page.static_image && localPath.test(page.static_image)) return page.static_image;
  return null;
}
export function validatePages(pages) {
  if (!Array.isArray(pages) || pages.length > MAX_PAGES) throw new Error(`每件作品最多 ${MAX_PAGES} 页`);
  const seen = new Set();
  for (const page of pages) {
    if (!page || typeof page !== 'object') throw new Error('作品页面无效');
    if (typeof (page.caption ?? '') !== 'string' || [...(page.caption || '')].length > 80) throw new Error('单页名称不能超过 80 个字符');
    const sources = [Boolean(page.file),Boolean(page.path),Boolean(page.static_image)].filter(Boolean).length;
    if (sources !== 1 || (page.path && !storagePath.test(page.path)) || (page.static_image && !localPath.test(page.static_image))) throw new Error('作品图片路径无效');
    if (page.file && (!['image/jpeg','image/png','image/webp'].includes(page.file.type) || !page.file.size || page.file.size > 8388608)) throw new Error('请选择压缩后 8 MB 以内的 JPG、PNG 或 WebP 图片');
    const key = page.path || page.static_image;
    if (key && seen.has(key)) throw new Error('同一张图片不能重复添加');
    if (key) seen.add(key);
  }
}
export function movePage(pages, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= pages.length || to < 0 || to >= pages.length) return pages.slice();
  const result=pages.slice(), [page]=result.splice(from,1); result.splice(to,0,page); return result;
}
export function isMissingPlaceholder(page) {
  return Boolean(page && page.static_image && !page.path && !page.file && page.missingPlaceholder === true);
}
export function countEffectivePages(pages) {
  return pages.filter(page => !isMissingPlaceholder(page)).length;
}
export function mergeAddedPages(existingPages, addedPages) {
  const kept = existingPages.filter(page => !isMissingPlaceholder(page));
  return { pages: [...kept, ...addedPages], replacedCount: existingPages.length - kept.length };
}

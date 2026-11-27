import { projectPages, pageURL, validatePages } from './album.js?v=20261127-motion';
import { normalizeProfile, publicContacts } from './profile.js?v=20261127-motion';
const missingProfileTable = error => ['PGRST205', '42P01'].includes(error?.code);
const profileRow = row => ({ intro: typeof row?.intro === 'string' ? row.intro : '', contacts: publicContacts(row?.contacts) });
export class PortfolioAPI {
  constructor(config, request = fetch) {
    this.url = config.url.replace(/\/$/, '');
    this.key = config.publicKey;
    // Native browser fetch requires the Window/global receiver, not this API instance.
    this.request = request.bind(globalThis);
    this.session = null; // Tokens stay in memory; reloading requires signing in again.
  }
  async call(path, options = {}, authenticated = false) {
    if (authenticated && !this.session) throw new Error('请先登录');
    if (authenticated && Date.now() >= this.session.expiresAt - 60000) {
      try {
        const renewed = await this.call('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: JSON.stringify({ refresh_token: this.session.refresh_token })
        });
        this.setSession(renewed);
      } catch { this.session = null; throw new Error('登录已过期，请重新登录'); }
    }
    const headers = { apikey: this.key, ...options.headers };
    if (authenticated) headers.Authorization = `Bearer ${this.session.access_token}`;
    if (typeof options.body === 'string') headers['Content-Type'] = 'application/json';
    const response = await this.request(this.url + path, { ...options, headers, signal: AbortSignal.timeout(options.body instanceof Blob ? 120000 : 30000) });
    if (!response.ok) {
      let detail = {};
      try { detail = await response.json(); } catch { /* Gateways may return non-JSON errors. */ }
      const authMessages = {
        invalid_credentials: '邮箱或密码错误，或此邮箱尚未在当前 Supabase 项目创建账号。请使用作品管理员账号，不是 Supabase 控制台账号。',
        email_not_confirmed: '邮箱尚未验证，请先完成邮箱确认，再登录。',
        email_provider_disabled: '后端未开启邮箱登录，请在 Supabase Authentication 中启用 Email 登录。',
        user_banned: '此账号已被禁用，请在 Supabase Authentication 检查账号状态。',
        captcha_failed: '后端要求验证码，但当前登录页未接入验证码，请联系网站管理员。',
        over_request_rate_limit: '登录请求过于频繁，请稍后再试。'
      };
      if (path.startsWith('/auth/v1/')) {
        const code = detail?.code || detail?.error_code;
        if (authMessages[code]) throw new Error(authMessages[code]);
        if (response.status === 429) throw new Error('登录请求过于频繁，请稍后再试。');
        // Keep unknown Auth diagnostics visible, without logging submitted credentials.
        // The UI renders this message via textContent, never as HTML.
        const reason = [code || detail?.error, detail?.msg || detail?.message || detail?.error_description]
          .filter(value => typeof value === 'string' && value.trim())
          .map(value => value.replace(/[\r\n\t]+/g, ' ').slice(0, 240))
          .join('：');
        if (reason) throw new Error(`认证失败（${response.status}）：${reason}`);
        if (response.status === 400) throw new Error('登录请求被拒绝（400），请检查管理员账号、邮箱验证状态和邮箱登录设置。');
      }
      if (response.status === 401) throw new Error('登录失效或账号密码错误');
      if (response.status === 403) throw new Error('没有操作权限，请检查管理员设置');
      if (detail?.code === 'PGRST204') throw new Error('数据库需要升级，请执行多页作品升级脚本');
      if (detail?.code === '42703') throw Object.assign(new Error('数据库需要升级，请执行作品管理升级脚本'), { code: '42703' });
      if (detail?.code === '23514') throw new Error('数据不符合数据库规则，请检查分类、页数和图片路径，并确认已执行升级脚本');
      if (response.status === 413) throw new Error('图片不能超过 8 MB');
      throw Object.assign(new Error(`请求失败（${response.status}），请检查后端配置或稍后重试`), { code: detail?.code, status: response.status });
    }
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }
  setSession(data) {
    this.session = { ...data, expiresAt: Date.now() + data.expires_in * 1000 };
  }
  async login(email, password) {
    const data = await this.call('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    this.setSession(data);
    try {
      const admins = await this.call('/rest/v1/portfolio_admins?select=user_id', {}, true);
      if (!admins.length) throw new Error('此账号没有作品管理权限');
    } catch (error) {
      // A logout/network failure must not hide the original authorization error.
      try { await this.logout(); } catch { /* logout always clears the local session. */ }
      throw error;
    }
  }
  async logout() {
    try { if (this.session) await this.call('/auth/v1/logout', { method: 'POST' }, true); }
    finally { this.session = null; }
  }
  async list(archived = false) {
    try {
      const rows = await this.call(`/rest/v1/projects?select=*&deleted_at=${archived ? 'not.is.null' : 'is.null'}&order=sort_order.desc,created_at.desc`, {}, archived);
      this.needsSchemaUpgrade = false;
      this.needsAlbumUpgrade = rows.length > 0 && !Object.hasOwn(rows[0], 'images');
      return rows;
    } catch (error) {
      // Keep existing cloud artwork visible until the owner applies the migration.
      if (error.code !== '42703' || archived) throw error;
      this.needsSchemaUpgrade = true;
      return this.call('/rest/v1/projects?select=*&order=sort_order.desc,created_at.desc');
    }
  }
  async setArchived(id, archived) {
    if (!id) throw new Error('请先选择作品');
    const rows = await this.call(`/rest/v1/projects?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ deleted_at: archived ? new Date().toISOString() : null })
    }, true);
    if (!rows?.length) throw new Error('操作未完成，作品不存在或没有管理权限');
    return rows[0];
  }
  imageURL(project) {
    const cover = projectPages(project)[0];
    return cover ? pageURL(cover, this.url) : null;
  }
  async save({ id, title, category, description, file, pages, onProgress }) {
    const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!this.session) throw new Error('请先登录');
    if (!title.trim() || title.trim().length > 80 || description.length > 1000) throw new Error('请检查标题和描述长度');
    if (typeof category !== 'string' || !category.trim() || [...category.trim()].length > 30) throw new Error('分类需为 1–30 个字符');
    if (pages !== undefined) return this.saveAlbum({ id, title, category, description, pages, onProgress });
    if (!id && !file) throw new Error('新增作品需要选择图片');
    if (file && (!types[file.type] || !file.size || file.size > 8388608)) throw new Error('请选择 8 MB 以内的 JPG、PNG 或 WebP 图片');
    let path;
    if (file) {
      path = `${this.session.user.id}/${crypto.randomUUID()}.${types[file.type]}`;
      await this.call(`/storage/v1/object/portfolio/${path}`, {
        method: 'POST', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file
      }, true);
    }
    const record = { title: title.trim(), category: category.trim(), description, ...(path ? { image_path: path } : {}) };
    try {
      const saved = await this.call(`/rest/v1/projects${id ? '?id=eq.' + encodeURIComponent(id) : ''}`, {
        method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(record)
      }, true);
      if (!saved?.length) throw new Error('作品未保存，请检查管理员权限');
      return saved;
    } catch (error) {
      // Only an unreferenced object may be removed by the storage policy.
      if (path) {
        try { await this.call('/storage/v1/object/portfolio', { method: 'DELETE', body: JSON.stringify({ prefixes: [path] }) }, true); }
        catch { throw new Error(`${error.message}；图片清理未确认，请在 Storage 检查未引用文件`); }
      }
      throw error;
    }
  }
  async saveAlbum({ id, title, category, description, pages, onProgress = () => {} }) {
    validatePages(pages);
    if (!id && !pages.length) throw new Error('新增作品至少需要一张图片');
    // Fail before uploading if the owner has not applied the album migration.
    try { await this.call('/rest/v1/projects?select=images&limit=0'); }
    catch (error) {
      if (error.code === '42703') throw new Error('请先执行多页作品升级脚本，再保存作品');
      throw error;
    }
    const attemptedPaths = [], images = [];
    try {
      const total = pages.filter(page => page.file).length;
      let uploaded = 0;
      for (const page of pages) {
        let path = page.path;
        if (page.file) {
          const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[page.file.type];
          path = `${this.session.user.id}/${crypto.randomUUID()}.${extension}`;
          // Include uncertain uploads in cleanup if a response is lost.
          attemptedPaths.push(path);
          onProgress(`正在上传第 ${++uploaded} / ${total} 张图片…`);
          await this.call(`/storage/v1/object/portfolio/${path}`, {
            method:'POST', headers:{'Content-Type':page.file.type,'x-upsert':'false'}, body:page.file
          }, true);
        }
        images.push({ ...(path ? {path} : {static_image:page.static_image}), caption:page.caption || '' });
      }
      onProgress('正在保存作品页面与顺序…');
      const record = { title:title.trim(), category:category.trim(), description, images };
      const rows = await this.call(`/rest/v1/projects${id ? '?id=eq.'+encodeURIComponent(id) : ''}`, {
        method:id ? 'PATCH':'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify(record)
      },true);
      if (!rows?.length) throw new Error('作品未保存，请检查管理员权限');
      return rows;
    } catch (error) {
      if (attemptedPaths.length) {
        try { await this.call('/storage/v1/object/portfolio', {method:'DELETE',body:JSON.stringify({prefixes:attemptedPaths})},true); }
        catch { throw new Error(`${error.message}；图片清理未确认，请刷新检查作品后再重试`); }
      }
      throw error;
    }
  }

  async getProfile() {
    try {
      const rows = await this.call('/rest/v1/site_profile?select=intro,contacts&id=eq.1');
      this.needsProfileUpgrade = false;
      return profileRow(rows?.[0]);
    } catch (error) {
      // Keep the gallery working until the owner applies the profile migration.
      if (missingProfileTable(error)) { this.needsProfileUpgrade = true; return null; }
      throw error;
    }
  }
  async saveProfile(profile) {
    if (!this.session) throw new Error('请先登录');
    const clean = normalizeProfile(profile);
    let rows;
    try {
      rows = await this.call('/rest/v1/site_profile?id=eq.1&select=intro,contacts', {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...clean, updated_at: new Date().toISOString() })
      }, true);
    } catch (error) {
      if (missingProfileTable(error)) throw new Error('请先在 Supabase 执行「关于我」升级脚本，再保存');
      throw error;
    }
    if (!rows?.length) throw new Error('资料未保存，请确认已执行「关于我」升级脚本，并使用管理员账号登录');
    this.needsProfileUpgrade = false;
    return profileRow(rows[0]);
  }

}

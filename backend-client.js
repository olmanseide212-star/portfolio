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
      if (response.status === 401) throw new Error('登录失效或账号密码错误');
      if (response.status === 403) throw new Error('没有操作权限，请检查管理员设置');
      if (response.status === 413) throw new Error('图片不能超过 8 MB');
      throw new Error(`请求失败（${response.status}），请检查后端配置或稍后重试`);
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
    } catch (error) { await this.logout(); throw error; }
  }
  async logout() {
    try { if (this.session) await this.call('/auth/v1/logout', { method: 'POST' }, true); }
    finally { this.session = null; }
  }
  list() {
    return this.call('/rest/v1/projects?select=*&order=sort_order.desc,created_at.desc');
  }
  imageURL(project) {
    return project.image_path ? `${this.url}/storage/v1/object/public/portfolio/${project.image_path}` : project.static_image;
  }
  async save({ id, title, category, description, file }) {
    const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!this.session) throw new Error('请先登录');
    if (!title.trim() || title.trim().length > 80 || description.length > 1000) throw new Error('请检查标题和描述长度');
    if (!['节目单','海报','概念设计','PPT','摄影'].includes(category)) throw new Error('请选择有效分类');
    if (!id && !file) throw new Error('新增作品需要选择图片');
    if (file && (!types[file.type] || !file.size || file.size > 8388608)) throw new Error('请选择 8 MB 以内的 JPG、PNG 或 WebP 图片');
    let path;
    if (file) {
      path = `${this.session.user.id}/${crypto.randomUUID()}.${types[file.type]}`;
      await this.call(`/storage/v1/object/portfolio/${path}`, {
        method: 'POST', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file
      }, true);
    }
    const record = { title: title.trim(), category, description, ...(path ? { image_path: path } : {}) };
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
}

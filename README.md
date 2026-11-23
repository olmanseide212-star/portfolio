# 个人作品集：GitHub Pages + Supabase

前端保留深蓝与金色、手机适配、分类筛选、图片大图。后端使用 Supabase 的 PostgreSQL、Auth 和 Storage。网站底部的「管理作品」支持管理员登录、新增作品、修改标题/分类/介绍、给原有作品补图或换图。不开放访客注册、上传或删除。

## 首次部署

### 1. 创建 Supabase 项目

在 https://supabase.com/dashboard 创建项目，选择你和主要访客访问较好的区域。数据库密码自行保管，不要提交到 GitHub。项目创建后，在 SQL Editor 粘贴并执行 `backend/schema.sql` 的全部内容。此脚本会：

- 建立管理员白名单和作品表，并启用 RLS 权限规则。
- 建立公开图片桶 `portfolio`，限制 JPG、PNG、WebP，单文件最大 8 MiB。
- 预填原有六个作品，保留 `images/` 路径作为未补图时的回退。

脚本可以重复执行，不覆盖已经修改的六个作品。请使用独立的新项目，避免与其他应用的宽松权限策略叠加。

### 2. 创建唯一管理员

在 Authentication 的 Users 页面创建你的邮箱密码用户（如有自动确认邮箱选项，开启）。没有提供网页注册入口；同时在 Authentication 的登录/注册设置中关闭新用户注册。

复制该用户的 UUID，在 SQL Editor 执行以下 SQL，把示例 UUID 替换为真实值：

```sql
insert into public.portfolio_admins (user_id)
values ('这里替换为管理员用户的UUID')
on conflict do nothing;
```

只有白名单中的用户可以添加或编辑作品、上传图片。普通登录用户也没有写权限。移除白名单会立即撤销后续写入权限。

### 3. 连接前端

从项目的 Connect / API Keys 页面取得项目 URL 和 **publishable key**（或旧的 anon key），填写 `config.js`：

```js
export const backendConfig = {
  url: 'https://你的项目ID.supabase.co',
  publicKey: '你的publishable或anon公钥'
};
```

这两个值是供浏览器使用的公开配置，可以提交到公开仓库。**不能填 secret key、service_role key、数据库密码或管理员密码**。公钥不是管理员凭证；实际权限由登录身份和 RLS 决定。

前端没有自动保存登录信息；关闭/刷新页面后需重新登录。登录期间的短期令牌和续期令牌只存在内存中。

### 4. 发布

```sh
git add index.html config.js backend-client.js backend/schema.sql package.json tests README.md
git commit -m "feat: add Supabase artwork management"
git push origin main
```

原 GitHub Pages 设置继续使用 main / root。部署完成后打开 https://olmanseide212-star.github.io/portfolio/ ，在底部点击「管理作品」，输入你的管理员邮箱和密码。

新增作品：选择「新增作品」，填写标题、分类、介绍，选图片并点击「发布作品」。

补充原作品：在「操作」下拉框选择原有作品，选图片并发布。已有图片的作品如果不选新图，会保留原图。

## 验收清单（连接真实项目后执行）

1. 未登录打开网站：看到六个作品，可筛选、适配手机。
2. 使用错误密码：登录失败，不能上传。
3. 使用普通非管理员账号：拒绝管理；直接调用 REST 写入也应被 RLS 拒绝。
4. 管理员给一张占位卡上传图片：发布成功后标题、介绍和图片展示正常，大图可打开。
5. 用另一台设备或隐身窗口打开首页：无需登录能看到刚发布的图片。
6. 新增一个作品，确认刷新后仍然存在；编辑时不选图片，确认原图不变。
7. 上传超过 8 MiB 或 SVG 文件：被拒绝；双击发布不会并发提交。
8. 退出或刷新后，必须重新登录才能管理。
9. 临时让后端不可达：首页显示静态回退和加载失败提示，不伪装为最新在线数据。

## 本地运行与测试

需要 Node.js 20+、Python 3。无 npm 依赖、无构建步骤：

```sh
npm test
npm run preview
```

访问 http://localhost:8000 ，不要双击 HTML 使用 file://（ES modules 需要 HTTP）。测试使用模拟 HTTP 响应，不会创建云端数据；真实的 RLS、Storage 和跨设备验收需在项目建立后执行。

## 工程设计

浏览器 → Supabase Auth（验证身份）→ 带 JWT 的 Storage 上传 → projects 写入 → 公开首页读取作品。

- 作品表只存文字、图片路径和排序信息；图片二进制存在 Storage。没有 base64 图片写入 localStorage 的问题。
- `portfolio_admins` 由数据库管理员维护；浏览器没有修改白名单的权限。作品表和图片桶分别实施权限检查，隐藏上传按钮不是安全措施。
- 图片使用用户 UUID / 随机 UUID 命名，避免中文路径兼容问题和同名覆盖。图片桶是公开的，只适合展示用图片，不适合敏感文件。
- 图片先上传、作品后写入；数据库写入失败会尝试删除未引用的图片。Storage 删除策略禁止删除正在被作品引用的图，避免响应丢失后误删已发布图片。
- 图片与数据库不共享一个事务，网络中断仍可能留下孤立文件。更换图片也暂时保留旧图，便于人工恢复；长期使用可增加服务端定时清理。请在 Supabase Storage 中谨慎清理已确认不再引用的文件。
- 标题和描述使用 `textContent` 渲染，不把用户输入拼成 HTML。图片类型和大小既在客户端限制，也由云端桶配置限制。未做图片重新编码或内容审核，上传权限只给可信管理员。
- 后端加载失败保留原静态卡片；后端正常返回空表则显示空状态。没有实时订阅，新访客和刷新页面会获取最新作品。
- 不需要常驻自建服务器，但仍需要维护 Supabase 账号、用量、存储和备份。数据库与图片应分别备份；服务套餐/配额以项目控制台当前信息为准。

相关官方文档：
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control

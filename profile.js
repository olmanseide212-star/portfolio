// About/contact data rules. Mirrors public.valid_profile_contacts in the database.
export const MAX_CONTACTS = 12;
export const MAX_INTRO = 300;
export const MAX_VALUE = 200;
export const MAX_LABEL = 40;
export const PLATFORMS = Object.freeze({
  email: { label: '邮箱', kind: 'copy', badge: '@', placeholder: 'name@example.com' },
  wechat: { label: '微信', kind: 'copy', badge: '微', placeholder: '微信号' },
  xiaohongshu: { label: '小红书', kind: 'link', badge: '书', placeholder: 'https://www.xiaohongshu.com/user/profile/…' },
  bilibili: { label: 'B 站', kind: 'link', badge: 'B', placeholder: 'https://space.bilibili.com/…' },
  weibo: { label: '微博', kind: 'link', badge: '博', placeholder: 'https://weibo.com/…' },
  douyin: { label: '抖音', kind: 'link', badge: '抖', placeholder: 'https://www.douyin.com/user/…' },
  instagram: { label: 'Instagram', kind: 'link', badge: 'IG', placeholder: 'https://www.instagram.com/…' },
  behance: { label: 'Behance', kind: 'link', badge: 'Be', placeholder: 'https://www.behance.net/…' },
  website: { label: '个人网站', kind: 'link', badge: '↗', placeholder: 'https://…' }
});
const emailPattern = /^[^\s@?#]+@[^\s@?#]+\.[^\s@?#]+$/;
const httpsPattern = /^https:\/\/\S+$/;
const length = text => [...text].length;

function isHttps(value) {
  if (!httpsPattern.test(value)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function normalizeProfile({ intro = '', contacts = [] } = {}) {
  if (typeof intro !== 'string') throw new Error('介绍格式无效');
  const cleanIntro = intro.trim();
  if (length(cleanIntro) > MAX_INTRO) throw new Error(`一句话介绍不能超过 ${MAX_INTRO} 个字`);
  if (!Array.isArray(contacts)) throw new Error('联系方式格式无效');
  if (contacts.length > MAX_CONTACTS) throw new Error(`联系方式最多 ${MAX_CONTACTS} 条`);
  const clean = contacts.map((contact, index) => {
    if (!contact || typeof contact !== 'object') throw new Error(`第 ${index + 1} 条联系方式无效`);
    const meta = PLATFORMS[contact.platform];
    if (!meta) throw new Error(`第 ${index + 1} 条联系方式的平台无效`);
    const where = `第 ${index + 1} 条（${meta.label}）`;
    const value = typeof contact.value === 'string' ? contact.value.trim() : '';
    const label = typeof contact.label === 'string' ? contact.label.trim() : '';
    if (!value) throw new Error(`${where}还没有填写内容`);
    if (length(value) > MAX_VALUE) throw new Error(`${where}不能超过 ${MAX_VALUE} 个字符`);
    if (length(label) > MAX_LABEL) throw new Error(`${where}的显示文字不能超过 ${MAX_LABEL} 个字`);
    if (contact.platform === 'email' && !emailPattern.test(value)) throw new Error(`${where}邮箱格式不正确`);
    if (contact.platform === 'wechat' && /\s/.test(value)) throw new Error(`${where}微信号不能包含空格`);
    if (meta.kind === 'link' && !isHttps(value)) throw new Error(`${where}请填写以 https:// 开头的完整链接`);
    return label ? { platform: contact.platform, value, label } : { platform: contact.platform, value };
  });
  return { intro: cleanIntro, contacts: clean };
}

// Only mailto: for valid emails and https: links are ever produced.
export function contactHref(contact) {
  const meta = PLATFORMS[contact?.platform];
  if (!meta || typeof contact.value !== 'string') return null;
  if (contact.platform === 'email') return emailPattern.test(contact.value) ? `mailto:${contact.value}` : null;
  if (meta.kind === 'link') return isHttps(contact.value) ? contact.value : null;
  return null;
}

export function contactText(contact) {
  if (typeof contact.label === 'string' && contact.label.trim()) return contact.label.trim();
  if (PLATFORMS[contact.platform]?.kind !== 'link') return contact.value;
  try {
    const url = new URL(contact.value);
    const text = `${url.hostname.replace(/^www\./, '')}${url.pathname}`.replace(/\/$/, '');
    return text.length > 34 ? `${text.slice(0, 33)}…` : text;
  } catch { return contact.value; }
}

// Drops unknown platforms and unsafe links so rendering never trusts raw rows.
export function publicContacts(contacts) {
  if (!Array.isArray(contacts)) return [];
  return contacts.filter(contact => {
    const meta = PLATFORMS[contact?.platform];
    if (!meta || typeof contact.value !== 'string' || !contact.value.trim()) return false;
    return meta.kind === 'copy' && contact.platform !== 'email' ? true : Boolean(contactHref(contact));
  }).map(contact => ({ platform: contact.platform, value: contact.value, ...(typeof contact.label === 'string' && contact.label ? { label: contact.label } : {}) }));
}

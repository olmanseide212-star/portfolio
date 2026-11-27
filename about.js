import { PLATFORMS, MAX_CONTACTS, MAX_INTRO, normalizeProfile, contactHref, contactText, publicContacts } from './profile.js?v=20261127-cinema';
const $ = id => document.getElementById(id);
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }

let toastTimer = 0;
export function showToast(message) {
  const node = $('toast');
  node.textContent = message; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2400);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    // Older browsers or insecure contexts: fall back to a temporary selection.
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    area.remove();
    showToast(copied ? successMessage : `请手动复制：${text}`);
  }
}

function contactItem(contact) {
  const meta = PLATFORMS[contact.platform], href = contactHref(contact);
  const item = el('li', 'contact-item');
  let card;
  if (meta.kind === 'copy') {
    card = el('button', 'contact-card'); card.type = 'button';
    card.setAttribute('aria-label', `复制${meta.label}：${contact.value}`);
    card.addEventListener('click', () => copyText(contact.value, `已复制${meta.label}`));
  } else {
    if (!href) return null;
    card = el('a', 'contact-card'); card.href = href; card.target = '_blank'; card.rel = 'noopener noreferrer';
    card.setAttribute('aria-label', `打开${meta.label}：${contactText(contact)}（新窗口）`);
  }
  const badge = el('span', 'contact-badge', meta.badge); badge.setAttribute('aria-hidden', 'true');
  const text = el('span', 'contact-text'); text.append(el('strong', '', meta.label), el('span', '', contactText(contact)));
  const action = el('span', 'contact-action', meta.kind === 'copy' ? '复制' : '↗'); action.setAttribute('aria-hidden', 'true');
  card.append(badge, text, action); item.append(card);
  if (contact.platform === 'email' && href) { const mail = el('a', 'contact-mail', '发邮件'); mail.href = href; item.append(mail); }
  return item;
}

export function renderAbout(profile, reveal = () => {}) {
  const intro = typeof profile?.intro === 'string' ? profile.intro.trim() : '';
  $('aboutIntro').textContent = intro; $('aboutIntro').hidden = !intro;
  const items = publicContacts(profile?.contacts).map(contactItem).filter(Boolean);
  $('contactList').replaceChildren(...items);
  $('contactList').hidden = !items.length;
  $('aboutEmpty').hidden = items.length > 0;
  reveal(items);
}

const clone = profile => ({
  intro: typeof profile?.intro === 'string' ? profile.intro : '',
  contacts: Array.isArray(profile?.contacts) ? profile.contacts.map(contact => ({ platform: contact.platform, value: contact.value ?? '', label: contact.label ?? '' })) : []
});

export function createProfileEditor({ api, notify, isBusy, setBusy, onSaved, onAuthLost }) {
  const form = $('profileForm'), list = $('contactEditor');
  let saved = clone(null), draft = [], dirty = false;
  const markDirty = () => { dirty = true; };
  function updateCounts() {
    $('introCount').textContent = `${[...form.elements.intro.value].length} / ${MAX_INTRO}`;
    $('contactCount').textContent = `${draft.length} / ${MAX_CONTACTS} 条`;
    $('addContact').disabled = isBusy() || draft.length >= MAX_CONTACTS;
  }
  function updateControls() {
    list.querySelectorAll('button[data-action]').forEach(button => {
      const index = Number(button.dataset.position);
      button.disabled = isBusy() || (button.dataset.action === 'up' && index === 0) || (button.dataset.action === 'down' && index === draft.length - 1);
    });
    updateCounts();
  }
  function render(focusIndex) {
    list.replaceChildren(...draft.map((contact, index) => {
      const row = el('div', 'contact-row');
      const select = el('select');
      for (const [key, meta] of Object.entries(PLATFORMS)) select.append(new Option(meta.label, key));
      select.value = PLATFORMS[contact.platform] ? contact.platform : 'website';
      contact.platform = select.value;
      const value = el('input'); value.type = 'text'; value.maxLength = 200; value.value = contact.value; value.autocomplete = 'off'; value.spellcheck = false;
      const label = el('input', 'contact-label'); label.type = 'text'; label.maxLength = 40; label.value = contact.label; label.placeholder = '显示文字（可选），如 @你的昵称';
      const applyPlatform = () => {
        const meta = PLATFORMS[select.value];
        value.placeholder = meta.placeholder;
        value.inputMode = select.value === 'email' ? 'email' : meta.kind === 'link' ? 'url' : 'text';
        select.setAttribute('aria-label', `第 ${index + 1} 条联系方式的平台`);
        value.setAttribute('aria-label', `第 ${index + 1} 条：${meta.label}${meta.kind === 'link' ? '主页链接' : ''}`);
        label.setAttribute('aria-label', `第 ${index + 1} 条的显示文字（可选）`);
      };
      applyPlatform();
      select.addEventListener('change', () => { contact.platform = select.value; applyPlatform(); markDirty(); });
      value.addEventListener('input', () => { contact.value = value.value; markDirty(); });
      label.addEventListener('input', () => { contact.label = label.value; markDirty(); });
      const actions = el('div', 'page-actions');
      for (const [action, text] of [['up', '前移'], ['down', '后移'], ['remove', '移除']]) {
        const button = el('button', 'text-button', text); button.type = 'button'; button.dataset.action = action; button.dataset.position = index;
        button.setAttribute('aria-label', `${text}第 ${index + 1} 条联系方式`);
        button.addEventListener('click', () => {
          if (isBusy()) return;
          if (action === 'remove') draft.splice(index, 1);
          else { const to = index + (action === 'up' ? -1 : 1); [draft[index], draft[to]] = [draft[to], draft[index]]; }
          dirty = true; render();
        });
        actions.append(button);
      }
      row.append(select, value, label, actions); return row;
    }));
    if (!draft.length) list.append(el('p', 'intro', '还没有联系方式。点击下方「添加联系方式」开始。'));
    updateControls();
    if (focusIndex !== undefined) list.querySelectorAll('.contact-row')[focusIndex]?.querySelector('input')?.focus();
  }
  function load(profile) {
    saved = clone(profile); draft = clone(saved).contacts;
    form.elements.intro.value = saved.intro; dirty = false; render();
  }
  form.elements.intro.addEventListener('input', () => { markDirty(); updateCounts(); });
  $('addContact').addEventListener('click', () => {
    if (isBusy()) return;
    if (draft.length >= MAX_CONTACTS) { notify(`联系方式最多 ${MAX_CONTACTS} 条。`, true); return; }
    const used = new Set(draft.map(contact => contact.platform));
    draft.push({ platform: Object.keys(PLATFORMS).find(key => !used.has(key)) || 'website', value: '', label: '' });
    dirty = true; render(draft.length - 1);
  });
  $('resetProfile').addEventListener('click', () => {
    if (isBusy() || (dirty && !window.confirm('要撤销尚未保存的「关于我」修改吗？'))) return;
    load(saved); notify('');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (isBusy()) return;
    if (!api) { notify('管理功能尚未连接。', true); return; }
    let clean;
    try { clean = normalizeProfile({ intro: form.elements.intro.value, contacts: draft }); }
    catch (error) { notify(error.message, true); return; }
    setBusy(true); notify('正在保存「关于我」…');
    try {
      const row = await api.saveProfile(clean);
      load(row); onSaved(row); notify('「关于我」已保存，首页已同步更新。');
    } catch (error) { notify(error.message, true); onAuthLost(); }
    finally { setBusy(false); }
  });
  return { load, updateControls, isDirty: () => dirty, discard: () => load(saved) };
}

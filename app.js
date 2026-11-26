import { backendConfig } from './config.js';
import { PortfolioAPI } from './backend-client.js?v=20261126';
import { prepareImage, formatSize } from './image-processing.js?v=20261126';
const $ = id => document.getElementById(id);
const api = backendConfig.url && backendConfig.publicKey ? new PortfolioAPI(backendConfig) : null;
const defaults = ['节目单','海报','概念设计','PPT','摄影'];
const fallback = [
  ['十佳歌手节目单 2026','节目单','singer-contest-program-2026.jpg'],
  ['烟雨杭州扑克概念','概念设计','misty-hangzhou-poker.jpg'],
  ['生日抽奖券','海报','birthday-raffle-ticket.jpg'],
  ['院徽重绘','概念设计','college-emblem-redraw.jpg'],
  ['信息华章 PPT','PPT','information-huazhang-ppt.jpg'],
  ['摄影作品','摄影','photography.jpg']
].map(([title,category,file], i) => ({ id:`fallback-${i}`, title, category, description:'', static_image:`images/${file}` }));
let projects = fallback, archived = [], online = false, selectedCategory = '', busy = false, preparedFile = null, previewURL = null, dirty = false, editingId = ''; 
const form = $('workForm'), login = $('loginForm'), admin = $('adminDialog');
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function notify(text, error = false) { $('adminStatus').textContent = text; $('adminStatus').classList.toggle('error', error); }
function setBusy(value) {
  busy = value;
  admin.querySelectorAll('input,textarea,select,button').forEach(node => { node.disabled = value; });
  $('deleteDialog').querySelectorAll('button').forEach(node => { node.disabled = value; });
}
function imageURL(project) {
  const value = api ? api.imageURL(project) : project.static_image;
  if (!value) return null;
  if (/^images\/[a-zA-Z0-9._-]+$/.test(value)) return value;
  if (api && value.startsWith(api.url + '/storage/v1/object/public/portfolio/')) return value;
  return null;
}
function openImage(project, src) {
  $('lightboxImage').src = src; $('lightboxImage').alt = project.title;
  $('lightboxTitle').textContent = project.title; $('lightboxCategory').textContent = project.category;
  $('originalLink').href = src; $('lightbox').showModal();
}
function placeholder(project, unavailable = false) {
  const node = el('div','placeholder'); node.append(el('strong','',project.title),el('span','',unavailable ? '图片暂时无法加载' : '图片待补充')); return node;
}
function renderGallery() {
  const search = $('search').value.trim().toLocaleLowerCase();
  const visible = projects.filter(p => (!selectedCategory || p.category === selectedCategory) && `${p.title} ${p.category} ${p.description || ''}`.toLocaleLowerCase().includes(search));
  $('count').textContent = `${visible.length.toString().padStart(2,'0')} / ${projects.length.toString().padStart(2,'0')} 件作品`;
  const cards = visible.map(project => {
    const card = el('article','card');
    const src = imageURL(project);
    if (src) {
      const button = el('button','artwork'); button.setAttribute('aria-label', `查看大图：${project.title}`);
      const img = new Image(); img.alt = project.title; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = () => button.replaceWith(placeholder(project, Boolean(project.image_path)));
      img.src = src; button.append(img, el('span','view-label','查看作品')); button.addEventListener('click', () => openImage(project, src)); card.append(button);
    } else card.append(placeholder(project));
    const info = el('div','card-info'), meta = el('div','card-meta'); meta.append(el('span','',project.category));
    if (api?.session && online) {
      const edit = el('button','edit-button','编辑作品');
      edit.addEventListener('click', () => { if (busy || !allowDiscard()) return; selectProject(project.id); showStudioTab(false); openAdmin(); }); meta.append(edit);
    }
    info.append(meta,el('h3','',project.title)); if (project.description) info.append(el('p','',project.description)); card.append(info); return card;
  });
  if (!cards.length) { const empty = el('div','empty'); empty.append(el('strong','',projects.length ? '暂时没有匹配的作品' : '新的创作，即将到来'),el('span','',projects.length ? '试试其他分类或搜索词。' : '这里将收录接下来的作品。')); cards.push(empty); }
  $('grid').replaceChildren(...cards);
}
function renderFilters() {
  const categories = [...new Set(projects.map(p => p.category))];
  if (!categories.includes(selectedCategory)) selectedCategory = '';
  $('filters').replaceChildren(...['', ...categories].map(category => {
    const button = el('button','filter',category || '全部'); button.dataset.category = category; button.setAttribute('aria-pressed',String(category === selectedCategory));
    button.addEventListener('click', () => { selectedCategory = category; renderFilters(); renderGallery(); }); return button;
  }));
  $('categoryOptions').replaceChildren(...[...new Set([...categories, ...defaults])].map(c => new Option(c,c)));
}
function renderPicker() {
  const selected = form.elements.project.value;
  form.elements.project.replaceChildren(new Option('新增作品',''), ...projects.map(p => new Option(p.title,p.id)));
  if (projects.some(p => p.id === selected)) form.elements.project.value = selected;
}
async function refreshProjects() {
  if (!api) throw new Error('尚未连接后端');
  projects = await api.list(); online = true;
  $('backendStatus').textContent = ''; renderFilters(); renderGallery(); renderPicker();
}
function clearPreview() {
  if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; preparedFile = null;
  $('preview').hidden = true; $('preview').removeAttribute('src'); $('fileInfo').textContent = '';
}
function selectProject(id = '') {
  clearPreview(); form.reset(); form.elements.project.value = id; editingId = id;
  const p = projects.find(item => item.id === id);
  form.elements.title.value = p?.title || ''; form.elements.category.value = p?.category || ''; form.elements.description.value = p?.description || '';
  $('deleteButton').hidden = !p; $('publishButton').textContent = p ? '保存修改' : '发布作品';
  const src = p && imageURL(p); if (src) { $('preview').src = src; $('preview').hidden = false; }
  dirty = false;
}
function allowDiscard() { return !dirty || window.confirm('当前修改尚未保存，要放弃这些修改吗？'); }
function openAdmin() { if (!admin.open) admin.showModal(); if (!api) notify('管理功能尚未连接。',true); }
function showStudioTab(trash) {
  $('workForm').hidden = trash; $('trashPanel').hidden = !trash;
  $('editTab').setAttribute('aria-pressed', String(!trash)); $('trashTab').setAttribute('aria-pressed', String(trash));
}
function requireLoginIfExpired() {
  if (api?.session) return;
  $('studio').hidden = true; login.hidden = false; renderGallery();
}
for (const button of document.querySelectorAll('[data-open-admin]')) button.addEventListener('click',openAdmin);
$('adminClose').addEventListener('click', () => { if (!busy && allowDiscard()) { selectProject(); admin.close(); } });
admin.addEventListener('cancel', event => { if (busy || !allowDiscard()) event.preventDefault(); else selectProject(); });
$('lightboxClose').addEventListener('click', () => $('lightbox').close());
$('lightbox').addEventListener('close', () => $('lightboxImage').removeAttribute('src'));
$('search').addEventListener('input',renderGallery);
form.addEventListener('input', event => { if (event.target !== form.elements.project) dirty = true; });
form.elements.project.addEventListener('change', () => {
  if (!allowDiscard()) { form.elements.project.value = editingId; return; }
  selectProject(form.elements.project.value); notify('');
});
$('resetButton').addEventListener('click', () => { if (allowDiscard()) { selectProject(); notify(''); } });
$('preview').addEventListener('error', () => { $('preview').hidden = true; });
form.elements.image.addEventListener('change', async () => {
  const file = form.elements.image.files[0]; clearPreview(); if (!file) return;
  setBusy(true); notify('');
  try {
    const result = await prepareImage(file, message => { $('fileInfo').textContent = message; });
    preparedFile = result.file; previewURL = URL.createObjectURL(result.file); $('preview').src = previewURL; $('preview').hidden = false;
    $('fileInfo').textContent = result.compressed ? `${formatSize(result.originalBytes)} → ${formatSize(result.file.size)} · ${result.width} × ${result.height} 像素，已优化` : `${formatSize(result.file.size)} · 已适合展示，保留原图`;
  } catch (error) { form.elements.image.value = ''; $('fileInfo').textContent = ''; notify(error.message,true); }
  finally { setBusy(false); }
});
login.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !api) return;
  setBusy(true); notify('正在登录…');
  try {
    await api.login(login.elements.email.value.trim(),login.elements.password.value);
    await refreshProjects(); login.reset(); login.hidden = true; $('studio').hidden = false; showStudioTab(false); selectProject(); notify(api.needsSchemaUpgrade ? '已登录。请先执行数据库升级脚本，再使用自定义分类和回收站；现有作品仍可编辑。' : '已登录，可以发布作品。');
  } catch (error) { notify(error.message,true); }
  finally { setBusy(false); }
});
$('logoutButton').addEventListener('click', async () => {
  if (busy || !allowDiscard()) return; setBusy(true);
  try { await api.logout(); notify('已退出登录。'); }
  catch { notify('本机已退出；服务器会话撤销未确认。',true); }
  finally { selectProject(); $('studio').hidden = true; login.hidden = false; archived = []; $('trashList').replaceChildren(); renderGallery(); setBusy(false); }
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !api) return;
  if (!form.elements.project.value && !preparedFile) { notify('请先选择作品图片。',true); return; }
  const values = { id:form.elements.project.value, title:form.elements.title.value, category:form.elements.category.value, description:form.elements.description.value, file:preparedFile };
  setBusy(true); notify('正在发布，请勿关闭页面…'); let saved = false;
  try {
    await api.save(values); saved = true; dirty = false; selectProject(); await refreshProjects(); notify('已保存，访客刷新页面即可看到作品。');
  } catch (error) { notify(saved ? '作品已保存，但列表刷新失败。请刷新页面，不要重复发布。' : error.message,true); requireLoginIfExpired(); }
  finally { setBusy(false); }
});
$('deleteButton').addEventListener('click', () => {
  const project = projects.find(p => p.id === form.elements.project.value); if (busy || !project) return;
  $('deleteDescription').textContent = `即将删除「${project.title}」。未保存的编辑将被丢弃。`; $('deleteDialog').showModal();
});
$('deleteDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('cancelDelete').addEventListener('click', () => $('deleteDialog').close());
$('confirmDelete').addEventListener('click', async () => {
  if (busy) return; setBusy(true); notify('正在移入回收站…'); let saved = false;
  try {
    await api.setArchived(form.elements.project.value,true); saved = true; selectProject(); await refreshProjects(); notify('作品已移入回收站，可以随时恢复。');
  } catch (error) { notify(saved ? '作品已删除，但列表刷新失败，请刷新页面。' : error.message,true); requireLoginIfExpired(); }
  finally { setBusy(false); $('deleteDialog').close(); }
});
async function loadTrash() {
  if (busy) return; setBusy(true); notify('正在加载回收站…');
  try {
    archived = await api.list(true); renderTrash(); notify('');
  } catch (error) { $('trashList').replaceChildren(); notify(error.message,true); requireLoginIfExpired(); }
  finally { setBusy(false); }
}
function renderTrash() {
  $('trashList').replaceChildren(...archived.map(p => {
    const row = el('div','trash-item'), info = el('div'); info.append(el('p','',p.title),el('small','',p.category));
    const restore = el('button','button secondary','恢复'); restore.setAttribute('aria-label',`恢复 ${p.title}`);
    restore.addEventListener('click', async () => {
      if (busy) return; setBusy(true); let saved = false; notify('正在恢复…');
      try { await api.setArchived(p.id,false); saved = true; archived = archived.filter(item => item.id !== p.id); renderTrash(); await refreshProjects(); notify('作品已恢复到首页。'); }
      catch (error) { notify(saved ? '已恢复，列表刷新失败，请刷新页面。' : error.message,true); requireLoginIfExpired(); }
      finally { setBusy(false); }
    }); row.append(info,restore); return row;
  }));
  if (!archived.length) $('trashList').append(el('p','intro','回收站为空。'));
}
$('trashTab').addEventListener('click', () => { showStudioTab(true); loadTrash(); });
$('editTab').addEventListener('click', () => { showStudioTab(false); notify(''); });
$('retryTrash').addEventListener('click',loadTrash);
window.addEventListener('beforeunload', event => { if (busy || dirty) { event.preventDefault(); event.returnValue = ''; } });
renderFilters(); renderGallery();
if (api) {
  $('backendStatus').textContent = '正在加载作品…';
  refreshProjects().catch(error => { online = false; $('backendStatus').textContent = `在线作品暂时无法加载，当前为静态展示。${error.message}`; });
}

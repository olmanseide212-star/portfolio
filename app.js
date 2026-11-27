import { backendConfig } from './config.js';
import { PortfolioAPI } from './backend-client.js?v=20261127-cinema';
import { prepareImage, formatSize } from './image-processing.js?v=20261126';
import { MAX_PAGES, projectPages, pageURL, movePage, isMissingPlaceholder, countEffectivePages, mergeAddedPages } from './album.js?v=20261127-cinema';
import { initMotion, playIntro, initHeroAtmosphere, initCursor, enableMagnetic, initScrollChoreography, reveal, enableTilt, transition } from './motion.js?v=20261127-cinema';
import { renderAbout, createProfileEditor } from './about.js?v=20261127-cinema';
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
let projects = fallback, archived = [], online = false, selectedCategory = '', busy = false, draftPages = [], viewingProject = null, viewingPage = 0, dirty = false, editingId = '';
let profile = null, profileEditor = null, pageToken = 0;
const form = $('workForm'), login = $('loginForm'), admin = $('adminDialog');
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function notify(text, error = false) { $('adminStatus').textContent = text; $('adminStatus').classList.toggle('error', error); }
function setBusy(value) {
  busy = value;
  admin.querySelectorAll('input,textarea,select,button').forEach(node => { node.disabled = value; });
  $('deleteDialog').querySelectorAll('button').forEach(node => { node.disabled = value; });
  if (!value) { updatePageControls(); profileEditor?.updateControls(); }
}
function imageURL(project) { return pageURL(projectPages(project)[0] || {}, api?.url); }
function openImage(project, index = 0) {
  viewingProject = project; viewingPage = index;
  $('lightboxTitle').textContent = project.title;
  $('lightboxCategory').textContent = project.category;
  $('pageThumbnails').replaceChildren(...projectPages(project).map((page, i) => {
    const button = el('button','page-thumbnail'); button.type = 'button';
    button.setAttribute('aria-label', `查看第 ${i+1} 页${page.caption ? '：'+page.caption : ''}`);
    const src = pageURL(page, api?.url);
    if (src) { const img = new Image(); img.src = src; img.alt = ''; img.loading = 'lazy'; img.onerror = () => img.remove(); button.append(img); }
    button.append(el('span','',String(i+1))); button.addEventListener('click', () => { const dir = i > viewingPage ? 1 : i < viewingPage ? -1 : 0; viewingPage = i; renderPage(dir); }); return button;
  }));
  renderPage(0); $('lightbox').showModal();
}
function renderPage(direction = 0) {
  const token = ++pageToken;
  const pages = projectPages(viewingProject), page = pages[viewingPage], src = pageURL(page,api?.url);
  const image = new Image(); image.id = 'lightboxImage';
  image.className = direction > 0 ? 'slide-from-right' : direction < 0 ? 'slide-from-left' : 'page-enter';
  image.alt = `${viewingProject.title} · ${page.caption || '第 '+(viewingPage+1)+' 页'}`;
  // Keep the previous page on screen (dimmed and slightly shifted) until the next one loads.
  const show = message => { if (token !== pageToken) return; $('lightboxImage').replaceWith(image); $('pageLoadStatus').textContent = message; };
  $('pageLoadStatus').textContent = '';
  if (src) {
    $('lightboxImage').classList.add(direction > 0 ? 'is-stale-next' : direction < 0 ? 'is-stale-prev' : 'is-stale');
    image.onload = () => show('');
    image.onerror = () => { image.hidden = true; show('这张图片暂时无法加载，可以切换其他页面。'); };
    image.src = src;
  } else { image.hidden = true; show('图片待补充'); }
  $('originalLink').hidden = !src; if (src) $('originalLink').href = src; else $('originalLink').removeAttribute('href');
  $('pageCounter').textContent = `${viewingPage+1} / ${pages.length}`;
  $('pageCaption').textContent = page.caption || `第 ${viewingPage+1} 页`;
  $('previousPage').disabled = viewingPage === 0; $('nextPage').disabled = viewingPage === pages.length-1;
  $('pageThumbnails').hidden = pages.length < 2;
  $('pageThumbnails').querySelectorAll('button').forEach((button, index) => { button.setAttribute('aria-current',String(index === viewingPage)); });
}
function stepPage(direction) {
  if (!viewingProject) return;
  const next = viewingPage + direction;
  if (next < 0 || next >= projectPages(viewingProject).length) return;
  viewingPage = next; renderPage(direction);
}
function placeholder(project, unavailable = false) {
  const node = el('div','placeholder'); node.append(el('strong','',project.title),el('span','',unavailable ? '图片暂时无法加载' : '图片待补充')); return node;
}
function renderGallery({ immediate = true } = {}) {
  const search = $('search').value.trim().toLocaleLowerCase();
  const visible = projects.filter(p => (!selectedCategory || p.category === selectedCategory) && `${p.title} ${p.category} ${p.description || ''}`.toLocaleLowerCase().includes(search));
  $('count').textContent = `${visible.length.toString().padStart(2,'0')} / ${projects.length.toString().padStart(2,'0')} 件作品`;
  const cards = visible.map(project => {
    const card = el('article','card');
    const pages = projectPages(project);
    const src = imageURL(project);
    if (src) {
      const button = el('button','artwork'); button.setAttribute('aria-label', `打开作品：${project.title}，共 ${pages.length} 页`);
      const img = new Image(); img.alt = project.title; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = () => {
        if (pages.length === 1 && pages[0].static_image && !pages[0].path) button.replaceWith(placeholder(project, false));
        else img.replaceWith(placeholder(project, Boolean(project.image_path || pages[0]?.path)));
      };
      img.src = src; button.append(img, el('span','view-label','查看作品'));
      if (pages.length > 1) button.append(el('span','page-count', `${pages.length} 页`));
      button.addEventListener('click', () => openImage(project)); card.append(button);
    } else card.append(placeholder(project));
    const info = el('div','card-info'), meta = el('div','card-meta'); meta.append(el('span','',project.category));
    if (api?.session && online) {
      const edit = el('button','edit-button','编辑作品');
      edit.addEventListener('click', () => { if (busy || !allowDiscard()) return; selectProject(project.id); showStudioTab('edit'); openAdmin(); }); meta.append(edit);
    }
    info.append(meta,el('h3','',project.title)); if (project.description) info.append(el('p','',project.description)); card.append(info); return card;
  });
  if (!cards.length) { const empty = el('div','empty'); empty.append(el('strong','',projects.length ? '暂时没有匹配的作品' : '新的创作，即将到来'),el('span','',projects.length ? '试试其他分类或搜索词。' : '这里将收录接下来的作品。')); cards.push(empty); }
  $('grid').replaceChildren(...cards);
  reveal(cards, { immediate });
}
function renderFilters() {
  const categories = [...new Set(projects.map(p => p.category))];
  if (!categories.includes(selectedCategory)) selectedCategory = '';
  $('filters').replaceChildren(...['', ...categories].map(category => {
    const button = el('button','filter',category || '全部'); button.dataset.category = category; button.setAttribute('aria-pressed',String(category === selectedCategory));
    button.addEventListener('click', () => transition(() => { selectedCategory = category; renderFilters(); renderGallery(); })); return button;
  }));
  $('categoryOptions').replaceChildren(...[...new Set([...categories, ...defaults])].map(c => new Option(c,c)));
}
function renderPicker() {
  const selected = form.elements.project.value;
  form.elements.project.replaceChildren(new Option('新增作品',''), ...projects.map(p => new Option(p.title,p.id)));
  if (projects.some(p => p.id === selected)) form.elements.project.value = selected;
}
async function refreshProjects(immediate = true) {
  if (!api) throw new Error('尚未连接后端');
  projects = await api.list(); online = true;
  $('backendStatus').textContent = ''; renderFilters(); renderGallery({ immediate }); renderPicker();
}
function clearPages() {
  for (const page of draftPages) if (page.previewURL) URL.revokeObjectURL(page.previewURL);
  draftPages = []; $('pageEditor').replaceChildren(); $('fileInfo').textContent = '';
}
function updatePageControls() {
  $('pageEditor').querySelectorAll('button[data-position]').forEach(button => {
    const index = Number(button.dataset.position);
    button.disabled = busy || (button.dataset.action === 'up' && index === 0) || (button.dataset.action === 'down' && index === draftPages.length-1) || (button.dataset.action === 'cover' && index === 0);
  });
}
function pageLabelText(page, index) {
  if (isMissingPlaceholder(page)) return `第 ${index+1} 页 · 空白占位（添加图片将自动替换）`;
  return index === 0 ? '第 1 页 · 封面' : `第 ${index+1} 页`;
}
function updatePageEditorCount() {
  const effective = countEffectivePages(draftPages), placeholders = draftPages.length - effective;
  $('pageEditorCount').textContent = placeholders
    ? `${effective} / ${MAX_PAGES} 页 · 含 ${placeholders} 页空白占位（添加图片将自动替换）`
    : `${draftPages.length} / ${MAX_PAGES} 页 · 第一页为封面`;
}
function probeStaticImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}
async function ensurePlaceholderStatus(pages) {
  await Promise.all(pages.map(async page => {
    if (!page.static_image || page.path || page.file || typeof page.missingPlaceholder === 'boolean') return;
    const src = pageURL(page, api?.url);
    page.missingPlaceholder = src ? !(await probeStaticImage(src)) : true;
  }));
}
function renderEditor(focusIndex) {
  $('pageEditor').replaceChildren(...draftPages.map((page, index) => {
    const row = el('div','page-editor-row');
    const thumbnail = el('div','editor-thumbnail'), src = page.previewURL || pageURL(page, api?.url);
    const details = el('div','page-details'), label = el('label','page-name');
    const labelText = el('span','', pageLabelText(page, index));
    const markStaticPlaceholder = missing => {
      if (!page.static_image || page.path || page.file) return;
      page.missingPlaceholder = missing;
      labelText.textContent = pageLabelText(page, index);
      updatePageEditorCount();
    };
    if (src) {
      const img = new Image(); img.src = src; img.alt = page.caption || `第 ${index+1} 页`;
      img.onload = () => { markStaticPlaceholder(false); };
      img.onerror = () => { markStaticPlaceholder(true); thumbnail.replaceChildren(el('span','','图片待补充')); };
      thumbnail.append(img);
    } else {
      markStaticPlaceholder(true);
      thumbnail.append(el('span','','图片待补充'));
    }
    label.append(labelText);
    const caption = el('input'); caption.type = 'text'; caption.maxLength = 80; caption.value = page.caption || ''; caption.placeholder = '页面名称，如：正面、背面';
    caption.addEventListener('input', () => { page.caption = caption.value; dirty = true; }); label.append(caption); details.append(label);
    if (page.info) details.append(el('small','page-file-info',page.info));
    const actions = el('div','page-actions');
    for (const [action, text] of [['cover','设为封面'],['up','前移'],['down','后移'],['remove','移除']]) {
      const button = el('button','text-button',text); button.type = 'button'; button.dataset.action = action; button.dataset.position = index;
      button.setAttribute('aria-label', `${text}第 ${index+1} 页`);
      button.addEventListener('click', () => {
        if (busy) return;
        if (action === 'remove') { if (page.previewURL) URL.revokeObjectURL(page.previewURL); draftPages.splice(index,1); }
        else draftPages = movePage(draftPages,index,action === 'cover' ? 0 : index+(action === 'up' ? -1 : 1));
        dirty = true; renderEditor(Math.max(0, Math.min(index,draftPages.length-1)));
      }); actions.append(button);
    }
    details.append(actions); row.append(thumbnail, details); return row;
  }));
  updatePageEditorCount();
  if (!draftPages.length) $('pageEditor').append(el('p','intro','还没有页面。选择图片，一次添加正面、背面或更多内页。'));
  updatePageControls();
  if (focusIndex !== undefined) $('pageEditor').querySelectorAll('input')[focusIndex]?.focus();
}
function selectProject(id = '') {
  clearPages(); form.reset(); form.elements.project.value = id; editingId = id;
  const p = projects.find(item => item.id === id);
  form.elements.title.value = p?.title || ''; form.elements.category.value = p?.category || ''; form.elements.description.value = p?.description || '';
  $('deleteButton').hidden = !p; $('publishButton').textContent = p ? '保存修改' : '发布作品';
  draftPages = p ? projectPages(p) : []; renderEditor();
  dirty = false;
}
function allowDiscard() { return !dirty || window.confirm('当前修改尚未保存，要放弃这些修改吗？'); }
function allowDiscardAll() { return !(dirty || profileEditor?.isDirty()) || window.confirm('当前修改尚未保存，要放弃这些修改吗？'); }
function discardAll() { selectProject(); profileEditor?.discard(); }
function openAdmin() { if (!admin.open) admin.showModal(); if (!api) notify('管理功能尚未连接。',true); }
function showStudioTab(tab = 'edit') {
  $('workForm').hidden = tab !== 'edit'; $('profileForm').hidden = tab !== 'profile'; $('trashPanel').hidden = tab !== 'trash';
  $('editTab').setAttribute('aria-pressed', String(tab === 'edit'));
  $('profileTab').setAttribute('aria-pressed', String(tab === 'profile'));
  $('trashTab').setAttribute('aria-pressed', String(tab === 'trash'));
}
function requireLoginIfExpired() {
  if (api?.session) return;
  $('studio').hidden = true; login.hidden = false; renderGallery();
}
for (const button of document.querySelectorAll('[data-open-admin]')) button.addEventListener('click',openAdmin);
$('adminClose').addEventListener('click', () => { if (!busy && allowDiscardAll()) { discardAll(); admin.close(); } });
admin.addEventListener('cancel', event => { if (busy || !allowDiscardAll()) event.preventDefault(); else discardAll(); });
$('lightboxClose').addEventListener('click', () => $('lightbox').close());
$('lightbox').addEventListener('close', () => {
  pageToken++;
  const image = $('lightboxImage'); image.removeAttribute('src'); image.alt = ''; image.classList.remove('is-stale', 'is-stale-next', 'is-stale-prev');
  $('pageThumbnails').replaceChildren(); viewingProject = null;
});
$('previousPage').addEventListener('click', () => stepPage(-1));
$('nextPage').addEventListener('click', () => stepPage(1));
$('lightbox').addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); stepPage(event.key === 'ArrowLeft' ? -1 : 1); }
});
let touchStart;
$('pageStage').addEventListener('touchstart', event => { touchStart = event.touches.length === 1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY} : null; }, {passive:true});
$('pageStage').addEventListener('touchend', event => {
  if (!touchStart || event.changedTouches.length !== 1) return;
  const x = event.changedTouches[0].clientX-touchStart.x, y = event.changedTouches[0].clientY-touchStart.y;
  touchStart = null; if (Math.abs(x)>60 && Math.abs(x)>Math.abs(y)*1.5) stepPage(x<0 ? 1 : -1);
}, {passive:true});
$('search').addEventListener('input', () => renderGallery());
form.addEventListener('input', event => { if (event.target !== form.elements.project) dirty = true; });
form.elements.project.addEventListener('change', () => {
  if (!allowDiscard()) { form.elements.project.value = editingId; return; }
  selectProject(form.elements.project.value); notify('');
});
$('resetButton').addEventListener('click', () => { if (allowDiscard()) { selectProject(); notify(''); } });
form.elements.image.addEventListener('change', async () => {
  const files = Array.from(form.elements.image.files); form.elements.image.value = ''; if (!files.length || busy) return;
  setBusy(true); notify(''); const added = [];
  try {
    await ensurePlaceholderStatus(draftPages);
    const effectiveCount = countEffectivePages(draftPages);
    if (effectiveCount + files.length > MAX_PAGES) { notify(`每件作品最多 ${MAX_PAGES} 页，目前还能添加 ${MAX_PAGES - effectiveCount} 页。`,true); return; }
    for (const [index,file] of files.entries()) {
      const result = await prepareImage(file, message => { $('fileInfo').textContent = `处理第 ${index+1} / ${files.length} 张：${message}`; });
      added.push({file:result.file,caption:'',previewURL:URL.createObjectURL(result.file),info:`${file.name} · ${formatSize(result.originalBytes)} → ${formatSize(result.file.size)} · ${result.width} × ${result.height}`});
    }
    const merged = mergeAddedPages(draftPages, added);
    draftPages = merged.pages; dirty = true; renderEditor();
    $('fileInfo').textContent = merged.replacedCount
      ? `已替换空白占位页并添加 ${added.length} 页，保存后生效。可以继续选择图片。`
      : `已添加 ${added.length} 页，保存后生效。可以继续选择图片。`;
  } catch (error) {
    for (const page of added) URL.revokeObjectURL(page.previewURL);
    $('fileInfo').textContent = ''; notify(`本批图片未添加：${error.message}。已有页面已保留。`,true);
  } finally { setBusy(false); }
});
login.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !api) return;
  setBusy(true); notify('正在登录…');
  try {
    await api.login(login.elements.email.value.trim(),login.elements.password.value);
    await refreshProjects(); await loadProfile(); login.reset(); login.hidden = true; $('studio').hidden = false; showStudioTab('edit'); selectProject(); notify(api.needsSchemaUpgrade ? '已登录。请先执行数据库升级脚本，再使用自定义分类和回收站；现有作品仍可编辑。' : api.needsAlbumUpgrade ? '已登录。保存多页作品前，请先执行多页作品升级脚本。' : '已登录，可以添加多页作品。');
  } catch (error) { notify(error.message,true); }
  finally { setBusy(false); }
});
$('logoutButton').addEventListener('click', async () => {
  if (busy || !allowDiscardAll()) return; setBusy(true);
  try { await api.logout(); notify('已退出登录。'); }
  catch { notify('本机已退出；服务器会话撤销未确认。',true); }
  finally { discardAll(); showStudioTab('edit'); $('studio').hidden = true; login.hidden = false; archived = []; $('trashList').replaceChildren(); renderGallery(); setBusy(false); }
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !api) return;
  if (!form.elements.project.value && !draftPages.length) { notify('请先选择作品图片。',true); return; }
  const values = { id:form.elements.project.value, title:form.elements.title.value, category:form.elements.category.value, description:form.elements.description.value, pages:draftPages.map(({file,path,static_image,caption}) => ({...(file ? {file} : path ? {path} : {static_image}),caption})), onProgress:message => notify(message) };
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
$('trashTab').addEventListener('click', () => { showStudioTab('trash'); loadTrash(); });
$('editTab').addEventListener('click', () => { showStudioTab('edit'); notify(''); });
$('profileTab').addEventListener('click', () => { showStudioTab('profile'); notify(''); });
$('retryTrash').addEventListener('click',loadTrash);
$('replayIntro')?.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'instant' }); playIntro({ force: true }); });
window.addEventListener('beforeunload', event => { if (busy || dirty || profileEditor?.isDirty()) { event.preventDefault(); event.returnValue = ''; } });
async function loadProfile() {
  if (!api) { renderAbout(null, reveal); return; }
  try { profile = await api.getProfile(); } catch { profile = null; }
  renderAbout(profile, reveal);
  $('profileNotice').hidden = !api.needsProfileUpgrade;
  if (!profileEditor.isDirty()) profileEditor.load(profile);
}
profileEditor = createProfileEditor({
  api, notify, setBusy, isBusy: () => busy, onAuthLost: requireLoginIfExpired,
  onSaved: row => { profile = row; renderAbout(profile, nodes => reveal(nodes, { immediate:true })); $('profileNotice').hidden = true; }
});
initMotion(); playIntro(); initHeroAtmosphere($('top'), $('heroCanvas')); initCursor(); enableMagnetic(document.body); initScrollChoreography(); enableTilt($('grid'));
renderFilters(); renderGallery({ immediate:false });
loadProfile();
if (api) {
  $('backendStatus').textContent = '正在加载作品…';
  refreshProjects(false).catch(error => { online = false; $('backendStatus').textContent = `在线作品暂时无法加载，当前为静态展示。${error.message}`; });
}

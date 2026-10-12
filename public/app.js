// Front-end do voltrama-pass. Vanilla JS, sem dependências.
// Dados do usuário são sempre inseridos com textContent (nunca innerHTML).

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
};

// ---------- Token de sessão ----------
const TOKEN_KEY = 'vp-token';
let token = '';
{
  const m = location.hash.match(/t=([\w-]+)/);
  if (m) {
    token = m[1];
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
    history.replaceState(null, '', location.pathname);
  } else {
    try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch {}
  }
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Voltrama-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 423) { showScreen('unlock'); throw new Error(data.error || 'Cofre bloqueado.'); }
  if (!res.ok) { const e = new Error(data.error || `Erro ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// ---------- Estado ----------
const state = { status: null, items: [], filter: 'all', folder: null, query: '', selectedId: null, current: null, editing: null };

function showScreen(name) {
  for (const s of ['nosession', 'setup', 'unlock', 'vault']) $(`#screen-${s}`).hidden = s !== name;
  if (name === 'unlock') { $('#unlock-pass').value = ''; setTimeout(() => $('#unlock-pass').focus(), 0); }
  if (name === 'setup') setTimeout(() => $('#setup-pass').focus(), 0);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

let clipTimer;
async function copy(text, label = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} — some da área de transferência em 30 s`);
    clearTimeout(clipTimer);
    clipTimer = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30_000);
  } catch {
    toast('Não foi possível copiar');
  }
}

// Força aproximada de uma senha digitada (heurística simples, só para o medidor).
function strength(pw) {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 30;
  const unique = new Set(pw).size;
  return Math.round(Math.min(pw.length, unique * 1.5) * Math.log2(Math.max(pool, 2)));
}
function paintMeter(span, pw) {
  const bits = strength(pw);
  const pct = Math.min(100, (bits / 100) * 100);
  span.style.width = `${pct}%`;
  span.style.background = bits < 40 ? 'var(--danger)' : bits < 70 ? '#f2b33d' : 'var(--accent)';
}

// ---------- Boot ----------
async function boot() {
  if (!token) return showScreen('nosession');
  try {
    state.status = await api('GET', '/api/status');
  } catch (err) {
    if (err.status === 401) return showScreen('nosession');
    throw err;
  }
  if (!state.status.exists) return showScreen('setup');
  if (!state.status.unlocked) {
    $('#unlock-path').textContent = state.status.vaultPath;
    return showScreen('unlock');
  }
  await enterVault();
}

async function enterVault() {
  showScreen('vault');
  await refresh();
}

async function refresh() {
  state.items = await api('GET', '/api/items');
  renderSidebar();
  renderList();
}

// ---------- Setup / Unlock ----------
$('#setup-pass').addEventListener('input', (e) => paintMeter($('#setup-meter'), e.target.value));
$('#form-setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('#setup-pass').value;
  const p2 = $('#setup-pass2').value;
  const err = $('#setup-error');
  if (p1 !== p2) return (err.textContent = 'As senhas não conferem.');
  if (p1.length < 8) return (err.textContent = 'Use pelo menos 8 caracteres (recomendado: 14+).');
  const btn = e.submitter;
  btn.disabled = true;
  btn.textContent = 'Criando…';
  try {
    await api('POST', '/api/setup', { password: p1 });
    $('#form-setup').reset();
    await enterVault();
    toast('Cofre criado');
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar cofre';
  }
});

$('#form-unlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#unlock-btn');
  const err = $('#unlock-error');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Desbloqueando…';
  try {
    await api('POST', '/api/unlock', { password: $('#unlock-pass').value });
    $('#unlock-pass').value = '';
    await enterVault();
  } catch (ex) {
    err.textContent = ex.message;
    $('#unlock-pass').select();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Desbloquear';
  }
});

$('#btn-lock').addEventListener('click', async () => {
  await api('POST', '/api/lock');
  state.items = [];
  state.selectedId = null;
  state.current = null;
  showDetail(null);
  $('#unlock-path').textContent = state.status?.vaultPath || '';
  showScreen('unlock');
});

// ---------- Sidebar ----------
function folders() {
  return [...new Set(state.items.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function renderSidebar() {
  $('#count-all').textContent = state.items.length;
  for (const b of document.querySelectorAll('.filter')) b.classList.toggle('active', !state.folder && b.dataset.filter === state.filter);
  const nav = $('#folders');
  nav.replaceChildren();
  const list = folders();
  if (list.length === 0) nav.append(el('p', { className: 'muted small', textContent: 'Nenhuma pasta' , style: 'margin:4px 10px' }));
  for (const f of list) {
    const n = state.items.filter((i) => i.folder === f).length;
    const btn = el('button', { className: `folder${state.folder === f ? ' active' : ''}` }, el('span', { textContent: f }), el('span', { className: 'count', textContent: n }));
    btn.addEventListener('click', () => { state.folder = f; state.filter = 'all'; renderSidebar(); renderList(); });
    nav.append(btn);
  }
  $('#folder-options').replaceChildren(...list.map((f) => el('option', { value: f })));
}

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('.filter');
  if (!b) return;
  state.filter = b.dataset.filter;
  state.folder = null;
  renderSidebar();
  renderList();
});

// ---------- Lista ----------
function hostOf(uri) {
  try { return new URL(/^[a-z]+:\/\//i.test(uri) ? uri : `https://${uri}`).hostname.replace(/^www\./, ''); } catch { return uri; }
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((i) => {
    if (state.folder && i.folder !== state.folder) return false;
    if (state.filter === 'favorite' && !i.favorite) return false;
    if ((state.filter === 'login' || state.filter === 'note') && i.type !== state.filter) return false;
    if (!q) return true;
    return [i.name, i.username, i.folder, ...i.uris].some((v) => v && v.toLowerCase().includes(q));
  });
}

function renderList() {
  const items = visibleItems();
  const ul = $('#item-list');
  ul.replaceChildren(
    ...items.map((i) => {
      const sub = i.type === 'note' ? 'Nota segura' : i.username || (i.uris[0] ? hostOf(i.uris[0]) : '—');
      const li = el(
        'li',
        { className: `item${i.id === state.selectedId ? ' active' : ''}`, tabIndex: 0 },
        el('div', { className: 'avatar', textContent: i.type === 'note' ? '✎' : (i.name || '?').trim()[0] || '?' }),
        el('div', { className: 'meta' }, el('div', { className: 'name', textContent: i.name }), el('div', { className: 'sub', textContent: sub })),
        i.favorite ? el('span', { className: 'star', textContent: '★', title: 'Favorito' }) : null
      );
      li.addEventListener('click', () => select(i.id));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(i.id); });
      return li;
    })
  );
  $('#empty-list').hidden = items.length > 0;
}

$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });

// ---------- Detalhe ----------
function showDetail(mode) {
  $('#detail-empty').hidden = mode !== null;
  $('#detail-view').hidden = mode !== 'view';
  $('#detail-edit').hidden = mode !== 'edit';
  $('#screen-vault').classList.toggle('show-detail', mode !== null);
}

async function select(id) {
  state.selectedId = id;
  renderList();
  state.current = await api('GET', `/api/items/${encodeURIComponent(id)}`);
  renderView();
}

function fieldRow(label, value, { secret = false, link = false, copyLabel } = {}) {
  const dd = el('dd', { className: secret ? 'mono' : '' });
  let shown = !secret;
  const paint = () => {
    dd.replaceChildren();
    if (!shown) dd.textContent = '••••••••••••';
    else if (link) {
      const href = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
      const safe = /^https?:\/\//i.test(href);
      dd.append(safe ? el('a', { href, textContent: value, target: '_blank', rel: 'noopener noreferrer' }) : value);
    } else dd.textContent = value;
  };
  paint();
  const actions = [];
  if (secret) {
    const t = el('button', { className: 'btn ghost', type: 'button', textContent: 'Mostrar' });
    t.addEventListener('click', () => { shown = !shown; t.textContent = shown ? 'Ocultar' : 'Mostrar'; paint(); });
    actions.push(t);
  }
  if (copyLabel) {
    const c = el('button', { className: 'btn ghost', type: 'button', textContent: 'Copiar' });
    c.addEventListener('click', () => copy(value, copyLabel));
    actions.push(c);
  }
  return el('div', { className: 'field' }, el('div', { className: 'f-body' }, el('dt', { textContent: label }), dd), ...actions);
}

function renderView() {
  const i = state.current;
  $('#view-avatar').textContent = i.type === 'note' ? '✎' : (i.name.trim()[0] || '?');
  $('#view-name').textContent = (i.favorite ? '★ ' : '') + i.name;
  const updated = new Date(i.updatedAt).toLocaleString('pt-BR');
  $('#view-meta').textContent = `${i.type === 'note' ? 'Nota segura' : 'Login'}${i.folder ? ' · ' + i.folder : ''} · editado em ${updated}`;
  const rows = [];
  if (i.type === 'login') {
    if (i.username) rows.push(fieldRow('Usuário', i.username, { copyLabel: 'Usuário copiado' }));
    if (i.password) rows.push(fieldRow('Senha', i.password, { secret: true, copyLabel: 'Senha copiada' }));
    i.uris.forEach((u, n) => rows.push(fieldRow(i.uris.length > 1 ? `Site ${n + 1}` : 'Site', u, { link: true, copyLabel: 'Site copiado' })));
    if (i.totp) rows.push(fieldRow('Segredo 2FA (TOTP)', i.totp, { secret: true, copyLabel: 'Segredo copiado' }));
  }
  if (i.notes) rows.push(fieldRow('Notas', i.notes, { copyLabel: 'Notas copiadas' }));
  if (rows.length === 0) rows.push(el('div', { className: 'field muted', textContent: 'Item sem campos preenchidos.' }));
  $('#view-fields').replaceChildren(...rows);
  showDetail('view');
}

$('#btn-back').addEventListener('click', () => { state.selectedId = null; renderList(); showDetail(null); });

// ---------- Edição ----------
const form = $('#detail-edit');

function setType(type) {
  form.querySelector(`input[name="type"][value="${type}"]`).checked = true;
  form.querySelector('.login-only').hidden = type !== 'login';
}
form.addEventListener('change', (e) => { if (e.target.name === 'type') setType(e.target.value); });

function openEditor(item) {
  state.editing = item;
  form.reset();
  $('#edit-error').textContent = '';
  $('#edit-title').textContent = item ? 'Editar item' : 'Novo item';
  $('#btn-delete').hidden = !item;
  setType(item?.type || 'login');
  const f = form.elements;
  f.name.value = item?.name || '';
  f.username.value = item?.username || '';
  f.password.value = item?.password || '';
  f.password.type = 'password';
  f.uris.value = (item?.uris || []).join('\n');
  f.folder.value = item?.folder || (state.folder || '');
  f.notes.value = item?.notes || '';
  f.favorite.checked = Boolean(item?.favorite);
  paintMeter($('#edit-meter'), f.password.value);
  showDetail('edit');
  f.name.focus();
}

$('#btn-new').addEventListener('click', () => { state.selectedId = null; renderList(); openEditor(null); });
$('#btn-edit').addEventListener('click', () => openEditor(state.current));
$('#btn-cancel').addEventListener('click', () => (state.current && state.selectedId ? renderView() : showDetail(null)));
$('#edit-toggle').addEventListener('click', () => {
  const p = form.elements.password;
  p.type = p.type === 'password' ? 'text' : 'password';
});
form.elements.password.addEventListener('input', (e) => paintMeter($('#edit-meter'), e.target.value));
$('#edit-generate').addEventListener('click', () => openGenerator((pw) => {
  form.elements.password.value = pw;
  form.elements.password.type = 'text';
  paintMeter($('#edit-meter'), pw);
}));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const payload = {
    type: f.type.value,
    name: f.name.value,
    username: f.username.value,
    password: f.password.value,
    uris: f.uris.value.split('\n').map((s) => s.trim()).filter(Boolean),
    folder: f.folder.value,
    notes: f.notes.value,
    favorite: f.favorite.checked,
  };
  try {
    const saved = state.editing
      ? await api('PUT', `/api/items/${encodeURIComponent(state.editing.id)}`, payload)
      : await api('POST', '/api/items', payload);
    await refresh();
    toast('Salvo');
    await select(saved.id);
  } catch (ex) {
    $('#edit-error').textContent = ex.message;
  }
});

$('#btn-delete').addEventListener('click', async () => {
  if (!state.editing || !confirm(`Excluir "${state.editing.name}"? Isso não pode ser desfeito.`)) return;
  await api('DELETE', `/api/items/${encodeURIComponent(state.editing.id)}`);
  state.selectedId = null;
  state.current = null;
  await refresh();
  showDetail(null);
  toast('Item excluído');
});

// ---------- Gerador ----------
const dlgGen = $('#dlg-generator');
let genCallback = null;

function genOptions() {
  return {
    length: Number($('#gen-length').value),
    upper: $('#gen-upper').checked,
    lower: $('#gen-lower').checked,
    digits: $('#gen-digits').checked,
    symbols: $('#gen-symbols').checked,
    avoidAmbiguous: $('#gen-ambig').checked,
  };
}
async function regen() {
  $('#gen-len-label').textContent = $('#gen-length').value;
  try {
    const r = await api('POST', '/api/generate', genOptions());
    $('#gen-output').textContent = r.password;
    $('#gen-bits').textContent = `≈ ${r.bits} bits de entropia`;
  } catch (ex) {
    $('#gen-output').textContent = '';
    $('#gen-bits').textContent = ex.message;
  }
}
function openGenerator(cb = null) {
  genCallback = cb;
  $('#gen-use').hidden = !cb;
  dlgGen.showModal();
  regen();
}
dlgGen.addEventListener('input', (e) => { if (e.target.matches('input')) regen(); });
$('#gen-regen').addEventListener('click', regen);
$('#gen-copy').addEventListener('click', () => copy($('#gen-output').textContent, 'Senha copiada'));
$('#gen-use').addEventListener('click', () => { genCallback?.($('#gen-output').textContent); dlgGen.close(); });
$('#btn-generator').addEventListener('click', () => openGenerator());

// ---------- Importar / Backup ----------
const dlgTools = $('#dlg-tools');
const toolsMsg = (msg, ok = false) => { const m = $('#tools-msg'); m.textContent = msg; m.classList.toggle('ok', ok); };
$('#btn-tools').addEventListener('click', () => { toolsMsg(''); dlgTools.showModal(); });
$('#btn-tools-close').addEventListener('click', () => dlgTools.close());

$('#file-bitwarden').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  toolsMsg('Importando…', true);
  try {
    const r = await api('POST', '/api/import/bitwarden', { text: await file.text() });
    await refresh();
    toolsMsg(`Importados ${r.added} itens${r.skipped ? `, ${r.skipped} duplicados ignorados` : ''}${r.ignored ? `, ${r.ignored} não suportados` : ''}. Lembre de apagar o arquivo exportado do Bitwarden.`, true);
  } catch (ex) {
    toolsMsg(ex.message);
  } finally {
    e.target.value = '';
  }
});

$('#btn-export').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export/backup', { headers: { 'X-Voltrama-Token': token } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Falha ao exportar.');
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'voltrama-pass-backup.json';
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toolsMsg('Backup baixado. Guarde-o em um lugar seguro (pendrive, outro disco).', true);
  } catch (ex) {
    toolsMsg(ex.message);
  }
});

$('#btn-restore').addEventListener('click', async () => {
  const file = $('#file-backup').files[0];
  if (!file) return toolsMsg('Escolha o arquivo de backup.');
  toolsMsg('Restaurando…', true);
  try {
    const r = await api('POST', '/api/import/backup', { text: await file.text(), password: $('#backup-pass').value });
    $('#backup-pass').value = '';
    $('#file-backup').value = '';
    await refresh();
    toolsMsg(`Restaurados ${r.added} itens${r.skipped ? `, ${r.skipped} já existiam` : ''}.`, true);
  } catch (ex) {
    toolsMsg(ex.message);
  }
});

$('#btn-change-pw').addEventListener('click', async () => {
  const next = $('#pw-next').value;
  if (next.length < 8) return toolsMsg('A nova senha precisa ter pelo menos 8 caracteres.');
  toolsMsg('Trocando senha…', true);
  try {
    await api('POST', '/api/password', { current: $('#pw-current').value, next });
    $('#pw-current').value = '';
    $('#pw-next').value = '';
    toolsMsg('Senha mestra alterada. Backups antigos continuam abrindo com a senha antiga.', true);
  } catch (ex) {
    toolsMsg(ex.message);
  }
});

$('#btn-shutdown').addEventListener('click', async () => {
  if (!confirm('Encerrar o voltrama-pass? O cofre será bloqueado e o servidor local desligado.')) return;
  await api('POST', '/api/shutdown').catch(() => {});
  dlgTools.close();
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  document.body.replaceChildren(el('main', { className: 'screen center' },
    el('div', { className: 'card auth' }, el('h1', { textContent: 'voltrama-pass encerrado' }),
      el('p', { className: 'muted', textContent: 'Pode fechar esta aba. Para abrir de novo, rode npx voltrama-pass.' }))));
});

// Bloqueio automático: o servidor bloqueia; aqui só checamos ao voltar para a aba.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || $('#screen-vault').hidden) return;
  try {
    const s = await api('GET', '/api/status');
    if (!s.unlocked) showScreen('unlock');
  } catch {}
});

boot().catch((err) => toast(err.message));

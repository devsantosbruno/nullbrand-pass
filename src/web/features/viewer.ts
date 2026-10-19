// The detail pane in view mode: one item, field by field. Secrets show as dots and only enter the DOM while revealed.
import { guardVaultItem } from '../api-guards.js';
import { $, el } from '../dom.js';
import { ApiResponseError, api } from '../http.js';
import { IDENTITY_SECTIONS } from '../identity-fields.js';
import { fmtDate, fmtRelativeTime, lc, rich, t } from '../locale.js';
import { SSH_ALGOS, sshConfig, sshFileName, sshKeyPairFiles, sshPubLine, zipParts } from '../ssh-format.js';
import { showDetail } from '../shell.js';
import { currentItem, state } from '../state.js';
import { toast, toastError } from '../toast.js';
import { copy } from '../clipboard.js';
import { downloadBlob } from '../ui/download.js';
import { icon } from '../ui/icons.js';
import type { IconName } from '../ui/icons.js';
import { strengthLevel } from '../ui/strength.js';
import { isHttpUrl, normalizeUrl, siteDomain } from '../ui/url.js';

/** What the viewer needs from the page. */
export interface ViewerDeps {
  renderList(): void;
  refresh(): Promise<void>;
}
/** What the viewer exposes to the page. */
export interface ViewerHandle {
  /** Selects an item in the list and shows it. */
  select(id: string): Promise<void>;
  renderView(): void;
}

const iconBtn = (name: IconName, label: string, className = 'dv-icon-btn'): HTMLButtonElement => {
  const b = el('button', { className, type: 'button' });
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  return b;
};

// `password` rows hide the value until revealed; `site` rows link only http(s) URLs.
interface FieldRowOptions {
  kind?: 'text' | 'password' | 'site';
  meter?: boolean;
  pre?: boolean;
  copyable?: boolean;
}
/** Builds one labeled row of the detail pane. */
function FieldRow(label: string, value: string, { kind = 'text', meter = true, pre = false, copyable = false }: FieldRowOptions = {}): HTMLElement {
  const valueEl = el('div', { className: pre ? 'frow-value pre' : 'frow-value' });
  const body = el('div', { className: 'frow-body' }, el('div', { className: 'frow-label', textContent: label }), valueEl);
  const actions = el('div', { className: 'frow-actions' });
  const row = el('div', { className: 'frow' }, body, actions);

  if (kind === 'password') {
    let shown = false;
    const { level, active } = strengthLevel(value);
    const strengthEl = el('div', { className: `frow-strength ${level === 'strong' ? 'ok' : level === 'medium' ? 'warn' : 'err'}` });
    const segs = el('div', { className: 'frow-segs' });
    for (let n = 0; n < 4; n++) segs.append(el('span', { className: n < active ? 'on' : '' }));
    strengthEl.append(segs, el('span', { className: 'frow-strength-text', textContent: t('strength.line', { level: t(`strength.${level}`), count: [...value].length }) }));
    const toggle = iconBtn('eye', t('password.show'));
    const paint = (): void => {
      valueEl.textContent = shown ? value : '•'.repeat(Math.min(12, Math.max(8, [...value].length)));
      valueEl.classList.toggle('pre', pre && shown);
      valueEl.classList.toggle('dots', !shown);
      toggle.replaceChildren(icon(shown ? 'eye-off' : 'eye'));
      toggle.setAttribute('aria-label', t(shown ? 'password.hide' : 'password.show'));
    };
    toggle.addEventListener('click', () => { shown = !shown; paint(); });
    paint();
    if (meter) body.append(strengthEl);
    actions.append(toggle);
  } else if (kind === 'site') {
    // The only place that turns user text into a link: http(s) only, and never with an opener.
    if (isHttpUrl(value)) {
      const href = normalizeUrl(value);
      valueEl.append(el('a', { href, textContent: siteDomain(value), target: '_blank', rel: 'noopener noreferrer' }));
      const open = el('a', { className: 'dv-icon-btn', href, target: '_blank', rel: 'noopener noreferrer' });
      open.setAttribute('aria-label', t('aria.openSite'));
      open.append(icon('external'));
      actions.append(open);
    } else valueEl.textContent = value;
  } else valueEl.textContent = value;

  if (copyable) {
    const c = iconBtn('copy', t('aria.copy', { label: lc(label) }));
    c.addEventListener('click', () => copy(value, label, { sensitive: kind === 'password' }));
    actions.append(c);
  }
  return row;
}

// Downloads the key pair as one .zip: private (600) and public (644).
function downloadSshKeyPair(key: { name: string; algo: string; privateKey: string; publicKey: string }): void {
  const { base, files } = sshKeyPairFiles(key);
  downloadBlob(new Blob(zipParts(files), { type: 'application/zip' }), `${base}.zip`);
}

function renderView(): void {
  const i = currentItem();
  $('#view-avatar').textContent = (i.name.trim().slice(0, 2) || '?').toLowerCase();
  const viewName = $('#view-name');
  viewName.textContent = i.name;
  viewName.title = i.name;
  const fav = $('#btn-fav');
  fav.setAttribute('aria-pressed', String(Boolean(i.favorite)));
  fav.setAttribute('aria-label', t(i.favorite ? 'fav.remove' : 'fav.add'));
  fav.replaceChildren(icon('star', { filled: Boolean(i.favorite) }));
  $('#view-chips').replaceChildren(
    el('span', { className: 'dv-chip', textContent: t(i.type === 'note' ? 'type.secureNote' : `type.${['card', 'identity', 'ssh'].includes(i.type) ? i.type : 'login'}`) }),
    ...(i.folder ? [el('span', { className: 'dv-chip', textContent: i.folder })] : [])
  );

  const rows: HTMLElement[] = [];
  if (i.type === 'login') {
    if (i.username) rows.push(FieldRow(t('field.usernameShort'), i.username, { copyable: true }));
    if (i.password) rows.push(FieldRow(t('field.password'), i.password, { kind: 'password', copyable: true }));
    i.uris.forEach((u, n) => rows.push(FieldRow(i.uris.length > 1 ? t('field.siteN', { n: n + 1 }) : t('field.site'), u, { kind: 'site', copyable: true })));
    if (i.totp) rows.push(FieldRow(t('field.totp'), i.totp, { kind: 'password', copyable: true }));
  }
  if (i.type === 'card') {
    if (i.cardholder) rows.push(FieldRow(t('field.cardholder'), i.cardholder, { copyable: true }));
    if (i.cardNumber) rows.push(FieldRow(t('field.cardNumber'), i.cardNumber, { kind: 'password', meter: false, copyable: true }));
    if (i.cardExpiry) rows.push(FieldRow(t('field.expiry'), i.cardExpiry, { copyable: true }));
    if (i.cardCvv) rows.push(FieldRow(t('field.cvv'), i.cardCvv, { kind: 'password', meter: false, copyable: true }));
  }
  if (i.type === 'identity') {
    IDENTITY_SECTIONS.forEach((sec) => {
      const secRows = sec.fields.filter((f) => i[f.key]).map((f) => FieldRow(t(f.label), i[f.key], { copyable: true }));
      if (!secRows.length) return;
      if (rows.length) rows.push(el('hr'));
      rows.push(el('div', { className: 'dv-section' }, icon(sec.icon), t(sec.title)), ...secRows);
    });
  }
  const sshDownload = $('#view-ssh-download');
  sshDownload.replaceChildren();
  if (i.type === 'ssh') {
    const keyRows: HTMLElement[] = [];
    if (i.sshAlgo) keyRows.push(FieldRow(t('field.algorithm'), SSH_ALGOS[i.sshAlgo] || i.sshAlgo));
    if (i.sshTitle) keyRows.push(FieldRow(t('ssh.title'), i.sshTitle, { copyable: true }));
    if (i.sshPublicKey) keyRows.push(FieldRow(t('ssh.public'), sshPubLine(i.sshPublicKey, i.sshTitle), { pre: true, copyable: true }));
    if (i.sshFingerprint) keyRows.push(FieldRow(t('ssh.fingerprint'), i.sshFingerprint, { copyable: true }));
    if (i.sshPrivateKey) keyRows.push(FieldRow(t('ssh.private'), i.sshPrivateKey, { kind: 'password', meter: false, pre: true, copyable: true }));
    const connRows: HTMLElement[] = [];
    if (i.sshHost) connRows.push(FieldRow(t('ssh.host'), i.sshHost, { copyable: true }));
    if (i.sshUser) connRows.push(FieldRow(t('ssh.user'), i.sshUser, { copyable: true }));
    if (i.sshPort) connRows.push(FieldRow(t('ssh.port'), i.sshPort, { copyable: true }));
    const cfg = sshConfig(i);
    const sections: readonly (readonly [IconName, string, HTMLElement[]])[] = [
      ['key', t('ssh.sectionKey'), keyRows],
      ['server', t('ssh.sectionConn'), connRows],
      ['file', t('ssh.configPreview'), [FieldRow(t('field.suggestedEntry'), cfg, { pre: true, copyable: true })]],
    ];
    sections.forEach(([ic, title, r]) => {
      if (!r.length) return;
      if (rows.length) rows.push(el('hr'));
      rows.push(el('div', { className: 'dv-section' }, icon(ic), ...rich(title)), ...r);
    });
    if (i.sshPrivateKey) {
      const dl = el('button', { type: 'button', className: 'btn primary' }, icon('download'), t('ssh.download'));
      dl.addEventListener('click', () => {
        downloadSshKeyPair({ name: i.name, algo: i.sshAlgo, privateKey: i.sshPrivateKey, publicKey: i.sshPublicKey && sshPubLine(i.sshPublicKey, i.sshTitle) });
        toast(t('ssh.downloaded'));
      });
      sshDownload.append(dl, el('p', {}, ...rich(t('ssh.afterExtract')), el('br'), el('code', { textContent: `chmod 600 ~/.ssh/${sshFileName(i.name, i.sshAlgo)}` })));
    }
  }
  sshDownload.hidden = !sshDownload.childElementCount;
  const fields = $('#view-fields');
  fields.hidden = rows.length === 0;
  fields.replaceChildren(...rows);

  const notes = $('#view-notes');
  notes.hidden = !i.notes;
  if (i.notes) {
    const cp = iconBtn('copy', t('aria.copy', { label: lc(t('field.notes')) }), 'dv-icon-btn small');
    cp.addEventListener('click', () => copy(i.notes, t('field.notes'), { sensitive: true }));
    notes.replaceChildren(
      el('div', { className: 'dv-notes-head' }, el('span', { className: 'frow-label', textContent: t('field.notes') }), cp),
      el('div', { className: 'dv-notes-body', textContent: i.notes })
    );
  } else notes.replaceChildren();

  const meta: HTMLElement[] = [];
  if (i.createdAt) meta.push(el('span', { textContent: t('meta.created', { date: fmtDate(i.createdAt) }) }));
  if (i.updatedAt) meta.push(el('span', { textContent: t('meta.edited', { when: fmtRelativeTime(i.updatedAt) }), title: fmtDate(i.updatedAt) }));
  $('#view-meta').replaceChildren(...meta);
  showDetail('view');
}

/** Wires the favorite and back buttons and returns the viewer handle. */
export function initViewer({ renderList, refresh }: ViewerDeps): ViewerHandle {
  // If the item comes back invalid nothing is shown from it, and the previous selection and detail stay.
  async function select(id: string): Promise<void> {
    const previousId = state.selectedId;
    state.selectedId = id;
    renderList();
    try {
      state.current = await api('GET /api/items/:id', { guard: guardVaultItem, path: `/api/items/${encodeURIComponent(id)}` });
    } catch (ex) {
      if (!(ex instanceof ApiResponseError)) throw ex;
      state.selectedId = previousId;
      renderList();
      toastError(ex);
      return;
    }
    renderView();
  }

  $('#btn-fav').addEventListener('click', async () => {
    const i = state.current;
    if (!i) return;
    try {
      const saved = await api('PUT /api/items/:id', { guard: guardVaultItem, body: { ...i, favorite: !i.favorite }, path: `/api/items/${encodeURIComponent(i.id)}` });
      await refresh();
      await select(saved.id);
    } catch (ex) { toastError(ex); }
  });

  $('#btn-back').addEventListener('click', () => { state.selectedId = null; renderList(); showDetail(null); });

  return { select, renderView };
}

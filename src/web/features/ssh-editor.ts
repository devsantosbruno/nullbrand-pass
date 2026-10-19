// The SSH key part of the editor: keys are generated or inspected on the server, the key fields are read-only, and the
// ~/.ssh/config entry is previewed as the connection fields are typed.
import { guardSshKeyResponse } from '../api-guards.js';
import { $, $button, $form, $input, $textarea, data, dataOneOf, expectInstance, firstFile, queryAll, textOf } from '../dom.js';
import { api, msgOf } from '../http.js';
import { iconNameOf, icon } from '../ui/icons.js';
import { rich, t } from '../locale.js';
import { sshConfig, sshPubLine } from '../ssh-format.js';
import { state } from '../state.js';
import { toast } from '../toast.js';
import { copy } from '../clipboard.js';
import { confirm } from '../ui/dialog.js';
import { createRevealToggle } from '../ui/reveal-toggle.js';
import type { RevealToggle } from '../ui/reveal-toggle.js';
import type { VaultItem } from '../vault-types.js';

/** The SSH fields of an item as the form holds them. */
export type SshValues = {
  sshAlgo: string;
  sshTitle: string;
  sshPublicKey: string;
  sshFingerprint: string;
  sshPrivateKey: string;
  sshHost: string;
  sshUser: string;
  sshPort: string;
};
/** What the SSH editor exposes to the main editor. */
export interface SshEditorHandle {
  /** The reveal toggle of the private key field. */
  readonly revealToggle: RevealToggle;
  /** Called when the type switches to SSH; a new item gets a key right away. */
  ensureKey(): void;
  /** Called when the editor opens: forgets the previous item's key and the answer to "replace it?". */
  reset(): void;
  /** Fills the key and connection fields from the item (or empties them) and rebuilds the preview. */
  fill(item: VaultItem | null): void;
  hasKey(): boolean;
  hasPrivateKey(): boolean;
  /** Asks for confirmation to save a key pair whose private key is missing (only a .pub was imported). */
  confirmPubOnly(): Promise<boolean>;
  values(): SshValues;
  /** Rewrites the language-dependent section titles. */
  repaint(): void;
}

interface SshKeyInput {
  algo: string;
  publicKey: string;
  fingerprint: string;
  privateKey: string;
  comment?: string | undefined;
}

/** Wires the SSH key section of the edit form and returns its handle. */
export function initSshEditor(): SshEditorHandle {
  const form = $form('#detail-edit');
  const fieldInput = (name: string): HTMLInputElement => expectInstance(form.elements.namedItem(name), HTMLInputElement, `form field ${name}`);
  const fieldTextarea = (name: string): HTMLTextAreaElement => expectInstance(form.elements.namedItem(name), HTMLTextAreaElement, `form field ${name}`);
  const fieldRadios = (name: string): RadioNodeList => expectInstance(form.elements.namedItem(name), RadioNodeList, `form field ${name}`);
  const fName = fieldInput('name');
  const fSshSource = fieldRadios('sshSource');
  const fSshAlgo = fieldRadios('sshAlgo');
  const fSshTitle = fieldInput('sshTitle');
  const fSshPublicKey = fieldTextarea('sshPublicKey');
  const fSshFingerprint = fieldInput('sshFingerprint');
  const fSshPrivateKey = fieldInput('sshPrivateKey');
  const fSshHost = fieldInput('sshHost');
  const fSshUser = fieldInput('sshUser');
  const fSshPort = fieldInput('sshPort');
  const sshPaste = $textarea('#ssh-paste');
  const sshFile = $input('#ssh-file');

  const confirmPubOnly = (): Promise<boolean> =>
    confirm({ title: t('sshpub.title'), body: rich(t('sshpub.body')), okLabel: t('sshpub.save'), cancelLabel: t('common.cancel') });

  // Generating or importing a key over an existing one loses the previous key on save, so ask once.
  let overwriteOk = false;
  async function confirmOverwrite(action: 'generate' | 'import'): Promise<boolean> {
    if (overwriteOk || !state.editing?.sshPublicKey) return true;
    const gen = action === 'generate';
    overwriteOk = await confirm({
      title: t(gen ? 'sshover.titleGen' : 'sshover.titleImport'),
      body: t(gen ? 'sshover.textGen' : 'sshover.textImport'),
      okLabel: t(gen ? 'ssh.regen' : 'ssh.chooseFile'),
      cancelLabel: t('common.cancel'),
    });
    return overwriteOk;
  }

  let busy = false;

  function paintPreview(): void {
    const base = fSshPublicKey.dataset['base'];
    fSshPublicKey.value = base ? sshPubLine(base, fSshTitle.value.trim()) : '';
    $('#ssh-config').textContent = sshConfig({ name: fName.value, sshAlgo: fSshAlgo.value, sshHost: fSshHost.value.replace(/\s+/g, ''), sshUser: fSshUser.value.replace(/\s+/g, ''), sshPort: fSshPort.value });
  }
  function setKey(k: SshKeyInput | null): void {
    fSshPublicKey.dataset['base'] = k?.publicKey || '';
    fSshFingerprint.value = k?.fingerprint || '';
    fSshPrivateKey.value = k?.privateKey || '';
    if (k) fSshAlgo.value = k.algo;
    if (k?.comment) fSshTitle.value = k.comment.slice(0, 128);
    paintPreview();
  }
  function paintMode(): void {
    const importing = fSshSource.value === 'import';
    $('#ssh-algo-seg').hidden = importing;
    $('#ssh-import').hidden = !importing;
    $('#ssh-regen-row').hidden = importing;
  }
  async function generate(): Promise<void> {
    if (busy) return;
    busy = true;
    $('#edit-error').textContent = '';
    fSshPrivateKey.placeholder = t('ssh.generating');
    setKey(null);
    try {
      setKey(await api('POST /api/ssh/generate', { guard: guardSshKeyResponse, body: { algo: fSshAlgo.value } }));
    } catch (ex) { $('#edit-error').textContent = msgOf(ex); }
    fSshPrivateKey.placeholder = '••••••••';
    busy = false;
  }
  function ensureKey(): void {
    if (!fSshPublicKey.dataset['base'] && fSshSource.value === 'new') void generate();
  }
  async function importKey(): Promise<void> {
    const text = sshPaste.value;
    $('#edit-error').textContent = '';
    try {
      setKey(await api('POST /api/ssh/inspect', { guard: guardSshKeyResponse, body: { privateKey: text } }));
      sshPaste.value = '';
      toast(t('ssh.imported'));
    } catch (ex) { $('#edit-error').textContent = msgOf(ex); }
  }

  form.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name === 'sshSource') {
      paintMode();
      setKey(null);
      if (target.value === 'new') void generate();
    }
    if (target.name === 'sshAlgo' && fSshSource.value === 'new') void generate();
  });
  $('#ssh-regen').addEventListener('click', async () => { if (await confirmOverwrite('generate')) void generate(); });
  // Imports by itself when a complete key is pasted, or when the field loses focus with text in it.
  sshPaste.addEventListener('input', () => { if (/-----END [A-Z ]*PRIVATE KEY-----/.test(sshPaste.value)) void importKey(); });
  sshPaste.addEventListener('blur', () => { if (sshPaste.value.trim()) void importKey(); });
  $('#ssh-pick').addEventListener('click', async () => { if (await confirmOverwrite('import')) $('#ssh-file').click(); });
  sshFile.addEventListener('change', async () => {
    const file = firstFile(sshFile);
    sshFile.value = '';
    if (!file) return;
    if (file.size > 20000) { $('#edit-error').textContent = t('ssh.fileTooLarge'); return; }
    sshPaste.value = await file.text();
    void importKey();
  });
  queryAll(form, '[data-ssh-copy]', HTMLButtonElement).forEach((b) => {
    b.replaceChildren(icon('copy'));
    b.addEventListener('click', () => {
      const which = dataOneOf(b, 'sshCopy', ['public', 'fingerprint', 'private'] as const);
      const v = { public: fSshPublicKey.value, fingerprint: fSshFingerprint.value, private: fSshPrivateKey.value }[which];
      if (v) copy(v, { public: t('ssh.public'), fingerprint: t('ssh.fingerprint'), private: t('ssh.private') }[which], { sensitive: which === 'private' });
    });
  });
  $('#ssh-copy-config').addEventListener('click', () => copy(textOf($('#ssh-config')), 'config', { sensitive: false }));
  for (const input of [fName, fSshTitle, fSshHost, fSshUser]) input.addEventListener('input', paintPreview);
  fSshPort.addEventListener('input', () => { fSshPort.value = fSshPort.value.replace(/\D/g, '').slice(0, 5); paintPreview(); });

  const revealToggle = createRevealToggle({ input: fSshPrivateKey, button: $button('#ssh-reveal'), label: (shown) => t(shown ? 'reveal.privateKey.hide' : 'reveal.privateKey.show') });

  return {
    revealToggle,
    ensureKey,
    reset: () => {
      overwriteOk = false;
      fSshPublicKey.dataset['base'] = '';
    },
    fill: (item) => {
      fSshTitle.value = item?.sshTitle || '';
      fSshHost.value = item?.sshHost || '';
      fSshUser.value = item?.sshUser || '';
      fSshPort.value = item?.sshPort || '';
      if (item?.sshPublicKey) setKey({ algo: item.sshAlgo, publicKey: item.sshPublicKey, fingerprint: item.sshFingerprint, privateKey: item.sshPrivateKey });
      else paintPreview();
      paintMode();
    },
    hasKey: () => Boolean(fSshPublicKey.dataset['base']),
    hasPrivateKey: () => Boolean(fSshPrivateKey.value),
    confirmPubOnly,
    values: () => ({
      sshAlgo: fSshAlgo.value,
      sshTitle: fSshTitle.value,
      sshPublicKey: fSshPublicKey.dataset['base'] || '',
      sshFingerprint: fSshFingerprint.value,
      sshPrivateKey: fSshPrivateKey.value,
      sshHost: fSshHost.value,
      sshUser: fSshUser.value,
      sshPort: fSshPort.value,
    }),
    repaint: () => queryAll(form, '.ssh-only [data-icon]', HTMLElement).forEach((n) => n.replaceChildren(icon(iconNameOf(n)), ...rich(t(data(n, 'titleKey'))))),
  };
}

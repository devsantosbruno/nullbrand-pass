// Import, export and restore: the "Import / Backup" tools dialog and the two dialogs it opens.
import type { ApiWarning, ImportPreviewResponse } from '../api.js';
import { guardExportResponse, guardImportAnswer, guardMergeResponse, isApiErrorResponse, isImportPreviewResponse } from '../api-guards.js';
import { errText } from '../i18n.js';
import { $, $button, $dialog, $input, el, firstFile, query } from '../dom.js';
import { ApiResponseError, api, msgOf } from '../http.js';
import { readJson } from '../json.js';
import { t } from '../locale.js';
import { state } from '../state.js';
import { toast } from '../toast.js';
import { downloadBlob } from '../ui/download.js';
import { statusLine } from '../ui/status-line.js';

// A list of warnings (translated by key + params, like an error) under a dialog's form.
function renderWarnings(list: HTMLElement, warnings: readonly ApiWarning[]): void {
  list.replaceChildren(...warnings.map((w) => el('li', { textContent: t(w.key, w.params) })));
}

export interface ImportExportDeps {
  // Loads the items and folders again (after an import or a restore).
  refresh(): Promise<void>;
}

export function initImportExport({ refresh }: ImportExportDeps): void {
  const dlgTools = $dialog('#dlg-tools');
  const toolsMsg = statusLine($('#tools-msg'));
  $('#btn-tools').addEventListener('click', () => { toolsMsg(''); dlgTools.showModal(); });
  $('#btn-tools-close').addEventListener('click', () => dlgTools.close());

  // ---------- Import a file ----------
  // The flow is: choose a file -> the server reads it WITHOUT importing (dry run) and says what it found -> the options can be changed
  // (every change asks again) -> Import.
  const dlgImport = $dialog('#dlg-import');
  const importFile = $input('#import-file');
  const importFolder = $input('#import-folder');
  const importFoldersMode = query(document, '#import-folders-mode', HTMLSelectElement);
  const importRun = $button('#btn-import-run');
  const importMsg = statusLine($('#import-msg'));

  let importText: string | undefined;
  // Answers arrive out of order when the options change quickly: only the latest one is shown.
  let importRequest = 0;

  function importBody(extra: object = {}): object {
    return {
      text: importText,
      folder: importFolder.value.trim(),
      ignoreFolders: importFoldersMode.value === 'ignore',
      ...extra,
    };
  }

  function showImportPreview(preview: ImportPreviewResponse): void {
    $('#import-preview').hidden = false;
    $('#import-found').textContent = t('import.dlg.found', { count: preview.count });
    renderWarnings($('#import-warnings'), preview.warnings);
    importRun.disabled = preview.count === 0;
  }

  async function importPreview(): Promise<void> {
    if (importText === undefined) return;
    const mine = ++importRequest;
    importMsg(t('import.dlg.reading'), true);
    importRun.disabled = true;
    try {
      const answer = await api('POST /api/import', { guard: guardImportAnswer, body: importBody({ dryRun: true }) });
      if (mine !== importRequest) return;
      if (!isImportPreviewResponse(answer)) throw new ApiResponseError('POST /api/import', 'response: expected a preview');
      importMsg(null);
      showImportPreview(answer);
    } catch (ex) {
      if (mine !== importRequest) return;
      $('#import-preview').hidden = true;
      importMsg(msgOf(ex));
    }
  }

  $('#btn-import-open').addEventListener('click', () => {
    importText = undefined;
    importFile.value = '';
    importFolder.value = '';
    $('#import-preview').hidden = true;
    importRun.disabled = true;
    importMsg(null);
    $('#import-folder-list').replaceChildren(...state.folders.map((f) => el('option', { value: f })));
    dlgTools.close();
    dlgImport.showModal();
  });
  $('#btn-import-close').addEventListener('click', () => dlgImport.close());
  dlgImport.addEventListener('close', () => { importText = undefined; });

  importFile.addEventListener('change', async () => {
    const file = firstFile(importFile);
    importText = file ? await file.text() : undefined;
    if (importText === undefined) {
      $('#import-preview').hidden = true;
      importRun.disabled = true;
      return;
    }
    await importPreview();
  });
  importFoldersMode.addEventListener('change', importPreview);
  importFolder.addEventListener('change', importPreview);

  importRun.addEventListener('click', async () => {
    if (importText === undefined) return importMsg(t('import.dlg.chooseFile'));
    importRun.disabled = true;
    importMsg(t('tools.importing'), true);
    try {
      const result = await api('POST /api/import', { guard: guardImportAnswer, body: importBody() });
      if (isImportPreviewResponse(result)) throw new ApiResponseError('POST /api/import', 'response: expected a result');
      await refresh();
      importText = undefined;
      importFile.value = '';
      dlgImport.close();
      const summary = [t('import.added', { count: result.added }), result.skipped && t('import.skipped', { count: result.skipped }), result.ignored && t('import.ignored', { count: result.ignored })].filter(Boolean).join(', ');
      toast(`${summary}. ${t('import.deleteExport')}`, 6000);
    } catch (ex) {
      importRun.disabled = false;
      importMsg(msgOf(ex));
    }
  });

  // ---------- Export ----------
  const dlgExport = $dialog('#dlg-export');
  const exportProtection = query(document, '#export-protection', HTMLSelectElement);
  const exportConfirm = $input('#export-confirm');
  const exportPassword = $input('#export-password');
  const exportMsg = statusLine($('#export-msg'));

  // Encrypted is the native backup, readable only by nullbrand; unencrypted is a JSON file any app can be pointed at.
  function renderExportChoices(): void {
    const plain = exportProtection.value === 'plain';
    $('#export-plain').hidden = !plain;
    renderWarnings($('#export-warnings'), []);
    // What the plain file cannot hold, counted from the items already on screen.
    const ssh = state.items.filter((i) => i.type === 'ssh').length;
    $('#export-note').textContent = !plain ? t('export.dlg.encryptedNote') : ssh > 0 ? t('export.dlg.lossyJson', { count: ssh }) : '';
  }

  $('#btn-export-open').addEventListener('click', () => {
    exportProtection.value = 'encrypted';
    renderExportChoices();
    exportMsg(null);
    dlgTools.close();
    dlgExport.showModal();
  });
  $('#btn-export-close').addEventListener('click', () => dlgExport.close());
  dlgExport.addEventListener('close', () => {
    exportPassword.value = '';
    exportConfirm.checked = false;
  });
  exportProtection.addEventListener('change', renderExportChoices);

  // The encrypted backup is a file, not JSON for the UI to read: it does not go through api(), and the answer is handed to the browser as it is.
  async function exportBackup(): Promise<void> {
    const res = await fetch('/api/export/backup');
    if (!res.ok) {
      const answer = await readJson(res);
      const d = isApiErrorResponse(answer) ? answer : { key: undefined, params: undefined, error: undefined };
      throw new Error(errText(t, { key: d.key, params: d.params, message: d.error }) || t('tools.export.failed'));
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'nullbrand-backup.json';
    downloadBlob(await res.blob(), name);
    exportMsg(t('tools.export.done'), true);
  }

  async function exportPlain(): Promise<void> {
    if (!exportConfirm.checked) return exportMsg(t('export.dlg.needConfirm'));
    if (!exportPassword.value) return exportMsg(t('export.dlg.needPassword'));
    const file = await api('POST /api/export', { guard: guardExportResponse, body: { password: exportPassword.value, confirm: true } });
    exportPassword.value = '';
    exportConfirm.checked = false;
    downloadBlob(new Blob([file.text], { type: file.mime }), file.filename);
    renderWarnings($('#export-warnings'), file.warnings);
    exportMsg(t('export.deleteAfter'), true);
  }

  $('#btn-export-run').addEventListener('click', async () => {
    exportMsg(null);
    try {
      if (exportProtection.value === 'plain') await exportPlain();
      else await exportBackup();
    } catch (ex) {
      exportMsg(msgOf(ex));
    }
  });

  $('#btn-restore').addEventListener('click', async () => {
    const file = firstFile($input('#file-backup'));
    if (!file) return toolsMsg(t('tools.restore.chooseFile'));
    toolsMsg(t('tools.restoring'), true);
    try {
      const r = await api('POST /api/import/backup', { guard: guardMergeResponse, body: { text: await file.text(), password: $input('#backup-pass').value } });
      $input('#backup-pass').value = '';
      $input('#file-backup').value = '';
      await refresh();
      toolsMsg(`${[t('import.added', { count: r.added }), r.skipped && t('import.existed', { count: r.skipped })].filter(Boolean).join(', ')}.`, true);
    } catch (ex) {
      toolsMsg(msgOf(ex));
    }
  });
}

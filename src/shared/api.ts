// The local HTTP API: what each route takes and gives back. Shared by the server and the web UI. Pure: no Node or DOM APIs.
// The request types describe what a well-behaved client sends; the server does not validate them (it reads each field defensively, the
// way it always did), so they document the contract rather than guard it.
import type { Lang, LangSource, TranslateParams } from './i18n.js';
import type { VaultItem } from './vault-types.js';

// Distributes over the union, so the omitted keys disappear from every variant (a plain Omit would flatten the union).
type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

// An item as the list endpoint shows it: the secrets are replaced by "has one" flags.
export type PublicItem = DistributiveOmit<VaultItem, 'password' | 'totp' | 'sshPrivateKey'> & {
  hasPassword: boolean;
  hasTotp: boolean;
  hasSshKey: boolean;
};

export interface OkResponse {
  ok: true;
}
export interface CountResponse {
  ok: true;
  count: number;
}
export interface StatusResponse {
  exists: boolean;
  unlocked: boolean;
  vaultPath: string;
  idleMinutes: number;
  count: number | null;
  lang: Lang;
  langSource: LangSource;
}
export interface ConfigResponse {
  lang: Lang;
  source: LangSource;
  supported: readonly Lang[];
}
export interface FolderNameResponse {
  name: string;
}
export interface FolderDeleteResponse {
  ok: true;
  count: number;
}
export interface SshKeyResponse {
  algo: 'ed25519' | 'rsa4096';
  publicKey: string;
  fingerprint: string;
  privateKey: string;
  comment?: string;
}
export interface ClipboardCopyResponse {
  ok: true;
  seconds: number;
  // Present (false) only when the copy could not be hidden from clipboard history managers.
  concealed?: false;
}
export interface GenerateResponse {
  password: string;
  bits: number;
}
export interface MergeResponse {
  added: number;
  skipped: number;
}
// A lossy or surprising step of an import / export, in the form the UI can translate (`key` + `params`, like an error).
export interface ApiWarning {
  key: string;
  params: TranslateParams;
}
export interface ImportResponse extends MergeResponse {
  ignored: number;
  warnings: ApiWarning[];
}
// What an import would do, without doing it (`dryRun`).
export interface ImportPreviewResponse {
  count: number;
  ignored: number;
  warnings: ApiWarning[];
}
// The unencrypted export travels as JSON, not as a download, so the warnings come with it.
export interface ExportResponse {
  filename: string;
  mime: string;
  text: string;
  warnings: ApiWarning[];
}
// Every error answer: `key` + `params` let the UI translate it (see errText in i18n.ts).
export interface ApiErrorResponse {
  error: string;
  key?: string | undefined;
  params?: TranslateParams | undefined;
}

// ---- request bodies ----
export interface PasswordRequest {
  password: string;
}
export interface ConfigRequest {
  lang: string;
}
export interface BulkRequest {
  ids: string[];
  action: 'delete' | 'move';
  folder?: string;
}
export interface FolderRequest {
  name: string;
}
export interface FolderRenameRequest {
  from: string;
  to: string;
}
export interface FolderDeleteRequest {
  name: string;
  deleteItems?: boolean;
}
export interface SshGenerateRequest {
  algo: 'ed25519' | 'rsa4096';
}
export interface SshInspectRequest {
  privateKey: string;
}
export interface ClipboardCopyRequest {
  text: string;
  sensitive?: boolean;
}
export interface GenerateRequest {
  length?: number | string;
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbols?: boolean;
  avoidAmbiguous?: boolean;
}
export interface TextImportRequest {
  text: string;
}
export interface ImportRequest extends TextImportRequest {
  folder?: string;
  ignoreFolders?: boolean;
  dryRun?: boolean;
}
export interface ExportRequest {
  // The master password again: an unencrypted export is the one place the key held in memory is not enough.
  password: string;
  confirm: true;
}
export interface BackupImportRequest extends TextImportRequest {
  password: string;
}
export interface ChangePasswordRequest {
  current: string;
  next: string;
}

// Error statuses: 401 no session, 423 vault locked (every route that needs the vault, folders included), 404 unknown item on
// GET/PUT/DELETE /api/items/:id, 400 invalid input, 405 wrong method on / and /auth (the request body is discarded first).
// Route key ("METHOD /path") -> what the handler answers. `undefined` means the handler wrote the response itself.
export interface ApiResponses {
  'GET /api/status': StatusResponse;
  'GET /api/config': ConfigResponse;
  'PUT /api/config': ConfigResponse;
  'POST /api/setup': OkResponse;
  'POST /api/unlock': OkResponse;
  'POST /api/lock': OkResponse;
  'GET /api/items': PublicItem[];
  'GET /api/items/:id': VaultItem;
  'POST /api/items': VaultItem;
  'PUT /api/items/:id': VaultItem;
  'DELETE /api/items/:id': OkResponse;
  'POST /api/items/bulk': CountResponse;
  'GET /api/folders': string[];
  'POST /api/folders': FolderNameResponse;
  'PUT /api/folders': FolderNameResponse;
  'POST /api/folders/delete': FolderDeleteResponse;
  'POST /api/ssh/generate': SshKeyResponse;
  'POST /api/ssh/inspect': SshKeyResponse;
  'POST /api/clipboard/copy': ClipboardCopyResponse;
  'POST /api/generate': GenerateResponse;
  'POST /api/import': ImportResponse | ImportPreviewResponse;
  'POST /api/import/backup': MergeResponse;
  'GET /api/export/backup': undefined;
  'POST /api/export': ExportResponse;
  'POST /api/password': OkResponse;
  'POST /api/destroy': OkResponse;
  'POST /api/shutdown': undefined;
}
export type ApiRoute = keyof ApiResponses;

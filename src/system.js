// Integrações com o sistema operacional: abrir o navegador e copiar para a área de transferência.
import { spawn } from 'node:child_process';

export function openBrowser(url) {
  const platform = process.platform;
  const [cmd, args] =
    platform === 'darwin' ? ['open', [url]] :
    platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] :
    ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

const CLIPBOARD_CMDS = {
  darwin: [['pbcopy', []]],
  win32: [['clip', []]],
  linux: [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]],
};

function tryCopy(cmd, args, text) {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      child.once('error', () => resolve(false));
      child.once('close', (code) => resolve(code === 0));
      child.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

export async function copyToClipboard(text) {
  for (const [cmd, args] of CLIPBOARD_CMDS[process.platform] || CLIPBOARD_CMDS.linux) {
    if (await tryCopy(cmd, args, text)) return true;
  }
  return false;
}

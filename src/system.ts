// Operating system integrations: opening the browser. The clipboard lives in clipboard.js.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

// Detects environments where opening a browser makes no sense (SSH, WSL, Linux without a display).
export function isHeadless(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  return false;
}

export type SpawnFn = (command: string, args: readonly string[], options?: SpawnOptions) => ChildProcess;

export interface OpenBrowserOptions {
  spawnFn?: SpawnFn;
  platform?: NodeJS.Platform;
}

// The URL with the token is passed as a process argument (open/xdg-open/rundll32) and may show up
// in the process list. There is no portable alternative without writing the token to disk; the
// mitigation is that the token is single-use and expires in 60 s (see server.js).
export function openBrowser(url: string, { spawnFn = spawn, platform = process.platform }: OpenBrowserOptions = {}): Promise<boolean> {
  const [cmd, args]: readonly [string, readonly string[]] =
    platform === 'darwin' ? ['open', [url]] :
    platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] :
    ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawnFn(cmd, args, { stdio: 'ignore', detached: true });
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

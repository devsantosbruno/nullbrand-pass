// How an SSH key pair is written out: the public line, file names, the suggested ~/.ssh/config entry and the .zip carrying both files.
// Pure, with no DOM, so it can be tested on its own.

/** Display names of the supported algorithms. */
export const SSH_ALGOS: Readonly<Record<string, string>> = { ed25519: 'Ed25519', rsa4096: 'RSA 4096' };
/** Returns the public key line, with the title as its comment when there is one. */
export const sshPubLine = (pub: string, title: string): string => (title ? `${pub} ${title}` : pub);
/** Turns a name into a lowercase ASCII slug for host aliases and file names; `server` if nothing is left. */
export const sshSlug = (v: string): string => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
/** Returns the private key file name following the ssh-keygen convention (`id_ed25519_<slug>`). */
export const sshFileName = (name: string, algo: string): string => `id_${algo === 'rsa4096' ? 'rsa' : 'ed25519'}_${sshSlug(name)}`;

/** Returns a suggested `~/.ssh/config` entry. Port 22 is omitted as the default. */
export function sshConfig({ name = '', sshAlgo = 'ed25519', sshHost = '', sshUser = '', sshPort = '' }: { name?: string; sshAlgo?: string; sshHost?: string; sshUser?: string; sshPort?: string }): string {
  const alias = sshSlug(name);
  const file = `~/.ssh/${sshFileName(name, sshAlgo)}`;
  return [
    `Host ${alias}`,
    sshHost && `  HostName ${sshHost}`,
    sshUser && `  User ${sshUser}`,
    sshPort && sshPort !== '22' && `  Port ${sshPort}`,
    `  IdentityFile ${file}`,
    '  IdentitiesOnly yes',
  ].filter(Boolean).join('\n');
}

// Hand-written uncompressed ZIP. The Unix mode goes in the external attributes so `unzip` restores the private key as 600.
const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
// One little-endian ZIP header field: [offset, value, size in bytes].
type ZipField = readonly [number, number, number];
/** One file to place in the archive; `mode` is its Unix permission bits. */
export interface ZipFile {
  name: string;
  text: string;
  mode: number;
}
/** Returns the archive as ordered pieces; join them with `new Blob(parts)`. `now` is the modification time of every entry. */
export function zipParts(files: readonly ZipFile[], now = new Date()): (DataView<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] {
  const enc = new TextEncoder();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: (DataView<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] = [];
  const central: (DataView<ArrayBuffer> | Uint8Array<ArrayBuffer>)[] = [];
  let offset = 0;
  for (const { name, text, mode } of files) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    const localFields: readonly ZipField[] = [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dosTime, 2], [12, dosDate, 2], [14, crc, 4],
      [18, data.length, 4], [22, data.length, 4], [26, nameB.length, 2], [28, 0, 2]];
    localFields.forEach(([o, v, n]) => (n === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true)));
    const cen = new DataView(new ArrayBuffer(46));
    const centralFields: readonly ZipField[] = [[0, 0x02014b50, 4], [4, (3 << 8) | 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dosTime, 2], [14, dosDate, 2],
      [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nameB.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2],
      [36, 0, 2], [38, ((0o100000 | mode) << 16) >>> 0, 4], [42, offset, 4]];
    centralFields.forEach(([o, v, n]) => (n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
    parts.push(local, nameB, data);
    central.push(cen, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  const endFields: readonly ZipField[] = [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, offset, 4]];
  endFields.forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return [...parts, ...central, end];
}

/** Returns the files of a downloaded key pair: private (600) and, when there is one, public (644). */
export function sshKeyPairFiles({ name, algo, privateKey, publicKey }: { name: string; algo: string; privateKey: string; publicKey: string }): { base: string; files: ZipFile[] } {
  const base = sshFileName(name, algo);
  const nl = (t: string): string => (t.endsWith('\n') ? t : `${t}\n`);
  const files: ZipFile[] = [{ name: base, text: nl(privateKey), mode: 0o600 }];
  if (publicKey) files.push({ name: `${base}.pub`, text: nl(publicKey), mode: 0o644 });
  return { base, files };
}

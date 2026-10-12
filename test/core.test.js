import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, readBackupItems } from '../src/vault.js';
import { generatePassword, entropyBits } from '../src/generator.js';
import { parseBitwardenExport } from '../src/importers/bitwarden.js';

const tmp = async () => mkdtemp(join(tmpdir(), 'vp-test-'));

test('cria, salva e reabre o cofre; senha errada falha', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const v = await Vault.create('senha-mestra-forte', path);
  await v.add({ name: 'GitHub', username: 'bruno', password: 's3cr3t!', uris: ['github.com'] });

  const raw = await readFile(path, 'utf8');
  assert.ok(!raw.includes('s3cr3t!'), 'senha não pode aparecer em texto claro');
  assert.ok(!raw.includes('GitHub'), 'nome do item também fica cifrado');

  const again = await Vault.unlock('senha-mestra-forte', path);
  assert.equal(again.items.length, 1);
  assert.equal(again.items[0].password, 's3cr3t!');

  await assert.rejects(Vault.unlock('errada-errada', path), { code: 'WRONG_PASSWORD' });
  await rm(dir, { recursive: true });
});

test('adulterar o cabeçalho (KDF) invalida o cofre', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  await Vault.create('senha-mestra-forte', path);
  const file = JSON.parse(await readFile(path, 'utf8'));
  file.payload.data = Buffer.from('lixo').toString('base64');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, JSON.stringify(file));
  await assert.rejects(Vault.unlock('senha-mestra-forte', path), { code: 'WRONG_PASSWORD' });
  await rm(dir, { recursive: true });
});

test('atualiza, remove, troca senha e exporta backup', async () => {
  const dir = await tmp();
  const path = join(dir, 'vault.json');
  const v = await Vault.create('senha-mestra-forte', path);
  const a = await v.add({ name: 'A', password: '1' });
  await v.add({ name: 'B', password: '2' });
  await v.update(a.id, { password: 'novo' });
  assert.equal(v.get(a.id).password, 'novo');
  await v.remove(a.id);
  assert.equal(v.items.length, 1);

  const backup = join(dir, 'backup.json');
  await v.exportBackup(backup);
  await v.changePassword('outra-senha-mestra');
  await assert.rejects(Vault.unlock('senha-mestra-forte', path), { code: 'WRONG_PASSWORD' });
  assert.equal((await Vault.unlock('outra-senha-mestra', path)).items.length, 1);

  const restored = await readBackupItems(backup, 'senha-mestra-forte');
  assert.equal(restored[0].name, 'B');
  const r = await v.merge(restored);
  assert.deepEqual(r, { added: 0, skipped: 1 }, 'duplicata exata é ignorada');
  await rm(dir, { recursive: true });
});

test('senha mestra curta é recusada', async () => {
  const dir = await tmp();
  await assert.rejects(Vault.create('curta', join(dir, 'v.json')));
  await rm(dir, { recursive: true });
});

test('gerador respeita opções', () => {
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword({ length: 16, symbols: false, avoidAmbiguous: true });
    assert.equal(pw.length, 16);
    assert.match(pw, /^[a-zA-Z0-9]+$/);
    assert.doesNotMatch(pw, /[Il1O0o]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
  }
  assert.equal(generatePassword({ length: 5, upper: false, lower: false, symbols: false }).length, 5);
  assert.throws(() => generatePassword({ upper: false, lower: false, digits: false, symbols: false }));
  assert.ok(entropyBits({ length: 20 }) > 120);
});

test('importa export do Bitwarden', () => {
  const exp = {
    encrypted: false,
    folders: [{ id: 'f1', name: 'Trabalho' }],
    items: [
      { type: 1, name: 'Email', folderId: 'f1', favorite: true, notes: 'n', login: { username: 'u', password: 'p', totp: 'JBSWY3DP', uris: [{ uri: 'https://mail.com' }] }, fields: [{ name: 'PIN', value: '1234' }] },
      { type: 2, name: 'Nota', notes: 'segredo' },
      { type: 3, name: 'Cartão', card: { brand: 'Visa', number: '4111' } },
      { type: 1, name: 'Apagado', deletedDate: '2024-01-01', login: {} },
      { type: 5, name: 'SSH key' },
    ],
  };
  const { items, ignored } = parseBitwardenExport(JSON.stringify(exp));
  assert.equal(items.length, 3);
  assert.equal(ignored, 2);
  assert.equal(items[0].folder, 'Trabalho');
  assert.deepEqual(items[0].uris, ['https://mail.com']);
  assert.equal(items[0].totp, 'JBSWY3DP');
  assert.match(items[0].notes, /PIN: 1234/);
  assert.equal(items[1].type, 'note');
  assert.match(items[2].notes, /Cartão importado/);
  assert.throws(() => parseBitwardenExport(JSON.stringify({ encrypted: true, data: 'x' })), /criptografado/);
});

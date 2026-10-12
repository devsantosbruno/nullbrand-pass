// Interface de linha de comando do voltrama-pass.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vault, vaultExists, defaultVaultPath, readBackupItems } from './vault.js';
import { generatePassword, entropyBits } from './generator.js';
import { parseBitwardenExport } from './importers/bitwarden.js';
import { startServer } from './server.js';
import { ask, confirm, closePrompt } from './prompt.js';
import { openBrowser, copyToClipboard } from './system.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  volt: (s) => (color ? `\x1b[38;5;190m${s}\x1b[0m` : s),
  dim: (s) => (color ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (color ? `\x1b[1m${s}\x1b[0m` : s),
  red: (s) => (color ? `\x1b[31m${s}\x1b[0m` : s),
};
const logo = () => `${c.volt('⚡ voltrama')}${c.bold('-pass')} ${c.dim('v' + pkg.version)}`;

const HELP = `
${logo()}
Gerenciador de senhas 100% local. Nada sai do seu computador.

${c.bold('Uso')}
  npx voltrama-pass                    Abre a interface web local (padrão)
  npx voltrama-pass <comando> [opções]

${c.bold('Comandos')}
  ui                                   Abre a interface web local
  init                                 Cria um cofre novo pelo terminal
  list [busca]                         Lista os itens (sem mostrar senhas)
  get <busca> [--show]                 Copia a senha do item (--show imprime na tela)
  add                                  Adiciona um login interativamente
  rm <busca>                           Remove um item
  generate [-l 20] [--no-symbols]      Gera uma senha forte
           [--no-digits] [--no-upper] [--no-lower] [--avoid-ambiguous]
  import bitwarden <arquivo.json>      Importa um export .json do Bitwarden
  import backup <arquivo.json>         Mescla itens de um backup do voltrama-pass
  export <arquivo.json>                Exporta um backup criptografado
  passwd                               Troca a senha mestra
  where                                Mostra onde o cofre está salvo

${c.bold('Opções da interface web')}
  --port <n>                           Porta fixa (padrão: aleatória)
  --idle <min>                         Bloqueio por inatividade (padrão: 15, 0 = nunca)
  --no-open                            Não abre o navegador automaticamente

${c.bold('Opções gerais')}
  --vault <caminho>                    Usa outro arquivo de cofre
  -h, --help                           Ajuda
  -v, --version                        Versão

O cofre fica em ${c.dim(defaultVaultPath())}
(altere com a variável VOLTRAMA_PASS_HOME ou com --vault).
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--no-')) flags[a.slice(5)] = false;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (['port', 'idle', 'vault', 'length'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else if (a === '-l') flags.length = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

class CliError extends Error {}

async function unlockInteractive(vaultPath) {
  if (!vaultExists(vaultPath)) {
    throw new CliError(`Nenhum cofre em ${vaultPath}. Rode "npx voltrama-pass init" ou abra a interface web.`);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const pw = await ask('Senha mestra: ', { hidden: true });
    try {
      return await Vault.unlock(pw, vaultPath);
    } catch (err) {
      if (err.code !== 'WRONG_PASSWORD') throw err;
      console.error(c.red(err.message));
    }
  }
  throw new CliError('Muitas tentativas.');
}

async function chooseItem(vault, query) {
  if (!query) throw new CliError('Informe o nome (ou parte do nome) do item.');
  const matches = vault.find(query);
  if (matches.length === 0) throw new CliError(`Nenhum item encontrado para "${query}".`);
  if (matches.length === 1) return matches[0];
  const exact = matches.filter((m) => m.name.toLowerCase() === query.toLowerCase());
  if (exact.length === 1) return exact[0];
  matches.slice(0, 20).forEach((m, i) => console.log(`  ${c.volt(String(i + 1).padStart(2))}  ${m.name} ${c.dim(m.username || '')}`));
  const n = Number.parseInt(await ask(`Vários itens encontrados. Qual (1-${Math.min(20, matches.length)})? `), 10);
  const item = matches[n - 1];
  if (!item) throw new CliError('Seleção inválida.');
  return item;
}

function printItems(items) {
  if (items.length === 0) return console.log(c.dim('  (nenhum item)'));
  const w = Math.min(36, Math.max(...items.map((i) => i.name.length)));
  for (const i of items) {
    const name = i.name.length > w ? i.name.slice(0, w - 1) + '…' : i.name.padEnd(w);
    const detail = i.type === 'note' ? c.dim('nota segura') : `${i.username}${i.uris[0] ? c.dim('  ' + i.uris[0]) : ''}`;
    console.log(`  ${i.favorite ? c.volt('★') : ' '} ${name}  ${detail}`);
  }
}

const commands = {
  async ui({ flags, vaultPath }) {
    const idleMinutes = flags.idle !== undefined ? Number(flags.idle) : 15;
    const port = flags.port ? Number(flags.port) : 0;
    let srv;
    try {
      srv = await startServer({ vaultPath, port, idleMinutes, onShutdown: () => process.exit(0) });
    } catch (err) {
      if (err.code === 'EADDRINUSE') throw new CliError(`A porta ${port} já está em uso.`);
      throw err;
    }
    console.log(`\n${logo()}\n`);
    console.log(`  Cofre:  ${c.dim(vaultPath)}${vaultExists(vaultPath) ? '' : c.dim(' (será criado na primeira abertura)')}`);
    console.log(`  Acesse: ${c.volt(srv.url)}`);
    console.log(c.dim('\n  O link contém um token de sessão único — não compartilhe.'));
    console.log(c.dim('  Servidor escutando só em 127.0.0.1. Ctrl+C para encerrar.\n'));
    if (flags.open !== false) {
      const ok = await openBrowser(srv.url);
      if (!ok) console.log(c.dim('  (não consegui abrir o navegador; copie o link acima)\n'));
    }
    const stop = async () => {
      console.log(c.dim('\n  Bloqueando o cofre e encerrando…'));
      await srv.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return new Promise(() => {}); // mantém o processo vivo
  },

  async init({ vaultPath }) {
    if (vaultExists(vaultPath)) throw new CliError(`Já existe um cofre em ${vaultPath}.`);
    console.log(`${logo()}\n`);
    console.log('Crie uma senha mestra forte. Não há como recuperá-la se você esquecer.\n');
    const p1 = await ask('Nova senha mestra (mín. 8): ', { hidden: true });
    const p2 = await ask('Confirme: ', { hidden: true });
    if (p1 !== p2) throw new CliError('As senhas não conferem.');
    await Vault.create(p1, vaultPath);
    console.log(`\n${c.volt('✓')} Cofre criado em ${vaultPath}`);
  },

  async list({ positional, vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const items = positional[1] ? vault.find(positional[1]) : vault.list();
    console.log(c.dim(`\n  ${items.length} item(ns)\n`));
    printItems(items);
  },

  async get({ positional, flags, vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const item = await chooseItem(vault, positional.slice(1).join(' '));
    console.log(`\n  ${c.bold(item.name)}${item.folder ? c.dim('  [' + item.folder + ']') : ''}`);
    if (item.username) console.log(`  Usuário: ${item.username}`);
    item.uris.forEach((u) => console.log(`  Site:    ${u}`));
    if (item.type === 'note' || flags.show) {
      if (item.password) console.log(`  Senha:   ${item.password}`);
      if (item.notes) console.log(`\n${item.notes}`);
      return;
    }
    if (!item.password) return console.log(c.dim('  (sem senha)'));
    if (await copyToClipboard(item.password)) {
      console.log(`  ${c.volt('✓')} Senha copiada para a área de transferência.`);
    } else {
      console.log(c.dim('  Não encontrei um utilitário de área de transferência. Use --show para imprimir a senha.'));
    }
  },

  async add({ vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const name = (await ask('Nome: ')).trim();
    if (!name) throw new CliError('O nome é obrigatório.');
    const username = (await ask('Usuário / e-mail: ')).trim();
    let password = await ask('Senha (Enter para gerar uma): ', { hidden: true });
    if (!password) {
      password = generatePassword();
      console.log(c.dim('  Senha forte gerada (20 caracteres).'));
    }
    const uri = (await ask('Site (opcional): ')).trim();
    const folder = (await ask('Pasta (opcional): ')).trim();
    const item = await vault.add({ type: 'login', name, username, password, uris: uri ? [uri] : [], folder });
    console.log(`${c.volt('✓')} "${item.name}" salvo.`);
  },

  async rm({ positional, vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const item = await chooseItem(vault, positional.slice(1).join(' '));
    if (!(await confirm(`Excluir "${item.name}"${item.username ? ` (${item.username})` : ''}?`))) return console.log('Cancelado.');
    await vault.remove(item.id);
    console.log(`${c.volt('✓')} Item excluído.`);
  },

  async generate({ flags }) {
    const opts = {
      length: flags.length ?? 20,
      upper: flags.upper !== false,
      lower: flags.lower !== false,
      digits: flags.digits !== false,
      symbols: flags.symbols !== false,
      avoidAmbiguous: Boolean(flags['avoid-ambiguous']),
    };
    const pw = generatePassword(opts);
    console.log(pw);
    if (process.stdout.isTTY) console.error(c.dim(`≈ ${entropyBits({ ...opts, length: pw.length })} bits de entropia`));
  },

  async import({ positional, vaultPath }) {
    const kind = positional[1];
    const file = positional[2] && resolve(positional[2]);
    if (!['bitwarden', 'backup'].includes(kind) || !file) {
      throw new CliError('Uso: import bitwarden <arquivo.json>  |  import backup <arquivo.json>');
    }
    if (!existsSync(file)) throw new CliError(`Arquivo não encontrado: ${file}`);
    let items;
    let ignored = 0;
    if (kind === 'bitwarden') {
      ({ items, ignored } = parseBitwardenExport(await readFile(file, 'utf8')));
    } else {
      const pw = await ask('Senha mestra do backup: ', { hidden: true });
      try {
        items = await readBackupItems(file, pw);
      } catch (err) {
        if (err.code === 'WRONG_PASSWORD') throw new CliError('Senha do backup incorreta.');
        throw err;
      }
    }
    console.log(c.dim(`Encontrados ${items.length} itens. Agora desbloqueie o cofre de destino.`));
    const vault = await unlockInteractive(vaultPath);
    const r = await vault.merge(items);
    console.log(`${c.volt('✓')} ${r.added} importados${r.skipped ? `, ${r.skipped} duplicados ignorados` : ''}${ignored ? `, ${ignored} não suportados` : ''}.`);
    if (kind === 'bitwarden') console.log(c.dim('  Lembre de apagar o arquivo exportado do Bitwarden — ele não é criptografado.'));
  },

  async export({ positional, vaultPath }) {
    const dest = positional[1] ? resolve(positional[1]) : resolve(`voltrama-pass-backup-${new Date().toISOString().slice(0, 10)}.json`);
    if (existsSync(dest) && !(await confirm(`${dest} já existe. Sobrescrever?`))) return console.log('Cancelado.');
    const vault = await unlockInteractive(vaultPath);
    await vault.exportBackup(dest);
    console.log(`${c.volt('✓')} Backup criptografado salvo em ${dest}`);
  },

  async passwd({ vaultPath }) {
    const vault = await unlockInteractive(vaultPath);
    const p1 = await ask('Nova senha mestra (mín. 8): ', { hidden: true });
    const p2 = await ask('Confirme: ', { hidden: true });
    if (p1 !== p2) throw new CliError('As senhas não conferem.');
    await vault.changePassword(p1);
    console.log(`${c.volt('✓')} Senha mestra alterada.`);
  },

  async where({ vaultPath }) {
    console.log(vaultPath + (vaultExists(vaultPath) ? '' : c.dim('  (ainda não existe)')));
  },
};
commands.start = commands.ui;
commands.ls = commands.list;
commands.gen = commands.generate;

export async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  if (flags.version) return console.log(pkg.version);
  if (flags.help || positional[0] === 'help') return console.log(HELP);
  const name = positional[0] || 'ui';
  const cmd = commands[name];
  if (!cmd) {
    console.error(c.red(`Comando desconhecido: ${name}`));
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  const vaultPath = flags.vault ? resolve(flags.vault) : defaultVaultPath();
  try {
    await cmd({ positional, flags, vaultPath });
  } catch (err) {
    console.error(c.red(`✗ ${err.message}`));
    process.exitCode = 1;
  } finally {
    if (name !== 'ui' && name !== 'start') closePrompt();
  }
}

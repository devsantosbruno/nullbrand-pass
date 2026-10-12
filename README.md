# ⚡ voltrama-pass

Gerenciador de senhas **100% local**, no estilo Bitwarden. Sem conta, sem nuvem, sem servidor externo: o cofre é um arquivo criptografado no seu computador.

```bash
npx voltrama-pass
```

O comando sobe uma interface web **só em `127.0.0.1`** e abre o navegador. Na primeira vez, você cria a senha mestra; depois é só desbloquear.

## Recursos

- Cofre criptografado com **AES-256-GCM** e chave derivada por **scrypt** (N=2¹⁷, r=8, p=1)
- Logins (usuário, senha, sites, pasta, favorito, notas) e notas seguras
- Busca, filtros e pastas
- Gerador de senhas com sorteio uniforme (`crypto.randomInt`)
- **Importação do Bitwarden** (export `.json` não criptografado — logins, notas; cartões e identidades viram notas)
- **Backup criptografado** (exportar e restaurar/mesclar)
- Troca de senha mestra
- CLI completa para quem prefere o terminal
- **Zero dependências**: só módulos nativos do Node.js

## Requisitos

Node.js 20.10 ou mais novo.

## Uso pela CLI

```bash
npx voltrama-pass                     # interface web (padrão)
npx voltrama-pass init                # cria o cofre pelo terminal
npx voltrama-pass list [busca]        # lista os itens
npx voltrama-pass get github          # copia a senha para a área de transferência
npx voltrama-pass get github --show   # imprime a senha
npx voltrama-pass add                 # adiciona um login
npx voltrama-pass rm github           # remove
npx voltrama-pass generate -l 32      # gera uma senha
npx voltrama-pass import bitwarden ~/Downloads/bitwarden_export.json
npx voltrama-pass import backup backup.json
npx voltrama-pass export backup.json  # backup criptografado
npx voltrama-pass passwd              # troca a senha mestra
npx voltrama-pass where               # mostra onde está o cofre
```

Opções da interface web: `--port <n>`, `--idle <min>` (bloqueio por inatividade, padrão 15; `0` desliga) e `--no-open`.

Para instalar de vez: `npm install -g voltrama-pass` e use só `voltrama-pass`.

## Onde ficam os dados

`~/.voltrama-pass/vault.json` (no Windows, `C:\Users\<você>\.voltrama-pass\vault.json`).
Mude com a variável `VOLTRAMA_PASS_HOME` ou com `--vault <caminho>`.

O arquivo tem um cabeçalho em texto claro (formato, versão, parâmetros do scrypt e salt) e o conteúdo inteiro cifrado — **inclusive os nomes dos itens**. O cabeçalho entra como dado autenticado (AAD) do GCM, então alterar os parâmetros invalida o arquivo. As gravações são atômicas (arquivo temporário + rename) e o arquivo é criado com permissão `600`.

> **Não existe recuperação de senha.** Se esquecer a senha mestra, o cofre não pode ser aberto. Faça backups.

## Modelo de segurança

| Ameaça | Proteção |
| --- | --- |
| Alguém na rede local | O servidor só escuta em `127.0.0.1` e se recusa a subir em outro endereço |
| Site malicioso aberto no navegador | Toda chamada de API exige um token aleatório por execução (vai no link do terminal, no fragmento `#`, e fica no `sessionStorage`); `Host` e `Origin` são validados (bloqueia DNS rebinding) |
| XSS / scripts de terceiros | CSP `default-src 'none'`, nenhum recurso externo, dados sempre renderizados com `textContent` |
| Esquecer o cofre aberto | Bloqueio automático por inatividade (15 min); a chave fica só na memória e é zerada ao bloquear |
| Roubo do arquivo do cofre | Força bruta limitada pelo custo do scrypt (~128 MiB por tentativa) — use uma senha mestra longa |
| Senha copiada esquecida | A interface limpa a área de transferência após 30 s |

**Fora do escopo:** malware rodando com o seu usuário (pode ler a memória ou capturar o teclado) e outros processos locais do mesmo usuário que consigam ler o link do terminal.

## Desenvolvimento

```bash
npm test          # testes (node:test)
npm run dev       # interface usando ./dev-vault.json, sem bloqueio automático
```

Estrutura:

```
bin/voltrama-pass.js        entrada do npx
src/crypto.js               scrypt + AES-256-GCM
src/vault.js                arquivo do cofre e operações nos itens
src/generator.js            gerador de senhas
src/importers/bitwarden.js  importação do Bitwarden
src/server.js               servidor HTTP local e API
src/cli.js                  comandos da CLI
public/                     interface web (HTML/CSS/JS puros)
```

## Publicar no npm

```bash
npm login
npm publish
```

Depois disso, qualquer pessoa roda `npx voltrama-pass`.

## Licença

MIT

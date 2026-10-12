// Importa o export JSON *não criptografado* do Bitwarden
// (Bitwarden → Ferramentas → Exportar cofre → formato ".json").
// Tipos suportados: 1 = Login, 2 = Nota segura. Cartões (3) e Identidades (4)
// viram notas para não perder dados.

const TYPE_LOGIN = 1;
const TYPE_NOTE = 2;
const TYPE_CARD = 3;
const TYPE_IDENTITY = 4;

function fieldsToText(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return '';
  return fields.map((f) => `${f.name ?? ''}: ${f.value ?? ''}`).join('\n');
}

function objectToText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

export function parseBitwardenExport(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('Arquivo inválido: não é um JSON.');
  }
  if (data?.encrypted === true) {
    throw new Error('Este export do Bitwarden está criptografado. Exporte novamente no formato ".json" (não o "criptografado").');
  }
  if (!Array.isArray(data?.items)) throw new Error('Não encontrei a lista "items" de um export do Bitwarden.');

  const folders = new Map((data.folders || []).map((f) => [f.id, f.name]));
  const items = [];
  let ignored = 0;

  for (const it of data.items) {
    if (it.deletedDate) {
      ignored++;
      continue;
    }
    const base = {
      name: it.name || '(sem nome)',
      folder: folders.get(it.folderId) || '',
      favorite: Boolean(it.favorite),
      createdAt: it.creationDate || undefined,
    };
    const extra = fieldsToText(it.fields);
    const notesWithExtra = [it.notes || '', extra ? `Campos personalizados:\n${extra}` : ''].filter(Boolean).join('\n\n');

    if (it.type === TYPE_LOGIN) {
      items.push({
        ...base,
        type: 'login',
        username: it.login?.username || '',
        password: it.login?.password || '',
        totp: it.login?.totp || '',
        uris: (it.login?.uris || []).map((u) => u?.uri).filter(Boolean),
        notes: notesWithExtra,
      });
    } else if (it.type === TYPE_NOTE) {
      items.push({ ...base, type: 'note', notes: notesWithExtra });
    } else if (it.type === TYPE_CARD || it.type === TYPE_IDENTITY) {
      const label = it.type === TYPE_CARD ? 'Cartão' : 'Identidade';
      const body = objectToText(it.type === TYPE_CARD ? it.card : it.identity);
      items.push({ ...base, type: 'note', notes: [`[${label} importado do Bitwarden]`, body, notesWithExtra].filter(Boolean).join('\n\n') });
    } else {
      ignored++;
    }
  }
  return { items, ignored };
}

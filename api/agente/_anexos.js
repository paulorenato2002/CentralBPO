// Anexos do agente: o que pode entrar, onde fica e como se confirma.
//
// FLUXO: o navegador pede "preparar" e recebe uma URL assinada do Storage; envia o
// arquivo DIRETO para lá (a Vercel limita o corpo de uma função a 4,5 MB, e o anexo
// pode ter 10); depois pede "confirmar", e aí o servidor baixa o objeto, confere o
// que chegou de verdade (tamanho, conteúdo, hash) e registra o DONO em anexos_agente.
// Arquivo que não passa é apagado do Storage na hora.
//
// As regras de bloqueio de segredo são as do upload antigo do Agente BPO, portadas.
// DIFERENÇA CONHECIDA: o conteúdo só é varrido em arquivo de texto (txt, csv, xml,
// ofx). PDF, planilha e docx não são abertos aqui; para esses vale o bloqueio por
// nome e extensão. O upload antigo extraía o texto deles antes de varrer.
import { createHash, randomUUID } from "node:crypto";

export const BUCKET = process.env.SUPABASE_BUCKET_DOCUMENTOS ?? "documentos-operacionais";
export const MAX_ANEXO_BYTES = 10 * 1024 * 1024; // o n8n aceita 16 MB por chamada e o anexo viaja em base64 (+33%)
export const MAX_ANEXOS_POR_MENSAGEM = 10;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ bloqueios

/** Extensões recusadas sempre: certificado e chave privada não têm por que passar por aqui. */
export const EXTENSOES_BLOQUEADAS = ["pfx", "p12", "pem", "key", "keystore", "jks", "crt", "cer", "der", "asc", "gpg", "kdbx", "ppk"];

/** Nomes que denunciam credencial mesmo com extensão inofensiva. */
const NOMES_BLOQUEADOS = [
  /^client_secret/i, /^service[-_]account/i, /^credentials?\b/i, /^token(s)?\./i, /^\.env/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i, /^\.?htpasswd/i, /^authorized_keys/i, /^known_hosts/i,
];

// Só os padrões ESTRUTURAIS (formato do próprio segredo, quase sem falso positivo).
// Os lexicais ("senha: 123") tarjavam o texto antes de ir ao modelo; aqui o arquivo
// não vai ao modelo, e uma senha de boleto num extrato não pode derrubar o anexo.
const PADROES_ESTRUTURAIS = [
  { nome: "token Bearer", regex: /\bbearer\s+[A-Za-z0-9._~+/-]{10,}=*/i },
  { nome: "chave estilo OpenAI", regex: /sk-[a-zA-Z0-9_-]{16,}/ },
  { nome: "chave privada PEM", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nome: "credencial em URL", regex: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
  { nome: "chave de service account Google", regex: /"private_key_id"\s*:/ },
  { nome: "chave AWS", regex: /\bAKIA[0-9A-Z]{16}\b/ },
];

export const extensaoDe = (nome) => {
  const base = String(nome ?? "").split(/[/\\]/).pop() ?? "";
  const partes = base.split(".");
  return partes.length < 2 ? "" : partes.pop().toLowerCase();
};

export function bloqueadoPorNome(nome) {
  const base = (String(nome ?? "").split(/[/\\]/).pop() ?? "").trim();
  const ext = extensaoDe(base);
  if (ext && EXTENSOES_BLOQUEADAS.includes(ext)) {
    return { bloqueado: true, categoria: "extensao", motivo: `Arquivos .${ext} são certificados ou chaves e nunca são aceitos. O conteúdo não foi lido.` };
  }
  for (const padrao of NOMES_BLOQUEADOS) {
    if (padrao.test(base)) {
      return { bloqueado: true, categoria: "nome", motivo: `O nome "${base}" indica arquivo de credencial. O conteúdo não foi lido.` };
    }
  }
  return { bloqueado: false };
}

/** Nunca devolve o trecho casado: ecoar o segredo na mensagem de erro seria vazá-lo. */
export function bloqueadoPorConteudo(texto) {
  for (const { nome, regex } of PADROES_ESTRUTURAIS) {
    if (regex.test(texto)) {
      return { bloqueado: true, categoria: "conteudo", motivo: `O arquivo aparenta conter ${nome}. Não foi aceito. Remova a credencial e anexe de novo.` };
    }
  }
  return { bloqueado: false };
}

// ------------------------------------------------------------------ tipos e nomes

const MIME = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
  xml: "application/xml",
  ofx: "application/x-ofx",
};
export const EXTENSOES_PERMITIDAS = Object.keys(MIME);
const EXTENSOES_DE_TEXTO = ["txt", "csv", "xml", "ofx"];
const VARREDURA_MAX_BYTES = 2 * 1024 * 1024;

export const mimeDe = (extensao) => MIME[String(extensao ?? "").toLowerCase()] ?? "application/octet-stream";
export const hashSha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Nome que o Storage aceita: sem acento, sem barra, sem ponto na frente. A extensão fica no fim. */
export function nomeSeguro(nome) {
  const base = String(nome ?? "").split(/[/\\]/).pop() ?? "";
  const limpo = base
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_{2,}/g, "_").replace(/^[._]+/, "")
    .slice(-120);
  return limpo || "arquivo";
}

/** O caminho é função do dono, então ninguém confirma nem lê o arquivo de outra pessoa. */
export const caminhoDoAnexo = (usuarioId, arquivoId, nome) => `anexos-agente/${usuarioId}/${arquivoId}/${nomeSeguro(nome)}`;

export function validarEntrada({ nome, tamanho }) {
  const base = (String(nome ?? "").split(/[/\\]/).pop() ?? "").trim();
  if (!base) return { ok: false, status: 400, erro: "Arquivo sem nome." };
  const bloqueio = bloqueadoPorNome(base);
  if (bloqueio.bloqueado) return { ok: false, status: 415, erro: bloqueio.motivo };
  if (!EXTENSOES_PERMITIDAS.includes(extensaoDe(base))) {
    return { ok: false, status: 415, erro: `Tipo de arquivo não aceito: ${base}. Aceitos: ${EXTENSOES_PERMITIDAS.join(", ")}.` };
  }
  if (!(tamanho > 0)) return { ok: false, status: 400, erro: "O arquivo está vazio." };
  if (tamanho > MAX_ANEXO_BYTES) {
    return { ok: false, status: 413, erro: `Arquivo muito grande (máximo ${MAX_ANEXO_BYTES / 1024 / 1024} MB).` };
  }
  return { ok: true };
}

const tamanhoLegivel = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** O que o modelo lê junto com a mensagem: a lista de anexos e os ids que ele deve usar. */
export function blocoDeAnexos(registros) {
  if (!registros.length) return "";
  const linhas = registros.map((r) => {
    const nome = String(r.nome_original ?? "").replace(/\s+/g, " ").slice(0, 120);
    return `- ${nome} (anexo_id: ${r.id}, ${tamanhoLegivel(r.tamanho_bytes)}${r.bloqueado ? ", BLOQUEADO: não pode sair por e-mail" : ""})`;
  });
  return `[Anexos desta mensagem]\n${linhas.join("\n")}\nPara enviar por e-mail, passe os anexo_ids em preparar_email.`;
}

// ------------------------------------------------------------------ preparar e confirmar

let bucketGarantido = null;
async function garantirBucket(admin) {
  if (!bucketGarantido) {
    bucketGarantido = (async () => {
      const { data } = await admin.storage.getBucket(BUCKET);
      if (data) return;
      const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_ANEXO_BYTES });
      if (error && !/already exists/i.test(error.message)) throw new Error(`não consegui criar o armazenamento: ${error.message}`);
    })().catch((e) => {
      bucketGarantido = null;
      throw e;
    });
  }
  await bucketGarantido;
}

/** 1ª etapa: valida pelo nome e pelo tamanho declarado e devolve a URL assinada de upload. */
export async function prepararUpload(admin, usuarioId, corpo) {
  const v = validarEntrada({ nome: corpo.nome, tamanho: Number(corpo.tamanho) });
  if (!v.ok) return v;
  await garantirBucket(admin);
  const arquivoId = randomUUID();
  const caminho = caminhoDoAnexo(usuarioId, arquivoId, corpo.nome);
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error || !data?.token) {
    return { ok: false, status: 500, erro: `Não consegui preparar o envio do arquivo: ${String(error?.message ?? "sem token").slice(0, 150)}` };
  }
  return { ok: true, corpo: { arquivo_id: arquivoId, caminho, token: data.token, bucket: BUCKET } };
}

/** 2ª etapa: confere o que CHEGOU ao Storage e registra o dono. Repetir a chamada não duplica. */
export async function confirmarUpload(admin, usuarioId, corpo) {
  const arquivoId = String(corpo.arquivo_id ?? "");
  if (!UUID.test(arquivoId)) return { ok: false, status: 400, erro: "arquivo_id inválido." };
  const nome = String(corpo.nome ?? "");
  const v = validarEntrada({ nome, tamanho: 1 });
  if (!v.ok) return v;

  const { data: existente } = await admin
    .from("anexos_agente").select("id, nome_original, tamanho_bytes")
    .eq("arquivo_id", arquivoId).eq("usuario_id", usuarioId).maybeSingle();
  if (existente) return { ok: true, corpo: { anexo_id: existente.id, nome: existente.nome_original, tamanho: existente.tamanho_bytes } };

  const caminho = caminhoDoAnexo(usuarioId, arquivoId, nome);
  const { data: blob, error } = await admin.storage.from(BUCKET).download(caminho);
  if (error || !blob) return { ok: false, status: 404, erro: "O arquivo não chegou ao armazenamento. Tente anexar de novo." };

  const recusar = async (status, erro) => {
    await admin.storage.from(BUCKET).remove([caminho]); // arquivo que não passa não fica no Storage
    return { ok: false, status, erro };
  };

  const buffer = Buffer.from(await blob.arrayBuffer());
  const tamanho = buffer.length;
  if (!tamanho) return recusar(400, "O arquivo está vazio.");
  if (tamanho > MAX_ANEXO_BYTES) return recusar(413, `Arquivo muito grande (máximo ${MAX_ANEXO_BYTES / 1024 / 1024} MB).`);

  const ext = extensaoDe(nome);
  if (EXTENSOES_DE_TEXTO.includes(ext)) {
    const b = bloqueadoPorConteudo(buffer.subarray(0, VARREDURA_MAX_BYTES).toString("utf8"));
    if (b.bloqueado) return recusar(422, b.motivo);
  }

  const { data, error: erroInsert } = await admin
    .from("anexos_agente")
    .insert({
      arquivo_id: arquivoId, usuario_id: usuarioId, conversa_id: null, nome_original: nome, extensao: ext,
      mime_type: corpo.mime || mimeDe(ext), tamanho_bytes: tamanho, hash_sha256: hashSha256(buffer),
      bloqueado: false, motivo_bloqueio: null,
    })
    .select("id").single();
  if (erroInsert) return { ok: false, status: 500, erro: `Não consegui registrar o anexo: ${String(erroInsert.message).slice(0, 150)}` };
  return { ok: true, corpo: { anexo_id: data.id, nome, tamanho } };
}

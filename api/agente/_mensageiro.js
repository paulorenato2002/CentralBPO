// Monta, valida e entrega o e-mail. Porta do mensageiro Python do Agente BPO:
// a Vercel não roda Python, e o n8n é só um POST autenticado.
//
// O n8n guarda a credencial do Gmail; daqui sai o e-mail pronto e nada mais.
// Nenhuma função aqui lê variável de ambiente por conta própria: tudo entra por
// "env", para os testes rodarem sem rede e sem segredo.

const RE_CAMPO = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const RE_NEGRITO = /\*\*(.+?)\*\*/g;
const RE_EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const TINTA = "#16202b";
const PAPEL = "#f5f7f9";
const AZUL_LOGO = "#204e8a";

export const MAX_DESTINATARIOS = 50;
const TIMEOUT_MS = 60_000;

export function esc(texto, aspas = true) {
  let t = String(texto ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (aspas) t = t.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  return t;
}

/** Troca os campos {{assim}}. Devolve [texto, camposSemValor]. Campo sem valor fica como está. */
export function preencher(texto, dados) {
  const valores = {};
  for (const [k, v] of Object.entries(dados ?? {})) valores[String(k).toLowerCase()] = v == null ? "" : String(v);
  const faltando = [];
  const final = String(texto ?? "").replace(RE_CAMPO, (inteiro, nome) => {
    const n = nome.toLowerCase();
    const valor = (valores[n] ?? "").trim();
    if (!valor) {
      if (!faltando.includes(n)) faltando.push(n);
      return inteiro;
    }
    return valor;
  });
  return [final, faltando];
}

const inline = (texto) => esc(texto, false).replace(RE_NEGRITO, "<strong>$1</strong>");

/** Parágrafos, listas e negrito. Todo o texto é escapado antes: o que a pessoa digita nunca vira HTML. */
export function corpoParaHtml(corpo) {
  const blocos = [];
  for (const bloco of String(corpo ?? "").trim().split(/\n\s*\n/)) {
    const linhas = bloco.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!linhas.length) continue;
    const itens = linhas.filter((l) => l.trimStart().startsWith("- "));
    if (itens.length && itens.length === linhas.length) {
      const lis = linhas.map((l) => `<li style="margin:0 0 6px">${inline(l.trimStart().slice(2))}</li>`).join("");
      blocos.push(`<ul style="margin:0 0 16px;padding-left:20px">${lis}</ul>`);
    } else {
      const partes = linhas.map((l) => (l.trimStart().startsWith("- ") ? "&bull; " + inline(l.trimStart().slice(2)) : inline(l)));
      blocos.push(`<p style="margin:0 0 16px">${partes.join("<br>")}</p>`);
    }
  }
  return blocos.join("");
}

export const corpoParaTexto = (corpo) => String(corpo ?? "").trim().replace(RE_NEGRITO, "$1");

/**
 * Logo da Effective sobre fundo branco. O Gmail não mostra imagem em base64,
 * então o logo vem de um endereço público (MENSAGEIRO_LOGO_URL). Sem a
 * variável, fica o nome em texto.
 */
function cabecalho(env) {
  const logo = String(env.MENSAGEIRO_LOGO_URL ?? "").trim();
  const miolo = logo
    ? `<img src="${esc(logo)}" alt="Effective Assessoria" height="72" style="display:block;margin:0 auto;height:72px;width:auto;border:0">`
    : `<span style="font-family:Archivo,Arial,sans-serif;font-size:18px;font-weight:bold;color:${AZUL_LOGO}">Effective Assessoria</span>`;
  return (
    `<tr><td align="center" style="background:#ffffff;padding:20px 28px 16px;text-align:center">${miolo}</td></tr>` +
    `<tr><td style="height:4px;background:${AZUL_LOGO};line-height:4px;font-size:0">&nbsp;</td></tr>`
  );
}

/** Moldura da Effective: tabela simples com CSS em linha, que é o que o Gmail respeita. */
function layout(conteudoHtml, assunto, env) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(assunto)}</title></head>
<body style="margin:0;padding:0;background:${PAPEL}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPEL};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden">
${cabecalho(env)}
<tr><td style="padding:28px;font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:${TINTA}">${conteudoHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e3e8ee;font-family:Arial,sans-serif;font-size:12px;color:#5b6773">Effective Assessoria · BPO Financeiro · effective.bpo@gmail.com</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Assunto e corpo preenchidos, em HTML e texto, e o que ficou sem valor. */
export function montar(assunto, corpo, dados, env = {}) {
  const [assuntoFinal, faltouAssunto] = preencher(assunto, dados);
  const [corpoFinal, faltouCorpo] = preencher(corpo, dados);
  return {
    assunto: assuntoFinal.split(/\s+/).filter(Boolean).join(" "),
    html: layout(corpoParaHtml(corpoFinal), assuntoFinal, env),
    texto: corpoParaTexto(corpoFinal) + "\n\n--\nEffective Assessoria · BPO Financeiro",
    faltando: [...new Set([...faltouAssunto, ...faltouCorpo])],
  };
}

/**
 * Normaliza Para, Cc e Cco. O mesmo endereço em mais de uma lista fica só na
 * primeira (para > cc > cco): ninguém recebe duas cópias, e ninguém em cópia
 * oculta aparece por engano.
 */
export function limparDestinatarios(para, cc, cco) {
  const erros = [];
  const avisos = [];
  const vistos = new Set();
  const listas = {};
  for (const [nome, bruto] of [["para", para], ["cc", cc], ["cco", cco]]) {
    const saida = [];
    const itens = Array.isArray(bruto) ? bruto : String(bruto ?? "").split(/[;,\s]+/);
    for (const item of itens) {
      const e = String(item ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
      if (!e) continue;
      if (!RE_EMAIL.test(e)) { erros.push(`Endereço inválido em ${nome}: ${e}`); continue; }
      if (vistos.has(e)) { avisos.push(`${e} repetido: fica só na primeira lista em que aparece.`); continue; }
      vistos.add(e);
      saida.push(e);
    }
    listas[nome] = saida;
  }
  if (!listas.para.length) erros.push("Informe pelo menos um destinatário em Para.");
  if (vistos.size > MAX_DESTINATARIOS) erros.push(`Máximo de ${MAX_DESTINATARIOS} destinatários por envio.`);
  return { listas, erros, avisos };
}

/** POST no webhook do n8n. Devolve { ok, mensagem_id } ou { ok: false, erros, incerto? }. */
export async function entregarAoN8n(pacote, { fetchImpl = fetch, env = {} } = {}) {
  const url = String(env.N8N_EMAIL_ENVIO_URL ?? "").trim();
  const segredo = String(env.N8N_EMAIL_ENVIO_SECRET ?? "").trim();
  if (!url || segredo.length < 32) {
    return { ok: false, erros: ["Envio não configurado: defina N8N_EMAIL_ENVIO_URL e N8N_EMAIL_ENVIO_SECRET (32+ caracteres) no servidor."] };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${segredo}` },
      body: JSON.stringify(pacote),
      signal: controle.signal,
    });
  } catch (e) {
    const motivo = e?.name === "AbortError" ? "tempo esgotado" : e?.message ?? String(e);
    return {
      ok: false,
      incerto: true,
      erros: [`Sem resposta do n8n: ${motivo}. O e-mail pode não ter saído; confira a caixa de enviados antes de tentar de novo.`],
    };
  } finally {
    clearTimeout(relogio);
  }

  const corpo = await r.text().catch(() => "");
  if (!r.ok) return { ok: false, erros: [`O n8n recusou o envio (HTTP ${r.status}): ${corpo.slice(0, 300)}`] };

  let resposta;
  try {
    resposta = JSON.parse(corpo || "{}");
  } catch {
    return { ok: false, incerto: true, erros: [`Resposta ilegível do n8n: ${corpo.slice(0, 200)}`] };
  }
  if (!resposta.ok || !resposta.mensagemId) {
    return { ok: false, incerto: true, erros: [`O n8n não confirmou o envio: ${JSON.stringify(resposta).slice(0, 300)}`] };
  }
  return { ok: true, mensagem_id: String(resposta.mensagemId) };
}

/**
 * Entrada única. acao "previa" monta e valida; acao "enviar" faz o mesmo e entrega.
 * No envio de algo já aprovado, o HTML e o texto da prévia vão como estão: sem remontar.
 */
export async function mensageiro(pedido, opcoes = {}) {
  const enviar = pedido.acao === "enviar";
  const assunto = String(pedido.assunto ?? "").trim();
  if (!assunto || !String(pedido.corpo ?? pedido.html ?? "").trim()) {
    return { ok: false, erros: ["Assunto e corpo são obrigatórios."] };
  }

  const email =
    enviar && pedido.html && pedido.texto
      ? { assunto, html: String(pedido.html), texto: String(pedido.texto), faltando: [] }
      : montar(assunto, String(pedido.corpo ?? ""), pedido.dados ?? {}, opcoes.env ?? {});

  const { listas, erros, avisos } = limparDestinatarios(pedido.para, pedido.cc, pedido.cco);
  const todos = [...erros];
  if (email.faltando.length) todos.push(`Faltam valores para: ${email.faltando.map((f) => `{{${f}}}`).join(", ")}.`);

  const resposta = { ok: !todos.length, erros: todos, avisos, assunto: email.assunto, html: email.html, texto: email.texto, ...listas };
  if (todos.length || !enviar) return resposta;

  const entrega = await entregarAoN8n(
    {
      versao: 1,
      envioId: String(pedido.envio_id ?? ""),
      para: listas.para,
      cc: listas.cc,
      cco: listas.cco,
      assunto: email.assunto,
      html: email.html,
      texto: email.texto,
      anexos: [],
    },
    opcoes
  );
  const { html: _html, ...semHtml } = resposta;
  return { ...semHtml, ...entrega, ok: !!entrega.ok, erros: entrega.erros ?? [] };
}

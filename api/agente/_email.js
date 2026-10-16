// Fluxo do e-mail do agente: modelo → prévia → confirmação → envio.
//
// A prévia fica gravada como rascunho. O envio só acontece depois que a PESSOA
// escreveu na conversa depois da prévia: é trava do servidor, não do modelo,
// porque um e-mail em nome da Effective não tem volta.
//
// Tudo que toca fora (banco e n8n) entra pelas "portas", para os testes
// rodarem sem rede. Anexo ainda não existe aqui: entra junto com o upload.

const RE_CAMPO = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function camposDe(...textos) {
  const vistos = [];
  for (const t of textos) {
    for (const m of String(t ?? "").matchAll(RE_CAMPO)) {
      const nome = m[1].toLowerCase();
      if (!vistos.includes(nome)) vistos.push(nome);
    }
  }
  return vistos;
}

const unir = (base, extra) =>
  [...new Set([...base, ...(extra ?? [])].map((e) => String(e).trim().toLowerCase()).filter(Boolean))];

// ------------------------------------------------------------------ modelos

export async function salvarModelo(e, usuarioId, portas) {
  const codigo = String(e.codigo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
  if (codigo.length < 3) return { ok: false, erro: "Código do modelo muito curto (mínimo 3 letras)." };

  const nome = String(e.nome ?? "").trim();
  const assunto = String(e.assunto ?? "").trim();
  const corpo = String(e.corpo ?? "").trim();
  if (!nome || !assunto || !corpo) return { ok: false, erro: "Informe nome, assunto e corpo do modelo." };

  const campos = camposDe(assunto, corpo);
  const r = await portas.gravarModelo(
    {
      codigo, nome, empresa_id: e.empresaId ?? null, assunto, corpo, campos,
      para: unir([], e.para), cc: unir([], e.cc), cco: unir([], e.cco),
      observacoes: e.observacoes ?? null,
    },
    usuarioId
  );
  if (r.erro) return { ok: false, erro: r.erro };
  return { ok: true, codigo, id: r.id, novo: r.novo, campos };
}

// ------------------------------------------------------------------ prévia

export async function prepararEnvio(e, ctx, portas) {
  let modelo = null;
  if (e.modeloCodigo) {
    modelo = await portas.buscarModelo(String(e.modeloCodigo).trim().toUpperCase());
    if (!modelo) return { ok: false, erro: `Modelo ${e.modeloCodigo} não encontrado.`, codigo: "modelo_inexistente" };
  }
  const assunto = String(e.assunto ?? "").trim() || modelo?.assunto || "";
  const corpo = String(e.corpo ?? "").trim() || modelo?.corpo || "";
  if (!assunto || !corpo) {
    return { ok: false, erro: "Informe um modelo ou o assunto e o corpo do e-mail.", codigo: "sem_conteudo" };
  }

  const r = await portas.mensageiro({
    acao: "previa", assunto, corpo, dados: e.dados ?? {},
    para: unir(modelo?.para ?? [], e.para), cc: unir(modelo?.cc ?? [], e.cc), cco: unir(modelo?.cco ?? [], e.cco),
  });
  if (!r.ok || !r.html || !r.texto || !r.assunto) {
    return { ok: false, erro: (r.erros ?? []).join(" ") || "O e-mail não foi montado.", codigo: "previa_recusada" };
  }

  const destinatarios = { para: r.para ?? [], cc: r.cc ?? [], cco: r.cco ?? [] };
  const { id } = await portas.criarRascunho({
    modelo_id: modelo?.id ?? null,
    empresa_id: e.empresaId ?? modelo?.empresa_id ?? null,
    conversa_id: ctx.conversaId,
    solicitante_id: ctx.usuarioId,
    ...destinatarios,
    assunto: r.assunto,
    corpo_html: r.html,
    corpo_texto: r.texto,
    anexos: [],
  });
  return { ok: true, previa: { envioId: id, assunto: r.assunto, texto: r.texto, avisos: r.avisos ?? [], ...destinatarios } };
}

// ------------------------------------------------------------------ envio

export async function enviarEnvio(envioId, ctx, portas) {
  const envio = await portas.buscarEnvio(envioId);
  if (!envio || envio.solicitante_id !== ctx.usuarioId) {
    return { ok: false, erro: "E-mail preparado não encontrado.", codigo: "envio_inexistente" };
  }
  if (envio.status !== "rascunho") {
    return { ok: false, erro: `Este e-mail já está "${envio.status}". Nada foi reenviado.`, codigo: "envio_nao_rascunho" };
  }
  if (!ctx.conversaId || envio.conversa_id !== ctx.conversaId) {
    return { ok: false, erro: "O envio precisa ser confirmado na mesma conversa da prévia.", codigo: "outra_conversa" };
  }
  if (!(await portas.usuarioFalouDepois(ctx.conversaId, envio.created_at))) {
    return {
      ok: false,
      erro: "Mostre a prévia à pessoa e espere ela confirmar o envio numa nova mensagem. Nada foi enviado.",
      codigo: "sem_confirmacao",
    };
  }
  // rascunho → enviando, atômico: dois pedidos ao mesmo tempo não enviam duas vezes.
  if (!(await portas.marcarEnviando(envio.id, ctx.usuarioId))) {
    return { ok: false, erro: "Este e-mail já está sendo enviado. Nada foi reenviado.", codigo: "envio_em_andamento" };
  }

  const r = await portas.mensageiro({
    acao: "enviar", envio_id: envio.id, assunto: envio.assunto, html: envio.corpo_html, texto: envio.corpo_texto,
    para: envio.para, cc: envio.cc, cco: envio.cco,
  });
  if (!r.ok || !r.mensagem_id) {
    const erro = (r.erros ?? []).join(" ") || "Falha no envio.";
    await portas.concluir(envio.id, { status: "erro", erro });
    return { ok: false, erro, codigo: r.incerto ? "envio_incerto" : "envio_falhou" };
  }
  await portas.concluir(envio.id, { status: "enviado", mensagemId: r.mensagem_id });
  return { ok: true, mensagemId: r.mensagem_id, para: envio.para, assunto: envio.assunto };
}

// Testes do e-mail do agente: montagem, entrega ao n8n e as travas de confirmação.
// Sem rede, sem OpenAI, sem n8n e sem Supabase: roda com `npm run test:agente`.
import test from "node:test";
import assert from "node:assert/strict";
import { mensageiro, montar, preencher, limparDestinatarios, entregarAoN8n } from "../api/agente/_mensageiro.js";
import { salvarModelo, prepararEnvio, enviarEnvio } from "../api/agente/_email.js";
import { executar } from "../api/agente/_ferramentas.js";

const ENV_OK = { N8N_EMAIL_ENVIO_URL: "https://n8n.exemplo/webhook/x", N8N_EMAIL_ENVIO_SECRET: "s".repeat(40) };
const USUARIO = "u-1";
const CONVERSA = "c-1";

const respostaOk = () => new Response(JSON.stringify({ ok: true, mensagemId: "m-1" }), { status: 200 });

// fetch de mentira: guarda cada chamada e devolve a resposta (ou lança o erro) combinada
function fakeFetch(resposta = respostaOk) {
  const fn = async (url, opts) => {
    fn.chamadas.push({ url, headers: opts.headers, corpo: JSON.parse(opts.body) });
    if (resposta instanceof Error) throw resposta;
    return resposta();
  };
  fn.chamadas = [];
  return fn;
}

// Portas em memória, com relógio próprio para provar a ordem "prévia → pessoa fala → envio".
function fakePortas({ modelos = [], fetchImpl = fakeFetch(), env = ENV_OK, gravarModelo } = {}) {
  const envios = new Map();
  const mensagens = [];
  const eventos = [];
  let relogio = 0;
  return {
    modelos, envios, fetchImpl, eventos,
    async buscarModelo(codigo) { return modelos.find((m) => m.codigo === codigo) ?? null; },
    async listarModelos() { return modelos; },
    async gravarModelo(linha, uid) {
      if (gravarModelo) return gravarModelo(linha, uid);
      const existente = modelos.find((m) => m.codigo === linha.codigo);
      if (existente) { Object.assign(existente, linha); return { id: existente.id, novo: false }; }
      const m = { id: `mod-${modelos.length + 1}`, ...linha };
      modelos.push(m);
      return { id: m.id, novo: true };
    },
    async criarRascunho(linha) {
      const id = `env-${envios.size + 1}`;
      envios.set(id, { id, status: "rascunho", created_at: ++relogio, ...linha });
      return { id };
    },
    async buscarEnvio(id) { return envios.get(id) ?? null; },
    async usuarioFalouDepois(conversaId, instante) {
      return mensagens.some((m) => m.conversa === conversaId && m.papel === "usuario" && m.t > instante);
    },
    async marcarEnviando(id, uid) {
      const e = envios.get(id);
      if (!e || e.status !== "rascunho" || e.solicitante_id !== uid) return false;
      e.status = "enviando";
      return true;
    },
    async concluir(id, d) { Object.assign(envios.get(id), { status: d.status, erro: d.erro, mensagemId: d.mensagemId }); eventos.push(d.status); },
    mensageiro: (pedido) => mensageiro(pedido, { fetchImpl, env }),
    pessoaEscreve(conversa = CONVERSA) { mensagens.push({ conversa, papel: "usuario", t: ++relogio }); },
  };
}

const MODELO = {
  id: "mod-0", codigo: "TL_LUCROS", nome: "TL — Lucros", empresa_id: null,
  assunto: "Distribuição de lucros — {{competencia}}",
  corpo: "Olá, {{nome}}!\n\nSegue o comunicado de **{{competencia}}**.\n\n- Lucros: **{{valor}}**",
  campos: ["competencia", "nome", "valor"], para: ["socio@x.com"], cc: [], cco: ["effective.bpo@gmail.com"],
};
const DADOS = { competencia: "08/2026", nome: "Sócios", valor: "R$ 1.000,00" };
const ctx = { usuarioId: USUARIO, conversaId: CONVERSA };

async function preparado(portas, extra = {}) {
  const r = await prepararEnvio({ modeloCodigo: "TL_LUCROS", dados: DADOS, para: [], cc: [], cco: [], ...extra }, ctx, portas);
  assert.equal(r.ok, true, r.erro);
  return r.previa;
}

// ------------------------------------------------------------------ montagem

test("preencher troca os campos e aponta os que faltam", () => {
  const [texto, faltando] = preencher("Olá {{nome}}, {{Valor}} e {{outro}}", { nome: "Ana", valor: " R$ 10,00 " });
  assert.equal(texto, "Olá Ana, R$ 10,00 e {{outro}}");
  assert.deepEqual(faltando, ["outro"]);
});

test("montar escapa HTML, aplica negrito e lista e traz a moldura da Effective", () => {
  const m = montar("Assunto   {{x}}", "Olá <script>\n\n**Total:** {{x}}\n\n- um\n- dois", { x: "R$ 5" });
  assert.equal(m.assunto, "Assunto R$ 5");
  assert.ok(m.html.includes("Olá &lt;script&gt;"), "o texto digitado não pode virar HTML");
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.html.includes("<strong>Total:</strong> R$ 5"));
  assert.ok(m.html.includes("<ul"));
  assert.ok(m.html.includes("Effective Assessoria"));
  assert.match(m.texto, /Total: R\$ 5/);
  assert.deepEqual(m.faltando, []);
});

test("o logo vem da variável e é escapado; sem ela, sai o nome em texto", () => {
  const com = montar("a", "b", {}, { MENSAGEIRO_LOGO_URL: 'https://x.com/l.png?a="1"' });
  assert.ok(com.html.includes('src="https://x.com/l.png?a=&quot;1&quot;"'));
  assert.ok(!montar("a", "b", {}, {}).html.includes("<img"));
});

test("destinatários: normaliza, tira repetido entre listas e valida", () => {
  const { listas, erros, avisos } = limparDestinatarios("A@x.com; b@x.com", ["a@x.com", "C@x.com"], "ruim, d@x.com");
  assert.deepEqual(listas.para, ["a@x.com", "b@x.com"]);
  assert.deepEqual(listas.cc, ["c@x.com"]);
  assert.deepEqual(listas.cco, ["d@x.com"]);
  assert.equal(avisos.length, 1);
  assert.ok(erros.some((e) => /ruim/.test(e)));
});

test("destinatários: exige Para e limita a 50", () => {
  assert.ok(limparDestinatarios([], [], []).erros.some((e) => /Para/.test(e)));
  const muitos = Array.from({ length: 51 }, (_, i) => `u${i}@x.com`);
  assert.ok(limparDestinatarios(muitos, [], []).erros.some((e) => /50/.test(e)));
});

// ------------------------------------------------------------------ n8n

test("n8n: sem configuração não tenta enviar", async () => {
  const f = fakeFetch();
  const r = await entregarAoN8n({}, { fetchImpl: f, env: {} });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /não configurado/);
  assert.equal(f.chamadas.length, 0);
});

test("n8n: envia com o segredo no cabeçalho e devolve o id da mensagem", async () => {
  const f = fakeFetch();
  const r = await entregarAoN8n({ versao: 1 }, { fetchImpl: f, env: ENV_OK });
  assert.deepEqual(r, { ok: true, mensagem_id: "m-1" });
  assert.equal(f.chamadas[0].headers.Authorization, `Bearer ${"s".repeat(40)}`);
});

test("n8n: recusa conhecida não é incerta; queda de rede e resposta ruim são", async () => {
  const recusa = await entregarAoN8n({}, { fetchImpl: fakeFetch(() => new Response("negado", { status: 403 })), env: ENV_OK });
  assert.equal(recusa.ok, false);
  assert.ok(!recusa.incerto);
  const queda = await entregarAoN8n({}, { fetchImpl: fakeFetch(new Error("rede caiu")), env: ENV_OK });
  assert.equal(queda.incerto, true);
  const lixo = await entregarAoN8n({}, { fetchImpl: fakeFetch(() => new Response("não é json", { status: 200 })), env: ENV_OK });
  assert.equal(lixo.incerto, true);
  const semId = await entregarAoN8n({}, { fetchImpl: fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 })), env: ENV_OK });
  assert.equal(semId.incerto, true);
});

test("mensageiro: no envio, o HTML aprovado na prévia vai como está, sem remontar", async () => {
  const f = fakeFetch();
  await mensageiro(
    { acao: "enviar", envio_id: "e1", assunto: "A", html: "<p>PRONTO</p>", texto: "t", para: ["a@x.com"] },
    { fetchImpl: f, env: ENV_OK }
  );
  assert.equal(f.chamadas[0].corpo.html, "<p>PRONTO</p>");
  assert.equal(f.chamadas[0].corpo.versao, 1);
  assert.deepEqual(f.chamadas[0].corpo.anexos, []);
});

// ------------------------------------------------------------------ modelos

test("salvar modelo: normaliza o código, acha os campos e junta destinatários sem repetir", async () => {
  const portas = fakePortas();
  const r = await salvarModelo(
    { codigo: "Distribuição de lucros", nome: "n", assunto: "Lucros {{competencia}}", corpo: "Oi {{nome}} {{competencia}}",
      para: ["A@x.com", "a@x.com"], cc: [], cco: [] },
    USUARIO, portas
  );
  assert.equal(r.ok, true);
  assert.equal(r.codigo, "DISTRIBUICAO_DE_LUCROS");
  assert.deepEqual(r.campos, ["competencia", "nome"]);
  assert.deepEqual(portas.modelos[0].para, ["a@x.com"]);
});

test("salvar modelo: código curto, campos vazios e modelo de outra pessoa são recusados", async () => {
  const portas = fakePortas({ gravarModelo: async () => ({ erro: "O modelo é de outra pessoa." }) });
  assert.ok(!(await salvarModelo({ codigo: "ab", nome: "n", assunto: "a", corpo: "b" }, USUARIO, portas)).ok);
  assert.ok(!(await salvarModelo({ codigo: "ABC", nome: "", assunto: "a", corpo: "b" }, USUARIO, portas)).ok);
  const alheio = await salvarModelo({ codigo: "ABC", nome: "n", assunto: "a", corpo: "b" }, USUARIO, portas);
  assert.equal(alheio.ok, false);
  assert.match(alheio.erro, /outra pessoa/);
});

// ------------------------------------------------------------------ prévia e envio

test("a prévia usa o modelo, junta os destinatários do modelo e NÃO envia", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const p = await preparado(portas, { para: ["extra@x.com"] });
  assert.deepEqual(p.para, ["socio@x.com", "extra@x.com"]);
  assert.deepEqual(p.cco, ["effective.bpo@gmail.com"]);
  assert.equal(p.assunto, "Distribuição de lucros — 08/2026");
  assert.equal(portas.fetchImpl.chamadas.length, 0, "preparar não pode chamar o n8n");
  assert.equal(portas.envios.get(p.envioId).status, "rascunho");
});

test("campo do modelo sem valor impede a prévia e nada é gravado", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const r = await prepararEnvio({ modeloCodigo: "TL_LUCROS", dados: { competencia: "08/2026" }, para: [], cc: [], cco: [] }, ctx, portas);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "previa_recusada");
  assert.match(r.erro, /\{\{nome\}\}/);
  assert.equal(portas.envios.size, 0);
});

test("modelo inexistente e e-mail sem conteúdo são recusados", async () => {
  const portas = fakePortas();
  assert.equal((await prepararEnvio({ modeloCodigo: "NAO_EXISTE", dados: {}, para: [], cc: [], cco: [] }, ctx, portas)).codigo, "modelo_inexistente");
  assert.equal((await prepararEnvio({ dados: {}, para: ["a@x.com"], cc: [], cco: [] }, ctx, portas)).codigo, "sem_conteudo");
});

test("ENVIO: sem a pessoa falar depois da prévia, nada sai", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const p = await preparado(portas);
  const r = await enviarEnvio(p.envioId, ctx, portas);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "sem_confirmacao");
  assert.equal(portas.fetchImpl.chamadas.length, 0);
  assert.equal(portas.envios.get(p.envioId).status, "rascunho", "o rascunho continua esperando");
});

test("ENVIO: com a confirmação da pessoa, sai uma vez, com o HTML da prévia e Cco", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const p = await preparado(portas);
  const htmlDaPrevia = portas.envios.get(p.envioId).corpo_html;
  portas.pessoaEscreve();
  const r = await enviarEnvio(p.envioId, ctx, portas);
  assert.equal(r.ok, true);
  assert.equal(r.mensagemId, "m-1");
  const corpo = portas.fetchImpl.chamadas[0].corpo;
  assert.equal(portas.fetchImpl.chamadas.length, 1);
  assert.equal(corpo.html, htmlDaPrevia);
  assert.deepEqual(corpo.cco, ["effective.bpo@gmail.com"]);
  assert.equal(corpo.envioId, p.envioId);
  assert.equal(portas.envios.get(p.envioId).status, "enviado");
});

test("ENVIO: repetir o pedido depois de enviado não manda de novo", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const p = await preparado(portas);
  portas.pessoaEscreve();
  await enviarEnvio(p.envioId, ctx, portas);
  const de_novo = await enviarEnvio(p.envioId, ctx, portas);
  assert.equal(de_novo.codigo, "envio_nao_rascunho");
  assert.equal(portas.fetchImpl.chamadas.length, 1);
});

test("ENVIO: dois pedidos ao mesmo tempo, só um passa", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const p = await preparado(portas);
  portas.pessoaEscreve();
  const [a, b] = await Promise.all([enviarEnvio(p.envioId, ctx, portas), enviarEnvio(p.envioId, ctx, portas)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(portas.fetchImpl.chamadas.length, 1);
});

test("ENVIO: outra pessoa ou outra conversa não aproveitam o rascunho", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const p = await preparado(portas);
  portas.pessoaEscreve();
  assert.equal((await enviarEnvio(p.envioId, { usuarioId: "u-2", conversaId: CONVERSA }, portas)).codigo, "envio_inexistente");
  assert.equal((await enviarEnvio(p.envioId, { usuarioId: USUARIO, conversaId: "c-2" }, portas)).codigo, "outra_conversa");
  assert.equal(portas.fetchImpl.chamadas.length, 0);
});

test("ENVIO: n8n recusou fica como erro; queda de rede avisa para conferir os enviados", async () => {
  const recusa = fakePortas({ modelos: [{ ...MODELO }], fetchImpl: fakeFetch(() => new Response("negado", { status: 500 })) });
  const p1 = await preparado(recusa);
  recusa.pessoaEscreve();
  const r1 = await enviarEnvio(p1.envioId, ctx, recusa);
  assert.equal(r1.codigo, "envio_falhou");
  assert.equal(recusa.envios.get(p1.envioId).status, "erro");

  const queda = fakePortas({ modelos: [{ ...MODELO }], fetchImpl: fakeFetch(new Error("rede")) });
  const p2 = await preparado(queda);
  queda.pessoaEscreve();
  const r2 = await enviarEnvio(p2.envioId, ctx, queda);
  assert.equal(r2.codigo, "envio_incerto");
  assert.equal(queda.envios.get(p2.envioId).status, "erro");
});

// ------------------------------------------------------------------ pelas ferramentas do agente

test("ferramentas: preparar_email devolve a prévia e enviar_email segue a mesma trava", async () => {
  const portas = fakePortas({ modelos: [{ ...MODELO }] });
  const c = { hoje: "2026-10-16", usuarioId: USUARIO, conversaId: CONVERSA, emailPortas: portas };

  const prev = await executar("preparar_email", { modelo_codigo: "TL_LUCROS", dados: DADOS }, null, c);
  assert.equal(prev.precisa_confirmar, true);
  assert.ok(prev.previa.envio_id);
  assert.match(prev.previa.texto, /R\$ 1\.000,00/);

  const cedo = await executar("enviar_email", { envio_id: prev.previa.envio_id }, null, c);
  assert.equal(cedo.codigo, "sem_confirmacao");

  portas.pessoaEscreve();
  const ok = await executar("enviar_email", { envio_id: prev.previa.envio_id }, null, c);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.enviado_para, ["socio@x.com"]);
});

test("ferramentas: sem chave de serviço o e-mail avisa e não quebra; erro interno não derruba a conversa", async () => {
  const semPortas = await executar("preparar_email", { assunto: "a", corpo: "b" }, null, { hoje: "x", usuarioId: USUARIO, conversaId: CONVERSA, emailPortas: null });
  assert.match(semPortas.erro, /não está disponível/);

  const quebrada = fakePortas();
  quebrada.listarModelos = async () => { throw new Error("banco fora do ar"); };
  const r = await executar("listar_modelos_email", {}, null, { hoje: "x", usuarioId: USUARIO, conversaId: CONVERSA, emailPortas: quebrada });
  assert.match(r.erro, /banco fora do ar/);
});

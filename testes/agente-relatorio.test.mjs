// Testes do relatório diário. Sem rede, sem OpenAI, sem n8n e sem Supabase: `npm run test:agente`.
import test from "node:test";
import assert from "node:assert/strict";
import { mensageiro } from "../api/agente/_mensageiro.js";
import { executar } from "../api/agente/_ferramentas.js";
import { montarRelatorio, hojeEmSaoPaulo, marcarAnotacoesDoRelatorio } from "../api/agente/_relatorio.js";

const DIA = "2026-10-16";
const CONVERSA = "c-1";
const ENV_OK = { N8N_EMAIL_ENVIO_URL: "https://n8n.exemplo/webhook/x", N8N_EMAIL_ENVIO_SECRET: "s".repeat(40) };

const RESUMO = [
  { empresa_id: "e2", codigo: "141", nome: "Rezende", abertas_no_dia: 0, concluidas_no_dia: 0, atrasadas: 0, maior_atraso_dias: 0, pendentes_por_tipo: {}, concluidas_por: {} },
  { empresa_id: "e1", codigo: "601", nome: "L2H", abertas_no_dia: 8, concluidas_no_dia: 3, atrasadas: 5, maior_atraso_dias: 1, pendentes_por_tipo: { diaria: 2, semanal: 1, mensal: 0 }, concluidas_por: { Ana: 2, Eva: 1 } },
];
const EQUIPE = [
  { usuario_id: "u-ana", nome: "Ana", email: "ana@x.com", papel: "analista", ativo: true },
  { usuario_id: "u-bia", nome: "Bia", email: "bia@x.com", papel: "supervisor", ativo: true },
  { usuario_id: "u-eva", nome: "Eva", email: "eva@x.com", papel: "estagiaria", ativo: false },
];
const NOTAS = [
  { id: "n1", empresa_id: "e1", usuario_id: "u-ana", dia: DIA, texto: "Boleto do aluguel não chegou", para: null, verificada_em: null, enviada_em: null },
  { id: "n2", empresa_id: "e1", usuario_id: "u-bia", dia: "2026-10-14", texto: "Conferir  {{valor}} com **cliente**\ne o extrato", para: ["u-ana"], verificada_em: null, enviada_em: null },
  { id: "n3", empresa_id: "e1", usuario_id: "u-ana", dia: "2026-10-14", texto: "Já resolvido", para: null, verificada_em: "2026-10-15T10:00:00Z", enviada_em: null },
  { id: "n4", empresa_id: "e2", usuario_id: "u-ana", dia: DIA, texto: "Já saiu no relatório das 12h30", para: null, verificada_em: null, enviada_em: "2026-10-16T15:30:00Z" },
  { id: "n5", empresa_id: "e9", usuario_id: "u-ana", dia: DIA, texto: "Cliente fora do resumo", para: null, verificada_em: null, enviada_em: null },
];
const nomeDe = (id) => ({ "u-ana": "Ana", "u-bia": "Bia" })[id] ?? "—";

function fakeFetch(resposta = () => new Response(JSON.stringify({ ok: true, mensagemId: "m-1" }), { status: 200 })) {
  const fn = async (url, opts) => { fn.chamadas.push(JSON.parse(opts.body)); return resposta(); };
  fn.chamadas = [];
  return fn;
}

function fakeSb({ resumo = RESUMO, notas = NOTAS, equipe = EQUIPE, erroResumo = null } = {}) {
  const chamadas = [];
  const tabelas = { central_anotacoes: notas, central_vw_equipe: equipe };
  const from = (nome) => {
    const filtros = [];
    const q = {
      select: () => q,
      eq: (c, v) => (filtros.push((r) => r[c] === v), q),
      is: (c, v) => (filtros.push((r) => (r[c] ?? null) === v), q),
      order: () => q,
      limit: () => q,
      then: (ok, falha) => Promise.resolve({ data: (tabelas[nome] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }).then(ok, falha),
    };
    return q;
  };
  const rpc = async (nome, args) => {
    chamadas.push({ nome, args });
    if (nome === "central_resumo_dia") return erroResumo ? { data: null, error: erroResumo } : { data: resumo, error: null };
    if (nome === "central_marcar_anotacoes_enviadas") return { data: args.p_ids.length, error: null };
    return { data: null, error: null };
  };
  return { from, rpc, chamadas };
}

function fakePortas(fetchImpl = fakeFetch()) {
  const envios = new Map();
  const mensagens = [];
  let relogio = 0;
  return {
    envios, fetchImpl,
    async buscarModelo() { return null; },
    async criarRascunho(l) { const id = `env-${envios.size + 1}`; envios.set(id, { id, status: "rascunho", created_at: ++relogio, ...l }); return { id }; },
    async buscarEnvio(id) { return envios.get(id) ?? null; },
    async usuarioFalouDepois(c, instante) { return mensagens.some((m) => m.conversa === c && m.t > instante); },
    async marcarEnviando(id, uid) { const e = envios.get(id); if (!e || e.status !== "rascunho" || e.solicitante_id !== uid) return false; e.status = "enviando"; return true; },
    async concluir(id, d) { envios.get(id).status = d.status; },
    mensageiro: (p) => mensageiro(p, { fetchImpl, env: ENV_OK }),
    pessoaEscreve() { mensagens.push({ conversa: CONVERSA, t: ++relogio }); },
  };
}

const ctxDe = (portas, extra = {}) => ({
  hoje: DIA, usuarioId: "u-bia", conversaId: CONVERSA, papel: "supervisor", nome: "Bia",
  emailPortas: portas, pendente: null, novoPendente: null, ...extra,
});
const NOTAS_DA_PREVIA = ["n1", "n2", "n5"];

test("montar: totais, blocos por cliente, sem movimento, outros clientes e texto digitado neutralizado", () => {
  const filtradas = NOTAS.filter((n) => !n.enviada_em && (n.dia === DIA || !n.verificada_em));
  const m = montarRelatorio({ dia: DIA, resumo: RESUMO, anotacoes: filtradas, nomeDe, geradoPor: "Paulo" });
  assert.equal(m.assunto, "Posição do dia 16/10/2026 — Effective BPO");
  assert.deepEqual(m.totais, { clientes: 2, abertas: 8, concluidas: 3, atrasadas: 5, maiorAtraso: 1, pendentes: 3, anotacoes: 3 });
  assert.deepEqual(m.anotacaoIds, NOTAS_DA_PREVIA);
  assert.match(m.corpo, /\*\*601 — L2H\*\*/);
  assert.match(m.corpo, /Abertas no dia: 8 · Atrasadas: 5 \(maior atraso: 1 dia\) · Concluídas no dia: 3/);
  assert.match(m.corpo, /Pendentes por tipo: 2 diárias, 1 semanal/);
  assert.match(m.corpo, /Concluídas por: Ana \(2\), Eva \(1\)/);
  assert.match(m.corpo, /Anotação de 14\/10:/);
  assert.match(m.corpo, /Sem movimento: 141\./);
  assert.match(m.corpo, /\*\*Outros clientes\*\*/);
  assert.match(m.corpo, /Gerado por Paulo/);
  assert.ok(!m.corpo.includes("{{"), "{{campo}} digitado numa anotação não pode virar campo do modelo");
  assert.ok(!m.corpo.includes("**cliente**"), "negrito digitado numa anotação não pode virar formatação");
  assert.ok(!/Conferir [^\n]*\n/.test(m.corpo.split("Anotação de 14/10")[1]?.split("(")[0] ?? ""), "quebra de linha da anotação não pode virar parágrafo");
});

test("gerar: lê o resumo do dia, junta só o que deve entrar e NÃO envia", async () => {
  const portas = fakePortas();
  const sb = fakeSb();
  const ctx = ctxDe(portas);
  const r = await executar("gerar_relatorio_dia", {}, sb, ctx);
  assert.equal(r.precisa_confirmar, true);
  assert.deepEqual(r.previa.para, ["ana@x.com", "bia@x.com"], "colaboradora inativa fica de fora");
  assert.equal(r.previa.anotacoes_incluidas, 3);
  assert.equal(r.previa.clientes_incluidos, 2);
  assert.deepEqual(ctx.novoPendente, { tipo: "relatorio", envio_id: r.previa.envio_id, dia: DIA, anotacao_ids: NOTAS_DA_PREVIA });
  assert.equal(portas.fetchImpl.chamadas.length, 0, "gerar não pode chamar o n8n");
  assert.deepEqual(sb.chamadas, [{ nome: "central_resumo_dia", args: { p_dia: DIA } }]);
});

test("gerar: somente_para troca a equipe pelos endereços de teste", async () => {
  const r = await executar("gerar_relatorio_dia", { somente_para: ["Paulo@x.com"] }, fakeSb(), ctxDe(fakePortas()));
  assert.deepEqual(r.previa.para, ["paulo@x.com"]);
});

test("gerar: estagiária, dia inválido, resumo com erro ou vazio não geram rascunho", async () => {
  const portas = fakePortas();
  const bloqueada = await executar("gerar_relatorio_dia", {}, fakeSb(), ctxDe(portas, { papel: "estagiaria" }));
  assert.match(bloqueada.erro, /analista, supervisor ou administrador/);
  assert.match((await executar("gerar_relatorio_dia", { dia: "ontem" }, fakeSb(), ctxDe(portas))).erro, /Dia inválido/);
  assert.match((await executar("gerar_relatorio_dia", {}, fakeSb({ erroResumo: { message: "função não existe" } }), ctxDe(portas))).erro, /resumo do dia/);
  assert.match((await executar("gerar_relatorio_dia", {}, fakeSb({ resumo: [] }), ctxDe(portas))).erro, /Não há clientes/);
  assert.equal(portas.envios.size, 0);
});

test("fluxo completo: só depois da confirmação sai, e marca exatamente as anotações da prévia", async () => {
  const portas = fakePortas();
  const sb = fakeSb();
  const ctx = ctxDe(portas);
  const prev = await executar("gerar_relatorio_dia", {}, sb, ctx);
  // a mensagem do agente guarda a prévia; a requisição seguinte a recebe como "pendente"
  const ctx2 = ctxDe(portas, { pendente: ctx.novoPendente });

  const cedo = await executar("enviar_email", { envio_id: prev.previa.envio_id }, sb, ctx2);
  assert.equal(cedo.codigo, "sem_confirmacao");
  assert.equal(sb.chamadas.filter((c) => c.nome === "central_marcar_anotacoes_enviadas").length, 0, "sem envio, nada é marcado");

  portas.pessoaEscreve();
  const ok = await executar("enviar_email", { envio_id: prev.previa.envio_id }, sb, ctx2);
  assert.equal(ok.ok, true);
  assert.equal(ok.anotacoes_marcadas, 3);
  assert.deepEqual(sb.chamadas.at(-1), { nome: "central_marcar_anotacoes_enviadas", args: { p_ids: NOTAS_DA_PREVIA } });
  assert.equal(portas.fetchImpl.chamadas.length, 1);
  assert.deepEqual(portas.fetchImpl.chamadas[0].para, ["ana@x.com", "bia@x.com"]);
  assert.equal(ctx2.pendente, null, "a prévia vale uma vez só");
});

test("se o envio falha, as anotações NÃO são marcadas como enviadas", async () => {
  const portas = fakePortas(fakeFetch(() => new Response("negado", { status: 500 })));
  const sb = fakeSb();
  const ctx = ctxDe(portas);
  const prev = await executar("gerar_relatorio_dia", {}, sb, ctx);
  const ctx2 = ctxDe(portas, { pendente: ctx.novoPendente });
  portas.pessoaEscreve();
  const r = await executar("enviar_email", { envio_id: prev.previa.envio_id }, sb, ctx2);
  assert.ok(r.erro);
  assert.equal(sb.chamadas.filter((c) => c.nome === "central_marcar_anotacoes_enviadas").length, 0);
});

test("marcar: ignora e-mail comum, avisa se o banco recusar e não marca prévia de outro envio", async () => {
  const sb = fakeSb();
  assert.deepEqual(await marcarAnotacoesDoRelatorio("env-1", sb, { pendente: null }), {});
  assert.deepEqual(await marcarAnotacoesDoRelatorio("env-1", sb, { pendente: { tipo: "anotacao" } }), {});
  assert.deepEqual(await marcarAnotacoesDoRelatorio("env-2", sb, { pendente: { tipo: "relatorio", envio_id: "env-1", anotacao_ids: ["n1"] } }), {});
  assert.equal(sb.chamadas.length, 0);
  const quebrado = { rpc: async () => ({ data: null, error: { message: "x" } }) };
  const r = await marcarAnotacoesDoRelatorio("env-1", quebrado, { pendente: { tipo: "relatorio", envio_id: "env-1", anotacao_ids: ["n1"] } });
  assert.match(r.aviso, /não consegui marcar/);
});

test("hoje é o dia de Brasília, não o de Greenwich", () => {
  assert.equal(hojeEmSaoPaulo(new Date("2026-10-17T01:30:00Z")), "2026-10-16");
  assert.equal(hojeEmSaoPaulo(new Date("2026-10-16T15:00:00Z")), "2026-10-16");
});

// Testes das alterações no banco pelo agente. Sem rede, sem OpenAI e sem Supabase: `npm run test:agente`.
import test from "node:test";
import assert from "node:assert/strict";
import { alterarDados, FERRAMENTAS_ALTERACOES, NOMES_OPERACOES, traduzirErroDoBanco } from "../api/agente/_alteracoes.js";
import { executar, FERRAMENTAS } from "../api/agente/_ferramentas.js";

const EMP = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const EVA = "44444444-4444-4444-8444-444444444444";
const BIA = "55555555-5555-4555-8555-555555555555";

const TAREFA = {
  id: T1, empresa_id: EMP, empresa_codigo: "601", empresa_nome: "L2H", titulo: "Revisão do contas a pagar",
  tipo_recorrencia: "semanal", status: "pendente", prazo: "2026-10-20", data_meta: "2026-10-18", responsaveis: [ANA],
};
const CLIENTES = [{ id: EMP, codigo: "601", nome: "L2H" }];
const EQUIPE = [
  { usuario_id: ANA, nome: "Ana", ativo: true },
  { usuario_id: EVA, nome: "Eva", ativo: true },
  { usuario_id: BIA, nome: "Bia", ativo: false },
];

function fakeSb({ tarefas = [TAREFA], clientes = CLIENTES, equipe = EQUIPE, rpcs = {} } = {}) {
  const chamadas = [];
  const tabelas = { central_vw_tarefas: tarefas, central_clientes: clientes, central_vw_equipe: equipe };
  const from = (nome) => {
    const filtros = [];
    const q = {
      select: () => q,
      eq: (c, v) => (filtros.push((r) => r[c] === v), q),
      maybeSingle: async () => ({ data: (tabelas[nome] ?? []).filter((r) => filtros.every((f) => f(r)))[0] ?? null, error: null }),
      then: (ok, falha) => Promise.resolve({ data: (tabelas[nome] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }).then(ok, falha),
    };
    return q;
  };
  const rpc = async (nome, args) => { chamadas.push({ nome, args }); return rpcs[nome] ? rpcs[nome](args) : { data: "id-novo", error: null }; };
  return { from, rpc, chamadas };
}
const ctxNovo = (extra = {}) => ({ hoje: "2026-10-16", pendente: null, novoPendente: null, ...extra });

// Faz a prévia e devolve o contexto da "mensagem seguinte", em que a prévia chega como pendente.
async function previa(sb, operacao, dados) {
  const ctx = ctxNovo();
  const r = await alterarDados({ operacao, dados }, sb, ctx);
  return { r, ctx, seguinte: ctxNovo({ pendente: ctx.novoPendente }) };
}

test("a ferramenta oferece só estas operações, e nenhuma apaga ou mexe em cadastro", () => {
  assert.deepEqual(NOMES_OPERACOES, ["criar_tarefa_pontual", "alterar_datas_tarefa", "comentar_tarefa", "transferir_tarefa"]);
  assert.equal(FERRAMENTAS_ALTERACOES.length, 1);
  assert.ok(FERRAMENTAS.some((f) => f.function.name === "alterar_dados"), "entra na lista do modelo");
  assert.ok(!FERRAMENTAS.some((f) => /apagar|deletar|excluir|delete/i.test(f.function.name)), "nenhuma ferramenta apaga");
});

test("criar tarefa: a prévia não grava; a confirmação grava os dados da PRÉVIA, uma vez só", async () => {
  const sb = fakeSb();
  const { r, ctx, seguinte } = await previa(sb, "criar_tarefa_pontual", { empresa_id: EMP, titulo: "  Cobrar boleto do aluguel ", data: "2026-10-30" });
  assert.equal(r.precisa_confirmar, true);
  assert.match(r.previa.resumo, /601 - L2H/);
  assert.match(r.previa.resumo, /30\/10\/2026/);
  assert.equal(sb.chamadas.length, 0, "a prévia não pode gravar");
  assert.equal(ctx.novoPendente.tipo, "alteracao");

  const ok = await alterarDados({ confirmado: true, dados: { titulo: "OUTRO TÍTULO que o modelo inventou" } }, sb, seguinte);
  assert.equal(ok.ok, true);
  assert.deepEqual(sb.chamadas, [{ nome: "central_criar_pontual", args: { p_empresa: EMP, p_titulo: "Cobrar boleto do aluguel", p_data: "2026-10-30" } }]);
  const de_novo = await alterarDados({ confirmado: true }, sb, seguinte);
  assert.ok(de_novo.erro);
  assert.equal(sb.chamadas.length, 1, "não pode gravar duas vezes");
});

test("confirmar sem prévia, ou a prévia de outra operação, não grava", async () => {
  const sb = fakeSb();
  assert.match((await alterarDados({ confirmado: true }, sb, ctxNovo())).erro, /prévia aprovada/);
  const { seguinte } = await previa(sb, "comentar_tarefa", { tarefa_id: T1, texto: "ok" });
  const r = await alterarDados({ confirmado: true, operacao: "transferir_tarefa" }, sb, seguinte);
  assert.match(r.erro, /outra alteração/);
  assert.equal(sb.chamadas.length, 0);
});

test("operação inventada ou de apagar é recusada e nada chega ao banco", async () => {
  const sb = fakeSb();
  for (const operacao of ["apagar_cliente", "deletar_dado", "excluir_rotina", undefined]) {
    const r = await alterarDados({ operacao, dados: {} }, sb, ctxNovo());
    assert.match(r.erro, /Operação desconhecida/);
  }
  assert.equal(sb.chamadas.length, 0);
});

test("criar tarefa: cliente, título e data inválidos ou cliente fora do acesso não geram prévia", async () => {
  const sb = fakeSb();
  const tenta = (dados, sbUsado = sb) => alterarDados({ operacao: "criar_tarefa_pontual", dados }, sbUsado, ctxNovo());
  assert.match((await tenta({ empresa_id: "abc", titulo: "x", data: "2026-10-30" })).erro, /cliente/);
  assert.match((await tenta({ empresa_id: EMP, titulo: "  ", data: "2026-10-30" })).erro, /título/);
  assert.match((await tenta({ empresa_id: EMP, titulo: "x", data: "2026-02-31" })).erro, /aaaa-mm-dd/);
  assert.match((await tenta({ empresa_id: EMP, titulo: "x", data: "30/10/2026" })).erro, /aaaa-mm-dd/);
  assert.match((await tenta({ empresa_id: EMP, titulo: "x", data: "2026-10-30" }, fakeSb({ clientes: [] }))).erro, /fora do seu acesso/);
});

test("alterar datas: só o prazo MANTÉM a meta atual (o banco apagaria se fosse nula)", async () => {
  const sb = fakeSb();
  const { r, seguinte } = await previa(sb, "alterar_datas_tarefa", { tarefa_id: T1, prazo: "2026-10-25" });
  assert.deepEqual(r.previa.detalhes.slice(1), ["Entrega: 20/10/2026 → 25/10/2026", "Meta: 18/10/2026 → 18/10/2026"]);
  await alterarDados({ confirmado: true }, sb, seguinte);
  assert.deepEqual(sb.chamadas, [{ nome: "central_alterar_datas", args: { p_tarefa: T1, p_meta: "2026-10-18", p_prazo: "2026-10-25" } }]);
});

test("alterar datas: remover_meta limpa a meta; nova meta e novo prazo juntos; meta depois da entrega é recusada", async () => {
  const sb = fakeSb();
  const { seguinte } = await previa(sb, "alterar_datas_tarefa", { tarefa_id: T1, remover_meta: true });
  await alterarDados({ confirmado: true }, sb, seguinte);
  assert.deepEqual(sb.chamadas[0].args, { p_tarefa: T1, p_meta: null, p_prazo: "2026-10-20" });

  const b = await previa(fakeSb(), "alterar_datas_tarefa", { tarefa_id: T1, prazo: "2026-10-28", meta: "2026-10-26" });
  assert.deepEqual(b.ctx.novoPendente.dados, { tarefa_id: T1, prazo: "2026-10-28", meta: "2026-10-26" });

  const ruim = await previa(fakeSb(), "alterar_datas_tarefa", { tarefa_id: T1, meta: "2026-10-22" });
  assert.match(ruim.r.erro, /meta não pode ser depois/);
});

test("alterar datas: diária, concluída, sem mudança e sem nada informado são recusadas", async () => {
  const tenta = (tarefa, dados) => previa(fakeSb({ tarefas: [{ ...TAREFA, ...tarefa }] }), "alterar_datas_tarefa", { tarefa_id: T1, ...dados }).then((x) => x.r.erro);
  assert.match(await tenta({ tipo_recorrencia: "diaria" }, { prazo: "2026-10-25" }), /diária/);
  assert.match(await tenta({ status: "concluida" }, { prazo: "2026-10-25" }), /já foi concluída/);
  assert.match(await tenta({}, { prazo: "2026-10-20" }), /já são essas/);
  assert.match(await tenta({}, {}), /Informe o novo prazo/);
  assert.match(await tenta({}, { prazo: "amanhã" }), /aaaa-mm-dd/);
});

test("comentar: valida e grava o texto da prévia", async () => {
  const sb = fakeSb();
  assert.match((await previa(sb, "comentar_tarefa", { tarefa_id: T1, texto: "  " })).r.erro, /vazio/);
  assert.match((await previa(sb, "comentar_tarefa", { tarefa_id: T1, texto: "a".repeat(2001) })).r.erro, /2000/);
  assert.match((await previa(fakeSb({ tarefas: [] }), "comentar_tarefa", { tarefa_id: T1, texto: "x" })).r.erro, /fora do seu acesso/);
  const { seguinte } = await previa(sb, "comentar_tarefa", { tarefa_id: T1, texto: "Cliente confirmou o pagamento" });
  await alterarDados({ confirmado: true, dados: { texto: "outro" } }, sb, seguinte);
  assert.deepEqual(sb.chamadas, [{ nome: "central_comentar", args: { p_tarefa: T1, p_texto: "Cliente confirmou o pagamento" } }]);
});

test("transferir: 'de' é deduzido quando há uma responsável; destino inativo, repetido ou origem errada são recusados", async () => {
  const sb = fakeSb();
  const { r, seguinte } = await previa(sb, "transferir_tarefa", { tarefa_id: T1, para: EVA });
  assert.match(r.previa.resumo, /de Ana para Eva/);
  await alterarDados({ confirmado: true }, sb, seguinte);
  assert.deepEqual(sb.chamadas, [{ nome: "central_transferir", args: { p_tarefa: T1, p_de: ANA, p_para: EVA } }]);

  assert.match((await previa(sb, "transferir_tarefa", { tarefa_id: T1, para: BIA })).r.erro, /não está ativa/);
  assert.match((await previa(sb, "transferir_tarefa", { tarefa_id: T1, para: ANA })).r.erro, /já é responsável/);
  assert.match((await previa(sb, "transferir_tarefa", { tarefa_id: T1, para: EVA, de: EVA })).r.erro, /não é responsável/);
  const duas = fakeSb({ tarefas: [{ ...TAREFA, responsaveis: [ANA, EVA] }] });
  assert.match((await previa(duas, "transferir_tarefa", { tarefa_id: T1, para: BIA })).r.erro, /mais de uma responsável/);
});

test("recusa do banco (permissão, regra) chega traduzida, e a prévia não pode ser reaproveitada", async () => {
  const sb = fakeSb({ rpcs: { central_alterar_datas: async () => ({ data: null, error: { message: "SEM_PERMISSAO" } }) } });
  const { seguinte } = await previa(sb, "alterar_datas_tarefa", { tarefa_id: T1, prazo: "2026-10-25" });
  const r = await alterarDados({ confirmado: true }, sb, seguinte);
  assert.equal(r.erro, "Você não tem permissão para isso.");
  assert.equal(seguinte.pendente, null, "a prévia foi consumida mesmo com a recusa");
  assert.equal(traduzirErroDoBanco("P0001: META_DEPOIS_DA_ENTREGA"), "A meta não pode ser depois da entrega.");
  assert.equal(traduzirErroDoBanco("SEM_ACESSO_CLIENTE"), "Você não atende este cliente.", "o prefixo não pode roubar a mensagem");
  assert.match(traduzirErroDoBanco("SEM_ACESSO"), /acesso ativo à Central/);
});

test("pelo despacho das ferramentas: alterar_dados funciona e erro interno não derruba a conversa", async () => {
  const sb = fakeSb();
  const ctx = ctxNovo();
  const r = await executar("alterar_dados", { operacao: "comentar_tarefa", dados: { tarefa_id: T1, texto: "ok" } }, sb, ctx);
  assert.equal(r.precisa_confirmar, true);
  const quebrado = { from: () => { throw new Error("banco fora do ar"); }, rpc: async () => ({}) };
  const e = await executar("alterar_dados", { operacao: "comentar_tarefa", dados: { tarefa_id: T1, texto: "ok" } }, quebrado, ctxNovo());
  assert.match(e.erro, /banco fora do ar/);
});

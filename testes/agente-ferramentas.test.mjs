// Testes das ferramentas do agente com um Supabase de mentira.
// Não usa rede, não usa a OpenAI e não gasta crédito: roda com `npm run test:agente`.
import test from "node:test";
import assert from "node:assert/strict";
import { FERRAMENTAS, executar, traduzirErro } from "../api/agente/_ferramentas.js";

const EMP = "11111111-1111-4111-8111-111111111111";
const OUTRA = "44444444-4444-4444-8444-444444444444";
const ANA = "22222222-2222-4222-8222-222222222222";
const EVA = "33333333-3333-4333-8333-333333333333";
const HOJE = "2026-10-16";
const CLIENTES = [{ id: EMP, codigo: "601", nome: "L2H" }];
const EQUIPE = [
  { usuario_id: ANA, nome: "Ana", ativo: true },
  { usuario_id: EVA, nome: "Eva", ativo: false },
];

function fakeSb({ clientes = [], equipe = [], anotacoes = [], rpcs = {} } = {}) {
  const chamadas = [];
  const tabelas = { central_clientes: clientes, central_vw_equipe: equipe, central_anotacoes: anotacoes };
  const from = (nome) => {
    const filtros = [];
    const aplicar = () => (tabelas[nome] ?? []).filter((r) => filtros.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (c, v) => (filtros.push((r) => r[c] === v), q),
      is: (c, v) => (filtros.push((r) => (r[c] ?? null) === v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: aplicar()[0] ?? null, error: null }),
      then: (ok, falha) => Promise.resolve({ data: aplicar(), error: null }).then(ok, falha),
    };
    return q;
  };
  const rpc = async (nome, args) => {
    chamadas.push({ nome, args });
    return rpcs[nome] ? rpcs[nome](args) : { data: "id-novo", error: null };
  };
  return { from, rpc, chamadas };
}

const ctxNovo = (extra = {}) => ({ hoje: HOJE, pendente: null, novoPendente: null, ...extra });

test("registrar_anotacao sem confirmação só mostra a prévia e não grava", async () => {
  const sb = fakeSb({ clientes: CLIENTES });
  const ctx = ctxNovo();
  const r = await executar("registrar_anotacao", { empresa_id: EMP, texto: "Boleto do aluguel não chegou" }, sb, ctx);
  assert.equal(r.precisa_confirmar, true);
  assert.equal(r.previa.cliente, "601 - L2H");
  assert.equal(r.previa.vai_para, "os analistas vinculados ao cliente");
  assert.equal(sb.chamadas.length, 0, "a prévia não pode gravar");
  assert.equal(ctx.novoPendente.tipo, "anotacao");
});

test("confirmado=true sem prévia aprovada é recusado e não grava", async () => {
  const sb = fakeSb({ clientes: CLIENTES });
  const r = await executar("registrar_anotacao", { empresa_id: EMP, texto: "x", confirmado: true }, sb, ctxNovo());
  assert.match(r.erro, /prévia aprovada/);
  assert.equal(sb.chamadas.length, 0);
});

test("a confirmação grava o texto da PRÉVIA, com origem agente, e só vale uma vez", async () => {
  const sb = fakeSb({ clientes: CLIENTES });
  const pendente = { tipo: "anotacao", empresa_id: EMP, texto: "Texto que a pessoa viu", para: null, cliente: "601 - L2H", destinatarios: "x" };
  const ctx = ctxNovo({ pendente });
  const r = await executar("registrar_anotacao", { confirmado: true, texto: "outro texto que o modelo inventou" }, sb, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(sb.chamadas, [
    { nome: "central_anotar", args: { p_empresa: EMP, p_texto: "Texto que a pessoa viu", p_para: null, p_origem: "agente" } },
  ]);
  const de_novo = await executar("registrar_anotacao", { confirmado: true }, sb, ctx);
  assert.ok(de_novo.erro, "a segunda confirmação seguida tem que falhar");
  assert.equal(sb.chamadas.length, 1, "não pode gravar duas vezes");
});

test("confirmação de outro cliente não aproveita a prévia anterior", async () => {
  const sb = fakeSb({ clientes: CLIENTES });
  const pendente = { tipo: "anotacao", empresa_id: EMP, texto: "t", para: null, cliente: "601 - L2H", destinatarios: "x" };
  const r = await executar("registrar_anotacao", { empresa_id: OUTRA, confirmado: true }, sb, ctxNovo({ pendente }));
  assert.match(r.erro, /601 - L2H/);
  assert.equal(sb.chamadas.length, 0);
});

test("cliente fora do acesso não gera prévia", async () => {
  const sb = fakeSb({ clientes: [] });
  const ctx = ctxNovo();
  const r = await executar("registrar_anotacao", { empresa_id: EMP, texto: "x" }, sb, ctx);
  assert.match(r.erro, /fora do seu acesso/);
  assert.equal(ctx.novoPendente, null);
});

test("destinatário inativo ou fora da equipe é recusado; ativo entra na prévia pelo nome", async () => {
  const sb = fakeSb({ clientes: CLIENTES, equipe: EQUIPE });
  const ruim = await executar("registrar_anotacao", { empresa_id: EMP, texto: "x", para: [EVA] }, sb, ctxNovo());
  assert.match(ruim.erro, /não está ativo/);
  const bom = await executar("registrar_anotacao", { empresa_id: EMP, texto: "x", para: [ANA] }, sb, ctxNovo());
  assert.equal(bom.previa.vai_para, "Ana");
});

test("entradas inválidas são recusadas antes de qualquer consulta", async () => {
  const sb = fakeSb({ clientes: CLIENTES });
  assert.ok((await executar("registrar_anotacao", { empresa_id: "abc", texto: "x" }, sb, ctxNovo())).erro);
  assert.match((await executar("registrar_anotacao", { empresa_id: EMP, texto: "   " }, sb, ctxNovo())).erro, /vazia/);
  assert.match((await executar("registrar_anotacao", { empresa_id: EMP, texto: "a".repeat(2001) }, sb, ctxNovo())).erro, /2000/);
  assert.ok((await executar("registrar_anotacao", { empresa_id: EMP, texto: "x", para: ["nao-e-uuid"] }, sb, ctxNovo())).erro);
});

test("erro do banco chega traduzido", async () => {
  assert.match(traduzirErro("DESTINO_INVALIDO"), /não está ativo/);
  assert.match(traduzirErro("P0001: SEM_ACESSO_CLIENTE"), /não atende/);
  assert.equal(traduzirErro(""), "erro desconhecido");
  const sb = fakeSb({ rpcs: { central_anotar: async () => ({ data: null, error: { message: "DESTINO_INVALIDO" } }) } });
  const pendente = { tipo: "anotacao", empresa_id: EMP, texto: "t", para: [ANA], cliente: "c", destinatarios: "d" };
  const r = await executar("registrar_anotacao", { confirmado: true }, sb, ctxNovo({ pendente }));
  assert.match(r.erro, /não está ativo/);
});

test("verificar_anotacao chama a função do banco e recusa id inválido", async () => {
  const sb = fakeSb();
  assert.ok((await executar("verificar_anotacao", { id: "xx" }, sb, ctxNovo())).erro);
  const r = await executar("verificar_anotacao", { id: ANA }, sb, ctxNovo());
  assert.equal(r.ok, true);
  assert.deepEqual(sb.chamadas, [{ nome: "central_verificar_anotacao", args: { p_id: ANA } }]);
});

test("anotacoes_do_dia: hoje por padrão, pendentes de qualquer dia, e dia explícito", async () => {
  const anotacoes = [
    { id: "a", empresa_id: EMP, usuario_id: ANA, dia: HOJE, texto: "x", para: null, verificada_em: null },
    { id: "b", empresa_id: EMP, usuario_id: ANA, dia: "2026-10-14", texto: "y", para: [ANA], verificada_em: null },
    { id: "c", empresa_id: EMP, usuario_id: ANA, dia: "2026-10-14", texto: "z", para: null, verificada_em: "2026-10-15T10:00:00Z" },
  ];
  const sb = fakeSb({ equipe: EQUIPE, anotacoes });
  const ids = async (args) => (await executar("anotacoes_do_dia", args, sb, ctxNovo())).anotacoes.map((a) => a.id).sort();
  assert.deepEqual(await ids({}), ["a"]);
  assert.deepEqual(await ids({ so_nao_verificadas: true }), ["a", "b"]);
  assert.deepEqual(await ids({ dia: "2026-10-14" }), ["b", "c"]);
  const r = await executar("anotacoes_do_dia", { so_nao_verificadas: true }, sb, ctxNovo());
  assert.equal(r.anotacoes.find((a) => a.id === "b").autor, "Ana");
  assert.deepEqual(r.anotacoes.find((a) => a.id === "b").para_nomes, ["Ana"]);
});

test("definições: nomes únicos e ferramentas de escrita presentes", () => {
  const nomes = FERRAMENTAS.map((f) => f.function.name);
  assert.equal(new Set(nomes).size, nomes.length);
  for (const n of ["registrar_anotacao", "verificar_anotacao", "anotacoes_do_dia"]) assert.ok(nomes.includes(n), n);
});

test("ferramenta desconhecida devolve erro, não exceção", async () => {
  assert.match((await executar("apagar_tudo", {}, fakeSb(), ctxNovo())).erro, /desconhecida/);
});

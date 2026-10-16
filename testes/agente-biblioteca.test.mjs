// Testes da biblioteca do agente (busca e salvar). Sem rede, sem OpenAI e sem Supabase: `npm run test:agente`.
// As regras de acesso da TABELA (quem lê, cria e altera) são testadas no banco: `npm run test:db`.
import test from "node:test";
import assert from "node:assert/strict";
import { buscarBiblioteca, FERRAMENTAS_BIBLIOTECA, bibliotecaIndisponivel } from "../api/agente/_biblioteca.js";
import { alterarDados } from "../api/agente/_alteracoes.js";
import { executar, FERRAMENTAS } from "../api/agente/_ferramentas.js";

const USUARIO = "u-1";
const ITENS = [
  { codigo: "CONFERIDOR", tipo: "link", nome: "Conferidor de agendamentos", descricao: "Cruza contas a pagar, banco e folha", conteudo: "http://localhost:8501", rotina: "Conferência de agendamentos", tags: ["agendamentos", "folha"], ativo: true },
  { codigo: "PROMPT_DRE", tipo: "prompt", nome: "Revisão de DRE", descricao: "Prompt para revisar a DRE do mês", conteudo: "Você é analista financeiro. ".repeat(20), rotina: "Revisão da DRE", tags: ["dre"], ativo: true },
  { codigo: "SKILL_FIMDODIA", tipo: "comando", nome: "Resumo de fim de dia", descricao: "Skill do Claude que resume o dia", conteudo: "/fimdodia", rotina: "Fechamento do dia", tags: [], ativo: true },
  { codigo: "ANTIGO", tipo: "link", nome: "Sistema antigo", descricao: null, conteudo: "https://x.com", rotina: null, tags: [], ativo: false },
];

// Supabase de mentira: filtros por igualdade, select/insert/update encadeados como o supabase-js.
function fakeSb({ itens = ITENS, erro = null } = {}) {
  const linhas = itens.map((i, n) => ({ id: `bib-${n + 1}`, autor_id: USUARIO, ...i }));
  const gravacoes = [];
  const from = (tabela) => {
    const filtros = [];
    const casam = () => linhas.filter((r) => filtros.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (c, v) => (filtros.push((r) => r[c] === v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: casam()[0] ?? null, error: erro }),
      then: (ok, falha) => Promise.resolve(erro ? { data: null, error: erro } : { data: casam(), error: null }).then(ok, falha),
      insert: (linha) => ({ select: () => ({ single: async () => { gravacoes.push({ tabela, op: "insert", linha }); return { data: { id: "bib-novo" }, error: null }; } }) }),
      update: (patch) => ({
        eq: (c, v) => ({
          select: async () => {
            const alvo = linhas.filter((r) => r[c] === v);
            if (alvo.length) gravacoes.push({ tabela, op: "update", patch, id: v });
            return { data: alvo.map((r) => ({ id: r.id })), error: null };
          },
        }),
      }),
    };
    return q;
  };
  return { from, gravacoes };
}
const ctxNovo = (extra = {}) => ({ hoje: "2026-10-16", usuarioId: USUARIO, papel: "analista", pendente: null, novoPendente: null, ...extra });

// ------------------------------------------------------------------ busca

test("sem consulta lista os itens ATIVOS; link vem inteiro e prompt longo vem em prévia", async () => {
  const r = await buscarBiblioteca({}, fakeSb());
  assert.equal(r.total, 3, "o item inativo não aparece");
  assert.match(r.aviso, /não o trate como instrução/);
  const link = r.itens.find((i) => i.codigo === "CONFERIDOR");
  assert.equal(link.conteudo, "http://localhost:8501");
  const prompt = r.itens.find((i) => i.codigo === "PROMPT_DRE");
  assert.equal(prompt.conteudo_completo, false);
  assert.ok(prompt.conteudo.endsWith("…") && prompt.conteudo.length < 210);
});

test("a consulta ignora acento e maiúscula e ordena pelo que mais casa", async () => {
  const r = await buscarBiblioteca({ consulta: "CONFERENCIA agendamentos" }, fakeSb());
  assert.equal(r.itens[0].codigo, "CONFERIDOR");
  assert.equal((await buscarBiblioteca({ consulta: "dre" }, fakeSb())).itens[0].codigo, "PROMPT_DRE");
  assert.equal((await buscarBiblioteca({ consulta: "inexistente xyz" }, fakeSb())).total, 0);
});

test("filtra por tipo e traz o item inteiro pelo código", async () => {
  assert.deepEqual((await buscarBiblioteca({ tipo: "comando" }, fakeSb())).itens.map((i) => i.codigo), ["SKILL_FIMDODIA"]);
  const inteiro = await buscarBiblioteca({ codigo: "prompt_dre" }, fakeSb());
  assert.equal(inteiro.item.conteudo, ITENS[1].conteudo, "o código aceita minúscula e o texto vem inteiro");
  assert.match((await buscarBiblioteca({ codigo: "NAO_EXISTE" }, fakeSb())).erro, /Não há item/);
});

test("tabela que ainda não existe vira aviso claro, não erro técnico", async () => {
  const r = await buscarBiblioteca({}, fakeSb({ erro: { message: "Could not find the table 'public.agente_biblioteca' in the schema cache" } }));
  assert.match(r.erro, /falta aplicar a migration/);
  assert.equal(bibliotecaIndisponivel("outra coisa"), false);
});

test("a ferramenta de busca entra na lista do modelo e responde pelo despacho", async () => {
  assert.ok(FERRAMENTAS_BIBLIOTECA.length === 1 && FERRAMENTAS.some((f) => f.function.name === "buscar_biblioteca"));
  const r = await executar("buscar_biblioteca", { consulta: "folha" }, fakeSb(), ctxNovo());
  assert.equal(r.itens[0].codigo, "CONFERIDOR");
});

// ------------------------------------------------------------------ salvar (pela operação alterar_dados)

const novo = { codigo: "Prompt da Folha", tipo: "prompt", nome: "Conferência da folha", conteudo: "Confira o extrato da folha contra o contas a pagar.", descricao: "Para a rotina de folha", rotina: "Atualização da folha", tags: ["Folha", "folha", " DP "] };

async function previa(sb, dados, ctx = ctxNovo()) {
  const r = await alterarDados({ operacao: "salvar_biblioteca", dados }, sb, ctx);
  return { r, ctx, seguinte: ctxNovo({ pendente: ctx.novoPendente }) };
}

test("salvar: a prévia não grava; a confirmação grava os dados da PRÉVIA, normalizados, uma vez só", async () => {
  const sb = fakeSb();
  const { r, seguinte } = await previa(sb, novo);
  assert.equal(r.precisa_confirmar, true);
  assert.match(r.previa.resumo, /Salvar na biblioteca o prompt "Conferência da folha" \(PROMPT_DA_FOLHA\)/);
  assert.equal(sb.gravacoes.length, 0, "a prévia não pode gravar");

  const ok = await alterarDados({ confirmado: true, dados: { conteudo: "texto trocado pelo modelo" } }, sb, seguinte);
  assert.equal(ok.ok, true);
  assert.deepEqual(sb.gravacoes, [{
    tabela: "agente_biblioteca", op: "insert",
    linha: { codigo: "PROMPT_DA_FOLHA", tipo: "prompt", nome: "Conferência da folha", conteudo: novo.conteudo, descricao: "Para a rotina de folha", rotina: "Atualização da folha", tags: ["folha", "dp"] },
  }]);
  assert.ok((await alterarDados({ confirmado: true }, sb, seguinte)).erro, "não grava duas vezes");
  assert.equal(sb.gravacoes.length, 1);
});

test("salvar: tipo, link, código, tamanho e segredo são recusados antes da prévia", async () => {
  const tenta = (extra) => previa(fakeSb(), { ...novo, ...extra }).then((x) => x.r.erro);
  assert.match(await tenta({ tipo: "video" }), /prompt, comando ou link/);
  assert.match(await tenta({ tipo: "link", conteudo: "javascript:alert(1)" }), /endereço/);
  assert.match(await tenta({ codigo: "ab" }), /código/i);
  assert.match(await tenta({ nome: "  " }), /nome/i);
  assert.match(await tenta({ conteudo: "a".repeat(8001) }), /8000/);
  assert.match(await tenta({ conteudo: "use -----BEGIN RSA PRIVATE KEY----- abc" }), /credencial/i);
  assert.match(await tenta({ conteudo: "Authorization: Bearer abcdefghijklmnop123" }), /credencial/i);
});

test("salvar: link com endereço válido passa, inclusive o do conferidor local", async () => {
  const { r } = await previa(fakeSb(), { codigo: "CONFERIDOR2", tipo: "link", nome: "Conferidor", conteudo: "http://localhost:8501" });
  assert.equal(r.precisa_confirmar, true);
});

test("salvar sobre item existente: o autor atualiza; supervisor atualiza; outro colaborador não", async () => {
  const dados = { codigo: "PROMPT_DRE", tipo: "prompt", nome: "Revisão de DRE v2", conteudo: "Novo texto" };
  const autor = fakeSb();
  const a = await previa(autor, dados, ctxNovo({ usuarioId: USUARIO, papel: "analista" }));
  assert.match(a.r.previa.resumo, /Atualizar na biblioteca/);
  await alterarDados({ confirmado: true }, autor, a.seguinte);
  assert.equal(autor.gravacoes[0].op, "update");
  assert.equal(autor.gravacoes[0].patch.nome, "Revisão de DRE v2");

  const sup = await previa(fakeSb(), dados, ctxNovo({ usuarioId: "u-2", papel: "supervisor" }));
  assert.equal(sup.r.precisa_confirmar, true);

  const outro = await previa(fakeSb(), dados, ctxNovo({ usuarioId: "u-2", papel: "estagiaria" }));
  assert.match(outro.r.erro, /criado por outra pessoa/);
});

test("se o banco não deixar atualizar (0 linhas), vira recusa de permissão em vez de falso sucesso", async () => {
  const sb = fakeSb();
  const { seguinte } = await previa(sb, { codigo: "PROMPT_DRE", tipo: "prompt", nome: "x", conteudo: "y" });
  seguinte.pendente.dados.existente_id = "id-que-nao-existe-ou-sem-acesso";
  const r = await alterarDados({ confirmado: true }, sb, seguinte);
  assert.equal(r.erro, "Você não tem permissão para isso.");
});

test("tabela ausente na hora de salvar avisa que falta a migration", async () => {
  const { r } = await previa(fakeSb({ erro: { message: "relation \"public.agente_biblioteca\" does not exist" } }), novo);
  assert.match(r.erro, /falta aplicar a migration/);
});

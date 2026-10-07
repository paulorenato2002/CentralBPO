// =============================================================================
// Testes do backend da Central BPO num Postgres descartável (PGlite, em memória).
//
//   npm run test:db
//
// Monta o esquema operacional existente (baseline + migrations do Agente BPO),
// aplica as 3 migrations da Central por cima e roda o cenário completo do dia:
// rotinas, geração de tarefas, cronômetro, conclusão com tempo, checklist,
// permissões, acessos cifrados, clientes, fechamento das 22h e RLS.
//
// A base vem de CENTRAL_BASE_DIR (padrão: ../Agente BPO/supabase), que não é
// publicada aqui porque tem dados internos.
// =============================================================================
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const BASE = process.env.CENTRAL_BASE_DIR || resolve(RAIZ, "..", "Agente BPO", "supabase");
if (!existsSync(BASE)) { console.error(`Base do esquema operacional não encontrada em ${BASE}. Defina CENTRAL_BASE_DIR.`); process.exit(2); }

const db = new PGlite({ extensions: { pgcrypto } });
process.on("unhandledRejection", (e) => { console.error("\nERRO:", e.message, e.where ? `\n  em: ${e.where}` : ""); process.exit(1); });
const ler = (p) => readFileSync(p, "utf8");
let ok = 0, falhas = 0;

function checar(nome, cond, extra = "") {
  if (cond) { ok++; console.log(`  OK    ${nome}`); }
  else { falhas++; console.log(`  FALHA ${nome} ${extra}`); }
}
async function erro(nome, sql, codigo) {
  try { await db.query(sql); falhas++; console.log(`  FALHA ${nome} (não deu erro; esperado ${codigo})`); }
  catch (e) {
    const msg = String(e.message || e);
    if (msg.includes(codigo)) { ok++; console.log(`  OK    ${nome} → ${codigo}`); }
    else { falhas++; console.log(`  FALHA ${nome} (esperado ${codigo}, veio: ${msg})`); }
  }
}
const um = async (sql, p) => (await db.query(sql, p)).rows[0];
const val = async (sql, p) => Object.values((await db.query(sql, p)).rows[0] || {})[0];

// ---------- 1. esquema ----------
console.log("\n1. Montando o esquema");
await db.exec(`
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create schema if not exists vault;
  create table vault.secrets (name text primary key, secret text);
  create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$;
`);
await db.exec(ler(join(BASE, "baseline", "0000_baseline_existente_TESTE.sql")).replace(/^\\set .*$/gm, ""));
// só a camada operacional (26/08): é sobre ela que a Central se apoia
for (const f of readdirSync(join(BASE, "migrations")).filter((f) => /^20260826120\d00_.*\.sql$/.test(f)).sort()) {
  await db.exec(ler(join(BASE, "migrations", f)));
}
console.log("  base operacional aplicada");
for (const f of readdirSync(join(RAIZ, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(ler(join(RAIZ, "supabase", "migrations", f)));
  console.log(`  ${f}`);
}
// aplicar de novo não pode quebrar nada (migrations idempotentes)
for (const f of readdirSync(join(RAIZ, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(ler(join(RAIZ, "supabase", "migrations", f)));
}
console.log("  reaplicadas sem erro (idempotentes)");
await db.exec(`insert into vault.secrets values ('central_acessos_chave', 'chave-de-teste-com-32-caracteres!!');`);
await db.exec(`grant usage on schema vault, extensions to postgres;`);

// ---------- 2. pessoas e clientes ----------
console.log("\n2. Pessoas e clientes (fictícios)");
const P = {};
for (const [nome, papelAgente, papel] of [["Ana", "estagiaria", "estagiaria"], ["Bruna", "analista", "analista"],
  ["Paulo", "supervisor", "supervisor"], ["Carlos", "analista", "gestor_financeiro"], ["Adm", "administrador", "administrador"]]) {
  const id = await val(`insert into auth.users (email) values ($1) returning id`, [`${nome.toLowerCase()}@exemplo.com`]);
  await db.query(`insert into public.perfis_usuarios (usuario_id, nome, email, papel) values ($1, $2, $3, $4)`, [id, nome, `${nome.toLowerCase()}@exemplo.com`, papelAgente]);
  await db.query(`insert into public.central_colaboradores (usuario_id, papel_central, carga_horaria_mes) values ($1, $2, 160)`, [id, papel]);
  P[nome] = id;
}
const E = {};
for (const [cod, nome] of [["101", "Alfa"], ["102", "Beta"]]) {
  E[nome] = await val(`insert into public.empresas (codigo, razao_social, nome_fantasia, cnpj) values ($1, $2, $3, $4) returning id`,
    [cod, `${nome} Ltda`, nome, `000000${cod}000100`.slice(0, 14)]);
}
await db.query(`insert into public.central_vinculos values ($1, $2), ($1, $3), ($4, $3), ($1, $5), ($4, $5)`, [E.Alfa, P.Ana, P.Bruna, E.Beta, P.Paulo]);
checar("5 colaboradores e 2 clientes", (await val(`select count(*) from public.central_colaboradores`)) == 5);

const como = (u) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u]);
const hora = (h) => db.query(`select set_config('central.agora', $1, false)`, [`2026-10-07 ${h}-03`]);
const dia = (d, h) => db.query(`select set_config('central.agora', $1, false)`, [`${d} ${h}-03`]);
await hora("08:00:00");

// ---------- 3. rotinas e geração ----------
console.log("\n3. Rotinas e geração de tarefas");
await como(P.Ana);
const pedido = await val(`select public.central_salvar_rotina(null, $1, 'Conciliar banco', 'diaria', '{}', '2026-10-01', null, true, array[$2]::uuid[], array['Extrato','Saldo'])`, [E.Alfa, P.Ana]);
checar("estagiária cadastrar rotina vira pedido ao Adm", pedido.status === "pedido");
checar("pedido gravado", (await val(`select count(*) from public.central_solicitacoes where status = 'pendente'`)) == 1);

await como(P.Adm);
const r1 = await val(`select public.central_salvar_rotina(null, $1, 'Conciliar banco', 'diaria', '{}', '2026-10-01', null, true, array[$2]::uuid[], array['Baixar extrato','Conferir saldo'])`, [E.Alfa, P.Ana]);
const r2 = await val(`select public.central_salvar_rotina(null, $1, 'Revisar e-mail financeiro', 'diaria', '{}', '2026-10-01', null, true, array[$2]::uuid[], null)`, [E.Alfa, P.Ana]);
const r3 = await val(`select public.central_salvar_rotina(null, $1, 'Agendar pagamentos', 'semanal', '{"dia_semana":5}', '2026-10-01', null, true, array[$2,$3]::uuid[], null)`, [E.Alfa, P.Bruna, P.Paulo]);
const r4 = await val(`select public.central_salvar_rotina(null, $1, 'Relatório à contabilidade', 'mensal', '{"dia_mes":10,"dia_meta":9}', '2026-10-01', null, true, array[$2]::uuid[], null)`, [E.Alfa, P.Bruna]);
const r5 = await val(`select public.central_salvar_rotina(null, $1, 'Fechamento de caixa', 'quinzenal', '{}', '2026-10-01', null, true, array[$2]::uuid[], null)`, [E.Beta, P.Bruna]);
const r6 = await val(`select public.central_salvar_rotina(null, $1, 'Reunião mensal', 'mensal', '{"dia_mes":7}', '2026-10-01', null, true, array[$2]::uuid[], null)`, [E.Alfa, P.Carlos]);
checar("Adm cadastra rotinas", [r1, r2, r3, r4, r5, r6].every((r) => r.status === "ok"));
checar("salvar gera a partir de amanhã (08/10)", (await val(`select min(prazo) from public.tarefas_operacionais where rotina_empresa_id = $1`, [r1.rotina_id])) instanceof Date &&
  (await val(`select min(prazo)::text from public.tarefas_operacionais where rotina_empresa_id = $1`, [r1.rotina_id])) === "2026-10-08");
await erro("rotina duplicada", `select public.central_salvar_rotina(null, '${E.Alfa}', 'Conciliar banco', 'diaria', '{}', '2026-10-01', null, true, array['${P.Ana}']::uuid[], null)`, "ROTINA_JA_EXISTE");
await erro("mensal com meta depois da entrega", `select public.central_salvar_rotina(null, '${E.Alfa}', 'X', 'mensal', '{"dia_mes":5,"dia_meta":9}', '2026-10-01', null, true, array['${P.Ana}']::uuid[], null)`, "META_DEPOIS_DA_ENTREGA");

const novas = await val(`select public.central_gerar_tarefas('2026-10-07', '2026-10-07')`);
checar("geração do dia cria as de hoje", novas >= 3, `(criou ${novas})`);
checar("geração é idempotente", (await val(`select public.central_gerar_tarefas('2026-10-07', '2026-11-30')`)) == 0);
const quinz = (await db.query(`select string_agg(prazo::text, ',' order by prazo) as d from public.tarefas_operacionais where rotina_empresa_id = $1`, [r5.rotina_id])).rows[0].d;
checar("quinzenal: 16/10, 02/11 (31/10 era sábado), 16/11, 30/11", quinz === "2026-10-16,2026-11-02,2026-11-16,2026-11-30", quinz);
const mens = await um(`select prazo::text p, data_meta::text m from public.tarefas_operacionais where rotina_empresa_id = $1 order by prazo limit 1`, [r4.rotina_id]);
checar("mensal: entrega 10/10 com meta 09/10", mens.p === "2026-10-10" && mens.m === "2026-10-09");
const sem = await val(`select string_agg(distinct extract(isodow from prazo)::text, ',') from public.tarefas_operacionais where rotina_empresa_id = $1`, [r3.rotina_id]);
checar("semanal só às sextas", sem === "5");
checar("checklist padrão copiado para a tarefa", (await val(`select count(*) from public.central_tarefa_checklist c join public.tarefas_operacionais t on t.id = c.tarefa_id where t.rotina_empresa_id = $1 and t.prazo = '2026-10-07'`, [r1.rotina_id])) == 2);
checar("dois responsáveis copiados", (await val(`select count(*) from public.central_tarefa_responsaveis r join public.tarefas_operacionais t on t.id = r.tarefa_id where t.rotina_empresa_id = $1 and t.prazo = '2026-10-09'`, [r3.rotina_id])) == 2);

const tConc = await val(`select id from public.tarefas_operacionais where rotina_empresa_id = $1 and prazo = '2026-10-07'`, [r1.rotina_id]);
const tEmail = await val(`select id from public.tarefas_operacionais where rotina_empresa_id = $1 and prazo = '2026-10-07'`, [r2.rotina_id]);
const tReun = await val(`select id from public.tarefas_operacionais where rotina_empresa_id = $1 and prazo = '2026-10-07'`, [r6.rotina_id]);
const tAgenda = await val(`select id from public.tarefas_operacionais where rotina_empresa_id = $1 and prazo = '2026-10-09'`, [r3.rotina_id]);

// ---------- 4. cronômetro e tempo por tarefa ----------
console.log("\n4. Cronômetro e tempo por tarefa (relógio do servidor)");
await como(P.Ana); await hora("09:00:00");
const s1 = await val(`select public.central_entrar($1)`, [E.Alfa]);
checar("Ana entra na Alfa: cronômetro rodando", s1.estado === "rodando");
await erro("Ana não vê a Beta", `select public.central_entrar('${E.Beta}')`, "SEM_ACESSO_CLIENTE");
await hora("09:03:25");
await erro("não conclui com checklist incompleto", `select public.central_concluir_tarefa('${tConc}')`, "CHECKLIST_INCOMPLETO");
for (const it of (await db.query(`select id from public.central_tarefa_checklist where tarefa_id = $1`, [tConc])).rows) {
  await db.query(`select public.central_marcar_item($1, true)`, [it.id]);
}
const c1 = await val(`select public.central_concluir_tarefa($1)`, [tConc]);
checar("1ª tarefa em 00:03:25 (205 s)", c1.duracao_segundos === 205, JSON.stringify(c1));
await erro("não conclui duas vezes", `select public.central_concluir_tarefa('${tConc}')`, "JA_CONCLUIDA");
await erro("estagiária não conclui tarefa de outra pessoa", `select public.central_concluir_tarefa('${tAgenda}')`, "SEM_PERMISSAO");
await hora("09:04:25");
await db.query(`select public.central_sair($1, 'pausar')`, [s1.sessao_id]);
await hora("09:19:25");
const s1b = await val(`select public.central_entrar($1)`, [E.Alfa]);
checar("retoma a mesma sessão", s1b.sessao_id === s1.sessao_id && s1b.tempo_ativo === 265);
await hora("09:22:23");
const c2 = await val(`select public.central_concluir_tarefa($1)`, [tEmail]);
checar("2ª tarefa em 00:03:58 (pausa de 15 min não conta)", c2.duracao_segundos === 238, JSON.stringify(c2));
checar("tempo da tarefa gravado", (await val(`select duracao_segundos from public.tarefas_operacionais where id = $1`, [tEmail])) === 238);

await como(P.Bruna); await hora("10:00:00");
const sb = await val(`select public.central_entrar($1)`, [E.Beta]);
await erro("um cliente rodando por vez", `select public.central_entrar('${E.Alfa}')`, "OUTRO_CLIENTE_RODANDO");
await erro("concluir sem estar no cliente", `select public.central_concluir_tarefa('${tReun}')`, "ENTRE_NO_CLIENTE");

// ---------- 5. datas, transferência, pontual, anotação ----------
console.log("\n5. Datas, transferência, tarefa pontual, anotação");
await como(P.Ana);
await erro("estagiária não altera datas", `select public.central_alterar_datas('${tAgenda}', null, '2026-10-12')`, "SEM_PERMISSAO");
await erro("estagiária não transfere", `select public.central_transferir('${tAgenda}', '${P.Paulo}', '${P.Ana}')`, "SEM_PERMISSAO");
const pont = await val(`select public.central_criar_pontual($1, 'Ligar para o banco', '2026-10-08')`, [E.Alfa]);
checar("estagiária cria tarefa pontual para si", (await val(`select usuario_id from public.central_tarefa_responsaveis where tarefa_id = $1`, [pont])) === P.Ana);
await db.query(`select public.central_anotar($1, 'Notas com erro: repassar ao gestor')`, [E.Alfa]);
await como(P.Bruna);
await erro("diária não tem datas editáveis", `select public.central_alterar_datas('${tConc}', null, '2026-10-12')`, "DIARIA_SEM_DATAS");
const tRel = await val(`select id from public.tarefas_operacionais where rotina_empresa_id = $1 order by prazo limit 1`, [r4.rotina_id]);
await erro("meta depois da entrega", `select public.central_alterar_datas('${tRel}', '2026-10-12', '2026-10-10')`, "META_DEPOIS_DA_ENTREGA");
await db.query(`select public.central_alterar_datas($1, '2026-10-08', '2026-10-09')`, [tRel]);
checar("analista altera meta e entrega", (await val(`select data_meta::text from public.tarefas_operacionais where id = $1`, [tRel])) === "2026-10-08");
await db.query(`select public.central_transferir($1, $2, $3)`, [tAgenda, P.Paulo, P.Ana]);
checar("analista transfere Paulo → Ana", (await val(`select count(*) from public.central_tarefa_responsaveis where tarefa_id = $1 and usuario_id = $2`, [tAgenda, P.Ana])) == 1);

// ---------- 6. permissões editáveis ----------
console.log("\n6. Matriz de permissões");
await como(P.Ana);
await erro("só o Adm muda permissão", `select public.central_definir_permissao('estagiaria', 'concluir_outra', 's')`, "SEM_PERMISSAO");
await como(P.Adm);
await erro("linha do administrador é fixa", `select public.central_definir_permissao('administrador', 'rotina', 'n')`, "PAPEL_FIXO");
await db.query(`select public.central_definir_permissao('estagiaria', 'concluir_outra', 's')`);
checar("Adm libera: estagiária passa a poder mexer em tarefa de outra pessoa", (await val(`select public.central_pode_mexer($1, $2)`, [tReun, P.Ana])) === true);
await db.query(`select public.central_definir_permissao('estagiaria', 'concluir_outra', 'n')`);

// ---------- 7. senhas e acessos ----------
console.log("\n7. Senhas e acessos (cifrados)");
await como(P.Ana);
const ac = await val(`select public.central_salvar_acesso(null, $1, 'Banco Exemplo', 'banco', 'https://exemplo.com', 'operador-01', 'senha-ficticia-123', 'Token com a Ana')`, [E.Alfa]);
checar("estagiária cadastra acesso", ac.status === "ok");
const cifra = await val(`select encode(senha_cifrada, 'hex') from public.central_acessos where id = $1`, [ac.acesso_id]);
checar("senha gravada cifrada (não aparece em texto)", cifra && !Buffer.from(cifra, "hex").toString("latin1").includes("senha-ficticia-123"));
checar("revelar devolve a senha", (await val(`select public.central_revelar_senha($1, 'copiou')`, [ac.acesso_id])) === "senha-ficticia-123");
checar("consulta registrada no histórico", (await val(`select count(*) from public.eventos_operacionais where descricao = 'copiou a senha · Banco Exemplo'`)) == 1);
const alt = await val(`select public.central_salvar_acesso($1, null, null, null, null, null, 'nova', null)`, [ac.acesso_id]);
checar("estagiária alterar senha vira pedido", alt.status === "pedido");
await como(P.Adm);
await db.query(`select public.central_salvar_acesso($1, null, null, null, null, null, 'nova-senha-adm', null)`, [ac.acesso_id]);
checar("Adm altera a senha", (await val(`select public.central_revelar_senha($1)`, [ac.acesso_id])) === "nova-senha-adm");

// ---------- 8. clientes ----------
console.log("\n8. Clientes");
await como(P.Ana);
const cli = await val(`select public.central_salvar_cliente($1, '{"honorario_mensal": 9999, "grupo_principal": "Financeiro Alfa"}')`, [E.Alfa]);
checar("estagiária: honorário vira pedido, grupo é salvo", cli.status === "parcial" && (await val(`select grupo_principal from public.central_clientes where empresa_id = $1`, [E.Alfa])) === "Financeiro Alfa");
checar("honorário não mudou", (await val(`select honorario_mensal from public.central_clientes where empresa_id = $1`, [E.Alfa])) === null);
await como(P.Adm);
await db.query(`select public.central_encerrar_cliente($1)`, [E.Beta]);
checar("cliente encerrado não gera tarefa", (await val(`select public.central_gerar_tarefas('2026-12-01', '2026-12-31', $1)`, [r5.rotina_id])) == 0);
checar("encerrar apaga as futuras pendentes", (await val(`select count(*) from public.tarefas_operacionais where empresa_id = $1 and prazo > '2026-10-07'`, [E.Beta])) == 0);

// ---------- 9. fechamento das 22h ----------
console.log("\n9. Fechamento do dia (22h)");
await hora("22:00:00");
await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
const fechadas = await val(`select public.central_fechar_dia('2026-10-07')`);
checar("fecha as sessões do dia", fechadas == 2, `(fechou ${fechadas})`);
const sa = await um(`select estado, public.central_tempo_ativo(id) t, fechada_auto from public.central_sessoes where id = $1`, [s1.sessao_id]);
checar("Ana ficou rodando: fecha na última atividade (anotação às 10:00) → 265 s + 40:35 = 2700 s", sa.estado === "fechada" && sa.t === 2700 && sa.fechada_auto, JSON.stringify(sa));
const sbf = await um(`select public.central_tempo_ativo(id) t, fechada_auto from public.central_sessoes where id = $1`, [sb.sessao_id]);
checar("Bruna entrou e não fez nada → 0 s e marcada para revisar", sbf.t === 0 && sbf.fechada_auto);
await como(P.Ana);
await erro("depois das 22h ninguém entra", `select public.central_entrar('${E.Alfa}')`, "DIA_FECHADO");
await dia("2026-10-08", "08:00:00");
checar("no dia seguinte entra normalmente", (await val(`select public.central_entrar($1)`, [E.Alfa])).estado === "rodando");

// ---------- 10. RLS (lendo como o app) ----------
console.log("\n10. Regras de leitura (RLS) como o app");
await db.exec(`set role authenticated`);
await como(P.Ana);
const visAna = await val(`select string_agg(distinct empresa_nome, ',') from public.central_vw_tarefas`);
checar("Ana só vê a Alfa", visAna === "Alfa", visAna);
await erro("Ana não lê a senha cifrada", `select senha_cifrada from public.central_acessos`, "permission denied");
checar("Ana lê o acesso sem a senha", (await val(`select count(*) from public.central_acessos`)) == 1);
await erro("app não grava direto nas tabelas", `insert into public.central_vinculos values ('${E.Beta}', '${P.Ana}')`, "permission denied");
checar("histórico da Ana: só dela", (await val(`select count(distinct usuario_id) from public.central_vw_historico`)) == 1);
await como(P.Carlos);
const tiposCarlos = await val(`select string_agg(distinct tipo_recorrencia, ',' order by tipo_recorrencia) from public.central_vw_tarefas`);
checar("gestor financeiro: só mensais e pontuais, de todos os clientes", tiposCarlos === "mensal,pontual", tiposCarlos);
await como(P.Paulo);
checar("supervisor vê o histórico de todos", (await val(`select count(distinct usuario_id) from public.central_vw_historico`)) >= 3);
await db.exec(`reset role`);

const painel = (await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [P.Adm]), await db.query(`select * from public.central_painel('2026-10-01', '2026-10-31')`)).rows;
checar("painel da Home calcula por cliente", painel.length >= 1 && painel.some((r) => r.codigo === "101"));

console.log(`\n${ok} ok · ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);

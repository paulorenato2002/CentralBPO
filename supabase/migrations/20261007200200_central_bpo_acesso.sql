-- =============================================================================
-- Central BPO · 3/3 · Acesso (RLS), leitura (views) e privilégios
--
-- Regra geral: LER pelas tabelas/views (com RLS); ESCREVER só pelas funções.
-- Nenhuma tabela central_ concede INSERT/UPDATE/DELETE direto ao app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RLS nas tabelas novas
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'central_colaboradores', 'central_permissoes', 'central_clientes', 'central_vinculos',
    'central_rotina_responsaveis', 'central_rotina_checklist', 'central_tarefa_responsaveis',
    'central_tarefa_checklist', 'central_tarefa_observacoes', 'central_sessoes', 'central_dias_fechados',
    'central_anotacoes', 'central_acessos', 'central_solicitacoes'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon, authenticated;', t);
    execute format('grant select on public.%I to authenticated;', t);
  end loop;
end $$;

-- A senha cifrada nunca sai por SELECT: só pela função central_revelar_senha.
revoke select on public.central_acessos from authenticated;
grant select (id, empresa_id, sistema, tipo, link, usuario_login, observacoes, ativo, alterada_em, alterada_por, criado_por, created_at)
  on public.central_acessos to authenticated;

create or replace function public.central_ativo()
returns boolean language sql stable as $$ select public.central_papel(auth.uid()) is not null; $$;

drop policy if exists central_colaboradores_sel on public.central_colaboradores;
create policy central_colaboradores_sel on public.central_colaboradores for select to authenticated using (public.central_ativo());

drop policy if exists central_permissoes_sel on public.central_permissoes;
create policy central_permissoes_sel on public.central_permissoes for select to authenticated using (public.central_ativo());

drop policy if exists central_dias_fechados_sel on public.central_dias_fechados;
create policy central_dias_fechados_sel on public.central_dias_fechados for select to authenticated using (public.central_ativo());

drop policy if exists central_clientes_sel on public.central_clientes;
create policy central_clientes_sel on public.central_clientes for select to authenticated using (public.central_ve_empresa(empresa_id));

drop policy if exists central_vinculos_sel on public.central_vinculos;
create policy central_vinculos_sel on public.central_vinculos for select to authenticated
  using (public.central_ve_empresa(empresa_id) or usuario_id = auth.uid());

drop policy if exists central_anotacoes_sel on public.central_anotacoes;
create policy central_anotacoes_sel on public.central_anotacoes for select to authenticated using (public.central_ve_empresa(empresa_id));

drop policy if exists central_acessos_sel on public.central_acessos;
create policy central_acessos_sel on public.central_acessos for select to authenticated using (ativo and public.central_ve_empresa(empresa_id));

drop policy if exists central_rot_resp_sel on public.central_rotina_responsaveis;
create policy central_rot_resp_sel on public.central_rotina_responsaveis for select to authenticated
  using (exists (select 1 from public.rotinas_empresa r where r.id = rotina_empresa_id and public.central_ve_empresa(r.empresa_id)));

drop policy if exists central_rot_ck_sel on public.central_rotina_checklist;
create policy central_rot_ck_sel on public.central_rotina_checklist for select to authenticated
  using (exists (select 1 from public.rotinas_empresa r where r.id = rotina_empresa_id and public.central_ve_empresa(r.empresa_id)));

do $$
declare t text;
begin
  foreach t in array array['central_tarefa_responsaveis', 'central_tarefa_checklist', 'central_tarefa_observacoes'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_sel', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (exists (select 1 from public.tarefas_operacionais x where x.id = tarefa_id and public.central_ve_empresa(x.empresa_id)));$p$, t || '_sel', t);
  end loop;
end $$;

drop policy if exists central_sessoes_sel on public.central_sessoes;
create policy central_sessoes_sel on public.central_sessoes for select to authenticated
  using (usuario_id = auth.uid() or public.central_pode('ver_registros_todos'));

drop policy if exists central_solicitacoes_sel on public.central_solicitacoes;
create policy central_solicitacoes_sel on public.central_solicitacoes for select to authenticated
  using (solicitante = auth.uid() or public.central_papel(auth.uid()) = 'administrador');

-- -----------------------------------------------------------------------------
-- 2. Views de leitura para o app (security_invoker: valem as regras de quem lê)
-- -----------------------------------------------------------------------------
create or replace view public.central_vw_tarefas with (security_invoker = true) as
select
  t.id, t.empresa_id, e.codigo as empresa_codigo, coalesce(e.nome_fantasia, e.razao_social) as empresa_nome,
  t.rotina_empresa_id, t.titulo, t.tipo_recorrencia, t.prioridade, t.status,
  t.prazo, t.data_meta, coalesce(t.data_meta, t.prazo) as alvo,
  (t.status <> 'concluida' and coalesce(t.data_meta, t.prazo) < public.central_hoje()) as atrasada,
  t.concluida_em, t.concluida_por, t.duracao_segundos, t.created_by, t.created_at,
  coalesce((select array_agg(r.usuario_id order by r.usuario_id) from public.central_tarefa_responsaveis r where r.tarefa_id = t.id), '{}') as responsaveis,
  (select count(*) from public.central_tarefa_checklist c where c.tarefa_id = t.id) as checklist_total,
  (select count(*) from public.central_tarefa_checklist c where c.tarefa_id = t.id and c.marcado) as checklist_marcados,
  public.central_pode_mexer(t.id) as posso_concluir
from public.tarefas_operacionais t
join public.empresas e on e.id = t.empresa_id
where t.ativo and t.status <> 'cancelada' and t.tipo_recorrencia is not null
  and public.central_ve_empresa(t.empresa_id) and public.central_ve_tipo(t.tipo_recorrencia);

create or replace view public.central_vw_sessoes with (security_invoker = true) as
select s.*, public.central_tempo_ativo(s.id) as tempo_ativo_segundos,
       greatest(0, public.central_tempo_ativo(s.id) - s.checkpoint_segundos) as tarefa_atual_segundos
from public.central_sessoes s;

create or replace view public.central_vw_historico with (security_invoker = true) as
select ev.id, ev.created_at, ev.usuario_id, p.nome as usuario_nome, ev.empresa_id, e.codigo as empresa_codigo,
       coalesce(e.nome_fantasia, e.razao_social) as empresa_nome, ev.tipo_evento, ev.descricao, ev.dados,
       (ev.dados->>'tempo_ativo')::integer as tempo_ativo_segundos
from public.eventos_operacionais ev
left join public.perfis_usuarios p on p.usuario_id = ev.usuario_id
left join public.empresas e on e.id = ev.empresa_id
where ev.tipo_evento like 'central.%'
  and (ev.usuario_id = auth.uid() or public.central_pode('ver_registros_todos'))
  and (ev.empresa_id is null or public.central_ve_empresa(ev.empresa_id));

create or replace view public.central_vw_rotinas with (security_invoker = true) as
select re.id, re.empresa_id, e.codigo as empresa_codigo, coalesce(e.nome_fantasia, e.razao_social) as empresa_nome,
       m.nome, re.frequencia, re.regra_agendamento, re.vigencia_inicio, re.vigencia_fim, re.situacao,
       coalesce((select array_agg(x.usuario_id) from public.central_rotina_responsaveis x where x.rotina_empresa_id = re.id), '{}') as responsaveis,
       coalesce((select array_agg(c.texto order by c.ordem) from public.central_rotina_checklist c where c.rotina_empresa_id = re.id), '{}') as checklist
from public.rotinas_empresa re
join public.modelos_rotina m on m.id = re.modelo_rotina_id
join public.empresas e on e.id = re.empresa_id
where re.ativo and public.central_ve_empresa(re.empresa_id);

grant select on public.central_vw_tarefas, public.central_vw_sessoes, public.central_vw_historico, public.central_vw_rotinas to authenticated;
revoke all on public.central_vw_tarefas, public.central_vw_sessoes, public.central_vw_historico, public.central_vw_rotinas from anon;

-- -----------------------------------------------------------------------------
-- 3. Funções: quem pode chamar
-- -----------------------------------------------------------------------------
do $$
declare f record;
begin
  -- nenhuma função central_ é pública por padrão
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'central\_%' loop
    execute format('revoke all on function %s from public, anon;', f.sig);
    execute format('grant execute on function %s to authenticated, service_role;', f.sig);
  end loop;
end $$;

-- Só o servidor (rotina agendada / service_role) fecha o dia, gera tarefas e lê a chave.
revoke execute on function public.central_fechar_dia(date) from authenticated;
revoke execute on function public.central_gerar_tarefas(date, date, uuid) from authenticated;
revoke execute on function public.central_chave() from authenticated, service_role;
revoke execute on function public.central_fechar_trecho(uuid, timestamptz) from authenticated;
revoke execute on function public.central_fechar_atrasadas(uuid) from authenticated;
revoke execute on function public.central_registrar(text, uuid, text, text, uuid, jsonb, uuid, text) from authenticated;

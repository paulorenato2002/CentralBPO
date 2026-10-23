-- Central BPO · desempenho (23/10/2026)
-- As telas demoravam 3–5 s: para CADA tarefa (1.500+) o banco reconferia "esta pessoa vê este cliente?"
-- (papel + permissão + vínculo) e o tipo de tarefa. Agora a lista de clientes visíveis é calculada
-- UMA vez por consulta (central_empresas_visiveis, usada como subconsulta escalar = InitPlan) e
-- reaproveitada nas views, no painel e nas regras de leitura (RLS). Quem vê o quê não muda.

create or replace function public.central_empresas_visiveis(p_usuario uuid default auth.uid())
returns uuid[] language sql stable security definer set search_path = public, pg_catalog as $$
  select case
    when public.central_papel(p_usuario) is null then '{}'::uuid[]
    when public.central_pode('ver_todos_clientes', p_usuario) then (select coalesce(array_agg(e.id), '{}') from public.empresas e)
    else (select coalesce(array_agg(v.empresa_id), '{}') from public.central_vinculos v where v.usuario_id = p_usuario)
  end
$$;
revoke all on function public.central_empresas_visiveis(uuid) from public, anon;
grant execute on function public.central_empresas_visiveis(uuid) to authenticated, service_role;

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
  (exists (select 1 from public.central_tarefa_responsaveis r where r.tarefa_id = t.id and r.usuario_id = auth.uid()) or (select public.central_pode('concluir_outra'))) as posso_concluir
from public.tarefas_operacionais t
join public.empresas e on e.id = t.empresa_id
where t.ativo and t.status <> 'cancelada' and t.tipo_recorrencia is not null
  and t.empresa_id = any ((select public.central_empresas_visiveis())::uuid[])
  and ((select public.central_perm('tipos_tarefa')) = 'todas' or coalesce(t.tipo_recorrencia, 'pontual') in ('mensal', 'anual', 'pontual'));

create or replace view public.central_vw_historico with (security_invoker = true) as
select ev.id, ev.created_at, ev.usuario_id, p.nome as usuario_nome, ev.empresa_id, e.codigo as empresa_codigo,
       coalesce(e.nome_fantasia, e.razao_social) as empresa_nome, ev.tipo_evento, ev.descricao, ev.dados,
       (ev.dados->>'tempo_ativo')::integer as tempo_ativo_segundos
from public.eventos_operacionais ev
left join public.perfis_usuarios p on p.usuario_id = ev.usuario_id
left join public.empresas e on e.id = ev.empresa_id
where ev.tipo_evento like 'central.%'
  and (ev.usuario_id = auth.uid() or (select public.central_pode('ver_registros_todos')))
  and (ev.empresa_id is null or ev.empresa_id = any ((select public.central_empresas_visiveis())::uuid[]));

create or replace function public.central_painel(p_de date, p_ate date, p_so_minhas boolean default false)
returns table (empresa_id uuid, codigo text, nome text, atrasadas bigint, hoje bigint, previstas bigint, concluidas bigint)
language sql stable security definer set search_path = public, pg_catalog as $$
  with vis as (select public.central_empresas_visiveis() as ids, public.central_perm('tipos_tarefa') = 'todas' as todos_tipos, public.central_hoje() as hoje),
  base as (
    select t.empresa_id, t.status, coalesce(t.data_meta, t.prazo) as alvo
      from public.tarefas_operacionais t, vis
     where t.ativo and t.status <> 'cancelada'
       and t.empresa_id = any (vis.ids)
       and (vis.todos_tipos or coalesce(t.tipo_recorrencia, 'pontual') in ('mensal', 'anual', 'pontual'))
       and (not p_so_minhas or exists (select 1 from public.central_tarefa_responsaveis r where r.tarefa_id = t.id and r.usuario_id = auth.uid()))
       and (t.status <> 'concluida' or coalesce(t.data_meta, t.prazo) between p_de and p_ate)
  )
  select e.id, e.codigo::text, coalesce(e.nome_fantasia, e.razao_social),
    count(*) filter (where b.alvo < vis.hoje and b.status <> 'concluida'),
    count(*) filter (where b.alvo = vis.hoje and b.status <> 'concluida'),
    count(*) filter (where b.alvo > vis.hoje and b.alvo between p_de and p_ate and b.status <> 'concluida'),
    count(*) filter (where b.alvo between p_de and p_ate and b.status = 'concluida')
  from vis, public.empresas e
  left join public.central_clientes cc on cc.empresa_id = e.id
  join base b on b.empresa_id = e.id
  where coalesce(cc.situacao, 'ativa') <> 'encerrada'
  group by e.id, e.codigo, e.nome_fantasia, e.razao_social
  order by e.codigo;
$$;

-- regras de leitura (RLS): mesma regra, calculada uma vez por consulta
drop policy if exists central_empresas_select on public.empresas;
create policy central_empresas_select on public.empresas for select to authenticated using (id = any ((select public.central_empresas_visiveis())::uuid[]));
drop policy if exists central_clientes_sel on public.central_clientes;
create policy central_clientes_sel on public.central_clientes for select to authenticated using (empresa_id = any ((select public.central_empresas_visiveis())::uuid[]));
drop policy if exists central_vinculos_sel on public.central_vinculos;
create policy central_vinculos_sel on public.central_vinculos for select to authenticated using (empresa_id = any ((select public.central_empresas_visiveis())::uuid[]) or usuario_id = auth.uid());
drop policy if exists central_anotacoes_sel on public.central_anotacoes;
create policy central_anotacoes_sel on public.central_anotacoes for select to authenticated using (empresa_id = any ((select public.central_empresas_visiveis())::uuid[]));
drop policy if exists central_acessos_sel on public.central_acessos;
create policy central_acessos_sel on public.central_acessos for select to authenticated using (ativo and empresa_id = any ((select public.central_empresas_visiveis())::uuid[]));
drop policy if exists central_rot_resp_sel on public.central_rotina_responsaveis;
create policy central_rot_resp_sel on public.central_rotina_responsaveis for select to authenticated
  using (exists (select 1 from public.rotinas_empresa x where x.id = rotina_empresa_id and x.empresa_id = any ((select public.central_empresas_visiveis())::uuid[])));
drop policy if exists central_rot_ck_sel on public.central_rotina_checklist;
create policy central_rot_ck_sel on public.central_rotina_checklist for select to authenticated
  using (exists (select 1 from public.rotinas_empresa x where x.id = rotina_empresa_id and x.empresa_id = any ((select public.central_empresas_visiveis())::uuid[])));
do $$
declare t text;
begin
  foreach t in array array['central_tarefa_responsaveis', 'central_tarefa_checklist', 'central_tarefa_observacoes'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_sel', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (exists (select 1 from public.tarefas_operacionais x where x.id = tarefa_id and x.empresa_id = any ((select public.central_empresas_visiveis())::uuid[])));$p$, t || '_sel', t);
  end loop;
end $$;
drop policy if exists central_sessoes_sel on public.central_sessoes;
create policy central_sessoes_sel on public.central_sessoes for select to authenticated
  using (usuario_id = auth.uid() or (select public.central_pode('ver_registros_todos')));

-- índices para as consultas das telas
create index if not exists tarefas_op_central_alvo_idx on public.tarefas_operacionais (empresa_id, (coalesce(data_meta, prazo))) where ativo;
create index if not exists eventos_op_central_idx on public.eventos_operacionais (created_at desc) where tipo_evento like 'central.%';

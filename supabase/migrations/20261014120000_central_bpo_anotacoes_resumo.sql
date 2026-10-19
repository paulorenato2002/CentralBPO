-- Central BPO · anotações do dia para o relatório e resumo do dia (14/10/2026)
-- 1. central_anotacoes ganha: para (destinatários; vazio = analistas vinculados ao cliente),
--    verificada_em/por (alguém conferiu a observação) e origem ('tela' | 'agente').
-- 2. central_anotar aceita destinatários e origem; central_verificar_anotacao; central_marcar_anotacoes_enviadas.
-- 3. central_resumo_dia(p_dia): posição das tarefas por cliente, para o e-mail diário do agente.
--    Com o token de uma pessoa, segue o que ela vê; com a chave de serviço (rotina agendada), vê todos os clientes ativos.
-- 4. central_vw_equipe: nome, e-mail e papel de quem está na Central (destinatários do relatório).

alter table public.central_anotacoes add column if not exists para uuid[];
alter table public.central_anotacoes add column if not exists verificada_em timestamptz;
alter table public.central_anotacoes add column if not exists verificada_por uuid references public.perfis_usuarios(usuario_id);
alter table public.central_anotacoes add column if not exists origem varchar(10) not null default 'tela';
alter table public.central_anotacoes drop constraint if exists central_anot_origem_check;
alter table public.central_anotacoes add constraint central_anot_origem_check check (origem in ('tela', 'agente'));
create index if not exists central_anotacoes_pendentes_idx on public.central_anotacoes (empresa_id, created_at) where verificada_em is null;

-- a assinatura antiga (uuid, text) sai para não haver duas versões da função
drop function if exists public.central_anotar(uuid, text);
create or replace function public.central_anotar(p_empresa uuid, p_texto text, p_para uuid[] default null, p_origem text default 'tela')
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_id uuid;
begin
  if not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  if coalesce(p_origem, 'tela') not in ('tela', 'agente') then raise exception 'ACAO_INVALIDA'; end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'DADOS_INCOMPLETOS'; end if;
  if p_para is not null and exists (select 1 from unnest(p_para) x where not exists (select 1 from public.central_colaboradores c where c.usuario_id = x and c.ativo)) then
    raise exception 'DESTINO_INVALIDO';
  end if;
  insert into public.central_anotacoes (empresa_id, usuario_id, dia, texto, para, origem)
  values (p_empresa, u, public.central_hoje(), trim(p_texto), nullif(p_para, '{}'), coalesce(p_origem, 'tela'))
  returning id into v_id;
  update public.central_sessoes set ultima_atividade = public.central_agora()
   where usuario_id = u and empresa_id = p_empresa and dia = public.central_hoje() and estado = 'rodando';
  perform public.central_registrar('anotacao', p_empresa, 'registrou uma anotação', 'central_anotacoes', v_id);
  return v_id;
end $$;
revoke all on function public.central_anotar(uuid, text, uuid[], text) from public, anon;
grant execute on function public.central_anotar(uuid, text, uuid[], text) to authenticated;

create or replace function public.central_verificar_anotacao(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); a public.central_anotacoes;
begin
  select * into a from public.central_anotacoes where id = p_id for update;
  if not found or not public.central_ve_empresa(a.empresa_id) then raise exception 'ACESSO_INVALIDO'; end if;
  if a.verificada_em is not null then return; end if;
  update public.central_anotacoes set verificada_em = public.central_agora(), verificada_por = u where id = p_id;
  perform public.central_registrar('anotacao', a.empresa_id, 'verificou a anotação: ' || left(a.texto, 80), 'central_anotacoes', p_id);
end $$;
revoke all on function public.central_verificar_anotacao(uuid) from public, anon;
grant execute on function public.central_verificar_anotacao(uuid) to authenticated;

-- chamada pelo agente depois de enviar o relatório (pela pessoa logada ou pela rotina agendada)
create or replace function public.central_marcar_anotacoes_enviadas(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then perform public.central_eu(); end if;
  update public.central_anotacoes a set enviada_em = now()
   where a.id = any(p_ids) and a.enviada_em is null
     and (coalesce(auth.role(), '') = 'service_role' or public.central_ve_empresa(a.empresa_id));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.central_marcar_anotacoes_enviadas(uuid[]) from public, anon;
grant execute on function public.central_marcar_anotacoes_enviadas(uuid[]) to authenticated, service_role;

create or replace function public.central_resumo_dia(p_dia date default null)
returns table (empresa_id uuid, codigo text, nome text, abertas_no_dia bigint, concluidas_no_dia bigint,
               atrasadas bigint, maior_atraso_dias integer, pendentes_por_tipo jsonb, concluidas_por jsonb)
language sql stable security definer set search_path = public, pg_catalog as $$
  with dia as (select coalesce(p_dia, public.central_hoje()) as d),
  servico as (select coalesce(auth.role(), '') = 'service_role' as s),
  emp as (
    select e.id, e.codigo::text as codigo, coalesce(e.nome_fantasia, e.razao_social)::text as nome
      from public.empresas e
      left join public.central_clientes cc on cc.empresa_id = e.id
     where coalesce(cc.situacao, 'ativa') <> 'encerrada'
       and ((select s from servico) or public.central_ve_empresa(e.id))),
  t as (
    select t.empresa_id, t.status, t.tipo_recorrencia, t.concluida_por, coalesce(t.data_meta, t.prazo) as alvo,
           (t.concluida_em at time zone 'America/Sao_Paulo')::date as dia_conclusao
      from public.tarefas_operacionais t
      join emp on emp.id = t.empresa_id
     where t.ativo and t.status <> 'cancelada' and t.tipo_recorrencia is not null
       and ((select s from servico) or public.central_ve_tipo(t.tipo_recorrencia)))
  select emp.id, emp.codigo, emp.nome,
         count(t.*) filter (where t.alvo = (select d from dia) and t.status <> 'concluida'),
         count(t.*) filter (where t.status = 'concluida' and t.dia_conclusao = (select d from dia)),
         count(t.*) filter (where t.status <> 'concluida' and t.alvo < (select d from dia)),
         coalesce(max((select d from dia) - t.alvo) filter (where t.status <> 'concluida' and t.alvo < (select d from dia)), 0)::integer,
         coalesce((select jsonb_object_agg(x.tipo, x.n) from (
           select t2.tipo_recorrencia as tipo, count(*) as n from t t2
            where t2.empresa_id = emp.id and t2.status <> 'concluida' and t2.alvo <= (select d from dia) group by 1) x), '{}'::jsonb),
         coalesce((select jsonb_object_agg(x.quem, x.n) from (
           select coalesce(p.nome, '?') as quem, count(*) as n from t t3
             left join public.perfis_usuarios p on p.usuario_id = t3.concluida_por
            where t3.empresa_id = emp.id and t3.status = 'concluida' and t3.dia_conclusao = (select d from dia) group by 1) x), '{}'::jsonb)
    from emp
    left join t on t.empresa_id = emp.id
   group by emp.id, emp.codigo, emp.nome
   order by emp.codigo;
$$;
revoke all on function public.central_resumo_dia(date) from public, anon;
grant execute on function public.central_resumo_dia(date) to authenticated, service_role;

create or replace view public.central_vw_equipe with (security_invoker = true) as
select c.usuario_id, p.nome, p.email, c.papel_central as papel, c.ativo
  from public.central_colaboradores c
  join public.perfis_usuarios p on p.usuario_id = c.usuario_id;
grant select on public.central_vw_equipe to authenticated, service_role;
revoke all on public.central_vw_equipe from anon;
revoke insert, update, delete on public.central_vw_equipe from authenticated;

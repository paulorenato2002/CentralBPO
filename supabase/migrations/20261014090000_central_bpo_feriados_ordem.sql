-- Central BPO · feriados e ordem das tarefas (14/10/2026)
-- 1. Feriados: tabela central_feriados (nacionais 2026-2027; o Adm pode incluir os locais).
--    Na geração: diária não nasce em feriado; as outras (e a data meta) vão para o dia útil anterior.
--    Vale também para fim de semana: mensal que cairia no sábado/domingo passa para a sexta.
-- 2. Ordem: rotinas_empresa.ordem define a sequência das tarefas em cada cliente
--    (ex.: conciliação > notas > contas a pagar > contas a receber). Quem pode mexer em rotina reordena.

create table if not exists public.central_feriados (
  dia        date primary key,
  nome       text not null,
  created_at timestamptz not null default now()
);
alter table public.central_feriados enable row level security;
drop policy if exists central_feriados_sel on public.central_feriados;
create policy central_feriados_sel on public.central_feriados for select to authenticated using (public.central_ativo());
grant select on public.central_feriados to authenticated;
revoke all on public.central_feriados from anon;
revoke insert, update, delete on public.central_feriados from authenticated;

insert into public.central_feriados (dia, nome) values
  ('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'), ('2026-11-20', 'Dia da Consciência Negra'),
  ('2026-12-25', 'Natal'), ('2027-01-01', 'Confraternização Universal'), ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'), ('2027-05-01', 'Dia do Trabalho'), ('2027-09-07', 'Independência'),
  ('2027-10-12', 'Nossa Senhora Aparecida'), ('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia da Consciência Negra'), ('2027-12-25', 'Natal')
on conflict (dia) do nothing;

create or replace function public.central_dia_util(p_dia date)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select extract(isodow from p_dia) < 6 and not exists (select 1 from public.central_feriados f where f.dia = p_dia)
$$;
create or replace function public.central_dia_util_anterior(p_dia date)
returns date language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare d date := p_dia - 1;
begin
  while not public.central_dia_util(d) and d > p_dia - 15 loop d := d - 1; end loop;
  return d;
end $$;
revoke all on function public.central_dia_util(date) from public, anon, authenticated;
revoke all on function public.central_dia_util_anterior(date) from public, anon, authenticated;

alter table public.rotinas_empresa add column if not exists ordem integer;

create or replace function public.central_gerar_tarefas(p_de date, p_ate date, p_rotina uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare r record; d date; v_dia date; v_id uuid; v_meta date; v_dia_meta integer; n integer := 0;
begin
  for r in
    select re.*, m.nome as nome_modelo
      from public.rotinas_empresa re
      join public.modelos_rotina m on m.id = re.modelo_rotina_id
      left join public.central_clientes cc on cc.empresa_id = re.empresa_id
     where re.ativo and re.situacao = 'ativa'
       and re.frequencia in ('diaria', 'semanal', 'quinzenal', 'mensal', 'anual')
       and coalesce(cc.situacao, 'ativa') <> 'encerrada'
       and (p_rotina is null or re.id = p_rotina)
  loop
    begin
      for d in select generate_series(greatest(p_de, coalesce(r.vigencia_inicio, p_de)), least(p_ate, coalesce(r.vigencia_fim, p_ate)), interval '1 day')::date loop
        if public.central_rotina_bate(r.frequencia, r.regra_agendamento, r.vigencia_inicio, d) then
          -- feriado ou fim de semana: diária não gera; as outras vão para o dia útil anterior
          v_dia := d;
          if not public.central_dia_util(d) then
            if r.frequencia = 'diaria' then continue; end if;
            v_dia := public.central_dia_util_anterior(d);
          end if;
          v_meta := null;
          v_dia_meta := public.central_int(r.regra_agendamento->>'dia_meta');
          if r.frequencia in ('mensal', 'anual') and v_dia_meta is not null then
            v_meta := make_date(extract(year from d)::integer, extract(month from d)::integer, least(v_dia_meta, extract(day from d)::integer));
            if not public.central_dia_util(v_meta) then v_meta := public.central_dia_util_anterior(v_meta); end if;
            v_meta := least(v_meta, v_dia);
          end if;
          insert into public.tarefas_operacionais
            (empresa_id, rotina_empresa_id, modelo_rotina_id, responsavel_id, titulo, prazo, data_meta, tipo_recorrencia,
             prioridade, status, origem, chave_idempotencia)
          values (r.empresa_id, r.id, r.modelo_rotina_id, r.responsavel_id, r.nome_modelo, v_dia, v_meta, r.frequencia,
                  r.prioridade, 'pendente', 'agendador', 'central:' || r.id || ':' || d)
          on conflict (chave_idempotencia) where chave_idempotencia is not null do nothing
          returning id into v_id;
          if v_id is not null then
            insert into public.central_tarefa_responsaveis (tarefa_id, usuario_id)
            select v_id, x.usuario_id from public.central_rotina_responsaveis x where x.rotina_empresa_id = r.id
            union select v_id, r.responsavel_id where r.responsavel_id is not null
              and not exists (select 1 from public.central_rotina_responsaveis x where x.rotina_empresa_id = r.id)
            on conflict do nothing;
            insert into public.central_tarefa_checklist (tarefa_id, ordem, texto)
            select v_id, c.ordem, c.texto from public.central_rotina_checklist c where c.rotina_empresa_id = r.id;
            n := n + 1;
            v_id := null;
          end if;
        end if;
      end loop;
    exception when others then
      -- uma rotina com problema não derruba as outras; fica registrada para corrigir
      perform public.central_registrar('rotina', r.empresa_id,
        'não gerou tarefas da rotina "' || r.nome_modelo || '": ' || sqlerrm, 'rotinas_empresa', r.id, '{}'::jsonb, null, 'sistema');
    end;
  end loop;
  return n;
end $$;

-- ordem das rotinas para o app (view própria: as views antigas não ganham coluna nova)
create or replace view public.central_vw_ordem with (security_invoker = true) as
select re.id as rotina_id, re.empresa_id, re.ordem
from public.rotinas_empresa re
where re.ativo and public.central_ve_empresa(re.empresa_id);
grant select on public.central_vw_ordem to authenticated;
revoke all on public.central_vw_ordem from anon;
revoke insert, update, delete on public.central_vw_ordem from authenticated;

-- reordenar as tarefas de um cliente: a lista de rotinas na ordem desejada
create or replace function public.central_ordenar_rotinas(p_empresa uuid, p_rotinas uuid[])
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu();
begin
  if not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  if not public.central_pode('rotina') then raise exception 'SEM_PERMISSAO'; end if;
  update public.rotinas_empresa re set ordem = x.pos, updated_by = u
    from unnest(p_rotinas) with ordinality as x(id, pos)
   where re.id = x.id and re.empresa_id = p_empresa;
  perform public.central_registrar('rotina', p_empresa, 'reordenou as tarefas do cliente', 'empresas', p_empresa);
end $$;
revoke all on function public.central_ordenar_rotinas(uuid, uuid[]) from public, anon;
grant execute on function public.central_ordenar_rotinas(uuid, uuid[]) to authenticated;

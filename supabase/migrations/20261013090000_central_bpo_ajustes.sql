-- =============================================================================
-- Central BPO · ajustes depois da conferência com o banco real (13/10/2026)
--
-- 1. As rotinas existentes guardam a regra em formatos que a 1ª versão não lia:
--      semanal  {"dia_semana": "sexta"}          (texto, não número)
--      mensal   {"dias_mes": [1, 15]}            (mais de um dia no mês)
--      anual    {"mes": 1, "dia_mes": 13}
--    A leitura passa a aceitar todos, sem nunca derrubar a geração por causa
--    de uma regra mal preenchida (regra inválida = não gera, e segue).
-- 2. tarefas_operacionais passa a aceitar tipo_recorrencia 'anual'.
-- 3. As views de leitura perdem INSERT/UPDATE/DELETE para o app (só leitura).
-- =============================================================================

-- número de 1 a 7 (isodow) a partir de número ou nome do dia, em português
create or replace function public.central_dia_semana(p_valor text)
returns integer language plpgsql immutable as $$
declare v text := lower(translate(trim(coalesce(p_valor, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'));
begin
  if v ~ '^[0-9]+$' then
    return case when v::integer between 1 and 7 then v::integer when v::integer = 0 then 7 end;
  end if;
  v := split_part(replace(v, '-feira', ''), ' ', 1);
  return case v when 'segunda' then 1 when 'terca' then 2 when 'quarta' then 3 when 'quinta' then 4
                when 'sexta' then 5 when 'sabado' then 6 when 'domingo' then 7 end;
end $$;

-- inteiro seguro: devolve null em vez de erro
create or replace function public.central_int(p_valor text)
returns integer language sql immutable as $$
  select case when trim(coalesce(p_valor, '')) ~ '^[0-9]+$' then trim(p_valor)::integer end;
$$;

create or replace function public.central_rotina_bate(p_frequencia text, p_regra jsonb, p_inicio date, p_dia date)
returns boolean language plpgsql immutable as $$
declare
  dow integer := extract(isodow from p_dia);
  ult integer := extract(day from (date_trunc('month', p_dia) + interval '1 month - 1 day'))::integer;
  dia integer := extract(day from p_dia)::integer;
  r jsonb := coalesce(p_regra, '{}'::jsonb);
  s0 date; volta integer; alvo integer;
begin
  if p_frequencia = 'diaria' then return dow <= 5; end if;

  if p_frequencia = 'semanal' then
    if not (r ? 'dia_semana') then return dow = 5; end if;          -- sem dia informado: sexta
    return dow = public.central_dia_semana(r->>'dia_semana');      -- dia inválido: não gera
  end if;

  if p_frequencia = 'mensal' then
    if jsonb_typeof(r->'dias_mes') = 'array' then
      return exists (select 1 from jsonb_array_elements_text(r->'dias_mes') x
                     where public.central_int(x) is not null and least(public.central_int(x), ult) = dia);
    end if;
    alvo := public.central_int(r->>'dia_mes');
    return alvo is not null and least(alvo, ult) = dia;
  end if;

  if p_frequencia = 'anual' then
    alvo := public.central_int(r->>'dia_mes');
    return public.central_int(r->>'mes') = extract(month from p_dia)::integer and alvo is not null and least(alvo, ult) = dia;
  end if;

  if p_frequencia = 'quinzenal' then
    if dow > 5 or p_inicio is null then return false; end if;
    for volta in 0..2 loop
      s0 := p_dia - volta;
      exit when volta > 0 and extract(isodow from s0) <= 5;
      if s0 >= p_inicio and (s0 - p_inicio) % 15 = 0 then return true; end if;
    end loop;
    return false;
  end if;

  return false;
end $$;

-- tipo 'anual' passa a valer nas tarefas
alter table public.tarefas_operacionais drop constraint if exists tarefas_op_tipo_recorrencia_check;
alter table public.tarefas_operacionais add constraint tarefas_op_tipo_recorrencia_check
  check (tipo_recorrencia is null or tipo_recorrencia in ('diaria', 'semanal', 'quinzenal', 'mensal', 'anual', 'pontual'));

-- geração: inclui 'anual', lê dia_meta com segurança e nunca para por uma rotina ruim
create or replace function public.central_gerar_tarefas(p_de date, p_ate date, p_rotina uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare r record; d date; v_id uuid; v_meta date; v_dia_meta integer; n integer := 0;
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
          v_meta := null;
          v_dia_meta := public.central_int(r.regra_agendamento->>'dia_meta');
          if r.frequencia in ('mensal', 'anual') and v_dia_meta is not null then
            v_meta := make_date(extract(year from d)::integer, extract(month from d)::integer, least(v_dia_meta, extract(day from d)::integer));
          end if;
          insert into public.tarefas_operacionais
            (empresa_id, rotina_empresa_id, modelo_rotina_id, responsavel_id, titulo, prazo, data_meta, tipo_recorrencia,
             prioridade, status, origem, chave_idempotencia)
          values (r.empresa_id, r.id, r.modelo_rotina_id, r.responsavel_id, r.nome_modelo, d, v_meta, r.frequencia,
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

-- views: só leitura para o app
revoke insert, update, delete on public.central_vw_tarefas, public.central_vw_sessoes, public.central_vw_historico, public.central_vw_rotinas from authenticated;

-- funções novas: mesma regra de acesso das demais
revoke all on function public.central_dia_semana(text) from public, anon;
revoke all on function public.central_int(text) from public, anon;
grant execute on function public.central_dia_semana(text) to authenticated, service_role;
grant execute on function public.central_int(text) to authenticated, service_role;
revoke execute on function public.central_gerar_tarefas(date, date, uuid) from authenticated;

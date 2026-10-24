-- Central BPO · salvar a tarefa (rotina) atualiza também as abertas de hoje e as atrasadas (24/10/2026)
-- Antes só as de amanhã em diante eram refeitas: quem mudava checklist ou responsável e voltava na tela
-- de hoje via tudo igual. Agora as pendentes até hoje recebem os novos responsáveis e o novo checklist;
-- itens já marcados ficam (com quem marcou), itens não marcados que saíram da lista somem.

create or replace function public.central_sincronizar_abertas(p_rotina uuid)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare t record; n integer := 0;
begin
  for t in select id from public.tarefas_operacionais
            where rotina_empresa_id = p_rotina and ativo and status = 'pendente' and prazo <= public.central_hoje() loop
    delete from public.central_tarefa_responsaveis where tarefa_id = t.id;
    insert into public.central_tarefa_responsaveis (tarefa_id, usuario_id)
    select t.id, usuario_id from public.central_rotina_responsaveis where rotina_empresa_id = p_rotina on conflict do nothing;

    delete from public.central_tarefa_checklist where tarefa_id = t.id and not marcado;
    update public.central_tarefa_checklist set ordem = ordem + 10000 where tarefa_id = t.id;
    insert into public.central_tarefa_checklist (tarefa_id, ordem, texto)
    select t.id, 5000 + rc.ordem, rc.texto from public.central_rotina_checklist rc
     where rc.rotina_empresa_id = p_rotina
       and not exists (select 1 from public.central_tarefa_checklist x where x.tarefa_id = t.id and x.texto = rc.texto);
    -- renumera na ordem da lista nova; marcados que saíram da lista vão para o fim
    update public.central_tarefa_checklist c set ordem = o.nova
      from (select x.id, row_number() over (order by coalesce(
              (select min(rc.ordem) from public.central_rotina_checklist rc where rc.rotina_empresa_id = p_rotina and rc.texto = x.texto),
              1000 + (x.ordem % 5000)), x.ordem) as nova
              from public.central_tarefa_checklist x where x.tarefa_id = t.id) o
     where c.id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.central_sincronizar_abertas(uuid) from public, anon, authenticated;

create or replace function public.central_salvar_rotina(
  p_id uuid, p_empresa uuid, p_nome text, p_frequencia text, p_regra jsonb,
  p_inicio date, p_fim date, p_ativa boolean, p_responsaveis uuid[], p_checklist text[])
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  u uuid := public.central_eu();
  v_modelo uuid; v_id uuid := p_id; v_codigo text; v_amanha date := public.central_hoje() + 1; v_novas integer;
begin
  if not public.central_pode('rotina') then
    return public.central_solicitar('rotina', p_empresa,
      case when p_id is null then 'rotina nova "' || coalesce(p_nome, '') || '"' else 'alteração da rotina "' || coalesce(p_nome, '') || '"' end,
      'rotinas_empresa', p_id);
  end if;
  if p_frequencia not in ('diaria', 'semanal', 'quinzenal', 'mensal', 'anual') then raise exception 'FREQUENCIA_INVALIDA'; end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then raise exception 'NOME_OBRIGATORIO'; end if;
  if coalesce(array_length(p_responsaveis, 1), 0) = 0 then raise exception 'RESPONSAVEL_OBRIGATORIO'; end if;
  if p_inicio is null then raise exception 'INICIO_OBRIGATORIO'; end if;
  if p_fim is not null and p_fim < p_inicio then raise exception 'VIGENCIA_INVALIDA'; end if;
  if p_frequencia = 'semanal' and coalesce((p_regra->>'dia_semana')::integer, 0) not between 1 and 5 then raise exception 'DIA_SEMANA_INVALIDO'; end if;
  if p_frequencia = 'mensal' then
    if coalesce((p_regra->>'dia_mes')::integer, 0) not between 1 and 31 then raise exception 'DIA_MES_INVALIDO'; end if;
    if (p_regra->>'dia_meta') is not null and (p_regra->>'dia_meta')::integer > (p_regra->>'dia_mes')::integer then raise exception 'META_DEPOIS_DA_ENTREGA'; end if;
  end if;
  if p_frequencia = 'anual' then
    if coalesce((p_regra->>'dia_mes')::integer, 0) not between 1 and 31 then raise exception 'DIA_MES_INVALIDO'; end if;
    if coalesce((p_regra->>'mes')::integer, 0) not between 1 and 12 then raise exception 'MES_INVALIDO'; end if;
  end if;

  v_codigo := 'central-' || left(regexp_replace(lower(translate(trim(p_nome),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '-', 'g'), 40);
  select id into v_modelo from public.modelos_rotina where codigo = v_codigo and versao = 1;
  if v_modelo is null then
    insert into public.modelos_rotina (codigo, nome, categoria, frequencia, situacao, created_by)
    values (v_codigo, trim(p_nome), 'operacional', p_frequencia, 'ativa', u) returning id into v_modelo;
  end if;

  if v_id is null then
    if exists (select 1 from public.rotinas_empresa where empresa_id = p_empresa and modelo_rotina_id = v_modelo and ativo and situacao = 'ativa') then
      raise exception 'ROTINA_JA_EXISTE';
    end if;
    insert into public.rotinas_empresa (empresa_id, modelo_rotina_id, responsavel_id, frequencia, regra_agendamento,
                                        vigencia_inicio, vigencia_fim, situacao, created_by)
    values (p_empresa, v_modelo, p_responsaveis[1], p_frequencia, coalesce(p_regra, '{}'::jsonb), p_inicio, p_fim,
            case when p_ativa then 'ativa' else 'pausada' end, u)
    returning id into v_id;
  else
    update public.rotinas_empresa
       set modelo_rotina_id = v_modelo, responsavel_id = p_responsaveis[1], frequencia = p_frequencia,
           regra_agendamento = coalesce(p_regra, '{}'::jsonb), vigencia_inicio = p_inicio, vigencia_fim = p_fim,
           situacao = case when p_ativa then 'ativa' else 'pausada' end, updated_by = u
     where id = v_id;
  end if;

  delete from public.central_rotina_responsaveis where rotina_empresa_id = v_id;
  insert into public.central_rotina_responsaveis (rotina_empresa_id, usuario_id) select v_id, x from unnest(p_responsaveis) x on conflict do nothing;
  delete from public.central_rotina_checklist where rotina_empresa_id = v_id;
  insert into public.central_rotina_checklist (rotina_empresa_id, ordem, texto)
  select v_id, ord, trim(txt) from unnest(coalesce(p_checklist, '{}'::text[])) with ordinality as c(txt, ord) where length(trim(txt)) > 0;

  -- refaz as futuras (a partir de amanhã) que ainda não foram concluídas
  delete from public.tarefas_operacionais where rotina_empresa_id = v_id and status = 'pendente' and prazo >= v_amanha;
  v_novas := public.central_gerar_tarefas(v_amanha, (date_trunc('month', v_amanha) + interval '2 months - 1 day')::date, v_id);

  -- e as abertas de hoje/atrasadas passam a seguir o novo checklist e os novos responsáveis
  perform public.central_sincronizar_abertas(v_id);

  perform public.central_registrar('rotina', p_empresa,
    case when p_id is null then 'cadastrou a rotina "' else 'alterou a rotina "' end || trim(p_nome) || '" (' || p_frequencia || ')',
    'rotinas_empresa', v_id, jsonb_build_object('tarefas_geradas', v_novas));
  return jsonb_build_object('status', 'ok', 'rotina_id', v_id, 'tarefas_geradas', v_novas);
end $$;

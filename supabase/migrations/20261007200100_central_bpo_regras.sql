-- =============================================================================
-- Central BPO · 2/3 · Regras de negócio (funções)
--
-- Toda escrita da Central passa por estas funções (SECURITY DEFINER). Elas
-- conferem quem está logado, o papel e a matriz de permissões, gravam e
-- registram o evento no histórico (public.eventos_operacionais).
-- O tempo é calculado NO BANCO, com o relógio do servidor: o navegador não
-- consegue inflar nem encolher o cronômetro.
-- Erros saem com códigos curtos em MAIÚSCULAS para o app traduzir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Relógio e calendário
-- -----------------------------------------------------------------------------
-- Agora. Testes (usuário sem papel de API) podem fixar a hora em central.agora;
-- chamadas pela API ignoram essa configuração.
create or replace function public.central_agora()
returns timestamptz language plpgsql stable as $$
declare v text;
begin
  if current_user not in ('authenticated', 'anon') then
    v := nullif(current_setting('central.agora', true), '');
    if v is not null then return v::timestamptz; end if;
  end if;
  return now();
end $$;

create or replace function public.central_hoje()
returns date language sql stable as $$
  select (public.central_agora() at time zone 'America/Sao_Paulo')::date;
$$;

create or replace function public.central_hms(segundos integer)
returns text language sql immutable as $$
  select lpad((greatest(segundos, 0) / 3600)::text, 2, '0') || ':' ||
         lpad(((greatest(segundos, 0) % 3600) / 60)::text, 2, '0') || ':' ||
         lpad((greatest(segundos, 0) % 60)::text, 2, '0');
$$;

create or replace function public.central_dmy(d date)
returns text language sql immutable as $$ select to_char(d, 'DD/MM/YYYY'); $$;

-- -----------------------------------------------------------------------------
-- 2. Quem está logado e o que pode
-- -----------------------------------------------------------------------------
create or replace function public.central_papel(p_usuario uuid default auth.uid())
returns text language sql stable security definer set search_path = public, pg_catalog as $$
  select c.papel_central
  from public.central_colaboradores c
  join public.perfis_usuarios p on p.usuario_id = c.usuario_id
  where c.usuario_id = p_usuario and c.ativo and p.ativo;
$$;

-- Usuário logado e ativo na Central; senão, erro.
create or replace function public.central_eu()
returns uuid language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null or public.central_papel(auth.uid()) is null then
    raise exception 'SEM_ACESSO' using hint = 'Usuário sem cadastro ativo na Central BPO.';
  end if;
  return auth.uid();
end $$;

create or replace function public.central_perm(p_acao text, p_usuario uuid default auth.uid())
returns text language sql stable security definer set search_path = public, pg_catalog as $$
  select case
    when public.central_papel(p_usuario) is null then 'n'
    when public.central_papel(p_usuario) = 'administrador' then case when p_acao = 'tipos_tarefa' then 'todas' else 's' end
    else coalesce((select valor from public.central_permissoes
                   where papel_central = public.central_papel(p_usuario) and acao = p_acao), 'n')
  end;
$$;

create or replace function public.central_pode(p_acao text, p_usuario uuid default auth.uid())
returns boolean language sql stable as $$ select public.central_perm(p_acao, p_usuario) = 's'; $$;

create or replace function public.central_ve_empresa(p_empresa uuid, p_usuario uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select public.central_papel(p_usuario) is not null and (
    public.central_pode('ver_todos_clientes', p_usuario)
    or exists (select 1 from public.central_vinculos v where v.empresa_id = p_empresa and v.usuario_id = p_usuario));
$$;

create or replace function public.central_ve_tipo(p_tipo text, p_usuario uuid default auth.uid())
returns boolean language sql stable as $$
  select public.central_perm('tipos_tarefa', p_usuario) = 'todas' or coalesce(p_tipo, 'pontual') in ('mensal', 'pontual');
$$;

-- Responsável ou papel que pode concluir tarefa de outra pessoa.
create or replace function public.central_pode_mexer(p_tarefa uuid, p_usuario uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.central_tarefa_responsaveis r where r.tarefa_id = p_tarefa and r.usuario_id = p_usuario)
      or public.central_pode('concluir_outra', p_usuario);
$$;

-- -----------------------------------------------------------------------------
-- 3. Histórico e pedidos ao Adm
-- -----------------------------------------------------------------------------
create or replace function public.central_registrar(
  p_tipo text, p_empresa uuid, p_descricao text,
  p_entidade_tipo text default null, p_entidade_id uuid default null,
  p_dados jsonb default '{}'::jsonb, p_usuario uuid default auth.uid(), p_origem text default 'aplicacao')
returns void language sql security definer set search_path = public, pg_catalog as $$
  insert into public.eventos_operacionais
    (tipo_evento, entidade_tipo, entidade_id, empresa_id, usuario_id, severidade, descricao, dados, origem, created_at)
  values ('central.' || p_tipo, p_entidade_tipo, p_entidade_id, p_empresa, p_usuario, 'info', p_descricao, coalesce(p_dados, '{}'::jsonb), p_origem, public.central_agora());
$$;

create or replace function public.central_solicitar(
  p_acao text, p_empresa uuid, p_descricao text, p_entidade_tipo text default null, p_entidade_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_id uuid;
begin
  insert into public.central_solicitacoes (solicitante, acao, empresa_id, entidade_tipo, entidade_id, descricao)
  values (u, p_acao, p_empresa, p_entidade_tipo, p_entidade_id, p_descricao) returning id into v_id;
  perform public.central_registrar('pedido', p_empresa, 'pediu ao Adm: ' || p_descricao, 'central_solicitacoes', v_id);
  return jsonb_build_object('status', 'pedido', 'solicitacao_id', v_id);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Cronômetro
-- -----------------------------------------------------------------------------
-- Tempo ativo (segundos) de uma sessão: soma dos trechos. Pausa não conta.
create or replace function public.central_tempo_ativo(p_sessao uuid, p_ate timestamptz default null)
returns integer language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(sum(greatest(0, extract(epoch from (least(coalesce(a.fim, x.ate), x.ate) - a.inicio))))::integer, 0)
  from public.apontamentos_tempo a
  cross join (select coalesce(p_ate, public.central_agora()) as ate) x
  where a.sessao_id = p_sessao and a.inicio <= x.ate;
$$;

create or replace function public.central_dia_fechado(p_dia date default null)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.central_dias_fechados where dia = coalesce(p_dia, public.central_hoje()));
$$;

-- "tarefas incompletas X/Y" do cliente hoje
create or replace function public.central_incompletas(p_empresa uuid)
returns text language sql stable security definer set search_path = public, pg_catalog as $$
  select 'tarefas incompletas ' || count(*) filter (where t.status <> 'concluida') || '/' || count(*)
  from public.tarefas_operacionais t
  where t.empresa_id = p_empresa and t.ativo and t.status <> 'cancelada'
    and coalesce(t.data_meta, t.prazo) = public.central_hoje();
$$;

-- Fecha um trecho aberto da sessão (no instante informado ou agora).
create or replace function public.central_fechar_trecho(p_sessao uuid, p_quando timestamptz default null)
returns void language sql security definer set search_path = public, pg_catalog as $$
  update public.apontamentos_tempo
     set fim = greatest(inicio, coalesce(p_quando, public.central_agora())), status = 'concluido', updated_at = now()
   where sessao_id = p_sessao and status = 'em_andamento';
$$;

-- Sessões de dias anteriores que ficaram abertas (cron não rodou): fecha na última atividade.
create or replace function public.central_fechar_atrasadas(p_usuario uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare s record;
begin
  for s in select * from public.central_sessoes
           where usuario_id = p_usuario and dia < public.central_hoje() and estado <> 'fechada' loop
    if s.estado = 'rodando' then
      perform public.central_fechar_trecho(s.id, s.ultima_atividade);
      update public.central_sessoes set fechada_auto = true where id = s.id;
    end if;
    update public.central_sessoes set estado = 'fechada' where id = s.id;
  end loop;
end $$;

-- Entrar no cliente: inicia, retoma ou reabre o cronômetro da pessoa naquele cliente.
create or replace function public.central_entrar(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  u uuid := public.central_eu();
  v_hoje date := public.central_hoje();
  v_agora timestamptz := public.central_agora();
  s public.central_sessoes;
  outra public.central_sessoes;
  v_texto text;
begin
  if not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  if public.central_dia_fechado(v_hoje) then raise exception 'DIA_FECHADO'; end if;
  perform public.central_fechar_atrasadas(u);

  select * into outra from public.central_sessoes where usuario_id = u and estado = 'rodando' limit 1;
  if found and outra.empresa_id <> p_empresa then
    raise exception 'OUTRO_CLIENTE_RODANDO' using detail = outra.empresa_id::text, hint = 'Pause ou finalize o cliente atual antes de entrar em outro.';
  end if;
  if found then
    return jsonb_build_object('sessao_id', outra.id, 'estado', outra.estado, 'tempo_ativo', public.central_tempo_ativo(outra.id));
  end if;

  select * into s from public.central_sessoes where usuario_id = u and empresa_id = p_empresa and dia = v_hoje;
  if not found then
    insert into public.central_sessoes (usuario_id, empresa_id, dia, estado, ultima_atividade)
    values (u, p_empresa, v_hoje, 'rodando', v_agora) returning * into s;
    v_texto := 'iniciou as rotinas';
  else
    if s.estado = 'fechada' then raise exception 'DIA_FECHADO'; end if;
    v_texto := case when s.estado = 'finalizada' then 'reabriu as rotinas depois de finalizar' else 'retomou as rotinas' end;
    update public.central_sessoes set estado = 'rodando', ultima_atividade = v_agora, finalizada_em = null where id = s.id returning * into s;
  end if;

  insert into public.apontamentos_tempo (usuario_id, empresa_id, sessao_id, inicio, status)
  values (u, p_empresa, s.id, v_agora, 'em_andamento');

  perform public.central_registrar('cronometro', p_empresa, v_texto, 'central_sessoes', s.id,
    jsonb_build_object('tempo_ativo', public.central_tempo_ativo(s.id)));
  return jsonb_build_object('sessao_id', s.id, 'estado', 'rodando', 'tempo_ativo', public.central_tempo_ativo(s.id));
end $$;

-- Sair do cliente: pausar (volto hoje) ou finalizar (terminei hoje).
create or replace function public.central_sair(p_sessao uuid, p_modo text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  u uuid := public.central_eu();
  s public.central_sessoes;
  v_ativo integer;
begin
  if p_modo not in ('pausar', 'finalizar') then raise exception 'MODO_INVALIDO'; end if;
  select * into s from public.central_sessoes where id = p_sessao for update;
  if not found or s.usuario_id <> u then raise exception 'SESSAO_INVALIDA'; end if;
  if s.estado = 'fechada' then raise exception 'DIA_FECHADO'; end if;
  if p_modo = 'pausar' and s.estado <> 'rodando' then raise exception 'SESSAO_NAO_RODANDO'; end if;
  if p_modo = 'finalizar' and s.estado = 'finalizada' then raise exception 'JA_FINALIZADA'; end if;

  perform public.central_fechar_trecho(s.id);
  v_ativo := public.central_tempo_ativo(s.id);
  update public.central_sessoes
     set estado = case when p_modo = 'pausar' then 'pausada' else 'finalizada' end,
         finalizada_em = case when p_modo = 'finalizar' then public.central_agora() end
   where id = s.id;

  perform public.central_registrar('cronometro', s.empresa_id,
    case when p_modo = 'pausar' then 'pausou as rotinas · ' else 'finalizou as rotinas · ' end || public.central_incompletas(s.empresa_id),
    'central_sessoes', s.id, jsonb_build_object('tempo_ativo', v_ativo));
  return jsonb_build_object('sessao_id', s.id, 'estado', case when p_modo = 'pausar' then 'pausada' else 'finalizada' end, 'tempo_ativo', v_ativo);
end $$;

-- Fechamento do dia (22h, rotina agendada): congela o registro de horas.
create or replace function public.central_fechar_dia(p_dia date default null)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_dia date := coalesce(p_dia, public.central_hoje());
  s public.central_sessoes;
  n integer := 0;
begin
  for s in select * from public.central_sessoes where dia <= v_dia and estado <> 'fechada' for update loop
    if s.estado = 'rodando' then
      perform public.central_fechar_trecho(s.id, s.ultima_atividade);   -- ficou rodando: fecha na última atividade
      update public.central_sessoes set fechada_auto = true where id = s.id;
    end if;
    update public.central_sessoes set estado = 'fechada' where id = s.id;
    perform public.central_registrar('cronometro', s.empresa_id,
      'registro do dia fechado às 22h · tempo final ' || public.central_hms(public.central_tempo_ativo(s.id)) ||
      case when s.estado = 'rodando' then ' · estava rodando, fechado na última atividade · revisar' else '' end,
      'central_sessoes', s.id, jsonb_build_object('tempo_ativo', public.central_tempo_ativo(s.id), 'auto', s.estado = 'rodando'),
      s.usuario_id, 'sistema');
    n := n + 1;
  end loop;
  insert into public.central_dias_fechados (dia, fechado_em) values (v_dia, public.central_agora()) on conflict (dia) do nothing;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Tarefas
-- -----------------------------------------------------------------------------
-- Concluir = checkpoint. Tempo da tarefa = tempo ativo agora − tempo ativo no checkpoint anterior.
create or replace function public.central_concluir_tarefa(p_tarefa uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  u uuid := public.central_eu();
  t public.tarefas_operacionais;
  s public.central_sessoes;
  v_ativo integer; v_dur integer;
  v_resp text; v_alvo date; v_extra text := '';
begin
  select * into t from public.tarefas_operacionais where id = p_tarefa and ativo for update;
  if not found or not public.central_ve_empresa(t.empresa_id) then raise exception 'TAREFA_INVALIDA'; end if;
  if t.status = 'concluida' then raise exception 'JA_CONCLUIDA'; end if;
  if not public.central_pode_mexer(t.id) then raise exception 'SEM_PERMISSAO'; end if;
  if exists (select 1 from public.central_tarefa_checklist c where c.tarefa_id = t.id and not c.marcado) then
    raise exception 'CHECKLIST_INCOMPLETO';
  end if;
  if public.central_dia_fechado() then raise exception 'DIA_FECHADO'; end if;

  select * into s from public.central_sessoes
   where usuario_id = u and empresa_id = t.empresa_id and dia = public.central_hoje() and estado = 'rodando' for update;
  if not found then raise exception 'ENTRE_NO_CLIENTE' using hint = 'Entre no cliente (cronômetro rodando) para concluir.'; end if;

  v_ativo := public.central_tempo_ativo(s.id);
  v_dur := greatest(0, v_ativo - s.checkpoint_segundos);
  update public.central_sessoes set checkpoint_segundos = v_ativo, ultima_atividade = public.central_agora() where id = s.id;
  update public.tarefas_operacionais
     set status = 'concluida', concluida_em = public.central_agora(), concluida_por = u,
         duracao_segundos = v_dur, duracao_real_minutos = ceil(v_dur / 60.0)::integer, updated_by = u
   where id = t.id;

  v_alvo := coalesce(t.data_meta, t.prazo);
  if v_alvo < public.central_hoje() then v_extra := ' (atrasada de ' || public.central_dmy(v_alvo) || ')'; end if;
  if not exists (select 1 from public.central_tarefa_responsaveis r where r.tarefa_id = t.id and r.usuario_id = u) then
    select string_agg(p.nome, ', ') into v_resp from public.central_tarefa_responsaveis r join public.perfis_usuarios p on p.usuario_id = r.usuario_id where r.tarefa_id = t.id;
    if v_resp is not null then v_extra := v_extra || ' (responsável: ' || v_resp || ')'; end if;
  end if;
  perform public.central_registrar('tarefa', t.empresa_id,
    'concluiu a tarefa "' || t.titulo || '"' || v_extra || ' em ' || public.central_hms(v_dur),
    'tarefas_operacionais', t.id, jsonb_build_object('duracao_segundos', v_dur, 'tempo_ativo', v_ativo));
  return jsonb_build_object('tarefa_id', t.id, 'duracao_segundos', v_dur, 'tempo_ativo', v_ativo);
end $$;

create or replace function public.central_marcar_item(p_item uuid, p_marcado boolean)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_tarefa uuid; v_status text;
begin
  select c.tarefa_id, t.status into v_tarefa, v_status
    from public.central_tarefa_checklist c join public.tarefas_operacionais t on t.id = c.tarefa_id where c.id = p_item;
  if v_tarefa is null then raise exception 'ITEM_INVALIDO'; end if;
  if v_status = 'concluida' then raise exception 'JA_CONCLUIDA'; end if;
  if not public.central_pode_mexer(v_tarefa) then raise exception 'SEM_PERMISSAO'; end if;
  update public.central_tarefa_checklist
     set marcado = p_marcado, marcado_por = case when p_marcado then u end, marcado_em = case when p_marcado then public.central_agora() end
   where id = p_item;
end $$;

create or replace function public.central_adicionar_item(p_tarefa uuid, p_texto text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_id uuid; v_status text;
begin
  select status into v_status from public.tarefas_operacionais where id = p_tarefa;
  if v_status is null then raise exception 'TAREFA_INVALIDA'; end if;
  if v_status = 'concluida' then raise exception 'JA_CONCLUIDA'; end if;
  if not public.central_pode_mexer(p_tarefa) then raise exception 'SEM_PERMISSAO'; end if;
  insert into public.central_tarefa_checklist (tarefa_id, ordem, texto)
  values (p_tarefa, coalesce((select max(ordem) from public.central_tarefa_checklist where tarefa_id = p_tarefa), 0) + 1, trim(p_texto))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.central_comentar(p_tarefa uuid, p_texto text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); t public.tarefas_operacionais; v_id uuid;
begin
  select * into t from public.tarefas_operacionais where id = p_tarefa;
  if not found or not public.central_ve_empresa(t.empresa_id) then raise exception 'TAREFA_INVALIDA'; end if;
  insert into public.central_tarefa_observacoes (tarefa_id, usuario_id, texto) values (p_tarefa, u, trim(p_texto)) returning id into v_id;
  update public.central_sessoes set ultima_atividade = public.central_agora()
   where usuario_id = u and empresa_id = t.empresa_id and dia = public.central_hoje() and estado = 'rodando';
  perform public.central_registrar('tarefa', t.empresa_id, 'comentou na tarefa "' || t.titulo || '"', 'tarefas_operacionais', t.id);
  return v_id;
end $$;

create or replace function public.central_transferir(p_tarefa uuid, p_de uuid, p_para uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); t public.tarefas_operacionais; v_de text; v_para text;
begin
  if not public.central_pode('transferir') then raise exception 'SEM_PERMISSAO'; end if;
  select * into t from public.tarefas_operacionais where id = p_tarefa for update;
  if not found or not public.central_ve_empresa(t.empresa_id) then raise exception 'TAREFA_INVALIDA'; end if;
  if t.status = 'concluida' then raise exception 'JA_CONCLUIDA'; end if;
  if public.central_papel(p_para) is null then raise exception 'DESTINO_INVALIDO'; end if;
  if not exists (select 1 from public.central_tarefa_responsaveis where tarefa_id = p_tarefa and usuario_id = p_de) then raise exception 'ORIGEM_INVALIDA'; end if;
  if exists (select 1 from public.central_tarefa_responsaveis where tarefa_id = p_tarefa and usuario_id = p_para) then raise exception 'JA_RESPONSAVEL'; end if;
  update public.central_tarefa_responsaveis set usuario_id = p_para where tarefa_id = p_tarefa and usuario_id = p_de;
  select nome into v_de from public.perfis_usuarios where usuario_id = p_de;
  select nome into v_para from public.perfis_usuarios where usuario_id = p_para;
  perform public.central_registrar('tarefa', t.empresa_id, 'transferiu a tarefa "' || t.titulo || '" de ' || v_de || ' para ' || v_para, 'tarefas_operacionais', t.id);
end $$;

create or replace function public.central_alterar_datas(p_tarefa uuid, p_meta date, p_prazo date)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); t public.tarefas_operacionais;
begin
  if not public.central_pode('alterar_datas') then raise exception 'SEM_PERMISSAO'; end if;
  select * into t from public.tarefas_operacionais where id = p_tarefa for update;
  if not found or not public.central_ve_empresa(t.empresa_id) then raise exception 'TAREFA_INVALIDA'; end if;
  if t.tipo_recorrencia = 'diaria' then raise exception 'DIARIA_SEM_DATAS'; end if;
  if t.status = 'concluida' then raise exception 'JA_CONCLUIDA'; end if;
  if p_prazo is null then raise exception 'PRAZO_OBRIGATORIO'; end if;
  if p_meta is not null and p_meta > p_prazo then raise exception 'META_DEPOIS_DA_ENTREGA'; end if;
  update public.tarefas_operacionais set data_meta = p_meta, prazo = p_prazo, updated_by = u where id = t.id;
  perform public.central_registrar('tarefa', t.empresa_id,
    'alterou as datas de "' || t.titulo || '": meta ' || coalesce(public.central_dmy(t.data_meta), 'sem meta') || ' → ' || coalesce(public.central_dmy(p_meta), 'sem meta') ||
    ' · entrega ' || public.central_dmy(t.prazo) || ' → ' || public.central_dmy(p_prazo), 'tarefas_operacionais', t.id);
end $$;

create or replace function public.central_criar_pontual(p_empresa uuid, p_titulo text, p_data date)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_id uuid;
begin
  if not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  if length(trim(coalesce(p_titulo, ''))) = 0 or p_data is null then raise exception 'DADOS_INCOMPLETOS'; end if;
  insert into public.tarefas_operacionais (empresa_id, titulo, prazo, tipo_recorrencia, status, origem, created_by, metadados)
  values (p_empresa, trim(p_titulo), p_data, 'pontual', 'pendente', 'aplicacao', u, jsonb_build_object('criada_por', u))
  returning id into v_id;
  insert into public.central_tarefa_responsaveis (tarefa_id, usuario_id) values (v_id, u);
  perform public.central_registrar('tarefa', p_empresa, 'criou a tarefa pontual "' || trim(p_titulo) || '" para ' || public.central_dmy(p_data), 'tarefas_operacionais', v_id);
  return v_id;
end $$;

create or replace function public.central_anotar(p_empresa uuid, p_texto text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_id uuid;
begin
  if not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  insert into public.central_anotacoes (empresa_id, usuario_id, dia, texto) values (p_empresa, u, public.central_hoje(), trim(p_texto)) returning id into v_id;
  update public.central_sessoes set ultima_atividade = public.central_agora()
   where usuario_id = u and empresa_id = p_empresa and dia = public.central_hoje() and estado = 'rodando';
  perform public.central_registrar('anotacao', p_empresa, 'registrou uma anotação', 'central_anotacoes', v_id);
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Rotinas e geração das tarefas
-- -----------------------------------------------------------------------------
-- A rotina cai neste dia? Diária seg–sex · semanal no dia da semana (1=seg … 5=sex)
-- · quinzenal a cada 15 dias desde o início (sáb/dom passa para segunda) · mensal no dia (mês menor: último dia).
create or replace function public.central_rotina_bate(p_frequencia text, p_regra jsonb, p_inicio date, p_dia date)
returns boolean language plpgsql immutable as $$
declare dow integer := extract(isodow from p_dia); s0 date; volta integer;
begin
  if p_frequencia = 'diaria' then return dow <= 5; end if;
  if p_frequencia = 'semanal' then return dow = coalesce((p_regra->>'dia_semana')::integer, 5); end if;
  if p_frequencia = 'mensal' then
    return extract(day from p_dia) = least(coalesce((p_regra->>'dia_mes')::integer, 1),
                                           extract(day from (date_trunc('month', p_dia) + interval '1 month - 1 day'))::integer);
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

-- Gera as tarefas das rotinas ativas entre duas datas. Idempotente (chave por rotina+dia).
create or replace function public.central_gerar_tarefas(p_de date, p_ate date, p_rotina uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare r record; d date; v_id uuid; v_meta date; n integer := 0;
begin
  for r in
    select re.*, m.nome as nome_modelo
      from public.rotinas_empresa re
      join public.modelos_rotina m on m.id = re.modelo_rotina_id
      left join public.central_clientes cc on cc.empresa_id = re.empresa_id
     where re.ativo and re.situacao = 'ativa'
       and re.frequencia in ('diaria', 'semanal', 'quinzenal', 'mensal')
       and coalesce(cc.situacao, 'ativa') <> 'encerrada'
       and (p_rotina is null or re.id = p_rotina)
  loop
    for d in select generate_series(greatest(p_de, coalesce(r.vigencia_inicio, p_de)), least(p_ate, coalesce(r.vigencia_fim, p_ate)), interval '1 day')::date loop
      if public.central_rotina_bate(r.frequencia, r.regra_agendamento, r.vigencia_inicio, d) then
        v_meta := null;
        if r.frequencia = 'mensal' and (r.regra_agendamento->>'dia_meta') is not null then
          v_meta := make_date(extract(year from d)::integer, extract(month from d)::integer,
                              least((r.regra_agendamento->>'dia_meta')::integer, extract(day from d)::integer));
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
  end loop;
  return n;
end $$;

-- Cria ou altera uma rotina (só quem tem a permissão "rotina"; os demais viram pedido ao Adm).
-- Mudança vale a partir de amanhã: futuras não concluídas são refeitas; as de hoje e as concluídas ficam.
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
  if p_frequencia not in ('diaria', 'semanal', 'quinzenal', 'mensal') then raise exception 'FREQUENCIA_INVALIDA'; end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then raise exception 'NOME_OBRIGATORIO'; end if;
  if coalesce(array_length(p_responsaveis, 1), 0) = 0 then raise exception 'RESPONSAVEL_OBRIGATORIO'; end if;
  if p_inicio is null then raise exception 'INICIO_OBRIGATORIO'; end if;
  if p_fim is not null and p_fim < p_inicio then raise exception 'VIGENCIA_INVALIDA'; end if;
  if p_frequencia = 'semanal' and coalesce((p_regra->>'dia_semana')::integer, 0) not between 1 and 5 then raise exception 'DIA_SEMANA_INVALIDO'; end if;
  if p_frequencia = 'mensal' then
    if coalesce((p_regra->>'dia_mes')::integer, 0) not between 1 and 31 then raise exception 'DIA_MES_INVALIDO'; end if;
    if (p_regra->>'dia_meta') is not null and (p_regra->>'dia_meta')::integer > (p_regra->>'dia_mes')::integer then raise exception 'META_DEPOIS_DA_ENTREGA'; end if;
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

  perform public.central_registrar('rotina', p_empresa,
    case when p_id is null then 'cadastrou a rotina "' else 'alterou a rotina "' end || trim(p_nome) || '" (' || p_frequencia || ')',
    'rotinas_empresa', v_id, jsonb_build_object('tarefas_geradas', v_novas));
  return jsonb_build_object('status', 'ok', 'rotina_id', v_id, 'tarefas_geradas', v_novas);
end $$;

create or replace function public.central_excluir_rotina(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); r public.rotinas_empresa; v_nome text;
begin
  select * into r from public.rotinas_empresa where id = p_id;
  if not found then raise exception 'ROTINA_INVALIDA'; end if;
  select nome into v_nome from public.modelos_rotina where id = r.modelo_rotina_id;
  if not public.central_pode('rotina') then
    return public.central_solicitar('rotina', r.empresa_id, 'exclusão da rotina "' || v_nome || '"', 'rotinas_empresa', p_id);
  end if;
  update public.rotinas_empresa set situacao = 'encerrada', ativo = false, updated_by = u where id = p_id;
  delete from public.tarefas_operacionais where rotina_empresa_id = p_id and status = 'pendente' and prazo > public.central_hoje();
  perform public.central_registrar('rotina', r.empresa_id, 'excluiu a rotina "' || v_nome || '"', 'rotinas_empresa', p_id);
  return jsonb_build_object('status', 'ok');
end $$;

-- -----------------------------------------------------------------------------
-- 7. Clientes
-- -----------------------------------------------------------------------------
-- p_dados: {codigo, razao_social, nome_fantasia, cnpj, situacao, prioridade, segmento, regime_tributario,
--           honorario_mensal, plano, inicio_contrato, sistema_financeiro, grupo_principal, email_financeiro,
--           endereco, cidade, cep, particularidades, socios:[], contatos:[], equipe:[uuid]}
create or replace function public.central_salvar_cliente(p_empresa uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  u uuid := public.central_eu();
  v_id uuid := p_empresa;
  e public.empresas; c public.central_clientes;
  v_sens boolean := public.central_pode('cliente_sensivel');
  v_mud text[] := '{}'; v_pedido text[] := '{}';
  v_cnpj text := regexp_replace(coalesce(p_dados->>'cnpj', ''), '\D', '', 'g');
begin
  if not public.central_pode('cliente_cadastrar') then
    return public.central_solicitar('cliente_cadastrar', p_empresa,
      case when p_empresa is null then 'cliente novo "' || coalesce(p_dados->>'nome_fantasia', '') || '"' else 'alteração de cadastro do cliente' end,
      'empresas', p_empresa);
  end if;

  if v_id is null then
    if length(v_cnpj) <> 14 then raise exception 'CNPJ_INVALIDO'; end if;
    if coalesce(p_dados->>'codigo', '') = '' or coalesce(p_dados->>'razao_social', '') = '' then raise exception 'DADOS_INCOMPLETOS'; end if;
    insert into public.empresas (codigo, razao_social, nome_fantasia, cnpj, segmento, regime_tributario, created_by)
    values (p_dados->>'codigo', p_dados->>'razao_social', p_dados->>'nome_fantasia', v_cnpj, p_dados->>'segmento', p_dados->>'regime_tributario', u)
    returning id into v_id;
    insert into public.central_clientes (empresa_id, situacao, prioridade, honorario_mensal, plano, inicio_contrato, sistema_financeiro,
      grupo_principal, email_financeiro, endereco, cidade, cep, particularidades, socios, contatos, updated_by)
    values (v_id, coalesce(p_dados->>'situacao', 'implantacao'), coalesce(p_dados->>'prioridade', 'normal'), (p_dados->>'honorario_mensal')::numeric,
      p_dados->>'plano', (p_dados->>'inicio_contrato')::date, p_dados->>'sistema_financeiro', p_dados->>'grupo_principal', p_dados->>'email_financeiro',
      p_dados->>'endereco', p_dados->>'cidade', p_dados->>'cep', p_dados->>'particularidades',
      coalesce(p_dados->'socios', '[]'::jsonb), coalesce(p_dados->'contatos', '[]'::jsonb), u);
    insert into public.central_vinculos (empresa_id, usuario_id)
    select v_id, x::uuid from jsonb_array_elements_text(coalesce(p_dados->'equipe', jsonb_build_array(u::text))) x on conflict do nothing;
    perform public.central_registrar('cliente', v_id, 'cadastrou o cliente ' || (p_dados->>'codigo') || ' - ' || coalesce(p_dados->>'nome_fantasia', p_dados->>'razao_social'), 'empresas', v_id);
    return jsonb_build_object('status', 'ok', 'empresa_id', v_id);
  end if;

  if not public.central_ve_empresa(v_id) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  select * into e from public.empresas where id = v_id for update;
  insert into public.central_clientes (empresa_id) values (v_id) on conflict do nothing;
  select * into c from public.central_clientes where empresa_id = v_id for update;

  -- sensíveis: só quem tem cliente_sensivel; senão vira pedido
  if p_dados ? 'razao_social' and p_dados->>'razao_social' is distinct from e.razao_social then
    if v_sens then update public.empresas set razao_social = p_dados->>'razao_social' where id = v_id; v_mud := v_mud || ('razão social: ' || e.razao_social || ' → ' || (p_dados->>'razao_social'));
    else v_pedido := v_pedido || 'razão social'::text; end if;
  end if;
  if p_dados ? 'cnpj' and v_cnpj is distinct from e.cnpj then
    if length(v_cnpj) <> 14 then raise exception 'CNPJ_INVALIDO'; end if;
    if v_sens then update public.empresas set cnpj = v_cnpj where id = v_id; v_mud := v_mud || ('CNPJ: ' || e.cnpj || ' → ' || v_cnpj);
    else v_pedido := v_pedido || 'CNPJ'::text; end if;
  end if;
  if p_dados ? 'honorario_mensal' and (p_dados->>'honorario_mensal')::numeric is distinct from c.honorario_mensal then
    if v_sens then update public.central_clientes set honorario_mensal = (p_dados->>'honorario_mensal')::numeric where empresa_id = v_id;
      v_mud := v_mud || ('honorário: ' || coalesce(c.honorario_mensal::text, 'vazio') || ' → ' || (p_dados->>'honorario_mensal'));
    else v_pedido := v_pedido || 'honorário'::text; end if;
  end if;
  if p_dados ? 'plano' and p_dados->>'plano' is distinct from c.plano then
    if v_sens then update public.central_clientes set plano = p_dados->>'plano' where empresa_id = v_id; v_mud := v_mud || ('plano: ' || coalesce(c.plano, 'vazio') || ' → ' || (p_dados->>'plano'));
    else v_pedido := v_pedido || 'plano'::text; end if;
  end if;
  if p_dados ? 'socios' and p_dados->'socios' is distinct from c.socios then
    if v_sens then update public.central_clientes set socios = p_dados->'socios' where empresa_id = v_id; v_mud := v_mud || 'sócios atualizados'::text;
    else v_pedido := v_pedido || 'sócios'::text; end if;
  end if;
  if p_dados ? 'situacao' and p_dados->>'situacao' = 'encerrada' and c.situacao <> 'encerrada' then
    raise exception 'USE_ENCERRAR_CLIENTE';
  end if;

  -- dados gerais
  update public.empresas set
    nome_fantasia = coalesce(p_dados->>'nome_fantasia', nome_fantasia),
    segmento = coalesce(p_dados->>'segmento', segmento),
    regime_tributario = coalesce(p_dados->>'regime_tributario', regime_tributario),
    updated_by = u
  where id = v_id;
  update public.central_clientes set
    situacao = coalesce(p_dados->>'situacao', situacao),
    prioridade = coalesce(p_dados->>'prioridade', prioridade),
    inicio_contrato = coalesce((p_dados->>'inicio_contrato')::date, inicio_contrato),
    sistema_financeiro = coalesce(p_dados->>'sistema_financeiro', sistema_financeiro),
    grupo_principal = coalesce(p_dados->>'grupo_principal', grupo_principal),
    email_financeiro = coalesce(p_dados->>'email_financeiro', email_financeiro),
    endereco = coalesce(p_dados->>'endereco', endereco),
    cidade = coalesce(p_dados->>'cidade', cidade),
    cep = coalesce(p_dados->>'cep', cep),
    particularidades = coalesce(p_dados->>'particularidades', particularidades),
    contatos = coalesce(p_dados->'contatos', contatos),
    updated_by = u
  where empresa_id = v_id;
  if p_dados ? 'grupo_principal' and p_dados->>'grupo_principal' is distinct from c.grupo_principal then
    v_mud := v_mud || ('grupo principal: ' || coalesce(c.grupo_principal, 'vazio') || ' → ' || (p_dados->>'grupo_principal'));
  end if;
  if p_dados ? 'equipe' then
    delete from public.central_vinculos where empresa_id = v_id
      and usuario_id not in (select x::uuid from jsonb_array_elements_text(p_dados->'equipe') x);
    insert into public.central_vinculos (empresa_id, usuario_id)
    select v_id, x::uuid from jsonb_array_elements_text(p_dados->'equipe') x on conflict do nothing;
  end if;

  if array_length(v_mud, 1) > 0 then
    perform public.central_registrar('cliente', v_id, 'alterou o cadastro · ' || array_to_string(v_mud, ' · '), 'empresas', v_id);
  end if;
  if array_length(v_pedido, 1) > 0 then
    perform public.central_solicitar('cliente_sensivel', v_id, 'alterar ' || array_to_string(v_pedido, ', ') || ' do cliente', 'empresas', v_id);
    return jsonb_build_object('status', 'parcial', 'pedido_ao_adm', v_pedido);
  end if;
  return jsonb_build_object('status', 'ok', 'empresa_id', v_id);
end $$;

create or replace function public.central_encerrar_cliente(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu();
begin
  if not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  if not public.central_pode('cliente_sensivel') then
    return public.central_solicitar('cliente_sensivel', p_empresa, 'encerramento do cliente', 'empresas', p_empresa);
  end if;
  insert into public.central_clientes (empresa_id) values (p_empresa) on conflict do nothing;
  update public.central_clientes set situacao = 'encerrada', updated_by = u where empresa_id = p_empresa;
  delete from public.tarefas_operacionais where empresa_id = p_empresa and status = 'pendente' and prazo > public.central_hoje() and rotina_empresa_id is not null;
  perform public.central_registrar('cliente', p_empresa, 'encerrou o cliente', 'empresas', p_empresa);
  return jsonb_build_object('status', 'ok');
end $$;

-- -----------------------------------------------------------------------------
-- 8. Senhas e acessos (cifradas; chave no Supabase Vault com o nome central_acessos_chave)
-- -----------------------------------------------------------------------------
create or replace function public.central_chave()
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'central_acessos_chave' limit 1;
  if k is null or length(k) < 16 then raise exception 'CHAVE_AUSENTE' using hint = 'Crie o segredo central_acessos_chave no Vault.'; end if;
  return k;
end $$;

create or replace function public.central_salvar_acesso(
  p_id uuid, p_empresa uuid, p_sistema text, p_tipo text, p_link text, p_usuario text, p_senha text, p_observacoes text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); a public.central_acessos; v_id uuid := p_id;
begin
  if p_id is null then
    if not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
    if not public.central_pode('senha_cadastrar') then
      return public.central_solicitar('senha_cadastrar', p_empresa, 'acesso novo "' || coalesce(p_sistema, '') || '"', 'central_acessos', null);
    end if;
    insert into public.central_acessos (empresa_id, sistema, tipo, link, usuario_login, senha_cifrada, observacoes, alterada_por, criado_por)
    values (p_empresa, trim(p_sistema), coalesce(p_tipo, 'outro'), p_link, p_usuario,
            case when coalesce(p_senha, '') <> '' then extensions.pgp_sym_encrypt(p_senha, public.central_chave()) end,
            p_observacoes, u, u)
    returning id into v_id;
    perform public.central_registrar('acesso', p_empresa, 'cadastrou o acesso · ' || trim(p_sistema), 'central_acessos', v_id);
    return jsonb_build_object('status', 'ok', 'acesso_id', v_id);
  end if;

  select * into a from public.central_acessos where id = p_id and ativo for update;
  if not found or not public.central_ve_empresa(a.empresa_id) then raise exception 'ACESSO_INVALIDO'; end if;
  if not public.central_pode('senha_alterar') then
    return public.central_solicitar('senha_alterar', a.empresa_id, 'alteração do acesso · ' || a.sistema, 'central_acessos', a.id);
  end if;
  update public.central_acessos set
    sistema = coalesce(nullif(trim(p_sistema), ''), sistema), tipo = coalesce(p_tipo, tipo), link = coalesce(p_link, link),
    usuario_login = coalesce(p_usuario, usuario_login), observacoes = coalesce(p_observacoes, observacoes),
    senha_cifrada = case when coalesce(p_senha, '') <> '' then extensions.pgp_sym_encrypt(p_senha, public.central_chave()) else senha_cifrada end,
    alterada_em = public.central_agora(), alterada_por = u
  where id = a.id;
  perform public.central_registrar('acesso', a.empresa_id,
    case when coalesce(p_senha, '') <> '' then 'alterou a senha · ' else 'alterou o acesso · ' end || a.sistema, 'central_acessos', a.id);
  return jsonb_build_object('status', 'ok', 'acesso_id', a.id);
end $$;

-- Mostrar ou copiar a senha: devolve a senha e registra quem viu.
create or replace function public.central_revelar_senha(p_acesso uuid, p_motivo text default 'visualizou')
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); a public.central_acessos;
begin
  if p_motivo not in ('visualizou', 'copiou') then raise exception 'MOTIVO_INVALIDO'; end if;
  select * into a from public.central_acessos where id = p_acesso and ativo;
  if not found or not public.central_ve_empresa(a.empresa_id) then raise exception 'ACESSO_INVALIDO'; end if;
  perform public.central_registrar('acesso', a.empresa_id, p_motivo || ' a senha · ' || a.sistema, 'central_acessos', a.id);
  if a.senha_cifrada is null then return null; end if;
  return extensions.pgp_sym_decrypt(a.senha_cifrada, public.central_chave());
end $$;

create or replace function public.central_registrar_acesso(p_acesso uuid, p_acao text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); a public.central_acessos;
begin
  if p_acao not in ('copiou o usuário', 'abriu o link') then raise exception 'ACAO_INVALIDA'; end if;
  select * into a from public.central_acessos where id = p_acesso and ativo;
  if not found or not public.central_ve_empresa(a.empresa_id) then raise exception 'ACESSO_INVALIDO'; end if;
  perform public.central_registrar('acesso', a.empresa_id, p_acao || ' · ' || a.sistema, 'central_acessos', a.id);
end $$;

create or replace function public.central_excluir_acesso(p_acesso uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); a public.central_acessos;
begin
  select * into a from public.central_acessos where id = p_acesso and ativo for update;
  if not found or not public.central_ve_empresa(a.empresa_id) then raise exception 'ACESSO_INVALIDO'; end if;
  if not public.central_pode('senha_alterar') then
    return public.central_solicitar('senha_alterar', a.empresa_id, 'exclusão do acesso · ' || a.sistema, 'central_acessos', a.id);
  end if;
  update public.central_acessos set ativo = false, alterada_em = public.central_agora(), alterada_por = u where id = a.id;
  perform public.central_registrar('acesso', a.empresa_id, 'excluiu o acesso · ' || a.sistema, 'central_acessos', a.id);
  return jsonb_build_object('status', 'ok');
end $$;

-- -----------------------------------------------------------------------------
-- 9. Colaboradores, permissões e pedidos
-- -----------------------------------------------------------------------------
-- O usuário de login (auth) e o perfil são criados pelo servidor (API administrativa do Supabase).
-- Aqui ficam o papel, a carga, o vínculo com clientes e o ativo/inativo.
create or replace function public.central_salvar_colaborador(
  p_usuario uuid, p_papel text, p_carga integer, p_ativo boolean, p_clientes uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); c public.central_colaboradores; v_nome text; v_mud text[] := '{}';
begin
  select nome into v_nome from public.perfis_usuarios where usuario_id = p_usuario;
  if v_nome is null then raise exception 'PERFIL_INEXISTENTE'; end if;
  if not public.central_pode('colaborador') then
    return public.central_solicitar('colaborador', null, 'alteração no cadastro de ' || v_nome, 'central_colaboradores', p_usuario);
  end if;
  if p_usuario = u and (p_papel <> 'administrador' or not p_ativo) and public.central_papel(u) = 'administrador' then
    raise exception 'ADM_NAO_SE_REBAIXA';
  end if;
  select * into c from public.central_colaboradores where usuario_id = p_usuario for update;
  if not found then
    insert into public.central_colaboradores (usuario_id, papel_central, carga_horaria_mes, ativo) values (p_usuario, p_papel, coalesce(p_carga, 0), p_ativo);
    v_mud := v_mud || ('cadastrou ' || v_nome || ' (' || p_papel || ')');
  else
    if c.papel_central <> p_papel then v_mud := v_mud || ('papel: ' || c.papel_central || ' → ' || p_papel); end if;
    if c.carga_horaria_mes <> coalesce(p_carga, 0) then v_mud := v_mud || ('carga: ' || c.carga_horaria_mes || ' h → ' || coalesce(p_carga, 0) || ' h'); end if;
    if c.ativo <> p_ativo then v_mud := v_mud || case when p_ativo then 'reativado'::text else 'inativado'::text end; end if;
    update public.central_colaboradores set papel_central = p_papel, carga_horaria_mes = coalesce(p_carga, 0), ativo = p_ativo where usuario_id = p_usuario;
  end if;
  if p_clientes is not null then
    delete from public.central_vinculos where usuario_id = p_usuario and empresa_id <> all (p_clientes);
    insert into public.central_vinculos (empresa_id, usuario_id) select x, p_usuario from unnest(p_clientes) x on conflict do nothing;
  end if;
  if array_length(v_mud, 1) > 0 then
    perform public.central_registrar('colaborador', null, 'alterou ' || v_nome || ' · ' || array_to_string(v_mud, ' · '), 'central_colaboradores', p_usuario);
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- Chamada pelo servidor depois de redefinir a senha no Supabase Auth (a senha nunca passa pelo banco).
create or replace function public.central_registrar_redefinicao(p_usuario uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_nome text;
begin
  if public.central_papel(u) <> 'administrador' then raise exception 'SEM_PERMISSAO'; end if;
  update public.central_colaboradores set senha_redefinida_em = public.central_agora(), senha_redefinida_por = u where usuario_id = p_usuario;
  select nome into v_nome from public.perfis_usuarios where usuario_id = p_usuario;
  perform public.central_registrar('colaborador', null, 'redefiniu a senha de acesso de ' || coalesce(v_nome, '?'), 'central_colaboradores', p_usuario);
end $$;

-- Matriz de permissões: só o administrador muda; a linha do administrador é fixa.
create or replace function public.central_definir_permissao(p_papel text, p_acao text, p_valor text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_antes text;
begin
  if public.central_papel(u) <> 'administrador' then raise exception 'SEM_PERMISSAO'; end if;
  if p_papel = 'administrador' then raise exception 'PAPEL_FIXO'; end if;
  if p_acao = 'tipos_tarefa' and p_valor not in ('todas', 'mensais_pontuais') then raise exception 'VALOR_INVALIDO'; end if;
  if p_acao in ('ver_todos_clientes', 'concluir_outra', 'transferir', 'alterar_datas', 'ver_registros_todos') and p_valor not in ('s', 'n') then raise exception 'VALOR_INVALIDO'; end if;
  if p_acao not in ('tipos_tarefa', 'ver_todos_clientes', 'concluir_outra', 'transferir', 'alterar_datas', 'ver_registros_todos') and p_valor not in ('s', 'n', 'p') then raise exception 'VALOR_INVALIDO'; end if;
  select valor into v_antes from public.central_permissoes where papel_central = p_papel and acao = p_acao;
  insert into public.central_permissoes (papel_central, acao, valor, updated_at, updated_by) values (p_papel, p_acao, p_valor, now(), u)
  on conflict (papel_central, acao) do update set valor = excluded.valor, updated_at = now(), updated_by = u;
  perform public.central_registrar('permissao', null, 'alterou permissão · ' || p_papel || ' · ' || p_acao || ': ' || coalesce(v_antes, '-') || ' → ' || p_valor);
end $$;

create or replace function public.central_decidir_solicitacao(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); s public.central_solicitacoes;
begin
  if public.central_papel(u) <> 'administrador' then raise exception 'SEM_PERMISSAO'; end if;
  update public.central_solicitacoes set status = case when p_aprovar then 'aprovada' else 'recusada' end, decidido_por = u, decidido_em = public.central_agora()
   where id = p_id and status = 'pendente' returning * into s;
  if not found then raise exception 'SOLICITACAO_INVALIDA'; end if;
  perform public.central_registrar('pedido', s.empresa_id, case when p_aprovar then 'aprovou' else 'recusou' end || ' o pedido: ' || s.descricao, 'central_solicitacoes', s.id);
end $$;

-- -----------------------------------------------------------------------------
-- 10. Painel da Home
-- -----------------------------------------------------------------------------
create or replace function public.central_painel(p_de date, p_ate date, p_so_minhas boolean default false)
returns table (empresa_id uuid, codigo text, nome text, atrasadas bigint, hoje bigint, previstas bigint, concluidas bigint)
language sql stable security definer set search_path = public, pg_catalog as $$
  with base as (
    select t.*, coalesce(t.data_meta, t.prazo) as alvo
    from public.tarefas_operacionais t
    where t.ativo and t.status <> 'cancelada'
      and public.central_ve_empresa(t.empresa_id) and public.central_ve_tipo(t.tipo_recorrencia)
      and (not p_so_minhas or exists (select 1 from public.central_tarefa_responsaveis r where r.tarefa_id = t.id and r.usuario_id = auth.uid()))
  )
  select e.id, e.codigo::text, coalesce(e.nome_fantasia, e.razao_social),
    count(*) filter (where b.alvo < public.central_hoje() and b.status <> 'concluida'),
    count(*) filter (where b.alvo = public.central_hoje() and b.status <> 'concluida'),
    count(*) filter (where b.alvo > public.central_hoje() and b.alvo between p_de and p_ate and b.status <> 'concluida'),
    count(*) filter (where b.alvo between p_de and p_ate and b.status = 'concluida')
  from public.empresas e
  left join public.central_clientes cc on cc.empresa_id = e.id
  join base b on b.empresa_id = e.id
  where coalesce(cc.situacao, 'ativa') <> 'encerrada'
  group by e.id, e.codigo, e.nome_fantasia, e.razao_social
  order by e.codigo;
$$;

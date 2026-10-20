-- Central BPO · Solicitações (chamados entre colaboradores), 20/10/2026
-- Cada chamado: cliente (opcional), título, responsável, status, prazo e uma conversa enxuta
-- (comentários + mudanças de status + transferências), tudo registrado em central_chamado_eventos.
-- Status: aberto → iniciado → em_progresso → finalizado; ou impedimento / desconsiderado.
-- O e-mail automático (resumo por pessoa às 8h, 12h e 17h) fica para depois: a tabela já guarda
-- o que ele precisa (responsável, status, eventos com data) e central_vw_chamados entrega pronto.

create table if not exists public.central_chamados (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid references public.empresas(id) on delete set null,
  titulo        text not null,
  status        varchar(15) not null default 'aberto',
  responsavel   uuid references public.perfis_usuarios(usuario_id),
  criado_por    uuid not null references public.perfis_usuarios(usuario_id),
  prazo         date,
  origem        varchar(10) not null default 'tela',
  finalizado_em timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint central_chamado_titulo_check check (length(trim(titulo)) > 0),
  constraint central_chamado_status_check check (status in ('aberto', 'iniciado', 'em_progresso', 'impedimento', 'finalizado', 'desconsiderado')),
  constraint central_chamado_origem_check check (origem in ('tela', 'agente'))
);
create index if not exists central_chamados_resp_idx on public.central_chamados (responsavel, status);
create index if not exists central_chamados_emp_idx on public.central_chamados (empresa_id, status);

create table if not exists public.central_chamado_eventos (
  id         uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.central_chamados(id) on delete cascade,
  usuario_id uuid references public.perfis_usuarios(usuario_id),
  tipo       varchar(12) not null,
  texto      text,
  de         text,
  para       text,
  created_at timestamptz not null default now(),
  constraint central_chamado_evento_tipo_check check (tipo in ('abriu', 'comentou', 'status', 'transferiu', 'prazo'))
);
create index if not exists central_chamado_eventos_idx on public.central_chamado_eventos (chamado_id, created_at);

-- leitura: quem está na Central e vê o cliente (ou é parte do chamado; chamado sem cliente é interno: todos veem)
create or replace function public.central_ve_chamado(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select public.central_ativo() and exists (
    select 1 from public.central_chamados c
     where c.id = p_id
       and (c.empresa_id is null or public.central_ve_empresa(c.empresa_id) or c.responsavel = auth.uid() or c.criado_por = auth.uid()))
$$;
revoke all on function public.central_ve_chamado(uuid) from public, anon;
grant execute on function public.central_ve_chamado(uuid) to authenticated;

alter table public.central_chamados enable row level security;
alter table public.central_chamado_eventos enable row level security;
drop policy if exists central_chamados_sel on public.central_chamados;
create policy central_chamados_sel on public.central_chamados for select to authenticated using (public.central_ve_chamado(id));
drop policy if exists central_chamado_eventos_sel on public.central_chamado_eventos;
create policy central_chamado_eventos_sel on public.central_chamado_eventos for select to authenticated using (public.central_ve_chamado(chamado_id));
grant select on public.central_chamados, public.central_chamado_eventos to authenticated;
revoke all on public.central_chamados, public.central_chamado_eventos from anon;
revoke insert, update, delete on public.central_chamados, public.central_chamado_eventos from authenticated;

create or replace view public.central_vw_chamados with (security_invoker = true) as
select c.id, c.empresa_id, e.codigo as empresa_codigo, coalesce(e.nome_fantasia, e.razao_social) as empresa_nome,
       c.titulo, c.status, c.responsavel, c.criado_por, c.prazo, c.origem, c.finalizado_em, c.created_at, c.updated_at,
       (select count(*) from public.central_chamado_eventos v where v.chamado_id = c.id and v.tipo = 'comentou') as comentarios,
       (select max(v.created_at) from public.central_chamado_eventos v where v.chamado_id = c.id) as ultima_atividade
  from public.central_chamados c
  left join public.empresas e on e.id = c.empresa_id;
grant select on public.central_vw_chamados to authenticated;
revoke all on public.central_vw_chamados from anon;
revoke insert, update, delete on public.central_vw_chamados from authenticated;

create or replace function public.central_abrir_chamado(p_empresa uuid, p_titulo text, p_texto text default null,
  p_responsavel uuid default null, p_prazo date default null, p_origem text default 'tela')
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_id uuid;
begin
  if p_empresa is not null and not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  if length(trim(coalesce(p_titulo, ''))) = 0 then raise exception 'DADOS_INCOMPLETOS'; end if;
  if p_responsavel is not null and not exists (select 1 from public.central_colaboradores c where c.usuario_id = p_responsavel and c.ativo) then raise exception 'DESTINO_INVALIDO'; end if;
  if coalesce(p_origem, 'tela') not in ('tela', 'agente') then raise exception 'ACAO_INVALIDA'; end if;
  insert into public.central_chamados (empresa_id, titulo, responsavel, criado_por, prazo, origem)
  values (p_empresa, left(trim(p_titulo), 200), p_responsavel, u, p_prazo, coalesce(p_origem, 'tela')) returning id into v_id;
  insert into public.central_chamado_eventos (chamado_id, usuario_id, tipo, texto, para)
  values (v_id, u, 'abriu', nullif(trim(coalesce(p_texto, '')), ''), (select nome from public.perfis_usuarios where usuario_id = p_responsavel));
  perform public.central_registrar('chamado', p_empresa, 'abriu a solicitação "' || left(trim(p_titulo), 80) || '"', 'central_chamados', v_id);
  return v_id;
end $$;

create or replace function public.central_comentar_chamado(p_id uuid, p_texto text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu();
begin
  if not public.central_ve_chamado(p_id) then raise exception 'CHAMADO_INVALIDO'; end if;
  if length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'DADOS_INCOMPLETOS'; end if;
  insert into public.central_chamado_eventos (chamado_id, usuario_id, tipo, texto) values (p_id, u, 'comentou', trim(p_texto));
  update public.central_chamados set updated_at = now() where id = p_id;
end $$;

create or replace function public.central_status_chamado(p_id uuid, p_status text, p_texto text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); c public.central_chamados;
begin
  select * into c from public.central_chamados where id = p_id for update;
  if not found or not public.central_ve_chamado(p_id) then raise exception 'CHAMADO_INVALIDO'; end if;
  if p_status not in ('aberto', 'iniciado', 'em_progresso', 'impedimento', 'finalizado', 'desconsiderado') then raise exception 'VALOR_INVALIDO'; end if;
  if p_status = c.status then return; end if;
  if p_status = 'impedimento' and length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'IMPEDIMENTO_SEM_MOTIVO'; end if;
  update public.central_chamados
     set status = p_status, updated_at = now(),
         finalizado_em = case when p_status in ('finalizado', 'desconsiderado') then now() else null end
   where id = p_id;
  insert into public.central_chamado_eventos (chamado_id, usuario_id, tipo, texto, de, para)
  values (p_id, u, 'status', nullif(trim(coalesce(p_texto, '')), ''), c.status, p_status);
  perform public.central_registrar('chamado', c.empresa_id, 'mudou a solicitação "' || left(c.titulo, 60) || '" para ' || replace(p_status, '_', ' '), 'central_chamados', p_id);
end $$;

create or replace function public.central_transferir_chamado(p_id uuid, p_para uuid, p_texto text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); c public.central_chamados; v_de text; v_para text;
begin
  select * into c from public.central_chamados where id = p_id for update;
  if not found or not public.central_ve_chamado(p_id) then raise exception 'CHAMADO_INVALIDO'; end if;
  if not exists (select 1 from public.central_colaboradores x where x.usuario_id = p_para and x.ativo) then raise exception 'DESTINO_INVALIDO'; end if;
  if c.responsavel is not distinct from p_para then return; end if;
  select nome into v_de from public.perfis_usuarios where usuario_id = c.responsavel;
  select nome into v_para from public.perfis_usuarios where usuario_id = p_para;
  update public.central_chamados set responsavel = p_para, updated_at = now() where id = p_id;
  insert into public.central_chamado_eventos (chamado_id, usuario_id, tipo, texto, de, para)
  values (p_id, u, 'transferiu', nullif(trim(coalesce(p_texto, '')), ''), v_de, v_para);
  perform public.central_registrar('chamado', c.empresa_id, 'passou a solicitação "' || left(c.titulo, 60) || '" para ' || v_para, 'central_chamados', p_id);
end $$;

create or replace function public.central_prazo_chamado(p_id uuid, p_prazo date)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); c public.central_chamados;
begin
  select * into c from public.central_chamados where id = p_id for update;
  if not found or not public.central_ve_chamado(p_id) then raise exception 'CHAMADO_INVALIDO'; end if;
  if c.prazo is not distinct from p_prazo then return; end if;
  update public.central_chamados set prazo = p_prazo, updated_at = now() where id = p_id;
  insert into public.central_chamado_eventos (chamado_id, usuario_id, tipo, de, para)
  values (p_id, u, 'prazo', to_char(c.prazo, 'DD/MM/YYYY'), to_char(p_prazo, 'DD/MM/YYYY'));
end $$;

revoke all on function public.central_abrir_chamado(uuid, text, text, uuid, date, text) from public, anon;
revoke all on function public.central_comentar_chamado(uuid, text) from public, anon;
revoke all on function public.central_status_chamado(uuid, text, text) from public, anon;
revoke all on function public.central_transferir_chamado(uuid, uuid, text) from public, anon;
revoke all on function public.central_prazo_chamado(uuid, date) from public, anon;
grant execute on function public.central_abrir_chamado(uuid, text, text, uuid, date, text) to authenticated;
grant execute on function public.central_comentar_chamado(uuid, text) to authenticated;
grant execute on function public.central_status_chamado(uuid, text, text) to authenticated;
grant execute on function public.central_transferir_chamado(uuid, uuid, text) to authenticated;
grant execute on function public.central_prazo_chamado(uuid, date) to authenticated;

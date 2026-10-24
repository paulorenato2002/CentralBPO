-- Central BPO · Informações, Datas e Contatos do cliente (24/10/2026)
-- Três abas novas em Cadastros, todas na mesma tabela de cartões:
--   info    → informações cadastrais soltas (o que hoje ia parar em "Senhas e acessos")
--   data    → datas e lembretes (fechamento de cartão, vencimentos, renovações: os cartões do Google Keep)
--   contato → pessoas do cliente (nome, cargo, telefone, e-mail)
-- Cliente vazio = vale para a Effective inteira. Quem vê o cliente lê e edita; excluir só esconde (fica no histórico).

create table if not exists public.central_notas_cliente (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references public.empresas(id) on delete cascade,
  tipo        varchar(10) not null,
  titulo      text not null,
  texto       text,
  data        date,
  dados       jsonb not null default '{}'::jsonb,
  ativo       boolean not null default true,
  created_by  uuid references public.perfis_usuarios(usuario_id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.perfis_usuarios(usuario_id),
  updated_at  timestamptz not null default now(),
  constraint central_nota_tipo_check check (tipo in ('info', 'data', 'contato')),
  constraint central_nota_titulo_check check (length(trim(titulo)) > 0)
);
create index if not exists central_notas_emp_idx on public.central_notas_cliente (empresa_id, tipo) where ativo;
alter table public.central_notas_cliente enable row level security;
drop policy if exists central_notas_sel on public.central_notas_cliente;
create policy central_notas_sel on public.central_notas_cliente for select to authenticated
  using (ativo and (empresa_id is null or empresa_id = any ((select public.central_empresas_visiveis())::uuid[])));
grant select on public.central_notas_cliente to authenticated;
revoke all on public.central_notas_cliente from anon;
revoke insert, update, delete on public.central_notas_cliente from authenticated;

create or replace function public.central_salvar_nota(p_id uuid, p_empresa uuid, p_tipo text, p_titulo text,
  p_texto text default null, p_data date default null, p_dados jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_id uuid := p_id; n public.central_notas_cliente;
begin
  if u is null then raise exception 'SEM_ACESSO'; end if;
  if p_tipo not in ('info', 'data', 'contato') then raise exception 'VALOR_INVALIDO'; end if;
  if length(trim(coalesce(p_titulo, ''))) = 0 then raise exception 'DADOS_INCOMPLETOS'; end if;
  if p_empresa is not null and not public.central_ve_empresa(p_empresa) then raise exception 'SEM_ACESSO_CLIENTE'; end if;
  if p_tipo = 'data' and p_data is null then raise exception 'DATA_OBRIGATORIA'; end if;
  if v_id is null then
    insert into public.central_notas_cliente (empresa_id, tipo, titulo, texto, data, dados, created_by, updated_by)
    values (p_empresa, p_tipo, left(trim(p_titulo), 200), nullif(trim(coalesce(p_texto, '')), ''), p_data, coalesce(p_dados, '{}'::jsonb), u, u)
    returning id into v_id;
  else
    select * into n from public.central_notas_cliente where id = v_id and ativo for update;
    if not found or (n.empresa_id is not null and not public.central_ve_empresa(n.empresa_id)) then raise exception 'NOTA_INVALIDA'; end if;
    update public.central_notas_cliente
       set empresa_id = p_empresa, titulo = left(trim(p_titulo), 200), texto = nullif(trim(coalesce(p_texto, '')), ''), data = p_data,
           dados = coalesce(p_dados, '{}'::jsonb), updated_by = u, updated_at = now()
     where id = v_id;
  end if;
  perform public.central_registrar('nota', p_empresa,
    case when p_id is null then 'cadastrou ' else 'alterou ' end ||
    case p_tipo when 'info' then 'a informação "' when 'data' then 'a data "' else 'o contato "' end || left(trim(p_titulo), 60) || '"',
    'central_notas_cliente', v_id);
  return v_id;
end $$;

create or replace function public.central_excluir_nota(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare n public.central_notas_cliente;
begin
  select * into n from public.central_notas_cliente where id = p_id and ativo for update;
  if not found or (n.empresa_id is not null and not public.central_ve_empresa(n.empresa_id)) then raise exception 'NOTA_INVALIDA'; end if;
  update public.central_notas_cliente set ativo = false, updated_by = public.central_eu(), updated_at = now() where id = p_id;
  perform public.central_registrar('nota', n.empresa_id, 'excluiu "' || left(n.titulo, 60) || '"', 'central_notas_cliente', p_id);
end $$;

revoke all on function public.central_salvar_nota(uuid, uuid, text, text, text, date, jsonb) from public, anon;
revoke all on function public.central_excluir_nota(uuid) from public, anon;
grant execute on function public.central_salvar_nota(uuid, uuid, text, text, text, date, jsonb) to authenticated;
grant execute on function public.central_excluir_nota(uuid) to authenticated;

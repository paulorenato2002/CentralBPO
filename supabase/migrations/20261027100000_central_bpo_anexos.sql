-- Central BPO · Anexos de imagem nos cartões de Senhas e de Cadastros (27/10/2026)
-- Uma foto ou print fica presa ao cartão: o acesso (Senhas) ou a nota (Informações, Datas, Contatos).
-- Serve para guardar uma senha avulsa, o print de um token, o cartão de um contato etc.
--   · o arquivo fica cifrado no banco (mesma chave das senhas) e só sai por central_abrir_anexo;
--   · abrir anexo de senha fica registrado no histórico, como mostrar a senha;
--   · a lista (sem o arquivo) segue a mesma visibilidade do cartão;
--   · anexar em senha: quem cadastra ou altera senha; tirar anexo de senha: quem altera senha;
--     nas notas: quem vê o cliente (nota geral: todos);
--   · até 2,5 MB por arquivo (a tela reduz a foto antes de mandar) e 10 anexos por cartão.

create table if not exists public.central_anexos (
  id          uuid primary key default gen_random_uuid(),
  alvo_tipo   varchar(10) not null,
  alvo_id     uuid not null,
  empresa_id  uuid references public.empresas(id) on delete cascade,
  nome        text not null,
  categoria   text,
  mime        text not null,
  tamanho     integer not null,
  dados       bytea not null,
  ativo       boolean not null default true,
  created_by  uuid references public.perfis_usuarios(usuario_id),
  created_at  timestamptz not null default now(),
  constraint central_anexo_alvo_check check (alvo_tipo in ('acesso', 'nota')),
  constraint central_anexo_mime_check check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'))
);
create index if not exists central_anexos_alvo_idx on public.central_anexos (alvo_tipo, alvo_id) where ativo;
alter table public.central_anexos enable row level security;
drop policy if exists central_anexos_sel on public.central_anexos;
create policy central_anexos_sel on public.central_anexos for select to authenticated
  using (ativo and (empresa_id is null or empresa_id = any ((select public.central_empresas_visiveis())::uuid[])));
revoke all on public.central_anexos from anon, authenticated;
-- a lista não traz o arquivo: ele só sai por central_abrir_anexo
grant select (id, alvo_tipo, alvo_id, empresa_id, nome, categoria, mime, tamanho, created_by, created_at) on public.central_anexos to authenticated;

-- cliente do cartão, conferindo que ele existe e que a pessoa o vê
create or replace function public.central_anexo_alvo(p_alvo_tipo text, p_alvo_id uuid, out o_empresa uuid, out o_titulo text)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if p_alvo_tipo = 'acesso' then
    select empresa_id, sistema into o_empresa, o_titulo from public.central_acessos where id = p_alvo_id and ativo;
    if not found or not public.central_ve_empresa(o_empresa) then raise exception 'ACESSO_INVALIDO'; end if;
  elsif p_alvo_tipo = 'nota' then
    select empresa_id, titulo into o_empresa, o_titulo from public.central_notas_cliente where id = p_alvo_id and ativo;
    if not found or (o_empresa is not null and not public.central_ve_empresa(o_empresa)) then raise exception 'NOTA_INVALIDA'; end if;
  else raise exception 'VALOR_INVALIDO';
  end if;
end $$;

create or replace function public.central_anexar(p_alvo_tipo text, p_alvo_id uuid, p_nome text, p_mime text, p_base64 text, p_categoria text default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_emp uuid; v_tit text; v_bin bytea; v_id uuid;
begin
  if u is null then raise exception 'SEM_ACESSO'; end if;
  select o_empresa, o_titulo into v_emp, v_tit from public.central_anexo_alvo(p_alvo_tipo, p_alvo_id);
  if p_alvo_tipo = 'acesso' and not (public.central_pode('senha_cadastrar') or public.central_pode('senha_alterar')) then raise exception 'SEM_PERMISSAO'; end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf') then raise exception 'ARQUIVO_INVALIDO'; end if;
  v_bin := decode(coalesce(p_base64, ''), 'base64');
  if length(v_bin) = 0 then raise exception 'ARQUIVO_INVALIDO'; end if;
  if length(v_bin) > 2621440 then raise exception 'ARQUIVO_GRANDE'; end if;
  if (select count(*) from public.central_anexos where alvo_tipo = p_alvo_tipo and alvo_id = p_alvo_id and ativo) >= 10 then raise exception 'ANEXOS_DEMAIS'; end if;
  insert into public.central_anexos (alvo_tipo, alvo_id, empresa_id, nome, categoria, mime, tamanho, dados, created_by)
  values (p_alvo_tipo, p_alvo_id, v_emp, left(coalesce(nullif(trim(p_nome), ''), 'imagem'), 120), nullif(left(trim(coalesce(p_categoria, '')), 40), ''),
          p_mime, length(v_bin), extensions.pgp_sym_encrypt_bytea(v_bin, public.central_chave()), u)
  returning id into v_id;
  perform public.central_registrar(case when p_alvo_tipo = 'acesso' then 'acesso' else 'nota' end, v_emp,
    'anexou "' || left(coalesce(nullif(trim(p_nome), ''), 'imagem'), 60) || '" em ' || left(v_tit, 60), 'central_anexos', v_id);
  return v_id;
end $$;

-- devolve o arquivo em base64; abrir anexo de senha fica no histórico
create or replace function public.central_abrir_anexo(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.central_anexos; v_tit text;
begin
  if public.central_eu() is null then raise exception 'SEM_ACESSO'; end if;
  select * into a from public.central_anexos where id = p_id and ativo;
  if not found then raise exception 'ANEXO_INVALIDO'; end if;
  select o_titulo into v_tit from public.central_anexo_alvo(a.alvo_tipo, a.alvo_id);
  if a.alvo_tipo = 'acesso' then
    perform public.central_registrar('acesso', a.empresa_id, 'abriu o anexo "' || left(a.nome, 60) || '" · ' || left(v_tit, 60), 'central_anexos', a.id);
  end if;
  return jsonb_build_object('nome', a.nome, 'mime', a.mime,
    'base64', encode(extensions.pgp_sym_decrypt_bytea(a.dados, public.central_chave()), 'base64'));
end $$;

create or replace function public.central_excluir_anexo(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare a public.central_anexos; v_tit text;
begin
  if public.central_eu() is null then raise exception 'SEM_ACESSO'; end if;
  select * into a from public.central_anexos where id = p_id and ativo for update;
  if not found then raise exception 'ANEXO_INVALIDO'; end if;
  select o_titulo into v_tit from public.central_anexo_alvo(a.alvo_tipo, a.alvo_id);
  if a.alvo_tipo = 'acesso' and not public.central_pode('senha_alterar') then raise exception 'SEM_PERMISSAO'; end if;
  update public.central_anexos set ativo = false where id = p_id;
  perform public.central_registrar(case when a.alvo_tipo = 'acesso' then 'acesso' else 'nota' end, a.empresa_id,
    'tirou o anexo "' || left(a.nome, 60) || '" de ' || left(v_tit, 60), 'central_anexos', a.id);
end $$;

revoke all on function public.central_anexo_alvo(text, uuid) from public, anon, authenticated;
revoke all on function public.central_anexar(text, uuid, text, text, text, text) from public, anon;
revoke all on function public.central_abrir_anexo(uuid) from public, anon;
revoke all on function public.central_excluir_anexo(uuid) from public, anon;
grant execute on function public.central_anexar(text, uuid, text, text, text, text) to authenticated;
grant execute on function public.central_abrir_anexo(uuid) to authenticated;
grant execute on function public.central_excluir_anexo(uuid) to authenticated;

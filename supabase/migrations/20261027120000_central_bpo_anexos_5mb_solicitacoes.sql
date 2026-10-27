-- Central BPO · Anexos: até 5 MB e também nas Solicitações (27/10/2026)
--   · limite por arquivo sobe de 2,5 MB para 5 MB;
--   · solicitação (chamado) aceita anexos: quem vê a solicitação vê, anexa e tira;
--     anexar entra no andamento da conversa ("📎 anexou …").

alter table public.central_anexos drop constraint if exists central_anexo_alvo_check;
alter table public.central_anexos add constraint central_anexo_alvo_check check (alvo_tipo in ('acesso', 'nota', 'chamado'));

drop policy if exists central_anexos_sel on public.central_anexos;
create policy central_anexos_sel on public.central_anexos for select to authenticated
  using (ativo and case when alvo_tipo = 'chamado' then public.central_ve_chamado(alvo_id)
                        else (empresa_id is null or empresa_id = any ((select public.central_empresas_visiveis())::uuid[])) end);

create or replace function public.central_anexo_alvo(p_alvo_tipo text, p_alvo_id uuid, out o_empresa uuid, out o_titulo text)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if p_alvo_tipo = 'acesso' then
    select empresa_id, sistema into o_empresa, o_titulo from public.central_acessos where id = p_alvo_id and ativo;
    if not found or not public.central_ve_empresa(o_empresa) then raise exception 'ACESSO_INVALIDO'; end if;
  elsif p_alvo_tipo = 'nota' then
    select empresa_id, titulo into o_empresa, o_titulo from public.central_notas_cliente where id = p_alvo_id and ativo;
    if not found or (o_empresa is not null and not public.central_ve_empresa(o_empresa)) then raise exception 'NOTA_INVALIDA'; end if;
  elsif p_alvo_tipo = 'chamado' then
    select empresa_id, titulo into o_empresa, o_titulo from public.central_chamados where id = p_alvo_id;
    if not found or not public.central_ve_chamado(p_alvo_id) then raise exception 'CHAMADO_INVALIDO'; end if;
  else raise exception 'VALOR_INVALIDO';
  end if;
end $$;
revoke all on function public.central_anexo_alvo(text, uuid) from public, anon, authenticated;

create or replace function public.central_anexar(p_alvo_tipo text, p_alvo_id uuid, p_nome text, p_mime text, p_base64 text, p_categoria text default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); v_emp uuid; v_tit text; v_bin bytea; v_id uuid; v_nome text;
begin
  if u is null then raise exception 'SEM_ACESSO'; end if;
  select o_empresa, o_titulo into v_emp, v_tit from public.central_anexo_alvo(p_alvo_tipo, p_alvo_id);
  if p_alvo_tipo = 'acesso' and not (public.central_pode('senha_cadastrar') or public.central_pode('senha_alterar')) then raise exception 'SEM_PERMISSAO'; end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf') then raise exception 'ARQUIVO_INVALIDO'; end if;
  v_bin := decode(coalesce(p_base64, ''), 'base64');
  if length(v_bin) = 0 then raise exception 'ARQUIVO_INVALIDO'; end if;
  if length(v_bin) > 5242880 then raise exception 'ARQUIVO_GRANDE'; end if;
  if (select count(*) from public.central_anexos where alvo_tipo = p_alvo_tipo and alvo_id = p_alvo_id and ativo) >= 10 then raise exception 'ANEXOS_DEMAIS'; end if;
  v_nome := left(coalesce(nullif(trim(p_nome), ''), 'imagem'), 120);
  insert into public.central_anexos (alvo_tipo, alvo_id, empresa_id, nome, categoria, mime, tamanho, dados, created_by)
  values (p_alvo_tipo, p_alvo_id, v_emp, v_nome, nullif(left(trim(coalesce(p_categoria, '')), 40), ''),
          p_mime, length(v_bin), extensions.pgp_sym_encrypt_bytea(v_bin, public.central_chave()), u)
  returning id into v_id;
  if p_alvo_tipo = 'chamado' then
    insert into public.central_chamado_eventos (chamado_id, usuario_id, tipo, texto) values (p_alvo_id, u, 'comentou', '📎 anexou ' || v_nome);
    update public.central_chamados set updated_at = now() where id = p_alvo_id;
  end if;
  perform public.central_registrar(p_alvo_tipo, v_emp, 'anexou "' || left(v_nome, 60) || '" em ' || left(v_tit, 60), 'central_anexos', v_id);
  return v_id;
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
  if a.alvo_tipo = 'chamado' then
    insert into public.central_chamado_eventos (chamado_id, usuario_id, tipo, texto) values (a.alvo_id, public.central_eu(), 'comentou', '📎 tirou o anexo ' || a.nome);
  end if;
  perform public.central_registrar(a.alvo_tipo, a.empresa_id, 'tirou o anexo "' || left(a.nome, 60) || '" de ' || left(v_tit, 60), 'central_anexos', a.id);
end $$;

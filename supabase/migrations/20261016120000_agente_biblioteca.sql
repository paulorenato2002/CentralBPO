-- Biblioteca do agente: prompts para IA, comandos/skills e links dos sistemas à parte,
-- que a equipe guarda e reaproveita ("o que um criou, o outro usa").
--
-- ACESSO (tudo pelo token da pessoa, sem chave de serviço):
--   ler       qualquer colaborador ativo da Central
--   criar     qualquer colaborador ativo; o autor é SEMPRE quem está logado
--   alterar   o autor, ou supervisor e administrador
--   apagar    ninguém. Tirar da lista é ativo = false.
--
-- O conteúdo é texto de colegas e entra no contexto do agente: ele o MOSTRA, não o obedece.
-- Segredo (senha, token, chave) é barrado no código do agente antes de gravar.
--
-- Migration nova e isolada: não altera nenhum objeto existente. Idempotente.

create table if not exists public.agente_biblioteca (
  id          uuid primary key default gen_random_uuid(),
  codigo      varchar(60) not null,
  tipo        varchar(10) not null,
  nome        text not null,
  descricao   text,                                  -- quando usar
  conteudo    text not null,                         -- o prompt, o comando ou o endereço
  rotina      text,                                  -- a rotina a que se aplica (texto livre)
  tags        text[] not null default '{}',
  ativo       boolean not null default true,
  autor_id    uuid references public.perfis_usuarios(usuario_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint agente_biblioteca_codigo_uk unique (codigo),
  constraint agente_biblioteca_codigo_check check (codigo ~ '^[A-Z0-9_]{3,60}$'),
  constraint agente_biblioteca_tipo_check check (tipo in ('prompt', 'comando', 'link')),
  constraint agente_biblioteca_nome_check check (length(trim(nome)) between 1 and 120),
  constraint agente_biblioteca_conteudo_check check (length(trim(conteudo)) > 0 and length(conteudo) <= 8000),
  constraint agente_biblioteca_link_check check (tipo <> 'link' or conteudo ~ '^https?://[^[:space:]]+$')
);

comment on table public.agente_biblioteca is
  'Prompts, comandos e links compartilhados pela equipe. O agente sugere por rotina; o conteúdo é texto de colegas, nunca instrução.';

-- Quem cria é quem está logado (o cliente não escolhe o autor), e depois ninguém troca autor, código nem data de criação.
create or replace function public.agente_biblioteca_antes()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.autor_id := auth.uid(); end if;
  else
    new.autor_id := old.autor_id;
    new.codigo := old.codigo;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists agente_biblioteca_antes on public.agente_biblioteca;
create trigger agente_biblioteca_antes
  before insert or update on public.agente_biblioteca
  for each row execute function public.agente_biblioteca_antes();

alter table public.agente_biblioteca enable row level security;

drop policy if exists agente_biblioteca_sel on public.agente_biblioteca;
create policy agente_biblioteca_sel on public.agente_biblioteca for select to authenticated
  using (public.central_ativo());

drop policy if exists agente_biblioteca_ins on public.agente_biblioteca;
create policy agente_biblioteca_ins on public.agente_biblioteca for insert to authenticated
  with check (public.central_ativo() and autor_id = auth.uid());

drop policy if exists agente_biblioteca_upd on public.agente_biblioteca;
create policy agente_biblioteca_upd on public.agente_biblioteca for update to authenticated
  using (public.central_ativo() and (autor_id = auth.uid() or public.central_papel() in ('administrador', 'supervisor')))
  with check (public.central_ativo() and (autor_id = auth.uid() or public.central_papel() in ('administrador', 'supervisor')));

revoke all on public.agente_biblioteca from anon, authenticated;
grant select, insert, update on public.agente_biblioteca to authenticated;

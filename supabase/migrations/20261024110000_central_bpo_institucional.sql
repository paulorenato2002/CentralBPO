-- Central BPO · conteúdo da instalação: fotos, logos e textos do Institucional (24/10/2026)
-- Fotos da equipe, logos dos clientes e os textos de "como trabalhamos" são da empresa que usa a Central,
-- então ficam no banco (não no código, que é público). Só quem está logado lê; o app não grava aqui.
--   central_imagens.chave:  'pessoa:<usuario_id>' · 'cliente:<empresa_id>' · 'parceiro:<nome>'
--   central_conteudo.chave: 'institucional' (níveis, papéis, ciclo do cliente, tipos de trabalho, subtítulos dos clientes)

create table if not exists public.central_imagens (
  chave      text primary key,
  mime       text not null,
  dados      text not null,          -- base64 (imagens pequenas, ~10 KB)
  titulo     text,
  updated_at timestamptz not null default now(),
  constraint central_img_mime_check check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  constraint central_img_tam_check check (length(dados) <= 300000)
);
create table if not exists public.central_conteudo (
  chave      text primary key,
  dados      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.central_imagens enable row level security;
alter table public.central_conteudo enable row level security;
drop policy if exists central_img_sel on public.central_imagens;
create policy central_img_sel on public.central_imagens for select to authenticated using (true);
drop policy if exists central_cont_sel on public.central_conteudo;
create policy central_cont_sel on public.central_conteudo for select to authenticated using (true);
grant select on public.central_imagens, public.central_conteudo to authenticated;
revoke all on public.central_imagens, public.central_conteudo from anon;
revoke insert, update, delete on public.central_imagens, public.central_conteudo from authenticated;

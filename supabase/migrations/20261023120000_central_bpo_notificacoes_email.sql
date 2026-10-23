-- Central BPO · aviso por e-mail para cada colaborador (23/10/2026)
-- Às 8h, 12h e 17h (seg a sex) cada pessoa recebe UM e-mail com o que é dela: solicitações em
-- aberto e em impedimento, as concluídas/desconsideradas desde o último aviso e as tarefas do dia.
-- Só um resumo e o link da Central (sem expor o texto das conversas). Quem não tem nada, não recebe.
-- O banco monta o e-mail e entrega ao n8n (fluxo "enviar e-mail" já existente, Gmail da instalação).
-- Configuração no Vault (não fica no código):
--   central_n8n_email_url     URL do webhook do n8n
--   central_n8n_email_segredo segredo do cabeçalho Authorization (Bearer)
--   central_app_url           endereço da Central (para o link no e-mail)

-- pg_net faz o POST para o n8n (no teste local sem pg_net, só o conteúdo é testado)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net with schema extensions; end if;
end $$;

create table if not exists public.central_notificacoes_envio (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.perfis_usuarios(usuario_id),
  email       text not null,
  rotulo      text not null,
  itens       integer not null,
  pedido_id   bigint,
  enviado_em  timestamptz not null default now()
);
create index if not exists central_notif_usuario_idx on public.central_notificacoes_envio (usuario_id, enviado_em desc);
alter table public.central_notificacoes_envio enable row level security;
drop policy if exists central_notif_sel on public.central_notificacoes_envio;
create policy central_notif_sel on public.central_notificacoes_envio for select to authenticated
  using (usuario_id = auth.uid() or (select public.central_papel(auth.uid())) = 'administrador');
grant select on public.central_notificacoes_envio to authenticated;
revoke all on public.central_notificacoes_envio from anon;
revoke insert, update, delete on public.central_notificacoes_envio from authenticated;

create or replace function public.central_html(t text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- conteúdo do aviso de uma pessoa (não envia nada): itens = 0 quando não há o que avisar
create or replace function public.central_notificacao_conteudo(p_usuario uuid, p_desde timestamptz default null)
returns table (assunto text, html text, itens integer)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_nome text; v_desde timestamptz; v_hoje date := public.central_hoje(); v_link text;
  v_abertos text := ''; v_imped text := ''; v_fechados text := ''; n_ab int := 0; n_im int := 0; n_fe int := 0;
  n_hoje int := 0; n_atr int := 0; r record; v_html text;
begin
  select nome into v_nome from public.perfis_usuarios where usuario_id = p_usuario;
  v_desde := coalesce(p_desde, (select max(enviado_em) from public.central_notificacoes_envio where usuario_id = p_usuario), now() - interval '1 day');
  select decrypted_secret into v_link from vault.decrypted_secrets where name = 'central_app_url' limit 1;
  v_link := coalesce(v_link, '');

  for r in select c.titulo, c.status, c.prazo, e.codigo, coalesce(e.nome_fantasia, e.razao_social) as cli, c.updated_at
             from public.central_chamados c left join public.empresas e on e.id = c.empresa_id
            where c.responsavel = p_usuario order by c.prazo nulls last, c.updated_at desc loop
    if r.status in ('aberto', 'iniciado', 'em_progresso') then
      n_ab := n_ab + 1;
      v_abertos := v_abertos || '<li>' || public.central_html(r.titulo) || coalesce(' <span style="color:#5c6672">· ' || public.central_html(r.codigo || ' ' || r.cli) || '</span>', '')
        || case when r.prazo is not null then ' · prazo ' || to_char(r.prazo, 'DD/MM') || case when r.prazo < v_hoje then ' <b style="color:#b0422c">(vencido)</b>' else '' end else '' end || '</li>';
    elsif r.status = 'impedimento' then
      n_im := n_im + 1;
      v_imped := v_imped || '<li>' || public.central_html(r.titulo) || coalesce(' <span style="color:#5c6672">· ' || public.central_html(r.codigo || ' ' || r.cli) || '</span>', '') || '</li>';
    elsif r.updated_at > v_desde then
      n_fe := n_fe + 1;
      v_fechados := v_fechados || '<li>' || public.central_html(r.titulo) || ' · ' || case when r.status = 'finalizado' then 'finalizada' else 'desconsiderada' end || '</li>';
    end if;
  end loop;

  select count(*) filter (where coalesce(t.data_meta, t.prazo) = v_hoje), count(*) filter (where coalesce(t.data_meta, t.prazo) < v_hoje)
    into n_hoje, n_atr
    from public.tarefas_operacionais t
    join public.central_tarefa_responsaveis x on x.tarefa_id = t.id and x.usuario_id = p_usuario
   where t.ativo and t.status = 'pendente' and coalesce(t.data_meta, t.prazo) <= v_hoje;

  itens := n_ab + n_im + n_fe + n_hoje + n_atr;
  assunto := 'Central BPO · ' || coalesce(nullif(concat_ws(' · ',
      case when n_im > 0 then n_im || ' em impedimento' end,
      case when n_ab > 0 then n_ab || case when n_ab = 1 then ' solicitação em aberto' else ' solicitações em aberto' end end,
      case when n_hoje > 0 then n_hoje || case when n_hoje = 1 then ' tarefa hoje' else ' tarefas hoje' end end,
      case when n_atr > 0 then n_atr || case when n_atr = 1 then ' atrasada' else ' atrasadas' end end,
      case when n_fe > 0 then n_fe || case when n_fe = 1 then ' encerrada' else ' encerradas' end end), ''), 'seu resumo');
  v_html := '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111a24;max-width:560px">'
    || '<p>Olá, ' || public.central_html(split_part(coalesce(v_nome, ''), ' ', 1)) || '. Este é o seu resumo da Central BPO.</p>'
    || '<p style="background:#f5f7f9;border-radius:6px;padding:10px 12px"><b>Tarefas:</b> ' || n_hoje || ' para hoje'
    || case when n_atr > 0 then ' · <b style="color:#b0422c">' || n_atr || ' atrasada(s)</b>' else '' end || '</p>'
    || case when n_im > 0 then '<p><b style="color:#b0422c">Em impedimento (' || n_im || ')</b></p><ul>' || v_imped || '</ul>' else '' end
    || case when n_ab > 0 then '<p><b>Solicitações em aberto com você (' || n_ab || ')</b></p><ul>' || v_abertos || '</ul>' else '' end
    || case when n_fe > 0 then '<p><b>Encerradas desde o último aviso (' || n_fe || ')</b></p><ul>' || v_fechados || '</ul>' else '' end
    || case when v_link <> '' then '<p><a href="' || public.central_html(v_link) || '" style="display:inline-block;background:#3f5e8c;color:#fff;text-decoration:none;padding:8px 14px;border-radius:4px">Abrir a Central BPO</a></p>' else '' end
    || '<p style="color:#8a939d;font-size:12px">Aviso automático da Central BPO (8h, 12h e 17h). Os detalhes ficam só dentro do sistema.</p></div>';
  html := v_html;
  return next;
end $$;
revoke all on function public.central_notificacao_conteudo(uuid, timestamptz) from public, anon, authenticated;

-- envia o aviso de cada pessoa ativa com e-mail (rotina agendada). p_so_para: testar com uma pessoa só.
create or replace function public.central_enviar_notificacoes(p_rotulo text default 'manual', p_so_para uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_url text; v_seg text; p record; c record; v_req bigint; n integer := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'central_n8n_email_url' limit 1;
  select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'central_n8n_email_segredo' limit 1;
  if v_url is null or v_seg is null then raise exception 'NOTIFICACAO_SEM_CONFIG' using hint = 'Crie central_n8n_email_url e central_n8n_email_segredo no Vault.'; end if;
  for p in select x.usuario_id, pu.email from public.central_colaboradores x join public.perfis_usuarios pu on pu.usuario_id = x.usuario_id
            where x.ativo and coalesce(pu.email, '') <> '' and (p_so_para is null or x.usuario_id = p_so_para) loop
    select * into c from public.central_notificacao_conteudo(p.usuario_id);
    if c.itens = 0 then continue; end if;
    select net.http_post(
      url := v_url,
      body := jsonb_build_object('versao', 1, 'para', jsonb_build_array(p.email), 'assunto', c.assunto, 'html', c.html),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_seg),
      timeout_milliseconds := 30000) into v_req;
    insert into public.central_notificacoes_envio (usuario_id, email, rotulo, itens, pedido_id) values (p.usuario_id, p.email, p_rotulo, c.itens, v_req);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.central_enviar_notificacoes(text, uuid) from public, anon, authenticated;

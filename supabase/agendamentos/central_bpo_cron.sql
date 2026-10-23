-- =============================================================================
-- Central BPO · Rotinas agendadas (pg_cron)
--
-- Aplicar DEPOIS das 3 migrations, com a extensão pg_cron habilitada
-- (Supabase: Database → Extensions → pg_cron).
-- Horários em UTC. São Paulo = UTC−3 (sem horário de verão).
-- =============================================================================

-- 22h em São Paulo = 01h UTC do dia seguinte: fecha e congela o dia que está acabando.
select cron.schedule('central-fechar-dia', '0 1 * * *',
  $$ select public.central_fechar_dia(((now() at time zone 'America/Sao_Paulo') - interval '1 hour')::date); $$);

-- 05h em São Paulo = 08h UTC: garante as tarefas de hoje até o fim do mês seguinte (idempotente).
select cron.schedule('central-gerar-tarefas', '0 8 * * *',
  $$ select public.central_gerar_tarefas((now() at time zone 'America/Sao_Paulo')::date,
            (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '2 months - 1 day')::date); $$);

-- Aviso por e-mail (n8n) às 8h, 12h e 17h em São Paulo = 11h, 15h e 20h UTC, de segunda a sexta.
-- Precisa no Vault: central_n8n_email_url, central_n8n_email_segredo e central_app_url.
select cron.schedule('central-aviso-08h', '0 11 * * 1-5', $$ select public.central_enviar_notificacoes('08h'); $$);
select cron.schedule('central-aviso-12h', '0 15 * * 1-5', $$ select public.central_enviar_notificacoes('12h'); $$);
select cron.schedule('central-aviso-17h', '0 20 * * 1-5', $$ select public.central_enviar_notificacoes('17h'); $$);

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

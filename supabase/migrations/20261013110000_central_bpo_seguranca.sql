-- =============================================================================
-- Central BPO · segurança antes de liberar para a equipe (13/10/2026)
--
-- 1. As tabelas que a Central controla deixam de aceitar gravação direta de
--    usuário logado: só as funções da Central (com as regras) gravam nelas.
--    Sem isso, quem soubesse usar a API poderia marcar tarefa como concluída ou
--    mexer no tempo sem passar pelo cronômetro.
-- 2. search_path fixo nas funções auxiliares (aviso do Supabase Advisor).
-- 3. Funções auxiliares internas saem da API (o app não precisa chamá-las).
-- =============================================================================

-- 1. gravação só pelas funções
revoke insert, update, delete on public.tarefas_operacionais, public.apontamentos_tempo,
  public.rotinas_empresa, public.modelos_rotina from authenticated, anon;

-- 2. search_path fixo
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'central\_%'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, pg_catalog;', f.sig);
  end loop;
end $$;

-- 3. auxiliares internas: só as funções da Central (que rodam como dono) usam
revoke execute on function public.central_hms(integer) from authenticated;
revoke execute on function public.central_dmy(date) from authenticated;
revoke execute on function public.central_dia_semana(text) from authenticated;
revoke execute on function public.central_int(text) from authenticated;
revoke execute on function public.central_rotina_bate(text, jsonb, date, date) from authenticated;
revoke execute on function public.central_incompletas(uuid) from authenticated;

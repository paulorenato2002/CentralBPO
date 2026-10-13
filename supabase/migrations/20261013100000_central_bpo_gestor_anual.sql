-- =============================================================================
-- Central BPO · quem vê "mensais e pontuais" também vê as tarefas anuais (13/10/2026)
-- O gestor financeiro cuida das revisões anuais (ex.: reporting anual de DRE).
-- =============================================================================
create or replace function public.central_ve_tipo(p_tipo text, p_usuario uuid default auth.uid())
returns boolean language sql stable as $$
  select public.central_perm('tipos_tarefa', p_usuario) = 'todas' or coalesce(p_tipo, 'pontual') in ('mensal', 'anual', 'pontual');
$$;

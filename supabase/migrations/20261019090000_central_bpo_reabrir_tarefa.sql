-- Central BPO · reabrir tarefa concluída (19/10/2026)
-- Quem pode concluir pode reabrir (responsável ou papel com "concluir tarefa de outra pessoa").
-- Volta a pendente e limpa quem concluiu, quando e o tempo da tarefa; o tempo de cronômetro
-- já registrado na sessão continua lá. O checklist fica como estava. Fica no histórico.

create or replace function public.central_reabrir_tarefa(p_tarefa uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := public.central_eu(); t public.tarefas_operacionais; v_quem text;
begin
  select * into t from public.tarefas_operacionais where id = p_tarefa and ativo for update;
  if not found or not public.central_ve_empresa(t.empresa_id) then raise exception 'TAREFA_INVALIDA'; end if;
  if t.status <> 'concluida' then raise exception 'NAO_CONCLUIDA'; end if;
  if not public.central_pode_mexer(p_tarefa, u) then raise exception 'SEM_PERMISSAO'; end if;
  select nome into v_quem from public.perfis_usuarios where usuario_id = t.concluida_por;
  update public.tarefas_operacionais
     set status = 'pendente', concluida_em = null, concluida_por = null,
         duracao_segundos = null, duracao_real_minutos = null, updated_by = u
   where id = p_tarefa;
  perform public.central_registrar('tarefa', t.empresa_id,
    'reabriu a tarefa "' || t.titulo || '"' || coalesce(' (concluída por ' || v_quem || ')', ''), 'tarefas_operacionais', p_tarefa);
end $$;
revoke all on function public.central_reabrir_tarefa(uuid) from public, anon;
grant execute on function public.central_reabrir_tarefa(uuid) to authenticated;

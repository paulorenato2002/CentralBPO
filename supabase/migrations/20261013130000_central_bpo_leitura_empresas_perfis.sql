-- =============================================================================
-- Central BPO · leitura de clientes e proteção do perfil (13/10/2026)
--
-- 1. public.empresas tem RLS ligada e nenhuma política no banco real: para o
--    usuário logado ela fica vazia, e as views da Central (que juntam com
--    empresas) não mostrariam nenhum cliente. Política nova: cada pessoa lê só
--    os clientes que a Central deixa ela ver (central_ve_empresa).
-- 2. perfis_usuarios deixava cada pessoa alterar a PRÓPRIA linha inteira,
--    inclusive papel e ativo: uma estagiária poderia virar administradora, e
--    alguém desativado poderia se reativar. Agora o usuário logado só altera
--    nome, departamento e observações. Papel e ativo: só pelo servidor
--    (service_role) ou pelas funções da Central.
-- =============================================================================

drop policy if exists central_empresas_select on public.empresas;
create policy central_empresas_select on public.empresas
  for select to authenticated
  using (public.central_ve_empresa(id));

revoke update on public.perfis_usuarios from authenticated;
grant update (nome, departamento, observacoes) on public.perfis_usuarios to authenticated;

-- Central BPO · preenche a ficha do cliente com o que já veio do Trello (14/10/2026)
--
-- O PROBLEMA: a ficha do cliente abria com sócios e contatos vazios, mesmo com a
-- base do Trello já importada. Os dados não estavam faltando — estavam em outro
-- lugar. A importação do Trello gravou as pessoas em `empresa_pessoas` +
-- `pessoas` (tabelas do Agente). A Central lê de `central_clientes.socios` e
-- `.contatos`, que são jsonb e nasceram em '[]'. Ninguém nunca ligou os dois.
--
-- Hoje: 11 vínculos em empresa_pessoas (6 sócios, 3 gestores, 2 funcionários)
-- contra 1 sócio em central_clientes — o único que o Paulo digitou à mão na 141.
--
-- O QUE ESTA MIGRATION FAZ: copia os vínculos para a ficha, no formato que a
-- tela já espera ({nome, doc, part}).
--   sócio                   -> socios[]    nome, CPF, participação (vazia: a
--                                          coluna de % não existe em empresa_pessoas)
--   gestor e funcionário    -> contatos[]  nome, cargo, telefone
--
-- NÃO SOBRESCREVE NADA. Só preenche onde a lista está vazia. A 141 Rezende, que
-- o Paulo preencheu na mão, fica exatamente como está. Rodar de novo não duplica
-- e não desfaz edição posterior.
--
-- Fica como função, não como UPDATE solto, para poder ser chamada outra vez
-- quando entrar cliente novo pela importação.

create or replace function public.central_ficha_do_cadastro(p_empresa uuid default null)
returns table (empresa text, socios_add int, contatos_add int)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  with origem as (
    select
      v.empresa_id,
      -- sócio: participação fica vazia de propósito; empresa_pessoas não guarda %
      coalesce(jsonb_agg(
        jsonb_build_object('nome', p.nome, 'doc', coalesce(p.cpf, ''), 'part', '')
        order by p.nome
      ) filter (where v.tipo_vinculo = 'socio'), '[]'::jsonb) as socios,
      -- contato: a tela rotula doc = "Função" e part = "Telefone"
      coalesce(jsonb_agg(
        jsonb_build_object(
          'nome', p.nome,
          'doc',  coalesce(nullif(v.cargo, ''), initcap(v.tipo_vinculo)),
          'part', coalesce(p.telefone_principal, '')
        )
        order by p.nome
      ) filter (where v.tipo_vinculo <> 'socio'), '[]'::jsonb) as contatos
    from public.empresa_pessoas v
    join public.pessoas p on p.id = v.pessoa_id
    where v.ativo
      and (p_empresa is null or v.empresa_id = p_empresa)
    group by v.empresa_id
  ),
  gravado as (
    update public.central_clientes c
       set socios   = case when c.socios   = '[]'::jsonb or c.socios   is null then o.socios   else c.socios   end,
           contatos = case when c.contatos = '[]'::jsonb or c.contatos is null then o.contatos else c.contatos end,
           updated_at = now()
      from origem o
     where o.empresa_id = c.empresa_id
       -- só toca em quem está vazio: ficha preenchida à mão é intocável
       and (
             ((c.socios   = '[]'::jsonb or c.socios   is null) and jsonb_array_length(o.socios)   > 0)
          or ((c.contatos = '[]'::jsonb or c.contatos is null) and jsonb_array_length(o.contatos) > 0)
           )
    returning c.empresa_id,
              jsonb_array_length(c.socios)   as ns,
              jsonb_array_length(c.contatos) as nc
  )
  select coalesce(e.nome_fantasia, e.razao_social), g.ns, g.nc
    from gravado g
    join public.empresas e on e.id = g.empresa_id
   order by 1;
end;
$$;

comment on function public.central_ficha_do_cadastro(uuid) is
  'Preenche central_clientes.socios/contatos a partir de empresa_pessoas. Só onde está vazio; nunca sobrescreve.';

-- Manutenção, não função de tela: ninguém do app executa isto. Reescrever ficha
-- de cliente em massa é operação de migration/backend, não de usuário logado.
revoke all on function public.central_ficha_do_cadastro(uuid) from public, anon, authenticated;


-- Execução agora, para as 6 empresas que já existem.
-- O resultado some (é dentro do do-block); para ver o que entrou, rode depois:
--   select * from public.central_ficha_do_cadastro();
do $$
declare n int;
begin
  select count(*) into n from public.central_ficha_do_cadastro();
  raise notice 'ficha preenchida em % cliente(s)', n;
end;
$$;


-- -----------------------------------------------------------------------------
-- Verificação — rode depois de aplicar. Nenhuma linha deve ficar com 0 e 0
-- em cliente que tem vínculo cadastrado.
-- -----------------------------------------------------------------------------
--
-- select e.codigo,
--        coalesce(e.nome_fantasia, e.razao_social)      as cliente,
--        jsonb_array_length(c.socios)                   as socios,
--        jsonb_array_length(c.contatos)                 as contatos,
--        (select count(*) from public.empresa_pessoas v
--          where v.empresa_id = e.id and v.ativo)       as vinculos_no_cadastro
--   from public.central_clientes c
--   join public.empresas e on e.id = c.empresa_id
--  order by e.codigo;

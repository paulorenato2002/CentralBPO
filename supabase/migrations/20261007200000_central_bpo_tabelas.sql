-- =============================================================================
-- Central BPO · 1/3 · Tabelas
--
-- Reaproveita o esquema operacional existente:
--   empresas, perfis_usuarios, modelos_rotina, rotinas_empresa,
--   tarefas_operacionais, apontamentos_tempo, eventos_operacionais.
-- Só ACRESCENTA: tabelas novas com prefixo central_ e colunas novas (todas
-- opcionais) em tarefas_operacionais e apontamentos_tempo. Nada existente é
-- removido, renomeado ou tornado obrigatório.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Colaboradores da Central (papel próprio, separado do papel do agente)
-- -----------------------------------------------------------------------------
create table if not exists public.central_colaboradores (
  usuario_id           uuid primary key references public.perfis_usuarios(usuario_id) on delete cascade,
  papel_central        varchar(30) not null default 'estagiaria',
  carga_horaria_mes    integer not null default 0,
  ativo                boolean not null default true,
  senha_redefinida_em  timestamptz,
  senha_redefinida_por uuid references public.perfis_usuarios(usuario_id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint central_colab_papel_check
    check (papel_central in ('estagiaria', 'analista', 'supervisor', 'gestor_financeiro', 'administrador')),
  constraint central_colab_carga_check check (carga_horaria_mes between 0 and 260)
);
comment on table public.central_colaboradores is 'Quem usa a Central BPO, com o papel que define as permissões (ver central_permissoes).';

-- -----------------------------------------------------------------------------
-- 2. Matriz de permissões por papel (editável pelo administrador)
--    s = faz · n = não faz · p = pede ao Adm · tipos_tarefa: todas | mensais_pontuais
-- -----------------------------------------------------------------------------
create table if not exists public.central_permissoes (
  papel_central varchar(30) not null,
  acao          varchar(40) not null,
  valor         varchar(20) not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  primary key (papel_central, acao),
  constraint central_perm_papel_check
    check (papel_central in ('estagiaria', 'analista', 'supervisor', 'gestor_financeiro', 'administrador')),
  constraint central_perm_acao_check check (acao in (
    'ver_todos_clientes', 'tipos_tarefa', 'concluir_outra', 'transferir', 'alterar_datas',
    'ver_registros_todos', 'senha_cadastrar', 'senha_alterar', 'cliente_cadastrar',
    'cliente_sensivel', 'rotina', 'colaborador')),
  constraint central_perm_valor_check check (valor in ('s', 'n', 'p', 'todas', 'mensais_pontuais'))
);

insert into public.central_permissoes (papel_central, acao, valor)
select p.papel, a.acao,
  case
    when p.papel = 'administrador' then case when a.acao = 'tipos_tarefa' then 'todas' else 's' end
    when a.acao = 'tipos_tarefa' then case when p.papel = 'gestor_financeiro' then 'mensais_pontuais' else 'todas' end
    when a.acao = 'ver_todos_clientes' then case when p.papel = 'gestor_financeiro' then 's' else 'n' end
    when a.acao in ('concluir_outra', 'transferir', 'alterar_datas') then case when p.papel = 'estagiaria' then 'n' else 's' end
    when a.acao = 'ver_registros_todos' then case when p.papel = 'supervisor' then 's' else 'n' end
    when a.acao in ('senha_cadastrar', 'cliente_cadastrar') then 's'
    else 'p'
  end
from (values ('estagiaria'), ('analista'), ('supervisor'), ('gestor_financeiro'), ('administrador')) p(papel)
cross join (values ('ver_todos_clientes'), ('tipos_tarefa'), ('concluir_outra'), ('transferir'), ('alterar_datas'),
  ('ver_registros_todos'), ('senha_cadastrar'), ('senha_alterar'), ('cliente_cadastrar'), ('cliente_sensivel'),
  ('rotina'), ('colaborador')) a(acao)
on conflict (papel_central, acao) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Dados do cliente que a Central usa (complementa public.empresas)
-- -----------------------------------------------------------------------------
create table if not exists public.central_clientes (
  empresa_id         uuid primary key references public.empresas(id) on delete cascade,
  situacao           varchar(20) not null default 'implantacao',
  prioridade         varchar(10) not null default 'normal',
  honorario_mensal   numeric(12,2),
  plano              varchar(30),
  inicio_contrato    date,
  sistema_financeiro text,
  grupo_principal    text,
  email_financeiro   text,
  endereco           text,
  cidade             text,
  cep                varchar(10),
  particularidades   text,
  socios             jsonb not null default '[]'::jsonb,
  contatos           jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint central_cli_situacao_check check (situacao in ('implantacao', 'ativa', 'bloqueada', 'encerrada')),
  constraint central_cli_prioridade_check check (prioridade in ('alta', 'normal', 'baixa')),
  constraint central_cli_honorario_check check (honorario_mensal is null or honorario_mensal >= 0)
);

-- Equipe da Effective atrelada a cada cliente (quem vê o cliente em Tarefas).
create table if not exists public.central_vinculos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null references public.perfis_usuarios(usuario_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);

-- -----------------------------------------------------------------------------
-- 4. Rotinas: usa public.rotinas_empresa.
--    frequencia (diaria|semanal|quinzenal|mensal), situacao (ativa|pausada),
--    vigencia_inicio/fim e regra_agendamento já existem. A regra fica em
--    regra_agendamento: {"dia_semana":5} · {"dia_mes":10,"dia_meta":9}.
--    Responsáveis (vários) e checklist padrão ficam nas tabelas abaixo.
-- -----------------------------------------------------------------------------
create table if not exists public.central_rotina_responsaveis (
  rotina_empresa_id uuid not null references public.rotinas_empresa(id) on delete cascade,
  usuario_id        uuid not null references public.perfis_usuarios(usuario_id) on delete cascade,
  primary key (rotina_empresa_id, usuario_id)
);

create table if not exists public.central_rotina_checklist (
  id                uuid primary key default gen_random_uuid(),
  rotina_empresa_id uuid not null references public.rotinas_empresa(id) on delete cascade,
  ordem             smallint not null,
  texto             text not null,
  constraint central_rot_ck_texto_check check (length(trim(texto)) > 0),
  unique (rotina_empresa_id, ordem)
);

-- -----------------------------------------------------------------------------
-- 5. Tarefas: usa public.tarefas_operacionais + colunas novas (opcionais)
-- -----------------------------------------------------------------------------
alter table public.tarefas_operacionais add column if not exists data_meta        date;
alter table public.tarefas_operacionais add column if not exists tipo_recorrencia varchar(20);
alter table public.tarefas_operacionais add column if not exists concluida_por    uuid references public.perfis_usuarios(usuario_id) on delete set null;
alter table public.tarefas_operacionais add column if not exists duracao_segundos integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tarefas_op_tipo_recorrencia_check') then
    alter table public.tarefas_operacionais add constraint tarefas_op_tipo_recorrencia_check
      check (tipo_recorrencia is null or tipo_recorrencia in ('diaria', 'semanal', 'quinzenal', 'mensal', 'pontual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tarefas_op_meta_antes_prazo_check') then
    alter table public.tarefas_operacionais add constraint tarefas_op_meta_antes_prazo_check
      check (data_meta is null or prazo is null or data_meta <= prazo);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tarefas_op_duracao_segundos_check') then
    alter table public.tarefas_operacionais add constraint tarefas_op_duracao_segundos_check
      check (duracao_segundos is null or duracao_segundos >= 0);
  end if;
end $$;

create index if not exists tarefas_op_central_alvo_idx
  on public.tarefas_operacionais (empresa_id, (coalesce(data_meta, prazo))) where ativo;

create table if not exists public.central_tarefa_responsaveis (
  tarefa_id  uuid not null references public.tarefas_operacionais(id) on delete cascade,
  usuario_id uuid not null references public.perfis_usuarios(usuario_id) on delete cascade,
  primary key (tarefa_id, usuario_id)
);
create index if not exists central_tarefa_resp_usuario_idx on public.central_tarefa_responsaveis (usuario_id);

create table if not exists public.central_tarefa_checklist (
  id          uuid primary key default gen_random_uuid(),
  tarefa_id   uuid not null references public.tarefas_operacionais(id) on delete cascade,
  ordem       smallint not null,
  texto       text not null,
  marcado     boolean not null default false,
  marcado_por uuid references public.perfis_usuarios(usuario_id) on delete set null,
  marcado_em  timestamptz,
  constraint central_tar_ck_texto_check check (length(trim(texto)) > 0),
  unique (tarefa_id, ordem)
);

create table if not exists public.central_tarefa_observacoes (
  id         uuid primary key default gen_random_uuid(),
  tarefa_id  uuid not null references public.tarefas_operacionais(id) on delete cascade,
  usuario_id uuid not null references public.perfis_usuarios(usuario_id),
  texto      text not null,
  created_at timestamptz not null default now(),
  constraint central_obs_texto_check check (length(trim(texto)) > 0)
);

-- -----------------------------------------------------------------------------
-- 6. Cronômetro
--    Sessão = 1 pessoa × 1 cliente × 1 dia. Cada trecho rodando é uma linha de
--    public.apontamentos_tempo (o índice único existente já garante no máximo
--    um cronômetro rodando por pessoa).
-- -----------------------------------------------------------------------------
create table if not exists public.central_sessoes (
  id                  uuid primary key default gen_random_uuid(),
  usuario_id          uuid not null references public.perfis_usuarios(usuario_id) on delete cascade,
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  dia                 date not null,
  estado              varchar(15) not null default 'rodando',
  checkpoint_segundos integer not null default 0,
  ultima_atividade    timestamptz not null default now(),
  finalizada_em       timestamptz,
  fechada_auto        boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint central_sessao_estado_check check (estado in ('rodando', 'pausada', 'finalizada', 'fechada')),
  constraint central_sessao_checkpoint_check check (checkpoint_segundos >= 0),
  unique (usuario_id, empresa_id, dia)
);

alter table public.apontamentos_tempo add column if not exists sessao_id uuid references public.central_sessoes(id) on delete cascade;
create index if not exists apontamentos_tempo_sessao_idx on public.apontamentos_tempo (sessao_id) where sessao_id is not null;

-- Dia fechado às 22h: congela o registro de horas.
create table if not exists public.central_dias_fechados (
  dia        date primary key,
  fechado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. Anotações do dia (vão no resumo por e-mail das 12h30 e 17h)
-- -----------------------------------------------------------------------------
create table if not exists public.central_anotacoes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null references public.perfis_usuarios(usuario_id),
  dia        date not null,
  texto      text not null,
  enviada_em timestamptz,
  created_at timestamptz not null default now(),
  constraint central_anot_texto_check check (length(trim(texto)) > 0)
);
create index if not exists central_anotacoes_dia_idx on public.central_anotacoes (dia, empresa_id);

-- -----------------------------------------------------------------------------
-- 8. Senhas e acessos dos clientes — senha SEMPRE cifrada (pgcrypto + chave no Vault)
-- -----------------------------------------------------------------------------
create table if not exists public.central_acessos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  sistema        text not null,
  tipo           varchar(15) not null default 'outro',
  link           text,
  usuario_login  text,
  senha_cifrada  bytea,
  observacoes    text,
  ativo          boolean not null default true,
  alterada_em    timestamptz not null default now(),
  alterada_por   uuid references public.perfis_usuarios(usuario_id) on delete set null,
  criado_por     uuid references public.perfis_usuarios(usuario_id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint central_acesso_tipo_check check (tipo in ('banco', 'plataforma', 'email', 'governo', 'outro')),
  constraint central_acesso_sistema_check check (length(trim(sistema)) > 0)
);
create index if not exists central_acessos_empresa_idx on public.central_acessos (empresa_id) where ativo;

-- -----------------------------------------------------------------------------
-- 9. Pedidos ao administrador (quando o papel "pede ao Adm")
-- -----------------------------------------------------------------------------
create table if not exists public.central_solicitacoes (
  id            uuid primary key default gen_random_uuid(),
  solicitante   uuid not null references public.perfis_usuarios(usuario_id),
  acao          varchar(40) not null,
  empresa_id    uuid references public.empresas(id) on delete set null,
  entidade_tipo varchar(40),
  entidade_id   uuid,
  descricao     text not null,
  status        varchar(15) not null default 'pendente',
  decidido_por  uuid references public.perfis_usuarios(usuario_id),
  decidido_em   timestamptz,
  created_at    timestamptz not null default now(),
  constraint central_sol_status_check check (status in ('pendente', 'aprovada', 'recusada'))
);
create index if not exists central_solicitacoes_pendentes_idx on public.central_solicitacoes (created_at) where status = 'pendente';

-- updated_at automático (função já existente no esquema operacional)
do $$
declare t text;
begin
  foreach t in array array['central_colaboradores', 'central_clientes'] loop
    execute format('drop trigger if exists %I on public.%I;', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.op_set_updated_at();', t || '_set_updated_at', t);
  end loop;
end $$;

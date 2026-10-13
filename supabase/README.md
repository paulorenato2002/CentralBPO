# Backend da Central BPO (Supabase)

Banco, regras de negócio e regras de acesso da Central, em Postgres (Supabase).

## Como está montado

O backend **se apoia no esquema operacional que já existe** (empresas, perfis de usuário, rotinas, tarefas, apontamentos de tempo e eventos). Ele só acrescenta: tabelas novas com prefixo `central_`, colunas novas e opcionais, funções e views. Nada existente é removido, renomeado ou tornado obrigatório.

| Arquivo | O que faz |
|---|---|
| `migrations/…_central_bpo_tabelas.sql` | Tabelas: colaboradores e papéis, matriz de permissões, dados do cliente, vínculos, responsáveis e checklist (de rotina e de tarefa), observações, sessões do cronômetro, dias fechados, anotações, acessos cifrados, pedidos ao Adm |
| `migrations/…_central_bpo_regras.sql` | Funções com as regras: entrar, pausar e finalizar; concluir com tempo; checklist; datas; transferência; tarefa pontual; geração de tarefas pelas rotinas; clientes; acessos; colaboradores; permissões; fechamento das 22h; painel |
| `migrations/…_central_bpo_acesso.sql` | RLS, views de leitura e quem pode chamar cada função |
| `migrations/…_central_bpo_ajustes.sql` | Lê as regras no formato das rotinas que já existem ("sexta", dias [1, 15], anual) e deixa as views só para leitura |
| `agendamentos/central_bpo_cron.sql` | Rotinas agendadas (pg_cron): fechar o dia às 22h e gerar as tarefas às 05h |
| `testes/rodar.mjs` | 66 testes automáticos num Postgres descartável |

## Princípios

- **Ler pelas views, escrever só pelas funções.** O app não tem permissão de gravar direto nas tabelas `central_`.
- **O tempo é calculado no banco,** com o relógio do servidor. O tempo de uma tarefa é o tempo ativo no momento da conclusão menos o tempo ativo na conclusão anterior; a pausa não conta.
- **Permissão vem do papel,** pela matriz `central_permissoes`, que o administrador edita. Quando o papel não pode fazer uma ação sensível, ela vira um **pedido ao Adm** (`central_solicitacoes`).
- **A senha nunca fica em texto:** é cifrada com pgcrypto, e a chave fica no Supabase Vault (`central_acessos_chave`). Ela só sai pela função `central_revelar_senha`, que registra quem viu.
- **Tudo vai para o histórico** (`eventos_operacionais`, tipo `central.*`).
- **Erros têm código curto** (ex.: `CHECKLIST_INCOMPLETO`, `DIA_FECHADO`, `OUTRO_CLIENTE_RODANDO`), para o app mostrar a mensagem certa.

## Funções que o app chama

| Função | Para quê |
|---|---|
| `central_entrar(empresa)` | Liga ou retoma o cronômetro da pessoa no cliente |
| `central_sair(sessao, 'pausar' \| 'finalizar')` | Pausa ou finaliza o cliente no dia |
| `central_concluir_tarefa(tarefa)` | Conclui a tarefa e grava o tempo dela |
| `central_marcar_item` / `central_adicionar_item` | Marca ou acrescenta um item de checklist |
| `central_comentar(tarefa, texto)` | Observação na tarefa |
| `central_alterar_datas(tarefa, meta, entrega)` | Altera as datas (não vale para diária) |
| `central_transferir(tarefa, de, para)` | Troca um responsável |
| `central_criar_pontual(empresa, titulo, data)` | Tarefa pontual para si mesmo |
| `central_anotar(empresa, texto)` | Anotação do dia |
| `central_salvar_rotina(...)` / `central_excluir_rotina` | Cadastro de rotinas (a mudança vale a partir de amanhã) |
| `central_salvar_cliente(empresa, dados)` / `central_encerrar_cliente` | Cadastro de clientes |
| `central_salvar_acesso(...)` / `central_revelar_senha` / `central_registrar_acesso` / `central_excluir_acesso` | Senhas e acessos |
| `central_salvar_colaborador(...)` / `central_registrar_redefinicao` | Colaboradores |
| `central_definir_permissao(papel, acao, valor)` | Matriz de permissões (só o Adm) |
| `central_decidir_solicitacao(id, aprovar)` | Aprovar ou recusar um pedido (só o Adm) |
| `central_painel(de, ate, so_minhas)` | Números da Home por cliente |

**Views de leitura:** `central_vw_tarefas`, `central_vw_sessoes`, `central_vw_historico` e `central_vw_rotinas`.

## Testar

```bash
npm install
npm run test:db
```

O teste monta o esquema operacional (de `CENTRAL_BASE_DIR`, por padrão `../Agente BPO/supabase`), aplica as migrations duas vezes para provar que são idempotentes e roda o cenário completo do dia.

## Aplicar num projeto Supabase

1. Crie o segredo no Vault: **Project Settings → Vault → New secret**, com nome `central_acessos_chave` e um valor aleatório de 32 ou mais caracteres. **Guarde o valor:** sem ele, as senhas cadastradas não abrem mais.
2. Rode as 3 migrations, em ordem, no **SQL Editor** (ou `supabase db push`).
3. Habilite a extensão **pg_cron** e rode `agendamentos/central_bpo_cron.sql`.
4. Cadastre os colaboradores em `central_colaboradores` (papel e carga), os vínculos com clientes e as rotinas pelo app.

## Pendências conhecidas

- As tabelas operacionais antigas (`tarefas_operacionais` e outras) ainda aceitam gravação direta de qualquer usuário interno, pela RLS do agente. Restringir isso exige revisar o agente junto, para não quebrá-lo.
- A redefinição da senha de login é feita pelo servidor do app (API administrativa do Supabase Auth); o banco só registra quem redefiniu e quando.
- O resumo por e-mail das 12h30 e das 17h ainda falta: vai usar `central_anotacoes`, mais o mensageiro ou o n8n que já existem.

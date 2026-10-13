# Central BPO

**Central de operação para BPO financeiro:** tarefas recorrentes por cliente, cronômetro por pessoa, calendário da operação, cofre de acessos e cadastros, tudo num lugar só e com trilha de quem fez o quê.

> **Status:** protótipo navegável + **backend em Supabase** (tabelas, regras, permissões e 71 testes automáticos). Todos os nomes de clientes, pessoas, valores e acessos são **fictícios**. Próxima fase: app em Next.js + Supabase publicado na Vercel.

---

## Contexto

Num BPO financeiro, a equipe atende várias empresas ao mesmo tempo, e cada uma tem rotinas diárias, semanais, quinzenais e mensais: conciliação bancária, contas a pagar e a receber, agendamentos, fechamento, relatórios para a contabilidade e revisão de DRE.

Hoje esse controle costuma ficar espalhado entre quadros de tarefas, planilhas, grupos de mensagem e anotações. Isso gera três problemas:

- **Não se sabe quanto tempo cada cliente consome.** Sem esse número, não dá para precificar nem medir a rentabilidade.
- **Não há histórico confiável:** quem fez, quando e em quanto tempo.
- **Senhas e acessos dos clientes ficam em texto livre,** sem controle de quem consultou.

A Central BPO nasceu para resolver isso, a partir da rotina real de uma operação de BPO e do mapeamento de ferramentas de mercado.

## Para que serve

| Objetivo | Como a Central resolve |
|---|---|
| Saber o que fazer hoje, em cada cliente | Rotinas cadastradas geram as tarefas do dia sozinhas, com checklist |
| Medir o tempo real | Cronômetro por pessoa e por cliente; o tempo de cada tarefa é registrado ao concluir |
| Cumprir prazos | Data **meta** (pronto até) separada da data de **entrega**; atrasadas em destaque |
| Ver a operação de cima | Painel com andamento por cliente, entregas por dia e tempo médio por tarefa |
| Proteger acessos | Cofre de senhas por cliente; cada visualização e cópia fica registrada |
| Dar responsabilidade clara | Papéis com permissões configuráveis; trilha completa de alterações |

## Impacto numa operação de BPO ou de serviços financeiros

- **Precificação com base em dado real:** horas por cliente e por tarefa saem dos registros, não de estimativa.
- **Menos retrabalho e menos esquecimento:** a tarefa nasce da rotina, com checklist obrigatório para concluir.
- **Escala com controle:** um cliente novo entra pelo cadastro, já com as rotinas e a equipe vinculada.
- **Segurança e auditoria:** senhas fora de cartões e mensagens, acesso por papel e histórico de quem viu ou alterou.
- **Gestão que enxerga gargalo:** o painel compara o tempo do período com a média histórica de cada tarefa.

## Como funciona o dia

1. A pessoa entra e vê a **Home**: o que está atrasado, o que é de hoje e o andamento de cada cliente.
2. Em **Tarefas**, escolhe um cliente: o **cronômetro começa** (só para ela, só naquele cliente).
3. Executa as tarefas do dia. Cada conclusão grava o tempo daquela tarefa (tempo ativo desde a conclusão anterior; pausa não conta).
4. Ao sair, escolhe **Pausar** ("vou em outro cliente e já volto") ou **Finalizar** ("terminei este cliente hoje").
5. Às **22h** o registro do dia fecha e congela. Só o administrador corrige, direto no banco.

## Abas e funções

| Aba | O que tem |
|---|---|
| **Home** | Números do dia, andamento por cliente (hoje, semana, mês ou período personalizado), gráfico de entregas por dia e tempo médio por tarefa × média histórica |
| **Tarefas** | Lista de clientes vinculados → tela do cliente com tarefas do dia, atrasadas, resto da semana, calendário do mês, anotações, tarefa pontual e **Senhas e acessos**. Clicar numa tarefa abre o **cartão**: recorrência, meta e entrega, responsáveis, checklist e observações |
| **Calendário** | Calendário da operação inteira (mês ou semana), com filtros por cliente, responsável e tipo; meta (◎) e entrega (▸) ligadas |
| **Histórico** | Registro de atividade por cliente, pessoa e data: iniciou, pausou, concluiu (com tempo), transferiu, consultou senha, alterou cadastro |
| **Cadastros · Clientes** | Ficha completa: dados, contrato e honorário, sócios, contatos, grupo principal, equipe atrelada; campos sensíveis protegidos |
| **Cadastros · Senhas** | Todos os acessos de todos os clientes, alerta de senha sem troca há mais de 180 dias, consultas recentes |
| **Cadastros · Tarefas** | Rotinas por cliente: diária, semanal, quinzenal ou mensal, com meta, responsáveis, checklist padrão e vigência; aplicação a vários clientes de uma vez |
| **Cadastros · Colaboradores** | Papel, clientes vinculados, carga horária × horas no mês, redefinição de senha de acesso e **matriz de permissões editável** pelo administrador |

**Também tem:** tema claro e escuro, quatro tamanhos de texto (pensado para leitura confortável) e datas sempre com ano.

## Papéis e permissões

Cinco papéis vêm de fábrica: Estagiária, Analista financeira, Supervisor, Gestor financeiro e Administrador. O que cada um pode fazer fica numa **matriz editável pelo administrador**, que vale na hora.

Quando um papel não pode fazer algo sensível, a ação vira um **pedido ao administrador**, e o pedido fica registrado. Isso vale, por exemplo, para alterar CNPJ ou honorário, excluir uma senha ou criar uma rotina.

As regras de negócio completas estão em [`docs/regras-de-negocio.md`](docs/regras-de-negocio.md).

## Estrutura técnica

**Hoje (protótipo)**

- Um único arquivo [`prototipo/index.html`](prototipo/index.html): HTML, CSS e JavaScript puros, sem bibliotecas e sem build.
- Dados fictícios gerados em memória (recarregar a página volta tudo ao início).
- Tema por variáveis CSS (claro e escuro); gráficos feitos em HTML e CSS.

**Backend (pronto)**

- Supabase/Postgres: 3 migrations com tabelas, funções de regra de negócio, RLS e views. Detalhes em [`supabase/README.md`](supabase/README.md).
- O tempo de cada tarefa é calculado no banco, com o relógio do servidor; as senhas ficam cifradas, com a chave no Vault.
- 71 testes automáticos num Postgres descartável (`npm run test:db`).

**Destino (aplicação)**

| Camada | Tecnologia |
|---|---|
| Interface | Next.js (React) |
| Banco, login e regras de acesso | Supabase (Postgres, Auth e Row Level Security) |
| Hospedagem | Vercel |
| Rotinas agendadas | Fechamento das 22h e resumo por e-mail às 12h30 e às 17h |
| Integrações previstas | Conta Azul, e-mail (n8n) e WhatsApp; agente de IA em painel lateral |

**Pastas**

```
CentralBPO/
├── prototipo/
│   └── index.html            # protótipo navegável
├── docs/
│   └── regras-de-negocio.md  # todas as regras decididas, fonte da verdade
├── supabase/
│   ├── migrations/           # tabelas, regras (funções) e acesso (RLS + views)
│   ├── agendamentos/         # pg_cron: fechamento das 22h e geração diária
│   ├── testes/rodar.mjs      # 71 testes automáticos
│   └── README.md             # como aplicar e quais funções o app chama
├── package.json              # npm run test:db
├── vercel.json               # publica o protótipo na raiz do site
├── LICENSE
└── README.md
```

## Como usar localmente

**Jeito mais simples:** abra `prototipo/index.html` no navegador (Chrome, Edge ou Firefox atualizados).

**Com um servidor local** (recomendado para testar como vai ficar na Vercel):

```bash
npx serve .
```

Depois acesse `http://localhost:3000/prototipo/`.

**Para testar os papéis:** troque o usuário no rodapé da barra lateral (Estagiária, Analista, Supervisor, Gestor ou Adm). No rodapé da aba Tarefas há o link "simular fechamento das 22h".

## Próximos passos

1. Revisão geral do protótipo com a equipe
2. ~~Tabelas no Supabase e regras de acesso por papel~~ ✓ (backend pronto e testado)
3. App em Next.js publicado na Vercel, com login individual
4. Rotinas agendadas: fechamento das 22h e resumos por e-mail
5. Painel do agente de IA dentro da tela do cliente

## Autoria

Projeto idealizado e conduzido por **Paulo Renato Nunes de Melo**.

Distribuído sob a licença MIT (veja [`LICENSE`](LICENSE)).

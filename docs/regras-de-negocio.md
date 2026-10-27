# Central BPO — regras de funcionamento

Fonte da verdade para o protótipo, o banco e o app. Atualizar a cada decisão.

## Navegação (revisado 07/10)

| Aba | O que mostra |
|---|---|
| **Home** | Painel da operação: atrasadas, hoje, previstas e concluídas; andamento por cliente no período (hoje / semana / mês / **personalizado**); **análise do fluxo de entrega** (gráficos). Botão "Entrar" leva direto ao cliente |
| **Tarefas** | Lista de clientes vinculados → entrar no cliente liga o cronômetro → quadro do dia, semana, calendário do mês. Clicar numa tarefa abre o **cartão de detalhe** |
| **Calendário** | Calendário completo da operação; filtro por cliente, período, responsável *(a fazer)* |
| **Histórico** | Histórico de atividade (antigo Cronômetro): consulta por cliente, usuário e data |

## Responsáveis

- Todos veem o quadro completo de tarefas.
- Cada tarefa tem **uma ou mais pessoas** responsáveis, mostradas como etiqueta com o nome (cor por pessoa; a da estagiária é roxa).
- Filtro "só as minhas" dentro de diário, semanal, mensal e pontual.

## Cronômetro (por usuário, por empresa, por dia)

1. Entrar na empresa **inicia** (ou retoma) o cronômetro **daquele usuário** naquela empresa.
2. **Pausar empresa** ou **Finalizar empresa** (ver seção "Pausar, finalizar e fechamento do dia").
3. Voltar à mesma empresa no mesmo dia → **retoma** de onde parou. Pode entrar e sair várias vezes.
4. O registro do dia **fecha às 22h** (job interno) e congela. Se algo ficou rodando, o trecho fecha no **último registro de atividade** e fica marcado "revisar". *(como corrigir no dia seguinte: em aberto)*
5. Tempo conta só trechos rodando; pausa não conta.

### Tempo por tarefa (checkpoint)

- Ao concluir uma tarefa, o sistema grava o **tempo ativo** do cronômetro naquele instante.
- Tempo da tarefa = tempo ativo agora − tempo ativo no checkpoint anterior (ou no início do dia, se for a primeira).
- Exemplo: conclui conciliação em 00:03:25 → tarefa = 3:25. Conclui a próxima em 00:07:23 → tarefa = 3:58.
- Como só conta tempo ativo, pausa entre duas tarefas não entra no tempo de nenhuma.
- Tempo depois da última tarefa (anotações, conferências) fica como **"sem tarefa"**, visível no relatório.
- Mais de uma pessoa na mesma tarefa: cada uma tem o seu tempo.

### Médias

- Toda média de horas vem dos **logs de tempo reais** (nada digitado).
- Tempo médio/dia por empresa = soma dos minutos ÷ dias com registro, últimos 90 dias.

## Anotações do dia (por empresa)

- Bloco de notas ao lado do quadro de tarefas do dia da empresa.
- Fica registrado para os analistas.
- Resumo enviado por e-mail aos analistas às **12h30** e às **17h** (mensageiro / n8n).

## Datas da tarefa

- **Data de entrega** (quando o cliente recebe) e **data meta** (até quando tem que estar pronto). Meta é opcional, usada só em alguns clientes.
- No calendário, as duas aparecem ligadas: mesma tarefa, meta e entrega destacadas.
- Ex.: relatório entregue dia 10, meta dia 09.

## Tela do cliente (quadro dinâmico)

- Só aparecem as **tarefas do dia**.
- As da **semana**, de forma resumida.
- As do **mês**, no calendário único do cliente, logo abaixo.
- Ao lado: bloco de **anotações do dia** do cliente.

## Cadastros

Clientes (ativa / implantação / bloqueada fica aqui, não no painel) · Senhas · Tarefas · Colaboradores.

## Registros de atividade

Ficam na aba **Cronômetro**, como tabela de registros (data e hora, colaborador, cliente, evento, tempo ativo, observação). Não aparecem na aba Clientes.

## Pausar, finalizar e fechamento do dia (aprovado em 07/10)

- Dentro do cliente, só **2 botões**:
  - **Pausar empresa** (principal): "vou em outra e já volto". Sem aviso. Voltar retoma de onde parou.
  - **Finalizar empresa** (vermelho, aviso simples): "terminei esta empresa hoje". Mostra o tempo e as tarefas incompletas.
- Reabrir um cliente finalizado pede confirmação e fica no registro ("reabriu as rotinas depois de finalizar").
- **Trava de saída:** com o cronômetro rodando, voltar aos clientes, trocar de aba ou abrir outro cliente pergunta: Pausar · Finalizar · Continuar. Esc não fecha. Fechar o navegador mostra o alerta do navegador.
- **Fechamento às 22h** (job interno, não é botão): congela o registro de horas do dia de todo mundo. Depois disso ninguém registra tempo naquele dia. Correção só pelo administrador, direto no banco.
  - O que estava rodando fecha na última atividade e fica marcado "revisar".
- Tarefa com mais de um responsável: cada um conclui a sua parte e tem o seu tempo; a tarefa fecha quando todos concluírem.

## Usuários e permissões (atualizado 07/10)

| Pessoa | Papel | Clientes | Tarefas que vê | Registros de tempo |
|---|---|---|---|---|
| Ana | Estagiária | vinculados | todas | só os dela |
| Bruna | Analista financeira | vinculados | todas | só os dela |
| Paulo | Supervisor | vinculados | todas | de todos |
| Carlos | Gestor financeiro | todos | só **mensais e pontuais** | só os dele |
| Adm | Administrador | todos | todas | de todos |

### Cadastros: abertos a todos, com trava nas ações sensíveis

| Ação | Adm | Demais |
|---|---|---|
| Consultar clientes, senhas, tarefas, colaboradores | faz | faz |
| Cadastrar cliente novo | faz | faz *(confirmar)* |
| Editar dados gerais (contatos, endereço, grupo, observações) | faz | faz *(confirmar)* |
| Editar dados sensíveis (CNPJ, razão social, honorário, sócios) | faz | **solicita** |
| Encerrar ou excluir cliente | faz | **solicita** |
| Cadastrar senha / acesso novo | faz | faz |
| Revelar senha | faz | faz (registrado) |
| Alterar ou excluir senha | faz | **solicita** |
| Cadastrar tarefa (padrão ou rotina do cliente) | faz | **solicita** |
| Excluir tarefa | faz | **solicita** |
| Cadastrar colaborador / mudar papel | faz | **solicita** |

- **Solicitação:** a pessoa pede ao agente → o agente registra o pedido → entra no relatório diário do Adm → o Adm aprova (a alteração é aplicada) ou recusa. Até o agente existir, a tela terá um botão "Solicitar ao Adm".
- **Auditoria:** toda inclusão, alteração e exclusão registra quem, quando, o quê, valor antes e valor depois. Vale para clientes, senhas, tarefas e colaboradores.

## Agente de IA (depois da Central de tarefas)

- Ordem: terminar a Central de tarefas → sessão de consultas ao banco → agente.
- O agente tem **aba própria** e também abre **ao lado da tela do cliente**, como painel lateral (estilo Claude in Chrome), chamado por um ícone.
- No painel ele ajuda nas demandas: consulta rápida, guardar relatórios, salvar informações.
- **Substitui o quadro de anotações do dia:** a pessoa fala com o agente, ele registra a observação e envia por e-mail (12h30 e 17h) e, no futuro, por WhatsApp.

## Calendário do cliente (07/10)

- Mês inteiro, de segunda a domingo (fim de semana estreito). Navega entre meses; botão Hoje.
- **Diárias resumidas** por dia ("2/6 diárias"); semanais, mensais e pontuais aparecem pelo nome.
- Cores: vencida (vermelho) · hoje (azul) · futura (cinza) · concluída (verde). Hoje fica com borda azul.
- Tarefa com **meta** aparece duas vezes, ligadas: **◎** no dia da meta e **▸** no dia da entrega. Passar o mouse destaca as duas.
- A tarefa entra em "Hoje" e em "Atrasadas" pela **meta** (quando existe), não pela entrega.
- Respeita os filtros e o papel de quem vê (Carlos só vê mensais e pontuais).
- Calendário começa no **domingo**.
- **Recorrência:** cada cliente tem as suas regras (diárias, semanais na sexta, mensais com dia de entrega e dia da meta). Ao navegar para meses futuros, as tarefas são geradas a partir delas: previsão do mês.
- Entrega em fim de semana: fica no dia; a meta (um dia antes) cobre. *(opção C, mantida)*

## Tarefa pontual do próprio usuário (07/10)

- Qualquer pessoa cria tarefa **pontual para si mesma** na tela do cliente ("+ Tarefa pontual": o que fazer + data).
- Fica com ela como responsável e mostra "criada por". Vai para o registro de atividade.
- Se virar rotina, o Adm cadastra nas Tarefas (cadastro de tarefa continua só do Adm).

## Cartão de detalhe da tarefa (revisado 07/10)

- Clicar no nome da tarefa abre o painel lateral com: recorrência, **data meta e entrega prevista editáveis**, responsáveis (e quem concluiu, a que horas e em quanto tempo), **checklist** e observações.
- **Datas:** só analista, supervisor, gestor e Adm alteram. Altera só aquela ocorrência e fica no histórico de atividade. Meta não pode passar da entrega.
- **Checklist:** quem pode concluir a tarefa também marca itens e **adiciona itens novos**. A tarefa só conclui com todos marcados.
- Sem histórico dentro do cartão (o histórico fica na aba Histórico).

## Hierarquia nas tarefas (revisado 07/10)

- **Responsáveis = quem pode trabalhar naquela tarefa.** Duas pessoas no mesmo cartão não precisam as duas concluir: **uma conclusão fecha a tarefa**.
- **Quem conclui:** os responsáveis + qualquer analista, supervisor, gestor ou Adm.
- **Estagiária:** só conclui (e marca checklist) nas tarefas em que é responsável. Ex.: não conclui "Conferir agendamentos" (Bruna + Paulo).
- Quando alguém conclui a tarefa de outro, o histórico mostra "(responsável: Ana)".
- **Transferir responsável:** Adm, Carlos, Paulo e Bruna. Fica no histórico de atividade.

## Home · análise do fluxo de entrega (07/10)

- **Entregas por dia:** barra cinza = previstas, verde = concluídas, rótulo "concluídas/previstas". Se o período for 1 dia, mostra os 10 dias úteis até ele.
- **Tempo médio por tarefa · período × média histórica:** barra = média no período, traço = média dos 90 dias anteriores; etiqueta "na média", "▲ x% mais lento" ou "▼ x% mais rápido". Mostra as 8 tarefas que mais consomem tempo.
- Tudo calculado dos tempos registrados na conclusão de cada tarefa. Respeita filtros (só as minhas, tipo) e clientes vinculados.
- Período personalizado: datas "de" e "até".

## Tarefa diária no cartão (07/10)

- Diária **não tem** data meta nem data prevista. O cartão mostra só a recorrência e o dia; nada de data ou recorrência é editável ali.

## Senhas e acessos do cliente (07/10)

- Botão **"Senhas e acessos"** dentro da tela do cliente abre o painel lateral com os acessos daquele cliente: bancos, plataformas, e-mails, governo.
- Cada acesso: tipo, sistema, **Abrir ↗** (link), usuário com **Copiar**, senha mascarada com **Mostrar** e **Copiar**, observações de acesso (token com quem, horário, certificado).
- Busca e filtro por tipo. **+ Novo acesso**: qualquer pessoa cadastra.
- Consulta livre, mas **tudo fica no histórico de atividade**: visualizou, copiou usuário, copiou senha, abriu o link, cadastrou.
- Alterar ou excluir: só o Adm. Os demais têm "Solicitar alteração ao Adm" (registrado).
- No banco real: senha cifrada, nunca em texto puro nem no log.

## Calendário da operação (07/10)

- Todos os clientes vinculados. Modos **Mês** e **Semana**; navega com ‹ › e Hoje.
- Filtros: cliente, responsável, tipo.
- Mês: diárias somadas por dia ("17/25 diárias"); a mesma tarefa em vários clientes vira uma linha ("Revisar DRE · 3 clientes"); até 4 linhas por dia + "+N".
- Semana: cada dia separado por cliente, com as diárias somadas e as demais pelo nome.
- Clicar numa tarefa abre o cartão. Para concluir, o cartão leva para dentro do cliente ("Entrar em Alfa para executar").

## Cadastro de clientes (07/10)

- Lista com busca (nome, razão social, CNPJ) e filtro por situação: Ativos, Implantação, Bloqueados, Encerrados.
- Ficha (painel lateral): dados da empresa (código, fantasia, razão social, CNPJ, situação, prioridade, segmento, tributação), contrato (honorário, plano, início, sistema financeiro), **sócios**, **contatos**, comunicação (**grupo principal** do WhatsApp, e-mail financeiro), **equipe Effective atrelada**, endereço e particularidades.
- **Só Adm altera:** razão social, CNPJ, honorário, plano e sócios. Para os demais esses campos ficam travados com a marca "SÓ ADM".
- Cliente novo: qualquer pessoa cadastra, preenchendo tudo (inclusive os campos sensíveis). Depois de salvo, os sensíveis só o Adm altera.
- **Encerrar cliente:** só o Adm (aviso vermelho). Os demais têm "Pedir encerramento ao Adm". Cliente encerrado sai de Tarefas, Home e Calendário; cadastro e histórico ficam.
- Equipe atrelada = quem vê o cliente na aba Tarefas.
- Toda alteração vai para o Histórico, campo a campo ("alterou o cadastro · grupo principal: X → Y").

## Datas sempre com ano (07/10)

- Toda data aparece como dd/mm/aaaa (sistema de longo prazo). Exceção: o eixo do gráfico de entregas usa dd/mm para caber; o balão mostra a data completa.

## Cadastro de senhas e acessos (07/10)

- Visão de **todos os clientes** num lugar: cliente, acesso (tipo, sistema, link, observações), usuário, senha, **última troca** (data e dias).
- Filtros: cliente, tipo, busca, e **"sem troca há mais de 180 dias"** (destacado em âmbar).
- Mesmas ações do painel do cliente: abrir link, copiar usuário, mostrar/copiar senha; + Novo acesso (todos). Alterar e excluir: só Adm; os demais "solicitar alteração".
- Quadro **"Consultas recentes"**: quem viu, copiou ou abriu, quando e de qual cliente.

## Cadastro de tarefas · rotinas (07/10)

- Uma **rotina** = cliente + tarefa + recorrência + responsáveis + checklist padrão + vigência (de / até) + ativa/pausada.
- Recorrência: **Diária** (seg a sex) · **Semanal** (dia da semana) · **Quinzenal** (a cada 15 dias desde a data de início; sábado/domingo passa para a segunda) · **Mensal** (dia da entrega + dia da meta opcional; mês menor usa o último dia).
- As tarefas do dia a dia, o calendário e a previsão dos meses futuros saem **das rotinas**. O checklist de cada tarefa nasce do checklist padrão da rotina.
- **Só o Adm** cria, altera, pausa e exclui. Os demais consultam tudo e têm "Pedir rotina nova / Pedir alteração ao Adm" (registrado).
- Rotina nova pode ser aplicada a **vários clientes de uma vez** (vira uma rotina por cliente).
- **Mudança de responsável e checklist vale já (24/10):** as abertas de hoje e as atrasadas recebem os novos responsáveis e o novo checklist; itens já marcados ficam, itens não marcados que saíram da lista somem. Dia e frequência valem a partir de amanhã (as futuras ainda não concluídas são refeitas). As concluídas não mudam.
- Excluir: aviso vermelho; para de gerar a partir de amanhã; o histórico fica.
- Toda criação e alteração vai para o Histórico, com o que mudou ("recorrência: toda sexta → toda quinta").
- *Fora por enquanto:* anual.

## Cadastro de colaboradores (07/10)

- Lista: colaborador (e-mail de login), **papel**, clientes vinculados, quantas rotinas é responsável, **horas no mês × carga horária** (barra), ativo/inativo.
- **O papel define as permissões** (não o nome da pessoa). Trocar o papel troca o que ela pode fazer. Papéis: Estagiária · Analista financeira · Supervisor · Gestor financeiro · Administrador.
- Quadro "O que cada papel pode fazer" (matriz sim / não / pede ao Adm) na própria tela.
- **Só o Adm** cadastra, troca papel, muda vínculos, carga e inativa. Os demais consultam e pedem ao Adm.
- **Inativar:** a pessoa deixa de entrar; o histórico fica. O aviso lista as rotinas em que ela é a única responsável (transferir antes).
- Gestor financeiro e Administrador já veem todos os clientes (vínculo não se aplica).
- Toda mudança vai para o Histórico ("Adm alterou Ana · papel: Estagiária → Analista financeira").

## Permissões editáveis pelo Adm (07/10)

- A matriz "O que cada papel pode fazer" vira **editável para o Adm**: cada célula é uma escolha (sim / não / pede ao Adm; ou todas / mensais e pontuais). Muda na hora o que as pessoas daquele papel podem fazer.
- No banco: tabela `permissoes_papel` (papel × ação × valor). O app e a RLS leem dela.
- Administrador é fixo (tudo "sim"), para ninguém se trancar do lado de fora.
- Cada mudança vai para o Histórico ("Adm alterou permissão · Estagiária · Concluir tarefa de outra pessoa: não → sim").
- Ações cobertas: ver todos os clientes, tarefas que vê, concluir tarefa de outra pessoa, transferir responsável, alterar datas, ver registros de todos, cadastrar senha, alterar/excluir senha, cadastrar cliente, dados sensíveis/encerrar cliente, rotinas, colaboradores.

## Senha de acesso do colaborador (07/10)

- O Adm **redefine** a senha de acesso de qualquer colaborador (digita ou gera uma de 12 caracteres e copia para passar à pessoa). Mínimo 8 caracteres.
- **Ver a senha atual não é possível, nem para o Adm:** o login (Supabase Auth) guarda a senha cifrada sem volta. Por isso a função é "redefinir", não "ver". A ficha mostra quando e por quem foi a última redefinição.
- Cliente novo de colaborador exige senha inicial.

## Clientes vinculados em lista (07/10)

- Na ficha do colaborador, os clientes vinculados aparecem em lista (nome, código, razão social, × para desvincular) com "+ vincular cliente…".

## Tema claro / escuro (07/10)

- Botões Claro · Escuro · Auto no rodapé da barra lateral. Auto segue o sistema operacional. A escolha fica salva no navegador da pessoa.

## Leitura confortável (07/10)

- Texto maior por padrão (115%) e controle **A A A A** no rodapé da barra lateral: 100% · 115% · 130% · 145%. Tudo cresce junto (texto, botões, tabelas). Escolha salva no navegador.
- Contraste maior nos textos secundários e cinzas, no claro e no escuro.

## Seções da Central e prévias (24/10/2026)
- Menu por seção: **Início**, **Comercial** (Carteira, Preços e contratos, Vendas), **Onboarding**, **Operação** (Painel do dia, Tarefas, Calendário, Solicitações, Histórico, Cadastros) e **Configurações** (Colaboradores, Perfis).
- Início, Comercial, Onboarding e Perfis são **prévias**: só leitura, nada grava. O que já existe no banco aparece de verdade (marcado "dado real"); o resto fica marcado "ilustrativo".
- Carteira: quadrante honorário × horas do cronômetro (média mensal dos últimos 90 dias); sem dados suficientes mostra clientes de exemplo.
- Onboarding: 7 etapas da largada à chegada; hoje o banco só confirma cadastro, acessos e rotinas.
- Gráficos do Painel do dia: com período de um dia só (ex.: "Hoje"), os três gráficos usam os 10 dias úteis até o dia, para nunca ficarem vazios.

## Informações, Datas e Contatos (24/10/2026)
- Três abas em Cadastros, mesma tabela `central_notas_cliente` (tipo `info`, `data`, `contato`). Cliente vazio = geral da Effective (todos veem).
- Quem atende o cliente lê, cria e edita; excluir só esconde e fica no histórico (`central_salvar_nota`, `central_excluir_nota`).
- Datas: obrigatório informar o dia; "repete todo mês" mostra a próxima ocorrência. Lista em ordem do que vem primeiro; hoje/amanhã em vermelho, próximos 7 dias em laranja.
- Contatos: telefone abre o WhatsApp; e-mail abre o programa de e-mail; os dois têm botão copiar.

## Institucional, fotos e logos (24/10/2026)
- Seção **Institucional** (sem marca de prévia): quem é quem por nível com foto, ciclo do cliente, clientes com logo e quem atende, o que fazemos por assunto (rotinas ativas reais), parceiros.
- Fotos da equipe, logos dos clientes e os textos do Institucional são da instalação: ficam no banco (`central_imagens`, `central_conteudo`), nunca no código público. Só quem está logado lê; o app não grava ali. A carga é feita por script privado da instalação.
- Comercial ficou com Carteira e Preços e contratos (Vendas saiu por enquanto). Preços usa os planos do cadastro, o valor-hora médio da carteira e as datas de contrato para as renovações; honorário só aparece para quem tem a permissão de dados sensíveis.
- Onboarding: trilha de exemplo + tabela dos clientes atuais com andamento, acessos, rotinas e o que falta.

## Onboarding em 3 abas (24/10/2026, prévia)
- **Novo onboarding**: formulário de entrada (dados, contrato, contato, sistemas e equipe) e, ao lado, o que vai ser criado com as datas contadas da entrada. Ainda não grava.
- **Status geral**: trilha de exemplo e tabela dos clientes atuais.
- **Checklist padrão**: 6 fases, 26 itens com quem faz e prazo (D+n). Melhorias incluídas: grupo do cliente pela Conta Azul, conta PJ Conta Azul (só se o cliente não tiver), usuário da Effective no Conta Azul, Conta Azul configurado, conferidor de agendamentos, agente de IA com a memória do cliente, avisos por e-mail. Edição do checklist entra quando o onboarding tiver tabela.

## Institucional = mapa original da empresa (24/10/2026)
- A tela Institucional mostra o mapa da empresa no formato original (planta, hierarquia, fluxos, tarefas por tipo), dentro da Central.
- O HTML do mapa fica no banco (`central_conteudo`, chave `mapa_html`), não no código público; a página `app/mapa.html` só abre dentro da Central e só para quem está logado.
- `app/mapa.html` tem cabeçalho de segurança próprio (vercel.json): permite os scripts do mapa e ser exibida dentro da Central; o resto do app segue com a regra rígida.
- O tema do mapa acompanha o da Central (troca o tema → o mapa recarrega).

## Anexos nos cartões de Senhas e Cadastros (27/10/2026)
- Todo cartão de **Senhas** (acesso) e de **Informações, Datas e Contatos** (nota) aceita anexos: imagem (JPG, PNG, WebP, GIF) ou PDF, com uma categoria opcional (Senha, Print da tela, Documento, Comprovante, Cartão / token, Outro). Serve para guardar uma senha avulsa, o print de um token, o cartão de um contato.
- Até 2,5 MB por arquivo e 10 por cartão. Foto acima de 1,2 MB é reduzida na tela (JPEG, até 2000 px) antes de subir. Dá para colar um print com Ctrl+V com a gaveta aberta.
- O arquivo fica **cifrado** no banco (mesma chave das senhas) e só sai por `central_abrir_anexo`; a lista que o app lê não traz o arquivo. Abrir anexo de senha fica no histórico, como mostrar a senha.
- Quem pode: anexar em senha = quem cadastra ou altera senha; tirar anexo de senha = quem altera senha; nas notas, quem vê o cliente (nota geral: todos). Tirar só esconde: fica no histórico.
- Cartão novo: os arquivos esperam e sobem junto com o salvar. No quadro, o cartão mostra 📎 com a quantidade; em Senhas, clicar no 📎 abre o cartão.

## Anexos: 5 MB e Solicitações (27/10/2026)
- Limite por arquivo sobe para **5 MB** (continua 10 por cartão; foto acima de 1,2 MB segue reduzida na tela).
- **Solicitações** aceitam anexos (imagem ou PDF), na abertura (sobem junto com o abrir) e na gaveta da solicitação. Quem vê a solicitação (cliente que atende, responsável ou quem abriu; interna: todos) vê, anexa e tira.
- Anexar ou tirar entra no andamento da conversa ("📎 anexou …"). A lista mostra 📎 com a quantidade.

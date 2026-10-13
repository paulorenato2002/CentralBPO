# Segurança

## O que este repositório contém

Só o **modelo** da Central BPO: telas, regras de negócio, backend (migrations) e testes. Todos os nomes de clientes, pessoas, valores e acessos são **fictícios**.

Nenhum dado real, senha, chave de API ou endereço de banco de produção é versionado aqui. Cada instalação (cliente) mantém os próprios dados num repositório **privado** à parte.

## Como a Central protege os dados

| Camada | Proteção |
|---|---|
| Login | Supabase Auth; cada pessoa entra com o próprio usuário. Cadastro público desligado: só o administrador cria contas |
| Permissões | Papel de cada pessoa + matriz de permissões editável pelo administrador; ações sensíveis viram pedido ao administrador |
| Banco | RLS em todas as tabelas `central_*`. O app **lê** pelas views e **grava só pelas funções**, que conferem a regra antes de gravar. Nenhuma gravação direta nas tabelas |
| Tempo | Calculado no servidor (relógio do banco); o navegador não consegue alterar |
| Senhas de clientes | Cifradas com pgcrypto; a chave fica no Supabase Vault e nunca sai do banco. Toda visualização ou cópia fica registrada |
| Histórico | Só aceita inclusão: ninguém edita nem apaga |
| Chaves | A `service_role` fica só no servidor (variável de ambiente da Vercel), nunca no navegador nem no repositório. O build recusa publicar se a chave pública informada for a `service_role` |
| Função de servidor | `api/admin.js` (criar login e redefinir senha) só atende quem manda o token de uma sessão de **administrador ativo**; o resto recebe 401/403. As gravações na Central rodam como o próprio Adm, então ficam no histórico com o nome dele |
| Navegador | CSP sem script de fora (`script-src 'self'`), sem iframe (`frame-ancestors 'none'`), HSTS; todo texto vindo do banco passa por escape; links de acesso só abrem se forem `http(s)` |

## Checklist de instalação

1. Criar o segredo `central_acessos_chave` no Vault com **32 caracteres aleatórios ou mais**, e **guardar uma cópia fora do Supabase**: sem ela, as senhas cadastradas não abrem.
2. Desligar o cadastro público (Authentication → Sign In / Providers → "Allow new users to sign up").
3. Ligar a proteção contra senhas vazadas (Authentication → Attack Protection), se o plano permitir.
4. Variáveis de ambiente só na Vercel ou num `.env` local (veja `.env.example`); nunca commitar `.env`.
5. Rodar `npm run test:db` antes de aplicar qualquer migration.
6. Rodar o Supabase Advisor de segurança depois de aplicar (`supabase db advisors --type security`).
7. Quando alguém sair da equipe: inativar na Central **e** bloquear o login no Supabase Auth no mesmo dia.

## Como reportar uma vulnerabilidade

Não abra issue pública. Fale direto com o mantenedor, Paulo Renato Nunes de Melo, pelo GitHub [@paulorenato2002](https://github.com/paulorenato2002).

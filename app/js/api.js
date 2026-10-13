// Conexão com o Supabase e tradução dos erros do banco.
// Regra do backend: o app LÊ pelas tabelas/views (com RLS) e GRAVA só pelas funções central_*.
const cfg = window.CENTRAL_CONFIG || {};
if (!cfg.url || !cfg.anonKey) {
  document.body.innerHTML = '<p style="padding:40px;font-family:system-ui">Configuração ausente (config.js). Avise o administrador.</p>';
  throw new Error("config.js ausente");
}

// Guardado antes de criar o cliente: o link do e-mail de "esqueci minha senha" chega com #...type=recovery
// e o Supabase limpa o endereço ao ler a sessão.
export const retornoDoLink = new URLSearchParams(location.hash.replace(/^#/, ""));

export const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "central-bpo-sessao" }
});

const MENSAGENS = {
  SEM_ACESSO: "Seu usuário não tem acesso ativo à Central. Fale com o administrador.",
  SEM_ACESSO_CLIENTE: "Você não atende este cliente.",
  DIA_FECHADO: "O registro de hoje já foi fechado (22h). Amanhã o cronômetro volta do zero.",
  OUTRO_CLIENTE_RODANDO: "Você está com outro cliente rodando. Pause ou finalize antes de entrar em outro.",
  SESSAO_INVALIDA: "O cronômetro não foi encontrado. Recarregue a página.",
  SESSAO_NAO_RODANDO: "O cronômetro deste cliente não está rodando.",
  JA_FINALIZADA: "Este cliente já foi finalizado hoje.",
  TAREFA_INVALIDA: "Tarefa não encontrada.",
  JA_CONCLUIDA: "Esta tarefa já foi concluída.",
  SEM_PERMISSAO: "Você não tem permissão para isso.",
  CHECKLIST_INCOMPLETO: "Marque todos os itens do checklist antes de concluir.",
  ENTRE_NO_CLIENTE: "Entre no cliente (com o cronômetro rodando) para concluir.",
  ITEM_INVALIDO: "Item do checklist não encontrado.",
  DESTINO_INVALIDO: "Essa pessoa não está ativa na Central.",
  ORIGEM_INVALIDA: "Essa pessoa não é responsável por esta tarefa.",
  JA_RESPONSAVEL: "Essa pessoa já é responsável por esta tarefa.",
  DIARIA_SEM_DATAS: "Tarefa diária não tem datas editáveis.",
  PRAZO_OBRIGATORIO: "Informe a data de entrega.",
  META_DEPOIS_DA_ENTREGA: "A meta não pode ser depois da entrega.",
  DADOS_INCOMPLETOS: "Preencha os campos obrigatórios.",
  ACESSO_INVALIDO: "Acesso não encontrado.",
  CHAVE_AUSENTE: "O cofre de senhas não está configurado. Avise o administrador.",
  MOTIVO_INVALIDO: "Ação inválida.",
  ACAO_INVALIDA: "Ação inválida.",
  CNPJ_INVALIDO: "O CNPJ precisa ter 14 números.",
  USE_ENCERRAR_CLIENTE: "Para encerrar, use o botão Encerrar cliente.",
  ROTINA_INVALIDA: "Rotina não encontrada.",
  ROTINA_JA_EXISTE: "Este cliente já tem uma rotina ativa com esse nome.",
  FREQUENCIA_INVALIDA: "Tipo de recorrência inválido.",
  NOME_OBRIGATORIO: "Dê um nome à tarefa.",
  RESPONSAVEL_OBRIGATORIO: "Escolha pelo menos um responsável.",
  INICIO_OBRIGATORIO: "Informe a partir de quando vale.",
  VIGENCIA_INVALIDA: "A data final é antes da inicial.",
  DIA_SEMANA_INVALIDO: "Escolha um dia da semana de segunda a sexta.",
  DIA_MES_INVALIDO: "Dia do mês inválido (1 a 31).",
  MES_INVALIDO: "Mês inválido.",
  PERFIL_INEXISTENTE: "Pessoa não encontrada.",
  ADM_NAO_SE_REBAIXA: "Você não pode tirar o seu próprio acesso de administrador.",
  PAPEL_FIXO: "As permissões do administrador são fixas.",
  VALOR_INVALIDO: "Valor inválido para essa permissão.",
  SOLICITACAO_INVALIDA: "Esse pedido já foi decidido.",
  EMAIL_EXISTE: "Já existe um login com esse e-mail.",
  LOGIN_RECUSADO: "O Supabase recusou criar o login. Confira o e-mail.",
  SENHA_RECUSADA: "O Supabase recusou a senha. Use pelo menos 8 caracteres.",
  PERFIL_RECUSADO: "Não deu para criar o perfil. Nada foi gravado.",
  COLABORADOR_RECUSADO: "Não deu para cadastrar o colaborador. Nada foi gravado.",
  DADOS_INVALIDOS: "Confira os dados preenchidos.",
  CONFIG_AUSENTE: "O servidor não está configurado para isso. Avise o administrador."
};

export class ErroCentral extends Error {
  constructor(codigo, mensagem) { super(mensagem); this.codigo = codigo; }
}

export function traduzir(e) {
  const msg = (e && e.message) || String(e);
  const m = msg.match(/^([A-Z][A-Z_]{3,})\b/);
  const codigo = m ? m[1] : null;
  if (codigo && MENSAGENS[codigo]) return new ErroCentral(codigo, MENSAGENS[codigo]);
  if (/jwt|token|expired|not authenticated/i.test(msg)) return new ErroCentral("SESSAO", "Sua sessão expirou. Entre de novo.");
  if (/duplicate key|already exists/i.test(msg)) return new ErroCentral("DUPLICADO", "Já existe um cadastro com esse código ou CNPJ.");
  if (/permission denied/i.test(msg)) return new ErroCentral("SEM_PERMISSAO", MENSAGENS.SEM_PERMISSAO);
  if (/fetch|network|failed to/i.test(msg)) return new ErroCentral("REDE", "Sem conexão com o servidor. Confira a internet e tente de novo.");
  return new ErroCentral(codigo, "Não deu certo: " + msg);
}

export async function rpc(nome, args = {}) {
  const { data, error } = await sb.rpc(nome, args);
  if (error) throw traduzir(error);
  return data;
}

export async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw traduzir(error);
  return data;
}

// O Supabase devolve no máximo 1.000 linhas por consulta: busca em páginas até acabar.
// montar() precisa criar a consulta de novo a cada página (com ordem fixa).
export async function todas(montar, pagina = 1000) {
  const tudo = [];
  for (let de = 0; ; de += pagina) {
    const parte = await q(montar().range(de, de + pagina - 1));
    tudo.push(...parte);
    if (parte.length < pagina) return tudo;
  }
}

// Ações que precisam da chave de serviço (criar login, redefinir senha): vão para a função de servidor /api/admin,
// que confere se quem chama é Adm. O navegador só manda o token da própria sessão.
export async function apiAdmin(acao, dados) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new ErroCentral("SESSAO", "Sua sessão expirou. Entre de novo.");
  let r;
  try {
    r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ acao, ...dados }) });
  } catch { throw new ErroCentral("REDE", "Sem conexão com o servidor. Confira a internet e tente de novo."); }
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) { const c = corpo.erro || "ERRO"; throw new ErroCentral(c, MENSAGENS[c] || "Não deu certo (" + r.status + ")."); }
  return corpo;
}

// Estado da sessão no navegador. Nada aqui é fonte da verdade: o banco é.
export const E = {
  eu: null,            // { id, nome, email, papel }
  perm: {},            // matriz do papel: { acao: 's' | 'n' | 'p' | 'todas' | 'mensais_pontuais' }
  equipe: new Map(),   // usuario_id → { nome, papel, ativo }
  clientes: [],        // [{ id, codigo, nome, razao, situacao, prioridade }]
  hoje: "",
  view: "clientes",
  aberta: null,        // empresa_id da tela do cliente
  // cronômetro: sessão rodando agora (só uma por pessoa)
  rodando: null,       // { id, empresa_id, base, checkpoint, em }  (base = segundos ativos quando lemos, em = Date.now() da leitura)
  sessoesHoje: new Map(), // empresa_id → { estado, tempo, finalizada_em }
  diaFechado: false,
  imgs: new Map()      // chave → data URI (fotos e logos)
};

export const pode = (acao) => E.eu && (E.eu.papel === "administrador" || E.perm[acao] === "s");
export const nomeDe = (id) => (E.equipe.get(id) || {}).nome || "—";
export const papelDe = (id) => (E.equipe.get(id) || {}).papel || "";
export const cliente = (id) => E.clientes.find((c) => c.id === id) || { nome: "?", codigo: "", razao: "" };
export function segundosRodando() {
  if (!E.rodando) return 0;
  return E.rodando.base + (Date.now() - E.rodando.em) / 1000;
}

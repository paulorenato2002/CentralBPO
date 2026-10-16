// Função de servidor (Vercel): upload de anexo em duas etapas.
//   { acao: "preparar", nome, tamanho }                -> URL assinada para enviar DIRETO ao Storage
//   { acao: "confirmar", arquivo_id, nome, mime? }     -> confere o que chegou e registra o dono
// A lógica está em _anexos.js; aqui só entram login, chave de serviço e despacho.
import { autenticar, clienteDeServico } from "./_sessao.js";
import { prepararUpload, confirmarUpload } from "./_anexos.js";
import { responder, lerCorpo } from "./_http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return responder(res, 405, { erro: "método não suportado" });

  const sessao = await autenticar(req);
  if (sessao.erro) return responder(res, sessao.erro.status, { erro: sessao.erro.mensagem });

  // O Storage e a tabela de anexos só aceitam o backend: a chave de serviço entra só aqui,
  // depois do login validado, e o caminho do arquivo é sempre derivado do usuário logado.
  const admin = clienteDeServico();
  if (!admin) return responder(res, 500, { erro: "Anexos indisponíveis: falta a chave de serviço do Supabase no servidor." });

  let corpo;
  try {
    corpo = await lerCorpo(req);
  } catch {
    return responder(res, 400, { erro: "corpo inválido" });
  }

  try {
    const r =
      corpo.acao === "preparar" ? await prepararUpload(admin, sessao.usuarioId, corpo)
      : corpo.acao === "confirmar" ? await confirmarUpload(admin, sessao.usuarioId, corpo)
      : { ok: false, status: 400, erro: "ação inválida" };
    return r.ok ? responder(res, 200, r.corpo) : responder(res, r.status, { erro: r.erro });
  } catch (e) {
    console.error("agente/anexo", e);
    return responder(res, 500, { erro: String(e.message || e).slice(0, 300) });
  }
}

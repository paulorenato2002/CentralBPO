// Função de servidor (Vercel) para o que precisa da chave de serviço do Supabase:
//   criar o login de um colaborador novo e redefinir a senha de acesso de alguém.
// Quem chama precisa estar logado e ser administrador ativo da Central.
// A chave de serviço fica só na variável de ambiente SUPABASE_SERVICE_ROLE_KEY (nunca no navegador, nunca no git).
import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAPEIS = ["estagiaria", "analista", "supervisor", "gestor_financeiro", "administrador"];
// perfis_usuarios (tabela do Agente) não tem "gestor_financeiro": o papel da Central fica em central_colaboradores
const PAPEL_PERFIL = { estagiaria: "estagiaria", analista: "analista", supervisor: "supervisor", gestor_financeiro: "analista", administrador: "administrador" };

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let txt = "";
  for await (const parte of req) { txt += parte; if (txt.length > 10000) throw new Error("corpo grande demais"); }
  return JSON.parse(txt || "{}");
}

const senhaValida = (s) => typeof s === "string" && s.length >= 8 && s.length <= 72;

export default async function handler(req, res) {
  if (req.method !== "POST") return responder(res, 405, { erro: "METODO_INVALIDO" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !servico) return responder(res, 500, { erro: "CONFIG_AUSENTE" });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return responder(res, 401, { erro: "SESSAO" });
  const sem = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
  const mestre = createClient(url, servico, { auth: sem });

  // quem está chamando?
  const { data: quem, error: erroQuem } = await mestre.auth.getUser(token);
  if (erroQuem || !quem || !quem.user) return responder(res, 401, { erro: "SESSAO" });
  const { data: eu } = await mestre.from("central_colaboradores").select("papel_central, ativo").eq("usuario_id", quem.user.id).maybeSingle();
  if (!eu || !eu.ativo || eu.papel_central !== "administrador") return responder(res, 403, { erro: "SEM_PERMISSAO" });
  // as funções da Central rodam como o próprio Adm (o histórico registra o nome dele e as regras do banco valem)
  const comoAdm = createClient(url, anon, { auth: sem, global: { headers: { Authorization: `Bearer ${token}` } } });

  let corpo;
  try { corpo = await lerCorpo(req); } catch { return responder(res, 400, { erro: "DADOS_INVALIDOS" }); }

  if (corpo.acao === "redefinir_senha") {
    if (!UUID.test(String(corpo.usuario_id || "")) || !senhaValida(corpo.senha)) return responder(res, 400, { erro: "DADOS_INVALIDOS" });
    const { data: alvo } = await mestre.from("central_colaboradores").select("usuario_id").eq("usuario_id", corpo.usuario_id).maybeSingle();
    if (!alvo) return responder(res, 404, { erro: "PERFIL_INEXISTENTE" });
    const { error } = await mestre.auth.admin.updateUserById(corpo.usuario_id, { password: corpo.senha });
    if (error) return responder(res, 400, { erro: "SENHA_RECUSADA" });
    await comoAdm.rpc("central_registrar_redefinicao", { p_usuario: corpo.usuario_id });
    return responder(res, 200, { status: "ok" });
  }

  if (corpo.acao === "criar_colaborador") {
    const nome = String(corpo.nome || "").trim(), email = String(corpo.email || "").trim().toLowerCase();
    const papel = String(corpo.papel || ""), carga = Number(corpo.carga || 0);
    const clientes = Array.isArray(corpo.clientes) ? corpo.clientes.map(String) : [];
    if (!nome || nome.length > 120 || !EMAIL.test(email) || !senhaValida(corpo.senha) || !PAPEIS.includes(papel) ||
        !Number.isInteger(carga) || carga < 0 || carga > 260 || clientes.some((c) => !UUID.test(c))) {
      return responder(res, 400, { erro: "DADOS_INVALIDOS" });
    }
    const { data: criado, error: erroCriar } = await mestre.auth.admin.createUser({ email, password: corpo.senha, email_confirm: true });
    if (erroCriar || !criado || !criado.user) return responder(res, 409, { erro: /registered|exists/i.test(erroCriar && erroCriar.message || "") ? "EMAIL_EXISTE" : "LOGIN_RECUSADO" });
    const uid = criado.user.id;
    const desfazer = async () => { await mestre.from("perfis_usuarios").delete().eq("usuario_id", uid); await mestre.auth.admin.deleteUser(uid); };
    const { error: erroPerfil } = await mestre.from("perfis_usuarios").insert({ usuario_id: uid, nome, email, papel: PAPEL_PERFIL[papel], created_by: quem.user.id });
    if (erroPerfil) { await desfazer(); return responder(res, 500, { erro: "PERFIL_RECUSADO" }); }
    const { error: erroColab } = await comoAdm.rpc("central_salvar_colaborador",
      { p_usuario: uid, p_papel: papel, p_carga: carga, p_ativo: true, p_clientes: clientes.length ? clientes : null });
    if (erroColab) { await desfazer(); return responder(res, 400, { erro: (erroColab.message || "").match(/^[A-Z_]{4,}/)?.[0] || "COLABORADOR_RECUSADO" }); }
    await comoAdm.rpc("central_registrar_redefinicao", { p_usuario: uid });
    return responder(res, 200, { status: "ok", usuario_id: uid });
  }

  return responder(res, 400, { erro: "ACAO_INVALIDA" });
}

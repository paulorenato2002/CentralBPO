// Quem está falando. Valida o token da Central e entrega o cliente do Supabase
// que fala COM ESSE TOKEN: a RLS trata o agente como trata a pessoa.
//
// O cliente de SERVIÇO é outra coisa e só sai daqui por clienteDeServico(), para
// quem realmente precisa dele (tabelas fechadas para quem está logado).
import { createClient } from "@supabase/supabase-js";

// Lê o "iss" do token sem validar nada: serve só para explicar o erro, nunca para liberar acesso.
function emissorDiferente(token, urlServidor) {
  try {
    const carga = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!carga.iss) return false;
    return new URL(carga.iss).host !== new URL(urlServidor).host;
  } catch {
    return false;
  }
}

/** { sb, usuarioId, perfil } quando a sessão é boa; { erro: { status, mensagem } } quando não é. */
export async function autenticar(req, { env = process.env, criarCliente = createClient } = {}) {
  const autorizacao = req.headers?.authorization || "";
  if (!autorizacao.startsWith("Bearer ")) return { erro: { status: 401, mensagem: "sem sessão" } };

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const sb = criarCliente(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: autorizacao } },
  });

  const { data: auth, error } = await sb.auth.getUser();
  if (error || !auth?.user) {
    // Um token bom contra o Supabase errado também cai aqui, e o "sessão inválida" seco
    // manda a pessoa relogar à toa. Então diz qual é o caso.
    if (emissorDiferente(autorizacao.slice(7), url)) {
      return { erro: { status: 500, mensagem: "o servidor está apontado para outro Supabase (confira NEXT_PUBLIC_SUPABASE_URL e reinicie)" } };
    }
    return { erro: { status: 401, mensagem: "sessão inválida" } };
  }

  const { data: perfil } = await sb
    .from("perfis_usuarios")
    .select("nome, papel, ativo")
    .eq("usuario_id", auth.user.id)
    .maybeSingle();
  if (perfil && perfil.ativo === false) return { erro: { status: 403, mensagem: "usuário inativo na Central" } };

  return { sb, usuarioId: auth.user.id, perfil: perfil ?? null };
}

/** Cliente de serviço, ou null se o servidor não tem a chave. Nunca vai para o navegador. */
export function clienteDeServico({ env = process.env, criarCliente = createClient } = {}) {
  const chave = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) return null;
  return criarCliente(env.NEXT_PUBLIC_SUPABASE_URL, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Função de servidor (Vercel) do agente: recebe a mensagem do painel, conversa com
// o modelo e devolve a resposta. A chave da OpenAI fica só aqui, nunca no navegador.
//
// REGRA DE ACESSO: tudo que o agente lê ou grava passa pelo token de quem está
// logado na Central, então a RLS vale igual para ele e para a pessoa. A chave de
// serviço NÃO é usada aqui de propósito — se fosse, o agente veria o que a pessoa
// não vê, e as views central_vw_* devolveriam vazio (elas dependem de auth.uid()).
import { createClient } from "@supabase/supabase-js";
import { FERRAMENTAS, executar } from "./_ferramentas.js";
import { criarPortasEmail } from "./_email_portas.js";

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const CHAVE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CHAVE_OPENAI = process.env.OPENAI_API_KEY;
const CHAVE_SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MODELO = process.env.OPENAI_MODEL || "gpt-5.5";

const MAX_VOLTAS = 6;                          // teto de idas ao modelo por mensagem
const MAX_HISTORICO = 20;                      // mensagens anteriores enviadas como memória
const VALIDADE_PENDENTE_MS = 30 * 60 * 1000;   // prévia sem resposta há mais que isso não vale mais

const INSTRUCOES = `Você é o assistente interno do BPO financeiro da Effective, dentro da Central BPO.
Fala com a estagiária, a analista, o supervisor e o gestor — em português do Brasil, direto, sem floreio.

COMO RESPONDER
- Número, nome, prazo e status você NUNCA inventa: lê pelas ferramentas e responde com o que veio.
- Se a ferramenta não trouxer o dado, diga que não encontrou e o que falta para encontrar. Não preencha lacuna com suposição.
- Resposta curta. Lista só quando são itens de verdade. Nada de repetir a pergunta antes de responder.
- Valor em real no formato R$ 1.234,56 e data em dd/mm/aaaa.
- Você enxerga apenas o que a pessoa logada enxerga. Se vier vazio, pode ser falta de acesso ao cliente: diga isso.

ORIENTAR TAREFA
Quando perguntarem como fazer uma tarefa, traga o passo a passo real: o checklist da tarefa, o prazo,
o responsável e as observações já lançadas. Se não houver checklist, diga que a rotina ainda não tem passo a passo registrado.

ANOTAÇÃO DO DIA
O quadro de anotações de cada cliente guarda o que aconteceu de pontual no dia e precisa ser verificado.
- Para anotar: chame registrar_anotacao SEM confirmado, mostre a prévia (cliente, texto exato e para quem vai) e pergunte se pode gravar.
- Só depois que a pessoa responder que sim, chame de novo com confirmado=true. Nunca grave sem prévia aprovada.
- O texto da prévia é o da pessoa: corrija só ortografia e pontuação. Não resuma nem acrescente nada.
- Se não souber de qual cliente é, pergunte. Use listar_clientes para achar o id.
- Marque como verificada (verificar_anotacao) só quando a pessoa pedir.

E-MAIL
Os e-mails saem pela caixa da Effective, com o cabeçalho e a assinatura da casa.
- Para enviar: chame preparar_email (ele NÃO envia). Mostre assunto, Para, Cc, Cco e o texto, e pergunte se pode enviar.
- Só depois que a pessoa responder que sim, numa nova mensagem, chame enviar_email. O servidor recusa o envio se não houve essa resposta.
- Se o modelo tem campos {{assim}}, pergunte à pessoa o valor dos que faltam. Nunca invente valor, nome nem endereço de e-mail: use só os que ela informou ou que estão no modelo.
- Use listar_modelos_email para ver os modelos e salvar_modelo_email para guardar um novo.
- Se o resultado for envio_incerto, diga que o e-mail pode ter saído e peça para conferir a caixa de enviados antes de tentar de novo.
- Anexo ainda não está ligado: se pedirem, diga que entra na próxima entrega.

O QUE VOCÊ NÃO FAZ AINDA
Além da anotação do dia e do e-mail, não altera dados, não anexa arquivo e não arquiva documento — essas funções entram nas próximas entregas.
Se pedirem, diga em uma linha que ainda não está ligado e o que dá para fazer no lugar.`;

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
  for await (const parte of req) {
    txt += parte;
    if (txt.length > 20000) throw new Error("corpo grande demais");
  }
  return JSON.parse(txt || "{}");
}

async function chamarModelo(mensagens) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHAVE_OPENAI}` },
    body: JSON.stringify({ model: MODELO, messages: mensagens, tools: FERRAMENTAS, tool_choice: "auto" }),
  });
  if (!r.ok) throw new Error(`modelo respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const json = await r.json();
  return { mensagem: json.choices?.[0]?.message, uso: json.usage };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return responder(res, 405, { erro: "método não suportado" });
  if (!CHAVE_OPENAI) return responder(res, 500, { erro: "OPENAI_API_KEY não configurada no servidor" });

  const autorizacao = req.headers.authorization || "";
  if (!autorizacao.startsWith("Bearer ")) return responder(res, 401, { erro: "sem sessão" });

  let corpo;
  try {
    corpo = await lerCorpo(req);
  } catch {
    return responder(res, 400, { erro: "corpo inválido" });
  }
  const texto = String(corpo.mensagem || "").trim();
  if (!texto) return responder(res, 400, { erro: "mensagem vazia" });
  if (texto.length > 4000) return responder(res, 400, { erro: "mensagem longa demais" });

  // O mesmo token do navegador: a RLS trata o agente como trata a pessoa.
  const sb = createClient(URL_SUPABASE, CHAVE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: autorizacao } },
  });

  const { data: auth, error: erroAuth } = await sb.auth.getUser();
  if (erroAuth || !auth?.user) {
    // Um token bom contra o Supabase errado também cai aqui, e o "sessão inválida"
    // seco manda a pessoa relogar à toa. Então compara quem emitiu o token com o
    // servidor que estamos usando e diz qual é o caso.
    if (emissorDiferente(autorizacao.slice(7), URL_SUPABASE)) {
      return responder(res, 500, {
        erro: "o servidor está apontado para outro Supabase (confira NEXT_PUBLIC_SUPABASE_URL e reinicie)",
      });
    }
    return responder(res, 401, { erro: "sessão inválida" });
  }
  const usuarioId = auth.user.id;

  const { data: perfil } = await sb
    .from("perfis_usuarios")
    .select("nome, papel, ativo")
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (perfil && perfil.ativo === false) return responder(res, 403, { erro: "usuário inativo na Central" });

  const hoje = new Date().toISOString().slice(0, 10);

  try {
    // 1. conversa: continua a que veio do painel, ou abre uma nova
    let conversaId = corpo.conversa_id || null;
    if (conversaId) {
      const { data } = await sb.from("conversas_agente").select("id").eq("id", conversaId).maybeSingle();
      if (!data) conversaId = null;
    }
    if (!conversaId) {
      const { data, error } = await sb
        .from("conversas_agente")
        .insert({ usuario_id: usuarioId, titulo: texto.slice(0, 60), empresa_id: corpo.empresa_id || null })
        .select("id")
        .single();
      if (error) throw new Error(`não consegui abrir a conversa: ${error.message}`);
      conversaId = data.id;
    }

    // 2. memória: o que já foi dito nesta conversa
    const { data: anteriores } = await sb
      .from("mensagens_agente")
      .select("papel, conteudo, metadados, created_at")
      .eq("conversa_id", conversaId)
      .in("papel", ["usuario", "agente"])
      .order("sequencia", { ascending: false })
      .limit(MAX_HISTORICO);

    // A prévia aguardando resposta é a da ÚLTIMA mensagem do agente, se for recente.
    // Calculada antes do reverse(), que embaralha a ordem.
    const ultimaDoAgente = (anteriores ?? []).find((m) => m.papel === "agente");
    const pendenteVale =
      ultimaDoAgente && Date.now() - new Date(ultimaDoAgente.created_at).getTime() < VALIDADE_PENDENTE_MS;
    // O cliente de SERVIÇO só entra nas portas do e-mail (tabelas fechadas para quem está logado).
    // O resto do agente continua falando com o banco pelo token da pessoa.
    const admin = CHAVE_SERVICO
      ? createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
    const papel = perfil?.papel ?? null;
    const ctx = {
      hoje,
      usuarioId,
      conversaId,
      papel,
      pendente: pendenteVale ? ultimaDoAgente.metadados?.pendente ?? null : null,
      novoPendente: null,
      emailPortas: admin ? criarPortasEmail({ sb, admin, usuarioId, papel }) : null,
    };

    const historico = [...(anteriores ?? [])]
      .reverse()
      .filter((m) => m.conteudo)
      .map((m) => ({ role: m.papel === "usuario" ? "user" : "assistant", content: m.conteudo }));

    // 3. a pergunta é gravada antes de chamar o modelo: falha do modelo não apaga o que a pessoa escreveu
    await sb.from("mensagens_agente").insert({ conversa_id: conversaId, papel: "usuario", conteudo: texto });

    const quem = perfil ? `Quem está falando: ${perfil.nome}, papel ${perfil.papel}.` : "";
    const mensagens = [
      { role: "system", content: `${INSTRUCOES}\n\nHoje é ${hoje}. ${quem}` },
      ...historico,
      { role: "user", content: texto },
    ];

    // 4. o laço: o modelo pede ferramenta, a gente executa, ele responde
    const usou = [];
    let resposta = "";
    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const { mensagem } = await chamarModelo(mensagens);
      if (!mensagem) throw new Error("o modelo não respondeu");
      mensagens.push(mensagem);

      const pedidos = mensagem.tool_calls ?? [];
      if (!pedidos.length) {
        resposta = mensagem.content || "";
        break;
      }
      for (const pedido of pedidos) {
        let args = {};
        try {
          args = JSON.parse(pedido.function.arguments || "{}");
        } catch { /* argumento quebrado vira consulta sem filtro */ }
        const saida = await executar(pedido.function.name, args, sb, ctx);
        usou.push(pedido.function.name);
        mensagens.push({ role: "tool", tool_call_id: pedido.id, content: JSON.stringify(saida).slice(0, 60000) });
      }
    }

    if (!resposta) resposta = "Não consegui fechar a resposta com as consultas que fiz. Refaça a pergunta com o cliente ou o período.";

    await sb.from("mensagens_agente").insert({
      conversa_id: conversaId,
      papel: "agente",
      conteudo: resposta,
      // A prévia que ficou esperando "sim" vai junto, para a próxima mensagem poder confirmá-la.
      metadados: { ferramentas: usou, ...(ctx.novoPendente ? { pendente: ctx.novoPendente } : {}) },
    });
    await sb.from("conversas_agente").update({ ultima_atividade_em: new Date().toISOString() }).eq("id", conversaId);

    return responder(res, 200, { conversa_id: conversaId, resposta, ferramentas: usou });
  } catch (e) {
    console.error("agente/chat", e);
    return responder(res, 500, { erro: String(e.message || e).slice(0, 300) });
  }
}

// Função de servidor (Vercel) do agente: recebe a mensagem do painel, conversa com
// o modelo e devolve a resposta. A chave da OpenAI fica só aqui, nunca no navegador.
//
// REGRA DE ACESSO: tudo que o agente lê do banco passa pelo token de quem está
// logado na Central, então a RLS vale igual para ele e para a pessoa. A chave de
// serviço NÃO é usada aqui de propósito — se fosse, o agente veria o que a pessoa
// não vê, e as views central_vw_* devolveriam vazio (elas dependem de auth.uid()).
import { createClient } from "@supabase/supabase-js";

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const CHAVE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CHAVE_OPENAI = process.env.OPENAI_API_KEY;
const MODELO = process.env.OPENAI_MODEL || "gpt-5.5";

const MAX_VOLTAS = 6;            // teto de idas ao modelo por mensagem
const MAX_HISTORICO = 20;        // mensagens anteriores enviadas como memória
const LIMITE_LINHAS = 200;       // teto de linhas por consulta

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

O QUE VOCÊ NÃO FAZ AINDA
Não altera nem apaga nada no banco, não envia e-mail e não arquiva documento — essas funções entram nas próximas entregas.
Se pedirem, diga em uma linha que ainda não está ligado e o que dá para fazer no lugar.`;

const FERRAMENTAS = [
  {
    type: "function",
    function: {
      name: "listar_clientes",
      description: "Clientes que a pessoa logada atende, com código, nome e situação.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_tarefas",
      description:
        "Tarefas da operação. Filtra por cliente, situação e intervalo de datas de entrega. Use para 'o que está atrasado', 'o que vence hoje', 'o que fulano tem para fazer'.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string", description: "id do cliente (opcional)" },
          status: {
            type: "string",
            description: "pendente, pronta, em_execucao, concluida, bloqueada, cancelada (opcional)",
          },
          de: { type: "string", description: "data inicial da entrega, aaaa-mm-dd (opcional)" },
          ate: { type: "string", description: "data final da entrega, aaaa-mm-dd (opcional)" },
          atrasadas: { type: "boolean", description: "só as com entrega vencida e não concluídas" },
          limite: { type: "integer", description: "máximo de linhas, padrão 50" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detalhar_tarefa",
      description: "Uma tarefa por inteiro: dados, checklist e observações já lançadas. Use antes de orientar a execução.",
      parameters: {
        type: "object",
        properties: { tarefa_id: { type: "string" } },
        required: ["tarefa_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_rotinas",
      description: "Rotinas cadastradas de um cliente, com frequência e responsável.",
      parameters: {
        type: "object",
        properties: { empresa_id: { type: "string" } },
        required: ["empresa_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "anotacoes_do_dia",
      description: "Anotações do dia lançadas no quadro do cliente. Sem empresa_id, traz as de todos os clientes que a pessoa atende.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string" },
          dia: { type: "string", description: "aaaa-mm-dd; padrão é hoje" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "equipe",
      description: "Colaboradores ativos da Central, com papel. Use para saber quem é quem.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

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

// Cada ferramenta roda com o cliente do usuário: a RLS decide o que ele vê.
async function executar(nome, args, sb, hoje) {
  const corta = (n) => Math.min(Math.max(Number(n) || 50, 1), LIMITE_LINHAS);

  if (nome === "listar_clientes") {
    const { data, error } = await sb
      .from("central_clientes")
      .select("id, codigo, nome, situacao")
      .order("codigo");
    return error ? { erro: error.message } : { clientes: data };
  }

  if (nome === "consultar_tarefas") {
    let q = sb.from("central_vw_tarefas").select("*").limit(corta(args.limite));
    if (args.empresa_id) q = q.eq("empresa_id", args.empresa_id);
    if (args.status) q = q.eq("status", args.status);
    if (args.de) q = q.gte("prazo", args.de);
    if (args.ate) q = q.lte("prazo", args.ate);
    if (args.atrasadas) q = q.lt("prazo", hoje).not("status", "in", "(concluida,cancelada)");
    const { data, error } = await q.order("prazo", { ascending: true });
    if (error) return { erro: error.message };
    return { total: data.length, tarefas: data };
  }

  if (nome === "detalhar_tarefa") {
    const [tarefa, checklist, observacoes] = await Promise.all([
      sb.from("central_vw_tarefas").select("*").eq("id", args.tarefa_id).maybeSingle(),
      sb.from("central_tarefa_checklist").select("id, texto, feito, ordem").eq("tarefa_id", args.tarefa_id).order("ordem"),
      sb.from("central_tarefa_observacoes").select("texto, usuario_id, created_at").eq("tarefa_id", args.tarefa_id).order("created_at", { ascending: false }),
    ]);
    if (tarefa.error) return { erro: tarefa.error.message };
    if (!tarefa.data) return { erro: "tarefa não encontrada ou fora do seu acesso" };
    return { tarefa: tarefa.data, checklist: checklist.data ?? [], observacoes: observacoes.data ?? [] };
  }

  if (nome === "consultar_rotinas") {
    const { data, error } = await sb.from("central_vw_rotinas").select("*").eq("empresa_id", args.empresa_id);
    return error ? { erro: error.message } : { rotinas: data };
  }

  if (nome === "anotacoes_do_dia") {
    let q = sb.from("central_anotacoes").select("id, empresa_id, usuario_id, dia, texto, enviada_em").eq("dia", args.dia || hoje);
    if (args.empresa_id) q = q.eq("empresa_id", args.empresa_id);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(LIMITE_LINHAS);
    return error ? { erro: error.message } : { anotacoes: data };
  }

  if (nome === "equipe") {
    // central_vw_equipe entra com a migration da Op. I; até lá, o par de tabelas resolve.
    const vw = await sb.from("central_vw_equipe").select("usuario_id, nome, email, papel, ativo");
    if (!vw.error) return { equipe: vw.data };
    const { data, error } = await sb.from("perfis_usuarios").select("usuario_id, nome, papel, ativo").eq("ativo", true);
    return error ? { erro: error.message } : { equipe: data };
  }

  return { erro: `ferramenta desconhecida: ${nome}` };
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
      .select("papel, conteudo")
      .eq("conversa_id", conversaId)
      .in("papel", ["usuario", "agente"])
      .order("sequencia", { ascending: false })
      .limit(MAX_HISTORICO);

    const historico = (anteriores ?? [])
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
        const saida = await executar(pedido.function.name, args, sb, hoje);
        usou.push(pedido.function.name);
        mensagens.push({ role: "tool", tool_call_id: pedido.id, content: JSON.stringify(saida).slice(0, 60000) });
      }
    }

    if (!resposta) resposta = "Não consegui fechar a resposta com as consultas que fiz. Refaça a pergunta com o cliente ou o período.";

    await sb.from("mensagens_agente").insert({
      conversa_id: conversaId,
      papel: "agente",
      conteudo: resposta,
      metadados: { ferramentas: usou },
    });
    await sb.from("conversas_agente").update({ ultima_atividade_em: new Date().toISOString() }).eq("id", conversaId);

    return responder(res, 200, { conversa_id: conversaId, resposta, ferramentas: usou });
  } catch (e) {
    console.error("agente/chat", e);
    return responder(res, 500, { erro: String(e.message || e).slice(0, 300) });
  }
}

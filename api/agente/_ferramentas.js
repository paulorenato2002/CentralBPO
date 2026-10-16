// Ferramentas do agente. Cada uma roda com o cliente Supabase da PESSOA logada,
// então a RLS vale igual para ela e para o agente.
//
// O "_" no começo do nome faz a Vercel não publicar este arquivo como rota.
//
// ESCRITA: toda ferramenta que grava passa por prévia e confirmação, e a
// confirmação é conferida AQUI, no servidor. O modelo não consegue mostrar a
// prévia e gravar na mesma resposta: a prévia fica guardada na mensagem do
// agente (ctx.pendente) e só vale se a pessoa escreveu depois dela.

import { FERRAMENTAS_EMAIL, NOMES_EMAIL, executarEmail } from "./_ferramentas_email.js";
import { FERRAMENTAS_RELATORIO, gerarRelatorioDia, marcarAnotacoesDoRelatorio } from "./_relatorio.js";
import { FERRAMENTAS_ALTERACOES, alterarDados } from "./_alteracoes.js";

const LIMITE_LINHAS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROS = {
  DESTINO_INVALIDO: "Alguém da lista de destino não está ativo na Central.",
  SEM_ACESSO_CLIENTE: "Você não atende este cliente.",
  ACESSO_INVALIDO: "Anotação não encontrada.",
  DADOS_INCOMPLETOS: "Faltou o cliente ou o texto.",
};

export function traduzirErro(msg = "") {
  const texto = String(msg);
  for (const [codigo, traducao] of Object.entries(ERROS)) if (texto.includes(codigo)) return traducao;
  return texto.slice(0, 200) || "erro desconhecido";
}

const semParametros = { type: "object", properties: {}, additionalProperties: false };

export const FERRAMENTAS = [
  {
    type: "function",
    function: {
      name: "listar_clientes",
      description: "Clientes que a pessoa logada atende, com código, nome e situação.",
      parameters: semParametros,
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
          status: { type: "string", description: "pendente, pronta, em_execucao, concluida, bloqueada, cancelada (opcional)" },
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
      description:
        "Anotações lançadas no quadro do cliente, com autor, para quem vão e se já foram verificadas. Sem 'dia' traz as de hoje; com so_nao_verificadas e sem 'dia' traz as pendentes de qualquer dia. Sem empresa_id, traz as de todos os clientes que a pessoa atende.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string" },
          dia: { type: "string", description: "aaaa-mm-dd" },
          so_nao_verificadas: { type: "boolean", description: "só as que ainda não foram verificadas" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_anotacao",
      description:
        "Lança uma anotação do dia no quadro de um cliente. DUAS ETAPAS: primeiro chame SEM 'confirmado' para receber a prévia, mostre a prévia à pessoa e pergunte se pode gravar. Só depois que ela responder que sim, chame de novo com confirmado=true. Na confirmação, o servidor grava exatamente o texto da prévia.",
      parameters: {
        type: "object",
        properties: {
          empresa_id: { type: "string", description: "id do cliente" },
          texto: { type: "string", description: "o texto da anotação, como a pessoa quer registrar" },
          para: {
            type: "array",
            items: { type: "string" },
            description: "ids de quem deve receber; vazio = analistas vinculados ao cliente",
          },
          confirmado: { type: "boolean", description: "true só depois de a pessoa aprovar a prévia" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verificar_anotacao",
      description: "Marca uma anotação do dia como verificada. Só quando a pessoa pedir.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id da anotação" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "equipe",
      description: "Colaboradores da Central, com papel. Use para saber quem é quem.",
      parameters: semParametros,
    },
  },
];

FERRAMENTAS.push(...FERRAMENTAS_EMAIL, ...FERRAMENTAS_RELATORIO, ...FERRAMENTAS_ALTERACOES);

const corta = (n) => Math.min(Math.max(Number(n) || 50, 1), LIMITE_LINHAS);

// id → { nome, ativo }. Tenta a view da equipe; se ela ainda não existir, usa perfis_usuarios.
async function mapaEquipe(sb) {
  const vw = await sb.from("central_vw_equipe").select("usuario_id, nome, ativo");
  let linhas = vw.error ? null : vw.data;
  if (!linhas) {
    const perfis = await sb.from("perfis_usuarios").select("usuario_id, nome, ativo");
    linhas = perfis.data ?? [];
  }
  return new Map(linhas.map((l) => [l.usuario_id, { nome: l.nome, ativo: l.ativo !== false }]));
}

async function registrarAnotacao(args, sb, ctx) {
  // 2ª etapa: a pessoa já viu a prévia e respondeu.
  if (args.confirmado === true) {
    const p = ctx.pendente;
    if (!p || p.tipo !== "anotacao") {
      return { erro: "Não há prévia aprovada. Mostre a prévia à pessoa e espere ela dizer que pode gravar." };
    }
    if (args.empresa_id && args.empresa_id !== p.empresa_id) {
      return { erro: `A aprovação da pessoa foi para a prévia de ${p.cliente}. Mostre a prévia deste cliente de novo.` };
    }
    ctx.pendente = null; // vale uma vez só
    // Grava o texto da PRÉVIA, não o que o modelo mandar agora.
    const { data, error } = await sb.rpc("central_anotar", {
      p_empresa: p.empresa_id,
      p_texto: p.texto,
      p_para: p.para,
      p_origem: "agente",
    });
    if (error) return { erro: traduzirErro(error.message) };
    return { ok: true, id: data, gravado: { cliente: p.cliente, texto: p.texto, vai_para: p.destinatarios } };
  }

  // 1ª etapa: valida e devolve a prévia, sem gravar nada.
  const texto = String(args.texto || "").trim();
  if (!UUID.test(String(args.empresa_id || ""))) return { erro: "Informe o cliente. Use listar_clientes para achar o id." };
  if (!texto) return { erro: "A anotação está vazia." };
  if (texto.length > 2000) return { erro: "A anotação passa de 2000 caracteres. Peça para encurtar." };

  let para = null;
  if (Array.isArray(args.para) && args.para.length) {
    if (!args.para.every((id) => UUID.test(String(id)))) return { erro: "Algum destinatário veio com id inválido." };
    para = args.para;
  }

  const { data: cliente } = await sb.from("central_clientes").select("id, codigo, nome").eq("id", args.empresa_id).maybeSingle();
  if (!cliente) return { erro: "Cliente não encontrado ou fora do seu acesso." };

  let destinatarios = "os analistas vinculados ao cliente";
  if (para) {
    const equipe = await mapaEquipe(sb);
    const achados = para.map((id) => equipe.get(id));
    if (achados.some((a) => !a || !a.ativo)) return { erro: "Algum destinatário não está ativo na Central." };
    destinatarios = achados.map((a) => a.nome).join(", ");
  }

  const nomeCliente = `${cliente.codigo} - ${cliente.nome}`;
  ctx.novoPendente = { tipo: "anotacao", empresa_id: cliente.id, texto, para, cliente: nomeCliente, destinatarios };
  return {
    precisa_confirmar: true,
    previa: { cliente: nomeCliente, texto, vai_para: destinatarios },
    instrucao: "Mostre esta prévia e pergunte se pode gravar. Só chame de novo com confirmado=true depois que a pessoa responder que sim.",
  };
}

// Cada ferramenta recebe: nome, argumentos, o cliente Supabase da pessoa e o contexto da conversa.
async function despachar(nome, args, sb, ctx) {
  if (nome === "gerar_relatorio_dia") return gerarRelatorioDia(args, sb, ctx);
  if (nome === "alterar_dados") return alterarDados(args, sb, ctx);
  if (nome === "enviar_email") {
    // Se o e-mail era um relatório, marca como enviadas as anotações que estavam na prévia.
    const r = await executarEmail(nome, args, ctx);
    return r.ok ? { ...r, ...(await marcarAnotacoesDoRelatorio(String(args.envio_id ?? ""), sb, ctx)) } : r;
  }
  if (NOMES_EMAIL.has(nome)) return executarEmail(nome, args, ctx);

  if (nome === "listar_clientes") {
    const { data, error } = await sb.from("central_clientes").select("id, codigo, nome, situacao").order("codigo");
    return error ? { erro: error.message } : { clientes: data };
  }

  if (nome === "consultar_tarefas") {
    let q = sb.from("central_vw_tarefas").select("*").limit(corta(args.limite));
    if (args.empresa_id) q = q.eq("empresa_id", args.empresa_id);
    if (args.status) q = q.eq("status", args.status);
    if (args.de) q = q.gte("prazo", args.de);
    if (args.ate) q = q.lte("prazo", args.ate);
    if (args.atrasadas) q = q.lt("prazo", ctx.hoje).not("status", "in", "(concluida,cancelada)");
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
    let q = sb
      .from("central_anotacoes")
      .select("id, empresa_id, usuario_id, dia, texto, para, enviada_em, verificada_em, origem");
    if (args.empresa_id) q = q.eq("empresa_id", args.empresa_id);
    if (args.dia) q = q.eq("dia", args.dia);
    else if (!args.so_nao_verificadas) q = q.eq("dia", ctx.hoje);
    if (args.so_nao_verificadas) q = q.is("verificada_em", null);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(LIMITE_LINHAS);
    if (error) return { erro: error.message };
    const equipe = await mapaEquipe(sb);
    const nomeDe = (id) => equipe.get(id)?.nome ?? "—";
    return {
      anotacoes: data.map((a) => ({
        ...a,
        autor: nomeDe(a.usuario_id),
        para_nomes: a.para ? a.para.map(nomeDe) : "analistas vinculados ao cliente",
      })),
    };
  }

  if (nome === "registrar_anotacao") return registrarAnotacao(args, sb, ctx);

  if (nome === "verificar_anotacao") {
    if (!UUID.test(String(args.id || ""))) return { erro: "Informe o id da anotação." };
    const { error } = await sb.rpc("central_verificar_anotacao", { p_id: args.id });
    return error ? { erro: traduzirErro(error.message) } : { ok: true };
  }

  if (nome === "equipe") {
    const vw = await sb.from("central_vw_equipe").select("usuario_id, nome, email, papel, ativo");
    if (!vw.error) return { equipe: vw.data };
    const { data, error } = await sb.from("perfis_usuarios").select("usuario_id, nome, papel, ativo").eq("ativo", true);
    return error ? { erro: error.message } : { equipe: data };
  }

  return { erro: `ferramenta desconhecida: ${nome}` };
}

// Exceção dentro de uma ferramenta vira resposta de erro para o modelo: não derruba a conversa inteira.
export async function executar(nome, args, sb, ctx) {
  try {
    return await despachar(nome, args, sb, ctx);
  } catch (e) {
    console.error(`ferramenta ${nome}:`, e);
    return { erro: `Falha ao executar ${nome}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

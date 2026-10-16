// Ferramentas de e-mail do agente. A lógica está em _email.js; aqui ficam só a
// definição para o modelo e a tradução de argumentos e respostas.
import { salvarModelo, prepararEnvio, enviarEnvio } from "./_email.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lista = (v) => (Array.isArray(v) ? v.map(String) : []);
const listaDeEnderecos = { type: "array", items: { type: "string" } };

export const NOMES_EMAIL = new Set(["listar_modelos_email", "salvar_modelo_email", "preparar_email", "enviar_email"]);

export const FERRAMENTAS_EMAIL = [
  {
    type: "function",
    function: {
      name: "listar_modelos_email",
      description: "Modelos de e-mail salvos: código, nome, campos {{assim}} a preencher e destinatários fixos.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "salvar_modelo_email",
      description:
        "Salva (ou atualiza) um modelo de e-mail para reuso. O corpo aceita **negrito**, '- ' no começo da linha para lista, parágrafos separados por linha em branco e campos {{assim}} que mudam a cada envio. Para/Cc/Cco do modelo são os destinatários fixos.",
      parameters: {
        type: "object",
        properties: {
          codigo: { type: "string", description: "identificador em maiúsculas, ex.: TL_DISTRIBUICAO_LUCROS" },
          nome: { type: "string" },
          assunto: { type: "string" },
          corpo: { type: "string" },
          para: listaDeEnderecos,
          cc: listaDeEnderecos,
          cco: listaDeEnderecos,
          empresa_id: { type: "string", description: "id do cliente a que o modelo pertence (opcional)" },
          observacoes: { type: "string" },
        },
        required: ["codigo", "nome", "assunto", "corpo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preparar_email",
      description:
        "Monta o e-mail com a identidade da Effective e devolve a PRÉVIA. NÃO ENVIA. Use modelo_codigo (com 'dados' para os campos {{assim}}) ou assunto + corpo. Depois mostre a prévia à pessoa e espere ela confirmar.",
      parameters: {
        type: "object",
        properties: {
          modelo_codigo: { type: "string" },
          assunto: { type: "string" },
          corpo: { type: "string" },
          dados: { type: "object", additionalProperties: { type: "string" }, description: "valor de cada campo {{assim}}, ex.: {\"competencia\": \"09/2026\"}" },
          para: listaDeEnderecos,
          cc: listaDeEnderecos,
          cco: listaDeEnderecos,
          empresa_id: { type: "string" },
          anexo_ids: { type: "array", items: { type: "string" }, description: "anexo_id dos arquivos anexados na conversa (até 10, 10 MB no total)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enviar_email",
      description:
        "Envia um e-mail já preparado. Só chame depois de a pessoa ter visto a prévia e respondido que pode enviar, numa mensagem nova. O servidor recusa se não houve essa resposta.",
      parameters: {
        type: "object",
        properties: { envio_id: { type: "string", description: "o envio_id devolvido por preparar_email" } },
        required: ["envio_id"],
        additionalProperties: false,
      },
    },
  },
];

export async function executarEmail(nome, args, ctx) {
  const portas = ctx.emailPortas;
  if (!portas) return { erro: "O e-mail não está disponível neste servidor (falta a chave de serviço do Supabase)." };

  if (nome === "listar_modelos_email") return { modelos: await portas.listarModelos() };

  if (args.empresa_id && !UUID.test(String(args.empresa_id))) return { erro: "empresa_id inválido." };
  const empresaId = args.empresa_id ? String(args.empresa_id) : null;

  if (nome === "salvar_modelo_email") {
    const r = await salvarModelo(
      {
        codigo: args.codigo, nome: args.nome, assunto: args.assunto, corpo: args.corpo,
        para: lista(args.para), cc: lista(args.cc), cco: lista(args.cco),
        empresaId, observacoes: args.observacoes ?? null,
      },
      ctx.usuarioId,
      portas
    );
    return r.ok ? { ok: true, codigo: r.codigo, novo: r.novo, campos: r.campos } : { erro: r.erro };
  }

  if (nome === "preparar_email") {
    const r = await prepararEnvio(
      {
        modeloCodigo: args.modelo_codigo ?? null, assunto: args.assunto ?? null, corpo: args.corpo ?? null,
        dados: args.dados && typeof args.dados === "object" ? args.dados : {},
        para: lista(args.para), cc: lista(args.cc), cco: lista(args.cco), empresaId, anexoIds: lista(args.anexo_ids),
      },
      { usuarioId: ctx.usuarioId, conversaId: ctx.conversaId },
      portas
    );
    if (!r.ok) return { erro: r.erro };
    const p = r.previa;
    return {
      precisa_confirmar: true,
      previa: { envio_id: p.envioId, assunto: p.assunto, para: p.para, cc: p.cc, cco: p.cco, texto: p.texto, avisos: p.avisos, anexos: p.anexos },
      instrucao:
        "Mostre assunto, destinatários (Para, Cc e Cco) e o texto, e pergunte se pode enviar. Só chame enviar_email depois que a pessoa responder que sim numa nova mensagem.",
    };
  }

  if (nome === "enviar_email") {
    const r = await enviarEnvio(String(args.envio_id ?? ""), { usuarioId: ctx.usuarioId, conversaId: ctx.conversaId }, portas);
    if (!r.ok) {
      return {
        erro: r.erro,
        codigo: r.codigo,
        ...(r.codigo === "envio_incerto" ? { atencao: "O e-mail pode ter saído. Peça para conferir a caixa de enviados antes de tentar de novo." } : {}),
      };
    }
    return { ok: true, mensagem_id: r.mensagemId, enviado_para: r.para, assunto: r.assunto };
  }

  return { erro: `ferramenta desconhecida: ${nome}` };
}

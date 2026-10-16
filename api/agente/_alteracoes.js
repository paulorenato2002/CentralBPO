// Alterações no banco pelo agente.
//
// NÃO existe escrita genérica: só OPERAÇÕES NOMEADAS, cada uma chamando a mesma
// função central_* que a tela da Central usa, com o token da pessoa. As regras de
// permissão e de negócio continuam sendo as do banco (o agente não passa por cima
// de nada que a pessoa não pudesse fazer clicando), e nenhuma operação apaga.
//
// TODA alteração tem duas etapas. A prévia mostra o que vai mudar e guarda os dados
// NORMALIZADOS; a confirmação, que só vale na mensagem seguinte da pessoa, grava
// exatamente a prévia e ignora o que o modelo mandar de novo. Vale uma vez só.
import { UUID } from "./_anexos.js";

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (s) => {
  if (!DIA_ISO.test(String(s))) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const texto = (v) => String(v ?? "").trim();

const ERROS = {
  SEM_ACESSO_CLIENTE: "Você não atende este cliente.",
  TAREFA_INVALIDA: "Tarefa não encontrada.",
  JA_CONCLUIDA: "Esta tarefa já foi concluída.",
  SEM_PERMISSAO: "Você não tem permissão para isso.",
  DESTINO_INVALIDO: "Essa pessoa não está ativa na Central.",
  ORIGEM_INVALIDA: "Essa pessoa não é responsável por esta tarefa.",
  JA_RESPONSAVEL: "Essa pessoa já é responsável por esta tarefa.",
  DIARIA_SEM_DATAS: "Tarefa diária não tem datas editáveis.",
  PRAZO_OBRIGATORIO: "Informe a data de entrega.",
  META_DEPOIS_DA_ENTREGA: "A meta não pode ser depois da entrega.",
  DADOS_INCOMPLETOS: "Preencha os campos obrigatórios.",
  // Por último de propósito: "SEM_ACESSO" é prefixo de "SEM_ACESSO_CLIENTE", e a primeira que casa vence.
  SEM_ACESSO: "Seu usuário não tem acesso ativo à Central. Fale com o administrador.",
};

export function traduzirErroDoBanco(msg = "") {
  const t = String(msg);
  for (const [codigo, traducao] of Object.entries(ERROS)) if (t.includes(codigo)) return traducao;
  return t.slice(0, 200) || "o banco recusou a alteração";
}

async function lerTarefa(sb, id) {
  const { data } = await sb.from("central_vw_tarefas").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

async function nomesDaEquipe(sb) {
  const vw = await sb.from("central_vw_equipe").select("usuario_id, nome, ativo");
  let linhas = vw.error ? null : vw.data;
  if (!linhas) linhas = (await sb.from("perfis_usuarios").select("usuario_id, nome, ativo")).data ?? [];
  return new Map(linhas.map((l) => [l.usuario_id, { nome: l.nome, ativo: l.ativo !== false }]));
}

const rotuloTarefa = (t) => `${t.titulo} (${t.empresa_codigo} - ${t.empresa_nome})`;

// Cada operação: preparar() valida e devolve { dados, resumo, linhas } ou { erro };
// executar() chama a função do banco com os dados já normalizados.
const OPERACOES = {
  criar_tarefa_pontual: {
    async preparar(d, sb) {
      if (!UUID.test(texto(d.empresa_id))) return { erro: "Informe o cliente (empresa_id). Use listar_clientes para achar o id." };
      const titulo = texto(d.titulo);
      if (!titulo) return { erro: "Dê um título à tarefa." };
      if (titulo.length > 200) return { erro: "O título passa de 200 caracteres." };
      if (!dataValida(d.data)) return { erro: "Informe a data de entrega no formato aaaa-mm-dd." };
      const { data: cli } = await sb.from("central_clientes").select("id, codigo, nome").eq("id", d.empresa_id).maybeSingle();
      if (!cli) return { erro: "Cliente não encontrado ou fora do seu acesso." };
      const cliente = `${cli.codigo} - ${cli.nome}`;
      return {
        dados: { empresa_id: cli.id, titulo, data: d.data },
        resumo: `Criar a tarefa pontual "${titulo}" para ${cliente}, entrega ${dmy(d.data)}`,
        linhas: [`Cliente: ${cliente}`, `Tarefa pontual: ${titulo}`, `Entrega: ${dmy(d.data)}`, "Responsável: a própria pessoa que está pedindo"],
      };
    },
    executar: (d, sb) => sb.rpc("central_criar_pontual", { p_empresa: d.empresa_id, p_titulo: d.titulo, p_data: d.data }),
    resultado: (data) => ({ tarefa_id: data }),
  },

  alterar_datas_tarefa: {
    async preparar(d, sb) {
      if (!UUID.test(texto(d.tarefa_id))) return { erro: "Informe a tarefa (tarefa_id). Use consultar_tarefas para achar o id." };
      const informouPrazo = texto(d.prazo) !== "";
      const informouMeta = texto(d.meta) !== "";
      if (!informouPrazo && !informouMeta && d.remover_meta !== true) return { erro: "Informe o novo prazo, a nova meta ou remover_meta." };
      if (informouPrazo && !dataValida(d.prazo)) return { erro: "O prazo precisa estar no formato aaaa-mm-dd." };
      if (informouMeta && !dataValida(d.meta)) return { erro: "A meta precisa estar no formato aaaa-mm-dd." };

      const t = await lerTarefa(sb, d.tarefa_id);
      if (!t) return { erro: "Tarefa não encontrada ou fora do seu acesso." };
      if (t.tipo_recorrencia === "diaria") return { erro: ERROS.DIARIA_SEM_DATAS };
      if (t.status === "concluida") return { erro: ERROS.JA_CONCLUIDA };

      // A função do banco GRAVA o p_meta que receber, e nulo apaga a meta. Por isso a meta atual é
      // preservada, e só some se a pessoa pedir (remover_meta).
      const prazo = informouPrazo ? d.prazo : t.prazo;
      const meta = d.remover_meta === true ? null : informouMeta ? d.meta : t.data_meta ?? null;
      if (meta && meta > prazo) return { erro: ERROS.META_DEPOIS_DA_ENTREGA };
      if (prazo === t.prazo && meta === (t.data_meta ?? null)) return { erro: "As datas já são essas. Não há nada a alterar." };

      const metaTxt = (m) => (m ? dmy(m) : "sem meta");
      return {
        dados: { tarefa_id: t.id, prazo, meta },
        resumo: `Alterar as datas de "${t.titulo}" (${t.empresa_codigo}): entrega ${dmy(t.prazo)} → ${dmy(prazo)}, meta ${metaTxt(t.data_meta)} → ${metaTxt(meta)}`,
        linhas: [`Tarefa: ${rotuloTarefa(t)}`, `Entrega: ${dmy(t.prazo)} → ${dmy(prazo)}`, `Meta: ${metaTxt(t.data_meta)} → ${metaTxt(meta)}`],
      };
    },
    executar: (d, sb) => sb.rpc("central_alterar_datas", { p_tarefa: d.tarefa_id, p_meta: d.meta, p_prazo: d.prazo }),
  },

  comentar_tarefa: {
    async preparar(d, sb) {
      if (!UUID.test(texto(d.tarefa_id))) return { erro: "Informe a tarefa (tarefa_id). Use consultar_tarefas para achar o id." };
      const obs = texto(d.texto);
      if (!obs) return { erro: "O comentário está vazio." };
      if (obs.length > 2000) return { erro: "O comentário passa de 2000 caracteres." };
      const t = await lerTarefa(sb, d.tarefa_id);
      if (!t) return { erro: "Tarefa não encontrada ou fora do seu acesso." };
      return {
        dados: { tarefa_id: t.id, texto: obs },
        resumo: `Comentar em "${t.titulo}" (${t.empresa_codigo}): ${obs.slice(0, 80)}${obs.length > 80 ? "…" : ""}`,
        linhas: [`Tarefa: ${rotuloTarefa(t)}`, `Comentário: ${obs}`],
      };
    },
    executar: (d, sb) => sb.rpc("central_comentar", { p_tarefa: d.tarefa_id, p_texto: d.texto }),
  },

  transferir_tarefa: {
    async preparar(d, sb) {
      if (!UUID.test(texto(d.tarefa_id))) return { erro: "Informe a tarefa (tarefa_id). Use consultar_tarefas para achar o id." };
      if (!UUID.test(texto(d.para))) return { erro: "Informe para quem transferir (id da pessoa). Use equipe para achar." };
      const t = await lerTarefa(sb, d.tarefa_id);
      if (!t) return { erro: "Tarefa não encontrada ou fora do seu acesso." };
      if (t.status === "concluida") return { erro: ERROS.JA_CONCLUIDA };

      const responsaveis = t.responsaveis ?? [];
      const de = texto(d.de) || (responsaveis.length === 1 ? responsaveis[0] : "");
      if (!de) return { erro: "A tarefa tem mais de uma responsável. Diga de quem ela sai (de)." };
      if (!responsaveis.includes(de)) return { erro: ERROS.ORIGEM_INVALIDA };
      if (responsaveis.includes(d.para)) return { erro: ERROS.JA_RESPONSAVEL };

      const equipe = await nomesDaEquipe(sb);
      const origem = equipe.get(de);
      const destino = equipe.get(d.para);
      if (!destino || !destino.ativo) return { erro: ERROS.DESTINO_INVALIDO };
      const nomeOrigem = origem?.nome ?? "—";
      return {
        dados: { tarefa_id: t.id, de, para: d.para },
        resumo: `Transferir "${t.titulo}" (${t.empresa_codigo}) de ${nomeOrigem} para ${destino.nome}`,
        linhas: [`Tarefa: ${rotuloTarefa(t)}`, `De: ${nomeOrigem}`, `Para: ${destino.nome}`],
      };
    },
    executar: (d, sb) => sb.rpc("central_transferir", { p_tarefa: d.tarefa_id, p_de: d.de, p_para: d.para }),
  },
};

export const NOMES_OPERACOES = Object.keys(OPERACOES);

export const FERRAMENTAS_ALTERACOES = [
  {
    type: "function",
    function: {
      name: "alterar_dados",
      description:
        "Altera dados da operação por operações NOMEADAS. Não há escrita livre no banco e nada é apagado; quem não tem permissão recebe a recusa do banco. DUAS ETAPAS: chame SEM 'confirmado' para receber a prévia, mostre à pessoa e pergunte se pode gravar; só depois que ela responder que sim, chame de novo com confirmado=true (o servidor grava exatamente a prévia). Uma alteração por vez. " +
        "Operações e seus 'dados' (datas em aaaa-mm-dd): " +
        "criar_tarefa_pontual {empresa_id, titulo, data}; " +
        "alterar_datas_tarefa {tarefa_id, prazo?, meta?, remover_meta?} (a meta atual é mantida, a menos que remover_meta=true); " +
        "comentar_tarefa {tarefa_id, texto}; " +
        "transferir_tarefa {tarefa_id, para, de?} (de é opcional se a tarefa tem uma só responsável).",
      parameters: {
        type: "object",
        properties: {
          operacao: { type: "string", enum: NOMES_OPERACOES },
          dados: { type: "object", description: "os campos da operação escolhida" },
          confirmado: { type: "boolean", description: "true só depois de a pessoa aprovar a prévia" },
        },
        additionalProperties: false,
      },
    },
  },
];

export async function alterarDados(args, sb, ctx) {
  // 2ª etapa: a pessoa já viu a prévia e respondeu.
  if (args.confirmado === true) {
    const p = ctx.pendente;
    if (!p || p.tipo !== "alteracao") return { erro: "Não há prévia aprovada. Mostre a prévia à pessoa e espere ela dizer que pode gravar." };
    if (args.operacao && args.operacao !== p.operacao) {
      return { erro: `A aprovação da pessoa foi para outra alteração (${p.resumo}). Mostre a prévia desta de novo.` };
    }
    const op = OPERACOES[p.operacao];
    if (!op) return { erro: "Operação desconhecida." };
    ctx.pendente = null; // vale uma vez só
    // Grava os dados da PRÉVIA, não os que o modelo mandar agora.
    const { data, error } = await op.executar(p.dados, sb);
    if (error) return { erro: traduzirErroDoBanco(error.message) };
    return { ok: true, feito: p.resumo, ...(op.resultado ? op.resultado(data) : {}) };
  }

  // 1ª etapa: valida, normaliza e devolve a prévia, sem gravar nada.
  const op = OPERACOES[args.operacao];
  if (!op) return { erro: `Operação desconhecida. As disponíveis são: ${NOMES_OPERACOES.join(", ")}. Não existe operação para apagar nem para alterar cadastro.` };
  const r = await op.preparar(args.dados && typeof args.dados === "object" ? args.dados : {}, sb);
  if (r.erro) return { erro: r.erro };
  ctx.novoPendente = { tipo: "alteracao", operacao: args.operacao, dados: r.dados, resumo: r.resumo };
  return {
    precisa_confirmar: true,
    previa: { operacao: args.operacao, resumo: r.resumo, detalhes: r.linhas },
    instrucao: "Mostre o que vai mudar e pergunte se pode gravar. Só chame de novo com confirmado=true depois que a pessoa responder que sim, numa nova mensagem.",
  };
}

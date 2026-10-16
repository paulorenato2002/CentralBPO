// Relatório diário por e-mail: a posição das tarefas por cliente mais as
// anotações do dia que ainda não saíram.
//
// Os números vêm de central_resumo_dia (a regra de atraso e recorrência mora no
// banco, uma vez só) e as anotações de central_anotacoes. Tudo é lido com o token
// de quem pediu, então o relatório cobre os clientes que ESSA pessoa enxerga.
//
// O envio é o mesmo de qualquer e-mail (_email.js): prévia, confirmação da pessoa
// e envio único. Só depois de o e-mail sair é que as anotações da prévia são
// marcadas como enviadas, e só as que estavam na prévia.
import { prepararEnvio } from "./_email.js";

const TIPOS = [
  ["diaria", ["diária", "diárias"]],
  ["semanal", ["semanal", "semanais"]],
  ["quinzenal", ["quinzenal", "quinzenais"]],
  ["mensal", ["mensal", "mensais"]],
  ["anual", ["anual", "anuais"]],
  ["pontual", ["pontual", "pontuais"]],
];

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const lista = (v) => (Array.isArray(v) ? v.map(String) : []);

/** Data de hoje em Brasília. toISOString() daria o dia seguinte depois das 21h. */
export const hojeEmSaoPaulo = (agora = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(agora);

const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const curto = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n, [um, varios]) => `${n} ${n === 1 ? um : varios}`;

// Texto digitado pela pessoa entra no corpo como texto puro: sem {{campo}}, sem **negrito**
// e sem quebra de linha que viraria parágrafo ou item de lista.
const neutro = (texto) =>
  String(texto ?? "").replace(/\s+/g, " ").trim().replace(/\{\{/g, "{​{").replace(/\*\*/g, "*​*");

const pendentesTexto = (obj) =>
  TIPOS.filter(([k]) => Number(obj?.[k]) > 0).map(([k, nomes]) => plural(Number(obj[k]), nomes)).join(", ");

const concluidasPorTexto = (obj) =>
  Object.entries(obj ?? {})
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0], "pt-BR"))
    .map(([nome, n]) => `${neutro(nome)} (${n})`)
    .join(", ");

/** Monta assunto e corpo (no formato dos modelos de e-mail) e devolve os ids das anotações incluídas. */
export function montarRelatorio({ dia, resumo, anotacoes, nomeDe, geradoPor }) {
  const clientes = [...resumo].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
  const idsDoResumo = new Set(clientes.map((c) => c.empresa_id));
  const porEmpresa = new Map();
  for (const a of anotacoes) {
    if (!porEmpresa.has(a.empresa_id)) porEmpresa.set(a.empresa_id, []);
    porEmpresa.get(a.empresa_id).push(a);
  }

  const soma = (campo) => clientes.reduce((t, c) => t + (Number(c[campo]) || 0), 0);
  const totais = {
    clientes: clientes.length,
    abertas: soma("abertas_no_dia"),
    concluidas: soma("concluidas_no_dia"),
    atrasadas: soma("atrasadas"),
    // Todas as pendentes, de qualquer tipo: abertas no dia e atrasadas juntas, como o banco as conta.
    pendentes: clientes.reduce((t, c) => t + TIPOS.reduce((s, [k]) => s + (Number(c.pendentes_por_tipo?.[k]) || 0), 0), 0),
    maiorAtraso: Math.max(0, ...clientes.map((c) => Number(c.maior_atraso_dias) || 0)),
    anotacoes: anotacoes.length,
  };

  const linhaNota = (a) => {
    const outroDia = a.dia && a.dia !== dia ? ` de ${curto(a.dia)}` : "";
    const para = Array.isArray(a.para) && a.para.length ? a.para.map(nomeDe).join(", ") : "analistas do cliente";
    const estado = a.verificada_em ? "verificada" : "ainda não verificada";
    return `- Anotação${outroDia}: ${neutro(a.texto)} (${neutro(nomeDe(a.usuario_id))}; para ${neutro(para)}; ${estado})`;
  };

  const temMovimento = (c) =>
    ["abertas_no_dia", "concluidas_no_dia", "atrasadas"].some((k) => Number(c[k]) > 0) ||
    pendentesTexto(c.pendentes_por_tipo) !== "" ||
    porEmpresa.has(c.empresa_id);

  const blocos = [`Posição das tarefas e anotações de ${dmy(dia)}.`];

  const resumoGeral = [
    `- Clientes no relatório: ${totais.clientes}`,
    `- Abertas no dia: ${totais.abertas}`,
    `- Atrasadas: ${totais.atrasadas}${totais.atrasadas > 0 ? ` (maior atraso: ${plural(totais.maiorAtraso, ["dia", "dias"])})` : ""}`,
    `- Pendentes no total: ${totais.pendentes}`,
    `- Concluídas no dia: ${totais.concluidas}`,
    `- Anotações pendentes: ${totais.anotacoes}`,
  ];
  blocos.push("**Resumo geral**", resumoGeral.join("\n"));

  for (const c of clientes.filter(temMovimento)) {
    const linhas = [
      `- Abertas no dia: ${Number(c.abertas_no_dia) || 0} · Atrasadas: ${Number(c.atrasadas) || 0}` +
        `${Number(c.atrasadas) > 0 ? ` (maior atraso: ${plural(Number(c.maior_atraso_dias) || 0, ["dia", "dias"])})` : ""}` +
        ` · Concluídas no dia: ${Number(c.concluidas_no_dia) || 0}`,
    ];
    const pend = pendentesTexto(c.pendentes_por_tipo);
    if (pend) linhas.push(`- Pendentes por tipo: ${pend}`);
    const por = concluidasPorTexto(c.concluidas_por);
    if (por) linhas.push(`- Concluídas por: ${por}`);
    for (const a of porEmpresa.get(c.empresa_id) ?? []) linhas.push(linhaNota(a));
    blocos.push(`**${neutro(c.codigo)} — ${neutro(c.nome)}**`, linhas.join("\n"));
  }

  const semMovimento = clientes.filter((c) => !temMovimento(c));
  if (semMovimento.length) blocos.push(`Sem movimento: ${semMovimento.map((c) => neutro(c.codigo)).join(", ")}.`);

  // Anotação de cliente que não veio no resumo continua no relatório: ela será marcada como enviada.
  const orfas = anotacoes.filter((a) => !idsDoResumo.has(a.empresa_id));
  if (orfas.length) blocos.push("**Outros clientes**", orfas.map(linhaNota).join("\n"));

  blocos.push(`Gerado${geradoPor ? ` por ${neutro(geradoPor)}` : ""} pelo agente da Central BPO.`);

  return {
    assunto: `Posição do dia ${dmy(dia)} — Effective BPO`,
    corpo: blocos.join("\n\n"),
    totais,
    anotacaoIds: anotacoes.map((a) => a.id),
  };
}

async function equipeComEmail(sb) {
  const vw = await sb.from("central_vw_equipe").select("usuario_id, nome, email, papel, ativo");
  if (!vw.error && vw.data) return vw.data;
  const perfis = await sb.from("perfis_usuarios").select("usuario_id, nome, email, papel, ativo");
  return perfis.data ?? [];
}

export const FERRAMENTAS_RELATORIO = [
  {
    type: "function",
    function: {
      name: "gerar_relatorio_dia",
      description:
        "Monta a PRÉVIA do relatório diário por e-mail: posição das tarefas por cliente (em aberto, atrasadas, concluídas, pendentes por tipo) e as anotações do dia que ainda não foram enviadas. NÃO ENVIA. Vai para todos os colaboradores ativos, ou só para os endereços de somente_para (use em teste). Depois que a pessoa aprovar a prévia, envie com enviar_email.",
      parameters: {
        type: "object",
        properties: {
          dia: { type: "string", description: "aaaa-mm-dd; padrão é hoje" },
          somente_para: { type: "array", items: { type: "string" }, description: "e-mails que recebem no lugar da equipe (teste)" },
        },
        additionalProperties: false,
      },
    },
  },
];

export async function gerarRelatorioDia(args, sb, ctx) {
  if (!ctx.emailPortas) return { erro: "O e-mail não está disponível neste servidor (falta a chave de serviço do Supabase)." };

  const dia = args.dia ?? ctx.hoje;
  if (!DIA_ISO.test(String(dia))) return { erro: "Dia inválido. Use aaaa-mm-dd." };

  const { data: resumo, error: erroResumo } = await sb.rpc("central_resumo_dia", { p_dia: dia });
  if (erroResumo) return { erro: `Não consegui ler o resumo do dia: ${String(erroResumo.message).slice(0, 200)}` };
  if (!resumo?.length) return { erro: "Não há clientes no seu acesso para montar o relatório." };

  const { data: notas, error: erroNotas } = await sb
    .from("central_anotacoes")
    .select("id, empresa_id, usuario_id, dia, texto, para, verificada_em")
    .is("enviada_em", null)
    .order("dia", { ascending: true })
    .limit(500);
  if (erroNotas) return { erro: `Não consegui ler as anotações: ${String(erroNotas.message).slice(0, 200)}` };
  // Entra o que é do dia e o que ainda espera verificação, mesmo de dias anteriores.
  const anotacoes = (notas ?? []).filter((a) => a.dia === dia || !a.verificada_em);

  const equipe = await equipeComEmail(sb);
  const nomes = new Map(equipe.map((p) => [p.usuario_id, p.nome]));
  const nomeDe = (id) => nomes.get(id) ?? "—";

  const teste = lista(args.somente_para);
  const para = teste.length ? teste : equipe.filter((p) => p.ativo !== false && p.email).map((p) => p.email);
  if (!para.length) return { erro: "Não há colaborador ativo com e-mail para receber o relatório." };

  const rel = montarRelatorio({ dia, resumo, anotacoes, nomeDe, geradoPor: ctx.nome });
  const r = await prepararEnvio(
    { assunto: rel.assunto, corpo: rel.corpo, dados: {}, para, cc: [], cco: [], empresaId: null },
    { usuarioId: ctx.usuarioId, conversaId: ctx.conversaId },
    ctx.emailPortas
  );
  if (!r.ok) return { erro: r.erro };

  // Guardado na mensagem do agente: é como a confirmação, na mensagem seguinte, sabe o que marcar.
  ctx.novoPendente = { tipo: "relatorio", envio_id: r.previa.envioId, dia, anotacao_ids: rel.anotacaoIds };
  return {
    precisa_confirmar: true,
    previa: {
      envio_id: r.previa.envioId,
      assunto: r.previa.assunto,
      para: r.previa.para,
      clientes_incluidos: rel.totais.clientes,
      anotacoes_incluidas: rel.totais.anotacoes,
      totais: rel.totais,
      texto: r.previa.texto,
      avisos: r.previa.avisos,
    },
    instrucao:
      "Mostre os totais, quantos clientes e anotações entraram, quem vai receber e o texto. Diga que o relatório cobre só os clientes que a pessoa logada enxerga. Pergunte se pode enviar; só depois que ela responder que sim, numa nova mensagem, chame enviar_email com o envio_id.",
  };
}

/**
 * Chamada depois de um enviar_email que deu certo. Se aquele e-mail era um relatório
 * (a prévia está guardada na mensagem anterior do agente), marca como enviadas as
 * anotações que estavam NELA. Se a prévia se perdeu, o relatório sai igual e as
 * anotações podem repetir no próximo: erra para o lado de repetir, nunca de sumir.
 */
export async function marcarAnotacoesDoRelatorio(envioId, sb, ctx) {
  const p = ctx.pendente;
  if (!p || p.tipo !== "relatorio" || p.envio_id !== envioId) return {};
  ctx.pendente = null;
  if (!p.anotacao_ids?.length) return { anotacoes_marcadas: 0 };
  const { data, error } = await sb.rpc("central_marcar_anotacoes_enviadas", { p_ids: p.anotacao_ids });
  if (error) {
    return { aviso: "O e-mail saiu, mas não consegui marcar as anotações como enviadas. Elas podem aparecer de novo no próximo relatório." };
  }
  return { anotacoes_marcadas: data };
}

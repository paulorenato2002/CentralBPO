// Tela do cliente: cronômetro, tarefas do dia, cartão da tarefa, senhas e anotações.
import { sb, rpc, q } from "./api.js";
import { E, pode, nomeDe, papelDe, cliente, segundosRodando } from "./estado.js";
import * as Solic from "./solicitacoes.js";
import { $, esc, hms, dmy, diaLongo, diaCurto, hhmm, somaDias, fimSemana, TIPO, COR_PAPEL, linkSeguro, toast, avisoErro, perguntar, copiar, travar } from "./ui.js";

let app = null;                 // { ir(view, id) }
let tarefas = [];               // linhas de central_vw_tarefas do cliente aberto
let fMinhas = "", fTipos = new Set();
let posicao = new Map();        // rotina_id → ordem definida pelo Adm (Ordenar tarefas)

export function iniciar(a) {
  app = a;
  $("#chipsTipo").innerHTML = Object.entries(TIPO).map(([k, v]) => `<button type="button" data-t="${k}">${v}</button>`).join("");
  $("#chipsTipo").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return;
    fTipos.has(b.dataset.t) ? fTipos.delete(b.dataset.t) : fTipos.add(b.dataset.t); b.classList.toggle("on"); desenhar(); });
  $("#segMinhas").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return;
    fMinhas = b.dataset.v; document.querySelectorAll("#segMinhas button").forEach((x) => x.classList.toggle("on", x === b)); desenhar(); });
  $("#voltar").onclick = () => sairPara("clientes");
  $("#tPau").onclick = travar($("#tPau"), pausar);
  $("#tFim").onclick = () => confirmarFinalizar(() => app.ir("clientes"));
  $("#v-empresa").addEventListener("click", (ev) => {
    const ck = ev.target.closest(".ck[data-id]"); if (ck && !ck.disabled) return concluirPorId(ck.dataset.id).catch(avisoErro);
    const d = ev.target.closest("[data-det]"); if (d) abrirCartao(d.dataset.det).catch(avisoErro);
  });
  // tarefa pontual
  $("#pAbrir").onclick = () => { $("#pForm").hidden = false; $("#pData").value = E.hoje; $("#pNome").focus(); };
  $("#pCanc").onclick = () => { $("#pForm").hidden = true; $("#pForm").reset(); };
  $("#pForm").onsubmit = (ev) => { ev.preventDefault(); travar(ev.submitter || $("#pForm button"), async () => {
    await rpc("central_criar_pontual", { p_empresa: E.aberta, p_titulo: $("#pNome").value.trim(), p_data: $("#pData").value });
    $("#pForm").hidden = true; $("#pForm").reset(); toast("Tarefa pontual criada"); await carregar();
  })(); };
  // anotações
  $("#nSalvar").onclick = travar($("#nSalvar"), async () => {
    const t = $("#nTxt").value.trim(); if (!t) return;
    const para = $("#nPara").value;
    // vira uma solicitação: a primeira linha é o assunto, o texto todo fica como detalhe
    await rpc("central_abrir_chamado", { p_empresa: E.aberta, p_titulo: t.split("\n")[0].slice(0, 200), p_texto: t.includes("\n") || t.length > 200 ? t : null, p_responsavel: para || null });
    $("#nTxt").value = ""; $("#nPara").value = ""; toast("Solicitação aberta"); await carregarAnotacoes();
  });
  iniciarCartao(); iniciarSenhas(); iniciarOrdem();
  setInterval(tique, 1000);
  window.addEventListener("beforeunload", (ev) => { if (E.rodando) { ev.preventDefault(); ev.returnValue = ""; } });
}

/* ================= cronômetro ================= */
export async function carregarSessoes() {
  const [sessoes, fechado] = await Promise.all([
    q(sb.from("central_vw_sessoes").select("id, empresa_id, dia, estado, checkpoint_segundos, tempo_ativo_segundos, finalizada_em").eq("usuario_id", E.eu.id).eq("dia", E.hoje)),
    q(sb.from("central_dias_fechados").select("dia").eq("dia", E.hoje))
  ]);
  E.diaFechado = fechado.length > 0;
  E.sessoesHoje = new Map(sessoes.map((s) => [s.empresa_id, { estado: s.estado, tempo: s.tempo_ativo_segundos, finalizada_em: s.finalizada_em }]));
  const r = sessoes.find((s) => s.estado === "rodando");
  E.rodando = r ? { id: r.id, empresa_id: r.empresa_id, base: r.tempo_ativo_segundos, checkpoint: r.checkpoint_segundos, em: Date.now() } : null;
  topo();
}

export function topo() {
  const r = E.rodando;
  $("#timer").classList.toggle("run", !!r);
  $("#tEmp").textContent = r ? cliente(r.empresa_id).nome : E.diaFechado ? "Registro de hoje fechado (22h)" : "Nenhuma empresa aberta";
  $("#tSt").textContent = r ? "rodando" : "";
  $("#tVal").textContent = hms(r ? segundosRodando() : 0);
  $("#tPau").hidden = $("#tFim").hidden = !r;
}

function tique() {
  if (!E.rodando) return;
  $("#tVal").textContent = hms(segundosRodando());
  if (E.view === "empresa" && E.rodando.empresa_id === E.aberta) $("#eAtual b").textContent = hms(segundosRodando() - E.rodando.checkpoint);
}

async function ligar(id) {
  await rpc("central_entrar", { p_empresa: id });
  await carregarSessoes();
  app.ir("empresa", id);
}

// Entrar no cliente: regras de pausa/finalização e reabertura ficam aqui e no banco.
export async function entrar(id) {
  if (E.diaFechado) return perguntar("Registro de hoje fechado", "O registro de horas de hoje foi fechado às 22h e está congelado. Amanhã o cronômetro volta do zero.", [{ txt: "Entendi", cls: "pri" }]);
  if (E.rodando && E.rodando.empresa_id === id) return app.ir("empresa", id);
  if (E.rodando) return sairPara("empresa", id);
  const s = E.sessoesHoje.get(id);
  if (s && s.estado === "finalizada") {
    return perguntar(`Reabrir ${esc(cliente(id).nome)}?`, `Você finalizou este cliente às <b>${esc(hhmm(s.finalizada_em))}</b>. Reabrir volta a contar o tempo e fica registrado.`,
      [{ txt: "Reabrir", cls: "pri", fn: () => ligar(id) }, { txt: "Cancelar" }]);
  }
  await ligar(id);
}

// Trava de saída: com o cronômetro rodando, só sai pausando ou finalizando.
export function sairPara(destino, id) {
  const r = E.rodando;
  if (!r) return app.ir(destino, id);
  const nome = esc(cliente(r.empresa_id).nome);
  const seguir = async () => { if (destino === "empresa") await ligar(id); else app.ir(destino, id); };
  perguntar(`Você está em ${cliente(r.empresa_id).nome}`, `O cronômetro está rodando (${hms(segundosRodando())}). Antes de sair, escolha:`, [
    { txt: "Pausar · volto ainda hoje", cls: "pri", fn: async () => { await rpc("central_sair", { p_sessao: r.id, p_modo: "pausar" }); await carregarSessoes(); await seguir(); } },
    { txt: "Finalizar · terminei por hoje", cls: "red", fn: async () => { await rpc("central_sair", { p_sessao: r.id, p_modo: "finalizar" }); await carregarSessoes(); await seguir(); } },
    { txt: `Continuar em ${cliente(r.empresa_id).nome}` }
  ]);
  void nome;
}

async function pausar() {
  if (!E.rodando) return;
  await rpc("central_sair", { p_sessao: E.rodando.id, p_modo: "pausar" });
  await carregarSessoes(); toast("Cliente pausado"); app.ir("clientes");
}

function confirmarFinalizar(depois) {
  const r = E.rodando; if (!r) return;
  const hojeT = tarefas.filter((t) => t.alvo === E.hoje && r.empresa_id === E.aberta);
  const abertas = hojeT.filter((t) => t.status !== "concluida").length;
  perguntar(`Finalizar ${cliente(r.empresa_id).nome} por hoje?`,
    `Tempo hoje: <b>${hms(segundosRodando())}</b>${hojeT.length ? ` · tarefas incompletas ${abertas}/${hojeT.length}` : ""}.<br>Se ainda vai voltar hoje, use <b>Pausar</b>.`,
    [{ txt: `Finalizar ${cliente(r.empresa_id).nome}`, cls: "red", fn: async () => { await rpc("central_sair", { p_sessao: r.id, p_modo: "finalizar" }); await carregarSessoes(); toast("Cliente finalizado"); depois(); } },
     { txt: "Voltar" }], true);
}

/* ================= tarefas ================= */
export async function carregar() {
  const id = E.aberta, c = cliente(id);
  $("#eNome").textContent = c.nome; $("#eRazao").textContent = `${c.codigo} · ${c.razao}`;
  const [linhas, ordens] = await Promise.all([
    q(sb.from("central_vw_tarefas").select("*").eq("empresa_id", id).gte("alvo", somaDias(E.hoje, -90)).lte("alvo", fimSemana(E.hoje)).order("alvo").order("titulo")),
    q(sb.from("central_vw_ordem").select("rotina_id, ordem").eq("empresa_id", id)),
    carregarAnotacoes()
  ]);
  posicao = new Map(ordens.filter((o) => o.ordem != null).map((o) => [o.rotina_id, o.ordem]));
  tarefas = linhas;
  $("#bOrdem").hidden = !pode("rotina");
  desenhar();
}

const passa = (t) => (!fMinhas || (t.responsaveis || []).includes(E.eu.id)) && (!fTipos.size || fTipos.has(t.tipo_recorrencia));
// ordem definida pelo Adm; sem ordem: diárias primeiro, depois pelo nome. Concluída fica no lugar (riscada).
const TIPO_ORD = { diaria: 1, semanal: 2, quinzenal: 3, mensal: 4, anual: 5, pontual: 6 };
const pos = (t) => posicao.get(t.rotina_empresa_id) ?? 1e6;
const ordem = (a, b) => pos(a) - pos(b) || (TIPO_ORD[a.tipo_recorrencia] || 9) - (TIPO_ORD[b.tipo_recorrencia] || 9) || a.titulo.localeCompare(b.titulo);
const pp = (id, ok) => `<span class="pp ${COR_PAPEL[papelDe(id)] || ""}">${esc(nomeDe(id))}${ok ? " ✓" : ""}</span>`;

function linha(t) {
  const feita = t.status === "concluida", minha = (t.responsaveis || []).includes(E.eu.id), pc = t.posso_concluir;
  const ck = t.checklist_total ? ` <span class="ckc">☑ ${t.checklist_marcados}/${t.checklist_total}</span>` : "";
  const venceu = t.atrasada ? `<span class="tag t-bad">${t.data_meta ? "meta venceu" : "venceu"} ${dmy(t.alvo)}</span>` : "";
  const meta = t.data_meta ? `<span class="tag t-acc">meta ${dmy(t.data_meta)} · entrega ${dmy(t.prazo)}</span>` : "";
  const criada = t.tipo_recorrencia === "pontual" && t.created_by ? `<span class="criada">criada por ${esc(nomeDe(t.created_by))}</span>` : "";
  const tempo = feita ? `${esc(nomeDe(t.concluida_por))} ${hms(t.duracao_segundos)}` : "";
  return `<li class="${feita ? "feita" : ""} ${fMinhas || minha || feita ? "" : "outra"}">
    <button type="button" class="ck ${feita ? "on" : ""} ${pc ? "" : "alheia"}" data-id="${t.id}" ${feita || !pc ? "disabled" : ""}
      title="${feita ? "Concluída" : pc ? "Concluir" : "Só os responsáveis concluem esta tarefa"}">${feita ? "✓" : ""}</button>
    <div><div class="tn" data-det="${t.id}">${esc(t.titulo)}${ck}</div>
      <div class="tmeta"><span class="tipo">${TIPO[t.tipo_recorrencia] || ""}</span>${(t.responsaveis || []).map((r) => pp(r)).join("")}${venceu}${meta}${criada}</div></div>
    <div class="tr">${tempo}</div></li>`;
}

function desenhar() {
  const atr = tarefas.filter((t) => t.atrasada && passa(t)).sort(ordem);
  const hoje = tarefas.filter((t) => t.alvo === E.hoje && passa(t)).sort(ordem);
  $("#listaAtras").innerHTML = atr.length ? `<div class="blk atr"><div class="blkhd">Atrasadas (${atr.length})</div><ul class="tasks">${atr.map(linha).join("")}</ul></div>` : "";
  $("#listaHoje").innerHTML = hoje.map(linha).join("") || `<li style="display:block;color:var(--ink3)">Nenhuma tarefa para hoje${fMinhas || fTipos.size ? " com esse filtro" : ""}.</li>`;
  const todasHoje = tarefas.filter((t) => t.alvo === E.hoje), atrasadas = tarefas.filter((t) => t.atrasada).length;
  $("#eProg").textContent = `${todasHoje.filter((t) => t.status === "concluida").length}/${todasHoje.length} concluídas hoje${atrasadas ? ` · ${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}` : ""}`;
  const dias = [...new Set(tarefas.filter((t) => t.alvo > E.hoje && passa(t)).map((t) => t.alvo))].sort();
  $("#semana").innerHTML = dias.map((d) => {
    const ts = tarefas.filter((t) => t.alvo === d && passa(t)), nd = ts.filter((t) => t.tipo_recorrencia === "diaria").length, out = ts.filter((t) => t.tipo_recorrencia !== "diaria");
    return `<div class="sem-dia"><b>${esc(diaCurto(d))}</b><div>${nd ? `<span class="zero">${nd} diária${nd > 1 ? "s" : ""}</span>` : ""}${
      out.map((t) => `<div><span class="tn" data-det="${t.id}" style="font-size:13px">${esc(t.titulo)}</span> <span class="tipo">${TIPO[t.tipo_recorrencia] || ""}</span> ${(t.responsaveis || []).map((r) => pp(r)).join(" ")}</div>`).join("")}</div></div>`;
  }).join("") || `<div class="sem-dia"><span class="zero">Sem mais tarefas nesta semana.</span></div>`;
}

async function concluirPorId(id) {
  const t = tarefas.find((x) => x.id === id); if (!t) return;
  if (t.checklist_total > t.checklist_marcados) return abrirCartao(id, "Marque todos os itens do checklist antes de concluir.");
  await concluir(t);
}

async function concluir(t) {
  try {
    const r = await rpc("central_concluir_tarefa", { p_tarefa: t.id });
    if (E.rodando) { E.rodando.base = r.tempo_ativo; E.rodando.checkpoint = r.tempo_ativo; E.rodando.em = Date.now(); }
    toast(`Concluída em ${hms(r.duracao_segundos)}`);
  } catch (e) {
    if (e.codigo === "CHECKLIST_INCOMPLETO") return abrirCartao(t.id, e.message);
    throw e;
  }
  await carregar();
  if (cartaoId === t.id) await abrirCartao(t.id);
}

$("#nLista") && $("#nLista").addEventListener("click", (ev) => {
  const li = ev.target.closest("[data-ch]"); if (li) Solic.abrir(li.dataset.ch).catch(avisoErro);
});

// solicitações em aberto deste cliente (abrir uma leva para a conversa)
async function carregarAnotacoes() {
  if ($("#nPara").options.length === 1) {
    [...E.equipe.entries()].filter(([, x]) => x.ativo).sort((a, b) => a[1].nome.localeCompare(b[1].nome))
      .forEach(([u, x]) => $("#nPara").insertAdjacentHTML("beforeend", `<option value="${u}">${esc(x.nome)}</option>`));
  }
  const chs = await Solic.doCliente(E.aberta);
  $("#nLista").innerHTML = chs.map((c) => `<li data-ch="${c.id}"><small>${Solic.tagStatus(c.status)} ${c.responsavel ? "· " + esc(nomeDe(c.responsavel)) : ""}${c.prazo ? " · prazo " + dmy(c.prazo) : ""}</small>${esc(c.titulo)}</li>`).join("")
    || '<li class="zero" style="font-size:12px">Nenhuma solicitação em aberto deste cliente.</li>';
}


/* ================= cartão da tarefa ================= */
let cartaoId = null;
// depois de mexer no cartão, atualiza a tela de onde ele foi aberto (cliente, Home ou Calendário)
const recarregar = () => (E.view === "empresa" ? carregar() : app.atualizar());
const DSEM = { 1: "segunda", 2: "terça", 3: "quarta", 4: "quinta", 5: "sexta", 6: "sábado", 7: "domingo", 0: "domingo" };
function recorrencia(t, r) {
  const g = (r && r.regra_agendamento) || {};
  if (t.tipo_recorrencia === "diaria") return "Diária · segunda a sexta";
  if (t.tipo_recorrencia === "semanal") {
    const d = g.dia_semana; const nome = typeof d === "number" ? DSEM[d] : d ? String(d).replace("-feira", "") : DSEM[new Date(t.prazo + "T12:00:00Z").getUTCDay()];
    return `Semanal · toda ${esc(nome)}`;
  }
  if (t.tipo_recorrencia === "quinzenal") return `Quinzenal · a cada 15 dias${r && r.vigencia_inicio ? " desde " + dmy(r.vigencia_inicio) : ""}`;
  if (t.tipo_recorrencia === "mensal") {
    const dias = Array.isArray(g.dias_mes) ? g.dias_mes.join(" e ") : g.dia_mes || new Date(t.prazo + "T12:00:00Z").getUTCDate();
    return `Mensal · entrega todo dia ${esc(dias)}${g.dia_meta ? " · meta dia " + esc(g.dia_meta) : ""}`;
  }
  if (t.tipo_recorrencia === "anual") return `Anual · ${esc(String(g.dia_mes || "").padStart(2, "0"))}/${esc(String(g.mes || "").padStart(2, "0"))}`;
  return `Pontual · só em ${dmy(t.prazo)}`;
}

function iniciarCartao() {
  $("#dFechar").onclick = fecharCartao;
  $("#drawer").addEventListener("change", (ev) => {
    const ck = ev.target.closest("[data-ck]");
    if (ck) return rpc("central_marcar_item", { p_item: ck.dataset.ck, p_marcado: ck.checked }).then(() => { $("#dMsg").hidden = true; return Promise.all([abrirCartao(cartaoId), recarregar()]); }).catch((e) => { avisoErro(e); abrirCartao(cartaoId); });
    const tr = ev.target.closest("[data-tr]");
    if (tr && tr.value) return rpc("central_transferir", { p_tarefa: cartaoId, p_de: tr.dataset.tr, p_para: tr.value }).then(() => { toast("Responsável transferido"); return Promise.all([abrirCartao(cartaoId), recarregar()]); }).catch((e) => { avisoErro(e); abrirCartao(cartaoId); });
    if (ev.target.id === "dMeta" || ev.target.id === "dEntrega") {
      const meta = $("#dMeta").value || null, prazo = $("#dEntrega").value;
      return rpc("central_alterar_datas", { p_tarefa: cartaoId, p_meta: meta, p_prazo: prazo }).then(() => { toast("Datas alteradas"); return Promise.all([abrirCartao(cartaoId), recarregar()]); }).catch((e) => { avisoErro(e); abrirCartao(cartaoId); });
    }
  });
  $("#dCkAdd").onsubmit = (ev) => { ev.preventDefault(); const txt = $("#dCkNovo").value.trim(); if (!txt) return;
    rpc("central_adicionar_item", { p_tarefa: cartaoId, p_texto: txt }).then(() => { $("#dCkNovo").value = ""; return Promise.all([abrirCartao(cartaoId), recarregar()]); }).catch(avisoErro); };
  $("#dObsSalvar").onclick = travar($("#dObsSalvar"), async () => {
    const txt = $("#dObsTxt").value.trim(); if (!txt) return;
    await rpc("central_comentar", { p_tarefa: cartaoId, p_texto: txt }); $("#dObsTxt").value = ""; await abrirCartao(cartaoId);
  });
}

export function fecharCartao() { cartaoId = null; $("#drawer").hidden = true; }

export async function abrirCartao(id, msg) {
  fecharSenhas();
  cartaoId = id;
  const t = await q(sb.from("central_vw_tarefas").select("*").eq("id", id).single());
  const [itens, obs, rot] = await Promise.all([
    q(sb.from("central_tarefa_checklist").select("id, ordem, texto, marcado").eq("tarefa_id", id).order("ordem")),
    q(sb.from("central_tarefa_observacoes").select("id, usuario_id, texto, created_at").eq("tarefa_id", id).order("created_at", { ascending: false })),
    t.rotina_empresa_id ? q(sb.from("central_vw_rotinas").select("frequencia, regra_agendamento, vigencia_inicio").eq("id", t.rotina_empresa_id).maybeSingle()) : null
  ]);
  if (cartaoId !== id) return;
  const feita = t.status === "concluida", pc = t.posso_concluir;
  $("#drawer").hidden = false;
  $("#dMsg").hidden = !msg; $("#dMsg").textContent = msg || "";
  $("#dNome").textContent = t.titulo;
  $("#dTags").innerHTML = `<span class="tipo">${TIPO[t.tipo_recorrencia] || ""}</span><span class="tag ${feita ? "t-ok" : t.atrasada ? "t-bad" : "t-plain"}">${feita ? "concluída" : t.atrasada ? "atrasada" : "em aberto"}</span><span class="criada">${esc(t.empresa_nome)}</span>`;

  const edita = pode("alterar_datas") && !feita && t.tipo_recorrencia !== "diaria";
  const campo = (idc, lbl, val, dica) => `<label class="dcampo"><span>${lbl}</span>${edita ? `<input type="date" id="${idc}" value="${esc(val || "")}">` : `<b>${val ? esc(diaLongo(val)) : "—"}</b>`}${val ? `<small>${esc(diaLongo(val))}</small>` : `<small>${dica}</small>`}</label>`;
  $("#dDatas").innerHTML = `<div class="lin"><span>Recorrência</span><span>${recorrencia(t, rot)}</span></div>` +
    (t.tipo_recorrencia === "diaria" ? `<div class="lin"><span>Dia</span><span>${esc(diaLongo(t.prazo))}</span></div>`
      : `<div class="dgrid">${campo("dMeta", "Data meta · pronto até", t.data_meta, "sem meta")}${campo("dEntrega", "Entrega prevista", t.prazo, "")}</div>`);

  const podeTransf = pode("transferir") && !feita;
  const candidatos = [...E.equipe.entries()].filter(([u, x]) => x.ativo && !(t.responsaveis || []).includes(u));
  $("#dResp").innerHTML = (t.responsaveis || []).map((u) => `<div class="rsp">${pp(u)}${podeTransf ? `<select data-tr="${u}"><option value="">transferir para…</option>${candidatos.map(([cu, x]) => `<option value="${cu}">${esc(x.nome)}</option>`).join("")}</select>` : ""}</div>`).join("") +
    (feita ? `<div class="st" style="margin-top:4px;font-size:12px">Concluída por <b>${esc(nomeDe(t.concluida_por))}</b> às ${esc(hhmm(t.concluida_em))} em ${hms(t.duracao_segundos)}</div>` : "");

  const marca = pc && !feita;
  $("#dCkSec").hidden = !itens.length && !marca;
  $("#dCkAdd").hidden = !marca;
  $("#dCkProg").textContent = itens.length ? `${itens.filter((i) => i.marcado).length}/${itens.length}` : "";
  $("#dCk").innerHTML = itens.map((i) => `<li class="${i.marcado ? "on" : ""}"><input type="checkbox" data-ck="${i.id}" ${i.marcado ? "checked" : ""} ${marca ? "" : "disabled"}><span>${esc(i.texto)}</span></li>`).join("");
  $("#dObs").innerHTML = obs.map((o) => `<li><small>${esc(dmy(o.created_at.slice(0, 10)))} ${esc(hhmm(o.created_at))} · ${esc(nomeDe(o.usuario_id))}</small>${esc(o.texto)}</li>`).join("");

  const falta = itens.filter((i) => !i.marcado).length;
  const naEmpresa = E.rodando && E.rodando.empresa_id === t.empresa_id;
  let pe;
  if (feita) pe = `<div class="hint" style="font-size:12px;color:var(--ink3)">Tarefa concluída.</div>${pc ? '<button class="dbtn sec" id="dReabrir" type="button" style="margin-top:8px">Reabrir tarefa</button>' : ""}`;
  else if (!pc) pe = `<div class="hint" style="font-size:12px;color:var(--ink3)">Você pode ver esta tarefa, mas só os responsáveis concluem.</div>`;
  else if (!naEmpresa) pe = `<button class="dbtn sec" id="dEntrar" type="button">Entrar em ${esc(t.empresa_nome)} para executar →</button>`;
  else pe = `<button class="dbtn" id="dConcluir" type="button" ${falta ? "disabled" : ""}>Concluir tarefa</button>${falta ? `<div class="hint" style="margin-top:6px;font-size:11.5px;color:var(--ink3)">Faltam ${falta} item(ns) do checklist.</div>` : ""}`;
  $("#dFoot").innerHTML = pe;
  if ($("#dConcluir")) $("#dConcluir").onclick = travar($("#dConcluir"), () => concluir(t));
  if ($("#dReabrir")) $("#dReabrir").onclick = () => perguntar(`Reabrir "${t.titulo}"?`, "A tarefa volta para em aberto e o tempo dela é zerado. O checklist fica como está. Fica registrado no histórico.",
    [{ txt: "Reabrir", cls: "pri", fn: async () => { await rpc("central_reabrir_tarefa", { p_tarefa: t.id }); toast("Tarefa reaberta"); await Promise.all([abrirCartao(t.id), recarregar()]); } }, { txt: "Voltar" }]);
  if ($("#dEntrar")) $("#dEntrar").onclick = () => { fecharCartao(); entrar(t.empresa_id).catch(avisoErro); };
}

/* ================= ordenar as tarefas do cliente ================= */
let listaOrdem = [];
function iniciarOrdem() {
  $("#bOrdem").onclick = () => abrirOrdem().catch(avisoErro);
  $("#oFechar").onclick = $("#oCanc").onclick = () => ($("#ordemF").hidden = true);
  $("#oLista").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mv]"); if (!b) return;
    const i = Number(b.dataset.i), j = i + Number(b.dataset.mv);
    if (j < 0 || j >= listaOrdem.length) return;
    [listaOrdem[i], listaOrdem[j]] = [listaOrdem[j], listaOrdem[i]]; desenharOrdem();
  });
  $("#oSalvar").onclick = travar($("#oSalvar"), async () => {
    await rpc("central_ordenar_rotinas", { p_empresa: E.aberta, p_rotinas: listaOrdem.map((r) => r.id) });
    $("#ordemF").hidden = true; toast("Ordem das tarefas salva"); await carregar();
  });
}
async function abrirOrdem() {
  fecharCartao(); fecharSenhas();
  const rs = await q(sb.from("central_vw_rotinas").select("id, nome, frequencia").eq("empresa_id", E.aberta).eq("situacao", "ativa"));
  listaOrdem = rs.sort((a, b) => (posicao.get(a.id) ?? 1e6) - (posicao.get(b.id) ?? 1e6) || (TIPO_ORD[a.frequencia] || 9) - (TIPO_ORD[b.frequencia] || 9) || a.nome.localeCompare(b.nome));
  $("#oEmp").textContent = cliente(E.aberta).nome;
  desenharOrdem(); $("#ordemF").hidden = false;
}
function desenharOrdem() {
  $("#oLista").innerHTML = listaOrdem.map((r, i) => `<li><span class="on">${i + 1}</span><span style="flex:1">${esc(r.nome)} <span class="tipo">${TIPO[r.frequencia] || ""}</span></span>
    <button type="button" class="mb" data-mv="-1" data-i="${i}" ${i ? "" : "disabled"} title="Subir" aria-label="Subir ${esc(r.nome)}">↑</button><button type="button" class="mb" data-mv="1" data-i="${i}" ${i < listaOrdem.length - 1 ? "" : "disabled"} title="Descer" aria-label="Descer ${esc(r.nome)}">↓</button></li>`).join("") || '<li class="zero">Este cliente não tem rotinas ativas.</li>';
}

/* ================= senhas e acessos ================= */
const visiveis = new Map();   // acesso_id → senha revelada (some depois de 30 s)
let acessos = [];

function iniciarSenhas() {
  $("#bSenhas").onclick = () => abrirSenhas().catch(avisoErro);
  $("#sFechar").onclick = fecharSenhas;
  $("#sBusca").addEventListener("input", desenharSenhas);
  $("#sNovoAbrir").onclick = () => { $("#sNovo").hidden = false; $("#nSis").focus(); };
  $("#sNovoCanc").onclick = () => { $("#sNovo").hidden = true; $("#sNovo").reset(); };
  $("#sNovo").onsubmit = (ev) => { ev.preventDefault(); travar(ev.submitter || $("#sNovo button"), async () => {
    const r = await rpc("central_salvar_acesso", { p_id: null, p_empresa: E.aberta, p_sistema: $("#nSis").value.trim(), p_tipo: $("#nTipo").value,
      p_link: $("#nLink").value.trim() || null, p_usuario: $("#nUsu").value.trim() || null, p_senha: $("#nSen").value || null, p_observacoes: $("#nObs").value.trim() || null });
    $("#sNovo").reset(); $("#sNovo").hidden = true;
    toast(r && r.status === "pedido" ? "Pedido registrado para o Adm" : "Acesso salvo");
    await abrirSenhas();
  })(); };
  $("#sLista").addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]"); if (!el) return;
    const a = acessos.find((x) => x.id === el.closest("[data-acc]").dataset.acc); if (!a) return;
    acaoAcesso(a, el.dataset.act, ev).catch(avisoErro);
  });
}

export function fecharSenhas() { $("#senhas").hidden = true; $("#sNovo").hidden = true; visiveis.clear(); }

async function abrirSenhas() {
  fecharCartao();
  $("#senhas").hidden = false; $("#sEmp").textContent = cliente(E.aberta).nome;
  acessos = await q(sb.from("central_acessos").select("id, sistema, tipo, link, usuario_login, observacoes, alterada_em").eq("empresa_id", E.aberta).eq("ativo", true).order("tipo").order("sistema"));
  desenharSenhas();
}

function desenharSenhas() {
  const busca = $("#sBusca").value.trim().toLowerCase();
  const lista = acessos.filter((a) => !busca || `${a.sistema} ${a.tipo} ${a.usuario_login || ""} ${a.observacoes || ""}`.toLowerCase().includes(busca));
  $("#sLista").innerHTML = lista.map((a) => {
    const link = linkSeguro(a.link), sen = visiveis.get(a.id);
    return `<div class="acc" data-acc="${a.id}">
      <div class="ah"><span class="tipo">${esc(a.tipo)}</span><b>${esc(a.sistema)}</b>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-act="link">Abrir ↗</a>` : ""}</div>
      ${a.usuario_login ? `<div class="cp"><span>Usuário</span><code>${esc(a.usuario_login)}</code><span></span><button type="button" data-act="cu">Copiar</button></div>` : ""}
      <div class="cp"><span>Senha</span>${sen !== undefined ? `<pre class="sen">${esc(sen ?? "(sem senha)")}</pre>` : "<code>••••••••••</code>"}<button type="button" data-act="ver">${sen !== undefined ? "Ocultar" : "Mostrar"}</button><button type="button" data-act="cs">Copiar</button></div>
      ${a.observacoes ? `<div class="ob">${esc(a.observacoes)}</div>` : ""}
    </div>`;
  }).join("") || '<div class="dsec zero">Nenhum acesso cadastrado para este cliente.</div>';
}

async function acaoAcesso(a, act) {
  if (act === "link") { await rpc("central_registrar_acesso", { p_acesso: a.id, p_acao: "abriu o link" }); return; }
  if (act === "cu") { await copiar(a.usuario_login || ""); await rpc("central_registrar_acesso", { p_acesso: a.id, p_acao: "copiou o usuário" }); return; }
  if (act === "cs") { const s = await rpc("central_revelar_senha", { p_acesso: a.id, p_motivo: "copiou" }); await copiar(s || ""); return; }
  if (act === "ver") {
    if (visiveis.has(a.id)) { visiveis.delete(a.id); return desenharSenhas(); }
    const s = await rpc("central_revelar_senha", { p_acesso: a.id, p_motivo: "visualizou" });
    visiveis.set(a.id, s);
    desenharSenhas();
    setTimeout(() => { if (visiveis.delete(a.id)) desenharSenhas(); }, 30000);   // some sozinha em 30 s
  }
}

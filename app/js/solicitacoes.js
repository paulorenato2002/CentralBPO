// Solicitações: chamados entre colaboradores (estilo Onvio). Cada um tem cliente, responsável, status,
// prazo e uma conversa enxuta com todo o andamento. Grava só pelas funções central_*_chamado.
import { sb, rpc, q, todas } from "./api.js";
import { E, nomeDe, papelDe, cliente } from "./estado.js";
import { $, esc, dmy, hhmm, COR_PAPEL, toast, avisoErro, perguntar, travar } from "./ui.js";

export const STATUS = {
  aberto: ["Aberto", "t-warn"], iniciado: ["Iniciado", "t-acc"], em_progresso: ["Em progresso", "t-acc"],
  impedimento: ["Impedimento", "t-bad"], finalizado: ["Finalizado", "t-ok"], desconsiderado: ["Desconsiderado", "t-plain"]
};
export const ABERTOS = ["aberto", "iniciado", "em_progresso", "impedimento"];
const pp = (id) => (id ? `<span class="pp ${COR_PAPEL[papelDe(id)] || ""}">${esc(nomeDe(id))}</span>` : '<span class="zero">sem responsável</span>');
export const tagStatus = (s) => { const [t, c] = STATUS[s] || [s, "t-plain"]; return `<span class="tag ${c}">${esc(t)}</span>`; };
const quando = (ts) => { const d = ts.slice(0, 10); return d === E.hoje ? `hoje ${hhmm(ts)}` : `${dmy(d)} ${hhmm(ts)}`; };

let app = null, filtro = "abertos", lista = [], aberto = null;
export function iniciar(a) {
  app = a;
  $("#soSit").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; filtro = b.dataset.v;
    document.querySelectorAll("#soSit button").forEach((x) => x.classList.toggle("on", x === b)); desenhar(false).catch(avisoErro); });
  ["#soEmp", "#soResp"].forEach((s) => $(s).addEventListener("change", () => desenhar(false).catch(avisoErro)));
  $("#soQ").addEventListener("input", () => desenhar(false).catch(avisoErro));
  $("#soNovo").onclick = () => novo(null);
  $("#soRows").addEventListener("click", (ev) => { const tr = ev.target.closest("[data-ch]"); if (tr) abrir(tr.dataset.ch).catch(avisoErro); });
  $("#chFechar").onclick = fechar;
  $("#chStatus").addEventListener("change", () => {
    const s = $("#chStatus").value; if (!aberto || s === aberto.status) return;
    const precisa = s === "impedimento";
    const texto = $("#chTexto").value.trim();
    if (precisa && !texto) { $("#chStatus").value = aberto.status; return toast("Escreva o motivo do impedimento na caixa de mensagem e escolha de novo."); }
    rpc("central_status_chamado", { p_id: aberto.id, p_status: s, p_texto: texto || null })
      .then(() => { $("#chTexto").value = ""; toast(`Status: ${STATUS[s][0]}`); return Promise.all([abrir(aberto.id), desenhar()]); }).catch((e) => { avisoErro(e); abrir(aberto.id); });
  });
  $("#chResp").addEventListener("change", () => {
    const p = $("#chResp").value; if (!aberto || !p || p === aberto.responsavel) return;
    rpc("central_transferir_chamado", { p_id: aberto.id, p_para: p, p_texto: $("#chTexto").value.trim() || null })
      .then(() => { $("#chTexto").value = ""; toast(`Passou para ${nomeDe(p)}`); return Promise.all([abrir(aberto.id), desenhar()]); }).catch((e) => { avisoErro(e); abrir(aberto.id); });
  });
  $("#chPrazo").addEventListener("change", () => {
    if (!aberto) return;
    rpc("central_prazo_chamado", { p_id: aberto.id, p_prazo: $("#chPrazo").value || null })
      .then(() => Promise.all([abrir(aberto.id), desenhar()])).catch((e) => { avisoErro(e); abrir(aberto.id); });
  });
  $("#chForm").onsubmit = (ev) => { ev.preventDefault(); travar($("#chEnviar"), async () => {
    const t = $("#chTexto").value.trim(); if (!t || !aberto) return;
    await rpc("central_comentar_chamado", { p_id: aberto.id, p_texto: t });
    $("#chTexto").value = ""; await Promise.all([abrir(aberto.id), desenhar()]);
  })(); };
  // nova solicitação
  $("#nsFechar").onclick = $("#nsCanc").onclick = () => ($("#novoCh").hidden = true);
  $("#nsForm").onsubmit = (ev) => { ev.preventDefault(); travar($("#nsSalvar"), async () => {
    const f = $("#nsForm").elements, titulo = f.titulo.value.trim();
    if (!titulo) return;
    const id = await rpc("central_abrir_chamado", { p_empresa: f.empresa.value || null, p_titulo: titulo, p_texto: f.texto.value.trim() || null,
      p_responsavel: f.resp.value || null, p_prazo: f.prazo.value || null });
    $("#novoCh").hidden = true; $("#nsForm").reset(); toast("Solicitação aberta");
    await desenhar(); if (app && app.depoisDeAbrir) await app.depoisDeAbrir(); await abrir(id);
  })(); };
}

export function fechar() { aberto = null; $("#chamadoF").hidden = true; $("#novoCh").hidden = true; }

const opcEquipe = (sel, vazio) => `<option value="">${vazio}</option>` + [...E.equipe.entries()].filter(([, x]) => x.ativo)
  .sort((a, b) => a[1].nome.localeCompare(b[1].nome)).map(([u, x]) => `<option value="${u}" ${u === sel ? "selected" : ""}>${esc(x.nome)}</option>`).join("");
const opcClientes = (sel, vazio) => `<option value="">${vazio}</option>` + E.clientes.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.codigo)} · ${esc(c.nome)}</option>`).join("");

// abre o formulário de nova solicitação (empresa já escolhida quando vem da tela do cliente)
export function novo(empresaId) {
  if (app && app.fecharOutras) app.fecharOutras();
  fechar();
  const f = $("#nsForm").elements; $("#nsForm").reset();
  f.empresa.innerHTML = opcClientes(empresaId || "", "Interna (sem cliente)");
  f.resp.innerHTML = opcEquipe("", "Escolha quem resolve…");
  $("#novoCh").hidden = false; f.titulo.focus();
}

export async function desenhar(recarregar = true) {
  if ($("#soEmp").options.length === 1) {
    $("#soEmp").innerHTML = opcClientes("", "Todos os clientes");
    $("#soResp").innerHTML = `<option value="">Todos os responsáveis</option><option value="eu">Comigo</option>` + opcEquipe("", "—").replace('<option value="">—</option>', "");
  }
  if (recarregar) lista = await todas(() => sb.from("central_vw_chamados").select("*").order("updated_at", { ascending: false }).order("id"));
  const fe = $("#soEmp").value, fr = $("#soResp").value === "eu" ? E.eu.id : $("#soResp").value, busca = $("#soQ").value.trim().toLowerCase();
  const vis = lista.filter((c) => (filtro === "todos" || (filtro === "abertos" ? ABERTOS.includes(c.status) : !ABERTOS.includes(c.status))) &&
    (!fe || c.empresa_id === fe) && (!fr || c.responsavel === fr) && (!busca || `${c.titulo} ${c.empresa_nome || ""}`.toLowerCase().includes(busca)));
  const meus = lista.filter((c) => c.responsavel === E.eu.id && ABERTOS.includes(c.status)).length;
  const conta = $("#navSolic"); if (conta) { conta.textContent = meus || ""; conta.hidden = !meus; }
  $("#soCount").textContent = `${vis.length} solicitaç${vis.length === 1 ? "ão" : "ões"}`;
  $("#soRows").innerHTML = vis.map((c) => {
    const atrasada = c.prazo && c.prazo < E.hoje && ABERTOS.includes(c.status);
    return `<tr data-ch="${c.id}">
      <td>${tagStatus(c.status)}</td>
      <td><b>${esc(c.titulo)}</b><div class="zero" style="font-size:11.5px">aberta por ${esc(nomeDe(c.criado_por))} · ${esc(quando(c.created_at))}${c.comentarios ? ` · ${c.comentarios} mensage${c.comentarios == 1 ? "m" : "ns"}` : ""}</div></td>
      <td>${c.empresa_id ? `<span class="cli-chip">${esc(c.empresa_codigo)} ${esc(c.empresa_nome)}</span>` : '<span class="zero">interna</span>'}</td>
      <td>${pp(c.responsavel)}</td>
      <td class="${atrasada ? "velha" : ""}">${c.prazo ? dmy(c.prazo) : '<span class="zero">—</span>'}</td>
      <td style="font-size:12px;color:var(--ink3)">${esc(quando(c.ultima_atividade || c.updated_at))}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="zero" style="text-align:center;padding:20px">${filtro === "abertos" ? "Nenhuma solicitação em aberto." : "Nenhuma solicitação."}</td></tr>`;
}

// gaveta da solicitação: cabeçalho com status/responsável/prazo + conversa
export async function abrir(id) {
  if (app && app.fecharOutras) app.fecharOutras();
  $("#novoCh").hidden = true;
  const [c, evs] = await Promise.all([
    q(sb.from("central_vw_chamados").select("*").eq("id", id).single()),
    q(sb.from("central_chamado_eventos").select("*").eq("chamado_id", id).order("created_at").order("id"))
  ]);
  aberto = c;
  $("#chTit").textContent = c.titulo;
  $("#chSub").innerHTML = `${tagStatus(c.status)}<span class="criada">${c.empresa_id ? `${esc(c.empresa_codigo)} · ${esc(c.empresa_nome)}` : "interna"} · aberta por ${esc(nomeDe(c.criado_por))} em ${dmy(c.created_at.slice(0, 10))}</span>`;
  $("#chStatus").innerHTML = Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${t}</option>`).join("");
  $("#chResp").innerHTML = opcEquipe(c.responsavel || "", "sem responsável");
  $("#chPrazo").value = c.prazo || "";
  const linha = (e) => {
    const quem = esc(nomeDe(e.usuario_id)), q2 = esc(quando(e.created_at));
    if (e.tipo === "comentou" || (e.tipo === "abriu" && e.texto)) return `<li class="msg ${e.usuario_id === E.eu.id ? "minha" : ""}"><small>${quem} · ${q2}${e.tipo === "abriu" ? " · abriu" : ""}</small><div>${esc(e.texto)}</div></li>`;
    const acao = e.tipo === "abriu" ? `abriu a solicitação${e.para ? ` para ${esc(e.para)}` : ""}`
      : e.tipo === "status" ? `mudou de <b>${esc((STATUS[e.de] || [e.de])[0])}</b> para <b>${esc((STATUS[e.para] || [e.para])[0])}</b>`
      : e.tipo === "transferiu" ? `passou de ${esc(e.de || "ninguém")} para <b>${esc(e.para)}</b>`
      : `mudou o prazo de ${esc(e.de || "—")} para ${esc(e.para || "—")}`;
    return `<li class="sis"><small>${q2}</small> ${quem} ${acao}${e.texto ? `<div class="msg-ob">${esc(e.texto)}</div>` : ""}</li>`;
  };
  $("#chConversa").innerHTML = evs.map(linha).join("");
  $("#chamadoF").hidden = false;
  const box = $("#chConversa"); box.scrollTop = box.scrollHeight;
}

// lista curta para a tela do cliente: as em aberto daquele cliente
export async function doCliente(empresaId) {
  return q(sb.from("central_vw_chamados").select("id, titulo, status, responsavel, prazo, updated_at").eq("empresa_id", empresaId)
    .in("status", ABERTOS).order("updated_at", { ascending: false }).limit(20));
}
void todas;

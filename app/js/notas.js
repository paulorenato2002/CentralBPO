// Cadastros › Informações, Datas e Contatos: cartões por cliente (ou gerais da Effective), estilo Google Keep.
// Lê central_notas_cliente (RLS: só clientes que a pessoa vê); grava só por central_salvar_nota / central_excluir_nota.
import { sb, rpc, todas } from "./api.js";
import { E, cliente } from "./estado.js";
import * as Anx from "./anexos.js";
import { $, esc, somaDias, toast, avisoErro, perguntar, copiar } from "./ui.js";

export const VIEWS = { cadinfo: ["info", "Informações cadastrais"], caddatas: ["data", "Datas e lembretes"], cadcont: ["contato", "Contatos"] };
export const eh = (v) => v in VIEWS;
const NOVO = { info: "+ Nova informação", data: "+ Nova data", contato: "+ Novo contato" };
let tipo = "info", notas = [], aberta = null, pronto = false, anxN = new Map();

// próxima ocorrência de uma data que repete todo mês (ex.: fechamento do cartão dia 12)
function proxima(n) {
  if (!n.data) return null;
  if ((n.dados || {}).repete !== "mensal") return n.data;
  const dia = Number(n.data.slice(8, 10)), h = E.hoje;
  let [a, m] = [Number(h.slice(0, 4)), Number(h.slice(5, 7))];
  for (let i = 0; i < 2; i++) {
    const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const iso = `${a}-${String(m).padStart(2, "0")}-${String(Math.min(dia, ult)).padStart(2, "0")}`;
    if (iso >= h) return iso;
    m++; if (m > 12) { m = 1; a++; }
  }
  return n.data;
}
const faltam = (iso) => { const d = Math.round((new Date(iso + "T12:00:00Z") - new Date(E.hoje + "T12:00:00Z")) / 864e5);
  return d === 0 ? ["hoje", "hj"] : d === 1 ? ["amanhã", "hj"] : d > 1 ? [`em ${d} dias`, d <= 7 ? "pr" : ""] : [`há ${-d} dias`, "pas"]; };
const nomeCli = (id) => (id ? `${cliente(id).codigo} · ${cliente(id).nome}` : "Effective (geral)");

function preparar() {
  if (pronto) return; pronto = true;
  const ops = '<option value="">Todos</option><option value="geral">Effective (geral)</option>' +
    E.clientes.map((c) => `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`).join("");
  $("#ntEmp").innerHTML = ops;
  $("#ntFEmp").innerHTML = '<option value="">Effective (geral)</option>' + E.clientes.map((c) => `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`).join("");
  $("#ntEmp").addEventListener("change", () => desenharLista());
  $("#ntQ").addEventListener("input", () => desenharLista());
  $("#ntNovo").onclick = () => abrir(null);
  $("#ntFechar").onclick = $("#ntCanc").onclick = fechar;
  $("#ntForm").onsubmit = (ev) => { ev.preventDefault(); salvar().catch(avisoErro); };
  $("#ntExcluir").onclick = () => aberta && perguntar(`Excluir "${aberta.titulo}"?`, "Some da lista. Fica registrado no histórico.",
    [{ txt: "Excluir", cls: "red", fn: async () => { await rpc("central_excluir_nota", { p_id: aberta.id }); toast("Excluído"); fechar(); await desenhar(); } }, { txt: "Voltar" }], true);
  $("#ntArea").addEventListener("click", (ev) => {
    const cp = ev.target.closest("[data-copiar]"); if (cp) { ev.stopPropagation(); return copiar(cp.dataset.copiar).then(() => toast("Copiado")); }
    if (ev.target.closest("a")) return;
    const c = ev.target.closest("[data-nota]"); if (c) abrir(notas.find((n) => n.id === c.dataset.nota));
  });
}

export async function desenhar(view) {
  if (view) tipo = VIEWS[view][0];
  preparar();
  $("#ntNovo").textContent = NOVO[tipo];
  $("#ntQ").placeholder = tipo === "contato" ? "Buscar nome, cargo, telefone…" : "Buscar…";
  [notas, anxN] = await Promise.all([todas(() => sb.from("central_notas_cliente").select("id, empresa_id, tipo, titulo, texto, data, dados, updated_at").eq("tipo", tipo).order("id")),
    Anx.contar("nota")]);
  desenharLista();
}

function desenharLista() {
  const fe = $("#ntEmp").value, q = $("#ntQ").value.trim().toLowerCase();
  let vis = notas.filter((n) => (!fe || (fe === "geral" ? !n.empresa_id : n.empresa_id === fe)) &&
    (!q || `${n.titulo} ${n.texto || ""} ${Object.values(n.dados || {}).join(" ")} ${nomeCli(n.empresa_id)}`.toLowerCase().includes(q)));
  if (tipo === "data") vis = vis.map((n) => ({ ...n, prox: proxima(n) })).sort((a, b) => (a.prox < E.hoje) - (b.prox < E.hoje) || a.prox.localeCompare(b.prox));
  else vis.sort((a, b) => nomeCli(a.empresa_id).localeCompare(nomeCli(b.empresa_id)) || a.titulo.localeCompare(b.titulo));
  const cli = (n) => `<span class="ntcli">${esc(nomeCli(n.empresa_id))}</span>`;
  const cartao = (n) => {
    if (tipo === "data") { const [txt, cls] = faltam(n.prox);
      return `<div class="ntc nd ${cls}" data-nota="${n.id}"><div class="ntdia"><b>${n.prox.slice(8, 10)}/${n.prox.slice(5, 7)}</b><span>${txt}</span></div>
        <div><b>${esc(n.titulo)}</b>${Anx.clipe(anxN.get(n.id))}${cli(n)}${(n.dados || {}).repete === "mensal" ? '<span class="ntrep">todo mês</span>' : ""}${n.texto ? `<p>${esc(n.texto)}</p>` : ""}</div></div>`; }
    if (tipo === "contato") { const d = n.dados || {}, tel = String(d.telefone || "").replace(/\D/g, "");
      return `<div class="ntc" data-nota="${n.id}"><b>${esc(n.titulo)}</b>${Anx.clipe(anxN.get(n.id))}${d.cargo ? `<small>${esc(d.cargo)}</small>` : ""}${cli(n)}
        ${d.telefone ? `<div class="ntl"><a href="https://wa.me/${tel.length <= 11 ? "55" + tel : tel}" target="_blank" rel="noopener noreferrer">${esc(d.telefone)}</a><button type="button" class="mb" data-copiar="${esc(d.telefone)}">copiar</button></div>` : ""}
        ${d.email ? `<div class="ntl"><a href="mailto:${esc(d.email)}">${esc(d.email)}</a><button type="button" class="mb" data-copiar="${esc(d.email)}">copiar</button></div>` : ""}
        ${n.texto ? `<p>${esc(n.texto)}</p>` : ""}</div>`; }
    return `<div class="ntc" data-nota="${n.id}"><b>${esc(n.titulo)}</b>${Anx.clipe(anxN.get(n.id))}${cli(n)}${n.texto ? `<p>${esc(n.texto)}</p>` : ""}
      ${n.texto && n.texto.length < 200 ? `<div class="ntl"><button type="button" class="mb" data-copiar="${esc(n.texto)}">copiar</button></div>` : ""}</div>`;
  };
  $("#ntArea").innerHTML = vis.length ? `<div class="ntgrade">${vis.map(cartao).join("")}</div>`
    : `<div class="zero" style="padding:24px">Nada cadastrado${fe || q ? " com esse filtro" : ""}. Use "${NOVO[tipo]}".</div>`;
}

function abrir(n) {
  aberta = n || null;
  const f = $("#ntForm"); f.reset();
  $("#ntTit").textContent = n ? n.titulo : NOVO[tipo].replace("+ ", "");
  $("#ntExcluir").hidden = !n;
  document.querySelectorAll("#ntForm [data-so]").forEach((el) => (el.hidden = !el.dataset.so.split(" ").includes(tipo)));
  $("#ntRotTit").firstChild.textContent = tipo === "contato" ? "Nome" : tipo === "data" ? "O que é" : "Informação";
  f.data.required = tipo === "data";
  const fe = $("#ntEmp").value;
  f.empresa.value = n ? n.empresa_id || "" : fe && fe !== "geral" ? fe : "";
  if (n) {
    f.titulo.value = n.titulo; f.texto.value = n.texto || ""; f.data.value = n.data || "";
    const d = n.dados || {}; f.cargo.value = d.cargo || ""; f.telefone.value = d.telefone || ""; f.email.value = d.email || ""; f.repete.checked = d.repete === "mensal";
  } else if (tipo === "data") f.data.value = somaDias(E.hoje, 0);
  $("#ntMsg").hidden = true;
  Anx.abrir("#ntAnx", "nota", n ? n.id : null).catch(avisoErro);
  $("#notaF").hidden = false; f.titulo.focus();
}

async function salvar() {
  const f = $("#ntForm");
  const dados = tipo === "contato" ? { cargo: f.cargo.value.trim(), telefone: f.telefone.value.trim(), email: f.email.value.trim() }
    : tipo === "data" ? (f.repete.checked ? { repete: "mensal" } : {}) : {};
  Object.keys(dados).forEach((k) => !dados[k] && delete dados[k]);
  let id;
  try {
    id = await rpc("central_salvar_nota", { p_id: aberta ? aberta.id : null, p_empresa: f.empresa.value || null, p_tipo: tipo, p_titulo: f.titulo.value,
      p_texto: f.texto.value, p_data: tipo === "data" ? f.data.value || null : null, p_dados: dados });
  } catch (e) { $("#ntMsg").textContent = e.message; $("#ntMsg").hidden = false; return; }
  await Anx.enviarFila("#ntAnx", id);
  toast("Salvo"); fechar(); await desenhar();
}

export function fechar() { $("#notaF").hidden = true; aberta = null; }

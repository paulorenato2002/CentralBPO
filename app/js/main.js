// Entrada do app: login, contexto da pessoa, navegação, lista de clientes e histórico.
import { sb, q, rpc } from "./api.js";
import { E, cliente, nomeDe, segundosRodando } from "./estado.js";
import { $, esc, hms, hojeISO, dataHora, PAPEL, toast, avisoErro, travar } from "./ui.js";
import * as Emp from "./empresa.js";

/* ================= tema e tamanho do texto (preferência deste navegador) ================= */
function preferencia(chave, padrao) { try { return localStorage.getItem(chave) ?? padrao; } catch { return padrao; } }
function guardar(chave, v) { try { localStorage.setItem(chave, v); } catch { /* sem armazenamento: segue sem lembrar */ } }
function aplicarTema(t) {
  if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
  document.querySelectorAll("#tema button").forEach((b) => b.classList.toggle("on", b.dataset.t === t)); guardar("central-tema", t);
}
function aplicarZoom(z) {
  document.documentElement.style.setProperty("--zoom", z);
  document.querySelectorAll("#fonte button").forEach((b) => b.classList.toggle("on", b.dataset.z === String(z))); guardar("central-zoom", z);
}
aplicarTema(preferencia("central-tema", "")); aplicarZoom(preferencia("central-zoom", "1.15"));
$("#tema").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) aplicarTema(b.dataset.t); });
$("#fonte").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) aplicarZoom(b.dataset.z); });

/* ================= telas ================= */
function mostrar(qual) {
  $("#telaCarregando").hidden = qual !== "carregando";
  $("#telaLogin").hidden = qual !== "login";
  const app = qual === "app";
  ["#lateral", "#topo", "#principal"].forEach((s) => ($(s).hidden = !app));
  document.body.classList.toggle("app-off", !app);
}

const TITULOS = { clientes: "Tarefas", historico: "Histórico de atividade" };
async function ir(view, id) {
  if (view !== "empresa") { Emp.fecharCartao(); Emp.fecharSenhas(); }
  E.view = view; if (id) E.aberta = id;
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.id === "v-" + view));
  document.querySelectorAll("aside a[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === (view === "empresa" ? "clientes" : view)));
  $("#titulo").textContent = view === "empresa" ? "Tarefas / " + cliente(E.aberta).nome : TITULOS[view] || "";
  try {
    if (view === "clientes") await desenharClientes();
    if (view === "empresa") await Emp.carregar();
    if (view === "historico") await desenharHistorico();
  } catch (e) { avisoErro(e); }
  Emp.topo();
}

document.querySelectorAll("aside a[data-view]").forEach((a) => a.addEventListener("click", (ev) => {
  ev.preventDefault(); if (a.classList.contains("off")) return;
  if (E.view === "empresa" && E.rodando) return Emp.sairPara(a.dataset.view);
  ir(a.dataset.view);
}));

/* ================= login ================= */
$("#fLogin").onsubmit = async (ev) => {
  ev.preventDefault();
  const b = $("#lEntrar"); b.disabled = true; $("#lErro").textContent = "";
  try {
    const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lSenha").value });
    if (error) { $("#lErro").textContent = "E-mail ou senha incorretos."; return; }   // não diz qual dos dois
    $("#lSenha").value = "";
    await abrirApp();
  } catch (e) { $("#lErro").textContent = e.message || "Não deu para entrar."; }
  finally { b.disabled = false; }
};
$("#bSair").onclick = async () => {
  if (E.rodando) return toast("Pause ou finalize o cliente antes de sair do sistema.");
  await sb.auth.signOut(); location.reload();
};

async function abrirApp() {
  mostrar("carregando");
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return mostrar("login");
  E.hoje = hojeISO();
  const [eu, colabs, perfis] = await Promise.all([
    q(sb.from("central_colaboradores").select("usuario_id, papel_central, ativo").eq("usuario_id", user.id).maybeSingle()),
    q(sb.from("central_colaboradores").select("usuario_id, papel_central, ativo")),
    q(sb.from("perfis_usuarios").select("usuario_id, nome"))
  ]).catch((e) => { avisoErro(e); return [null, [], []]; });
  if (!eu || !eu.ativo) {
    await sb.auth.signOut(); mostrar("login");
    $("#lErro").textContent = "Seu usuário não tem acesso ativo à Central. Fale com o administrador."; return;
  }
  const nomes = new Map(perfis.map((p) => [p.usuario_id, p.nome]));
  E.equipe = new Map(colabs.map((c) => [c.usuario_id, { nome: nomes.get(c.usuario_id) || "—", papel: c.papel_central, ativo: c.ativo }]));
  E.eu = { id: user.id, nome: nomes.get(user.id) || user.email, email: user.email, papel: eu.papel_central };
  const perm = await q(sb.from("central_permissoes").select("acao, valor").eq("papel_central", eu.papel_central));
  E.perm = Object.fromEntries(perm.map((p) => [p.acao, p.valor]));
  await carregarClientes();
  $("#eu").textContent = E.eu.nome; $("#papel").textContent = PAPEL[E.eu.papel] || E.eu.papel;
  $("#hoje").textContent = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  mostrar("app");
  await Emp.carregarSessoes();
  ir(E.rodando ? "empresa" : "clientes", E.rodando ? E.rodando.empresa_id : null);
}

async function carregarClientes() {
  const [emps, cc] = await Promise.all([
    q(sb.from("empresas").select("id, codigo, nome_fantasia, razao_social").order("codigo")),
    q(sb.from("central_clientes").select("empresa_id, situacao, prioridade"))
  ]);
  const info = new Map(cc.map((c) => [c.empresa_id, c]));
  E.clientes = emps.map((e) => ({ id: e.id, codigo: e.codigo, nome: e.nome_fantasia || e.razao_social, razao: e.razao_social,
    situacao: (info.get(e.id) || {}).situacao || "ativa", prioridade: (info.get(e.id) || {}).prioridade || "normal" }))
    .filter((c) => c.situacao !== "encerrada");
}

/* ================= lista de clientes ================= */
let fSit = "";
$("#segSit").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; fSit = b.dataset.v;
  document.querySelectorAll("#segSit button").forEach((x) => x.classList.toggle("on", x === b)); desenharClientes().catch(avisoErro); });
$("#q").addEventListener("input", () => desenharClientes().catch(avisoErro));
$("#rows").addEventListener("click", (ev) => { const tr = ev.target.closest("tr[data-cod]"); if (tr) Emp.entrar(tr.dataset.cod).catch(avisoErro); });

let painel = new Map();
async function desenharClientes() {
  const linhas = await rpc("central_painel", { p_de: E.hoje, p_ate: E.hoje, p_so_minhas: false });
  painel = new Map(linhas.map((l) => [l.empresa_id, l]));
  const busca = $("#q").value.trim().toLowerCase();
  const lista = E.clientes.map((c) => {
    const p = painel.get(c.id) || { atrasadas: 0, hoje: 0, concluidas: 0 };
    const total = Number(p.hoje) + Number(p.concluidas), feitas = Number(p.concluidas), atr = Number(p.atrasadas);
    const sit = atr ? "atrasada" : feitas >= total ? "concluida" : "aberto";
    return { ...c, total, feitas, atr, sit };
  }).filter((c) => (!fSit || (fSit === "aberto" ? c.sit !== "concluida" : c.sit === fSit)) && (!busca || `${c.nome} ${c.razao} ${c.codigo}`.toLowerCase().includes(busca)))
    .sort((a, b) => ({ atrasada: 0, aberto: 1, concluida: 2 }[a.sit] - { atrasada: 0, aberto: 1, concluida: 2 }[b.sit]) || String(a.codigo).localeCompare(String(b.codigo)));
  const todos = E.clientes.map((c) => painel.get(c.id) || { atrasadas: 0, hoje: 0, concluidas: 0 });
  const atrT = todos.reduce((a, p) => a + Number(p.atrasadas), 0);
  $("#counts").innerHTML = `<div><b>${todos.reduce((a, p) => a + Number(p.hoje), 0)}</b><span>tarefas em aberto hoje</span></div>
    <div class="${atrT ? "bad" : ""}"><b>${atrT}</b><span>atrasadas</span></div>
    <div><b>${lista.filter((c) => c.sit !== "concluida").length}</b><span>clientes em aberto</span></div>
    <div><b>${lista.filter((c) => c.sit === "concluida").length}</b><span>clientes concluídos</span></div>`;
  const COR = { atrasada: "var(--bad)", aberto: "var(--warn)", concluida: "var(--ok)" };
  const run = E.rodando;
  $("#rows").innerHTML = lista.map((c) => {
    const s = E.sessoesHoje.get(c.id);
    const minha = s ? `<div class="zero" style="font-size:11.5px;margin-top:2px">${s.estado === "finalizada" ? "você finalizou" : s.estado === "rodando" ? "rodando" : s.estado === "fechada" ? "fechada" : "pausada"} · ${hms(s.estado === "rodando" && run && run.empresa_id === c.id ? segundosRodando() : s.tempo)}</div>` : "";
    return `<tr data-cod="${c.id}" class="${run && run.empresa_id === c.id ? "aberta" : ""}">
      <td><span class="sem" style="background:${COR[c.sit]}"></span></td>
      <td class="emp"><b>${esc(c.nome)}</b><small>${esc(c.codigo)} · ${esc(c.razao)}</small></td>
      <td class="n ${c.total ? "" : "zero"}">${c.feitas}/${c.total}</td>
      <td class="n">${c.atr ? `<span class="tag t-bad">${c.atr}</span>` : '<span class="zero">0</span>'}</td>
      <td>${!c.total && !c.atr ? '<span class="tag">Sem tarefas hoje</span>' : `<span class="tag ${c.sit === "concluida" ? "t-ok" : c.sit === "atrasada" ? "t-bad" : "t-warn"}">${c.sit === "concluida" ? "Concluída" : "Em aberto"}</span>`}${minha}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="zero" style="text-align:center;padding:20px">Nenhum cliente${E.clientes.length ? " com esse filtro" : " vinculado a você. Fale com o administrador."}</td></tr>`;
}

/* ================= histórico ================= */
["#hUser", "#hEmp", "#hData"].forEach((s) => $(s).addEventListener("change", () => desenharHistorico().catch(avisoErro)));
async function desenharHistorico() {
  if ($("#hUser").options.length === 1) {
    [...E.equipe.entries()].forEach(([u, x]) => $("#hUser").insertAdjacentHTML("beforeend", `<option value="${u}">${esc(x.nome)}</option>`));
    E.clientes.forEach((c) => $("#hEmp").insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`));
  }
  let cons = sb.from("central_vw_historico").select("id, created_at, usuario_id, usuario_nome, empresa_id, empresa_codigo, empresa_nome, descricao, tempo_ativo_segundos")
    .order("created_at", { ascending: false }).limit(300);
  if ($("#hUser").value) cons = cons.eq("usuario_id", $("#hUser").value);
  if ($("#hEmp").value) cons = cons.eq("empresa_id", $("#hEmp").value);
  if ($("#hData").value) { const d = $("#hData").value; cons = cons.gte("created_at", `${d}T00:00:00-03:00`).lte("created_at", `${d}T23:59:59.999-03:00`); }
  const regs = await q(cons);
  $("#hCount").textContent = `${regs.length} registros${regs.length === 300 ? " (os 300 mais recentes)" : ""}`;
  $("#regs").innerHTML = regs.map((r) => {
    const [data, hora] = dataHora(r.created_at).split(", ");
    return `<li><span class="d">${esc(data)}</span><span class="d">${esc(hora)}</span><span class="c">${r.tempo_ativo_segundos != null ? hms(r.tempo_ativo_segundos) : "—"}</span>
      <span>${esc(r.usuario_nome || "sistema")}</span><span class="e">${r.empresa_codigo ? esc(r.empresa_codigo + "-" + String(r.empresa_nome || "").toUpperCase()) : "—"}</span><span class="tar">${esc(r.descricao)}</span></li>`;
  }).join("") || '<li class="vazio">Nenhum registro.</li>';
}

/* ================= início ================= */
Emp.iniciar({ ir });
sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") mostrar("login"); });
abrirApp().catch((e) => { avisoErro(e); mostrar("login"); });
void nomeDe; void travar;

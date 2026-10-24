// Entrada do app: login, contexto da pessoa, navegação, lista de clientes e histórico.
import * as Prev from "./previas.js";
import { sb, q, rpc, retornoDoLink } from "./api.js";
import { E, cliente, nomeDe, segundosRodando } from "./estado.js";
import { $, esc, hms, hojeISO, dataHora, PAPEL, toast, avisoErro, travar } from "./ui.js";
import * as Emp from "./empresa.js";
import * as Painel from "./painel.js";
import * as Cad from "./cadastros.js";
import * as Solic from "./solicitacoes.js";

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
// menu lateral ocultável (lembra neste navegador)
function aplicarMenu(oculto) {
  document.body.classList.toggle("menu-oculto", oculto);
  $("#bMenu").setAttribute("aria-expanded", String(!oculto)); $("#bMenu").title = oculto ? "Mostrar o menu" : "Ocultar o menu";
  guardar("central-menu", oculto ? "oculto" : "");
}
aplicarMenu(preferencia("central-menu", "") === "oculto");
$("#bMenu").onclick = () => aplicarMenu(!document.body.classList.contains("menu-oculto"));
// grupos do menu (Cadastros, Outras informações) recolhem; lembra neste navegador
function grupo(bt, aberto) { bt.setAttribute("aria-expanded", String(aberto)); $("#" + bt.getAttribute("aria-controls")).hidden = !aberto; guardar("central-grp-" + bt.dataset.grp, aberto ? "" : "fechado"); }
document.querySelectorAll(".grp-bt").forEach((bt) => { grupo(bt, preferencia("central-grp-" + bt.dataset.grp, "") !== "fechado"); bt.onclick = () => grupo(bt, bt.getAttribute("aria-expanded") !== "true"); });
$("#tema").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) aplicarTema(b.dataset.t); });
$("#fonte").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) aplicarZoom(b.dataset.z); });

/* ================= telas ================= */
// marca da instalação (logo e ícone): só aparece se o build recebeu as imagens (ver scripts/gerar-config.mjs)
const MARCA = (window.CENTRAL_CONFIG || {}).marca || {};
document.querySelectorAll("[data-marca]").forEach((img) => { const f = MARCA[img.dataset.marca]; if (f) { img.src = f; img.hidden = false; } });
if (MARCA.icone) $("#favicon").href = MARCA.icone;

function mostrar(qual, texto) {
  if (texto) $("#carregandoTxt").textContent = texto;
  $("#telaCarregando").hidden = qual !== "carregando";
  $("#telaLogin").hidden = qual !== "login";
  const app = qual === "app";
  ["#lateral", "#topo", "#principal"].forEach((s) => ($(s).hidden = !app));
  document.body.classList.toggle("app-off", !app);
}

const TITULOS = { clientes: "Tarefas", agenda: "Calendário", historico: "Histórico de atividade",
  solic: "Solicitações", cadcli: "Cadastro de clientes", cadsen: "Senhas e acessos", cadtar: "Cadastro de tarefas", cadcol: "Colaboradores e permissões", home: "Painel do dia", ...Prev.VIEWS };
async function ir(view, id) {
  if (view !== "empresa") { Emp.fecharCartao(); Emp.fecharSenhas(); }
  Cad.fechar(); Solic.fechar(); $("#minhaSenha").hidden = true;
  E.view = view; if (id) E.aberta = id;
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.id === "v-" + (Prev.eh(view) ? "previa" : view)));
  document.querySelectorAll("aside a[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === (view === "empresa" ? "clientes" : view)));
  // abre o grupo (e os grupos de fora) da aba atual
  for (let sub = (document.querySelector("aside a.on") || document.body).closest(".sub"); sub; sub = sub.parentElement.closest(".sub"))
    if (sub.hidden) document.querySelector(`[aria-controls="${sub.id}"]`).click();
  $("#titulo").textContent = view === "empresa" ? "Tarefas / " + cliente(E.aberta).nome : TITULOS[view] || "";
  try {
    if (view === "home") await Painel.desenharHome();
    if (view === "agenda") await Painel.desenharAgenda();
    if (view === "clientes") await desenharClientes();
    if (view === "empresa") await Emp.carregar();
    if (view === "historico") await desenharHistorico();
    if (view === "solic") await Solic.desenhar();
    if (view === "cadcli") await Cad.desenharClientes();
    if (view === "cadsen") await Cad.desenharSenhas();
    if (view === "cadtar") await Cad.desenharRotinas();
    if (view === "cadcol") await Cad.desenharColaboradores();
    if (Prev.eh(view)) await Prev.desenhar(view);
  } catch (e) { avisoErro(e); }
  Emp.topo();
}

document.querySelectorAll("aside a[data-view]").forEach((a) => a.addEventListener("click", (ev) => {
  ev.preventDefault(); if (a.classList.contains("off")) return;
  if (E.view === "empresa" && E.rodando) return Emp.sairPara(a.dataset.view);
  ir(a.dataset.view);
}));

/* ================= login ================= */
let esqueci = false;   // a mesma tela serve para entrar e para pedir o link de senha nova
function modoEsqueci(sim) {
  esqueci = sim;
  $("#lSenhaRot").hidden = sim; $("#lSenha").required = !sim;
  $("#lSub").textContent = sim ? "Informe o seu e-mail. Mandamos um link para criar uma senha nova." : "Entre com o seu usuário.";
  $("#lEntrar").textContent = sim ? "Enviar link" : "Entrar";
  $("#lEsqueci").textContent = sim ? "Voltar para o login" : "Esqueci minha senha";
  $("#lErro").textContent = ""; $("#lOk").hidden = true;
}
$("#lEsqueci").onclick = () => { modoEsqueci(!esqueci); $("#lEmail").focus(); };

$("#fLogin").onsubmit = async (ev) => {
  ev.preventDefault();
  const b = $("#lEntrar"), email = $("#lEmail").value.trim();
  b.disabled = true; $("#lErro").textContent = ""; $("#lOk").hidden = true;
  try {
    if (esqueci) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/app/" });
      if (error && /rate|too many|seconds/i.test(error.message)) { $("#lErro").textContent = "Muitos pedidos seguidos. Espere alguns minutos e tente de novo."; return; }
      // mesma resposta exista ou não o e-mail (não revela quem tem acesso)
      $("#lOk").textContent = "Se esse e-mail tiver acesso, enviamos um link para criar uma senha nova. Confira a caixa de entrada e o spam. Se não chegar em 5 minutos, peça ao administrador para redefinir a sua senha.";
      $("#lOk").hidden = false; return;
    }
    mostrar("carregando", "Entrando…");
    const { error } = await sb.auth.signInWithPassword({ email, password: $("#lSenha").value });
    if (error) { mostrar("login"); $("#lErro").textContent = /fetch|network/i.test(error.message) ? "Sem conexão com o servidor. Confira a internet." : "E-mail ou senha incorretos."; return; }   // não diz qual dos dois
    $("#lSenha").value = "";
    await abrirApp();
  } catch (e) { mostrar("login"); $("#lErro").textContent = e.message || "Não deu para entrar."; }
  finally { b.disabled = false; }
};

/* ================= link de "esqueci minha senha" (vem do e-mail) ================= */
const limparEndereco = () => history.replaceState(null, "", location.pathname + location.search);
async function abrirRecuperacao() {
  mostrar("carregando", "Abrindo o link…");
  const { data: { session } } = await sb.auth.getSession();
  limparEndereco();
  if (!session) { mostrar("login"); $("#lErro").textContent = "O link expirou ou já foi usado. Peça outro em Esqueci minha senha."; return; }
  $("#fLogin").hidden = true; $("#fNova").hidden = false; mostrar("login"); $("#nvSenha").focus();
}
$("#fNova").onsubmit = async (ev) => {
  ev.preventDefault();
  const nova = $("#nvSenha").value, conf = $("#nvConf").value, b = $("#nvSalvar");
  $("#nvErro").textContent = "";
  if (nova.length < 8) return ($("#nvErro").textContent = "A senha precisa de pelo menos 8 caracteres.");
  if (nova !== conf) return ($("#nvErro").textContent = "A confirmação não é igual à nova senha.");
  b.disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password: nova });
    if (error) { $("#nvErro").textContent = /weak|pwned|leak/i.test(String(error.code || error.message)) ? "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra." : /same/i.test(String(error.code || error.message)) ? "Essa já é a sua senha atual. Escolha outra." : "Não deu para salvar: " + error.message; return; }
    $("#fNova").reset(); $("#fNova").hidden = true; $("#fLogin").hidden = false;
    mostrar("carregando", "Entrando…"); await abrirApp(); toast("Senha nova salva.");
  } catch (e) { $("#nvErro").textContent = e.message || "Não deu para salvar."; }
  finally { b.disabled = false; }
};
$("#bSair").onclick = async () => {
  if (E.rodando) return toast("Pause ou finalize o cliente antes de sair do sistema.");
  await sb.auth.signOut(); location.reload();
};

/* ================= trocar a própria senha =================
   Confere a senha atual (entrando de novo) antes de gravar a nova: um computador esquecido logado não basta. */
const avisoSenha = (t) => { $("#msMsg").hidden = !t; $("#msMsg").textContent = t || ""; };
$("#bSenha").onclick = () => {
  Emp.fecharCartao(); Emp.fecharSenhas(); Cad.fechar();
  $("#fSenha").reset(); avisoSenha(""); $("#minhaSenha").hidden = false; $("#msAtual").focus();
};
$("#msFechar").onclick = $("#msCanc").onclick = () => { $("#fSenha").reset(); $("#minhaSenha").hidden = true; };
$("#fSenha").onsubmit = (ev) => { ev.preventDefault(); travar($("#msSalvar"), async () => {
  const atual = $("#msAtual").value, nova = $("#msNova").value, conf = $("#msConf").value;
  if (nova.length < 8) return avisoSenha("A nova senha precisa de pelo menos 8 caracteres.");
  if (nova !== conf) return avisoSenha("A confirmação não é igual à nova senha.");
  if (nova === atual) return avisoSenha("A nova senha é igual à atual.");
  const { error: errAtual } = await sb.auth.signInWithPassword({ email: E.eu.email, password: atual });
  if (errAtual) return avisoSenha("Senha atual incorreta.");
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) {
    const c = String(error.code || error.message || "");
    return avisoSenha(/weak|pwned|leak/i.test(c) ? "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra."
      : /same/i.test(c) ? "A nova senha é igual à atual." : "Não deu para trocar a senha: " + error.message);
  }
  $("#fSenha").reset(); $("#minhaSenha").hidden = true; toast("Senha trocada. Use a nova no próximo login.");
})(); };

async function abrirApp() {
  mostrar("carregando");
  // sessão antiga guardada no navegador pode travar a renovação: em 10 s sem resposta, limpa e volta ao login
  const espera = new Promise((ok) => setTimeout(() => ok("tempo"), 10000));
  const resp = await Promise.race([sb.auth.getUser().catch(() => ({ data: {} })), espera]);
  if (resp === "tempo") {
    try { localStorage.removeItem("central-bpo-sessao"); } catch { /* sem armazenamento */ }
    mostrar("login"); $("#lErro").textContent = "Sua sessão anterior expirou. Entre de novo."; return;
  }
  const user = resp && resp.data && resp.data.user;
  if (!user) return mostrar("login");
  E.hoje = hojeISO();
  const eu = await q(sb.from("central_colaboradores").select("usuario_id, papel_central, ativo").eq("usuario_id", user.id).maybeSingle()).catch((e) => { avisoErro(e); return null; });
  if (!eu || !eu.ativo) {
    await sb.auth.signOut(); mostrar("login");
    $("#lErro").textContent = "Seu usuário não tem acesso ativo à Central. Fale com o administrador."; return;
  }
  await carregarEquipe();
  E.eu = { id: user.id, nome: nomeDe(user.id) !== "—" ? nomeDe(user.id) : user.email, email: user.email, papel: eu.papel_central };
  const perm = await q(sb.from("central_permissoes").select("acao, valor").eq("papel_central", eu.papel_central));
  E.perm = Object.fromEntries(perm.map((p) => [p.acao, p.valor]));
  await carregarClientes();
  $("#eu").textContent = E.eu.nome; $("#papel").textContent = PAPEL[E.eu.papel] || E.eu.papel;
  $("#hoje").textContent = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  mostrar("app");
  Solic.desenhar().catch(() => {});   // contador "comigo" no menu
  await Emp.carregarSessoes();
  ir(E.rodando ? "empresa" : "home", E.rodando ? E.rodando.empresa_id : null);
}

async function carregarEquipe() {
  const [colabs, perfis] = await Promise.all([
    q(sb.from("central_colaboradores").select("usuario_id, papel_central, ativo")),
    q(sb.from("perfis_usuarios").select("usuario_id, nome"))
  ]);
  const nomes = new Map(perfis.map((p) => [p.usuario_id, p.nome]));
  E.equipe = new Map(colabs.map((c) => [c.usuario_id, { nome: nomes.get(c.usuario_id) || "—", papel: c.papel_central, ativo: c.ativo }]));
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
let hAba = "atividade";
const CONSULTA = "descricao.ilike.*senha*,descricao.ilike.*acesso*,descricao.ilike.*link*,descricao.ilike.*copiou o usuário*";
$("#hAba").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; hAba = b.dataset.v;
  document.querySelectorAll("#hAba button").forEach((x) => x.classList.toggle("on", x === b)); desenharHistorico().catch(avisoErro); });
async function desenharHistorico() {
  if ($("#hUser").options.length === 1) {
    [...E.equipe.entries()].forEach(([u, x]) => $("#hUser").insertAdjacentHTML("beforeend", `<option value="${u}">${esc(x.nome)}</option>`));
    E.clientes.forEach((c) => $("#hEmp").insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`));
  }
  let cons = sb.from("central_vw_historico").select("id, created_at, usuario_id, usuario_nome, empresa_id, empresa_codigo, empresa_nome, descricao, tempo_ativo_segundos")
    .order("created_at", { ascending: false }).limit(300);
  if (hAba === "consultas") cons = cons.or(CONSULTA);
  else cons = cons.not("descricao", "ilike", "*senha*").not("descricao", "ilike", "*acesso ·*").not("descricao", "ilike", "abriu o link*").not("descricao", "ilike", "copiou o usuário*");
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
// redesenha a tela atual sem fechar o cartão (usado depois de mexer numa tarefa pelo cartão)
const atualizar = () => (E.view === "home" ? Painel.desenharHome() : E.view === "agenda" ? Painel.desenharAgenda() : E.view === "clientes" ? desenharClientes() : Promise.resolve()).catch(avisoErro);
Emp.iniciar({ ir, atualizar });
Solic.iniciar({ fecharOutras: () => { Emp.fecharCartao(); Emp.fecharSenhas(); Cad.fechar(); }, depoisDeAbrir: () => (E.view === "empresa" ? Emp.carregar() : null) });
Cad.iniciar({ recarregarBase: () => Promise.all([carregarClientes(), carregarEquipe()]), fecharOutras: () => { Emp.fecharCartao(); Emp.fecharSenhas(); } });
Painel.iniciar({ entrar: (id) => Emp.entrar(id).catch(avisoErro), abrirCartao: (id) => Emp.abrirCartao(id).catch(avisoErro) });
sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") mostrar("login"); });
if (retornoDoLink.get("type") === "recovery") abrirRecuperacao().catch((e) => { avisoErro(e); mostrar("login"); });
else if (retornoDoLink.get("error_code") || retornoDoLink.get("error")) {
  limparEndereco(); mostrar("login");
  $("#lErro").textContent = retornoDoLink.get("error_code") === "otp_expired" ? "O link expirou ou já foi usado. Peça outro em Esqueci minha senha." : "Não deu para abrir o link. Peça outro em Esqueci minha senha.";
} else abrirApp().catch((e) => { avisoErro(e); mostrar("login"); });


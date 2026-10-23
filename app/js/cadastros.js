// Cadastros: clientes, senhas (todos os clientes), tarefas (rotinas) e colaboradores com a matriz de permissões.
// Toda gravação passa pelas funções central_*: o banco decide se a pessoa faz direto ou se vira pedido ao Adm.
// Criar login e redefinir senha passam pela função de servidor /api/admin (só Adm).
import { sb, rpc, q, todas, apiAdmin } from "./api.js";
import { E, nomeDe, papelDe, cliente } from "./estado.js";
import { $, esc, dmy, hhmm, hms, somaDias, TIPO, PAPEL, COR_PAPEL, linkSeguro, toast, avisoErro, perguntar, copiar, travar } from "./ui.js";

let app = null;   // { recarregarBase(), fecharOutras() }
const ehAdm = () => E.eu && E.eu.papel === "administrador";
const permite = (acao) => ehAdm() || E.perm[acao] === "s";        // 's' faz; o resto vira pedido ao Adm no banco
const pp = (id) => `<span class="pp ${COR_PAPEL[papelDe(id)] || ""}">${esc(nomeDe(id))}</span>`;
const brl = (v) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const fmtCnpj = (c) => { const d = String(c || "").replace(/\D/g, ""); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c || "—"; };
const msg = (sel, t) => { $(sel).hidden = !t; $(sel).textContent = t || ""; };
function avisoGravacao(r, ok) {
  if (r && r.status === "pedido") return toast("Pedido registrado para o Adm");
  if (r && r.status === "parcial") return toast(`Salvo. Pedido ao Adm: ${(r.pedido_ao_adm || []).join(", ")}`);
  toast(ok);
}
const equipeAtiva = () => [...E.equipe.entries()].filter(([, x]) => x.ativo);   // administrador também pode ser responsável
const chips = (mapa) => Object.entries(mapa).map(([k, v]) => `<button type="button" data-t="${k}">${v}</button>`).join("");
function liga(sel, set, depois) {      // segmentos e chips
  $(sel).addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; set(b); depois(); });
}

export function iniciar(a) { app = a; iniciarClientes(); iniciarSenhas(); iniciarRotinas(); iniciarColaboradores(); }
export function fechar() { ["#ficha", "#rotF", "#colF", "#acessoF"].forEach((s) => ($(s).hidden = true)); }
const abrirGaveta = (sel) => { app.fecharOutras(); fechar(); $(sel).hidden = false; };

/* ======================= CLIENTES ======================= */
const SIT = { implantacao: ["Implantação", "t-warn"], ativa: ["Ativa", "t-ok"], bloqueada: ["Bloqueada", "t-bad"], encerrada: ["Encerrada", "t-plain"] };
let ccSit = "", clis = [], fichaId = null, ficha = null;

function iniciarClientes() {
  liga("#ccSit", (b) => { ccSit = b.dataset.v; document.querySelectorAll("#ccSit button").forEach((x) => x.classList.toggle("on", x === b)); }, () => desenharClientes(false).catch(avisoErro));
  $("#ccQ").addEventListener("input", () => desenharClientes(false).catch(avisoErro));
  $("#ccRows").addEventListener("click", (ev) => { const tr = ev.target.closest("tr[data-cc]"); if (tr) abrirFicha(tr.dataset.cc); });
  $("#ccNovo").onclick = () => abrirFicha(null);
  $("#fFechar").onclick = $("#fCanc").onclick = () => ($("#ficha").hidden = true);
  $("#ficha").addEventListener("click", (ev) => {
    const add = ev.target.closest("[data-add]");
    if (add) { const id = add.dataset.add === "socios" ? "#fSocios" : "#fContatos"; const l = lerLista(id); l.push({ nome: "", doc: "", part: "" }); linhasLista(id, l, false); const ins = document.querySelectorAll(id + " .row:last-child input"); if (ins[0]) ins[0].focus(); return; }
    const rm = ev.target.closest("[data-rm]"); if (rm) rm.closest(".row").remove();
  });
  $("#fForm").onsubmit = (ev) => { ev.preventDefault(); travar($("#fSalvar"), salvarFicha)(); };
  $("#fEncerrar").onclick = () => {
    const c = ficha; if (!c) return;
    if (!permite("cliente_sensivel")) return rpc("central_encerrar_cliente", { p_empresa: c.id }).then((r) => { avisoGravacao(r, ""); $("#ficha").hidden = true; }).catch(avisoErro);
    perguntar(`Encerrar ${c.nome}?`, "O cliente sai da aba Tarefas e para de gerar tarefas (as futuras em aberto são apagadas). O cadastro e o histórico ficam guardados.",
      [{ txt: `Encerrar ${c.nome}`, cls: "red", fn: async () => { await rpc("central_encerrar_cliente", { p_empresa: c.id }); toast("Cliente encerrado"); $("#ficha").hidden = true; await app.recarregarBase(); await desenharClientes(); } },
       { txt: "Voltar" }], true);
  };
}

export async function desenharClientes(recarregar = true) {
  if (recarregar) {
    const [emps, cc, vinc] = await Promise.all([
      todas(() => sb.from("empresas").select("id, codigo, razao_social, nome_fantasia, cnpj, segmento, regime_tributario").order("codigo")),
      todas(() => sb.from("central_clientes").select("*").order("empresa_id")),
      todas(() => sb.from("central_vinculos").select("empresa_id, usuario_id").order("empresa_id"))
    ]);
    const info = new Map(cc.map((c) => [c.empresa_id, c]));
    clis = emps.map((e) => ({ ...(info.get(e.id) || { situacao: "ativa", prioridade: "normal", socios: [], contatos: [] }), ...e,
      nome: e.nome_fantasia || e.razao_social, equipe: vinc.filter((v) => v.empresa_id === e.id).map((v) => v.usuario_id) }));
  }
  $("#ccNovo").textContent = permite("cliente_cadastrar") ? "+ Novo cliente" : "Pedir cliente novo ao Adm";
  const busca = $("#ccQ").value.trim().toLowerCase();
  const lista = clis.filter((c) => (!ccSit || c.situacao === ccSit) && (!busca || `${c.nome} ${c.razao_social} ${c.cnpj} ${c.codigo}`.toLowerCase().includes(busca)));
  $("#ccRows").innerHTML = lista.map((c) => { const [rot, cls] = SIT[c.situacao] || [c.situacao, "t-plain"]; return `<tr data-cc="${c.id}">
    <td class="emp"><b>${esc(c.nome)}</b><small>${esc(c.codigo)} · ${esc(c.razao_social)}</small></td>
    <td style="font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(fmtCnpj(c.cnpj))}</td>
    <td><span class="tag ${cls}">${esc(rot)}</span></td>
    <td class="n">${esc(brl(c.honorario_mensal))}</td>
    <td>${c.equipe.map(pp).join(" ") || '<span class="zero">—</span>'}</td>
    <td style="font-size:12.5px;color:var(--ink2)">${esc(c.grupo_principal || "")}</td></tr>`; }).join("")
    || '<tr><td colspan="6" class="zero" style="text-align:center;padding:20px">Nenhum cliente</td></tr>';
}

function linhasLista(id, arr, travado) {
  const rot = id === "#fSocios" ? ["Nome", "CPF", "Participação"] : ["Nome", "Função", "Telefone"];
  $(id).innerHTML = arr.map((x) => `<div class="row">
    <label>${rot[0]}<input data-k="nome" value="${esc(x.nome)}" maxlength="120" ${travado ? "disabled" : ""}></label>
    <label>${rot[1]}<input data-k="doc" value="${esc(x.doc)}" maxlength="60" ${travado ? "disabled" : ""}></label>
    <label>${rot[2]}<input data-k="part" value="${esc(x.part)}" maxlength="60" ${travado ? "disabled" : ""}></label>
    ${travado ? "<span></span>" : '<button type="button" data-rm title="Remover">×</button>'}</div>`).join("") || '<div class="zero" style="font-size:12px">Nenhum.</div>';
}
const lerLista = (id) => [...document.querySelectorAll(id + " .row")].map((r) => ({ nome: r.querySelector('[data-k="nome"]').value.trim(),
  doc: r.querySelector('[data-k="doc"]').value.trim(), part: r.querySelector('[data-k="part"]').value.trim() })).filter((x) => x.nome);

const SENSIVEIS = ["razao_social", "cnpj", "honorario_mensal", "plano"];
const CAMPOS = ["codigo", "nome_fantasia", "razao_social", "cnpj", "situacao", "prioridade", "segmento", "regime_tributario", "honorario_mensal", "plano",
  "inicio_contrato", "sistema_financeiro", "grupo_principal", "email_financeiro", "endereco", "cidade", "cep", "particularidades"];

function abrirFicha(id) {
  const novo = !id, sens = permite("cliente_sensivel");
  const c = novo ? { situacao: "implantacao", prioridade: "normal", socios: [], contatos: [], equipe: ehAdm() ? [] : [E.eu.id], inicio_contrato: E.hoje } : clis.find((x) => x.id === id);
  fichaId = id; ficha = c;
  $("#fTit").textContent = novo ? "Novo cliente" : `${c.nome} · ${c.codigo}`;
  const [rot, cls] = SIT[c.situacao] || ["", ""];
  $("#fSub").innerHTML = novo ? '<span class="criada">Preencha os dados. CNPJ, razão social, honorário e sócios podem ser preenchidos por quem cadastra; depois só o Adm altera.</span>'
    : `<span class="tag ${cls}">${esc(rot)}</span><span class="criada">${sens ? "Você pode alterar tudo." : "Campos SÓ ADM: peça ao Adm."}</span>`;
  const f = $("#fForm").elements;
  const sel = f.situacao; [...sel.options].filter((o) => o.value === "encerrada").forEach((o) => o.remove());
  if (c.situacao === "encerrada") sel.insertAdjacentHTML("beforeend", '<option value="encerrada">Encerrada</option>');
  CAMPOS.forEach((k) => { const el = f[k]; el.value = k === "cnpj" ? (c.cnpj ? fmtCnpj(c.cnpj) : "") : c[k] ?? ""; el.disabled = !novo && !sens && SENSIVEIS.includes(k); });
  f.codigo.disabled = !novo;
  const travaSocios = !novo && !sens;
  linhasLista("#fSocios", c.socios || [], travaSocios); linhasLista("#fContatos", c.contatos || [], false);
  document.querySelector('[data-add="socios"]').hidden = travaSocios;
  const gente = equipeAtiva().concat([...E.equipe.entries()].filter(([u, x]) => (c.equipe || []).includes(u) && !x.ativo));
  $("#fEquipe").innerHTML = gente.map(([u, x]) => `<label><input type="checkbox" value="${u}" ${(c.equipe || []).includes(u) ? "checked" : ""}>${esc(x.nome)}</label>`).join("") || '<span class="zero">Ninguém cadastrado.</span>';
  $("#fEncerrar").hidden = novo || c.situacao === "encerrada";
  $("#fEncerrar").textContent = sens ? "Encerrar cliente" : "Pedir encerramento ao Adm";
  $("#fSalvar").textContent = permite("cliente_cadastrar") ? "Salvar" : "Pedir ao Adm";
  msg("#fMsg", "");
  abrirGaveta("#ficha");
}

async function salvarFicha() {
  const f = $("#fForm").elements, novo = !fichaId, sens = permite("cliente_sensivel");
  const d = {};
  CAMPOS.forEach((k) => { if (!f[k].disabled || k === "codigo") d[k] = f[k].value.trim(); });
  if (!novo) delete d.codigo;
  if (d.cnpj !== undefined) { d.cnpj = d.cnpj.replace(/\D/g, ""); if (d.cnpj.length !== 14) return msg("#fMsg", "O CNPJ precisa ter 14 números."); }
  if (d.honorario_mensal !== undefined) {
    const v = d.honorario_mensal.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
    d.honorario_mensal = v === "" ? null : Number(v);
    if (d.honorario_mensal !== null && !(d.honorario_mensal >= 0)) return msg("#fMsg", "Honorário inválido.");
  }
  if (!d.inicio_contrato) delete d.inicio_contrato;     // data vazia não apaga a que existe
  if (!d.plano) delete d.plano;
  d.contatos = lerLista("#fContatos");
  if (novo || sens) d.socios = lerLista("#fSocios");
  d.equipe = [...document.querySelectorAll("#fEquipe input:checked")].map((i) => i.value);
  if (novo && (!d.codigo || !d.nome_fantasia || !d.razao_social)) return msg("#fMsg", "Preencha código, nome fantasia e razão social.");
  const r = await rpc("central_salvar_cliente", { p_empresa: fichaId, p_dados: d });
  avisoGravacao(r, novo ? "Cliente cadastrado" : "Cadastro salvo");
  $("#ficha").hidden = true;
  await app.recarregarBase(); await desenharClientes();
}

/* ======================= SENHAS (todos os clientes) ======================= */
const STIPO = { banco: "Banco", plataforma: "Plataforma", email: "E-mail", governo: "Governo", outro: "Outro" };
const VELHA = 180;   // dias
const csTipos = new Set();
let acessos = [], acessoAlt = null;
const visiveis = new Map();

function iniciarSenhas() {
  $("#csTipos").innerHTML = chips(STIPO);
  liga("#csTipos", (b) => { csTipos.has(b.dataset.t) ? csTipos.delete(b.dataset.t) : csTipos.add(b.dataset.t); b.classList.toggle("on"); }, () => desenharSenhas(false).catch(avisoErro));
  ["#csEmp", "#csVelhas"].forEach((s) => $(s).addEventListener("change", () => desenharSenhas(false).catch(avisoErro)));
  $("#csQ").addEventListener("input", () => desenharSenhas(false).catch(avisoErro));
  $("#csNovoAbrir").onclick = () => abrirAcesso(null);
  $("#acFechar").onclick = $("#acCanc").onclick = () => fecharAcesso();
  $("#acVer").onclick = () => { const e = $("#acSen"); e.type = e.type === "password" ? "text" : "password"; $("#acVer").textContent = e.type === "password" ? "mostrar" : "ocultar"; };
  $("#acGerar").onclick = () => { const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%", n = new Uint32Array(16); crypto.getRandomValues(n); $("#acSen").value = Array.from(n, (x) => c[x % c.length]).join(""); $("#acSen").type = "text"; $("#acVer").textContent = "ocultar"; };
  $("#acForm").onsubmit = (ev) => { ev.preventDefault(); travar($("#acSalvar"), salvarAcesso)(); };
  $("#acExcluir").onclick = () => { if (acessoAlt) acaoAcesso(acessoAlt, "exc").catch(avisoErro); };
  $("#csArea").addEventListener("click", (ev) => {
    const cli = ev.target.closest("[data-cli]"); if (cli) { $("#csEmp").value = cli.dataset.cli; $("#csQ").value = ""; return desenharSenhas(false).catch(avisoErro); }
    if (ev.target.closest("[data-voltar]")) { $("#csEmp").value = ""; return desenharSenhas(false).catch(avisoErro); }
    const el = ev.target.closest("[data-act]"); if (!el) return;
    const a = acessos.find((x) => x.id === el.closest("[data-acc]").dataset.acc); if (!a) return;
    acaoAcesso(a, el.dataset.act).catch(avisoErro);
  });
}

async function acaoAcesso(a, act) {
  if (act === "link") return rpc("central_registrar_acesso", { p_acesso: a.id, p_acao: "abriu o link" });
  if (act === "cu") { await copiar(a.usuario_login || ""); await rpc("central_registrar_acesso", { p_acesso: a.id, p_acao: "copiou o usuário" }); return; }
  if (act === "cs") { const s = await rpc("central_revelar_senha", { p_acesso: a.id, p_motivo: "copiou" }); await copiar(s || ""); return; }
  if (act === "ver") {
    if (visiveis.has(a.id)) { visiveis.delete(a.id); return desenharSenhas(false); }
    visiveis.set(a.id, await rpc("central_revelar_senha", { p_acesso: a.id, p_motivo: "visualizou" }));
    setTimeout(() => { if (visiveis.delete(a.id)) desenharSenhas(false); }, 30000);   // some sozinha em 30 s
    return desenharSenhas(false);
  }
  if (act === "sol") { const r = await rpc("central_salvar_acesso", { p_id: a.id, p_empresa: a.empresa_id, p_sistema: a.sistema, p_tipo: null, p_link: null, p_usuario: null, p_senha: null, p_observacoes: null }); return avisoGravacao(r, ""); }
  if (act === "alt") return abrirAcesso(a);
  if (act === "exc") {
    perguntar(`Excluir o acesso ${a.sistema}?`, "Some da lista de senhas do cliente. Fica registrado no histórico.",
      [{ txt: "Excluir acesso", cls: "red", fn: async () => { const r = await rpc("central_excluir_acesso", { p_acesso: a.id }); avisoGravacao(r, "Acesso excluído"); fecharAcesso(); await desenharSenhas(); } }, { txt: "Voltar" }], true);
  }
}

export async function desenharSenhas(recarregar = true) {
  if ($("#csEmp").options.length === 1) {
    E.clientes.forEach((c) => $("#csEmp").insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`));
  }
  if (recarregar) {
    acessos = await todas(() => sb.from("central_acessos").select("id, empresa_id, sistema, tipo, link, usuario_login, observacoes, alterada_em, alterada_por").eq("ativo", true).order("id"));
  }
  $("#csNovoAbrir").textContent = permite("senha_cadastrar") ? "+ Novo acesso" : "+ Novo acesso (vira pedido)";
  const fe = $("#csEmp").value, busca = $("#csQ").value.trim().toLowerCase(), velhas = $("#csVelhas").checked, alt = permite("senha_alterar");
  const dias = (a) => Math.floor((Date.now() - new Date(a.alterada_em).getTime()) / 864e5);
  const passa = (a) => (!csTipos.size || csTipos.has(a.tipo)) && (!velhas || dias(a) > VELHA) &&
    (!busca || `${a.sistema} ${a.usuario_login || ""} ${a.observacoes || ""} ${cliente(a.empresa_id).nome}`.toLowerCase().includes(busca));
  if (!fe) {   // grade de clientes: um quadro por cliente
    const grupos = E.clientes.map((c) => { const todos = acessos.filter((a) => a.empresa_id === c.id); return { c, todos, vis: todos.filter(passa) }; })
      .filter((g) => !(busca || csTipos.size || velhas) || g.vis.length);
    $("#csArea").innerHTML = `<div class="sgrade">${grupos.map(({ c, todos, vis }) => {
      const porTipo = Object.keys(STIPO).map((tp) => [tp, vis.filter((a) => a.tipo === tp).length]).filter(([, n]) => n);
      const velhasN = todos.filter((a) => dias(a) > VELHA).length;
      return `<button type="button" class="scli" data-cli="${c.id}">
        <span class="scod">${esc(c.codigo)}</span><b>${esc(c.nome)}</b>
        <span class="sn">${vis.length} acesso${vis.length === 1 ? "" : "s"}${vis.length !== todos.length ? ` de ${todos.length}` : ""}</span>
        <span class="stipos">${porTipo.map(([tp, n]) => `<span class="tipo">${STIPO[tp]} ${n}</span>`).join(" ") || '<span class="zero">nenhum acesso</span>'}</span>
        ${velhasN ? `<span class="velha" style="font-size:11.5px">${velhasN} sem troca há +180 dias</span>` : ""}</button>`;
    }).join("") || '<div class="zero" style="padding:20px">Nenhum cliente com esse filtro.</div>'}</div>`;
    return;
  }
  // quadro do cliente: colunas por tipo, um cartão por acesso
  const c = cliente(fe), vis = acessos.filter((a) => a.empresa_id === fe && passa(a)).sort((x, y) => x.sistema.localeCompare(y.sistema));
  const cartao = (a) => {
    const link = linkSeguro(a.link), sen = visiveis.get(a.id), d = dias(a);
    return `<div class="scard" data-acc="${a.id}">
      <div class="st"><b>${esc(a.sistema)}</b>${link ? ` <a class="mb lk" href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-act="link">abrir ↗</a>` : ""}</div>
      <div class="sl"><span>Usuário</span>${a.usuario_login ? `<code>${esc(a.usuario_login)}</code><button class="mb" type="button" data-act="cu">copiar</button>` : '<span class="zero">—</span>'}</div>
      <div class="sl"><span>Senha</span>${sen !== undefined ? `<pre class="sen">${esc(sen ?? "(sem senha)")}</pre>` : "<code>••••••••</code>"}<button class="mb" type="button" data-act="ver">${sen !== undefined ? "ocultar" : "mostrar"}</button><button class="mb" type="button" data-act="cs">copiar</button></div>
      ${a.observacoes ? `<div class="so">${esc(a.observacoes)}</div>` : ""}
      <div class="sr"><span class="${d > VELHA ? "velha" : "zero"}" title="por ${esc(nomeDe(a.alterada_por))}">trocada ${dmy(a.alterada_em.slice(0, 10))}</span>
        <span>${alt ? '<button class="mb" type="button" data-act="alt">alterar</button><button class="mb" type="button" data-act="exc">excluir</button>' : '<button class="mb" type="button" data-act="sol">pedir alteração</button>'}</span></div></div>`;
  };
  const colunas = Object.entries(STIPO).map(([tp, nome]) => [nome, vis.filter((a) => a.tipo === tp)]).filter(([, l]) => l.length);
  $("#csArea").innerHTML = `<div class="shd"><button type="button" class="mb" data-voltar>← Todos os clientes</button><b>${esc(c.codigo)} · ${esc(c.nome)}</b><span class="zero">${vis.length} acesso${vis.length === 1 ? "" : "s"}</span></div>
    <div class="squadro">${colunas.map(([nome, l]) => `<div class="scol"><div class="scolhd">${nome} <span class="zero">${l.length}</span></div>${l.map(cartao).join("")}</div>`).join("")
      || '<div class="zero" style="padding:20px">Nenhum acesso com esse filtro. Use "+ Novo acesso" para cadastrar.</div>'}</div>`;
}

function fecharAcesso() { $("#acessoF").hidden = true; $("#acForm").reset(); acessoAlt = null; }
function abrirAcesso(a) {
  acessoAlt = a; app.fecharOutras(); fechar();
  const novo = !a, f = $("#acForm").elements;
  $("#acTit").textContent = novo ? "Novo acesso" : a.sistema;
  $("#acSub").textContent = novo ? "A senha fica cifrada no banco. Cada consulta fica registrada." : `${cliente(a.empresa_id).nome} · alterado em ${dmy(a.alterada_em.slice(0, 10))} por ${nomeDe(a.alterada_por)}`;
  $("#acEmp").innerHTML = E.clientes.map((c) => `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`).join("");
  f.empresa.value = novo ? ($("#csEmp").value || (E.clientes[0] || {}).id || "") : a.empresa_id; f.empresa.disabled = !novo;
  f.sistema.value = novo ? "" : a.sistema; f.tipo.value = novo ? "banco" : a.tipo;
  f.link.value = novo ? "" : a.link || ""; f.usuario.value = novo ? "" : a.usuario_login || "";
  f.senha.value = ""; f.senha.type = "password"; $("#acVer").textContent = "mostrar";
  f.senha.placeholder = novo ? "" : "deixe em branco para manter a atual";
  f.obs.value = novo ? "" : a.observacoes || "";
  $("#acExcluir").hidden = novo || !permite("senha_alterar");
  $("#acSalvar").textContent = novo ? "Salvar acesso" : permite("senha_alterar") ? "Salvar alteração" : "Pedir alteração ao Adm";
  msg("#acMsg", "");
  $("#acessoF").hidden = false; f.sistema.focus();
}
async function salvarAcesso() {
  const f = $("#acForm").elements, a = acessoAlt;
  const link = f.link.value.trim();
  if (link && !linkSeguro(link)) return msg("#acMsg", "O link precisa começar com https:// ou http://");
  if (!f.sistema.value.trim()) return msg("#acMsg", "Dê um nome ao acesso (ex.: Banco Itaú, Prefeitura).");
  const r = await rpc("central_salvar_acesso", { p_id: a ? a.id : null, p_empresa: a ? a.empresa_id : f.empresa.value, p_sistema: f.sistema.value.trim(), p_tipo: f.tipo.value,
    p_link: link, p_usuario: f.usuario.value.trim(), p_senha: f.senha.value || null, p_observacoes: f.obs.value.trim() });
  if (a) visiveis.delete(a.id);
  avisoGravacao(r, a ? "Acesso alterado" : "Acesso salvo");
  fecharAcesso(); await desenharSenhas();
}


/* ======================= TAREFAS (uma tarefa → os clientes vinculados) =======================
   Cada tarefa (nome, tipo, checklist) vale para os clientes marcados nela. Por cliente variam o dia,
   o responsável e se está ativa. No banco: uma rotina por cliente (rotinas_empresa), todas com o
   mesmo modelo (nome). Salvar chama central_salvar_rotina / central_excluir_rotina cliente a cliente. */
const FREQ = { diaria: "Diário", semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal", anual: "Anual" };
const DSEM = { 1: "segunda", 2: "terça", 3: "quarta", 4: "quinta", 5: "sexta", 6: "sábado", 7: "domingo", 0: "domingo" };
const DSEM_TXT = { segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4, sexta: 5 };
const MES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ctTipos = new Set();
let ctSit = "", rotinas = [], tarefas = [], tarAberta = null, rCk = [], vinc = [];

const diaSemanaDe = (g) => { const d = g.dia_semana; if (typeof d === "number") return d; const t = String(d || "").toLowerCase().replace("-feira", "").trim(); return DSEM_TXT[t] || Number(t) || 5; };
const diasMes = (g) => (Array.isArray(g.dias_mes) ? g.dias_mes : g.dia_mes ? [g.dia_mes] : []);
function regraTexto(freq, g, inicio) {
  g = g || {};
  if (freq === "diaria") return "seg a sex";
  if (freq === "semanal") return `toda ${DSEM[diaSemanaDe(g)]}`;
  if (freq === "quinzenal") return `a cada 15 dias desde ${dmy(inicio)}`;
  if (freq === "mensal") return `dia ${diasMes(g).join(" e ") || "?"}${g.dia_meta ? ` · meta ${g.dia_meta}` : ""}`;
  if (freq === "anual") return `${g.dia_mes || "?"} de ${MES[Number(g.mes)] || "?"}`;
  return freq;
}

// agrupa as rotinas por tarefa (nome)
function agrupar() {
  const m = new Map();
  rotinas.forEach((r) => { if (!m.has(r.nome)) m.set(r.nome, { nome: r.nome, rotinas: [] }); m.get(r.nome).rotinas.push(r); });
  tarefas = [...m.values()].map((t) => {
    const freqs = [...new Set(t.rotinas.map((r) => r.frequencia))];
    const regras = [...new Set(t.rotinas.map((r) => regraTexto(r.frequencia, r.regra_agendamento, r.vigencia_inicio)))];
    const resp = [...new Set(t.rotinas.flatMap((r) => r.responsaveis || []))];
    const ck = t.rotinas.map((r) => r.checklist || []).sort((a, b) => b.length - a.length)[0] || [];
    return { ...t, freq: freqs.length === 1 ? freqs[0] : null, regra: regras.length === 1 ? regras[0] : "varia por cliente", resp, checklist: ck,
      ativas: t.rotinas.filter((r) => r.situacao === "ativa").length };
  });
}

function iniciarRotinas() {
  $("#ctTipos").innerHTML = chips(FREQ);
  liga("#ctTipos", (b) => { ctTipos.has(b.dataset.t) ? ctTipos.delete(b.dataset.t) : ctTipos.add(b.dataset.t); b.classList.toggle("on"); }, () => desenharRotinas(false).catch(avisoErro));
  liga("#ctAtiva", (b) => { ctSit = b.dataset.v; document.querySelectorAll("#ctAtiva button").forEach((x) => x.classList.toggle("on", x === b)); }, () => desenharRotinas(false).catch(avisoErro));
  ["#ctEmp", "#ctResp"].forEach((s) => $(s).addEventListener("change", () => desenharRotinas(false).catch(avisoErro)));
  $("#ctQ").addEventListener("input", () => desenharRotinas(false).catch(avisoErro));
  $("#ctRows").addEventListener("click", (ev) => { const tr = ev.target.closest("tr[data-tar]"); if (tr) abrirTarefa(tr.dataset.tar); });
  // sem permissão, "nova tarefa" vira pedido direto (o banco registra antes de validar)
  $("#ctNova").onclick = () => (permite("rotina") ? abrirTarefa(null) : rpc("central_salvar_rotina", { p_id: null, p_empresa: $("#ctEmp").value || (E.clientes[0] || {}).id || null,
    p_nome: "tarefa nova", p_frequencia: "diaria", p_regra: {}, p_inicio: E.hoje, p_fim: null, p_ativa: true, p_responsaveis: [], p_checklist: [] }).then((r) => avisoGravacao(r, "")).catch(avisoErro));
  $("#rFechar").onclick = $("#rCanc").onclick = () => ($("#rotF").hidden = true);
  $("#rForm").elements.tipo.addEventListener("change", () => { camposDoTipo(); desenharVinculos(); });
  $("#rCkAdd").onclick = () => { const v = $("#rCkNovo").value.trim(); if (!v) return; rCk.push(v); $("#rCkNovo").value = ""; desenharCk(true); };
  $("#rCkNovo").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("#rCkAdd").click(); } });
  $("#rCk").addEventListener("click", (ev) => { const b = ev.target.closest("[data-rmck]"); if (b) { rCk.splice(Number(b.dataset.rmck), 1); desenharCk(true); } });
  // tabela de clientes: guarda o que a pessoa mexe em "vinc"
  $("#rClis").addEventListener("input", (ev) => {
    const el = ev.target.closest("[data-v]"); if (!el) return;
    const v = vinc[Number(el.closest("tr").dataset.i)], k = el.dataset.v;
    v[k] = el.type === "checkbox" ? el.checked : el.value;
    if (k === "on") el.closest("tr").classList.toggle("off", !el.checked);
  });
  $("#rAplicar").onclick = () => {
    const f = $("#rForm").elements;
    vinc.filter((v) => v.on).forEach((v) => { if (f.todosDia.value) { v.dia = f.todosDia.value; v.diaSem = f.todosDia.value; } if (f.todosResp.value) v.resp = f.todosResp.value; });
    desenharVinculos();
  };
  $("#rForm").onsubmit = (ev) => { ev.preventDefault(); travar($("#rSalvar"), salvarTarefa)(); };
  $("#rExcluir").onclick = () => {
    const t = tarefas.find((x) => x.nome === tarAberta); if (!t) return;
    perguntar(`Excluir a tarefa "${t.nome}" de todos os clientes?`, `Para de gerar em ${t.rotinas.length} cliente(s) a partir de amanhã (as futuras em aberto são apagadas). As de hoje e as já concluídas ficam no histórico.`,
      [{ txt: "Excluir tarefa", cls: "red", fn: async () => {
        for (const r of t.rotinas) await rpc("central_excluir_rotina", { p_id: r.id });
        toast("Tarefa excluída"); $("#rotF").hidden = true; await desenharRotinas(); } },
       { txt: "Voltar" }], true);
  };
}

export async function desenharRotinas(recarregar = true) {
  if ($("#ctEmp").options.length === 1) {
    E.clientes.forEach((c) => $("#ctEmp").insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`));
    [...E.equipe.entries()].filter(([, x]) => x.ativo).forEach(([u, x]) => $("#ctResp").insertAdjacentHTML("beforeend", `<option value="${u}">${esc(x.nome)}</option>`));
  }
  if (recarregar) { rotinas = await todas(() => sb.from("central_vw_rotinas").select("*").order("id")); agrupar(); }
  const adm = permite("rotina");
  $("#ctNova").textContent = adm ? "+ Nova tarefa" : "Pedir tarefa nova ao Adm";
  $("#ctFoot").textContent = adm ? "Cada tarefa vale para os clientes marcados nela. Clique para mudar clientes, dia, responsável ou checklist. Mudanças valem a partir de amanhã."
    : "Só o Adm cadastra, altera ou exclui tarefas. Clique numa tarefa para ver os detalhes ou pedir alteração.";
  const fe = $("#ctEmp").value, fr = $("#ctResp").value, busca = $("#ctQ").value.trim().toLowerCase();
  const ord = { diaria: 1, semanal: 2, quinzenal: 3, mensal: 4, anual: 5 };
  const lista = tarefas.filter((t) => (!fe || t.rotinas.some((r) => r.empresa_id === fe)) && (!fr || t.resp.includes(fr)) &&
      (!ctTipos.size || t.rotinas.some((r) => ctTipos.has(r.frequencia))) &&
      (!ctSit || (ctSit === "ativa" ? t.ativas > 0 : t.ativas < t.rotinas.length)) && (!busca || t.nome.toLowerCase().includes(busca)))
    .sort((a, b) => (ord[a.freq] || 9) - (ord[b.freq] || 9) || a.nome.localeCompare(b.nome));
  $("#ctRows").innerHTML = lista.map((t) => {
    const clis = t.rotinas.map((r) => cliente(r.empresa_id)).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
    return `<tr data-tar="${esc(t.nome)}" class="${t.ativas ? "" : "pausada"}">
    <td><b>${esc(t.nome)}</b> <span class="tipo">${esc(t.freq ? FREQ[t.freq] : "vários tipos")}</span></td>
    <td style="white-space:normal;max-width:300px">${clis.map((c) => `<span class="cli-chip" title="${esc(c.razao || c.nome)}">${esc(c.codigo)} ${esc(c.nome)}</span>`).join(" ")}</td>
    <td style="font-size:12.5px">${esc(t.regra)}</td>
    <td>${t.resp.map(pp).join(" ") || '<span class="zero">—</span>'}</td>
    <td class="n">${t.checklist.length ? `${t.checklist.length} itens` : '<span class="zero">—</span>'}</td>
    <td><span class="tag ${t.ativas ? "t-ok" : "t-plain"}">${t.ativas === t.rotinas.length ? "Ativa" : t.ativas ? `${t.ativas} de ${t.rotinas.length} ativas` : "Pausada"}</span></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="zero" style="text-align:center;padding:20px">Nenhuma tarefa com esse filtro</td></tr>';
}

function desenharCk(edita) {
  $("#rCk").innerHTML = rCk.map((it, i) => `<li><span>${esc(it)}</span>${edita ? `<button type="button" class="rm" data-rmck="${i}" title="Remover">×</button>` : ""}</li>`).join("") || '<li class="zero">Sem checklist.</li>';
}
function camposDoTipo() { const tp = $("#rForm").elements.tipo.value; document.querySelectorAll("#rForm [data-so]").forEach((l) => (l.hidden = !l.dataset.so.split(" ").includes(tp))); }

// uma linha por cliente: vinculado?, dia (conforme o tipo), responsável, ativa
function desenharVinculos() {
  const tipo = $("#rForm").elements.tipo.value, adm = permite("rotina"), dis = adm ? "" : "disabled";
  const gente = new Map(equipeAtiva()); vinc.forEach((v) => v.respOrig.forEach((u) => gente.set(u, E.equipe.get(u) || { nome: nomeDe(u) })));
  const opcGente = (sel) => [...gente.entries()].map(([u, x]) => `<option value="${u}" ${u === sel ? "selected" : ""}>${esc(x.nome)}</option>`).join("");
  const opcSem = (sel) => [1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${String(d) === String(sel) ? "selected" : ""}>${DSEM[d]}</option>`).join("");
  const opcMes = (sel) => MES.slice(1).map((m, i) => `<option value="${i + 1}" ${String(i + 1) === String(sel) ? "selected" : ""}>${m}</option>`).join("");
  const regra = (v) => tipo === "semanal" ? `<select data-v="diaSem" ${dis} aria-label="Dia da semana">${opcSem(v.diaSem)}</select>`
    : tipo === "mensal" ? `<input data-v="dia" type="number" min="1" max="31" value="${esc(v.dia)}" ${dis} aria-label="Dia da entrega" title="dia da entrega"> <input data-v="meta" type="number" min="1" max="31" value="${esc(v.meta)}" placeholder="meta" ${dis} aria-label="Dia da meta" title="dia da meta (opcional)">`
    : tipo === "anual" ? `<input data-v="dia" type="number" min="1" max="31" value="${esc(v.dia)}" ${dis} aria-label="Dia"> <select data-v="mes" ${dis} aria-label="Mês">${opcMes(v.mes)}</select>`
    : '<span class="zero">—</span>';
  $("#rClis").innerHTML = `<table class="vtab"><thead><tr><th></th><th>Cliente</th><th>${tipo === "semanal" ? "Dia" : tipo === "mensal" ? "Dia · meta" : tipo === "anual" ? "Dia · mês" : ""}</th><th>Responsável</th><th>Ativa</th></tr></thead><tbody>${
    vinc.map((v, i) => { const c = cliente(v.empresa_id); return `<tr data-i="${i}" class="${v.on ? "" : "off"}">
      <td><input type="checkbox" data-v="on" ${v.on ? "checked" : ""} ${dis} aria-label="Vincular ${esc(c.nome)}"></td>
      <td><b>${esc(c.codigo)}</b> ${esc(c.nome)}${v.multi ? ' <span class="zero" style="font-size:11px">· vários dias</span>' : ""}</td>
      <td>${regra(v)}</td>
      <td><select data-v="resp" ${dis} aria-label="Responsável em ${esc(c.nome)}"><option value="">—</option>${opcGente(v.resp)}</select></td>
      <td><input type="checkbox" data-v="ativa" ${v.ativa ? "checked" : ""} ${dis} aria-label="Ativa em ${esc(c.nome)}"></td></tr>`; }).join("")}</tbody></table>`;
  const f = $("#rForm").elements;
  f.todosResp.innerHTML = `<option value="">responsável…</option>${opcGente("")}`;
  f.todosDia.hidden = !["semanal", "mensal", "anual"].includes(tipo);
  f.todosDia.placeholder = tipo === "semanal" ? "dia 1-5" : "dia";
  $("#rTodos").hidden = !adm;
}

function abrirTarefa(nome) {
  const adm = permite("rotina"), novo = nome === null;
  const t = novo ? { nome: "", rotinas: [], freq: "diaria", checklist: [] } : tarefas.find((x) => x.nome === nome);
  tarAberta = novo ? null : nome; rCk = [...(t.checklist || [])];
  const por = new Map(t.rotinas.map((r) => [r.empresa_id, r]));
  const fe = $("#ctEmp").value;
  vinc = E.clientes.map((c) => {
    const r = por.get(c.id), g = (r && r.regra_agendamento) || {};
    return { empresa_id: c.id, rot: r || null, on: !!r || (novo && fe === c.id), ativa: r ? r.situacao === "ativa" : true,
      diaSem: diaSemanaDe(g), dia: diasMes(g)[0] || "", meta: g.dia_meta || "", mes: g.mes || 1, multi: Array.isArray(g.dias_mes) && g.dias_mes.length > 1,
      resp: ((r && r.responsaveis) || [])[0] || "", respOrig: (r && r.responsaveis) || [] };
  });
  const primeira = t.rotinas[0];
  $("#rTit").textContent = novo ? "Nova tarefa" : t.nome;
  $("#rSub").innerHTML = novo ? '<span class="criada">Marque os clientes. Gera as tarefas automaticamente a partir da data escolhida.</span>'
    : `<span class="criada">${t.rotinas.length} cliente(s) · ${esc(t.regra)}</span>`;
  const el = $("#rForm").elements;
  el.nome.value = t.nome; el.tipo.value = t.freq || (primeira ? primeira.frequencia : "diaria");
  el.inicio.value = (primeira && primeira.vigencia_inicio) || somaDias(E.hoje, 1); el.fim.value = (primeira && primeira.vigencia_fim) || "";
  [...$("#rForm").querySelectorAll("input,select")].forEach((i) => (i.disabled = !adm));
  desenharCk(adm); $("#rCkNovo").parentElement.hidden = !adm;
  $("#rSalvar").textContent = adm ? "Salvar" : "Pedir alteração ao Adm";
  $("#rExcluir").hidden = novo || !adm;
  msg("#rMsg", !novo && !t.freq ? "Esta tarefa tem tipos diferentes por cliente. Ao salvar, todos os clientes marcados passam a usar o tipo escolhido acima." : "");
  camposDoTipo(); desenharVinculos();
  abrirGaveta("#rotF");
}

async function salvarTarefa() {
  const el = $("#rForm").elements, adm = permite("rotina"), novo = tarAberta === null;
  const t = novo ? null : tarefas.find((x) => x.nome === tarAberta);
  if (!adm) {   // sem permissão: o banco registra o pedido (antes de validar qualquer coisa)
    const r0 = t && t.rotinas[0];
    const r = await rpc("central_salvar_rotina", { p_id: r0 ? r0.id : null, p_empresa: r0 ? r0.empresa_id : (E.clientes[0] || {}).id || null, p_nome: t ? t.nome : "tarefa nova",
      p_frequencia: r0 ? r0.frequencia : "diaria", p_regra: {}, p_inicio: E.hoje, p_fim: null, p_ativa: true, p_responsaveis: [], p_checklist: [] });
    avisoGravacao(r, ""); $("#rotF").hidden = true; return;
  }
  const tipo = el.tipo.value, nome = el.nome.value.trim(), inicio = el.inicio.value, fim = el.fim.value || null;
  if (!nome) return msg("#rMsg", "Dê um nome à tarefa.");
  if (!inicio) return msg("#rMsg", "Informe a partir de quando vale.");
  if (fim && fim < inicio) return msg("#rMsg", "A data final é antes da inicial.");
  if (novo && tarefas.some((x) => x.nome.toLowerCase() === nome.toLowerCase())) return msg("#rMsg", "Já existe uma tarefa com esse nome: abra ela e marque os clientes.");
  const marcados = vinc.filter((v) => v.on);
  if (!marcados.length) return msg("#rMsg", "Marque pelo menos um cliente.");
  for (const v of marcados) {
    const c = cliente(v.empresa_id).nome;
    if (!v.resp && !v.respOrig.length) return msg("#rMsg", `Escolha o responsável em ${c}.`);
    if ((tipo === "mensal" || tipo === "anual") && !(Number(v.dia) >= 1 && Number(v.dia) <= 31)) return msg("#rMsg", `Informe o dia da entrega em ${c}.`);
    if (tipo === "mensal" && v.meta && Number(v.meta) > Number(v.dia)) return msg("#rMsg", `Em ${c}, a meta não pode ser depois da entrega.`);
  }
  const tirar = vinc.filter((v) => !v.on && v.rot);
  const executar = async () => {
    const falhas = []; let feitos = 0;
    for (const v of marcados) {
      const orig = v.rot, g0 = (orig && orig.regra_agendamento) || {};
      // mantém o que a regra já tinha (ex.: exceções, vários dias) e troca só o que a tela edita
      const regra = { ...g0 };
      if (tipo === "semanal") regra.dia_semana = Number(v.diaSem);
      if (tipo === "mensal" || tipo === "anual") {
        regra.dia_mes = Number(v.dia);
        if (!(tipo === "mensal" && Array.isArray(g0.dias_mes) && Number(g0.dias_mes[0]) === Number(v.dia))) delete regra.dias_mes;
      }
      if (tipo === "mensal") { if (v.meta) regra.dia_meta = Number(v.meta); else delete regra.dia_meta; }
      if (tipo === "anual") regra.mes = Number(v.mes);
      const resp = v.resp && v.resp !== v.respOrig[0] ? [v.resp] : v.respOrig.length ? v.respOrig : [v.resp];
      const p = { p_id: orig ? orig.id : null, p_empresa: v.empresa_id, p_nome: nome, p_frequencia: tipo, p_regra: regra,
        p_inicio: (orig && orig.vigencia_inicio) || inicio, p_fim: fim, p_ativa: !!v.ativa, p_responsaveis: resp, p_checklist: rCk };
      // não mexe no que não mudou (salvar refaz as tarefas futuras daquele cliente)
      const igual = orig && orig.nome === nome && orig.frequencia === tipo && JSON.stringify(orig.regra_agendamento || {}) === JSON.stringify(regra) &&
        (orig.situacao === "ativa") === !!v.ativa && JSON.stringify(orig.responsaveis || []) === JSON.stringify(resp) &&
        JSON.stringify(orig.checklist || []) === JSON.stringify(rCk) && (orig.vigencia_fim || null) === fim;
      if (igual) continue;
      try { await rpc("central_salvar_rotina", p); feitos++; } catch (e) { falhas.push(`${cliente(v.empresa_id).nome}: ${e.message}`); }
    }
    for (const v of tirar) {
      try { await rpc("central_excluir_rotina", { p_id: v.rot.id }); feitos++; } catch (e) { falhas.push(`${cliente(v.empresa_id).nome}: ${e.message}`); }
    }
    await desenharRotinas();
    if (falhas.length) return msg("#rMsg", `Salvo em ${feitos}; não deu em: ${falhas.join(" · ")}`);
    toast(feitos ? `Tarefa salva · ${feitos} cliente(s) atualizado(s) · vale a partir de amanhã` : "Nada mudou");
    $("#rotF").hidden = true;
  };
  if (tirar.length) {
    return perguntar(`Desvincular ${tirar.length} cliente(s)?`, `${esc(tirar.map((v) => cliente(v.empresa_id).nome).join(", "))}: a tarefa para de gerar a partir de amanhã (as futuras em aberto são apagadas). As de hoje e as concluídas ficam no histórico.`,
      [{ txt: "Salvar e desvincular", cls: "red", fn: executar }, { txt: "Voltar" }], true);
  }
  await executar();
}

/* ======================= COLABORADORES + PERMISSÕES ======================= */
const PERM_LINHAS = [
  { k: "ver_todos_clientes", t: "Ver todos os clientes (não só os vinculados)", op: ["s", "n"] },
  { k: "tipos_tarefa", t: "Tarefas que vê", op: ["todas", "mensais_pontuais"] },
  { k: "concluir_outra", t: "Concluir tarefa de outra pessoa", op: ["s", "n"] },
  { k: "transferir", t: "Transferir responsável", op: ["s", "n"] },
  { k: "alterar_datas", t: "Alterar datas da tarefa", op: ["s", "n"] },
  { k: "ver_registros_todos", t: "Ver registros de tempo de todos", op: ["s", "n"] },
  { k: "senha_cadastrar", t: "Cadastrar senha / acesso", op: ["s", "p", "n"] },
  { k: "senha_alterar", t: "Alterar / excluir senha", op: ["s", "p", "n"] },
  { k: "cliente_cadastrar", t: "Cadastrar cliente e editar dados gerais", op: ["s", "p", "n"] },
  { k: "cliente_sensivel", t: "Editar dados sensíveis / encerrar cliente", op: ["s", "p", "n"] },
  { k: "rotina", t: "Cadastrar / alterar rotina de tarefa", op: ["s", "p", "n"] },
  { k: "colaborador", t: "Cadastrar colaborador / trocar papel", op: ["s", "p", "n"] }
];
const PAPEIS = ["estagiaria", "analista", "supervisor", "gestor_financeiro", "administrador"];
const rotPerm = (v) => ({ s: "sim", n: "não", p: "pede ao Adm", todas: "todas", mensais_pontuais: "mensais e pontuais" }[v] || v);
let ccoSit = "1", colabs = [], perms = [], vinculos = [], horas = new Map(), colAberto = null, colVinc = [];

function iniciarColaboradores() {
  liga("#ccoSit", (b) => { ccoSit = b.dataset.v; document.querySelectorAll("#ccoSit button").forEach((x) => x.classList.toggle("on", x === b)); }, () => desenharColaboradores(false).catch(avisoErro));
  $("#ccoRows").addEventListener("click", (ev) => { const tr = ev.target.closest("tr[data-col]"); if (tr) abrirColab(tr.dataset.col); });
  $("#ccoNovo").onclick = () => abrirColab(null);
  $("#cFechar").onclick = $("#cCanc").onclick = () => ($("#colF").hidden = true);
  $("#ccoPapeis").addEventListener("change", (ev) => {
    const s = ev.target.closest(".psel"); if (!s || !ehAdm()) return;
    rpc("central_definir_permissao", { p_papel: s.dataset.pp, p_acao: s.dataset.pk, p_valor: s.value })
      .then(() => { toast("Permissão atualizada"); return desenharColaboradores(); }).catch((e) => { avisoErro(e); desenharColaboradores(); });
  });
  $("#ccoPedLista").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-dec]"); if (!b) return;
    travar(b, async () => { await rpc("central_decidir_solicitacao", { p_id: b.dataset.id, p_aprovar: b.dataset.dec === "1" }); toast(b.dataset.dec === "1" ? "Pedido aprovado" : "Pedido recusado"); await carregarPedidos(); })();
  });
  const el = $("#cForm").elements;
  el.papel.addEventListener("change", () => desenharVinc());
  $("#cClis").addEventListener("click", (ev) => { const b = ev.target.closest("[data-rmv]"); if (b) { colVinc = colVinc.filter((c) => c !== b.dataset.rmv); desenharVinc(); } });
  $("#cClis").addEventListener("change", (ev) => { if (ev.target.id === "cAddCli" && ev.target.value) { colVinc.push(ev.target.value); desenharVinc(); } });
  $("#cSenRedef").onclick = () => { $("#cSenBox").hidden = false; $("#cSenRedef").hidden = true; $("#cSenNova").focus(); };
  $("#cSenGerar").onclick = () => {
    const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789", n = new Uint32Array(14); crypto.getRandomValues(n);
    $("#cSenNova").value = Array.from(n, (x) => c[x % c.length]).join("");
  };
  $("#cSenCopiar").onclick = () => { if ($("#cSenNova").value) copiar($("#cSenNova").value); };
  $("#cForm").onsubmit = (ev) => { ev.preventDefault(); travar($("#cSalvar"), salvarColab)(); };
  $("#cInativar").onclick = () => {
    const c = colabs.find((x) => x.usuario_id === colAberto); if (!c) return;
    const salvar = async (ativo) => { const r = await rpc("central_salvar_colaborador", { p_usuario: c.usuario_id, p_papel: c.papel_central, p_carga: c.carga_horaria_mes, p_ativo: ativo, p_clientes: null });
      avisoGravacao(r, ativo ? "Colaborador reativado" : "Colaborador inativado"); $("#colF").hidden = true; await app.recarregarBase(); await desenharColaboradores(); };
    if (!c.ativo) return salvar(true).catch(avisoErro);
    const sozinho = rotinasDe(c.usuario_id).filter((r) => (r.responsaveis || []).length === 1).length;
    perguntar(`Inativar ${c.nome}?`, `${esc(c.nome)} deixa de entrar no sistema. O histórico fica guardado.${sozinho ? `<br><br><b>${sozinho} rotina(s)</b> têm só ${esc(c.nome)} como responsável: transfira antes em Cadastros › Tarefas.` : ""}`,
      [{ txt: `Inativar ${c.nome}`, cls: "red", fn: () => salvar(false) }, { txt: "Voltar" }], true);
  };
}

let rotinasCache = [];
const rotinasDe = (u) => rotinasCache.filter((r) => r.situacao === "ativa" && (r.responsaveis || []).includes(u));
const veTodos = (papel) => papel === "administrador" || (perms.find((p) => p.papel_central === papel && p.acao === "ver_todos_clientes") || {}).valor === "s";

export async function desenharColaboradores(recarregar = true) {
  if (recarregar) {
    const inicioMes = E.hoje.slice(0, 8) + "01";
    const [cs, perfis, ps, vs, rs, ss] = await Promise.all([
      q(sb.from("central_colaboradores").select("usuario_id, papel_central, carga_horaria_mes, ativo, senha_redefinida_em, senha_redefinida_por, created_at")),
      q(sb.from("perfis_usuarios").select("usuario_id, nome, email")),
      q(sb.from("central_permissoes").select("papel_central, acao, valor")),
      todas(() => sb.from("central_vinculos").select("empresa_id, usuario_id").order("empresa_id")),
      todas(() => sb.from("central_vw_rotinas").select("id, empresa_id, empresa_nome, nome, frequencia, situacao, responsaveis").order("id")),
      todas(() => sb.from("central_vw_sessoes").select("usuario_id, tempo_ativo_segundos").gte("dia", inicioMes).order("id"))
    ]);
    const pf = new Map(perfis.map((p) => [p.usuario_id, p]));
    colabs = cs.map((c) => ({ ...c, nome: (pf.get(c.usuario_id) || {}).nome || "—", email: (pf.get(c.usuario_id) || {}).email || "" })).sort((a, b) => a.nome.localeCompare(b.nome));
    perms = ps; vinculos = vs; rotinasCache = rs;
    horas = new Map(); ss.forEach((s) => horas.set(s.usuario_id, (horas.get(s.usuario_id) || 0) + Number(s.tempo_ativo_segundos || 0)));
    if (ehAdm()) carregarPedidos().catch(avisoErro); else $("#ccoPedidos").hidden = true;
  }
  $("#ccoNovo").hidden = !ehAdm();
  $("#ccoNovo").textContent = "+ Novo colaborador";
  const lista = colabs.filter((c) => ccoSit === "" || String(+c.ativo) === ccoSit);
  $("#ccoRows").innerHTML = lista.map((c) => {
    const nomes = veTodos(c.papel_central) ? "todos" : vinculos.filter((v) => v.usuario_id === c.usuario_id).map((v) => cliente(v.empresa_id).nome).filter((n) => n !== "?").join(", ") || "—";
    const rot = rotinasDe(c.usuario_id).length, h = (horas.get(c.usuario_id) || 0) / 3600, pct = c.carga_horaria_mes ? Math.min(100, (h / c.carga_horaria_mes) * 100) : 0;
    return `<tr data-col="${c.usuario_id}" class="${c.ativo ? "" : "pausada"}">
      <td class="emp"><b>${pp(c.usuario_id)}</b><small>${esc(c.email)}</small></td>
      <td>${esc(PAPEL[c.papel_central] || c.papel_central)}</td>
      <td style="white-space:normal;max-width:260px;font-size:12.5px">${esc(nomes)}</td>
      <td class="n">${rot || '<span class="zero">0</span>'}</td>
      <td>${c.carga_horaria_mes ? `<div class="ocup"><div class="bar2"><i style="width:${pct}%"></i></div>${h.toFixed(1).replace(".", ",")} h / ${c.carga_horaria_mes} h</div>` : '<span class="zero">sem carga definida</span>'}</td>
      <td><span class="tag ${c.ativo ? "t-ok" : "t-plain"}">${c.ativo ? "Ativo" : "Inativo"}</span></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="zero" style="text-align:center;padding:20px">Ninguém aqui</td></tr>';
  const edita = ehAdm(), val = (p, k) => (perms.find((x) => x.papel_central === p && x.acao === k) || {}).valor || "—";
  const cls = (v) => (["s", "n", "p"].includes(v) ? v : "");
  $("#ccoPapeis").innerHTML = `<table class="matriz"><thead><tr><th>${edita ? "Você é Adm: altere direto na tabela" : ""}</th>${PAPEIS.map((p) => `<th>${esc(PAPEL[p])}</th>`).join("")}</tr></thead>
    <tbody>${PERM_LINHAS.map((l) => `<tr><td>${esc(l.t)}</td>${PAPEIS.map((p) => {
      const v = p === "administrador" ? (l.k === "tipos_tarefa" ? "todas" : "s") : val(p, l.k);
      if (!edita || p === "administrador") return `<td><span class="${cls(v)}">${esc(rotPerm(v))}</span></td>`;
      return `<td><select class="psel ${cls(v)}" data-pp="${p}" data-pk="${l.k}" aria-label="${esc(PAPEL[p])}: ${esc(l.t)}">${l.op.map((o) => `<option value="${o}" ${o === v ? "selected" : ""}>${esc(rotPerm(o))}</option>`).join("")}</select></td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;
}

async function carregarPedidos() {
  const ped = await q(sb.from("central_solicitacoes").select("id, solicitante, acao, empresa_id, descricao, created_at").eq("status", "pendente").order("created_at", { ascending: false }).limit(50));
  $("#ccoPedidos").hidden = !ped.length;
  $("#ccoPedLista").innerHTML = ped.map((p) => `<li style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <div style="flex:1;min-width:220px"><b>${esc(nomeDe(p.solicitante))}</b> pediu: ${esc(p.descricao)}${p.empresa_id ? ` <span class="criada">${esc(cliente(p.empresa_id).nome)}</span>` : ""}
      <div class="zero" style="font-size:11.5px">${dmy(p.created_at.slice(0, 10))} ${esc(hhmm(p.created_at))} · aprovar só registra a decisão: faça a alteração no cadastro</div></div>
    <button class="mb" type="button" data-dec="1" data-id="${p.id}">aprovar</button><button class="mb" type="button" data-dec="0" data-id="${p.id}">recusar</button></li>`).join("");
}

function desenharVinc() {
  const papel = $("#cForm").elements.papel.value, edita = ehAdm();
  if (veTodos(papel)) { $("#cClis").innerHTML = '<div class="zero" style="font-size:12.5px">Todos os clientes.</div>'; $("#cCliHint").textContent = "Este papel já vê todos os clientes."; return; }
  $("#cCliHint").textContent = "Vê esses clientes na aba Tarefas.";
  $("#cClis").innerHTML = `<ul class="vlist">${colVinc.map((id) => { const c = cliente(id); return `<li><b>${esc(c.nome)}</b><span class="zero">${esc(c.codigo)} · ${esc(c.razao)}</span>${edita ? `<button type="button" data-rmv="${id}" title="Desvincular">×</button>` : ""}</li>`; }).join("") || '<li class="zero">Nenhum cliente vinculado.</li>'}</ul>` +
    (edita ? `<select id="cAddCli" aria-label="Vincular cliente"><option value="">+ vincular cliente…</option>${E.clientes.filter((c) => !colVinc.includes(c.id)).map((c) => `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`).join("")}</select>` : "");
}

function abrirColab(u) {
  const adm = ehAdm(), novo = u === null;
  const c = novo ? { nome: "", email: "", papel_central: "estagiaria", carga_horaria_mes: 120, ativo: true } : colabs.find((x) => x.usuario_id === u);
  colAberto = u;
  $("#cTit").textContent = novo ? "Novo colaborador" : c.nome;
  $("#cSub").innerHTML = novo ? '<span class="criada">O papel define o que a pessoa pode fazer. O login é criado na hora, com a senha inicial abaixo.</span>'
    : `<span class="tag ${c.ativo ? "t-ok" : "t-plain"}">${c.ativo ? "Ativo" : "Inativo"}</span><span class="criada">${esc(PAPEL[c.papel_central] || "")}</span>`;
  const el = $("#cForm").elements;
  el.nome.value = c.nome; el.email.value = c.email; el.papel.value = c.papel_central; el.carga.value = c.carga_horaria_mes;
  [...$("#cForm").querySelectorAll("input,select")].forEach((i) => (i.disabled = !adm));
  el.nome.disabled = el.email.disabled = !adm || !novo;          // nome e e-mail de login: só na criação
  colVinc = novo ? [] : vinculos.filter((v) => v.usuario_id === u).map((v) => v.empresa_id);
  desenharVinc();
  if (!novo) {
    const rs = rotinasDe(u);
    $("#cResumo").innerHTML = `<h5>Responsável por ${rs.length} rotina(s)</h5>` + (rs.slice(0, 12).map((r) => `<div class="lin"><span>${esc(r.empresa_nome)}</span><span>${esc(r.nome)} <span class="tipo">${esc(FREQ[r.frequencia] || r.frequencia)}</span></span></div>`).join("") || '<div class="zero">Nenhuma.</div>') + (rs.length > 12 ? `<div class="zero">+${rs.length - 12}</div>` : "");
  } else $("#cResumo").innerHTML = "";
  $("#cSenSec").hidden = !adm;
  $("#cSenBox").hidden = !novo; $("#cSenNova").value = ""; $("#cSenRedef").hidden = novo;
  $("#cSenInfo").innerHTML = novo ? "Senha inicial (mínimo 8 caracteres). Passe para a pessoa por um canal seguro." :
    `A senha fica guardada cifrada: nem o Adm consegue ler a atual. ${c.senha_redefinida_em ? `Última redefinição: <b>${dmy(c.senha_redefinida_em.slice(0, 10))} ${esc(hhmm(c.senha_redefinida_em))}</b> por ${esc(nomeDe(c.senha_redefinida_por))}.` : "Nunca redefinida pela Central."}`;
  $("#cSalvar").textContent = adm ? "Salvar" : "Pedir alteração ao Adm";
  $("#cSalvar").disabled = false;
  $("#cInativar").hidden = novo || !adm || u === E.eu.id;
  $("#cInativar").textContent = c.ativo ? "Inativar colaborador" : "Reativar colaborador";
  msg("#cMsg", "");
  abrirGaveta("#colF");
}

async function salvarColab() {
  const el = $("#cForm").elements, adm = ehAdm(), novo = colAberto === null;
  const papel = el.papel.value, carga = Number(el.carga.value) || 0, clientes = veTodos(papel) ? null : [...colVinc];
  const c = novo ? null : colabs.find((x) => x.usuario_id === colAberto);
  if (!adm) {   // pede ao Adm (o banco registra)
    const r = await rpc("central_salvar_colaborador", { p_usuario: c.usuario_id, p_papel: c.papel_central, p_carga: c.carga_horaria_mes, p_ativo: c.ativo, p_clientes: null });
    avisoGravacao(r, ""); $("#colF").hidden = true; return;
  }
  if (carga < 0 || carga > 260) return msg("#cMsg", "Carga horária entre 0 e 260 h.");
  const nova = $("#cSenNova").value;
  if (novo) {
    if (!el.nome.value.trim() || !el.email.value.trim()) return msg("#cMsg", "Preencha nome e e-mail.");
    if (nova.length < 8) return msg("#cMsg", "Defina a senha inicial (mínimo 8 caracteres).");
    await apiAdmin("criar_colaborador", { nome: el.nome.value.trim(), email: el.email.value.trim(), senha: nova, papel, carga, clientes: clientes || [] });
    toast("Colaborador cadastrado · login criado");
  } else {
    if (!$("#cSenBox").hidden && nova && nova.length < 8) return msg("#cMsg", "A senha precisa de pelo menos 8 caracteres.");
    await rpc("central_salvar_colaborador", { p_usuario: c.usuario_id, p_papel: papel, p_carga: carga, p_ativo: c.ativo, p_clientes: clientes });
    if (!$("#cSenBox").hidden && nova) { await apiAdmin("redefinir_senha", { usuario_id: c.usuario_id, senha: nova }); toast("Colaborador atualizado · senha redefinida"); }
    else toast("Colaborador atualizado");
  }
  $("#cSenNova").value = "";
  $("#colF").hidden = true;
  await app.recarregarBase(); await desenharColaboradores();
}
void hms;

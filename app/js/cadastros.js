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
const equipeAtiva = () => [...E.equipe.entries()].filter(([, x]) => x.ativo && x.papel !== "administrador");
const chips = (mapa) => Object.entries(mapa).map(([k, v]) => `<button type="button" data-t="${k}">${v}</button>`).join("");
function liga(sel, set, depois) {      // segmentos e chips
  $(sel).addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; set(b); depois(); });
}

export function iniciar(a) { app = a; iniciarClientes(); iniciarSenhas(); iniciarRotinas(); iniciarColaboradores(); }
export function fechar() { ["#ficha", "#rotF", "#colF"].forEach((s) => ($(s).hidden = true)); }
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
  const gente = equipeAtiva().concat([...E.equipe.entries()].filter(([u, x]) => (c.equipe || []).includes(u) && !(x.ativo && x.papel !== "administrador")));
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
  $("#csNovoAbrir").onclick = () => { $("#csAlt").hidden = true; $("#csNovo").hidden = false; if ($("#csEmp").value) $("#csNEmp").value = $("#csEmp").value; $("#csNSis").focus(); };
  $("#csNovoCanc").onclick = () => { $("#csNovo").hidden = true; $("#csNovo").reset(); };
  $("#csAltCanc").onclick = () => { $("#csAlt").hidden = true; $("#csAlt").reset(); acessoAlt = null; };
  $("#csNovo").onsubmit = (ev) => { ev.preventDefault(); travar(ev.submitter || $("#csNovo .pri"), async () => {
    const r = await rpc("central_salvar_acesso", { p_id: null, p_empresa: $("#csNEmp").value, p_sistema: $("#csNSis").value.trim(), p_tipo: $("#csNTipo").value,
      p_link: $("#csNLink").value.trim() || null, p_usuario: $("#csNUsu").value.trim() || null, p_senha: $("#csNSen").value || null, p_observacoes: $("#csNObs").value.trim() || null });
    $("#csNovo").reset(); $("#csNovo").hidden = true; avisoGravacao(r, "Acesso salvo"); await desenharSenhas();
  })(); };
  $("#csAlt").onsubmit = (ev) => { ev.preventDefault(); travar(ev.submitter || $("#csAlt .pri"), async () => {
    const a = acessoAlt; if (!a) return;
    const r = await rpc("central_salvar_acesso", { p_id: a.id, p_empresa: a.empresa_id, p_sistema: a.sistema, p_tipo: a.tipo,
      p_link: $("#csALink").value.trim(), p_usuario: $("#csAUsu").value.trim(), p_senha: $("#csASen").value || null, p_observacoes: $("#csAObs").value.trim() });
    $("#csAlt").reset(); $("#csAlt").hidden = true; acessoAlt = null; visiveis.delete(a.id); avisoGravacao(r, "Acesso alterado"); await desenharSenhas();
  })(); };
  $("#csRows").addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]"); if (!el) return;
    const a = acessos.find((x) => x.id === el.closest("[data-acc]").dataset.acc); if (!a) return;
    acaoAcesso(a, el.dataset.act).catch(avisoErro);
  });
}

async function acaoAcesso(a, act) {
  if (act === "link") return rpc("central_registrar_acesso", { p_acesso: a.id, p_acao: "abriu o link" });
  if (act === "cu") { await copiar(a.usuario_login || ""); await rpc("central_registrar_acesso", { p_acesso: a.id, p_acao: "copiou o usuário" }); return carregarConsultas(); }
  if (act === "cs") { const s = await rpc("central_revelar_senha", { p_acesso: a.id, p_motivo: "copiou" }); await copiar(s || ""); return carregarConsultas(); }
  if (act === "ver") {
    if (visiveis.has(a.id)) { visiveis.delete(a.id); return desenharSenhas(false); }
    visiveis.set(a.id, await rpc("central_revelar_senha", { p_acesso: a.id, p_motivo: "visualizou" }));
    setTimeout(() => { if (visiveis.delete(a.id)) desenharSenhas(false); }, 30000);   // some sozinha em 30 s
    await desenharSenhas(false); return carregarConsultas();
  }
  if (act === "sol") { const r = await rpc("central_salvar_acesso", { p_id: a.id, p_empresa: a.empresa_id, p_sistema: a.sistema, p_tipo: null, p_link: null, p_usuario: null, p_senha: null, p_observacoes: null }); return avisoGravacao(r, ""); }
  if (act === "alt") {
    acessoAlt = a; $("#csNovo").hidden = true; $("#csAlt").hidden = false;
    $("#csAltTit").textContent = `${cliente(a.empresa_id).nome || ""} · ${a.sistema}`;
    $("#csAUsu").value = a.usuario_login || ""; $("#csALink").value = a.link || ""; $("#csAObs").value = a.observacoes || ""; $("#csASen").value = ""; $("#csASen").focus(); return;
  }
  if (act === "exc") {
    perguntar(`Excluir o acesso ${a.sistema}?`, "Some da lista de senhas do cliente. Fica registrado no histórico.",
      [{ txt: "Excluir acesso", cls: "red", fn: async () => { const r = await rpc("central_excluir_acesso", { p_acesso: a.id }); avisoGravacao(r, "Acesso excluído"); await desenharSenhas(); } }, { txt: "Voltar" }], true);
  }
}

export async function desenharSenhas(recarregar = true) {
  if ($("#csEmp").options.length === 1) {
    E.clientes.forEach((c) => $("#csEmp").insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`));
    $("#csNEmp").innerHTML = E.clientes.map((c) => `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`).join("");
  }
  if (recarregar) {
    acessos = await todas(() => sb.from("central_acessos").select("id, empresa_id, sistema, tipo, link, usuario_login, observacoes, alterada_em, alterada_por").eq("ativo", true).order("id"));
    carregarConsultas().catch(avisoErro);
  }
  $("#csNovoAbrir").textContent = permite("senha_cadastrar") ? "+ Novo acesso" : "+ Novo acesso (vira pedido)";
  const fe = $("#csEmp").value, busca = $("#csQ").value.trim().toLowerCase(), velhas = $("#csVelhas").checked, alt = permite("senha_alterar");
  const dias = (a) => Math.floor((Date.now() - new Date(a.alterada_em).getTime()) / 864e5);
  const lista = acessos.filter((a) => (!fe || a.empresa_id === fe) && (!csTipos.size || csTipos.has(a.tipo)) && (!velhas || dias(a) > VELHA) &&
      (!busca || `${a.sistema} ${a.usuario_login || ""} ${a.observacoes || ""} ${cliente(a.empresa_id).nome}`.toLowerCase().includes(busca)))
    .sort((x, y) => String(cliente(x.empresa_id).codigo).localeCompare(String(cliente(y.empresa_id).codigo)) || x.tipo.localeCompare(y.tipo) || x.sistema.localeCompare(y.sistema));
  $("#csRows").innerHTML = lista.map((a) => {
    const link = linkSeguro(a.link), sen = visiveis.get(a.id), c = cliente(a.empresa_id), d = dias(a);
    return `<tr data-acc="${a.id}">
    <td class="emp"><b>${esc(c.nome)}</b><small>${esc(c.codigo)}</small></td>
    <td><span class="tipo">${esc(STIPO[a.tipo] || a.tipo)}</span> ${esc(a.sistema)}${link ? ` <a class="mb lk" href="${esc(link)}" target="_blank" rel="noopener noreferrer" data-act="link">abrir ↗</a>` : ""}${a.observacoes ? `<div class="zero" style="font-size:11.5px;white-space:normal;max-width:280px">${esc(a.observacoes)}</div>` : ""}</td>
    <td>${a.usuario_login ? `<code>${esc(a.usuario_login)}</code><button class="mb" type="button" data-act="cu">copiar</button>` : '<span class="zero">—</span>'}</td>
    <td>${sen !== undefined ? `<pre class="sen">${esc(sen ?? "(sem senha)")}</pre>` : "<code>••••••••</code>"}<button class="mb" type="button" data-act="ver">${sen !== undefined ? "ocultar" : "mostrar"}</button><button class="mb" type="button" data-act="cs">copiar</button></td>
    <td class="${d > VELHA ? "velha" : "zero"}" title="por ${esc(nomeDe(a.alterada_por))}">${dmy(a.alterada_em.slice(0, 10))}<div style="font-size:11px;font-weight:400">${d} dias</div></td>
    <td>${alt ? '<button class="mb" type="button" data-act="alt">alterar</button><button class="mb" type="button" data-act="exc">excluir</button>' : '<button class="mb" type="button" data-act="sol">solicitar alteração</button>'}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="zero" style="text-align:center;padding:20px">Nenhum acesso com esse filtro</td></tr>';
}

async function carregarConsultas() {
  const regs = await q(sb.from("central_vw_historico").select("created_at, usuario_nome, empresa_nome, descricao")
    .or("descricao.ilike.*senha*,descricao.ilike.*acesso*,descricao.ilike.*link*,descricao.ilike.*usuário*").order("created_at", { ascending: false }).limit(12));
  $("#csCons").innerHTML = regs.map((r) => `<li><small>${dmy(r.created_at.slice(0, 10))} ${esc(hhmm(r.created_at))} · ${esc(r.usuario_nome || "")} · ${esc(r.empresa_nome || "")}</small>${esc(r.descricao)}</li>`).join("")
    || '<li class="vazio">Nenhuma consulta ainda.</li>';
}

/* ======================= TAREFAS (rotinas) ======================= */
const FREQ = { diaria: "Diário", semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal", anual: "Anual" };
const DSEM = { 1: "segunda", 2: "terça", 3: "quarta", 4: "quinta", 5: "sexta", 6: "sábado", 7: "domingo", 0: "domingo" };
const DSEM_TXT = { segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4, sexta: 5 };
const MES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ctTipos = new Set();
let ctSit = "", rotinas = [], rotAberta = null, rCk = [];

const diaSemanaDe = (g) => { const d = g.dia_semana; if (typeof d === "number") return d; const t = String(d || "").toLowerCase().replace("-feira", "").trim(); return DSEM_TXT[t] || Number(t) || 5; };
const diasMes = (g) => (Array.isArray(g.dias_mes) ? g.dias_mes : g.dia_mes ? [g.dia_mes] : []);
function recRot(r) {
  const g = r.regra_agendamento || {};
  if (r.frequencia === "diaria") return "Diária · seg a sex";
  if (r.frequencia === "semanal") return `Semanal · toda ${DSEM[diaSemanaDe(g)]}`;
  if (r.frequencia === "quinzenal") return `Quinzenal · a cada 15 dias desde ${dmy(r.vigencia_inicio)}`;
  if (r.frequencia === "mensal") return `Mensal · entrega dia ${diasMes(g).join(" e ") || "?"}${g.dia_meta ? ` · meta dia ${g.dia_meta}` : ""}`;
  if (r.frequencia === "anual") return `Anual · ${g.dia_mes || "?"} de ${MES[Number(g.mes)] || "?"}`;
  return r.frequencia;
}

function iniciarRotinas() {
  $("#ctTipos").innerHTML = chips(FREQ);
  liga("#ctTipos", (b) => { ctTipos.has(b.dataset.t) ? ctTipos.delete(b.dataset.t) : ctTipos.add(b.dataset.t); b.classList.toggle("on"); }, () => desenharRotinas(false).catch(avisoErro));
  liga("#ctAtiva", (b) => { ctSit = b.dataset.v; document.querySelectorAll("#ctAtiva button").forEach((x) => x.classList.toggle("on", x === b)); }, () => desenharRotinas(false).catch(avisoErro));
  ["#ctEmp", "#ctResp"].forEach((s) => $(s).addEventListener("change", () => desenharRotinas(false).catch(avisoErro)));
  $("#ctQ").addEventListener("input", () => desenharRotinas(false).catch(avisoErro));
  $("#ctRows").addEventListener("click", (ev) => { const tr = ev.target.closest("tr[data-rot]"); if (tr) abrirRotina(tr.dataset.rot); });
  // sem permissão, "nova rotina" vira pedido direto (o banco registra antes de validar)
  $("#ctNova").onclick = () => (permite("rotina") ? abrirRotina(null) : rpc("central_salvar_rotina", { p_id: null, p_empresa: $("#ctEmp").value || (E.clientes[0] || {}).id || null,
    p_nome: "rotina nova", p_frequencia: "diaria", p_regra: {}, p_inicio: E.hoje, p_fim: null, p_ativa: true, p_responsaveis: [], p_checklist: [] }).then((r) => avisoGravacao(r, "")).catch(avisoErro));
  $("#rFechar").onclick = $("#rCanc").onclick = () => ($("#rotF").hidden = true);
  $("#rForm").elements.tipo.addEventListener("change", camposDoTipo);
  $("#rCkAdd").onclick = () => { const v = $("#rCkNovo").value.trim(); if (!v) return; rCk.push(v); $("#rCkNovo").value = ""; desenharCk(true); };
  $("#rCkNovo").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("#rCkAdd").click(); } });
  $("#rCk").addEventListener("click", (ev) => { const b = ev.target.closest("[data-rmck]"); if (b) { rCk.splice(Number(b.dataset.rmck), 1); desenharCk(true); } });
  $("#rForm").onsubmit = (ev) => { ev.preventDefault(); travar($("#rSalvar"), salvarRotina)(); };
  $("#rExcluir").onclick = () => {
    const r = rotinas.find((x) => x.id === rotAberta); if (!r) return;
    perguntar(`Excluir a rotina "${r.nome}" de ${r.empresa_nome}?`, "Para de gerar tarefas a partir de amanhã (as futuras em aberto são apagadas). As de hoje e as já concluídas ficam no histórico.",
      [{ txt: "Excluir rotina", cls: "red", fn: async () => { const x = await rpc("central_excluir_rotina", { p_id: r.id }); avisoGravacao(x, "Rotina excluída"); $("#rotF").hidden = true; await desenharRotinas(); } },
       { txt: "Voltar" }], true);
  };
}

export async function desenharRotinas(recarregar = true) {
  if ($("#ctEmp").options.length === 1) {
    E.clientes.forEach((c) => $("#ctEmp").insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`));
    [...E.equipe.entries()].filter(([, x]) => x.ativo).forEach(([u, x]) => $("#ctResp").insertAdjacentHTML("beforeend", `<option value="${u}">${esc(x.nome)}</option>`));
  }
  if (recarregar) rotinas = await todas(() => sb.from("central_vw_rotinas").select("*").order("id"));
  const adm = permite("rotina");
  $("#ctNova").textContent = adm ? "+ Nova rotina" : "Pedir rotina nova ao Adm";
  $("#ctFoot").textContent = adm ? "Clique numa rotina para alterar, pausar ou excluir. Mudanças valem a partir de amanhã: as tarefas futuras em aberto são refeitas."
    : "Só o Adm cadastra, altera ou exclui rotinas. Clique numa rotina para ver os detalhes ou pedir alteração.";
  const fe = $("#ctEmp").value, fr = $("#ctResp").value, busca = $("#ctQ").value.trim().toLowerCase();
  const ord = { diaria: 1, semanal: 2, quinzenal: 3, mensal: 4, anual: 5 };
  const lista = rotinas.filter((r) => (!fe || r.empresa_id === fe) && (!fr || (r.responsaveis || []).includes(fr)) && (!ctTipos.size || ctTipos.has(r.frequencia)) &&
      (!ctSit || r.situacao === ctSit) && (!busca || r.nome.toLowerCase().includes(busca)))
    .sort((a, b) => String(a.empresa_codigo).localeCompare(String(b.empresa_codigo)) || (ord[a.frequencia] || 9) - (ord[b.frequencia] || 9) || a.nome.localeCompare(b.nome));
  $("#ctRows").innerHTML = lista.map((r) => `<tr data-rot="${r.id}" class="${r.situacao === "ativa" ? "" : "pausada"}">
    <td class="emp"><b>${esc(r.empresa_nome)}</b><small>${esc(r.empresa_codigo)}</small></td>
    <td>${esc(r.nome)} <span class="tipo">${esc(FREQ[r.frequencia] || r.frequencia)}</span></td>
    <td style="font-size:12.5px">${esc(recRot(r))}${r.vigencia_fim ? `<div class="zero" style="font-size:11px">até ${dmy(r.vigencia_fim)}</div>` : ""}</td>
    <td>${(r.responsaveis || []).map(pp).join(" ") || '<span class="zero">—</span>'}</td>
    <td class="n">${(r.checklist || []).length ? `${r.checklist.length} itens` : '<span class="zero">—</span>'}</td>
    <td><span class="tag ${r.situacao === "ativa" ? "t-ok" : "t-plain"}">${r.situacao === "ativa" ? "Ativa" : "Pausada"}</span></td></tr>`).join("")
    || '<tr><td colspan="6" class="zero" style="text-align:center;padding:20px">Nenhuma rotina com esse filtro</td></tr>';
}

function desenharCk(edita) {
  $("#rCk").innerHTML = rCk.map((it, i) => `<li><span>${esc(it)}</span>${edita ? `<button type="button" class="rm" data-rmck="${i}" title="Remover">×</button>` : ""}</li>`).join("") || '<li class="zero">Sem checklist.</li>';
}
function camposDoTipo() { const tp = $("#rForm").elements.tipo.value; document.querySelectorAll("#rForm [data-so]").forEach((l) => (l.hidden = !l.dataset.so.split(" ").includes(tp))); }

function abrirRotina(id) {
  const adm = permite("rotina"), novo = id === null;
  const r = novo ? { empresa_id: $("#ctEmp").value || "", nome: "", frequencia: "diaria", regra_agendamento: {}, responsaveis: [], checklist: [], situacao: "ativa", vigencia_inicio: somaDias(E.hoje, 1), vigencia_fim: null }
    : rotinas.find((x) => x.id === id);
  rotAberta = novo ? null : id; rCk = [...(r.checklist || [])];
  const g = r.regra_agendamento || {};
  $("#rTit").textContent = novo ? "Nova rotina" : `${r.nome} · ${r.empresa_nome}`;
  $("#rSub").innerHTML = novo ? '<span class="criada">Gera as tarefas automaticamente a partir da data escolhida.</span>'
    : `<span class="tag ${r.situacao === "ativa" ? "t-ok" : "t-plain"}">${r.situacao === "ativa" ? "Ativa" : "Pausada"}</span><span class="criada">${esc(recRot(r))}</span>`;
  const el = $("#rForm").elements;
  el.nome.value = r.nome; el.tipo.value = r.frequencia; el.diaSem.value = String(Math.min(5, Math.max(1, diaSemanaDe(g))));
  el.dia.value = diasMes(g)[0] || ""; el.meta.value = g.dia_meta || ""; el.mes.value = String(g.mes || 1);
  el.inicio.value = r.vigencia_inicio || ""; el.fim.value = r.vigencia_fim || ""; el.ativa.checked = r.situacao === "ativa";
  [...$("#rForm").querySelectorAll("input,select")].forEach((i) => (i.disabled = !adm));
  $("#rCliSec").querySelector("h5").textContent = novo ? "Clientes" : "Cliente";
  $("#rCliHint").hidden = !novo;
  $("#rClis").innerHTML = novo ? E.clientes.map((c) => `<label><input type="checkbox" value="${c.id}" ${r.empresa_id === c.id ? "checked" : ""}>${esc(c.codigo)} · ${esc(c.nome)}</label>`).join("")
    : `<span class="pp" style="background:var(--line2)">${esc(r.empresa_codigo)} · ${esc(r.empresa_nome)}</span>`;
  const gente = new Map(equipeAtiva()); (r.responsaveis || []).forEach((u) => gente.set(u, E.equipe.get(u) || { nome: nomeDe(u) }));
  $("#rResp").innerHTML = [...gente.entries()].map(([u, x]) => `<label><input type="checkbox" value="${u}" ${(r.responsaveis || []).includes(u) ? "checked" : ""} ${adm ? "" : "disabled"}>${esc(x.nome)}</label>`).join("");
  desenharCk(adm); $("#rCkNovo").parentElement.hidden = !adm;
  $("#rSalvar").textContent = adm ? "Salvar" : "Pedir alteração ao Adm";
  $("#rExcluir").hidden = novo || !adm;
  const varios = !novo && r.frequencia === "mensal" && Array.isArray(g.dias_mes) && g.dias_mes.length > 1;
  msg("#rMsg", varios ? `Esta rotina entrega em vários dias do mês (${g.dias_mes.join(" e ")}). Se mudar o dia da entrega, passa a ser um dia só.` : "");
  camposDoTipo();
  abrirGaveta("#rotF");
}

async function salvarRotina() {
  const el = $("#rForm").elements, adm = permite("rotina"), novo = rotAberta === null;
  const orig = novo ? null : rotinas.find((x) => x.id === rotAberta);
  if (!adm) {   // sem permissão: o banco registra o pedido (antes de validar qualquer coisa)
    const r = await rpc("central_salvar_rotina", { p_id: rotAberta, p_empresa: orig ? orig.empresa_id : ($("#ctEmp").value || E.clientes[0]?.id || null), p_nome: orig ? orig.nome : "rotina nova",
      p_frequencia: orig ? orig.frequencia : "diaria", p_regra: {}, p_inicio: E.hoje, p_fim: null, p_ativa: true, p_responsaveis: [], p_checklist: [] });
    avisoGravacao(r, ""); $("#rotF").hidden = true; return;
  }
  const tipo = el.tipo.value, dia = Number(el.dia.value) || null, meta = Number(el.meta.value) || null;
  const resp = [...document.querySelectorAll("#rResp input:checked")].map((i) => i.value);
  const nome = el.nome.value.trim();
  if (!nome) return msg("#rMsg", "Dê um nome à tarefa.");
  if (!resp.length) return msg("#rMsg", "Escolha pelo menos um responsável.");
  if ((tipo === "mensal" || tipo === "anual") && !dia) return msg("#rMsg", "Informe o dia da entrega.");
  if (tipo === "mensal" && meta && meta > dia) return msg("#rMsg", "A meta não pode ser depois da entrega.");
  if (!el.inicio.value) return msg("#rMsg", "Informe a partir de quando vale.");
  if (el.fim.value && el.fim.value < el.inicio.value) return msg("#rMsg", "A data final é antes da inicial.");
  // mantém o que a regra já tinha (ex.: exceções) e troca só o que a tela edita
  const regra = { ...((orig && orig.regra_agendamento) || {}) };
  if (tipo === "semanal") regra.dia_semana = Number(el.diaSem.value);
  if (tipo === "mensal" || tipo === "anual") {
    const antes = orig && orig.regra_agendamento && Array.isArray(orig.regra_agendamento.dias_mes) ? orig.regra_agendamento.dias_mes : null;
    regra.dia_mes = dia;
    if (antes && Number(antes[0]) === dia && tipo === "mensal") regra.dias_mes = antes; else delete regra.dias_mes;
  }
  if (tipo === "mensal") { if (meta) regra.dia_meta = meta; else delete regra.dia_meta; }
  if (tipo === "anual") regra.mes = Number(el.mes.value);
  const base = { p_nome: nome, p_frequencia: tipo, p_regra: regra, p_inicio: el.inicio.value, p_fim: el.fim.value || null, p_ativa: el.ativa.checked, p_responsaveis: resp, p_checklist: rCk };
  if (!novo) {
    const r = await rpc("central_salvar_rotina", { p_id: orig.id, p_empresa: orig.empresa_id, ...base });
    avisoGravacao(r, "Rotina atualizada · vale a partir de amanhã");
  } else {
    const alvo = [...document.querySelectorAll("#rClis input:checked")].map((i) => i.value);
    if (!alvo.length) return msg("#rMsg", "Escolha pelo menos um cliente.");
    const falhas = [];
    for (const emp of alvo) {
      try { await rpc("central_salvar_rotina", { p_id: null, p_empresa: emp, ...base }); }
      catch (e) { falhas.push(`${cliente(emp).nome}: ${e.message}`); }
    }
    if (falhas.length) { await desenharRotinas(); return msg("#rMsg", `Criada em ${alvo.length - falhas.length} de ${alvo.length}. ${falhas.join(" · ")}`); }
    toast(`${alvo.length} rotina(s) criada(s)`);
  }
  $("#rotF").hidden = true;
  await desenharRotinas();
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

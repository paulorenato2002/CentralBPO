// Seções além da Operação: Início, Comercial (Carteira, Preços e contratos), Onboarding, Perfis e Institucional.
// Só leitura. O que já existe no banco (equipe, tarefas, honorários, cronômetro, acessos, rotinas, fotos) aparece de verdade;
// o que ainda não tem tabela fica marcado como ilustrativo. Nada aqui grava.
import { sb, todas } from "./api.js";
import { E, cliente, pode } from "./estado.js";
import { $, esc, dmy, somaDias, diaSemana, avisoErro } from "./ui.js";
import { avatar, logo, imagem } from "./imagens.js";

export const VIEWS = { inicio: "Início", institucional: "Institucional", carteira: "Carteira de clientes", precos: "Preços, planos e contratos",
  onboarding: "Onboarding", perfis: "Perfis da equipe" };
export const eh = (v) => v in VIEWS;

const PAPEL = { estagiaria: "Estagiária", analista: "Analista", supervisor: "Supervisor", gestor_financeiro: "Gestor financeiro", administrador: "Administrador" };
const brl = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const hh = (h) => (h < 1 ? Math.round(h * 60) + " min" : h.toFixed(1).replace(".", ",") + " h");
const ilus = '<span class="pvtag">ilustrativo</span>', real = '<span class="pvtag ok">dado real</span>';
const equipeAtiva = () => [...E.equipe.entries()].filter(([, x]) => x.ativo).map(([id, x]) => ({ id, ...x }));
const primeiro = (n) => String(n || "").split(" ")[0];
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
let conteudo = null;   // textos do Institucional (central_conteudo)
async function lerConteudo() {
  if (conteudo) return conteudo;
  const { data } = await sb.from("central_conteudo").select("dados").eq("chave", "institucional").maybeSingle();
  return (conteudo = (data && data.dados) || {});
}

export async function desenhar(view) {
  const alvo = $("#pvConteudo");
  $("#pvFaixa").hidden = view === "institucional";
  alvo.innerHTML = '<div class="zero" style="padding:24px">Carregando…</div>';
  try { alvo.innerHTML = await ({ inicio, institucional, carteira, precos, onboarding, perfis })[view](); ligar(view); }
  catch (e) { alvo.innerHTML = ""; avisoErro(e); }
}
function ligar(view) {
  if (view === "precos") {
    const calc = () => { const h = Number($("#simH").value || 0), v = Number($("#simV").value || 0), m = Number($("#simM").value || 0); $("#simR").textContent = brl(h * v * (1 + m / 100)); };
    ["#simH", "#simV", "#simM"].forEach((s) => $(s).addEventListener("input", calc)); calc();
  }
}

/* ---------------- Início ---------------- */
async function inicio() {
  const h = E.hoje;
  const ts = await todas(() => sb.from("central_vw_tarefas").select("id, empresa_id, status, alvo, atrasada, responsaveis")
    .or(`and(alvo.gte.${somaDias(h, -7)},alvo.lte.${h}),atrasada.eq.true`).order("id"));
  // dia de referência: hoje; se hoje não tem tarefa (fim de semana, feriado), o último dia útil que teve
  const dias = [...new Set(ts.map((t) => t.alvo))].filter((d) => d <= h).sort();
  const ref = ts.some((t) => t.alvo === h) || !dias.length ? h : dias[dias.length - 1];
  const rotulo = ref === h ? "hoje" : `${DIAS[diaSemana(ref)]}, ${dmy(ref).slice(0, 5)}`;
  const pessoas = equipeAtiva().map((p) => {
    const m = ts.filter((t) => (t.responsaveis || []).includes(p.id));
    const dia = m.filter((t) => t.alvo === ref), ok = dia.filter((t) => t.status === "concluida").length;
    return { ...p, total: dia.length, ok, atr: m.filter((t) => t.atrasada).length };
  }).sort((a, b) => b.total - a.total);
  const tot = ts.filter((t) => t.alvo === ref), feitas = tot.filter((t) => t.status === "concluida").length, atr = ts.filter((t) => t.atrasada).length;
  const pct = tot.length ? Math.round((feitas / tot.length) * 100) : 0;
  const estado = (p) => (p.atr ? "bad" : p.total && p.ok === p.total ? "ok" : p.total ? "and" : "liv");

  // planta: uma mesa por pessoa, a cor da borda é o dia dela
  const cols = Math.min(4, Math.max(1, pessoas.length)), W = 190, H = 96, G = 18;
  const largura = 60 + cols * W + (cols - 1) * G;
  const mesas = pessoas.map((p, i) => {
    const x = 30 + (i % cols) * (W + G), y = 64 + Math.floor(i / cols) * (H + G), foto = imagem("pessoa:" + p.id);
    return `<g class="mesa ${estado(p)}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8"/>
      <clipPath id="cp${i}"><circle cx="${x + 30}" cy="${y + 32}" r="20"/></clipPath>
      ${foto ? `<image href="${foto}" x="${x + 10}" y="${y + 12}" width="40" height="40" clip-path="url(#cp${i})" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="${x + 30}" cy="${y + 32}" r="20"/><text x="${x + 30}" y="${y + 37}" text-anchor="middle" class="av">${esc(primeiro(p.nome)[0] || "?")}</text>`}
      <text x="${x + 60}" y="${y + 28}" class="nm">${esc(primeiro(p.nome))}</text><text x="${x + 60}" y="${y + 45}" class="pp">${esc(PAPEL[p.papel] || "")}</text>
      <text x="${x + 12}" y="${y + 82}" class="st">${p.total ? `${p.ok}/${p.total} ${rotulo === "hoje" ? "hoje" : "no dia"}` : "nada no dia"}${p.atr ? ` · ${p.atr} atrasada${p.atr > 1 ? "s" : ""}` : ""}</text></g>`;
  }).join("");
  const alt = 64 + Math.ceil(Math.max(1, pessoas.length) / cols) * (H + G) + 20;
  const planta = `<svg viewBox="0 0 ${largura} ${alt}" class="planta" role="img" aria-label="Planta do escritório com a mesa de cada pessoa">
    <rect x="8" y="8" width="${largura - 16}" height="${alt - 16}" rx="14" class="sala"/>
    <text x="30" y="42" class="sl">Escritório Effective · ${esc(rotulo)}</text>${mesas}</svg>`;

  return `<div class="pvhero"><div><h2>Boas-vindas à Effective</h2><p>BPO financeiro: cuidamos do dia a dia financeiro dos clientes com rotina, prazo e conferência. Aqui você vê quem está em quê e como está o dia.</p></div>
      <div class="pvanel" style="--p:${pct}"><b>${pct}%</b><span>entregue ${esc(rotulo)}</span></div></div>
    <div class="pvnums"><div><b>${tot.length}</b><span>tarefas ${esc(rotulo)}</span></div><div><b>${feitas}</b><span>concluídas</span></div>
      <div class="${atr ? "bad" : ""}"><b>${atr}</b><span>atrasadas</span></div><div><b>${E.clientes.length}</b><span>clientes atendidos</span></div></div>
    <div class="blk"><div class="blkhd">Planta do escritório ${real}</div>${planta}
      <div class="pvleg"><span class="ok">tudo entregue</span><span class="and">em andamento</span><span class="bad">com atraso</span><span class="liv">sem tarefas no dia</span></div></div>
    <div class="blk" style="margin-top:14px"><div class="blkhd">Quem faz o quê ${esc(rotulo)} ${real}</div>
      <div class="pvpess">${pessoas.map((p) => `<div class="pvp ${estado(p)}">${avatar(p.id, p.nome)}<div><b>${esc(p.nome)}</b><small>${esc(PAPEL[p.papel] || "")}</small>
        <div class="bar2"><i style="width:${p.total ? (p.ok / p.total) * 100 : 0}%"></i></div><small>${p.total ? `${p.ok} de ${p.total} tarefas` : "sem tarefas no dia"}${p.atr ? ` · <b class="tbad">${p.atr} atrasada(s)</b>` : ""}</small></div></div>`).join("")}</div></div>`;
}

/* ---------------- Institucional ---------------- */
async function institucional() {
  const [ct, rots] = await Promise.all([lerConteudo(), todas(() => sb.from("central_vw_rotinas").select("empresa_id, nome, frequencia, responsaveis, situacao").order("id"))]);
  const ativas = rots.filter((r) => r.situacao === "ativa");
  const papelDe = (id) => ((ct.pessoas || []).find((p) => p.usuario_id === id) || {});
  const equipe = equipeAtiva().map((p) => ({ ...p, ...papelDe(p.id) }));
  const niveis = ct.niveis && ct.niveis.length ? ct.niveis : [{ t: "Equipe", d: "" }];
  const nivelDe = (p) => (Number.isInteger(p.nivel) ? Math.min(p.nivel, niveis.length - 1) : niveis.length - 1);
  const organo = niveis.map((n, i) => {
    const ps = equipe.filter((p) => nivelDe(p) === i);
    return ps.length ? `<div class="inv"><div class="invhd"><b>${esc(n.t)}</b><small>${esc(n.d || "")}</small></div>
      <div class="invps">${ps.map((p) => `<div class="inp">${avatar(p.id, p.nome, "g")}<b>${esc(p.nome)}</b><small>${esc(p.papel_txt || PAPEL[p.papel] || "")}</small></div>`).join("")}</div></div>` : "";
  }).filter(Boolean).join('<div class="inseta" aria-hidden="true">↓</div>');
  const ciclo = (ct.ciclo || []).map((c, i) => `<li><i>${i + 1}</i><b>${esc(c.t)}</b><small>${esc(c.x)}</small></li>`).join("");
  const subDe = (codigo) => ((ct.clientes || []).find((c) => String(c.codigo) === String(codigo)) || {}).sub || "";
  const clientes = E.clientes.map((c) => {
    const rs = ativas.filter((r) => r.empresa_id === c.id), quem = [...new Set(rs.flatMap((r) => r.responsaveis || []))];
    const n = (f) => rs.filter((r) => r.frequencia === f).length;
    return `<div class="icli">${logo(c.id, c.nome)}<div><b>${esc(c.nome)}</b><small>${esc(subDe(c.codigo) || c.codigo)}</small>
      <div class="icn"><span>${n("diaria")} diárias</span><span>${n("semanal")} semanais</span><span>${n("mensal") + n("quinzenal") + n("anual")} mensais+</span></div>
      <div class="iqm">${quem.map((u) => avatar(u, (E.equipe.get(u) || {}).nome || "", "p")).join("")}</div></div></div>`;
  }).join("");
  const mapaTipo = ct.tarefas_tipo || {};
  const tipos = (ct.tipos || []).map((t) => {
    const ts = [...new Set(ativas.filter((r) => mapaTipo[r.nome] === t.id).map((r) => r.nome))];
    return `<div class="itp"><b>${esc(t.t)}</b><p>${esc(t.d)}</p>${ts.length ? `<ul>${ts.slice(0, 6).map((n) => `<li>${esc(n)}</li>`).join("")}${ts.length > 6 ? `<li class="zero">+${ts.length - 6}</li>` : ""}</ul>` : ""}</div>`;
  }).join("");
  const parceiros = [...E.imgs.keys()].filter((k) => k.startsWith("parceiro:"));
  return `<div class="ihero">${imagem("parceiro:effective") ? `<img src="${imagem("parceiro:effective")}" alt="Effective">` : ""}
      <div><h2>${esc(ct.titulo || "Como a Effective trabalha")}</h2><p>${esc(ct.intro || "Quem é quem, como o cliente entra e anda com a gente, e o que fazemos por ele todo dia.")}</p></div></div>
    <div class="blk"><div class="blkhd">Quem é quem</div><div class="iorg">${organo}</div></div>
    ${ciclo ? `<div class="blk" style="margin-top:14px"><div class="blkhd">Como o cliente anda com a gente</div><ol class="iciclo">${ciclo}</ol></div>` : ""}
    <div class="blk" style="margin-top:14px"><div class="blkhd">Nossos clientes ${real}</div><div class="iclis">${clientes}</div></div>
    ${tipos ? `<div class="blk" style="margin-top:14px"><div class="blkhd">Tudo o que fazemos, por assunto ${real}</div><div class="itps">${tipos}</div></div>` : ""}
    ${parceiros.filter((k) => k !== "parceiro:effective").length ? `<div class="blk" style="margin-top:14px"><div class="blkhd">Parceiros</div><div class="iparc">${parceiros.filter((k) => k !== "parceiro:effective").map((k) => `<img src="${imagem(k)}" alt="${esc(k.slice(9))}">`).join("")}</div></div>` : ""}`;
}

/* ---------------- Comercial · carteira ---------------- */
async function lerCarteira() {
  const de = somaDias(E.hoje, -90);
  const [cc, sess] = await Promise.all([
    todas(() => sb.from("central_clientes").select("empresa_id, honorario_mensal, plano, situacao, inicio_contrato").order("empresa_id")),
    todas(() => sb.from("central_vw_sessoes").select("empresa_id, dia, tempo_ativo_segundos").gte("dia", de).order("id"))
  ]);
  // horas por mês: média dos meses com cronômetro nos últimos 90 dias (cliente novo não fica com média baixa)
  const seg = new Map(), dias = new Map();
  sess.forEach((s) => { seg.set(s.empresa_id, (seg.get(s.empresa_id) || 0) + Number(s.tempo_ativo_segundos || 0)); (dias.get(s.empresa_id) || dias.set(s.empresa_id, new Set()).get(s.empresa_id)).add(s.dia.slice(0, 7)); });
  return cc.filter((c) => c.situacao !== "encerrada" && E.clientes.some((x) => x.id === c.empresa_id)).map((c) => {
    const meses = Math.max(1, (dias.get(c.empresa_id) || new Set()).size), h = (seg.get(c.empresa_id) || 0) / 3600 / meses;
    const v = c.honorario_mensal == null ? null : Number(c.honorario_mensal);
    return { id: c.empresa_id, c: cliente(c.empresa_id), plano: c.plano, inicio: c.inicio_contrato, h, v, vh: v != null && h > 0 ? v / h : null };
  });
}
async function carteira() {
  const L = await lerCarteira(), ver = pode("cliente_sensivel");
  let comDado = L.filter((l) => l.v != null && l.h > 0), exemplo = false;
  if (comDado.length < 3) {   // sem honorário/cronômetro suficiente: mostra como vai ficar com clientes de exemplo
    exemplo = true;
    comDado = [["Cliente A", 2400, 9], ["Cliente B", 1800, 22], ["Cliente C", 3500, 18], ["Cliente D", 900, 6], ["Cliente E", 1200, 16], ["Cliente F", 2900, 30]]
      .map(([nome, v, h]) => ({ id: null, c: { nome, codigo: "exemplo" }, plano: null, h, v, vh: v / h }));
  }
  const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const mh = mediana(comDado.map((l) => l.h)), mv = mediana(comDado.map((l) => l.v));
  const quad = (l) => (l.v >= mv ? (l.h <= mh ? ["q1", "Melhor relação"] : ["q2", "Grande e trabalhoso"]) : (l.h <= mh ? ["q3", "Pequeno e leve"] : ["q4", "Rever preço"]));
  const W = 600, H = 320, P = 44, mxH = Math.max(1, ...comDado.map((l) => l.h)) * 1.12, mxV = Math.max(1, ...comDado.map((l) => l.v)) * 1.12;
  const X = (h) => P + (h / mxH) * (W - P - 14), Y = (v) => H - P - (v / mxV) * (H - P - 14);
  const pts = comDado.map((l) => { const dir = X(l.h) > W * 0.7;
    return `<g class="pt ${quad(l)[0]}"><circle cx="${X(l.h)}" cy="${Y(l.v)}" r="7"><title>${esc(l.c.nome)}: ${ver || exemplo ? brl(l.v) : "honorário oculto"} · ${hh(l.h)}/mês</title></circle>
    <text x="${dir ? X(l.h) - 11 : X(l.h) + 11}" y="${Y(l.v) + 4}" text-anchor="${dir ? "end" : "start"}">${esc(l.c.nome)}</text></g>`; }).join("");
  const grafico = `<svg viewBox="0 0 ${W} ${H}" class="quad" role="img" aria-label="Clientes por honorário e horas">
      <rect x="${P}" y="14" width="${X(mh) - P}" height="${Y(mv) - 14}" class="z1"/><rect x="${X(mh)}" y="${Y(mv)}" width="${W - 14 - X(mh)}" height="${H - P - Y(mv)}" class="z4"/>
      <line x1="${X(mh)}" y1="14" x2="${X(mh)}" y2="${H - P}" class="md"/><line x1="${P}" y1="${Y(mv)}" x2="${W - 14}" y2="${Y(mv)}" class="md"/>
      <line x1="${P}" y1="${H - P}" x2="${W - 14}" y2="${H - P}" class="ax"/><line x1="${P}" y1="14" x2="${P}" y2="${H - P}" class="ax"/>
      <text x="${W - 14}" y="${H - 14}" text-anchor="end" class="lb">horas por mês →</text><text x="${P + 6}" y="30" class="lb">↑ honorário</text>
      <text x="${P + 8}" y="${Y(mv) - 8}" class="qz">melhor relação</text><text x="${W - 20}" y="${H - P - 8}" text-anchor="end" class="qz">rever preço</text>${pts}</svg>`;
  const linhas = [...(exemplo ? comDado : L)].sort((a, b) => (b.vh ?? -1) - (a.vh ?? -1)).map((l) => {
    const q = l.v != null && l.h > 0 ? quad(l) : null;
    return `<tr><td class="emp"><div class="cl">${l.id ? logo(l.id, l.c.nome, "p") : ""}<span><b>${esc(l.c.nome)}</b><small>${esc(l.c.codigo)}${l.plano ? " · " + esc(l.plano) : ""}</small></span></div></td>
      <td class="n">${ver || exemplo ? brl(l.v) : "•••"}</td><td class="n">${l.h ? hh(l.h) : '<span class="zero">—</span>'}</td><td class="n"><b>${l.vh && (ver || exemplo) ? brl(l.vh) : "—"}</b></td>
      <td>${q ? `<span class="qt ${q[0]}">${q[1]}</span>` : '<span class="zero">falta dado</span>'}</td></tr>`;
  }).join("");
  return `<p class="pvintro">Do cliente que mais rende por hora ao que pede revisão de preço. Honorário do cadastro × horas do cronômetro (média por mês, últimos 90 dias).</p>
    <div class="cols2"><div class="blk"><div class="blkhd">Quadrante honorário × horas ${exemplo ? ilus : real}</div>${grafico}</div>
    <div class="blk"><div class="blkhd">Ranking por valor da hora ${exemplo ? ilus : real}</div><div class="tbl"><table><thead><tr><th class="nosort">Cliente</th><th class="nosort n">Honorário</th><th class="nosort n">Horas/mês</th><th class="nosort n">R$/hora</th><th class="nosort">Quadrante</th></tr></thead>
      <tbody class="static">${linhas || '<tr><td colspan="5" class="zero">Sem clientes.</td></tr>'}</tbody></table></div></div></div>`;
}

/* ---------------- Comercial · preços, planos e contratos ---------------- */
async function precos() {
  const L = await lerCarteira(), ver = pode("cliente_sensivel");
  const comVh = L.filter((l) => l.vh), vhMedio = comVh.length ? Math.round(comVh.reduce((a, l) => a + l.vh, 0) / comVh.length) : 120;
  const porPlano = new Map(); L.forEach((l) => { const k = l.plano || "Sem plano definido"; (porPlano.get(k) || porPlano.set(k, []).get(k)).push(l); });
  const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const planos = [...porPlano.entries()].sort((a, b) => b[1].length - a[1].length).map(([nome, ls]) => {
    const hon = media(ls.filter((l) => l.v != null).map((l) => l.v)), hrs = media(ls.filter((l) => l.h > 0).map((l) => l.h));
    return `<div class="pvplano"><b>${esc(nome)}</b><span>${ls.length} cliente${ls.length > 1 ? "s" : ""}</span>
      <div class="pvlogos">${ls.map((l) => logo(l.id, l.c.nome, "p")).join("")}</div>
      <p>${hrs ? `~${hh(hrs)} de trabalho por mês` : "sem horas no cronômetro ainda"}</p><em>${ver ? (hon ? brl(hon) + "/mês em média" : "honorário não cadastrado") : "honorário oculto"}</em></div>`;
  }).join("");
  const proxRenov = (ini) => { if (!ini) return null; let d = ini; while (d < E.hoje) d = `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`; return d; };
  const contratos = L.slice().sort((a, b) => (proxRenov(a.inicio) || "9").localeCompare(proxRenov(b.inicio) || "9")).map((l) => {
    const r = proxRenov(l.inicio), dias = r ? Math.round((new Date(r) - new Date(E.hoje)) / 864e5) : null;
    return `<li><div class="cl">${logo(l.id, l.c.nome, "p")}<span><b>${esc(l.c.nome)}</b><small>${l.inicio ? `desde ${dmy(l.inicio)}` : "início do contrato não cadastrado"}${r ? ` · renova em ${dmy(r)}${dias <= 60 ? ` <b class="tbad">(${dias} dias)</b>` : ""}` : ""}</small></span></div></li>`;
  }).join("");
  return `<p class="pvintro">Os planos de hoje, o cálculo do preço e os contratos num lugar só. Os planos vêm do cadastro dos clientes; a tabela oficial de preços entra quando estiver no banco.</p>
    <div class="blkhd" style="margin-bottom:8px">Planos em uso ${real}</div>
    <div class="pvplanos">${planos || '<div class="zero">Nenhum plano cadastrado nos clientes.</div>'}</div>
    <div class="cols2" style="margin-top:14px"><div class="blk"><div class="blkhd">Simulador de preço ${comVh.length ? real : ilus}</div>
      <div class="pvsim"><label>Horas estimadas por mês<input id="simH" type="number" min="0" value="12"></label>
      <label>Valor da hora (R$) <small class="zero">${comVh.length ? "média da carteira hoje" : "exemplo"}</small><input id="simV" type="number" min="0" value="${vhMedio}"></label>
      <label>Margem de segurança (%)<input id="simM" type="number" min="0" value="15"></label>
      <div class="pvres">Preço sugerido <b id="simR">—</b></div></div></div>
    <div class="blk"><div class="blkhd">Contratos e renovações ${real}</div><ul class="pvlista">${contratos}</ul></div></div>`;
}

/* ---------------- Onboarding ---------------- */
const ETAPAS = ["Contrato assinado", "Formulário de entrada", "Cadastro no sistema", "Documentos essenciais", "Acessos (bancos, e-mail, cartão)", "Rotinas configuradas", "Início da operação"];
async function onboarding() {
  const [cc, acs, rots] = await Promise.all([
    todas(() => sb.from("central_clientes").select("empresa_id, situacao, inicio_contrato").order("empresa_id")),
    todas(() => sb.from("central_acessos").select("empresa_id").eq("ativo", true).order("id")),
    todas(() => sb.from("central_vw_rotinas").select("empresa_id, situacao").order("id"))
  ]);
  const nA = (id) => acs.filter((a) => a.empresa_id === id).length, nR = (id) => rots.filter((r) => r.empresa_id === id && r.situacao === "ativa").length;
  const trilha = (ok, grande) => { const atual = ok.findIndex((x) => !x);
    return `<ol class="trilha ${grande ? "g" : ""}">${ETAPAS.map((e, i) => `<li class="${ok[i] ? "ok" : i === atual ? "at" : ""}"><i>${ok[i] ? "✓" : i + 1}</i><span>${e}</span></li>`).join("")}</ol>`; };
  const exemploOk = [true, true, true, false, false, false, false];
  // o que o banco confirma hoje: cadastro, acessos e rotinas; contrato pela data de início; operação = situação ativa
  const linhas = cc.filter((c) => c.situacao !== "encerrada" && E.clientes.some((x) => x.id === c.empresa_id)).map((c) => {
    const ok = [!!c.inicio_contrato || c.situacao === "ativa", c.situacao === "ativa", true, c.situacao === "ativa", nA(c.empresa_id) > 0, nR(c.empresa_id) > 0, c.situacao === "ativa"];
    const feitas = ok.filter(Boolean).length, cl = cliente(c.empresa_id);
    const falta = ETAPAS.filter((_, i) => !ok[i]);
    return `<tr><td class="emp"><div class="cl">${logo(c.empresa_id, cl.nome, "p")}<span><b>${esc(cl.nome)}</b><small>${c.inicio_contrato ? "entrada em " + dmy(c.inicio_contrato) : "sem data de entrada"}</small></span></div></td>
      <td><div class="obar"><div class="bar2"><i style="width:${(feitas / ETAPAS.length) * 100}%"></i></div><span>${feitas}/${ETAPAS.length}</span></div></td>
      <td class="n">${nA(c.empresa_id)}</td><td class="n">${nR(c.empresa_id)}</td>
      <td>${falta.length ? `<small>${esc(falta.join(" · "))}</small>` : '<span class="qt q1">operando</span>'}</td></tr>`;
  }).join("");
  return `<p class="pvintro">Da largada à linha de chegada: o que já foi feito, em que etapa o cliente está e o que falta para começar a operação.</p>
    <div class="blk"><div class="blkhd">Cliente novo, como vai ser ${ilus}</div>
      <div class="ohd"><b>Cliente exemplo</b><small>entrada em ${dmy(somaDias(E.hoje, -6))} · 6 dias de onboarding</small><span>etapa ${exemploOk.indexOf(false) + 1} de ${ETAPAS.length}</span></div>
      ${trilha(exemploOk, true)}
      <div class="ochegada"><span>🏁 largada</span><span>linha de chegada: início da operação</span></div></div>
    <div class="blk" style="margin-top:14px"><div class="blkhd">Clientes atuais ${real}</div>
      <div class="tbl"><table><thead><tr><th class="nosort">Cliente</th><th class="nosort">Andamento</th><th class="nosort n">Acessos</th><th class="nosort n">Rotinas</th><th class="nosort">Falta</th></tr></thead>
      <tbody class="static">${linhas}</tbody></table></div>
      <div class="foot"><span>Hoje o banco confirma cadastro, acessos e rotinas. Formulário e documentos passam a contar quando o onboarding tiver tela própria.</span></div></div>
    <div class="cols2" style="margin-top:14px"><div class="blk"><div class="blkhd">Formulário de entrada ${ilus}</div><ul class="pvlista">
      <li><b>Dados da empresa</b><small>razão social, CNPJ, regime, endereço, contatos</small></li><li><b>Bancos e cartões</b><small>instituições, contas, plataforma de cartão</small></li>
      <li><b>Rotina financeira</b><small>dias de pagamento, folha, fornecedores principais</small></li><li><b>Acessos</b><small>quem libera, e-mail financeiro, sistema usado</small></li></ul></div>
    <div class="blk"><div class="blkhd">Checklist de documentos ${ilus}</div><ul class="pvlista ck">
      <li>Contrato social e cartão CNPJ</li><li>Extratos dos últimos 3 meses</li><li>Relação de contas a pagar em aberto</li><li>Folha de pagamento e pró-labore</li><li>Contratos recorrentes (aluguel, sistemas)</li></ul></div></div>`;
}

/* ---------------- Configurações · perfis ---------------- */
async function perfis() {
  const [rots, ct] = await Promise.all([todas(() => sb.from("central_vw_rotinas").select("empresa_id, responsaveis, situacao").order("id")), lerConteudo()]);
  return `<p class="pvintro">O perfil de cada pessoa da equipe.</p>
    <div class="pvperfis">${equipeAtiva().map((p) => {
      const minhas = rots.filter((r) => r.situacao === "ativa" && (r.responsaveis || []).includes(p.id)), cl = [...new Set(minhas.map((r) => r.empresa_id))];
      const txt = ((ct.pessoas || []).find((x) => x.usuario_id === p.id) || {}).papel_txt;
      return `<div class="pvperfil">${avatar(p.id, p.nome, "xg")}<b>${esc(p.nome)}</b><small>${esc(txt || PAPEL[p.papel] || p.papel)}</small>
        <div class="pvpn"><span><b>${cl.length}</b> clientes</span><span><b>${minhas.length}</b> rotinas</span></div>
        <div class="pvlogos">${cl.map((id) => logo(id, cliente(id).nome, "p")).join("")}</div></div>`;
    }).join("")}</div>`;
}

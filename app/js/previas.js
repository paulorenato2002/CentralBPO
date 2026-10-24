// Prévias das próximas partes da Central: Início, Comercial, Onboarding e Perfis.
// Só leitura. O que já existe no banco (equipe, tarefas, honorários, cronômetro, acessos, rotinas) aparece de verdade;
// o que ainda não tem tabela fica marcado como ilustrativo. Nada aqui grava.
import { sb, todas } from "./api.js";
import { E, cliente } from "./estado.js";
import { $, esc, dmy, somaDias, avisoErro } from "./ui.js";

export const VIEWS = { inicio: "Início", carteira: "Carteira de clientes", precos: "Preços, planos e contratos", vendas: "Métricas de vendas",
  onboarding: "Onboarding", perfis: "Perfis da equipe" };
export const eh = (v) => v in VIEWS;

const PAPEL = { estagiaria: "Estagiária", analista: "Analista", supervisor: "Supervisor", gestor_financeiro: "Gestor financeiro", administrador: "Administrador" };
const ini = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
const brl = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const hh = (h) => (h < 1 ? Math.round(h * 60) + " min" : h.toFixed(1).replace(".", ",") + " h");
const ilus = '<span class="pvtag">ilustrativo</span>', real = '<span class="pvtag ok">dado real</span>';
const equipeAtiva = () => [...E.equipe.entries()].filter(([, x]) => x.ativo).map(([id, x]) => ({ id, ...x }));

export async function desenhar(view) {
  const alvo = $("#pvConteudo");
  alvo.innerHTML = '<div class="zero" style="padding:24px">Carregando…</div>';
  try { alvo.innerHTML = await ({ inicio, carteira, precos, vendas, onboarding, perfis })[view](); }
  catch (e) { alvo.innerHTML = ""; avisoErro(e); }
}

/* ---------------- Início ---------------- */
async function inicio() {
  const h = E.hoje;
  const ts = await todas(() => sb.from("central_vw_tarefas").select("id, empresa_id, status, alvo, atrasada, responsaveis").or(`alvo.eq.${h},atrasada.eq.true`).order("id"));
  const pessoas = equipeAtiva().map((p) => {
    const m = ts.filter((t) => (t.responsaveis || []).includes(p.id));
    const hoje = m.filter((t) => t.alvo === h), ok = hoje.filter((t) => t.status === "concluida").length;
    return { ...p, total: hoje.length, ok, atr: m.filter((t) => t.atrasada).length };
  }).sort((a, b) => b.total - a.total);
  const tot = ts.filter((t) => t.alvo === h), feitas = tot.filter((t) => t.status === "concluida").length, atr = ts.filter((t) => t.atrasada).length;
  const pct = tot.length ? Math.round((feitas / tot.length) * 100) : 0;
  const estado = (p) => (p.atr ? "bad" : p.total && p.ok === p.total ? "ok" : p.total ? "and" : "liv");

  // planta: uma mesa por pessoa, a cor da mesa é o dia dela
  const cols = 4, W = 176, H = 92;
  const mesas = pessoas.map((p, i) => {
    const x = 30 + (i % cols) * (W + 18), y = 64 + Math.floor(i / cols) * (H + 18);
    return `<g class="mesa ${estado(p)}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8"/>
      <circle cx="${x + 26}" cy="${y + 30}" r="15"/><text x="${x + 26}" y="${y + 35}" text-anchor="middle" class="av">${esc(ini(p.nome))}</text>
      <text x="${x + 50}" y="${y + 27}" class="nm">${esc(p.nome.split(" ")[0])}</text><text x="${x + 50}" y="${y + 44}" class="pp">${esc(PAPEL[p.papel] || "")}</text>
      <text x="${x + 14}" y="${y + 76}" class="st">${p.total ? `${p.ok}/${p.total} hoje` : "nada hoje"}${p.atr ? ` · ${p.atr} atrasada${p.atr > 1 ? "s" : ""}` : ""}</text></g>`;
  }).join("");
  const alt = 64 + Math.ceil(Math.max(1, pessoas.length) / cols) * (H + 18) + 20;
  const planta = `<svg viewBox="0 0 ${30 * 2 + cols * W + (cols - 1) * 18} ${alt}" class="planta" role="img" aria-label="Planta do escritório com a mesa de cada pessoa">
    <rect x="8" y="8" width="${30 * 2 + cols * W + (cols - 1) * 18 - 16}" height="${alt - 16}" rx="14" class="sala"/>
    <text x="30" y="42" class="sl">Escritório Effective · operação de hoje</text>${mesas}</svg>`;

  return `<div class="pvhero"><div><h2>Boas-vindas à Effective</h2><p>BPO financeiro: a gente cuida do dia a dia financeiro dos clientes com rotina, prazo e conferência. Aqui você vê quem está em quê e como está o dia.</p></div>
      <div class="pvanel" style="--p:${pct}"><b>${pct}%</b><span>do dia entregue</span></div></div>
    <div class="pvnums"><div><b>${tot.length}</b><span>tarefas para hoje</span></div><div><b>${feitas}</b><span>concluídas</span></div>
      <div class="${atr ? "bad" : ""}"><b>${atr}</b><span>atrasadas</span></div><div><b>${E.clientes.length}</b><span>clientes atendidos</span></div></div>
    <div class="blk"><div class="blkhd">Planta do escritório ${real}</div>${planta}
      <div class="pvleg"><span class="ok">tudo entregue</span><span class="and">em andamento</span><span class="bad">com atraso</span><span class="liv">sem tarefas hoje</span></div></div>
    <div class="blk" style="margin-top:14px"><div class="blkhd">Quem faz o quê hoje ${real}</div>
      <div class="pvpess">${pessoas.map((p) => `<div class="pvp ${estado(p)}"><span class="avt">${esc(ini(p.nome))}</span><div><b>${esc(p.nome)}</b><small>${esc(PAPEL[p.papel] || "")}</small>
        <div class="bar2"><i style="width:${p.total ? (p.ok / p.total) * 100 : 0}%"></i></div><small>${p.total ? `${p.ok} de ${p.total} tarefas de hoje` : "sem tarefas hoje"}${p.atr ? ` · <b class="tbad">${p.atr} atrasada(s)</b>` : ""}</small></div></div>`).join("")}</div></div>`;
}

/* ---------------- Comercial · carteira ---------------- */
async function carteira() {
  const de = somaDias(E.hoje, -90);
  const [cc, sess] = await Promise.all([
    todas(() => sb.from("central_clientes").select("empresa_id, honorario_mensal, plano, situacao").order("empresa_id")),
    todas(() => sb.from("central_vw_sessoes").select("empresa_id, tempo_ativo_segundos").gte("dia", de).order("id"))
  ]);
  const seg = new Map(); sess.forEach((s) => seg.set(s.empresa_id, (seg.get(s.empresa_id) || 0) + Number(s.tempo_ativo_segundos || 0)));
  const L = cc.filter((c) => c.situacao !== "encerrada").map((c) => {
    const h = (seg.get(c.empresa_id) || 0) / 3600 / 3, v = c.honorario_mensal == null ? null : Number(c.honorario_mensal);
    return { c: cliente(c.empresa_id), plano: c.plano, h, v, vh: v != null && h > 0 ? v / h : null };
  });
  let comDado = L.filter((l) => l.v != null && l.h > 0), exemplo = false;
  if (comDado.length < 3) {   // sem honorário/cronômetro suficiente: mostra como vai ficar com clientes de exemplo
    exemplo = true;
    comDado = [["Cliente A", 2400, 9], ["Cliente B", 1800, 22], ["Cliente C", 3500, 18], ["Cliente D", 900, 6], ["Cliente E", 1200, 16], ["Cliente F", 2900, 30]]
      .map(([nome, v, h]) => ({ c: { nome, codigo: "exemplo" }, plano: null, h, v, vh: v / h }));
  }
  const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const mh = mediana(comDado.map((l) => l.h)), mv = mediana(comDado.map((l) => l.v));
  const quad = (l) => (l.v >= mv ? (l.h <= mh ? ["q1", "Melhor relação"] : ["q2", "Grande e trabalhoso"]) : (l.h <= mh ? ["q3", "Pequeno e leve"] : ["q4", "Rever preço"]));
  const W = 560, H = 300, P = 40, mxH = Math.max(1, ...comDado.map((l) => l.h)) * 1.1, mxV = Math.max(1, ...comDado.map((l) => l.v)) * 1.1;
  const X = (h) => P + (h / mxH) * (W - P - 10), Y = (v) => H - P - (v / mxV) * (H - P - 10);
  const pts = comDado.map((l) => `<g class="pt ${quad(l)[0]}"><circle cx="${X(l.h)}" cy="${Y(l.v)}" r="7"><title>${esc(l.c.nome)}: ${brl(l.v)} · ${hh(l.h)}/mês · ${brl(l.vh)}/h</title></circle>
    <text x="${X(l.h) > W * 0.75 ? X(l.h) - 10 : X(l.h) + 10}" y="${Y(l.v) + 4}" text-anchor="${X(l.h) > W * 0.75 ? "end" : "start"}">${esc(l.c.nome)}</text></g>`).join("");
  const grafico = comDado.length ? `<svg viewBox="0 0 ${W} ${H}" class="quad" role="img" aria-label="Clientes por honorário e horas">
      <rect x="${P}" y="10" width="${X(mh) - P}" height="${Y(mv) - 10}" class="z1"/><rect x="${X(mh)}" y="${Y(mv)}" width="${W - 10 - X(mh)}" height="${H - P - Y(mv)}" class="z4"/>
      <line x1="${X(mh)}" y1="10" x2="${X(mh)}" y2="${H - P}" class="md"/><line x1="${P}" y1="${Y(mv)}" x2="${W - 10}" y2="${Y(mv)}" class="md"/>
      <line x1="${P}" y1="${H - P}" x2="${W - 10}" y2="${H - P}" class="ax"/><line x1="${P}" y1="10" x2="${P}" y2="${H - P}" class="ax"/>
      <text x="${W - 10}" y="${H - 12}" text-anchor="end" class="lb">horas por mês →</text><text x="${P + 4}" y="24" class="lb">↑ honorário</text>
      <text x="${P + 8}" y="${Y(mv) - 8}" class="qz">melhor relação</text><text x="${W - 16}" y="${H - P - 8}" text-anchor="end" class="qz">rever preço</text>${pts}</svg>`
    : '<div class="zero" style="padding:20px">Precisa de honorário cadastrado e tempo no cronômetro para montar o quadrante.</div>';
  const linhas = [...(exemplo ? comDado : L)].sort((a, b) => (b.vh ?? -1) - (a.vh ?? -1)).map((l) => {
    const q = l.v != null && l.h > 0 ? quad(l) : null;
    return `<tr><td class="emp"><b>${esc(l.c.nome)}</b><small>${esc(l.c.codigo)}${l.plano ? " · " + esc(l.plano) : ""}</small></td>
      <td class="n">${brl(l.v)}</td><td class="n">${l.h ? hh(l.h) : '<span class="zero">—</span>'}</td><td class="n"><b>${l.vh ? brl(l.vh) : "—"}</b></td>
      <td>${q ? `<span class="qt ${q[0]}">${q[1]}</span>` : '<span class="zero">falta dado</span>'}</td></tr>`;
  }).join("");
  return `<p class="pvintro">Do cliente que mais rende por hora ao que pede revisão de preço. Honorário do cadastro × horas do cronômetro (média dos últimos 90 dias).</p>
    <div class="cols2"><div class="blk"><div class="blkhd">Quadrante honorário × horas ${exemplo ? ilus : real}</div>${grafico}</div>
    <div class="blk"><div class="blkhd">Ranking por valor da hora ${exemplo ? ilus : real}</div><div class="tbl"><table><thead><tr><th class="nosort">Cliente</th><th class="nosort n">Honorário</th><th class="nosort n">Horas/mês</th><th class="nosort n">R$/hora</th><th class="nosort">Quadrante</th></tr></thead>
      <tbody class="static">${linhas || '<tr><td colspan="5" class="zero">Sem clientes.</td></tr>'}</tbody></table></div></div></div>`;
}

/* ---------------- Comercial · preços, planos e contratos ---------------- */
async function precos() {
  const planos = [["Essencial", "Contas a pagar e a receber, conciliação semanal, relatório mensal", "até 8 h/mês"],
    ["Profissional", "Tudo do Essencial + conciliação diária, fluxo de caixa e reunião mensal", "até 20 h/mês"],
    ["Premium", "Tudo do Profissional + DRE gerencial, orçamento e analista dedicado", "sob medida"]];
  setTimeout(() => {   // simulador: horas estimadas × valor-hora alvo
    const calc = () => { const h = Number($("#simH").value || 0), v = Number($("#simV").value || 0), m = Number($("#simM").value || 0);
      $("#simR").textContent = brl(h * v * (1 + m / 100)); };
    ["#simH", "#simV", "#simM"].forEach((s) => $(s) && $(s).addEventListener("input", calc)); if ($("#simH")) calc();
  });
  return `<p class="pvintro">Os planos, o cálculo do preço e os contratos num lugar só. Os planos abaixo são exemplo: os de verdade entram quando a tabela de preços estiver no banco.</p>
    <div class="pvplanos">${planos.map(([n, d, h], i) => `<div class="pvplano ${i === 1 ? "dest" : ""}"><b>${n}</b><p>${d}</p><span>${h}</span><em>R$ —/mês</em></div>`).join("")}</div>
    <div class="cols2" style="margin-top:14px"><div class="blk"><div class="blkhd">Simulador de preço ${ilus}</div>
      <div class="pvsim"><label>Horas estimadas por mês<input id="simH" type="number" min="0" value="12"></label>
      <label>Valor da hora (R$)<input id="simV" type="number" min="0" value="120"></label>
      <label>Margem de segurança (%)<input id="simM" type="number" min="0" value="15"></label>
      <div class="pvres">Preço sugerido <b id="simR">—</b></div></div></div>
    <div class="blk"><div class="blkhd">Contratos ${ilus}</div><ul class="pvlista">
      <li><b>Modelo de contrato BPO</b><small>versão vigente · assinatura digital</small></li>
      <li><b>Aditivo de escopo</b><small>quando o cliente muda de plano</small></li>
      <li><b>Renovações do mês</b><small>lista automática pela data de início do contrato</small></li></ul></div></div>`;
}

/* ---------------- Comercial · métricas de vendas ---------------- */
async function vendas() {
  const cc = await todas(() => sb.from("central_clientes").select("empresa_id, honorario_mensal, situacao, inicio_contrato").order("empresa_id"));
  const ativos = cc.filter((c) => c.situacao !== "encerrada"), mrr = ativos.reduce((a, c) => a + Number(c.honorario_mensal || 0), 0);
  const tick = ativos.filter((c) => c.honorario_mensal).length ? mrr / ativos.filter((c) => c.honorario_mensal).length : null;
  const funil = [["Contatos", 40], ["Reuniões", 18], ["Propostas", 9], ["Fechados", 4]];
  return `<p class="pvintro">Como a Effective vende: carteira, receita recorrente e funil comercial.</p>
    <div class="blkhd" style="margin-bottom:8px">Carteira hoje ${real}</div>
    <div class="pvnums"><div><b>${ativos.length}</b><span>clientes ativos</span></div><div><b>${brl(mrr)}</b><span>receita mensal (honorários)</span></div>
      <div><b>${brl(tick)}</b><span>ticket médio</span></div><div><b>${cc.filter((c) => c.situacao === "encerrada").length}</b><span>encerrados</span></div></div>
    <div class="blk"><div class="blkhd">Funil do trimestre ${ilus}</div><div class="pvfunil">${funil.map(([n, v], i) => `<div style="width:${100 - i * 18}%"><b>${v}</b> ${n}${i ? ` <small>${Math.round((v / funil[i - 1][1]) * 100)}% da etapa anterior</small>` : ""}</div>`).join("")}</div></div>`;
}

/* ---------------- Onboarding ---------------- */
const ETAPAS = ["Contrato assinado", "Formulário de entrada", "Cadastro no sistema", "Documentos essenciais", "Acessos (bancos, e-mail, cartão)", "Rotinas configuradas", "Início da operação"];
async function onboarding() {
  const [cc, acs, rots] = await Promise.all([
    todas(() => sb.from("central_clientes").select("empresa_id, situacao, inicio_contrato").order("empresa_id")),
    todas(() => sb.from("central_acessos").select("empresa_id").eq("ativo", true).order("id")),
    todas(() => sb.from("central_vw_rotinas").select("empresa_id").order("id"))
  ]);
  const temA = new Set(acs.map((a) => a.empresa_id)), temR = new Set(rots.map((r) => r.empresa_id));
  // o que dá para saber do banco hoje: cadastro, acessos e rotinas; o resto entra quando o onboarding tiver tabela
  const passos = (c) => { const op = c.situacao === "ativa";
    return [op || !!c.inicio_contrato, op, true, op, temA.has(c.empresa_id), temR.has(c.empresa_id), op]; };
  const lista = cc.filter((c) => c.situacao !== "encerrada").sort((a, b) => (a.situacao === "implantacao" ? -1 : 1) - (b.situacao === "implantacao" ? -1 : 1));
  const trilha = (nome, sub, ok) => { const n = ok.filter(Boolean).length, atual = ok.findIndex((x) => !x);
    return `<div class="trilha"><div class="trhd"><b>${esc(nome)}</b><small>${sub}</small><span class="${n === ok.length ? "tok" : ""}">${n === ok.length ? "operação iniciada" : `etapa ${atual + 1} de ${ok.length}`}</span></div>
      <ol>${ETAPAS.map((e, i) => `<li class="${ok[i] ? "ok" : i === atual ? "at" : ""}"><i>${ok[i] ? "✓" : i + 1}</i><span>${e}</span></li>`).join("")}</ol></div>`; };
  const exemplo = trilha("Cliente exemplo (novo)", `entrada em ${dmy(somaDias(E.hoje, -6))} · ilustrativo`, [true, true, true, false, false, false, false]);
  return `<p class="pvintro">Da largada à linha de chegada: o que já foi feito, em que etapa o cliente está e o que falta para começar a operação.</p>
    <div class="blk"><div class="blkhd">Como vai ser um cliente novo ${ilus}</div>${exemplo}</div>
    <div class="blk" style="margin-top:14px"><div class="blkhd">Clientes atuais pelo que o banco já sabe ${real}</div>${lista.map((c) => trilha(cliente(c.empresa_id).nome,
      `${c.inicio_contrato ? "entrada em " + dmy(c.inicio_contrato) : "sem data de entrada"} · ${c.situacao === "implantacao" ? "em implantação" : "ativo"}`, passos(c))).join("")}</div>
    <div class="cols2" style="margin-top:14px"><div class="blk"><div class="blkhd">Formulário de entrada ${ilus}</div><ul class="pvlista">
      <li><b>Dados da empresa</b><small>razão social, CNPJ, regime, endereço, contatos</small></li><li><b>Bancos e cartões</b><small>instituições, contas, plataforma de cartão</small></li>
      <li><b>Rotina financeira</b><small>dias de pagamento, folha, fornecedores principais</small></li><li><b>Acessos</b><small>quem libera, e-mail financeiro, sistema usado</small></li></ul></div>
    <div class="blk"><div class="blkhd">Checklist de documentos ${ilus}</div><ul class="pvlista ck">
      <li>Contrato social e cartão CNPJ</li><li>Extratos dos últimos 3 meses</li><li>Relação de contas a pagar em aberto</li><li>Folha de pagamento e pró-labore</li><li>Contratos recorrentes (aluguel, sistemas)</li></ul></div></div>`;
}

/* ---------------- Configurações · perfis ---------------- */
async function perfis() {
  const rots = await todas(() => sb.from("central_vw_rotinas").select("empresa_id, responsaveis, situacao").order("id"));
  return `<p class="pvintro">O perfil de cada pessoa da equipe. As fotos entram aqui assim que forem enviadas.</p>
    <div class="pvperfis">${equipeAtiva().map((p) => {
      const minhas = rots.filter((r) => r.situacao === "ativa" && (r.responsaveis || []).includes(p.id)), cl = new Set(minhas.map((r) => r.empresa_id));
      return `<div class="pvperfil"><span class="foto">${esc(ini(p.nome))}</span><b>${esc(p.nome)}</b><small>${esc(PAPEL[p.papel] || p.papel)}</small>
        <div class="pvpn"><span><b>${cl.size}</b> clientes</span><span><b>${minhas.length}</b> rotinas</span></div>
        <small class="zero">${[...cl].slice(0, 4).map((id) => esc(cliente(id).nome)).join(", ")}${cl.size > 4 ? "…" : ""}</small></div>`;
    }).join("")}</div>`;
}

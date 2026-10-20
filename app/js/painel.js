// Home (análise do fluxo de entrega) e Calendário da operação. Só leitura: tudo vem de central_vw_tarefas,
// que já filtra pelo que a pessoa pode ver (clientes vinculados e tipos do papel).
import { sb, todas } from "./api.js";
import { E, cliente, nomeDe } from "./estado.js";
import { $, esc, dmy, somaDias, diaSemana, hojeISO, TIPO, avisoErro } from "./ui.js";

let app = null;   // { entrar(id), abrirCartao(id) }
const SEL = "id, empresa_id, titulo, tipo_recorrencia, status, prazo, data_meta, alvo, atrasada, concluida_em, concluida_por, duracao_segundos, responsaveis";
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const feita = (t) => t.status === "concluida";
const util = (iso) => diaSemana(iso) % 6 !== 0;
const diaDe = (ts) => hojeISO(new Date(ts));                       // dia (São Paulo) de um timestamp
const inicioDia = (iso) => `${iso}T00:00:00-03:00`, fimDia = (iso) => `${iso}T23:59:59.999-03:00`;
const primeiroDoMes = (iso, n = 0) => { const d = new Date(iso.slice(0, 7) + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const ultimoDoMes = (iso) => somaDias(primeiroDoMes(iso, 1), -1);
const chipsTipo = () => Object.entries(TIPO).map(([k, v]) => `<button type="button" data-t="${k}">${v}</button>`).join("");
const minha = (t) => (t.responsaveis || []).includes(E.eu.id);

// Cor por cliente no calendário. O índice vem da ordem de E.clientes (que já vem
// por código), então a cor de cada cliente não muda de uma sessão para outra.
// São 6 faixas; com mais de 6 clientes a sétima volta à primeira — o nome
// continua escrito ao lado, a cor é só para separar o bloco no olho.
const corCli = (id) => {
  const i = E.clientes.findIndex((c) => c.id === id);
  return i < 0 ? "" : ` cl${i % 6}`;
};
// Letra do tipo de rotina: D S Q M A P. Serve para distinguir duas tarefas do
// mesmo cliente no mesmo dia sem ter de ler o título inteiro.
const LETRA = { diaria: "D", semanal: "S", quinzenal: "Q", mensal: "M", anual: "A", pontual: "P" };
const selo = (t) => `<i class="tp t-${t.tipo_recorrencia}" title="${esc(TIPO[t.tipo_recorrencia] || "")}">${LETRA[t.tipo_recorrencia] || "·"}</i>`;

export function iniciar(a) {
  app = a;
  iniciarHome(); iniciarAgenda();
}

/* ================= Home ================= */
let per = "hoje", soMinhas = false;
const hTipos = new Set();
let pedidoHome = 0;

function iniciarHome() {
  $("#tTipos").innerHTML = chipsTipo();
  $("#tTipos").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return;
    hTipos.has(b.dataset.t) ? hTipos.delete(b.dataset.t) : hTipos.add(b.dataset.t); b.classList.toggle("on"); desenharHome().catch(avisoErro); });
  $("#tPer").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return;
    per = b.dataset.v; $("#tCustom").hidden = per !== "custom";
    if (per === "custom" && !$("#tDe").value) { $("#tDe").value = primeiroDoMes(E.hoje); $("#tAte").value = E.hoje; }
    document.querySelectorAll("#tPer button").forEach((x) => x.classList.toggle("on", x === b)); desenharHome().catch(avisoErro); });
  $("#tMinhas").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return;
    soMinhas = !!b.dataset.v; document.querySelectorAll("#tMinhas button").forEach((x) => x.classList.toggle("on", x === b)); desenharHome().catch(avisoErro); });
  ["#tDe", "#tAte"].forEach((s) => $(s).addEventListener("change", () => desenharHome().catch(avisoErro)));
  $("#tRows").addEventListener("click", (ev) => { const b = ev.target.closest("[data-abrir]"); if (b) app.entrar(b.dataset.abrir); });
}

function periodo() {
  const h = E.hoje;
  if (per === "custom") { let a = $("#tDe").value || primeiroDoMes(h), b = $("#tAte").value || h; if (a > b) [a, b] = [b, a]; return [a, b]; }
  if (per === "hoje") return [h, h];
  if (per === "semana") { const a = somaDias(h, -diaSemana(h)); return [a, somaDias(a, 6)]; }
  return [primeiroDoMes(h), ultimoDoMes(h)];
}

// dias do gráfico 1: os dias úteis do período; se for um dia só, os 10 dias úteis até ele
function diasDoGrafico(ini, fim) {
  const dias = [];
  if (ini === fim) { for (let d = fim; dias.length < 10; d = somaDias(d, -1)) if (util(d)) dias.unshift(d); }
  else for (let d = ini; d <= fim; d = somaDias(d, 1)) if (util(d)) dias.push(d);
  return dias;
}

export async function desenharHome() {
  const meu = ++pedidoHome;
  const [ini, fim] = periodo(), hj = E.hoje, dias = diasDoGrafico(ini, fim);
  $("#tPerTxt").textContent = ini === fim ? dmy(ini) : `${dmy(ini)} a ${dmy(fim)}`;
  const de = [ini, hj, dias[0] || ini].sort()[0], ate = [fim, hj].sort()[1];
  const [doPeriodo, atrasadas, tempos] = await Promise.all([
    todas(() => sb.from("central_vw_tarefas").select(SEL).gte("alvo", de).lte("alvo", ate).order("id")),
    todas(() => sb.from("central_vw_tarefas").select(SEL).eq("atrasada", true).order("id")),
    todas(() => sb.from("central_vw_tarefas").select("titulo, tipo_recorrencia, responsaveis, concluida_por, concluida_em, duracao_segundos")
      .eq("status", "concluida").not("duracao_segundos", "is", null)
      .gte("concluida_em", inicioDia(somaDias(ini, -90))).lte("concluida_em", fimDia(fim)).order("concluida_em").order("titulo"))
  ]);
  if (meu !== pedidoHome) return;   // o filtro mudou no meio do caminho
  desenharTempoPorCliente(ini, fim).catch(avisoErro);
  const vis = (t) => (!soMinhas || minha(t) || t.concluida_por === E.eu.id) && (!hTipos.size || hTipos.has(t.tipo_recorrencia));
  const porId = new Map([...doPeriodo, ...atrasadas].map((t) => [t.id, t]));
  const ts = [...porId.values()].filter(vis);
  const noPer = (t) => t.alvo >= ini && t.alvo <= fim;

  const grupos = new Map(E.clientes.map((c) => [c.id, { atr: 0, hoje: 0, prev: 0, ok: 0 }]));
  ts.forEach((t) => {
    const g = grupos.get(t.empresa_id); if (!g) return;
    if (t.atrasada) g.atr++;
    else if (!feita(t) && t.alvo === hj) g.hoje++;
    else if (!feita(t) && t.alvo > hj && noPer(t)) g.prev++;
    if (feita(t) && noPer(t)) g.ok++;
  });
  const soma = (k) => [...grupos.values()].reduce((a, g) => a + g[k], 0);
  $("#tCounts").innerHTML = `<div class="${soma("atr") ? "bad" : ""}"><b>${soma("atr")}</b><span>atrasadas</span></div>
    <div><b>${soma("hoje")}</b><span>para hoje, em aberto</span></div>
    <div><b>${soma("prev")}</b><span>previstas no período</span></div>
    <div><b>${soma("ok")}</b><span>concluídas no período</span></div>`;

  const num = (n) => (n ? `<span>${n}</span>` : '<span class="zero">0</span>');
  $("#tRows").innerHTML = E.clientes.map((c) => ({ c, g: grupos.get(c.id) }))
    .sort((a, b) => b.g.atr - a.g.atr || String(a.c.codigo).localeCompare(String(b.c.codigo)))
    .map(({ c, g }) => {
      const tot = g.hoje + g.prev + g.ok, pct = tot ? Math.round((g.ok / tot) * 100) : 0;
      return `<tr>
        <td class="emp"><b>${esc(c.nome)}</b><small>${esc(c.codigo)} · ${esc(c.razao)}</small></td>
        <td class="n">${g.atr ? `<span class="tag t-bad">${g.atr}</span>` : '<span class="zero">0</span>'}</td>
        <td class="n">${num(g.hoje)}</td><td class="n">${num(g.prev)}</td><td class="n">${num(g.ok)}</td>
        <td><div class="prog"><div class="bar2"><i style="width:${pct}%"></i></div>${tot ? pct + "%" : "—"}</div></td>
        <td style="text-align:right"><button class="abrir" style="margin:0" data-abrir="${c.id}" type="button">Entrar →</button></td></tr>`;
    }).join("") || '<tr><td colspan="7" class="zero" style="text-align:center;padding:20px">Nenhum cliente vinculado a você.</td></tr>';

  // gráfico 1: por dia, previstas (fundo) × concluídas (barra)
  $("#g1sub").textContent = ini === fim ? "· últimos 10 dias úteis" : "";
  const col = dias.map((d) => { const x = ts.filter((t) => t.alvo === d); return { d, prev: x.length, ok: x.filter(feita).length }; });
  const max = Math.max(1, ...col.map((c) => c.prev));
  $("#g1").innerHTML = col.map((c) => `<div class="gc ${c.d === hj ? "hj" : ""}" title="${dmy(c.d)}: ${c.ok} de ${c.prev} concluídas">
      <span class="gv">${c.prev ? (c.d > hj ? c.prev : `${c.ok}/${c.prev}`) : ""}</span>
      <div class="gtrack" style="height:${(c.prev / max) * 100}%"><div class="gfill" style="height:${c.prev ? (c.ok / c.prev) * 100 : 0}%"></div></div>
      <span class="gx">${dmy(c.d).slice(0, 5)}</span></div>`).join("") || '<div class="zero" style="padding:20px">Sem dias úteis no período.</div>';

  // gráfico 2: tempo médio por tarefa no período × média dos 90 dias antes
  const noP = {}, antes = {};
  tempos.filter(vis).forEach((t) => { const d = diaDe(t.concluida_em), m = d >= ini ? noP : antes; (m[t.titulo] = m[t.titulo] || []).push(t.duracao_segundos); });
  const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const linhas = Object.entries(noP).map(([nm, a]) => ({ nm, n: a.length, p: media(a), h: antes[nm] ? media(antes[nm]) : null }))
    .sort((a, b) => b.p * b.n - a.p * a.n).slice(0, 8);
  const mx = Math.max(1, ...linhas.map((r) => Math.max(r.p, r.h || 0))) * 1.08;
  const mm = (s) => { const m = s / 60; return m < 10 ? m.toFixed(1).replace(".", ",") + " min" : Math.round(m) + " min"; };
  $("#g2").innerHTML = linhas.map((r) => {
    const dif = r.h ? Math.round((r.p / r.h - 1) * 100) : null;
    const tag = dif === null ? '<span class="gd">sem histórico</span>' : Math.abs(dif) < 5 ? '<span class="gd">na média</span>'
      : dif > 0 ? `<span class="gd up">▲ ${dif}% mais lento</span>` : `<span class="gd dn">▼ ${-dif}% mais rápido</span>`;
    return `<div class="gr" title="${esc(r.nm)}: ${r.n} execuções, média ${mm(r.p)}${r.h ? ` · histórico ${mm(r.h)}` : ""}">
      <span class="gn">${esc(r.nm)} <small>${r.n}×</small></span>
      <div class="gbar"><i style="width:${(r.p / mx) * 100}%"></i>${r.h ? `<b style="left:${(r.h / mx) * 100}%"></b>` : ""}</div>
      <span class="gval">${mm(r.p)} ${tag}</span></div>`;
  }).join("") || '<div class="zero" style="padding:20px">Nenhuma tarefa concluída no período.</div>';
}

// tempo gasto por cliente no período: soma do cronômetro (todas as pessoas que a pessoa logada pode ver)
async function desenharTempoPorCliente(ini, fim) {
  const sess = await todas(() => sb.from("central_vw_sessoes").select("empresa_id, dia, tempo_ativo_segundos").gte("dia", ini).lte("dia", fim).order("id"));
  const por = new Map();
  sess.forEach((s) => { const x = por.get(s.empresa_id) || { seg: 0, dias: new Set() }; x.seg += Number(s.tempo_ativo_segundos || 0); x.dias.add(s.dia); por.set(s.empresa_id, x); });
  const linhas = [...por.entries()].map(([id, x]) => ({ c: cliente(id), seg: x.seg, dias: x.dias.size })).filter((l) => l.seg > 0).sort((a, b) => b.seg - a.seg);
  const total = linhas.reduce((a, l) => a + l.seg, 0), mx = Math.max(1, ...linhas.map((l) => l.seg)) * 1.05;
  const h = (s) => { const m = Math.round(s / 60); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0"); };
  $("#g3sub").textContent = total ? `· total ${h(total)}` : "";
  $("#g3").innerHTML = linhas.map((l) => `<div class="gr" title="${esc(l.c.nome)}: ${h(l.seg)} em ${l.dias} dia(s)">
      <span class="gn">${esc(l.c.codigo)} ${esc(l.c.nome)}</span>
      <div class="gbar"><i style="width:${(l.seg / mx) * 100}%"></i></div>
      <span class="gval">${h(l.seg)} <span class="gd">${h(l.seg / l.dias)}/dia</span></span></div>`).join("")
    || '<div class="zero" style="padding:20px">Nenhum tempo registrado no cronômetro neste período.</div>';
}

/* ================= Calendário ================= */
let modo = "mes", off = 0, pedidoAgenda = 0, filtrosProntos = false;
const aTipos = new Set();

function iniciarAgenda() {
  $("#aTipos").innerHTML = chipsTipo();
  $("#aModo").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; modo = b.dataset.v; off = 0;
    document.querySelectorAll("#aModo button").forEach((x) => x.classList.toggle("on", x === b)); desenharAgenda().catch(avisoErro); });
  $("#aAnt").onclick = () => { off--; desenharAgenda().catch(avisoErro); };
  $("#aProx").onclick = () => { off++; desenharAgenda().catch(avisoErro); };
  $("#aHoje").onclick = () => { off = 0; desenharAgenda().catch(avisoErro); };
  ["#aEmp", "#aResp"].forEach((s) => $(s).addEventListener("change", () => desenharAgenda().catch(avisoErro)));
  $("#aTipos").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return;
    aTipos.has(b.dataset.t) ? aTipos.delete(b.dataset.t) : aTipos.add(b.dataset.t); b.classList.toggle("on"); desenharAgenda().catch(avisoErro); });
  $("#aGrid").addEventListener("click", (ev) => { const e = ev.target.closest("[data-abrir-t]"); if (e) app.abrirCartao(e.dataset.abrirT); });
  $("#aGrid").addEventListener("mouseover", (ev) => { const e = ev.target.closest(".ev[data-tid]"); if (!e) return;
    document.querySelectorAll(`#aGrid .ev[data-tid="${e.dataset.tid}"]`).forEach((x) => x.classList.add("hl")); });
  $("#aGrid").addEventListener("mouseout", () => document.querySelectorAll("#aGrid .ev.hl").forEach((x) => x.classList.remove("hl")));
}

function prepararFiltros() {
  if (filtrosProntos) return; filtrosProntos = true;
  E.clientes.forEach((c) => $("#aEmp").insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.codigo)} · ${esc(c.nome)}</option>`));
  [...E.equipe.entries()].filter(([, x]) => x.ativo)
    .forEach(([u, x]) => $("#aResp").insertAdjacentHTML("beforeend", `<option value="${u}">${esc(x.nome)}</option>`));
}

const estadoCal = (t) => (feita(t) ? "ok" : t.alvo < E.hoje ? "v" : t.alvo === E.hoje ? "h" : "");

export async function desenharAgenda() {
  prepararFiltros();
  const meu = ++pedidoAgenda, h = E.hoje;
  let ini, fim, mesRef = null;
  if (modo === "mes") {
    const p = primeiroDoMes(h, off), u = ultimoDoMes(p);
    ini = somaDias(p, -diaSemana(p)); fim = somaDias(u, 6 - diaSemana(u)); mesRef = p.slice(0, 7);
    $("#aTit").textContent = `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
  } else {
    ini = somaDias(h, -diaSemana(h) + off * 7); fim = somaDias(ini, 6);
    $("#aTit").textContent = `${dmy(ini)} a ${dmy(fim)}`;
  }
  $("#aTit").classList.toggle("semana", modo === "semana");
  const [linhas, feriados] = await Promise.all([
    todas(() => sb.from("central_vw_tarefas").select(SEL)
      .or(`and(prazo.gte.${ini},prazo.lte.${fim}),and(data_meta.gte.${ini},data_meta.lte.${fim})`).order("id")),
    sb.from("central_feriados").select("dia, nome").gte("dia", ini).lte("dia", fim).then((r) => r.data || [])
  ]);
  const feriado = new Map(feriados.map((f) => [f.dia, f.nome]));
  if (meu !== pedidoAgenda) return;
  const fe = $("#aEmp").value, fr = $("#aResp").value;
  const ts = linhas.filter((t) => (!fe || t.empresa_id === fe) && (!fr || (t.responsaveis || []).includes(fr)) && (!aTipos.size || aTipos.has(t.tipo_recorrencia)));
  const cods = E.clientes.filter((c) => !fe || c.id === fe).map((c) => c.id);
  const marca = (t, ds) => (t.data_meta ? `<span class="k">${t.data_meta === ds ? "◎" : "▸"}</span>` : "");
  const ev = (t, ds, comCliente = true) => {
    const tip = `${cliente(t.empresa_id).nome} · ${t.titulo} · ${TIPO[t.tipo_recorrencia] || ""} · ${(t.responsaveis || []).map(nomeDe).join(", ")}` +
      (t.data_meta ? ` · meta ${dmy(t.data_meta)}, entrega ${dmy(t.prazo)}` : "");
    return `<span class="ev ${estadoCal(t)}${corCli(t.empresa_id)}" data-tid="${t.id}" data-abrir-t="${t.id}" title="${esc(tip)}" style="cursor:pointer">${marca(t, ds)}${selo(t)}${comCliente ? `<span class="cli">${esc(cliente(t.empresa_id).nome)}</span>` : ""}${esc(t.titulo)}</span>`;
  };

  let g = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let ds = ini; ds <= fim; ds = somaDias(ds, 1)) {
    const doDia = ts.filter((t) => t.prazo === ds || t.data_meta === ds);
    const di = doDia.filter((t) => t.tipo_recorrencia === "diaria"), out = doDia.filter((t) => t.tipo_recorrencia !== "diaria");
    let c = feriado.has(ds) ? `<span class="ev feriado" title="Feriado: sem tarefas diárias; as outras foram para o dia útil anterior">Feriado · ${esc(feriado.get(ds))}</span>` : "";
    if (modo === "mes") {
      if (di.length) { const ok = di.filter(feita).length; c += `<span class="ev dia ${ok === di.length ? "ok" : ds < h ? "v" : ""}">${ok}/${di.length} diárias</span>`; }
      // a mesma tarefa em vários clientes vira uma linha só ("· 4 clientes")
      const grp = {};
      out.forEach((t) => { const k = t.titulo + (t.data_meta === ds ? "|m" : "|e"); (grp[k] = grp[k] || []).push(t); });
      const itens = Object.values(grp).map((l) => {
        if (l.length === 1) return ev(l[0], ds);
        const t0 = l[0], st = l.some((t) => estadoCal(t) === "v") ? "v" : l.every(feita) ? "ok" : estadoCal(t0);
        return `<span class="ev ${st}" title="${esc(t0.titulo + ": " + l.map((t) => cliente(t.empresa_id).nome + (feita(t) ? " ✓" : "")).join(", "))}">${marca(t0, ds)}${esc(t0.titulo)} <span class="cli">· ${l.length} clientes</span></span>`;
      });
      itens.slice(0, 4).forEach((l) => (c += l));
      if (itens.length > 4) c += `<span class="ev mais">+${itens.length - 4}</span>`;
    } else {
      cods.forEach((id) => {
        const dc = di.filter((t) => t.empresa_id === id), oc = out.filter((t) => t.empresa_id === id);
        if (!dc.length && !oc.length) return;
        c += `<div class="semcli${corCli(id)}">${esc(cliente(id).nome)}${dc.length ? ` · ${dc.filter(feita).length}/${dc.length} diárias` : ""}</div>` + oc.map((t) => ev(t, ds, false)).join("");
      });
    }
    const fora = modo === "mes" && ds.slice(0, 7) !== mesRef;
    g += `<div class="c ${fora ? "fora" : ""} ${util(ds) && !feriado.has(ds) ? "" : "fds"} ${ds === h ? "hoje" : ""}"><div class="n">${Number(ds.slice(8, 10))}</div>${c}</div>`;
  }
  $("#aGrid").innerHTML = g;
  $("#aGrid").classList.toggle("modo-semana", modo === "semana");
}

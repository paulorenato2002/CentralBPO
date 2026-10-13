// Ajudantes de tela: escape (todo texto do banco passa por esc), datas, diálogo, aviso.
export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Datas no fuso de São Paulo (o mesmo que o banco usa em central_hoje)
const FUSO = "America/Sao_Paulo";
export function hojeISO(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function somaDias(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function diaSemana(iso) { return new Date(iso + "T12:00:00Z").getUTCDay(); }
export function fimSemana(iso) { const dow = diaSemana(iso); return somaDias(iso, dow === 6 ? 6 : 5 - dow < 0 ? 0 : 5 - dow); }
export const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
export const diaLongo = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
export const diaCurto = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
export const hhmm = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
export const dataHora = (ts) => new Date(ts).toLocaleString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export function hms(seg) {
  const s = Math.max(0, Math.floor(seg || 0));
  return [s / 3600, (s % 3600) / 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, "0")).join(":");
}

export const TIPO = { diaria: "Diário", semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal", anual: "Anual", pontual: "Pontual" };
export const PAPEL = { estagiaria: "Estagiária", analista: "Analista financeira", supervisor: "Supervisor", gestor_financeiro: "Gestor financeiro", administrador: "Administrador" };
export const COR_PAPEL = { estagiaria: "c0", analista: "c1", supervisor: "c2", gestor_financeiro: "c3", administrador: "c4" };

// link só se for http(s): nada de javascript: vindo do banco
export function linkSeguro(url) {
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
}

export function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
}
export function avisoErro(e) { toast(e && e.message ? e.message : String(e)); console.error(e); }

/* botoes: [{ txt, cls:"pri"|"red"|"", fn }] · perigo = cabeçalho vermelho. Esc não fecha. */
export function perguntar(hd, txt, botoes, perigo = false) {
  const d = $("#dlg");
  d.classList.toggle("perigo", perigo);
  $("#dlgHd").textContent = hd;
  $("#dlgTxt").innerHTML = txt;           // chamadores passam texto já escapado
  const ft = $("#dFt"); ft.innerHTML = "";
  botoes.forEach((b) => {
    const el = document.createElement("button");
    el.type = "button"; el.textContent = b.txt; if (b.cls) el.className = b.cls;
    el.onclick = async () => { d.close(); if (b.fn) { try { await b.fn(); } catch (e) { avisoErro(e); } } };
    ft.appendChild(el);
  });
  d.showModal();
}
document.addEventListener("DOMContentLoaded", () => $("#dlg").addEventListener("cancel", (ev) => ev.preventDefault()));

export async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast("Copiado"); }
  catch {
    const a = document.createElement("textarea"); a.value = txt; document.body.appendChild(a); a.select();
    try { document.execCommand("copy"); toast("Copiado"); } catch { toast("Não deu para copiar"); }
    a.remove();
  }
}

// trava contra clique duplo em ações que gravam
export function travar(botao, fn) {
  return async (...args) => {
    if (botao.disabled) return;
    botao.disabled = true;
    try { return await fn(...args); } catch (e) { avisoErro(e); } finally { botao.disabled = false; }
  };
}

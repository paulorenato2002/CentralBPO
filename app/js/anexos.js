// Anexos de imagem (ou PDF) presos a um cartão: acesso (Senhas) ou nota (Informações, Datas, Contatos).
// A lista vem de central_anexos (sem o arquivo); o arquivo sai cifrado do banco só por central_abrir_anexo.
// Cartão ainda não salvo: os arquivos esperam na fila e sobem depois do salvar (enviarFila).
import { sb, rpc, todas } from "./api.js";
import { $, esc, toast, avisoErro, perguntar } from "./ui.js";

export const CATS = ["Senha", "Print da tela", "Documento", "Comprovante", "Cartão / token", "Outro"];
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX = 2.5 * 1024 * 1024;
const st = {};   // por gaveta: { tipo, id, lista, fila, pode, tira }

// quantos anexos cada cartão tem (para o 📎 nos cartões)
export async function contar(tipo) {
  const l = await todas(() => sb.from("central_anexos").select("id, alvo_id").eq("alvo_tipo", tipo).order("id"));
  const m = new Map(); l.forEach((a) => m.set(a.alvo_id, (m.get(a.alvo_id) || 0) + 1)); return m;
}
export const clipe = (n) => (n ? ` <span class="anxn" title="${n} anexo${n === 1 ? "" : "s"}">📎 ${n}</span>` : "");

// foto grande vira JPEG de até 2000 px; print pequeno fica como está
async function preparar(f) {
  if (!TIPOS.includes(f.type)) throw new Error(`${f.name}: só imagem (JPG, PNG, WebP, GIF) ou PDF.`);
  let blob = f, mime = f.type, nome = f.name || "imagem.png";
  if (f.type.startsWith("image/") && f.type !== "image/gif" && f.size > 1.2 * 1024 * 1024) {
    const bmp = await createImageBitmap(f), k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85)); mime = "image/jpeg"; nome = nome.replace(/\.\w+$/, "") + ".jpg";
  }
  if (blob.size > MAX) throw new Error(`${nome}: arquivo maior que 2,5 MB.`);
  const b64 = await new Promise((r, x) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.onerror = x; fr.readAsDataURL(blob); });
  return { nome, mime, b64, tamanho: blob.size };
}

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// monta o bloco dentro da gaveta: <div id="..."> vira a lista + botão de anexar
export async function abrir(caixa, tipo, id, { pode = true, tira = true } = {}) {
  const s = (st[caixa] = { tipo, id, lista: [], fila: [], pode, tira });
  if (id) s.lista = await todas(() => sb.from("central_anexos").select("id, nome, categoria, mime, tamanho, created_at").eq("alvo_tipo", tipo).eq("alvo_id", id).order("created_at"));
  desenhar(caixa);
}

function desenhar(caixa) {
  const s = st[caixa], el = $(caixa); if (!s || !el) return;
  const item = (a, i, fila) => `<div class="anx">${a.mime === "application/pdf" ? "📄" : "🖼️"}
    <button type="button" class="anxnome" ${fila ? "disabled" : `data-ver="${a.id}"`}>${esc(a.nome)}</button>
    ${a.categoria ? `<span class="tipo">${esc(a.categoria)}</span>` : ""}<span class="zero">${fila ? "sobe ao salvar" : kb(a.tamanho)}</span>
    ${fila ? `<button type="button" class="mb" data-tirafila="${i}">tirar</button>` : s.tira ? `<button type="button" class="mb" data-tira="${a.id}">tirar</button>` : ""}</div>`;
  el.innerHTML = `<h5>Anexos</h5>${s.lista.map((a, i) => item(a, i, false)).join("")}${s.fila.map((a, i) => item(a, i, true)).join("")}
    ${!s.lista.length && !s.fila.length ? '<div class="zero" style="font-size:12px">Nenhum anexo. Anexe um print, uma foto ou um PDF (até 2,5 MB). Também dá para colar um print com Ctrl+V.</div>' : ""}
    ${s.pode ? `<div class="anxadd"><select data-cat><option value="">Categoria…</option>${CATS.map((c) => `<option>${c}</option>`).join("")}</select>
      <label class="dbtn sec anxbtn">+ Anexar<input type="file" accept="image/*,application/pdf" multiple hidden data-arq></label></div>` : ""}`;
  if (el.dataset.ligado) return;
  el.dataset.ligado = "1";
  el.addEventListener("change", (ev) => { if (ev.target.matches("[data-arq]")) { receber(caixa, [...ev.target.files]); ev.target.value = ""; } });
  el.addEventListener("click", (ev) => {
    const s2 = st[caixa], v = ev.target.closest("[data-ver]"), t = ev.target.closest("[data-tira]"), tf = ev.target.closest("[data-tirafila]");
    if (v) return ver(v.dataset.ver).catch(avisoErro);
    if (tf) { s2.fila.splice(Number(tf.dataset.tirafila), 1); return desenhar(caixa); }
    if (t) { const a = s2.lista.find((x) => x.id === t.dataset.tira);
      perguntar(`Tirar o anexo "${a.nome}"?`, "Some do cartão. Fica registrado no histórico.",
        [{ txt: "Tirar anexo", cls: "red", fn: async () => { await rpc("central_excluir_anexo", { p_id: a.id }); s2.lista = s2.lista.filter((x) => x !== a); desenhar(caixa); toast("Anexo tirado"); } }, { txt: "Voltar" }], true); }
  });
  // colar print (Ctrl+V) com a gaveta aberta
  el.closest(".drawer").addEventListener("paste", (ev) => {
    const fs = [...(ev.clipboardData || {}).files || []].filter((f) => f.type.startsWith("image/"));
    if (fs.length && st[caixa] && st[caixa].pode) { ev.preventDefault(); receber(caixa, fs.map((f, i) => new File([f], `print-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}${i ? "-" + i : ""}.png`, { type: f.type }))); }
  });
}

async function receber(caixa, files) {
  const s = st[caixa], cat = ($(caixa).querySelector("[data-cat]") || {}).value || null;
  for (const f of files) {
    try {
      const p = { ...(await preparar(f)), categoria: cat };
      if (!s.id) { s.fila.push(p); continue; }
      const id = await rpc("central_anexar", { p_alvo_tipo: s.tipo, p_alvo_id: s.id, p_nome: p.nome, p_mime: p.mime, p_base64: p.b64, p_categoria: p.categoria });
      s.lista.push({ id, nome: p.nome, categoria: p.categoria, mime: p.mime, tamanho: p.tamanho }); toast("Anexado");
    } catch (e) { avisoErro(e); }
  }
  desenhar(caixa);
}

// depois de salvar um cartão novo: sobe o que estava na fila
export async function enviarFila(caixa, id) {
  const s = st[caixa]; if (!s || !id || !s.fila.length) return;
  for (const p of s.fila.splice(0)) {
    await rpc("central_anexar", { p_alvo_tipo: s.tipo, p_alvo_id: id, p_nome: p.nome, p_mime: p.mime, p_base64: p.b64, p_categoria: p.categoria }).catch(avisoErro);
  }
}

// imagem abre por cima da tela; PDF baixa
async function ver(id) {
  const a = await rpc("central_abrir_anexo", { p_id: id });
  if (a.mime === "application/pdf") {
    const bin = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0)), url = URL.createObjectURL(new Blob([bin], { type: a.mime }));
    const l = document.createElement("a"); l.href = url; l.download = a.nome; l.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); return;
  }
  const v = document.createElement("div"); v.className = "anxver";
  v.innerHTML = `<div class="anxverhd"><b>${esc(a.nome)}</b><span style="flex:1"></span><a class="mb" download="${esc(a.nome)}" href="data:${a.mime};base64,${a.base64}">baixar</a><button type="button" class="mb">fechar ×</button></div>
    <img alt="${esc(a.nome)}" src="data:${a.mime};base64,${a.base64}">`;
  const sai = () => { v.remove(); document.removeEventListener("keydown", esc_); };
  const esc_ = (e) => { if (e.key === "Escape") sai(); };
  v.addEventListener("click", (e) => { if (e.target === v || e.target.closest("button")) sai(); });
  document.addEventListener("keydown", esc_); document.body.append(v);
}

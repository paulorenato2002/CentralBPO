// Painel do agente: a gaveta que abre pelo robô da barra de cima, em qualquer tela.
// O HTML (#bAgente, #agente, #agenteCorpo, #agFechar) vem do index.html; o comportamento é todo daqui.
// Nada de chave de IA aqui: o navegador só fala com /api/agente/chat, que roda no servidor.
import { sb } from "./api.js";
import { E } from "./estado.js";
import { $, esc, toast } from "./ui.js";

const CHAVE_CONVERSA = "central-agente-conversa";
let conversaId = null;
let ocupado = false;

function lembrar(valor) {
  try {
    if (valor) sessionStorage.setItem(CHAVE_CONVERSA, valor);
    else sessionStorage.removeItem(CHAVE_CONVERSA);
  } catch { /* sem armazenamento: a conversa só não sobrevive ao F5 */ }
}
function lembrada() {
  try { return sessionStorage.getItem(CHAVE_CONVERSA); } catch { return null; }
}

/* ================= desenho ================= */

// O estilo do painel mora aqui, e não no estilo.css, para o agente ser um arquivo só.
// Usa as mesmas variáveis de cor da Central, então acompanha tema claro e escuro.
function estilo() {
  if ($("#agEstilo")) return;
  const tag = document.createElement("style");
  tag.id = "agEstilo";
  tag.textContent = `
    #agenteCorpo{display:flex;flex-direction:column;height:calc(100% - 52px)}
    .agConversa{flex:1;overflow:auto;padding:14px 18px;display:flex;flex-direction:column;gap:12px}
    .agMsg{display:flex;flex-direction:column;gap:3px;max-width:92%}
    .agMsg.ag-usuario{align-self:flex-end;align-items:flex-end}
    .agBolha{padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.5;white-space:normal;word-break:break-word}
    .ag-agente .agBolha{background:var(--line2);color:var(--ink);border-bottom-left-radius:3px}
    .ag-usuario .agBolha{background:var(--acc,#2f6f4f);color:#fff;border-bottom-right-radius:3px}
    .agFonte{font-size:10.5px;color:var(--ink3);letter-spacing:.02em}
    .agEntrada{border-top:1px solid var(--line);padding:10px 14px 14px;display:flex;flex-direction:column;gap:8px;background:var(--panel)}
    .agEntrada textarea{font:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);resize:vertical;min-height:46px}
    .agBarra{display:flex;justify-content:space-between;gap:8px}
    .agBarra button[disabled]{opacity:.5;cursor:default}`;
  document.head.appendChild(tag);
}

function montar() {
  estilo();
  $("#agenteCorpo").innerHTML = `
    <div class="agConversa" id="agLista"></div>
    <form class="agEntrada" id="agForm">
      <textarea id="agTexto" rows="2" placeholder="Pergunte sobre tarefas, prazos, clientes e rotinas…" maxlength="4000"></textarea>
      <div class="agBarra">
        <button type="button" class="mb" id="agNova">Nova conversa</button>
        <button type="submit" class="mb on" id="agEnviar">Enviar</button>
      </div>
    </form>`;
  $("#agForm").addEventListener("submit", enviar);
  $("#agNova").onclick = novaConversa;
  $("#agTexto").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); enviar(ev); }
  });
}

// O texto do modelo é inserido como TEXTO, nunca como HTML: esc() em tudo.
// A única liberdade é a quebra de linha e o **negrito**, que o modelo usa bastante.
function formatar(texto) {
  return esc(texto)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

function escrever(papel, texto, ferramentas) {
  const lista = $("#agLista");
  const div = document.createElement("div");
  div.className = `agMsg ag-${papel}`;
  const rodape = ferramentas?.length
    ? `<div class="agFonte">usou: ${esc([...new Set(ferramentas)].join(", "))}</div>`
    : "";
  div.innerHTML = `<div class="agBolha">${formatar(texto)}</div>${rodape}`;
  lista.appendChild(div);
  lista.scrollTop = lista.scrollHeight;
  return div;
}

function abertura() {
  const nome = (E.eu?.nome || "").split(" ")[0];
  escrever(
    "agente",
    `Oi${nome ? ", " + nome : ""}. Posso consultar tarefas, prazos, rotinas e anotações dos seus clientes, e registrar a anotação do dia.\n\nExperimente: **o que está atrasado hoje?** ou **anota na L2H que o boleto do aluguel ainda não chegou**`
  );
}

/* ================= conversa ================= */

function novaConversa() {
  conversaId = null;
  lembrar(null);
  $("#agLista").innerHTML = "";
  abertura();
  $("#agTexto").focus();
}

async function enviar(ev) {
  ev.preventDefault();
  if (ocupado) return;
  const campo = $("#agTexto");
  const texto = campo.value.trim();
  if (!texto) return;

  escrever("usuario", texto);
  campo.value = "";
  ocupado = true;
  $("#agEnviar").disabled = true;
  const esperando = escrever("agente", "…");

  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Sua sessão expirou. Entre de novo na Central.");

    const r = await fetch("/api/agente/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mensagem: texto, conversa_id: conversaId, empresa_id: E.aberta || null }),
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || `o servidor respondeu ${r.status}`);

    conversaId = corpo.conversa_id;
    lembrar(conversaId);
    esperando.remove();
    escrever("agente", corpo.resposta, corpo.ferramentas);
  } catch (e) {
    esperando.remove();
    escrever("agente", `Não consegui responder: ${e.message}`);
    console.error(e);
  } finally {
    ocupado = false;
    $("#agEnviar").disabled = false;
    campo.focus();
  }
}

/* ================= abrir e fechar ================= */

function abrir() {
  const gaveta = $("#agente");
  gaveta.hidden = false;
  if (!$("#agLista")) { montar(); abertura(); }
  $("#agTexto").focus();
}
function fechar() { $("#agente").hidden = true; }

function ligar() {
  const botao = $("#bAgente");
  const gaveta = $("#agente");
  if (!botao || !gaveta) return;            // index.html antigo: some sem quebrar a Central

  botao.onclick = () => (gaveta.hidden ? abrir() : fechar());
  const fecharBtn = $("#agFechar");
  if (fecharBtn) fecharBtn.onclick = fechar;
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !gaveta.hidden) fechar(); });

  conversaId = lembrada();

  // O robô só existe para quem está dentro: sem sessão, nem aparece.
  const mostrar = (ligado) => {
    botao.hidden = !ligado;
    if (!ligado) { fechar(); conversaId = null; lembrar(null); const l = $("#agLista"); if (l) l.innerHTML = ""; }
  };
  sb.auth.getSession().then(({ data }) => mostrar(!!data?.session));
  sb.auth.onAuthStateChange((_evento, sessao) => mostrar(!!sessao));
}

// A Central só desenha a barra depois do login, então espera o #bAgente existir.
if ($("#bAgente")) ligar();
else {
  const observador = new MutationObserver(() => {
    if ($("#bAgente")) { observador.disconnect(); ligar(); }
  });
  observador.observe(document.body, { childList: true, subtree: true });
}

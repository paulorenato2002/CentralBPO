// Painel do agente: a gaveta que abre pelo robô da barra de cima, em qualquer tela.
// O HTML (#bAgente, #agente, #agenteCorpo, #agFechar) vem do index.html; o comportamento é todo daqui.
// Nada de chave de IA aqui: o navegador só fala com /api/agente/*, que roda no servidor.
import { sb } from "./api.js";
import { E } from "./estado.js";
import { $, esc } from "./ui.js";

const CHAVE_CONVERSA = "central-agente-conversa";
const MAX_ANEXOS = 10;
const TIPOS_ACEITOS = ".pdf,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.docx,.zip,.xml,.ofx";

let conversaId = null;
let ocupado = false;
let anexos = []; // { nome, tamanho, estado: "enviando" | "pronto" | "erro", anexoId, msg }

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
    .agEsq{display:flex;gap:6px}
    .agBarra button[disabled]{opacity:.5;cursor:default}
    .agAnexos{display:flex;flex-wrap:wrap;gap:6px}
    .agChip{display:inline-flex;align-items:center;gap:6px;max-width:100%;font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:3px 9px;background:var(--paper);color:var(--ink2)}
    .agChip.erro{color:var(--warn);border-color:var(--warn)}
    .agChip button{border:0;background:none;cursor:pointer;color:var(--ink3);font-size:15px;line-height:1;padding:0}`;
  document.head.appendChild(tag);
}

function montar() {
  estilo();
  $("#agenteCorpo").innerHTML = `
    <div class="agConversa" id="agLista"></div>
    <form class="agEntrada" id="agForm">
      <div class="agAnexos" id="agAnexos" hidden></div>
      <textarea id="agTexto" rows="2" placeholder="Pergunte sobre tarefas, prazos, clientes e rotinas…" maxlength="4000"></textarea>
      <div class="agBarra">
        <span class="agEsq">
          <button type="button" class="mb" id="agNova">Nova conversa</button>
          <button type="button" class="mb" id="agAnexar">Anexar</button>
        </span>
        <button type="submit" class="mb on" id="agEnviar">Enviar</button>
      </div>
      <input type="file" id="agArquivo" multiple hidden accept="${TIPOS_ACEITOS}">
    </form>`;
  $("#agForm").addEventListener("submit", enviar);
  $("#agNova").onclick = novaConversa;
  $("#agAnexar").onclick = () => $("#agArquivo").click();
  $("#agArquivo").addEventListener("change", (ev) => {
    adicionar([...ev.target.files]);
    ev.target.value = ""; // permite anexar o mesmo arquivo de novo depois de remover
  });
  $("#agAnexos").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-rem]");
    if (!b) return;
    anexos.splice(Number(b.dataset.rem), 1);
    desenharAnexos();
  });
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
    `Oi${nome ? ", " + nome : ""}. Posso consultar tarefas, prazos, rotinas e anotações dos seus clientes, registrar a anotação do dia, preparar e-mails da Effective (com anexo) e montar o relatório do dia.\n\nExperimente: **o que está atrasado hoje?** ou **anota na L2H que o boleto do aluguel ainda não chegou**`
  );
}

/* ================= anexos ================= */

const atualizarEnviar = () => {
  const b = $("#agEnviar");
  if (b) b.disabled = ocupado || anexos.some((a) => a.estado === "enviando");
};

function desenharAnexos() {
  const area = $("#agAnexos");
  if (!area) return;
  area.hidden = anexos.length === 0;
  area.innerHTML = anexos
    .map((a, i) => {
      const estado = a.estado === "enviando" ? " · enviando…" : a.estado === "erro" ? ` · ${esc(a.msg)}` : "";
      const remover = a.estado === "enviando" ? "" : `<button type="button" data-rem="${i}" aria-label="Remover ${esc(a.nome)}">×</button>`;
      return `<span class="agChip${a.estado === "erro" ? " erro" : ""}">${esc(a.nome)}${estado}${remover}</span>`;
    })
    .join("");
  atualizarEnviar();
}

async function token() {
  const { data } = await sb.auth.getSession();
  const t = data?.session?.access_token;
  if (!t) throw new Error("Sua sessão expirou. Entre de novo na Central.");
  return t;
}

async function chamar(rota, corpo) {
  const r = await fetch(rota, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(corpo),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.erro || `o servidor respondeu ${r.status}`);
  return json;
}

// O arquivo vai DIRETO para o Storage com uma URL assinada pelo servidor (a Vercel limita o corpo
// de uma função a 4,5 MB). Depois o servidor confere o que chegou e registra o dono.
async function subirAnexo(item, arquivo) {
  try {
    const prep = await chamar("/api/agente/anexo", { acao: "preparar", nome: arquivo.name, tamanho: arquivo.size });
    const { error } = await sb.storage
      .from(prep.bucket)
      .uploadToSignedUrl(prep.caminho, prep.token, arquivo, { contentType: arquivo.type || "application/octet-stream" });
    if (error) throw new Error(error.message || "o envio do arquivo falhou");
    const conf = await chamar("/api/agente/anexo", {
      acao: "confirmar", arquivo_id: prep.arquivo_id, nome: arquivo.name, mime: arquivo.type || null,
    });
    item.anexoId = conf.anexo_id;
    item.estado = "pronto";
  } catch (e) {
    item.estado = "erro";
    item.msg = e.message;
  }
  desenharAnexos();
}

function adicionar(arquivos) {
  for (const arquivo of arquivos) {
    if (anexos.length >= MAX_ANEXOS) {
      escrever("agente", `Máximo de ${MAX_ANEXOS} anexos por mensagem.`);
      break;
    }
    const item = { nome: arquivo.name, tamanho: arquivo.size, estado: "enviando", anexoId: null, msg: "" };
    anexos.push(item);
    subirAnexo(item, arquivo);
  }
  desenharAnexos();
}

/* ================= conversa ================= */

function novaConversa() {
  conversaId = null;
  anexos = [];
  lembrar(null);
  $("#agLista").innerHTML = "";
  desenharAnexos();
  abertura();
  $("#agTexto").focus();
}

async function enviar(ev) {
  ev.preventDefault();
  if (ocupado) return;
  if (anexos.some((a) => a.estado === "enviando")) return;
  if (anexos.some((a) => a.estado === "erro")) {
    escrever("agente", "Remova os anexos com erro antes de enviar.");
    return;
  }
  const campo = $("#agTexto");
  const prontos = anexos.filter((a) => a.estado === "pronto");
  let texto = campo.value.trim();
  if (!texto && !prontos.length) return;
  if (!texto) texto = "Segue o anexo.";

  escrever("usuario", prontos.length ? `${texto}\n\nAnexos: ${prontos.map((a) => a.nome).join(", ")}` : texto);
  campo.value = "";
  ocupado = true;
  atualizarEnviar();
  const esperando = escrever("agente", "…");

  try {
    const corpo = await chamar("/api/agente/chat", {
      mensagem: texto,
      conversa_id: conversaId,
      empresa_id: E.aberta || null,
      anexos: prontos.map((a) => a.anexoId),
    });
    conversaId = corpo.conversa_id;
    lembrar(conversaId);
    esperando.remove();
    escrever("agente", corpo.resposta, corpo.ferramentas);
    anexos = []; // só limpa quando a mensagem foi: se falhar, os anexos continuam valendo
    desenharAnexos();
  } catch (e) {
    esperando.remove();
    escrever("agente", `Não consegui responder: ${e.message}`);
    console.error(e);
  } finally {
    ocupado = false;
    atualizarEnviar();
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
    if (!ligado) {
      fechar(); conversaId = null; anexos = []; lembrar(null);
      const l = $("#agLista"); if (l) l.innerHTML = "";
    }
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

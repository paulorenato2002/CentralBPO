// Fotos da equipe e logos dos clientes (tabela central_imagens; ficam no banco, não no código público).
import { sb } from "./api.js";
import { E } from "./estado.js";
import { esc } from "./ui.js";

export async function carregarImagens() {
  const { data } = await sb.from("central_imagens").select("chave, mime, dados");
  E.imgs = new Map((data || []).map((i) => [i.chave, `data:${i.mime};base64,${i.dados}`]));
}
const iniciais = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
const img = (k) => (E.imgs && E.imgs.get(k)) || null;
// foto redonda da pessoa (ou as iniciais)
export const avatar = (id, nome, cls = "") => {
  const u = img("pessoa:" + id);
  return u ? `<img class="avf ${cls}" src="${u}" alt="${esc(nome)}">` : `<span class="avf ini ${cls}">${esc(iniciais(nome))}</span>`;
};
// logo do cliente (ou as iniciais)
export const logo = (id, nome, cls = "") => {
  const u = img("cliente:" + id);
  return u ? `<img class="lgf ${cls}" src="${u}" alt="${esc(nome)}">` : `<span class="lgf ini ${cls}">${esc(iniciais(nome))}</span>`;
};
export const imagem = img;

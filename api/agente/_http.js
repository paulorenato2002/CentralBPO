// Resposta JSON e leitura do corpo, iguais para todas as funções do agente.

export function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(corpo));
}

export async function lerCorpo(req, limite = 20000) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let txt = "";
  for await (const parte of req) {
    txt += parte;
    if (txt.length > limite) throw new Error("corpo grande demais");
  }
  return JSON.parse(txt || "{}");
}

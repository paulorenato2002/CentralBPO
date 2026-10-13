// Servidor local só para desenvolvimento: serve a pasta do projeto com os mesmos cabeçalhos de segurança da Vercel.
//   node scripts/servidor-local.mjs            (porta 4173)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = Number(process.env.PORT) || 4173;
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const vercel = JSON.parse(await readFile(join(RAIZ, "vercel.json"), "utf8"));
const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value
  .replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");   // Supabase local

// variáveis do .env.local (as funções de /api leem process.env, como na Vercel)
try {
  for (const linha of (await readFile(join(RAIZ, ".env.local"), "utf8")).split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* sem .env.local */ }

createServer(async (req, res) => {
  let caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (caminho === "/") { res.writeHead(302, { Location: "/app/" }); return res.end(); }
  if (caminho === "/api/admin") {   // mesma função que roda na Vercel
    try { return (await import("../api/admin.js")).default(req, res); }
    catch (e) { console.error(e); res.writeHead(500); return res.end(); }
  }
  if (caminho.endsWith("/")) caminho += "index.html";
  const arquivo = normalize(join(RAIZ, caminho));
  if (!arquivo.startsWith(RAIZ) || /node_modules|\.env/.test(arquivo)) { res.writeHead(403); return res.end(); }
  try {
    await stat(arquivo);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arquivo)] || "application/octet-stream", "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Cache-Control": "no-store" });
    res.end(await readFile(arquivo));
  } catch { res.writeHead(404); res.end("não encontrado"); }
}).listen(PORTA, "127.0.0.1", () => console.log(`Central BPO local: http://127.0.0.1:${PORTA}/app/`));

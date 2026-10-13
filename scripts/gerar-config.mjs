// Prepara o app para publicar (Vercel) ou rodar local:
//  1. app/config.js com a URL e a chave PÚBLICA do Supabase (anon/publishable). Nunca a service_role.
//  2. app/vendor/supabase.js copiado do pacote instalado (o navegador não carrega script de fora).
//  3. dist/app/ = cópia só do app: é a única coisa que a Vercel publica (migrations, docs e protótipo ficam fora).
// Variáveis: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (ambiente ou .env.local).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
const arquivoEnv = resolve(RAIZ, ".env.local");
if (existsSync(arquivoEnv)) {
  for (const linha of readFileSync(arquivoEnv, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL, chave = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !chave) { console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY."); process.exit(1); }
if (!/^https?:\/\//.test(url)) { console.error("NEXT_PUBLIC_SUPABASE_URL inválida."); process.exit(1); }
// trava: a chave de serviço nunca pode ir para o navegador
const papel = (() => { try { return JSON.parse(Buffer.from(chave.split(".")[1], "base64url").toString()).role; } catch { return null; } })();
if (papel === "service_role" || /^sb_secret_/.test(chave)) { console.error("ERRO: a chave informada é a service_role/secret. Use a chave pública (anon/publishable)."); process.exit(1); }

writeFileSync(resolve(RAIZ, "app/config.js"),
  `// gerado por scripts/gerar-config.mjs — não editar, não versionar\nwindow.CENTRAL_CONFIG = Object.freeze(${JSON.stringify({ url, anonKey: chave })});\n`);
mkdirSync(resolve(RAIZ, "app/vendor"), { recursive: true });
copyFileSync(resolve(RAIZ, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"), resolve(RAIZ, "app/vendor/supabase.js"));
rmSync(resolve(RAIZ, "dist"), { recursive: true, force: true });
cpSync(resolve(RAIZ, "app"), resolve(RAIZ, "dist/app"), { recursive: true });
console.log(`app/config.js gerado para ${new URL(url).host} · supabase-js copiado para app/vendor · dist/app pronto`);

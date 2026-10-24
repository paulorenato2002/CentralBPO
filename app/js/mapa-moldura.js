// Moldura do Institucional (app/mapa.html): lê o HTML do mapa da empresa em central_conteudo ('mapa_html')
// com a sessão de quem está logado na Central e troca a página por ele. O tema segue o da Central.
(async () => {
  const msg = (t) => { const p = document.getElementById("msg"); if (p) p.textContent = t; };
  try {
    if (window.top === window) { location.replace("./#institucional"); return; }   // fora da Central não abre
    const cfg = window.CENTRAL_CONFIG || {};
    const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "central-bpo-sessao" } });
    const { data: s } = await sb.auth.getSession();
    if (!s || !s.session) return msg("Entre na Central para ver o Institucional.");
    const { data, error } = await sb.from("central_conteudo").select("dados").eq("chave", "mapa_html").maybeSingle();
    if (error) throw error;
    const html = data && data.dados && data.dados.html;
    if (!html) return msg("O Institucional ainda não foi carregado. Fale com o administrador.");
    // tema e fonte iguais aos da Central
    try {
      const t = localStorage.getItem("central-tema") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      localStorage.setItem("mapa-tema", t);
    } catch { /* sem armazenamento: o mapa decide sozinho */ }
    document.open(); document.write(html); document.close();
  } catch (e) { msg("Não foi possível abrir o Institucional: " + (e.message || e)); }
})();

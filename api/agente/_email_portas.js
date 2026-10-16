// Portas do e-mail com o Supabase.
//
// modelos_email e envios_email só aceitam o backend (RLS ligada, sem permissão
// para quem está logado). Por isso aqui entra o cliente de SERVIÇO, e só aqui:
// ele recebe apenas essas duas tabelas, depois de a função já ter validado o
// login. Toda consulta é presa ao usuário (solicitante_id), e o resto do agente
// continua falando com o banco pelo token da pessoa.
//
// "sb" é o cliente da pessoa (lê a própria conversa); "admin", o de serviço.
import { mensageiro } from "./_mensageiro.js";
import { BUCKET, caminhoDoAnexo, hashSha256 } from "./_anexos.js";

const PAPEIS_QUE_EDITAM_MODELO = ["administrador", "supervisor", "socio"];

export function criarPortasEmail({ sb, admin, usuarioId, papel, opcoesMensageiro = { env: process.env } }) {
  return {
    async buscarModelo(codigo) {
      const { data } = await admin
        .from("modelos_email")
        .select("id, codigo, nome, empresa_id, assunto, corpo, campos, para, cc, cco")
        .eq("codigo", codigo)
        .eq("ativo", true)
        .maybeSingle();
      return data ?? null;
    },

    async listarModelos() {
      const { data } = await admin
        .from("modelos_email")
        .select("codigo, nome, empresa_id, campos, para, cc, cco, observacoes")
        .eq("ativo", true)
        .order("codigo")
        .limit(100);
      return data ?? [];
    },

    // Modelo é compartilhado: quem não criou o modelo nem é supervisor não sobrescreve o de outra pessoa.
    async gravarModelo(linha, uid) {
      const { data: atual } = await admin.from("modelos_email").select("id, created_by").eq("codigo", linha.codigo).maybeSingle();
      if (atual) {
        const pode = atual.created_by === uid || PAPEIS_QUE_EDITAM_MODELO.includes(papel);
        if (!pode) {
          return { erro: `O modelo ${linha.codigo} foi criado por outra pessoa. Use outro código ou peça ao supervisor para alterar.` };
        }
        const { error } = await admin.from("modelos_email").update({ ...linha, updated_by: uid, ativo: true }).eq("id", atual.id);
        if (error) throw new Error(`não consegui atualizar o modelo: ${error.message}`);
        return { id: atual.id, novo: false };
      }
      const { data, error } = await admin
        .from("modelos_email")
        .insert({ ...linha, created_by: uid, updated_by: uid })
        .select("id")
        .single();
      if (error) throw new Error(`não consegui gravar o modelo: ${error.message}`);
      return { id: data.id, novo: true };
    },

    async criarRascunho(linha) {
      const { data, error } = await admin.from("envios_email").insert(linha).select("id").single();
      if (error) throw new Error(`não consegui gravar o rascunho: ${error.message}`);
      return { id: data.id };
    },

    async buscarEnvio(id) {
      const { data } = await admin
        .from("envios_email")
        .select("id, modelo_id, conversa_id, solicitante_id, para, cc, cco, assunto, corpo_html, corpo_texto, anexos, status, created_at")
        .eq("id", id)
        .maybeSingle();
      return data ?? null;
    },

    // A mensagem da PESSOA depois da prévia: é a confirmação.
    async usuarioFalouDepois(conversaId, instante) {
      const { data } = await sb
        .from("mensagens_agente")
        .select("id")
        .eq("conversa_id", conversaId)
        .eq("papel", "usuario")
        .gt("created_at", instante)
        .limit(1);
      return (data ?? []).length > 0;
    },

    // rascunho → enviando num UPDATE só. Se outro pedido já pegou, volta 0 linha.
    async marcarEnviando(id, uid) {
      const { data } = await admin
        .from("envios_email")
        .update({ status: "enviando", confirmado_por: uid })
        .eq("id", id)
        .eq("status", "rascunho")
        .eq("solicitante_id", uid)
        .select("id");
      return (data ?? []).length === 1;
    },

    async concluir(id, d) {
      const linha =
        d.status === "enviado"
          ? { status: "enviado", provedor_mensagem_id: d.mensagemId ?? null, enviado_em: new Date().toISOString() }
          : { status: "erro", erro_mensagem: String(d.erro ?? "").slice(0, 500) };
      await admin.from("envios_email").update(linha).eq("id", id).eq("solicitante_id", usuarioId);
    },

    // Só os anexos do próprio usuário: pedir o de outra pessoa devolve uma lista menor, e o chamador recusa o lote.
    async buscarAnexos(ids, uid) {
      if (!ids.length) return [];
      const { data, error } = await admin
        .from("anexos_agente")
        .select("id, arquivo_id, usuario_id, nome_original, extensao, tamanho_bytes, hash_sha256, bloqueado, motivo_bloqueio")
        .in("id", ids)
        .eq("usuario_id", uid);
      if (error) throw new Error(`não consegui ler os anexos: ${error.message}`);
      return data ?? [];
    },

    // O conteúdo vem do Storage na hora do envio e é conferido contra o hash registrado no upload.
    async lerAnexo(anexo) {
      const caminho = caminhoDoAnexo(anexo.usuario_id, anexo.arquivo_id, anexo.nome_original);
      const { data, error } = await admin.storage.from(BUCKET).download(caminho);
      if (error || !data) throw new Error(`${anexo.nome_original} não está mais disponível no armazenamento.`);
      const buffer = Buffer.from(await data.arrayBuffer());
      if (hashSha256(buffer) !== anexo.hash_sha256) throw new Error(`${anexo.nome_original} mudou no armazenamento desde o upload.`);
      return buffer;
    },

    mensageiro: (pedido) => mensageiro(pedido, opcoesMensageiro),
  };
}

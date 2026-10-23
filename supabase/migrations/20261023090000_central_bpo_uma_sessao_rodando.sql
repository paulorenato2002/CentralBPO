-- Central BPO · uma pessoa só pode ter um cronômetro rodando (23/10/2026)
-- central_entrar já confere isso, mas duas entradas quase ao mesmo tempo (duas abas, clique duplo,
-- rede lenta) podiam passar juntas pela conferência. O índice garante no banco: a segunda falha
-- e o app mostra "pause ou finalize o cliente atual".
create unique index if not exists central_sessoes_uma_rodando
  on public.central_sessoes (usuario_id) where estado = 'rodando';

import { getSubscribersStore, emailFromToken, emailTemplate, SITE_URL, initBlobs } from "./lib/newsletter.js";

/**
 * GET/POST /descadastrar?token=...
 * GET → confirma e mostra a página estilizada
 * POST → descadastro em 1 clique (Gmail, RFC 8058)
 */
export async function handler(event) {
  initBlobs(event);

  const params = new URLSearchParams(event.queryStringParameters || {});
  const token = params.get("token");
  const email = token ? emailFromToken(token) : null;

  let ok = false;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const store = getSubscribersStore();
    const key = email.toLowerCase().trim();
    const existing = await store.get(key, { type: "json" }).catch(() => null);
    if (existing) {
      await store.delete(key);
      ok = true;
    }
  }

  // No POST (descadastro em 1 clique) a resposta não é exibida a ninguém
  if (event.httpMethod === "POST") {
    return { statusCode: 200, body: ok ? "ok" : "erro" };
  }

  const html = emailTemplate({
    title: ok ? "Sua inscrição foi cancelada" : "Link inválido",
    bodyHtml: ok
      ? `
        <p>Pronto — sua inscrição foi cancelada e o registro foi removido da lista.</p>
        <p>Se mudar de ideia, a porta continua aberta: é só se inscrever novamente no blog quando quiser voltar.</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${SITE_URL}" style="display:inline-block;background:#4e6351;color:#faf7f2;padding:12px 28px;border-radius:9999px;text-decoration:none;font-size:14px;">Voltar ao blog</a>
        </p>
        <p>Com acolhimento,<br/><strong>Salvio Gonçalves</strong></p>
      `
      : `
        <p>Este link de descadastro não é válido ou já expirou.</p>
        <p>Se você continua recebendo e-mails e quer sair da lista, me escreva respondendo qualquer e-mail recebido — eu faço o cancelamento manualmente.</p>
      `,
    footerNote: "Este é um e-mail automático — não é preciso responder.",
  }).replaceAll("{{UNSUBSCRIBE_URL}}", SITE_URL);

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html,
  };
}

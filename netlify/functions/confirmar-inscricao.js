import { confirmSubscription, emailTemplate, SITE_URL, initBlobs } from "./lib/newsletter.js";

/** GET /confirmar-inscricao?token=... — conclui o double opt-in */
export async function handler(event) {
  initBlobs(event);
  const token = new URLSearchParams(event.queryStringParameters || {}).get("token") || "";
  const result = await confirmSubscription(token);
  const title = result.ok ? "Inscrição confirmada" : result.reason === "expired" ? "Link expirado" : "Link inválido";
  const bodyHtml = result.ok
    ? `<p>Pronto — sua inscrição foi confirmada.</p><p>Você receberá os próximos artigos diretamente no seu e-mail.</p><p style="text-align:center;margin:24px 0;"><a href="${SITE_URL}" style="display:inline-block;background:#4e6351;color:#faf7f2;padding:12px 28px;border-radius:9999px;text-decoration:none;font-size:14px;">Voltar ao blog</a></p>`
    : result.reason === "expired"
      ? `<p>Este link de confirmação expirou após 48 horas.</p><p>Faça uma nova inscrição no blog para receber outro link de confirmação.</p><p style="text-align:center;margin:24px 0;"><a href="${SITE_URL}/#newsletter" style="display:inline-block;background:#4e6351;color:#faf7f2;padding:12px 28px;border-radius:9999px;text-decoration:none;font-size:14px;">Voltar à inscrição</a></p>`
      : `<p>Este link de confirmação não é válido.</p><p>Se você deseja receber a newsletter, faça uma nova inscrição no blog.</p><p style="text-align:center;margin:24px 0;"><a href="${SITE_URL}/#newsletter" style="display:inline-block;background:#4e6351;color:#faf7f2;padding:12px 28px;border-radius:9999px;text-decoration:none;font-size:14px;">Voltar à inscrição</a></p>`;
  const html = emailTemplate({ title, bodyHtml, footerNote: "Este é um e-mail automático — não é preciso responder." }).replaceAll("{{UNSUBSCRIBE_URL}}", SITE_URL);
  return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: html };
}

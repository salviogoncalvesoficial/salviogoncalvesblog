import { requestSubscription, confirmationUrl, sendEmail, emailTemplate, SITE_URL, initBlobs } from "./lib/newsletter.js";

/** POST /inscrever — inicia o double opt-in */
export async function handler(event) {
  initBlobs(event);

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Método não permitido" };
  const wantsJson = (event.headers["accept"] || event.headers["Accept"] || "").includes("application/json");
  const params = new URLSearchParams(event.body || "");
  const rawEmail = params.get("email") || "";
  const email = rawEmail.replace(/[\s\u200B-\u200D\uFEFF]+/g, "").toLowerCase();
  const honeypot = params.get("website");

  const json = (status, extra = {}) => ({
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, email, ...extra }),
  });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (wantsJson) return json("erro");
    return redirect(`/?newsletter=erro&email=${encodeURIComponent(email || rawEmail.trim())}#newsletter`);
  }
  if (honeypot) return wantsJson ? json("ok") : redirect("/?newsletter=ok#newsletter");

  const result = await requestSubscription(email);
  if (result.already) {
    return wantsJson ? json("ok", { already: true }) : redirect("/?newsletter=ok#newsletter");
  }

  try {
    const confirmUrl = confirmationUrl(result.confirmationToken);
    const sent = await sendEmail({
      to: email,
      subject: "Confirme sua inscrição na newsletter de Salvio Gonçalves",
      html: emailTemplate({
        title: "Confirme sua inscrição",
        bodyHtml: `<p>Olá,</p><p>Você pediu para receber os novos artigos de <strong>salviogoncalves.com.br</strong>.</p><p>Para confirmar sua inscrição, clique no botão abaixo. O link é válido por 48 horas.</p><p style="text-align:center;margin:24px 0;"><a href="${confirmUrl}" style="display:inline-block;background:#4e6351;color:#faf7f2;padding:12px 28px;border-radius:9999px;text-decoration:none;font-size:14px;">Confirmar inscrição</a></p><p>Se você não fez esse pedido, basta ignorar esta mensagem.</p>`,
        footerNote: "Newsletter destinada exclusivamente a maiores de 18 anos.",
      }),
    });
    if (!sent) return wantsJson ? json("erro_envio") : redirect("/?newsletter=erro#newsletter");
  } catch (err) {
    console.error("[newsletter] erro no double opt-in:", err?.message);
    return wantsJson ? json("erro_envio") : redirect("/?newsletter=erro#newsletter");
  }

  return wantsJson ? json("pending") : redirect("/?newsletter=pending#newsletter");
}

function redirect(to) {
  return { statusCode: 303, headers: { Location: to }, body: "" };
}

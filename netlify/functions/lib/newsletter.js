/**
 * Newsletter — biblioteca compartilhada
 * Lista de inscritos: Netlify Blobs (privado, fora do repo público)
 * Envio: Resend (API)
 */
import crypto from "node:crypto";
import { getStore, connectLambda } from "@netlify/blobs";

export const FROM_EMAIL = "Newsletter Salvio Goncalves <news@salviogoncalves.com.br>";
export const SITE_URL = "https://salviogoncalves.com.br";
const CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000;

/** Prepara o ambiente do Blobs (necessário no modo de compatibilidade Lambda) */
export function initBlobs(event) {
  try {
    connectLambda(event);
  } catch {
    /* fora do modo Lambda, o contexto já é injetado automaticamente */
  }
}

export function getSubscribersStore() {
  return getStore("newsletter");
}

/** Token para link de descadastro (não expõe o e-mail na URL) */
export function makeToken(email) {
  return Buffer.from(email).toString("base64url");
}

export function emailFromToken(token) {
  try {
    return Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** URL de descadastro por destinatário */
export function unsubscribeUrl(email) {
  return `${SITE_URL}/.netlify/functions/descadastrar?token=${makeToken(email)}`;
}

/** Token aleatório para double opt-in */
export function makeConfirmationToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function confirmationUrl(token) {
  return `${SITE_URL}/.netlify/functions/confirmar-inscricao?token=${encodeURIComponent(token)}`;
}

/** Lista TODOS os inscritos (qualquer status) — para o dashboard */
export async function getAllSubscribers() {
  const store = getSubscribersStore();
  const { blobs } = await store.list();
  const all = [];
  for (const blob of blobs) {
    const data = await store.get(blob.key, { type: "json" });
    if (data) all.push(data);
  }
  all.sort((a, b) => (b.subscribedAt ?? "").localeCompare(a.subscribedAt ?? ""));
  return all;
}

/** Lista de e-mails ativos (para o envio semanal) */
export async function getActiveSubscribers() {
  const all = await getAllSubscribers();
  return all.filter((s) => s.status === "active");
}

/** Inscrição pública: cria/atualiza como pending e devolve o token de confirmação */
export async function requestSubscription(email) {
  const store = getSubscribersStore();
  const key = email.toLowerCase().trim();
  const existing = await store.get(key, { type: "json" }).catch(() => null);
  if (existing?.status === "active") return { ok: true, already: true };

  const now = new Date().toISOString();
  const token = makeConfirmationToken();
  const data = {
    ...(existing || {}),
    email: key,
    status: "pending",
    subscribedAt: existing?.subscribedAt || now,
    confirmationToken: token,
    confirmationExpiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString(),
    pendingAt: now,
  };
  await store.setJSON(key, data);
  return { ok: true, pending: true, confirmationToken: token };
}

/** Confirma uma inscrição pendente; tokens são de uso único */
export async function confirmSubscription(token) {
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return { ok: false, reason: "invalid" };
  const store = getSubscribersStore();
  const { blobs } = await store.list();
  for (const blob of blobs) {
    const data = await store.get(blob.key, { type: "json" }).catch(() => null);
    if (!data || data.confirmationToken !== token) continue;
    if (data.status !== "pending") return { ok: data.status === "active", already: data.status === "active" };
    if (!data.confirmationExpiresAt || Date.now() > new Date(data.confirmationExpiresAt).getTime()) {
      return { ok: false, reason: "expired" };
    }
    const confirmedAt = new Date().toISOString();
    await store.setJSON(blob.key, {
      ...data,
      status: "active",
      confirmedAt,
      confirmationToken: null,
      confirmationExpiresAt: null,
    });
    return { ok: true, email: data.email };
  }
  return { ok: false, reason: "invalid" };
}

/** Inscreve ou reativa um e-mail diretamente (uso administrativo) */
export async function subscribe(email) {
  const store = getSubscribersStore();
  const key = email.toLowerCase().trim();
  const existing = await store.get(key, { type: "json" }).catch(() => null);
  if (existing) {
    if (existing.status === "active") return { ok: true, already: true };
    await store.setJSON(key, { ...existing, status: "active", confirmedAt: new Date().toISOString(), reactivatedAt: new Date().toISOString(), confirmationToken: null, confirmationExpiresAt: null });
    return { ok: true, reactivated: true };
  }
  await store.setJSON(key, { email: key, status: "active", subscribedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() });
  return { ok: true };
}

/** Remove um inscrito da lista (dashboard) */
export async function removeSubscriber(email) {
  const store = getSubscribersStore();
  await store.delete(email.toLowerCase().trim());
  return { ok: true };
}

/** Marca como cancelado (descadastro) */
export async function unsubscribe(email) {
  const store = getSubscribersStore();
  const key = email.toLowerCase().trim();
  const existing = await store.get(key, { type: "json" }).catch(() => null);
  if (!existing) return { ok: false };
  await store.setJSON(key, { ...existing, status: "unsubscribed", unsubscribedAt: new Date().toISOString(), confirmationToken: null, confirmationExpiresAt: null });
  return { ok: true };
}

/** Envia e-mail via Resend — substitui o link de descadastro por destinatário */
export async function sendEmail({ to, subject, html }) {
  const unsub = unsubscribeUrl(to);
  const finalHtml = html.replaceAll("{{UNSUBSCRIBE_URL}}", unsub);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html: finalHtml,
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
  });
  return res.ok;
}

/**
 * Monta e envia a newsletter semanal (posts dos últimos 7 dias via RSS).
 * Usada pela função agendada e pelo botão "enviar agora" do dashboard.
 */
export async function sendWeeklyNewsletter() {
  const rss = await fetch(`${SITE_URL}/rss.xml`).then((r) => r.text());
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(rss)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    const ts = pubDate ? new Date(pubDate).getTime() : 0;
    if (ts >= weekAgo) items.push({ title: decodeXml(title), link });
  }
  if (items.length === 0) return { sent: 0, total: 0, posts: 0, message: "Nenhum post novo na última semana — nada a enviar." };
  const listHtml = items.map((item) => `<div style="margin:0 0 20px 0;padding:16px;background:#f1ebe2;border-radius:12px;"><a href="${item.link}" style="color:#2c2723;font-weight:600;text-decoration:none;font-size:16px;">${item.title}</a><br/><a href="${item.link}" style="color:#4e6351;font-size:13px;text-decoration:underline;">Ler o artigo →</a></div>`).join("");
  const plural = items.length > 1 ? "s" : "";
  const html = emailTemplate({ title: `${items.length} novo${plural} artigo${plural} no blog`, bodyHtml: `<p>Olá,</p><p>Passando para compartilhar o que publiquei nesta semana:</p>${listHtml}<p>Uma boa leitura — e até a próxima reflexão.</p><p>Com acolhimento,<br/><strong>Salvio Gonçalves</strong></p>`, footerNote: "Você recebe este e-mail porque se inscreveu na newsletter do blog." });
  const subscribers = await getActiveSubscribers();
  let sent = 0;
  for (const sub of subscribers) {
    if (sent >= 90) break;
    const ok = await sendEmail({ to: sub.email, subject: `Novo${plural} artigo${plural} de Salvio Gonçalves`, html });
    if (ok) sent++;
  }
  return { sent, total: subscribers.length, posts: items.length, message: `Enviado para ${sent} de ${subscribers.length} inscritos (${items.length} post${plural}).` };
}

function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Template base — identidade "Acolhimento Sóbrio" do blog. */
export function emailTemplate({ title, bodyHtml, footerNote }) {
  return `<!doctype html><html lang="pt-br"><body style="margin:0;padding:0;background:#f1ebe2;font-family:Georgia,'Times New Roman',serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe2;padding:32px 16px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#faf7f2;border-radius:16px;border:1px solid #e2dacd;overflow:hidden;"><tr><td style="padding:32px 40px 8px 40px;text-align:center;"><p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4e6351;font-weight:600;">Salvio Gonçalves · Terapeuta</p></td></tr><tr><td style="padding:8px 40px 0 40px;"><h1 style="margin:0;font-size:22px;line-height:1.3;color:#2c2723;text-align:center;">${title}</h1></td></tr><tr><td style="padding:16px 40px 8px 40px;"><div style="font-size:15px;line-height:1.7;color:#2c2723;">${bodyHtml}</div></td></tr><tr><td style="padding:16px 40px 32px 40px;border-top:1px solid #e2dacd;margin-top:16px;"><p style="margin:0 0 8px 0;font-size:12px;color:#6e655c;text-align:center;">${footerNote ?? ""}</p><p style="margin:0;font-size:12px;color:#6e655c;text-align:center;"><a href="${SITE_URL}" style="color:#4e6351;">salviogoncalves.com.br</a>&nbsp;·&nbsp;<a href="{{UNSUBSCRIBE_URL}}" style="color:#6e655c;">Cancelar inscrição</a></p></td></tr></table></td></tr></table></body></html>`;
}
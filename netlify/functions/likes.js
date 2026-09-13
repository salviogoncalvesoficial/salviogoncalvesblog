import { getStore, connectLambda } from "@netlify/blobs";

const SLUG_RE = /^[a-z0-9-]+$/;
const ID_RE = /^[a-zA-Z0-9_-]{16,100}$/;

function init(event) {
  try { connectLambda(event); } catch { /* Netlify injeta o contexto fora do modo Lambda */ }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  init(event);
  const store = getStore("post-likes");
  const method = event.httpMethod;
  const params = new URLSearchParams(event.queryStringParameters?.slug ? `slug=${event.queryStringParameters.slug}` : "");
  let slug = params.get("slug") || "";
  let visitorId = "";

  if (method === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      slug = body.slug || slug;
      visitorId = body.visitorId || "";
    } catch {
      return json(400, { status: "erro", message: "Pedido inválido." });
    }
  }

  if (!SLUG_RE.test(slug)) return json(400, { status: "erro", message: "Artigo inválido." });
  const key = slug;
  const current = await store.get(key, { type: "json" }).catch(() => null) || { count: 0, voters: [] };
  const voters = Array.isArray(current.voters) ? current.voters : [];
  const voterDates = current.voterDates && typeof current.voterDates === "object" ? current.voterDates : {};

  if (method === "GET") return json(200, { status: "ok", count: Number(current.count) || 0 });
  if (method !== "POST") return json(405, { status: "erro", message: "Método não permitido." });
  if (!ID_RE.test(visitorId)) return json(400, { status: "erro", message: "Identificador inválido." });

  if (voters.includes(visitorId)) {
    return json(200, { status: "ok", count: Number(current.count) || 0, already: true });
  }

  voters.push(visitorId);
  voterDates[visitorId] = new Date().toISOString();
  const count = (Number(current.count) || 0) + 1;
  await store.setJSON(key, {
    count,
    voters: voters.slice(-100000),
    voterDates,
    updatedAt: new Date().toISOString(),
  });
  return json(200, { status: "ok", count });
}

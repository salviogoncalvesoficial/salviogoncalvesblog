import { getStore, connectLambda } from "@netlify/blobs";

const LIKE_RETENTION_DAYS = 365;
const INBOX_RETENTION_DAYS = 183;
const RESERVED_INBOX_KEYS = new Set(["signature"]);

function init(event) {
  try { connectLambda(event); } catch { /* Netlify injeta o contexto */ }
}

function isoCutoff(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function messageActivity(data) {
  const values = [data?.updatedAt, data?.receivedAt, data?.sentAt, data?.createdAt]
    .map((v) => v ? new Date(v).getTime() : 0)
    .filter((v) => Number.isFinite(v) && v > 0);
  return values.length ? Math.max(...values) : 0;
}

async function purgeLikes({ dryRun, cutoff }) {
  const store = getStore("post-likes");
  const { blobs } = await store.list();
  let posts = 0;
  let identifiersRemoved = 0;
  let legacyIdentifiersRemoved = 0;

  for (const blob of blobs) {
    const data = await store.get(blob.key, { type: "json" }).catch(() => null);
    if (!data || !Array.isArray(data.voters)) continue;
    const dates = data.voterDates && typeof data.voterDates === "object" ? data.voterDates : {};
    const voters = data.voters;
    const keep = [];
    const keepDates = {};
    for (const id of voters) {
      const createdAt = dates[id] ? new Date(dates[id]).getTime() : 0;
      // Registros legados não têm data verificável: são removidos nesta primeira migração.
      if (!createdAt) {
        legacyIdentifiersRemoved++;
        continue;
      }
      if (createdAt < cutoff) {
        identifiersRemoved++;
        continue;
      }
      keep.push(id);
      keepDates[id] = dates[id];
    }
    const changed = keep.length !== voters.length || Object.keys(keepDates).length !== Object.keys(dates).length;
    if (changed) {
      posts++;
      if (!dryRun) {
        await store.setJSON(blob.key, {
          ...data,
          // A contagem agregada permanece intacta; apenas os identificadores expiram.
          voters: keep,
          voterDates: keepDates,
          retentionUpdatedAt: new Date().toISOString(),
        });
      }
    }
  }
  return { posts, identifiersRemoved, legacyIdentifiersRemoved };
}

async function purgeInbox({ dryRun, cutoff }) {
  const store = getStore("inbox");
  const { blobs } = await store.list();
  let messages = 0;
  let attachments = 0;
  let skippedNoDate = 0;

  for (const blob of blobs) {
    if (RESERVED_INBOX_KEYS.has(blob.key)) continue;
    const data = await store.get(blob.key, { type: "json" }).catch(() => null);
    if (!data || typeof data !== "object") continue;
    const activity = messageActivity(data);
    if (!activity) {
      skippedNoDate++;
      continue;
    }
    if (activity >= cutoff) continue;
    messages++;
    if (Array.isArray(data.attachments) && data.attachments.length) attachments += data.attachments.length;
    if (!dryRun) await store.delete(blob.key);
  }
  return { messages, attachments, skippedNoDate };
}

export async function handler(event) {
  init(event);
  const dryRun = process.env.RETENTION_DRY_RUN !== "false";
  const result = {
    dryRun,
    generatedAt: new Date().toISOString(),
    likes: await purgeLikes({ dryRun, cutoff: isoCutoff(LIKE_RETENTION_DAYS) }),
    inbox: await purgeInbox({ dryRun, cutoff: isoCutoff(INBOX_RETENTION_DAYS) }),
  };
  console.log("[retention]", JSON.stringify(result));
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
}

export const config = {
  schedule: "30 3 * * 0",
};

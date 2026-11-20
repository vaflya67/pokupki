/**
 * «Почтальон» для списка покупок.
 * - Кто-то добавил товар → уведомление второму («Влад добавил(а) в список: Молоко, Хлеб»)
 *   Несколько товаров подряд (в течение 3 минут) собираются в одно уведомление.
 * - Кто-то отметил последний товар → «✅ Всё куплено!»
 * Себе уведомления не приходят.
 */
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 2, memory: "256MiB" });

const db = admin.firestore();
const WINDOW_MS = 3 * 60 * 1000;

async function sendToOthers(code, exceptDeviceId, payload) {
  const snap = await db.collection("lists").doc(code).collection("devices").get();
  const targets = snap.docs.filter((d) => d.id !== exceptDeviceId && d.get("token"));
  return sendToDevices(code, targets, payload);
}

/* Отправка + запись результата в lists/{code}/meta/push — видно в меню 🔔 */
async function sendToDevices(code, targets, payload) {
  const report = { at: Date.now(), title: payload.title, results: [] };
  if (!targets.length) {
    report.results.push({ name: "—", ok: false, error: "нет получателей (у второго не включён 🔔)" });
    await db.collection("lists").doc(code).collection("meta").doc("push").set(report);
    return report;
  }

  const res = await admin.messaging().sendEachForMulticast({
    tokens: targets.map((d) => d.get("token")),
    data: payload,
    webpush: { headers: { Urgency: "high", TTL: "86400" } },
  });

  res.responses.forEach((r, i) => {
    report.results.push({
      name: targets[i].get("name") || "без имени",
      ok: r.success,
      error: r.success ? "" : (r.error?.code || "error"),
    });
  });
  await db.collection("lists").doc(code).collection("meta").doc("push").set(report);

  await Promise.all(
    res.responses.map((r, i) => {
      if (r.success) return null;
      const errCode = r.error?.code || "";
      logger.warn("push failed", errCode);
      if (errCode.includes("registration-token-not-registered") || errCode.includes("invalid-registration-token")) {
        return targets[i].ref.delete();
      }
      return null;
    })
  );
  return report;
}

function listNames(names) {
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 4).join(", ")} и ещё ${names.length - 4}`;
}

exports.onItemAdded = onDocumentCreated("lists/{code}/items/{itemId}", async (event) => {
  const item = event.data?.data();
  if (!item || item.restoredAt || item.done) return;
  const code = event.params.code;
  const by = item.addedBy || null;
  const byName = (item.addedByName || "").trim();
  const metaRef = db.collection("lists").doc(code).collection("meta").doc("notify");
  const now = Date.now();

  const { names, windowStart } = await db.runTransaction(async (tx) => {
    const meta = (await tx.get(metaRef)).data() || {};
    let names;
    let windowStart;
    if (meta.by === by && now - (meta.windowStart || 0) < WINDOW_MS) {
      names = [...(meta.names || []), item.name].slice(-30);
      windowStart = meta.windowStart;
    } else {
      names = [item.name];
      windowStart = now;
    }
    tx.set(metaRef, { by, names, windowStart });
    return { names, windowStart };
  });

  await sendToOthers(code, by, {
    title: byName ? `🛒 ${byName} добавил(а) в список` : "🛒 Список покупок обновлён",
    body: listNames(names),
    tag: `add-${code}-${windowStart}`,
    url: `./?l=${code}`,
  });
});

exports.onItemBought = onDocumentUpdated("lists/{code}/items/{itemId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.done || !after.done) return;
  const code = event.params.code;

  const left = await db.collection("lists").doc(code).collection("items").where("done", "==", false).limit(1).get();
  if (!left.empty) return;

  const byName = (after.doneByName || "").trim();
  await sendToOthers(code, after.doneBy || null, {
    title: "✅ Всё куплено!",
    body: byName ? `${byName} купил(а) всё из списка` : "Весь список куплен",
    tag: `done-${code}`,
    url: `./?l=${code}`,
  });
});

/* Тест: уведомление на этот же телефон через несколько секунд (успеть заблокировать экран) */
exports.onPushTest = onDocumentCreated("lists/{code}/tests/{testId}", async (event) => {
  const t = event.data?.data();
  if (!t?.deviceId) return;
  const code = event.params.code;
  const delay = Math.min(Math.max(Number(t.delaySec) || 10, 0), 20);
  await new Promise((r) => setTimeout(r, delay * 1000));
  const dev = await db.collection("lists").doc(code).collection("devices").doc(t.deviceId).get();
  const report = await sendToDevices(code, dev.exists && dev.get("token") ? [dev] : [], {
    title: "🔔 Тест уведомлений",
    body: "Если ты это видишь — всё работает 🎉",
    tag: `test-${code}`,
    url: `./?l=${code}`,
  });
  await event.data.ref.delete().catch(() => {});
  logger.info("push test", report);
});

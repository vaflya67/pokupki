import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDocs,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const THEME_KEY = "spisok-pokupok-theme";
const LIST_KEY = "spisok-pokupok-list-code";
const CAT_KEY = "spisok-pokupok-category";
const HINT_KEY = "spisok-pokupok-swipe-hint";
const SWIPE_THRESHOLD = 72;

const CATEGORIES = [
  { id: "food", label: "Продукты", emoji: "🛒" },
  { id: "household", label: "Бытовуха", emoji: "🧴" },
  { id: "cats", label: "Коты", emoji: "🐱" },
  { id: "other", label: "Другое", emoji: "📦" },
];

const LEGACY_CATEGORY = {
  dairy: "food",
  produce: "food",
  meat: "food",
  bakery: "food",
  food: "food",
  household: "household",
  cats: "cats",
  other: "other",
};

const AUTO_CATEGORY = {
  молоко: "food", кефир: "food", сметана: "food", творог: "food", сыр: "food",
  йогурт: "food", масло: "food", яйца: "food", яйцо: "food", хлеб: "food",
  батон: "food", булка: "food", курица: "food", говядина: "food", рыба: "food",
  картошка: "food", лук: "food", морковь: "food", помидор: "food", огурец: "food",
  банан: "food", яблок: "food", фарш: "food", колбаса: "food",
  корм: "cats", кошач: "cats", кот: "cats", кота: "cats", наполнитель: "cats",
  лакомств: "cats",
  вода: "household", соль: "household", сахар: "household", мыло: "household",
  шампунь: "household", порошок: "household", туалетн: "household", салфет: "household",
  губк: "household", мусорн: "household",
};

const setupOverlay = document.getElementById("setupOverlay");
const joinOverlay = document.getElementById("joinOverlay");
const appEl = document.getElementById("app");
const addForm = document.getElementById("addForm");
const itemInput = document.getElementById("itemInput");
const listWrap = document.getElementById("listWrap");
const categoryBar = document.getElementById("categoryBar");
const emptyEl = document.getElementById("empty");
const footerEl = document.getElementById("footer");
const statNeed = document.getElementById("statNeed");
const statDone = document.getElementById("statDone");
const clearDoneBtn = document.getElementById("clearDone");
const clearAllBtn = document.getElementById("clearAll");
const themeBtn = document.getElementById("themeBtn");
const createListBtn = document.getElementById("createListBtn");
const joinForm = document.getElementById("joinForm");
const joinCodeInput = document.getElementById("joinCodeInput");
const listCodeLabel = document.getElementById("listCodeLabel");
const shareBtn = document.getElementById("shareBtn");
const syncDot = document.getElementById("syncDot");
const toastEl = document.getElementById("toast");
const swipeHint = document.getElementById("swipeHint");

let selectedCategory = normalizeCategory(localStorage.getItem(CAT_KEY) || "food");
let items = [];
let hideDone = false;
let listCode = "";
let db = null;
let unsubscribe = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeCategory(id) {
  return LEGACY_CATEGORY[id] || "food";
}

function guessCategory(name) {
  const key = name.trim().toLowerCase();
  for (const [word, cat] of Object.entries(AUTO_CATEGORY)) {
    if (key.includes(word)) return cat;
  }
  return "food";
}

function getCategory(id) {
  return CATEGORIES.find((c) => c.id === normalizeCategory(id)) || CATEGORIES[0];
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function normalizeCode(raw) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function getShareUrl(code) {
  const url = new URL(window.location.href);
  url.searchParams.set("l", code);
  return url.toString();
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function setSyncStatus(status) {
  syncDot.className = "sync-dot sync-dot--" + status;
  const labels = { live: "Онлайн", offline: "Офлайн", wait: "Подключение…" };
  syncDot.title = labels[status] || status;
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  themeBtn.setAttribute("aria-label", theme === "dark" ? "Светлая тема" : "Тёмная тема");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0f1a17" : "#1a5c4b";
  localStorage.setItem(THEME_KEY, theme);
}

function itemsRef() {
  return collection(db, "lists", listCode, "items");
}

async function persistItem(item) {
  await setDoc(doc(itemsRef(), item.id), item);
}

async function patchItem(id, data) {
  await updateDoc(doc(itemsRef(), id), data);
}

async function dropItem(id) {
  await deleteDoc(doc(itemsRef(), id));
}

async function batchDelete(ids) {
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(itemsRef(), id)));
  await batch.commit();
}

function renderCategoryBar() {
  categoryBar.innerHTML = CATEGORIES.map(
    (cat) => `
      <button type="button" class="cats__btn${selectedCategory === cat.id ? " cats__btn--active" : ""}" data-cat="${cat.id}">
        ${cat.emoji} ${cat.label}
      </button>`
  ).join("");

  categoryBar.querySelectorAll(".cats__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCategory = btn.dataset.cat;
      localStorage.setItem(CAT_KEY, selectedCategory);
      renderCategoryBar();
    });
  });
}

async function addItem(name, category) {
  const trimmed = name.trim();
  if (!trimmed || !db) return;

  const cat = normalizeCategory(category || selectedCategory || guessCategory(trimmed));
  const existing = items.find(
    (i) =>
      !i.done &&
      i.name.toLowerCase() === trimmed.toLowerCase() &&
      normalizeCategory(i.category) === cat
  );

  if (existing) {
    await patchItem(existing.id, { qty: existing.qty + 1 });
  } else {
    const item = { id: uid(), name: trimmed, qty: 1, done: false, category: cat };
    await persistItem(item);
  }

  itemInput.value = "";
  itemInput.focus();
}

async function toggleDone(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  await patchItem(id, { done: !item.done });
  if (!item.done) hideSwipeHint();
}

function hideSwipeHint() {
  localStorage.setItem(HINT_KEY, "1");
  if (swipeHint) swipeHint.hidden = true;
}

async function changeQty(id, delta) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const qty = Math.max(1, item.qty + delta);
  await patchItem(id, { qty });
}

async function removeItem(id) {
  await dropItem(id);
}

async function clearDone() {
  const ids = items.filter((i) => i.done).map((i) => i.id);
  if (ids.length) await batchDelete(ids);
}

async function clearAll() {
  if (!items.length) return;
  if (confirm("Очистить весь список?")) {
    await batchDelete(items.map((i) => i.id));
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function attachSwipeBuy(wrap, item) {
  const panel = wrap.querySelector(".item__panel");
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let dragging = false;

  function reset(animate) {
    panel.style.transition = animate ? "transform 0.2s ease" : "";
    panel.style.transform = "";
    wrap.classList.remove("item-wrap--swiping");
    setTimeout(() => { panel.style.transition = ""; }, 200);
  }

  function onStart(clientX, clientY, target) {
    if (target.closest("button")) return;
    startX = clientX;
    startY = clientY;
    deltaX = 0;
    dragging = true;
    panel.style.transition = "";
  }

  function onMove(clientX, clientY, e) {
    if (!dragging) return;
    const dx = clientX - startX;
    const dy = Math.abs(clientY - startY);
    if (dx <= 0 && deltaX === 0) return;
    if (dy > dx && deltaX < 12) return;
    if (e) e.preventDefault();
    deltaX = Math.max(0, Math.min(dx, 130));
    panel.style.transform = `translateX(${deltaX}px)`;
    wrap.classList.toggle("item-wrap--swiping", deltaX > 8);
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    if (deltaX >= SWIPE_THRESHOLD) {
      panel.style.transform = "translateX(100%)";
      panel.style.transition = "transform 0.2s ease";
      setTimeout(() => toggleDone(item.id), 180);
    } else {
      reset(true);
    }
    deltaX = 0;
  }

  wrap.addEventListener("touchstart", (e) => onStart(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
  wrap.addEventListener("touchmove", (e) => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  wrap.addEventListener("touchend", onEnd);
  wrap.addEventListener("touchcancel", onEnd);

  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    onStart(e.clientX, e.target);
    const onMouseMove = (ev) => onMove(ev.clientX);
    const onMouseUp = () => {
      onEnd();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

function renderItem(item, mode) {
  const cat = getCategory(item.category);
  const li = document.createElement("li");

  if (mode === "buy") {
    li.className = "item-wrap";
    li.innerHTML = `
      <div class="item-swipe">
        <div class="item-swipe__bg">✓ Куплено</div>
        <div class="item item__panel">
          <div class="item__body">
            <span class="item__name">${escapeHtml(item.name)}</span>
            ${item.qty > 1 ? `<span class="item__qty-inline">× ${item.qty}</span>` : ""}
          </div>
          <div class="item__qty">
            <button type="button" class="item__qty-btn" data-action="minus" aria-label="Меньше">−</button>
            <span class="item__qty-num">${item.qty}</span>
            <button type="button" class="item__qty-btn" data-action="plus" aria-label="Больше">+</button>
          </div>
          <button type="button" class="item__delete" aria-label="Удалить">✕</button>
        </div>
      </div>`;

    attachSwipeBuy(li, item);
  } else {
    li.className = "item item--done";
    li.innerHTML = `
      <div class="item__body">
        <span class="item__name">${escapeHtml(item.name)}</span>
        <span class="item__cat">${cat.emoji} ${cat.label}${item.qty > 1 ? ` · ×${item.qty}` : ""}</span>
      </div>
      <button type="button" class="item__undo" aria-label="Вернуть в список">↩</button>
      <button type="button" class="item__delete" aria-label="Удалить">✕</button>`;

    li.querySelector(".item__undo").addEventListener("click", () => toggleDone(item.id));
  }

  li.querySelector('[data-action="minus"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (item.qty === 1) removeItem(item.id);
    else changeQty(item.id, -1);
  });
  li.querySelector('[data-action="plus"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    changeQty(item.id, 1);
  });
  li.querySelector(".item__delete")?.addEventListener("click", (e) => {
    e.stopPropagation();
    removeItem(item.id);
  });

  return li;
}

function render() {
  listWrap.innerHTML = "";
  const need = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const visibleDone = hideDone ? [] : done;

  CATEGORIES.forEach((cat) => {
    const group = need.filter((i) => normalizeCategory(i.category) === cat.id);
    if (!group.length) return;
    const section = document.createElement("section");
    section.className = "group";
    section.innerHTML = `<h2 class="group__title">${cat.emoji} ${cat.label} <span class="group__count">${group.length}</span></h2>`;
    const ul = document.createElement("ul");
    ul.className = "list";
    group.forEach((item) => ul.appendChild(renderItem(item, "buy")));
    section.appendChild(ul);
    listWrap.appendChild(section);
  });

  if (visibleDone.length) {
    const section = document.createElement("section");
    section.className = "group group--done";
    section.innerHTML = `<h2 class="group__title group__title--toggle" id="doneToggle">✅ Куплено <span class="group__chevron">${hideDone ? "▸" : "▾"}</span></h2>`;
    const ul = document.createElement("ul");
    ul.className = "list";
    if (!hideDone) visibleDone.forEach((item) => ul.appendChild(renderItem(item, "done")));
    section.appendChild(ul);
    listWrap.appendChild(section);
    section.querySelector("#doneToggle").addEventListener("click", () => {
      hideDone = !hideDone;
      render();
    });
  } else {
    hideDone = false;
  }

  const total = items.length;
  emptyEl.hidden = total > 0;
  footerEl.hidden = total === 0;
  statNeed.textContent = `${need.length} нужно`;
  statDone.textContent = `${done.length} куплено`;

  if (swipeHint) {
    swipeHint.hidden = need.length === 0 || localStorage.getItem(HINT_KEY) === "1";
  }
}

function showApp() {
  joinOverlay.hidden = true;
  appEl.hidden = false;
  listCodeLabel.textContent = listCode;
  history.replaceState(null, "", getShareUrl(listCode));
  renderCategoryBar();
  render();
}

function connectList(code) {
  listCode = normalizeCode(code);
  if (listCode.length !== 6) {
    showToast("Код — 6 символов");
    return;
  }

  localStorage.setItem(LIST_KEY, listCode);
  setSyncStatus("wait");

  if (unsubscribe) unsubscribe();

  unsubscribe = onSnapshot(
    itemsRef(),
    (snap) => {
      items = snap.docs.map((d) => {
        const data = d.data();
        return { ...data, category: normalizeCategory(data.category) };
      });
      setSyncStatus(navigator.onLine ? "live" : "offline");
      render();
    },
    (err) => {
      console.error(err);
      setSyncStatus("offline");
      showToast("Ошибка синхронизации");
    }
  );

  showApp();
}

async function shareList() {
  const url = getShareUrl(listCode);
  const text = `Наш список покупок 🛒\nКод: ${listCode}\n${url}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: "Список покупок", text, url });
      return;
    } catch { /* cancelled */ }
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("Ссылка скопирована!");
  } catch {
    prompt("Скопируй ссылку:", url);
  }
}

async function loadConfig() {
  try {
    return await import("./firebase-config.js");
  } catch {
    return null;
  }
}

async function initFirebase(config) {
  const app = initializeApp(config.firebaseConfig);
  db = getFirestore(app);
  try {
    await enableIndexedDbPersistence(db);
  } catch { /* multi-tab */ }
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addItem(itemInput.value);
});

clearDoneBtn.addEventListener("click", clearDone);
clearAllBtn.addEventListener("click", clearAll);
themeBtn.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
shareBtn.addEventListener("click", shareList);

createListBtn.addEventListener("click", () => connectList(generateCode()));

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  connectList(joinCodeInput.value);
});

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = normalizeCode(joinCodeInput.value);
});

window.addEventListener("online", () => setSyncStatus("live"));
window.addEventListener("offline", () => setSyncStatus("offline"));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initTheme();

const configModule = await loadConfig();

if (!configModule?.isConfigured) {
  setupOverlay.hidden = false;
} else {
  await initFirebase(configModule);

  const fromUrl = new URLSearchParams(location.search).get("l");
  const saved = localStorage.getItem(LIST_KEY);

  if (fromUrl && normalizeCode(fromUrl).length === 6) {
    connectList(fromUrl);
  } else if (saved && normalizeCode(saved).length === 6) {
    connectList(saved);
  } else {
    joinOverlay.hidden = false;
  }
}

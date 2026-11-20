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
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported as messagingSupported,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

const THEME_KEY = "spisok-pokupok-theme";
const LIST_KEY = "spisok-pokupok-list-code";
const CAT_KEY = "spisok-pokupok-category";
const HINT_KEY = "spisok-pokupok-swipe-hint-v2";
const DEVICE_KEY = "spisok-pokupok-device";
const NAME_KEY = "spisok-pokupok-name";
const NOTIFY_KEY = "spisok-pokupok-notify";
const VAPID_KEY = "BClrRmY3AimUoMbbK5kAmafUVEe_2HuXcMH4TC40raMJ_yoYwIAAh77UQOsL-pN5u8SBup2Np-uSUjie1U1skeQ";
const SWIPE_THRESHOLD = 80;
const ANIM_MS = 260;

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

const $ = (id) => document.getElementById(id);
const setupOverlay = $("setupOverlay");
const joinOverlay = $("joinOverlay");
const appEl = $("app");
const addForm = $("addForm");
const itemInput = $("itemInput");
const listWrap = $("listWrap");
const categoryBar = $("categoryBar");
const emptyEl = $("empty");
const emptyTitle = $("emptyTitle");
const emptyText = $("emptyText");
const footerEl = $("footer");
const progressEl = $("progress");
const progressBar = $("progressBar");
const statNeed = $("statNeed");
const statDone = $("statDone");
const clearDoneBtn = $("clearDone");
const clearAllBtn = $("clearAll");
const themeBtn = $("themeBtn");
const notifyBtn = $("notifyBtn");
const createListBtn = $("createListBtn");
const joinForm = $("joinForm");
const joinCodeInput = $("joinCodeInput");
const listCodeLabel = $("listCodeLabel");
const shareBtn = $("shareBtn");
const syncDot = $("syncDot");
const toastEl = $("toast");
const swipeHint = $("swipeHint");
const bottomBar = document.querySelector(".bottom-bar");

let selectedCategory = normalizeCategory(localStorage.getItem(CAT_KEY) || "food");
let items = [];
let hideDone = false;
let listCode = "";
let db = null;
let unsubscribe = null;
let openId = null;
let knownIds = null;
let nudgeShown = false;
let editId = null;
let editDraft = null;
let pendingRender = false;
let firebaseApp = null;
let messaging = null;
let pushSupported = false;
const deviceId = localStorage.getItem(DEVICE_KEY) || (() => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  localStorage.setItem(DEVICE_KEY, id);
  return id;
})();
const myName = () => localStorage.getItem(NAME_KEY) || "";

/* ---------- helpers ---------- */

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

function catColor(id) {
  return `var(--cat-${normalizeCategory(id)})`;
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* Вибрация: Android — vibrate, iPhone (iOS 18+) — трюк с переключателем */
const hapticLabel = (() => {
  const label = document.createElement("label");
  label.className = "haptic";
  label.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
})();

function haptic() {
  try {
    if (navigator.vibrate) navigator.vibrate(12);
    else hapticLabel.click();
  } catch { /* ignore */ }
}

function showToast(msg, action) {
  toastEl.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  toastEl.appendChild(span);
  toastEl.classList.toggle("toast--plain", !action);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast__action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      toastEl.hidden = true;
      action.run();
    });
    toastEl.appendChild(btn);
  }
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, action ? 4500 : 2200);
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
  if (meta) meta.content = theme === "dark" ? "#0e1513" : "#f3f6f4";
  localStorage.setItem(THEME_KEY, theme);
}

/* Нижняя панель не должна закрывать список */
function syncBottomPadding() {
  if (!bottomBar) return;
  document.documentElement.style.setProperty("--bottom-h", bottomBar.offsetHeight + "px");
}
if (bottomBar && "ResizeObserver" in window) {
  new ResizeObserver(syncBottomPadding).observe(bottomBar);
}

/* ---------- Firestore ---------- */

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

async function batchRestore(list) {
  const batch = writeBatch(db);
  list.forEach((item) => batch.set(doc(itemsRef(), item.id), { ...item, restoredAt: Date.now() }));
  await batch.commit();
}

/* ---------- actions ---------- */

function renderCategoryBar() {
  categoryBar.innerHTML = CATEGORIES.map(
    (cat) => `
      <button type="button" class="cats__btn${selectedCategory === cat.id ? " cats__btn--active" : ""}" data-cat="${cat.id}" style="--c:${catColor(cat.id)}">
        ${cat.emoji} ${cat.label}
      </button>`
  ).join("");
  addForm.style.setProperty("--c", catColor(selectedCategory));

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

  itemInput.value = "";
  itemInput.focus();

  if (existing) {
    await patchItem(existing.id, { qty: existing.qty + 1 });
    showToast(`${existing.name} — уже ${existing.qty + 1} шт.`);
  } else {
    const item = { id: uid(), name: trimmed, qty: 1, done: false, category: cat, addedBy: deviceId, addedByName: myName() };
    await persistItem(item);
  }
}

function hideSwipeHint() {
  localStorage.setItem(HINT_KEY, "1");
  if (swipeHint) swipeHint.hidden = true;
}

async function setDone(id, done) {
  if (!items.find((i) => i.id === id)) return;
  if (openId === id) openId = null;
  await patchItem(id, done ? { done, doneBy: deviceId, doneByName: myName() } : { done });
}

async function changeQty(id, delta) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const qty = Math.max(1, item.qty + delta);
  if (qty !== item.qty) haptic();
  await patchItem(id, { qty });
}

async function removeItem(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (openId === id) openId = null;
  const copy = { ...item };
  await dropItem(id);
  showToast(`Удалено: ${copy.name}`, { label: "Отменить", run: () => persistItem({ ...copy, restoredAt: Date.now() }) });
}

async function clearDone() {
  const done = items.filter((i) => i.done).map((i) => ({ ...i }));
  if (!done.length) return;
  await batchDelete(done.map((i) => i.id));
  showToast(`Убрано: ${done.length}`, { label: "Отменить", run: () => batchRestore(done) });
}

async function clearAll() {
  if (!items.length) return;
  if (!confirm("Очистить весь список?")) return;
  const all = items.map((i) => ({ ...i }));
  await batchDelete(all.map((i) => i.id));
  showToast("Список очищен", { label: "Отменить", run: () => batchRestore(all) });
}

/* Плавно схлопнуть строку, потом выполнить действие */
function collapseRow(li, then) {
  li.style.height = li.offsetHeight + "px";
  requestAnimationFrame(() => {
    li.style.height = "0px";
    li.style.opacity = "0";
  });
  setTimeout(then, ANIM_MS);
}

/* ---------- swipe ---------- */

function attachSwipe(li, { onRight, onLeft }) {
  const panel = li.querySelector(".row__panel");
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let tracking = false;
  let horizontal = null;
  let armed = false;

  function setArmed(value) {
    if (value === armed) return;
    armed = value;
    li.classList.toggle("row--armed", armed);
    if (armed) haptic();
  }

  function reset() {
    panel.style.transition = "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)";
    panel.style.transform = "";
    li.classList.remove("row--dir-right", "row--dir-left", "row--armed");
    armed = false;
    setTimeout(() => { panel.style.transition = ""; }, 250);
  }

  function start(x, y, target) {
    if (target.closest("button")) return;
    li.classList.remove("row--nudge");
    startX = x;
    startY = y;
    dx = 0;
    horizontal = null;
    tracking = true;
    panel.style.transition = "";
  }

  function move(x, y, e) {
    if (!tracking) return;
    const rawX = x - startX;
    const rawY = y - startY;
    if (horizontal === null) {
      if (Math.abs(rawX) < 8 && Math.abs(rawY) < 8) return;
      horizontal = Math.abs(rawX) > Math.abs(rawY);
      if (!horizontal) { tracking = false; return; }
    }
    if (e?.cancelable) e.preventDefault();
    // сопротивление после порога
    const sign = Math.sign(rawX);
    const abs = Math.abs(rawX);
    dx = sign * (abs < 140 ? abs : 140 + (abs - 140) * 0.3);
    if ((dx > 0 && !onRight) || (dx < 0 && !onLeft)) dx = dx * 0.15;
    panel.style.transform = `translateX(${dx}px)`;
    li.classList.toggle("row--dir-right", dx > 0);
    li.classList.toggle("row--dir-left", dx < 0);
    setArmed(Math.abs(dx) >= SWIPE_THRESHOLD && ((dx > 0 && !!onRight) || (dx < 0 && !!onLeft)));
  }

  function end() {
    if (!tracking) return;
    tracking = false;
    if (armed) {
      const dir = dx > 0 ? 1 : -1;
      panel.style.transition = "transform 0.22s ease-in";
      panel.style.transform = `translateX(${dir * 110}%)`;
      hideSwipeHint();
      setTimeout(() => collapseRow(li, dir > 0 ? onRight : onLeft), 180);
    } else if (dx !== 0) {
      reset();
    }
    dx = 0;
  }

  li.addEventListener("touchstart", (e) => start(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
  li.addEventListener("touchmove", (e) => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  li.addEventListener("touchend", end);
  li.addEventListener("touchcancel", end);

  li.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    start(e.clientX, e.clientY, e.target);
    const onMove = (ev) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      end();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

/* ---------- render ---------- */

function renderItem(item, mode, isNew) {
  const cat = getCategory(item.category);
  const li = document.createElement("li");
  li.className = "row" + (mode === "done" ? " row--done" : "") + (isNew ? " row--new" : "") + (openId === item.id ? " row--open" : "");
  li.style.setProperty("--c", catColor(item.category));
  li.dataset.id = item.id;

  if (mode === "buy" && editId === item.id) {
    return renderEditRow(li);
  }

  if (mode === "buy") {
    li.innerHTML = `
      <div class="row__bg row__bg--right"><span class="row__bg-icon">✓</span>Купил</div>
      <div class="row__bg row__bg--left">Удалить<span class="row__bg-icon">🗑</span></div>
      <div class="row__panel">
        <button type="button" class="check" aria-label="Купил"></button>
        <div class="row__body"><span class="row__name">${escapeHtml(item.name)}</span></div>
        ${item.qty > 1 ? `<button type="button" class="qty-pill" aria-label="Количество">×${item.qty}</button>` : ""}
        <div class="stepper">
          <button type="button" class="stepper__btn stepper__btn--edit" data-action="edit" aria-label="Изменить">✏️</button>
          <button type="button" class="stepper__btn" data-action="minus" aria-label="Меньше">−</button>
          <span class="stepper__num">${item.qty}</span>
          <button type="button" class="stepper__btn" data-action="plus" aria-label="Больше">+</button>
        </div>
      </div>`;

    const check = li.querySelector(".check");
    check.addEventListener("click", () => {
      check.classList.add("check--on");
      haptic();
      hideSwipeHint();
      setTimeout(() => collapseRow(li, () => setDone(item.id, true)), 220);
    });

    const toggleOpen = () => {
      openId = openId === item.id ? null : item.id;
      listWrap.querySelectorAll(".row--open").forEach((r) => { if (r !== li) r.classList.remove("row--open"); });
      li.classList.toggle("row--open", openId === item.id);
    };
    li.querySelector(".row__body").addEventListener("click", toggleOpen);
    li.querySelector(".qty-pill")?.addEventListener("click", toggleOpen);

    li.querySelector('[data-action="minus"]').addEventListener("click", () => {
      if (item.qty === 1) collapseRow(li, () => removeItem(item.id));
      else changeQty(item.id, -1);
    });
    li.querySelector('[data-action="plus"]').addEventListener("click", () => changeQty(item.id, 1));
    li.querySelector('[data-action="edit"]').addEventListener("click", () => startEdit(item));

    attachSwipe(li, {
      onRight: () => setDone(item.id, true),
      onLeft: () => removeItem(item.id),
    });
  } else {
    li.innerHTML = `
      <div class="row__bg row__bg--right"><span class="row__bg-icon">↩</span>Вернуть</div>
      <div class="row__bg row__bg--left">Удалить<span class="row__bg-icon">🗑</span></div>
      <div class="row__panel">
        <button type="button" class="check check--on" aria-label="Вернуть в список"></button>
        <div class="row__body">
          <span class="row__name">${escapeHtml(item.name)}</span>
          <span class="row__meta">${cat.emoji} ${cat.label}${item.qty > 1 ? ` · ×${item.qty}` : ""}</span>
        </div>
      </div>`;

    li.querySelector(".check").addEventListener("click", () => {
      haptic();
      collapseRow(li, () => setDone(item.id, false));
    });

    attachSwipe(li, {
      onRight: () => setDone(item.id, false),
      onLeft: () => removeItem(item.id),
    });
  }

  return li;
}

/* ---------- редактирование ---------- */

function startEdit(item) {
  editId = item.id;
  editDraft = { name: item.name, category: normalizeCategory(item.category) };
  haptic();
  render();
}

function stopEdit() {
  editId = null;
  editDraft = null;
  openId = null;
  pendingRender = false;
  render();
}

async function saveEdit() {
  const item = items.find((i) => i.id === editId);
  const name = (editDraft?.name || "").trim();
  if (!item || !name) {
    if (!item) showToast("Этот товар уже удалили");
    stopEdit();
    return;
  }
  const data = {};
  if (name !== item.name) data.name = name;
  if (editDraft.category !== normalizeCategory(item.category)) data.category = editDraft.category;
  const id = editId;
  stopEdit();
  if (Object.keys(data).length) {
    try {
      await patchItem(id, data);
      haptic();
      showToast("Сохранено ✓");
    } catch {
      showToast("Не получилось сохранить");
    }
  }
}

function renderEditRow(li) {
  li.className = "row row--editing";
  li.style.setProperty("--c", catColor(editDraft.category));
  li.innerHTML = `
    <form class="row__panel edit-form">
      <input class="edit-input" type="text" maxlength="120" enterkeyhint="done" autocomplete="off" />
      <button type="button" class="edit-btn edit-btn--cancel" aria-label="Отмена">✕</button>
      <button type="submit" class="edit-btn edit-btn--save" aria-label="Сохранить">✓</button>
    </form>
    <div class="edit-cats">
      ${CATEGORIES.map((c) => `
        <button type="button" class="cats__btn${c.id === editDraft.category ? " cats__btn--active" : ""}" data-cat="${c.id}" style="--c:${catColor(c.id)}">${c.emoji} ${c.label}</button>`).join("")}
    </div>`;

  const input = li.querySelector(".edit-input");
  input.value = editDraft.name;
  input.addEventListener("input", () => { editDraft.name = input.value; });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") stopEdit(); });
  li.querySelector(".edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveEdit();
  });
  li.querySelector(".edit-btn--cancel").addEventListener("click", stopEdit);
  li.querySelectorAll(".edit-cats .cats__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      editDraft.category = btn.dataset.cat;
      li.style.setProperty("--c", catColor(editDraft.category));
      li.querySelectorAll(".edit-cats .cats__btn").forEach((b) => b.classList.toggle("cats__btn--active", b === btn));
      haptic();
      input.focus();
    });
  });
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  return li;
}

function render() {
  const scrollY = window.scrollY;
  listWrap.innerHTML = "";
  const need = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const firstRender = knownIds === null;
  const isNew = (id) => !firstRender && !knownIds.has(id);
  let firstNeedRow = null;

  CATEGORIES.forEach((cat) => {
    const group = need.filter((i) => normalizeCategory(i.category) === cat.id);
    if (!group.length) return;
    const section = document.createElement("section");
    section.className = "group";
    section.style.setProperty("--c", catColor(cat.id));
    section.innerHTML = `<h2 class="group__title">${cat.emoji} ${cat.label} <span class="group__count">${group.length}</span></h2>`;
    const ul = document.createElement("ul");
    ul.className = "list";
    group.forEach((item) => {
      const li = renderItem(item, "buy", isNew(item.id));
      if (!firstNeedRow) firstNeedRow = li;
      ul.appendChild(li);
    });
    section.appendChild(ul);
    listWrap.appendChild(section);
  });

  if (done.length) {
    const section = document.createElement("section");
    section.className = "group group--done" + (hideDone ? " group--collapsed" : "");
    section.innerHTML = `<h2 class="group__title group__title--toggle">✅ Куплено · ${done.length} <span class="group__chevron">▾</span></h2>`;
    if (!hideDone) {
      const ul = document.createElement("ul");
      ul.className = "list";
      done.forEach((item) => ul.appendChild(renderItem(item, "done", isNew(item.id))));
      section.appendChild(ul);
    }
    listWrap.appendChild(section);
    section.querySelector(".group__title--toggle").addEventListener("click", () => {
      hideDone = !hideDone;
      render();
    });
  }

  const total = items.length;
  const hintDismissed = localStorage.getItem(HINT_KEY) === "1";

  // пустые состояния
  emptyEl.hidden = need.length > 0;
  if (total === 0) {
    emptyTitle.textContent = "Пока пусто";
    emptyText.textContent = "Добавь что-нибудь — второй увидит сразу.";
  } else {
    emptyTitle.textContent = "Всё куплено!";
    emptyText.textContent = "Коты довольны 😺";
  }

  footerEl.hidden = total === 0;
  progressEl.hidden = total === 0;
  statNeed.textContent = need.length ? `${need.length} нужно` : "Всё куплено";
  statDone.textContent = `${done.length} из ${total} куплено`;
  progressBar.style.width = total ? `${Math.round((done.length / total) * 100)}%` : "0";

  if (swipeHint) swipeHint.hidden = need.length === 0 || hintDismissed;

  // подсказка: первая строка один раз «отъезжает»
  if (firstNeedRow && !hintDismissed && !nudgeShown) {
    nudgeShown = true;
    firstNeedRow.classList.add("row--nudge");
  }

  knownIds = new Set(items.map((i) => i.id));
  window.scrollTo(0, scrollY);
}

/* ---------- уведомления ---------- */

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function notifyOn() {
  return localStorage.getItem(NOTIFY_KEY) === "1" && "Notification" in window && Notification.permission === "granted";
}

function updateNotifyBtn() {
  if (!notifyBtn) return;
  const on = notifyOn();
  notifyBtn.textContent = on ? "🔔" : "🔕";
  notifyBtn.classList.toggle("icon-btn--on", on);
  notifyBtn.setAttribute("aria-label", on ? "Уведомления включены" : "Включить уведомления");
}

function devicesDoc() {
  return doc(collection(db, "lists", listCode, "devices"), deviceId);
}

async function registerPushToken() {
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("no token");
  await setDoc(devicesDoc(), {
    token,
    name: myName(),
    ios: isIos(),
    updatedAt: Date.now(),
  });
}

async function enableNotifications() {
  if (!pushSupported) {
    if (isIos() && !isStandalone()) {
      showToast("На iPhone: «Поделиться» → «На экран Домой», и включи там");
    } else {
      showToast("Этот браузер не умеет уведомления");
    }
    return;
  }
  // разрешение спрашиваем сразу по тапу — иначе iPhone не покажет окно
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    showToast("Уведомления запрещены — включи в настройках телефона");
    updateNotifyBtn();
    return;
  }
  if (!myName()) {
    const name = (prompt("Как тебя подписывать в уведомлениях?\nНапример: Влад") || "").trim().slice(0, 20);
    if (name) localStorage.setItem(NAME_KEY, name);
  }
  try {
    await registerPushToken();
    localStorage.setItem(NOTIFY_KEY, "1");
    haptic();
    showToast("Уведомления включены 🔔");
  } catch (err) {
    console.error(err);
    showToast("Не получилось включить уведомления");
  }
  updateNotifyBtn();
}

async function disableNotifications() {
  localStorage.setItem(NOTIFY_KEY, "0");
  updateNotifyBtn();
  try { await deleteDoc(devicesDoc()); } catch { /* ignore */ }
  try { await deleteToken(messaging); } catch { /* ignore */ }
  showToast("Уведомления выключены 🔕");
}

async function initNotifications() {
  try {
    pushSupported = "serviceWorker" in navigator && "Notification" in window && (await messagingSupported());
    if (pushSupported) messaging = getMessaging(firebaseApp);
  } catch {
    pushSupported = false;
  }
  updateNotifyBtn();
  // токен может смениться — тихо обновляем при каждом запуске
  if (pushSupported && notifyOn() && listCode) {
    registerPushToken().catch((e) => console.warn("push refresh", e));
  }
}

const notifySheet = $("notifySheet");
const nameInput = $("nameInput");

function openNotifySheet() {
  nameInput.value = myName();
  notifySheet.hidden = false;
}

function closeNotifySheet() {
  notifySheet.hidden = true;
}

async function saveName() {
  const name = nameInput.value.trim().slice(0, 20);
  localStorage.setItem(NAME_KEY, name);
  closeNotifySheet();
  try {
    await updateDoc(devicesDoc(), { name, updatedAt: Date.now() });
  } catch {
    registerPushToken().catch(() => {});
  }
  haptic();
  showToast(name ? `Теперь ты «${name}» ✓` : "Имя убрано");
}

$("saveNameBtn").addEventListener("click", saveName);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveName(); });
$("notifyOffBtn").addEventListener("click", () => { closeNotifySheet(); disableNotifications(); });
$("sheetCloseBtn").addEventListener("click", closeNotifySheet);
notifySheet.addEventListener("click", (e) => { if (e.target === notifySheet) closeNotifySheet(); });

notifyBtn?.addEventListener("click", () => {
  if (notifyOn()) openNotifySheet();
  else enableNotifications();
});

function showApp() {
  joinOverlay.hidden = true;
  appEl.hidden = false;
  listCodeLabel.textContent = listCode;
  history.replaceState(null, "", getShareUrl(listCode));
  renderCategoryBar();
  render();
  syncBottomPadding();
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
      if (editId && items.some((i) => i.id === editId && !i.done)) pendingRender = true;
      else {
        if (editId) { editId = null; editDraft = null; }
        render();
      }
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
  firebaseApp = app;
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
  initNotifications();
}

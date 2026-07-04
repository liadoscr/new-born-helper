const FEEDING_INTERVAL_MS = 3 * 60 * 60 * 1000;
const SLEEPY_REMINDER_MS = 5 * 60 * 1000;
const PEE_GOAL = 5;
const POOP_GOAL = 3;
const LEGACY_STORAGE_KEY = "night-feeding-state-v1";
const AUTH_STORAGE_KEY = "lullaby-log-auth-user-v1";
const NOTIFICATION_STORAGE_PREFIX = "newborn-helper-notifications-v1";
const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";

const GUEST_USER = {
  id: "guest",
  name: "מצב אורח",
  email: "הנתונים נשמרים במכשיר הזה",
  picture: "",
  provider: "guest",
};

const defaultState = {
  feedings: [],
  diapers: [],
  settings: {
    feedingIntervalHours: 3,
    sleepyReminderMinutes: 5,
    dailyPeeGoal: PEE_GOAL,
    dailyPoopGoal: POOP_GOAL,
  },
};

let currentUser = loadAuthUser();
let state = loadState(currentUser);
let undo = null;
let undoTimer = null;
let deferredInstallPrompt = null;
let googleReady = false;
let nextFeedingNotificationTimer = null;
let scheduledNotificationAt = "";

const els = {
  activeControls: document.querySelector("#activeControls"),
  activeTimer: document.querySelector("#activeTimer"),
  closeMenuButton: document.querySelector("#closeMenuButton"),
  configHint: document.querySelector("#googleConfigHint"),
  diaperButtons: document.querySelectorAll("[data-diaper]"),
  exportButton: document.querySelector("#exportButton"),
  googleSignInButton: document.querySelector("#googleSignInButton"),
  historyList: document.querySelector("#historyList"),
  installButton: document.querySelector("#installButton"),
  lastDiaperText: document.querySelector("#lastDiaperText"),
  lastFeedText: document.querySelector("#lastFeedText"),
  leftSideStat: document.querySelector("#leftSideStat"),
  menu: document.querySelector("#appMenu"),
  menuBackdrop: document.querySelector("#menuBackdrop"),
  menuButton: document.querySelector("#menuButton"),
  menuUserEmail: document.querySelector("#menuUserEmail"),
  menuUserName: document.querySelector("#menuUserName"),
  navButtons: document.querySelectorAll("[data-view-target]"),
  notificationButton: document.querySelector("#enableNotificationsButton"),
  notificationStatus: document.querySelector("#notificationStatus"),
  nextFeedRelative: document.querySelector("#nextFeedRelative"),
  nextFeedText: document.querySelector("#nextFeedText"),
  nextSideText: document.querySelector("#nextSideText"),
  partnerActionText: document.querySelector("#partnerActionText"),
  partnerActionTitle: document.querySelector("#partnerActionTitle"),
  partnerElapsed: document.querySelector("#partnerElapsed"),
  partnerStatus: document.querySelector("#partnerStatus"),
  pauseButton: document.querySelector("#pauseButton"),
  peeBar: document.querySelector("#peeBar"),
  peeGoal: document.querySelector("#peeGoal"),
  poopBar: document.querySelector("#poopBar"),
  poopGoal: document.querySelector("#poopGoal"),
  rightSideStat: document.querySelector("#rightSideStat"),
  resetDataButton: document.querySelector("#resetDataButton"),
  resetDialog: document.querySelector("#resetDialog"),
  sideButtons: document.querySelectorAll("[data-side]"),
  signOutButton: document.querySelector("#signOutButton"),
  sleepyDialog: document.querySelector("#sleepyDialog"),
  statusDot: document.querySelector("#statusDot"),
  stopButton: document.querySelector("#stopButton"),
  syncStatus: document.querySelector("#syncStatus"),
  timerHint: document.querySelector("#timerHint"),
  undoButton: document.querySelector("#undoButton"),
  undoText: document.querySelector("#undoText"),
  undoToast: document.querySelector("#undoToast"),
  userStatus: document.querySelector("#authStatus"),
  views: document.querySelectorAll("[data-view]"),
};

init();

function init() {
  els.sideButtons.forEach((button) => {
    button.addEventListener("click", () => handleSideTap(button.dataset.side));
  });
  els.diaperButtons.forEach((button) => {
    button.addEventListener("click", () => addDiaper(button.dataset.diaper));
  });
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.viewTarget);
      closeMenu();
    });
  });

  els.menuButton.addEventListener("click", toggleMenu);
  els.closeMenuButton.addEventListener("click", closeMenu);
  els.menuBackdrop.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  els.pauseButton.addEventListener("click", togglePause);
  els.stopButton.addEventListener("click", stopFeeding);
  els.undoButton.addEventListener("click", runUndo);
  els.exportButton.addEventListener("click", exportData);
  els.installButton.addEventListener("click", installApp);
  els.googleSignInButton.addEventListener("click", signInWithGoogle);
  els.signOutButton.addEventListener("click", signOut);
  els.resetDataButton.addEventListener("click", openResetDialog);
  els.notificationButton.addEventListener("click", toggleNotifications);
  els.resetDialog.addEventListener("close", () => {
    if (els.resetDialog.returnValue === "confirm") resetCurrentUserData();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      els.syncStatus.textContent = "נשמר מקומית";
    });
  }

  renderAuth();
  renderNotificationState();
  initGoogleAuth();
  render();
  setInterval(render, 1000);
}

function storageKeyFor(user) {
  return `${LEGACY_STORAGE_KEY}:user:${user.id}`;
}

function notificationKeyFor(user) {
  return `${NOTIFICATION_STORAGE_PREFIX}:user:${user.id}`;
}

function loadAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? { ...GUEST_USER, ...JSON.parse(raw) } : GUEST_USER;
  } catch {
    return GUEST_USER;
  }
}

function saveAuthUser(user) {
  if (user.provider === "guest") {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } else {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  }
}

function loadState(user) {
  try {
    const scoped = localStorage.getItem(storageKeyFor(user));
    if (scoped) return { ...clone(defaultState), ...JSON.parse(scoped) };

    if (user.provider === "guest") {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) return { ...clone(defaultState), ...JSON.parse(legacy) };
    }

    return clone(defaultState);
  } catch {
    return clone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKeyFor(currentUser), JSON.stringify(state));
}

function switchUser(user) {
  saveState();
  currentUser = user;
  saveAuthUser(user);
  state = loadState(user);
  clearUndo();
  clearNextFeedingNotification();
  renderAuth();
  renderNotificationState();
  render();
}

function initGoogleAuth() {
  const clientId = getGoogleClientId();

  if (!clientId) {
    els.configHint.hidden = false;
    els.googleSignInButton.disabled = true;
    return;
  }

  els.configHint.hidden = true;
  loadGoogleScript()
    .then(() => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleReady = true;
      els.googleSignInButton.disabled = false;
    })
    .catch(() => {
      els.configHint.hidden = false;
      els.configHint.textContent = "לא הצלחתי לטעון את Google Sign-In. בדוק חיבור אינטרנט ו-Client ID.";
      els.googleSignInButton.disabled = true;
    });
}

function getGoogleClientId() {
  return window.LULLABY_LOG_CONFIG?.googleClientId?.trim() || "";
}

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

function signInWithGoogle() {
  if (!googleReady || !window.google?.accounts?.id) {
    showToast("Google Login עדיין לא מוגדר");
    return;
  }

  window.google.accounts.id.prompt((notification) => {
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      els.configHint.hidden = false;
      els.configHint.textContent = "Google לא הציג חלון התחברות. ודא שה-Origin מוגדר ב-Google Cloud.";
    }
  });
}

function handleGoogleCredential(response) {
  const profile = parseJwt(response.credential);
  const user = {
    id: `google:${profile.sub}`,
    name: profile.name || profile.email || "משתמש Google",
    email: profile.email || "",
    picture: profile.picture || "",
    provider: "google",
  };
  switchUser(user);
  closeMenu();
  showToast(`מחובר כ-${user.name}`);
}

function parseJwt(token) {
  const payload = token.split(".")[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(base64)
      .split("")
      .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join(""),
  );
  return JSON.parse(json);
}

function signOut() {
  if (window.google?.accounts?.id) {
    window.google.accounts.id.disableAutoSelect();
  }
  switchUser(GUEST_USER);
  showToast("התנתקת. עברת למצב אורח");
}

function openResetDialog() {
  closeMenu();
  if (typeof els.resetDialog.showModal === "function") {
    els.resetDialog.showModal();
    return;
  }

  if (confirm("לאפס את כל הנתונים של המשתמש הנוכחי?")) {
    resetCurrentUserData();
  }
}

function resetCurrentUserData() {
  localStorage.removeItem(storageKeyFor(currentUser));
  if (currentUser.provider === "guest") {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  state = clone(defaultState);
  clearNextFeedingNotification();
  clearUndo();
  render();
  showToast("הנתונים אופסו");
}

function renderAuth() {
  const isGuest = currentUser.provider === "guest";
  els.menuUserName.textContent = currentUser.name;
  els.menuUserEmail.textContent = currentUser.email || "מחובר";
  els.userStatus.textContent = isGuest ? "לא מחובר לגוגל" : `מחובר כ-${currentUser.email || currentUser.name}`;
  els.googleSignInButton.hidden = !isGuest;
  els.signOutButton.hidden = isGuest;
  els.syncStatus.textContent = isGuest ? "נשמר במכשיר" : `נשמר עבור ${currentUser.name}`;
}

function notificationsEnabled() {
  return localStorage.getItem(notificationKeyFor(currentUser)) === "enabled";
}

function setNotificationsEnabled(enabled) {
  if (enabled) {
    localStorage.setItem(notificationKeyFor(currentUser), "enabled");
  } else {
    localStorage.removeItem(notificationKeyFor(currentUser));
  }
}

function renderNotificationState() {
  if (!("Notification" in window)) {
    els.notificationStatus.textContent = "הדפדפן הזה לא תומך בהתראות";
    els.notificationButton.textContent = "לא נתמך";
    els.notificationButton.disabled = true;
    return;
  }

  els.notificationButton.disabled = false;

  if (Notification.permission === "denied") {
    els.notificationStatus.textContent = "ההתראות חסומות בהגדרות המכשיר";
    els.notificationButton.textContent = "התראות חסומות";
    els.notificationButton.disabled = true;
    return;
  }

  if (notificationsEnabled() && Notification.permission === "granted") {
    els.notificationStatus.textContent = "התראות פעילות להאכלה הבאה";
    els.notificationButton.textContent = "כבה התראות";
    return;
  }

  els.notificationStatus.textContent = "התראות לא הופעלו";
  els.notificationButton.textContent = "אפשר התראות";
}

async function toggleNotifications() {
  if (notificationsEnabled()) {
    setNotificationsEnabled(false);
    clearNextFeedingNotification();
    renderNotificationState();
    showToast("התראות כובו");
    return;
  }

  const allowed = await requestNotificationPermission();
  if (!allowed) {
    renderNotificationState();
    showToast("לא ניתן להפעיל התראות כרגע");
    return;
  }

  setNotificationsEnabled(true);
  renderNotificationState();
  scheduleNextFeedingNotification();
  showToast("התראות הופעלו");
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

function toggleMenu() {
  if (els.menu.classList.contains("is-open")) closeMenu();
  else openMenu();
}

function openMenu() {
  els.menu.classList.add("is-open");
  els.menu.setAttribute("aria-hidden", "false");
  els.menuButton.setAttribute("aria-expanded", "true");
  els.menuBackdrop.hidden = false;
  document.body.classList.add("menu-open");
}

function closeMenu() {
  els.menu.classList.remove("is-open");
  els.menu.setAttribute("aria-hidden", "true");
  els.menuButton.setAttribute("aria-expanded", "false");
  els.menuBackdrop.hidden = true;
  document.body.classList.remove("menu-open");
}

function handleSideTap(side) {
  const active = getActiveFeeding();
  if (!active) {
    startFeeding(side);
    return;
  }

  if (active.side === side) {
    stopFeeding();
  }
}

function startFeeding(side) {
  const feeding = {
    id: crypto.randomUUID(),
    side,
    startedAt: new Date().toISOString(),
    pauses: [],
    createdBy: currentUser.id,
  };

  state.feedings.unshift(feeding);
  saveState();
  showUndo(`התחילה הנקה מצד ${sideLabel(side)}`, () => {
    state.feedings = state.feedings.filter((item) => item.id !== feeding.id);
    saveState();
    render();
  });
  vibrate(20);
  render();
}

function stopFeeding() {
  const active = getActiveFeeding();
  if (!active) return;

  const previous = clone(active);
  closeOpenPause(active);
  active.endedAt = new Date().toISOString();
  saveState();
  showUndo("ההנקה הסתיימה", () => {
    state.feedings = state.feedings.map((item) => (item.id === previous.id ? previous : item));
    saveState();
    render();
  });
  vibrate(35);
  render();
}

function togglePause() {
  const active = getActiveFeeding();
  if (!active) return;

  const openPause = active.pauses.find((pause) => !pause.endedAt);
  if (openPause) {
    openPause.endedAt = new Date().toISOString();
    showUndo("העצירה הסתיימה", () => {
      openPause.endedAt = undefined;
      saveState();
      render();
    });
  } else {
    const pause = {
      startedAt: new Date().toISOString(),
      reason: "burp",
    };
    active.pauses.push(pause);
    showUndo("נרשמה עצירת גרעפס", () => {
      active.pauses = active.pauses.filter((item) => item !== pause);
      saveState();
      render();
    });
  }

  saveState();
  vibrate(20);
  render();
}

function closeOpenPause(feeding) {
  const openPause = feeding.pauses.find((pause) => !pause.endedAt);
  if (openPause) openPause.endedAt = new Date().toISOString();
}

function addDiaper(type) {
  const diaper = {
    id: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    createdBy: currentUser.id,
  };

  state.diapers.unshift(diaper);
  saveState();
  showUndo(`נרשם ${diaperLabel(type)}`, () => {
    state.diapers = state.diapers.filter((item) => item.id !== diaper.id);
    saveState();
    render();
  });
  vibrate(18);
  render();
}

function render() {
  const active = getActiveFeeding();
  const latest = state.feedings[0];
  const latestStarted = latest ? new Date(latest.startedAt) : null;

  renderFeeding(active, latest, latestStarted);
  renderDiapers();
  renderHistory();
  maybeShowSleepyReminder(active);
}

function renderFeeding(active, latest, latestStarted) {
  els.activeControls.hidden = !active;
  els.activeTimer.classList.toggle("is-active", Boolean(active));

  if (active) {
    const elapsed = Date.now() - new Date(active.startedAt).getTime();
    els.activeTimer.textContent = formatDuration(elapsed);
    els.partnerElapsed.textContent = formatDuration(elapsed);
    els.timerHint.textContent = `התחילה ב-${formatTime(active.startedAt)} מצד ${sideLabel(active.side)}`;
    els.pauseButton.textContent = active.pauses.some((pause) => !pause.endedAt) ? "חזרה להנקה" : "גרעפס / עצירה";
  } else {
    els.activeTimer.textContent = latestStarted ? timeSince(latestStarted) : "00:00";
    els.partnerElapsed.textContent = latestStarted ? timeSince(latestStarted) : "--";
    els.timerHint.textContent = latestStarted ? `עברו ${timeSince(latestStarted)} מתחילת ההנקה האחרונה` : "מוכנה להתחיל";
    els.pauseButton.textContent = "גרעפס / עצירה";
  }

  renderSideButtons(active, latest);

  if (latest) {
    const nextSide = latest.side === "right" ? "left" : "right";
    const nextFeed = new Date(new Date(latest.startedAt).getTime() + FEEDING_INTERVAL_MS);
    els.nextSideText.textContent = sideLabel(nextSide);
    els.lastFeedText.textContent = `הנקה אחרונה: ${sideLabel(latest.side)} · ${formatTime(latest.startedAt)}`;
    els.nextFeedText.textContent = formatTime(nextFeed);
    els.nextFeedRelative.textContent = relativeDueText(nextFeed);
    renderPartnerStatus(nextFeed);
    scheduleNextFeedingNotification(nextFeed);
  } else {
    els.nextSideText.textContent = "אין נתונים";
    els.lastFeedText.textContent = "אין עדיין הנקה אחרונה";
    els.nextFeedText.textContent = "--:--";
    els.nextFeedRelative.textContent = "בחרי צד כדי להתחיל";
    els.partnerStatus.textContent = "מוכן להתחלה";
    els.partnerActionTitle.textContent = "אין פעולה דחופה";
    els.partnerActionText.textContent = "כשההאכלה תתקרב, כאן תופיע הצעה פרואקטיבית.";
    els.statusDot.className = "live-dot";
    clearNextFeedingNotification();
  }

  renderAuth();
  renderNotificationState();
}

function scheduleNextFeedingNotification(nextFeed) {
  if (!nextFeed) {
    const latest = state.feedings[0];
    if (!latest) return;
    nextFeed = new Date(new Date(latest.startedAt).getTime() + FEEDING_INTERVAL_MS);
  }

  if (!notificationsEnabled() || Notification.permission !== "granted") return;

  const msUntil = nextFeed.getTime() - Date.now();
  const nextFeedIso = nextFeed.toISOString();

  if (msUntil <= 0) {
    clearNextFeedingNotification();
    return;
  }

  if (scheduledNotificationAt === nextFeedIso && nextFeedingNotificationTimer) return;

  clearNextFeedingNotification();
  scheduledNotificationAt = nextFeedIso;
  nextFeedingNotificationTimer = setTimeout(() => {
    sendNextFeedingNotification();
    clearNextFeedingNotification();
  }, Math.min(msUntil, 2147483647));
}

function clearNextFeedingNotification() {
  clearTimeout(nextFeedingNotificationTimer);
  nextFeedingNotificationTimer = null;
  scheduledNotificationAt = "";
}

function sendNextFeedingNotification() {
  if (!notificationsEnabled() || Notification.permission !== "granted") return;

  const latest = state.feedings[0];
  const nextSide = latest ? sideLabel(latest.side === "right" ? "left" : "right") : "";
  const body = nextSide ? `הגיע זמן ההאכלה. כדאי להתחיל מצד ${nextSide}.` : "הגיע זמן ההאכלה.";

  new Notification("NewBorn Helper", {
    body,
    icon: "assets/icon.svg",
    badge: "assets/icon.svg",
    tag: "next-feeding",
  });
}

function renderSideButtons(active, latest) {
  els.sideButtons.forEach((button) => {
    const side = button.dataset.side;
    button.classList.remove("is-active", "is-dimmed", "is-recent");

    if (active) {
      button.classList.toggle("is-active", active.side === side);
      button.classList.toggle("is-dimmed", active.side !== side);
      return;
    }

    if (latest?.side === side) button.classList.add("is-recent");
  });

  els.rightSideStat.textContent = sideStatusText("right", active, latest);
  els.leftSideStat.textContent = sideStatusText("left", active, latest);
}

function sideStatusText(side, active, latest) {
  if (active?.side === side) return "פעיל";
  if (active) return "ממתין";
  if (latest?.side === side) return "אחרון";
  return "התחלה";
}

function renderPartnerStatus(nextFeed) {
  const msUntil = nextFeed.getTime() - Date.now();
  els.statusDot.className = "live-dot";

  if (msUntil <= 0) {
    els.partnerStatus.textContent = "עברו 3 שעות";
    els.partnerActionTitle.textContent = "הגיע זמן האכלה";
    els.partnerActionText.textContent = "אפשר להכין מים לאמא ולהחליף חיתול כדי לעזור לה להתעורר בעדינות.";
    els.statusDot.classList.add("late");
  } else if (msUntil <= 20 * 60 * 1000) {
    els.partnerStatus.textContent = "מתקרבים להאכלה";
    els.partnerActionTitle.textContent = "כדאי להתכונן";
    els.partnerActionText.textContent = "עוד מעט מגיע חלון ההאכלה. זה זמן טוב להכין מים ולבדוק חיתול.";
    els.statusDot.classList.add("warning");
  } else {
    els.partnerStatus.textContent = "רגוע";
    els.partnerActionTitle.textContent = "אין פעולה דחופה";
    els.partnerActionText.textContent = "ההאכלה הבאה עדיין לא קרובה. אפשר לתת לאמא ולתינוקת שקט.";
  }
}

function renderDiapers() {
  const today = getTodayKey();
  const todaysDiapers = state.diapers.filter((item) => getDateKey(item.createdAt) === today);
  const peeCount = todaysDiapers.filter((item) => item.type === "pee" || item.type === "both").length;
  const poopCount = todaysDiapers.filter((item) => item.type === "poop" || item.type === "both").length;
  const latestDiaper = state.diapers[0];

  els.peeGoal.textContent = `${peeCount}/${PEE_GOAL}`;
  els.poopGoal.textContent = `${poopCount}/${POOP_GOAL}`;
  els.peeBar.style.width = `${Math.min(100, (peeCount / PEE_GOAL) * 100)}%`;
  els.poopBar.style.width = `${Math.min(100, (poopCount / POOP_GOAL) * 100)}%`;
  els.peeGoal.closest(".goal").classList.toggle("complete", peeCount >= PEE_GOAL);
  els.poopGoal.closest(".goal").classList.toggle("complete", poopCount >= POOP_GOAL);
  els.lastDiaperText.textContent = latestDiaper ? `אחרון: ${timeAgo(new Date(latestDiaper.createdAt))}` : "עוד אין חיתולים";
}

function renderHistory() {
  const feedingEvents = state.feedings.slice(0, 8).map((feeding) => ({
    type: "feeding",
    at: feeding.startedAt,
    title: `הנקה מצד ${sideLabel(feeding.side)}`,
    icon: feeding.side === "right" ? "🤱" : "🍼",
    duration: feeding.endedAt ? formatHumanDuration(new Date(feeding.endedAt) - new Date(feeding.startedAt)) : "פעילה עכשיו",
  }));
  const diaperEvents = state.diapers.slice(0, 8).map((diaper) => ({
    type: "diaper",
    at: diaper.createdAt,
    title: diaperLabel(diaper.type),
    icon: diaperIcon(diaper.type),
    duration: "",
  }));
  const events = [...feedingEvents, ...diaperEvents]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);

  els.historyList.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <li>
              <div class="history-leading">
                <span class="history-icon" aria-hidden="true">${event.icon}</span>
                <div class="history-main">
                  <strong>${event.title}</strong>
                  <span>${formatFullDate(event.at)}</span>
                </div>
              </div>
              <div class="history-meta">
                <span>שעה ${formatTime(event.at)}</span>
                ${event.type === "feeding" ? `<span>משך ${event.duration}</span>` : ""}
              </div>
            </li>
          `,
        )
        .join("")
    : `<li><strong>עוד אין אירועים</strong><span>הלילה מתחיל נקי</span></li>`;
}

function maybeShowSleepyReminder(active) {
  if (!active || active.sleepyReminderShownAt) return;
  const elapsed = Date.now() - new Date(active.startedAt).getTime();
  const hasPause = active.pauses.length > 0;

  if (elapsed >= SLEEPY_REMINDER_MS && !hasPause) {
    active.sleepyReminderShownAt = new Date().toISOString();
    saveState();
    vibrate([80, 80, 80]);
    if (typeof els.sleepyDialog.showModal === "function") {
      els.sleepyDialog.showModal();
    }
  }
}

function showView(viewName) {
  els.views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === viewName));
  els.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === viewName));
}

function getActiveFeeding() {
  return state.feedings.find((feeding) => !feeding.endedAt);
}

function showUndo(message, action) {
  undo = action;
  els.undoText.textContent = message;
  els.undoButton.hidden = !action;
  els.undoToast.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(clearUndo, 7000);
}

function showToast(message) {
  showUndo(message, null);
}

function runUndo() {
  if (undo) undo();
  clearUndo();
}

function clearUndo() {
  undo = null;
  els.undoToast.hidden = true;
  clearTimeout(undoTimer);
}

function exportData() {
  const rows = buildExportRows();
  const csv = toCsv(rows);
  const data = encodeURIComponent(`\uFEFF${csv}`);
  const link = document.createElement("a");
  link.href = `data:text/csv;charset=utf-8,${data}`;
  link.download = `newborn-helper-${currentUser.id.replace(/[^a-z0-9_-]/gi, "-")}-${getTodayKey()}.csv`;
  link.click();
}

function buildExportRows() {
  const feedingRows = state.feedings.map((feeding) => ({
    _sortAt: feeding.startedAt,
    "סוג פעולה": "הנקה",
    "פירוט": `צד ${sideLabel(feeding.side)}`,
    "תאריך": formatDateOnly(feeding.startedAt),
    "שעת התחלה": formatTime(feeding.startedAt),
    "שעת סיום": feeding.endedAt ? formatTime(feeding.endedAt) : "",
    "משך": feeding.endedAt ? formatHumanDuration(new Date(feeding.endedAt) - new Date(feeding.startedAt)) : "פעילה עכשיו",
    "נוצר על ידי": feeding.createdBy || "",
  }));
  const diaperRows = state.diapers.map((diaper) => ({
    _sortAt: diaper.createdAt,
    "סוג פעולה": "חיתול",
    "פירוט": diaperLabel(diaper.type),
    "תאריך": formatDateOnly(diaper.createdAt),
    "שעת התחלה": formatTime(diaper.createdAt),
    "שעת סיום": "",
    "משך": "",
    "נוצר על ידי": diaper.createdBy || "",
  }));

  return [...feedingRows, ...diaperRows].sort((a, b) => new Date(b._sortAt) - new Date(a._sortAt));
}

function toCsv(rows) {
  const headers = ["סוג פעולה", "פירוט", "תאריך", "שעת התחלה", "שעת סיום", "משך", "נוצר על ידי"];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });
  return lines.join("\r\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
}

function sideLabel(side) {
  return side === "right" ? "ימין" : "שמאל";
}

function diaperLabel(type) {
  if (type === "pee") return "פיפי";
  if (type === "poop") return "קקי";
  return "גם וגם";
}

function diaperIcon(type) {
  if (type === "pee") return "💧";
  if (type === "poop") return "💩";
  return "🚼";
}

function relativeDueText(date) {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "הגיע הזמן";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `בעוד ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `בעוד ${hours}ש׳ ${rest}דק׳` : `בעוד ${hours} שעות`;
}

function timeAgo(date) {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `לפני ${hours}ש׳ ${rest}דק׳` : `לפני ${hours} שעות`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

function formatHumanDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 1) return "פחות מדקה";
  if (totalMinutes < 60) return `${totalMinutes} דק׳`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} שעות ו-${minutes} דק׳` : `${hours} שעות`;
}

function timeSince(date) {
  return formatDuration(Date.now() - date.getTime());
}

function formatTime(value) {
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFullDate(value) {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateOnly(value) {
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function getTodayKey() {
  return getDateKey(new Date());
}

function getDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function vibrate(pattern) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

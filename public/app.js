const FEEDING_INTERVAL_MS = 3 * 60 * 60 * 1000;
const SLEEPY_REMINDER_MS = 5 * 60 * 1000;
const AUTO_CLOSE_FEEDING_MS = 20 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PEE_GOAL = 5;
const POOP_GOAL = 3;
const LEGACY_STORAGE_KEY = "night-feeding-state-v1";
const AUTH_STORAGE_KEY = "lullaby-log-auth-user-v1";
const NOTIFICATION_STORAGE_PREFIX = "newborn-helper-notifications-v1";
const CLOUD_DIRTY_STORAGE_PREFIX = "newborn-helper-cloud-dirty-v1";
const FAST_SYNC_OUTBOX_PREFIX = "newborn-helper-fast-sync-outbox-v1";
const FIREBASE_SDK_VERSION = "12.15.0";
const FIREBASE_FAMILY_COLLECTION = "families";
const CLOUD_WRITE_DEBOUNCE_MS = 900;
const CLOUD_REFRESH_THROTTLE_MS = 10 * 1000;
const CLOUD_VISIBLE_REFRESH_MS = 30 * 1000;
const FAST_SYNC_MAX_BATCH_BYTES = 48 * 1024;
const FAST_SYNC_MAX_BATCH_ITEMS = 20;

const MILK_STORAGE_RULES = {
  room: {
    label: "טמפרטורת חדר",
    recommendedMs: 4 * HOUR_MS,
    maxMs: 6 * HOUR_MS,
    recommendedLabel: "3-4 שעות",
    maxLabel: "עד 6 שעות",
    note: "בטמפרטורת חדר 16-29 מעלות.",
  },
  cooler: {
    label: "צידנית אטומה עם קרחון",
    recommendedMs: 24 * HOUR_MS,
    maxMs: 24 * HOUR_MS,
    recommendedLabel: "עד 24 שעות",
    maxLabel: "עד 24 שעות",
    note: "צריך לשמור על מגע רציף בין הקרחון לכלי החלב ולהעביר למקרר בהקדם.",
  },
  fridge: {
    label: "חלב טרי במקרר",
    recommendedMs: 4 * DAY_MS,
    maxMs: 8 * DAY_MS,
    recommendedLabel: "4 ימים",
    maxLabel: "5-8 ימים",
    note: "לאחסן בחלק האחורי של המקרר.",
  },
  thawed_fridge: {
    label: "חלב שהוקפא ומופשר במקרר",
    recommendedMs: 24 * HOUR_MS,
    maxMs: 24 * HOUR_MS,
    recommendedLabel: "24 שעות מרגע ההפשרה",
    maxLabel: "24 שעות מרגע ההפשרה",
    note: "אין להפשיר או לחמם במיקרוגל. ניתן להפשיר במקרר או בטמפרטורת חדר.",
  },
  freezer: {
    label: "מקפיא ביתי",
    recommendedMonths: 6,
    maxMonths: 12,
    recommendedLabel: "6 חודשים",
    maxLabel: "עד 12 חודשים",
    note: "לאחסן בחלק האחורי של המקפיא.",
  },
  deep_freezer: {
    label: "הקפאה עמוקה",
    recommendedMonths: 6,
    maxMonths: 12,
    recommendedLabel: "6 חודשים",
    maxLabel: "עד 12 חודשים",
    note: "במקפיא בעל דלת נפרדת או מקפיא נפרד, מינוס 18 מעלות.",
  },
};

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
  bottles: [],
  pumps: [],
  deletedEvents: [],
  sync: {
    partnerEmails: [],
    declinedFamilyIds: [],
  },
  settings: {
    feedingIntervalHours: 3,
    sleepyReminderMinutes: 5,
    dailyPeeGoal: PEE_GOAL,
    dailyPoopGoal: POOP_GOAL,
  },
};

const SYNC_COLLECTIONS = [
  { stateKey: "feedings", type: "feeding" },
  { stateKey: "diapers", type: "diaper" },
  { stateKey: "bottles", type: "bottle" },
  { stateKey: "pumps", type: "pump" },
];

let currentUser = loadAuthUser();
let state = loadState(currentUser);
let fastSyncBaselineState = clone(state);
let undo = null;
let undoTimer = null;
let nextFeedingNotificationTimer = null;
let scheduledNotificationAt = "";
let pendingBottlePumpId = "";
let firebaseServices = null;
let firebaseInitPromise = null;
let firebaseAuthUnsubscribe = null;
let cloudUnsubscribe = null;
let cloudDocRef = null;
let cloudMemberEmails = [];
let cloudWriteTimer = null;
let cloudWritePromise = null;
let cloudWriteQueued = false;
let cloudLocalDirty = loadCloudDirty(currentUser);
let cloudApplyingRemote = false;
let cloudStatusText = "";
let pendingFamilyInvitation = null;
let cloudLastRefreshAt = 0;
let cloudRefreshPromise = null;
let cloudConnectPromise = null;
let manualSyncInProgress = false;
let fastSyncFlushPromise = null;
let cachedFirebaseIdToken = "";
let cachedFirebaseUid = "";
let firebaseTokenRefreshTimer = null;

const els = {
  activeControls: document.querySelector("#activeControls"),
  activeStartDateInput: document.querySelector("#activeStartDateInput"),
  activeStartDialog: document.querySelector("#activeStartDialog"),
  activeStartDialogText: document.querySelector("#activeStartDialogText"),
  activeStartTimeInput: document.querySelector("#activeStartTimeInput"),
  activeTimer: document.querySelector("#activeTimer"),
  acceptFamilyInviteButton: document.querySelector("#acceptFamilyInviteButton"),
  addManualButton: document.querySelector("#addManualButton"),
  bottleButton: document.querySelector("#bottleButton"),
  bottleSideStat: document.querySelector("#bottleSideStat"),
  closeMenuButton: document.querySelector("#closeMenuButton"),
  configHint: document.querySelector("#googleConfigHint"),
  entryAmountUnitInput: document.querySelector("#entryAmountUnitInput"),
  dessertButton: document.querySelector("#dessertButton"),
  diaperButtons: document.querySelectorAll("[data-diaper]"),
  editActiveStartButton: document.querySelector("#editActiveStartButton"),
  entryAmountInput: document.querySelector("#entryAmountInput"),
  entryDateInput: document.querySelector("#entryDateInput"),
  entryDessertInput: document.querySelector("#entryDessertInput"),
  entryDessertEndInput: document.querySelector("#entryDessertEndInput"),
  entryDessertEndRow: document.querySelector("#entryDessertEndRow"),
  entryDiaperInput: document.querySelector("#entryDiaperInput"),
  entryDialog: document.querySelector("#entryDialog"),
  entryDialogTitle: document.querySelector("#entryDialogTitle"),
  entryEndTimeInput: document.querySelector("#entryEndTimeInput"),
  entryDessertLabel: document.querySelector("#entryDessertLabel"),
  entryDessertStartInput: document.querySelector("#entryDessertStartInput"),
  entryDessertStartRow: document.querySelector("#entryDessertStartRow"),
  entryFields: document.querySelectorAll("[data-entry-fields]"),
  entryFeedingAmountInput: document.querySelector("#entryFeedingAmountInput"),
  entryFeedingAmountRow: document.querySelector("#entryFeedingAmountRow"),
  entryFeedingUnitInput: document.querySelector("#entryFeedingUnitInput"),
  entryFeedingUnitRow: document.querySelector("#entryFeedingUnitRow"),
  entryIdInput: document.querySelector("#entryIdInput"),
  entrySideInput: document.querySelector("#entrySideInput"),
  entryStartTimeInput: document.querySelector("#entryStartTimeInput"),
  entryStorageInput: document.querySelector("#entryStorageInput"),
  entryStorageRow: document.querySelector("#entryStorageRow"),
  entryTypeInput: document.querySelector("#entryTypeInput"),
  deleteDialog: document.querySelector("#deleteDialog"),
  deleteEventId: document.querySelector("#deleteEventId"),
  deleteEventText: document.querySelector("#deleteEventText"),
  deleteEventType: document.querySelector("#deleteEventType"),
  declineFamilyInviteButton: document.querySelector("#declineFamilyInviteButton"),
  exportButton: document.querySelector("#exportButton"),
  familyInviteCard: document.querySelector("#familyInviteCard"),
  familyInviteText: document.querySelector("#familyInviteText"),
  googleSignInButton: document.querySelector("#googleSignInButton"),
  historyList: document.querySelector("#historyList"),
  manualSyncButton: document.querySelector("#manualSyncButton"),
  lastDiaperText: document.querySelector("#lastDiaperText"),
  lastFeedText: document.querySelector("#lastFeedText"),
  leftSideStat: document.querySelector("#leftSideStat"),
  menu: document.querySelector("#appMenu"),
  menuBackdrop: document.querySelector("#menuBackdrop"),
  menuButton: document.querySelector("#menuButton"),
  menuUserEmail: document.querySelector("#menuUserEmail"),
  menuUserName: document.querySelector("#menuUserName"),
  milkAmountInput: document.querySelector("#milkAmountInput"),
  milkDateInput: document.querySelector("#milkDateInput"),
  milkDateRow: document.querySelector("#milkDateRow"),
  milkDialog: document.querySelector("#milkDialog"),
  milkDialogTitle: document.querySelector("#milkDialogTitle"),
  milkMode: document.querySelector("#milkMode"),
  milkRuleWarning: document.querySelector("#milkRuleWarning"),
  milkTargetId: document.querySelector("#milkTargetId"),
  milkTimeInput: document.querySelector("#milkTimeInput"),
  milkTimeRow: document.querySelector("#milkTimeRow"),
  milkUnitInput: document.querySelector("#milkUnitInput"),
  milkUnitRow: document.querySelector("#milkUnitRow"),
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
  pumpButton: document.querySelector("#pumpButton"),
  pumpRuleWarning: document.querySelector("#pumpRuleWarning"),
  pumpSelectDialog: document.querySelector("#pumpSelectDialog"),
  pumpSelectInput: document.querySelector("#pumpSelectInput"),
  pumpStorageGroup: document.querySelector("#pumpStorageGroup"),
  rightSideStat: document.querySelector("#rightSideStat"),
  resetDataButton: document.querySelector("#resetDataButton"),
  resetDialog: document.querySelector("#resetDialog"),
  savePartnerEmailsButton: document.querySelector("#savePartnerEmailsButton"),
  sideButtons: document.querySelectorAll("[data-side]"),
  signOutButton: document.querySelector("#signOutButton"),
  sleepyDialog: document.querySelector("#sleepyDialog"),
  statusDot: document.querySelector("#statusDot"),
  stopButton: document.querySelector("#stopButton"),
  syncConfigStatus: document.querySelector("#syncConfigStatus"),
  partnerEmailsInput: document.querySelector("#partnerEmailsInput"),
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
  els.dessertButton.addEventListener("click", toggleDessert);
  els.editActiveStartButton.addEventListener("click", openActiveStartDialog);
  els.undoButton.addEventListener("click", runUndo);
  els.exportButton.addEventListener("click", exportData);
  els.addManualButton.addEventListener("click", () => openEntryDialog());
  els.manualSyncButton.addEventListener("click", manualSyncNow);
  els.pumpButton.addEventListener("click", () => openMilkDialog("pump"));
  els.milkAmountInput.addEventListener("input", renderMilkRuleWarning);
  els.milkUnitInput.addEventListener("change", renderMilkRuleWarning);
  els.pumpSelectInput.addEventListener("change", renderPumpSelectionWarning);
  els.googleSignInButton.addEventListener("click", signInWithGoogle);
  els.signOutButton.addEventListener("click", signOut);
  els.resetDataButton.addEventListener("click", openResetDialog);
  els.notificationButton.addEventListener("click", toggleNotifications);
  els.savePartnerEmailsButton.addEventListener("click", savePartnerEmails);
  els.acceptFamilyInviteButton.addEventListener("click", acceptFamilyInvitation);
  els.declineFamilyInviteButton.addEventListener("click", declineFamilyInvitation);
  els.entryTypeInput.addEventListener("change", renderEntryDialogFields);
  els.entrySideInput.addEventListener("change", renderEntryDialogFields);
  els.entryDessertInput.addEventListener("change", renderEntryDialogFields);
  els.historyList.addEventListener("click", handleHistoryClick);
  els.resetDialog.addEventListener("close", () => {
    if (els.resetDialog.returnValue === "confirm") resetCurrentUserData();
  });
  els.deleteDialog.addEventListener("close", () => {
    if (els.deleteDialog.returnValue === "confirm") deleteSelectedEvent();
  });
  els.milkDialog.addEventListener("close", () => {
    if (els.milkDialog.returnValue === "save") saveMilkDialog();
  });
  els.pumpSelectDialog.addEventListener("close", () => {
    if (els.pumpSelectDialog.returnValue === "start") startBottleFromSelectedPump();
  });
  els.entryDialog.addEventListener("close", () => {
    if (els.entryDialog.returnValue === "save") saveEntryDialog();
  });
  els.activeStartDialog.addEventListener("close", () => {
    if (els.activeStartDialog.returnValue === "save") saveActiveStartDialog();
  });

  window.addEventListener("focus", refreshCloudOnResume);
  window.addEventListener("online", refreshCloudOnResume);
  window.addEventListener("pageshow", refreshCloudOnResume);
  window.addEventListener("pagehide", flushCloudWritesBeforeSleep);
  window.addEventListener("beforeunload", flushCloudWritesBeforeSleep);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushCloudWritesBeforeSleep();
    else refreshCloudOnResume();
  });

  if ("serviceWorker" in navigator) {
    const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
    let reloadingForServiceWorker = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadServiceWorkerController || reloadingForServiceWorker) return;
      reloadingForServiceWorker = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        els.syncStatus.textContent = "נשמר מקומית";
      });
  }

  renderAuth();
  renderNotificationState();
  renderSyncSettings();
  initGoogleAuth();
  initCloudAuth();
  render();
  setInterval(render, 1000);
  setInterval(() => {
    if (!document.hidden && navigator.onLine !== false) refreshCloudOnResume();
  }, CLOUD_VISIBLE_REFRESH_MS);
}

function storageKeyFor(user) {
  return `${LEGACY_STORAGE_KEY}:user:${user.id}`;
}

function notificationKeyFor(user) {
  return `${NOTIFICATION_STORAGE_PREFIX}:user:${user.id}`;
}

function cloudDirtyKeyFor(user) {
  return `${CLOUD_DIRTY_STORAGE_PREFIX}:user:${user.id}`;
}

function fastSyncOutboxKeyFor(user) {
  return `${FAST_SYNC_OUTBOX_PREFIX}:user:${user.id}`;
}

function loadCloudDirty(user) {
  if (!user || user.provider === "guest") return false;
  return localStorage.getItem(cloudDirtyKeyFor(user)) === "1";
}

function markCloudDirty(user = currentUser) {
  if (!user || user.provider === "guest") return;
  cloudLocalDirty = true;
  localStorage.setItem(cloudDirtyKeyFor(user), "1");
}

function clearCloudDirty(user = currentUser) {
  if (!user || user.provider === "guest") return;
  cloudLocalDirty = false;
  localStorage.removeItem(cloudDirtyKeyFor(user));
}

function loadFastSyncOutbox(user = currentUser) {
  if (!user || user.provider === "guest") return {};

  try {
    const parsed = JSON.parse(localStorage.getItem(fastSyncOutboxKeyFor(user)) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveFastSyncOutbox(outbox, user = currentUser) {
  if (!user || user.provider === "guest") return;

  const key = fastSyncOutboxKeyFor(user);
  if (Object.keys(outbox).length) localStorage.setItem(key, JSON.stringify(outbox));
  else localStorage.removeItem(key);
}

function fastSyncOperationFieldKey(type, id, revision) {
  const bytes = new TextEncoder().encode(deletedKey(type, id));
  const eventKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const revisionKey = String(revision || "").replace(/[^a-z0-9_]/gi, "");
  return `e_${eventKey}_${revisionKey}`;
}

function createFastSyncRevision() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function stageFastSyncChanges(previousState, nextState) {
  if (currentUser.provider === "guest") return;

  const previous = normalizeState(previousState);
  const next = normalizeState(nextState);
  const outbox = loadFastSyncOutbox();
  let changed = false;

  SYNC_COLLECTIONS.forEach(({ stateKey, type }) => {
    const previousById = new Map(previous[stateKey].filter((item) => item?.id).map((item) => [item.id, item]));
    next[stateKey].forEach((item) => {
      if (!item?.id) return;
      const previousItem = previousById.get(item.id);
      if (previousItem && JSON.stringify(previousItem) === JSON.stringify(item)) return;

      const revision = createFastSyncRevision();
      const fieldKey = fastSyncOperationFieldKey(type, item.id, revision);
      outbox[`record:${fieldKey}`] = {
        revision,
        fieldKey,
        kind: "record",
        type,
        id: item.id,
        item: clone(item),
        queuedAt: new Date().toISOString(),
      };
      changed = true;
    });
  });

  const previousDeletes = new Map(
    previous.deletedEvents
      .filter((item) => item?.type && item?.id)
      .map((item) => [deletedKey(item.type, item.id), item]),
  );
  next.deletedEvents.forEach((tombstone) => {
    if (!tombstone?.type || !tombstone?.id) return;
    const key = deletedKey(tombstone.type, tombstone.id);
    const previousTombstone = previousDeletes.get(key);
    if (previousTombstone && JSON.stringify(previousTombstone) === JSON.stringify(tombstone)) return;

    const revision = createFastSyncRevision();
    const fieldKey = fastSyncOperationFieldKey(tombstone.type, tombstone.id, revision);
    outbox[`delete:${fieldKey}`] = {
      revision,
      fieldKey,
      kind: "delete",
      type: tombstone.type,
      id: tombstone.id,
      tombstone: clone(tombstone),
      queuedAt: new Date().toISOString(),
    };
    changed = true;
  });

  if (changed) saveFastSyncOutbox(outbox);
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
    if (scoped) return normalizeState(JSON.parse(scoped));

    if (user.provider === "guest") {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) return normalizeState(JSON.parse(legacy));
    }

    return clone(defaultState);
  } catch {
    return clone(defaultState);
  }
}

function normalizeState(value) {
  const next = { ...clone(defaultState), ...value };
  next.feedings = Array.isArray(next.feedings) ? next.feedings : [];
  next.diapers = Array.isArray(next.diapers) ? next.diapers : [];
  next.bottles = Array.isArray(next.bottles) ? next.bottles : [];
  next.pumps = Array.isArray(next.pumps) ? next.pumps : [];
  next.deletedEvents = Array.isArray(next.deletedEvents) ? next.deletedEvents : [];
  next.settings = { ...clone(defaultState.settings), ...(next.settings || {}) };
  next.sync = { ...clone(defaultState.sync), ...(next.sync || {}) };
  next.sync.partnerEmails = Array.isArray(next.sync.partnerEmails) ? next.sync.partnerEmails : [];
  next.sync.declinedFamilyIds = Array.isArray(next.sync.declinedFamilyIds) ? next.sync.declinedFamilyIds : [];
  return next;
}

function saveState() {
  if (!cloudApplyingRemote) stageFastSyncChanges(fastSyncBaselineState, state);
  fastSyncBaselineState = clone(state);
  localStorage.setItem(storageKeyFor(currentUser), JSON.stringify(state));
  if (!cloudApplyingRemote) {
    markCloudDirty();
    flushFastSyncOutbox({ keepalive: true }).catch(() => {});
    scheduleCloudWrite(0);
    if (!cloudDocRef && currentUser.provider !== "guest") {
      connectCloudSync().catch(() => {});
    }
  }
}

function switchUser(user) {
  saveState();
  stopCloudSync();
  pendingFamilyInvitation = null;
  currentUser = user;
  saveAuthUser(user);
  state = loadState(user);
  fastSyncBaselineState = clone(state);
  cloudLocalDirty = loadCloudDirty(user);
  clearUndo();
  clearNextFeedingNotification();
  renderAuth();
  renderNotificationState();
  renderSyncSettings();
  render();
  connectCloudSync();
}

function initGoogleAuth() {
  if (!hasFirebaseConfig()) {
    els.configHint.hidden = false;
    els.googleSignInButton.disabled = true;
    return;
  }

  els.configHint.hidden = true;
  els.googleSignInButton.disabled = false;
}

async function signInWithGoogle() {
  const services = await loadFirebaseServices();
  if (!services) {
    els.configHint.hidden = false;
    els.configHint.textContent = "Firebase עדיין לא מוגדר, לכן אי אפשר להתחבר עם Google.";
    return;
  }

  try {
    setCloudStatus("מתחבר ל-Google...", "נפתח חלון התחברות של Firebase Auth.");
    els.googleSignInButton.disabled = true;
    const provider = new services.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await services.setPersistence(services.auth, services.browserLocalPersistence);

    if (shouldUseRedirectSignIn()) {
      await services.signInWithRedirect(services.auth, provider);
      return;
    }

    const result = await services.signInWithPopup(services.auth, provider);
    const user = applyFirebaseUser(result.user);
    closeMenu();
    showToast(`מחובר כ-${user.name}`);
    await connectCloudSync();
  } catch (error) {
    if (services.auth.currentUser) {
      const user = applyFirebaseUser(services.auth.currentUser);
      closeMenu();
      showToast(`מחובר כ-${user.name}`);
      return;
    }

    setCloudStatus("נשמר מקומית", `Firebase Auth נכשל: ${error.message}`);
    showToast("התחברות Google נכשלה. בדוק ש-Google provider והדומיין מוגדרים ב-Firebase.");
  } finally {
    if (currentUser.provider === "guest") {
      els.googleSignInButton.disabled = false;
    }
  }
}

function shouldUseRedirectSignIn() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone;
  return isIOS || isStandalone || window.innerWidth <= 720;
}

async function signOut() {
  await signOutFirebase();
  stopCloudSync();
  switchUser(GUEST_USER);
  showToast("התנתקת. עברת למצב אורח");
}

function hasFirebaseConfig() {
  const config = window.LULLABY_LOG_CONFIG?.firebaseConfig;
  return Boolean(config?.apiKey && config?.authDomain && config?.projectId && config?.appId);
}

function getFirebaseConfig() {
  return hasFirebaseConfig() ? window.LULLABY_LOG_CONFIG.firebaseConfig : null;
}

async function loadFirebaseServices() {
  if (firebaseServices) return firebaseServices;
  if (firebaseInitPromise) return firebaseInitPromise;

  const firebaseConfig = getFirebaseConfig();
  if (!firebaseConfig) return null;

  firebaseInitPromise = Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`),
  ])
    .then(([appModule, authModule, firestoreModule]) => {
      const app = appModule.initializeApp(firebaseConfig);
      const auth = authModule.getAuth(app);
      let db;

      try {
        db = firestoreModule.initializeFirestore(app, {
          localCache: firestoreModule.persistentLocalCache({
            tabManager: firestoreModule.persistentMultipleTabManager(),
          }),
          experimentalAutoDetectLongPolling: true,
        });
      } catch {
        db = firestoreModule.getFirestore(app);
      }

      firebaseServices = {
        auth,
        db,
        GoogleAuthProvider: authModule.GoogleAuthProvider,
        arrayUnion: firestoreModule.arrayUnion,
        browserLocalPersistence: authModule.browserLocalPersistence,
        collection: firestoreModule.collection,
        deleteField: firestoreModule.deleteField,
        doc: firestoreModule.doc,
        getRedirectResult: authModule.getRedirectResult,
        getDoc: firestoreModule.getDoc,
        getDocFromServer: firestoreModule.getDocFromServer,
        getDocs: firestoreModule.getDocs,
        limit: firestoreModule.limit,
        onAuthStateChanged: authModule.onAuthStateChanged,
        onSnapshot: firestoreModule.onSnapshot,
        query: firestoreModule.query,
        runTransaction: firestoreModule.runTransaction,
        serverTimestamp: firestoreModule.serverTimestamp,
        setDoc: firestoreModule.setDoc,
        setPersistence: authModule.setPersistence,
        signInWithRedirect: authModule.signInWithRedirect,
        signInWithPopup: authModule.signInWithPopup,
        signOut: authModule.signOut,
        waitForPendingWrites: firestoreModule.waitForPendingWrites,
        where: firestoreModule.where,
      };

      return firebaseServices;
    })
    .catch((error) => {
      firebaseInitPromise = null;
      setCloudStatus("נשמר מקומית", `טעינת Firebase נכשלה: ${error.message}`);
      return null;
    });

  return firebaseInitPromise;
}

async function initCloudAuth() {
  const services = await loadFirebaseServices();
  if (!services || firebaseAuthUnsubscribe) {
    renderSyncSettings();
    return;
  }

  try {
    await services.setPersistence(services.auth, services.browserLocalPersistence);
    const redirectResult = await services.getRedirectResult(services.auth);
    if (redirectResult?.user) {
      applyFirebaseUser(redirectResult.user);
      closeMenu();
      showToast(`מחובר כ-${redirectResult.user.displayName || redirectResult.user.email}`);
    }
  } catch (error) {
    setCloudStatus("נשמר מקומית", `בדיקת התחברות Google נכשלה: ${error.message}`);
  }

  firebaseAuthUnsubscribe = services.onAuthStateChanged(services.auth, (firebaseUser) => {
    if (!firebaseUser) {
      clearCachedFirebaseToken();
      stopCloudSync();
      if (currentUser.provider !== "guest") {
        switchUser(GUEST_USER);
      }
      renderSyncSettings();
      return;
    }

    applyFirebaseUser(firebaseUser);
  });
}

function applyFirebaseUser(firebaseUser) {
  const user = userFromFirebase(firebaseUser);
  const isSameUser = currentUser.provider !== "guest" && currentUser.firebaseUid === firebaseUser.uid;

  if (!isSameUser) {
    switchUser(user);
    refreshCachedFirebaseToken(firebaseUser).catch(() => {});
    return user;
  }

  currentUser = {
    ...currentUser,
    firebaseUid: firebaseUser.uid,
    email: firebaseUser.email || currentUser.email,
    name: firebaseUser.displayName || currentUser.name,
    picture: firebaseUser.photoURL || currentUser.picture,
  };
  saveAuthUser(currentUser);
  renderAuth();
  renderSyncSettings();
  connectCloudSync();
  refreshCachedFirebaseToken(firebaseUser).catch(() => {});
  return currentUser;
}

function userFromFirebase(firebaseUser) {
  return {
    id: `google:${firebaseUser.uid}`,
    firebaseUid: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email || "משתמש Google",
    email: firebaseUser.email || "",
    picture: firebaseUser.photoURL || "",
    provider: "google",
  };
}

function clearCachedFirebaseToken() {
  clearTimeout(firebaseTokenRefreshTimer);
  firebaseTokenRefreshTimer = null;
  cachedFirebaseIdToken = "";
  cachedFirebaseUid = "";
}

async function refreshCachedFirebaseToken(firebaseUser, forceRefresh = false) {
  if (!firebaseUser) {
    clearCachedFirebaseToken();
    return "";
  }

  const token = await firebaseUser.getIdToken(forceRefresh);
  if (firebaseServices?.auth.currentUser?.uid !== firebaseUser.uid) return "";

  clearTimeout(firebaseTokenRefreshTimer);
  cachedFirebaseIdToken = token;
  cachedFirebaseUid = firebaseUser.uid;
  firebaseTokenRefreshTimer = setTimeout(() => {
    const activeUser = firebaseServices?.auth.currentUser;
    if (activeUser) refreshCachedFirebaseToken(activeUser, true).catch(() => {});
  }, 50 * 60 * 1000);
  flushFastSyncOutbox({ keepalive: true }).catch(() => {});
  return token;
}

async function signOutFirebase() {
  const services = await loadFirebaseServices();
  if (!services) return;

  try {
    await services.signOut(services.auth);
  } catch {
    // Local sign-out should still continue even if Firebase is temporarily unavailable.
  }
}

function setCloudStatus(status, detail = "") {
  cloudStatusText = status;
  if (els.syncStatus && els.syncStatus.textContent !== status) els.syncStatus.textContent = status;
  if (detail && els.syncConfigStatus && /שגיאה|נשמר מקומית|ממתין/.test(status)) {
    els.syncConfigStatus.textContent = detail;
  }
  renderManualSyncButton();
}

function stopCloudSync({ preserveLocalDirty = false } = {}) {
  clearTimeout(cloudWriteTimer);
  cloudWriteTimer = null;
  cloudWritePromise = null;
  cloudWriteQueued = false;
  if (!preserveLocalDirty) cloudLocalDirty = loadCloudDirty(currentUser);

  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }

  cloudDocRef = null;
  cloudMemberEmails = [];
  cloudApplyingRemote = false;
  cloudStatusText = "";
  cloudLastRefreshAt = 0;
  cloudRefreshPromise = null;
}

function toFirestoreRestValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFirestoreRestValue(item)) } };
  }
  if (typeof value === "object") {
    const fields = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (nestedValue !== undefined) fields[key] = toFirestoreRestValue(nestedValue);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function buildFastSyncRequest(entries, syncContext) {
  const fastRecords = {};
  const fastDeletes = {};
  const fieldPaths = [];

  entries.forEach((entry) => {
    const payload = {
      type: entry.type,
      id: entry.id,
      queuedAt: entry.queuedAt,
      updatedByUid: syncContext.uid,
      updatedByEmail: syncContext.email,
    };

    if (entry.kind === "delete") {
      payload.tombstone = entry.tombstone;
      fastDeletes[entry.fieldKey] = toFirestoreRestValue(payload);
      fieldPaths.push(`fastDeletes.${entry.fieldKey}`);
    } else {
      payload.item = entry.item;
      fastRecords[entry.fieldKey] = toFirestoreRestValue(payload);
      fieldPaths.push(`fastRecords.${entry.fieldKey}`);
    }
  });

  const now = new Date().toISOString();
  const fields = {
    fastUpdatedAt: toFirestoreRestValue(now),
    updatedByUid: toFirestoreRestValue(syncContext.uid),
    updatedByEmail: toFirestoreRestValue(syncContext.email),
  };
  if (Object.keys(fastRecords).length) fields.fastRecords = { mapValue: { fields: fastRecords } };
  if (Object.keys(fastDeletes).length) fields.fastDeletes = { mapValue: { fields: fastDeletes } };

  fieldPaths.push("fastUpdatedAt", "updatedByUid", "updatedByEmail");
  const query = new URLSearchParams();
  fieldPaths.forEach((path) => query.append("updateMask.fieldPaths", path));
  query.set("currentDocument.exists", "true");

  const encodedDocumentPath = syncContext.documentPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(syncContext.projectId)}/databases/(default)/documents/${encodedDocumentPath}?${query}`;
  return { url, body: JSON.stringify({ fields }) };
}

function selectFastSyncBatch(entries, syncContext) {
  const selected = [];

  for (const entry of entries) {
    if (selected.length >= FAST_SYNC_MAX_BATCH_ITEMS) break;
    const candidate = [...selected, entry];
    const request = buildFastSyncRequest(candidate, syncContext);
    const requestBytes = new TextEncoder().encode(request.body).length;
    if (requestBytes > FAST_SYNC_MAX_BATCH_BYTES && selected.length) break;
    selected.push(entry);
  }

  return selected;
}

function createFastSyncContext() {
  const firebaseUser = firebaseServices?.auth.currentUser;
  const firebaseConfig = getFirebaseConfig();
  if (
    currentUser.provider === "guest"
    || !cloudDocRef
    || !firebaseUser
    || !firebaseConfig?.projectId
    || !cachedFirebaseIdToken
    || cachedFirebaseUid !== firebaseUser.uid
  ) {
    return null;
  }

  return {
    user: { ...currentUser },
    uid: firebaseUser.uid,
    email: currentUser.email || "",
    token: cachedFirebaseIdToken,
    projectId: firebaseConfig.projectId,
    documentPath: cloudDocRef.path,
  };
}

async function flushFastSyncOutbox({ keepalive = false } = {}) {
  const syncContext = createFastSyncContext();
  if (!syncContext || navigator.onLine === false) return false;
  if (!Object.keys(loadFastSyncOutbox(syncContext.user)).length) return true;

  const flushPromise = flushFastSyncOutboxInternal(syncContext, keepalive);
  fastSyncFlushPromise = flushPromise;
  try {
    return await flushPromise;
  } finally {
    if (fastSyncFlushPromise === flushPromise) fastSyncFlushPromise = null;
  }
}

function sendFastSyncRequest(request, token, keepalive) {
  return fetch(request.url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: request.body,
    keepalive,
  });
}

async function flushFastSyncOutboxInternal(syncContext, keepalive) {
  let sentAny = false;

  while (navigator.onLine !== false) {
    const outbox = loadFastSyncOutbox(syncContext.user);
    const entries = Object.values(outbox);
    if (!entries.length) return sentAny;

    const batch = selectFastSyncBatch(entries, syncContext);
    if (!batch.length) return sentAny;
    const request = buildFastSyncRequest(batch, syncContext);
    let response = await sendFastSyncRequest(request, syncContext.token, keepalive);

    if (response.status === 401 && !document.hidden) {
      const activeUser = firebaseServices?.auth.currentUser;
      const refreshedToken = activeUser ? await refreshCachedFirebaseToken(activeUser, true) : "";
      if (refreshedToken) {
        syncContext.token = refreshedToken;
        response = await sendFastSyncRequest(request, syncContext.token, keepalive);
      }
    }
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`Fast sync failed (${response.status})${message ? `: ${message.slice(0, 160)}` : ""}`);
    }

    const latestOutbox = loadFastSyncOutbox(syncContext.user);
    batch.forEach((entry) => {
      const key = `${entry.kind}:${entry.fieldKey}`;
      if (latestOutbox[key]?.revision === entry.revision) delete latestOutbox[key];
    });
    saveFastSyncOutbox(latestOutbox, syncContext.user);
    sentAny = true;

    if (document.hidden) return true;
  }

  return sentAny;
}

function connectCloudSync() {
  if (cloudConnectPromise) return cloudConnectPromise;

  const connectingUserId = currentUser.id;
  cloudConnectPromise = connectCloudSyncInternal(connectingUserId)
    .finally(() => {
      cloudConnectPromise = null;
    });
  return cloudConnectPromise;
}

async function connectCloudSyncInternal(connectingUserId) {
  const connectionIsStale = () => currentUser.id !== connectingUserId;
  clearTimeout(cloudWriteTimer);

  if (currentUser.provider === "guest" || !currentUser.email) {
    stopCloudSync();
    return;
  }

  const services = await loadFirebaseServices();
  if (connectionIsStale()) return;
  if (!services) {
    renderSyncSettings();
    return;
  }

  if (!services.auth.currentUser) {
    setCloudStatus("נשמר מקומית", "צריך להתחבר שוב עם Google כדי להפעיל סנכרון ענן.");
    return;
  }

  let memberEmails = getCloudMemberEmails();
  let familyId = await createFamilyId(memberEmails);

  if (memberEmails.length === 1) {
    const discoveredFamily = await findExistingFamilyForCurrentUser(services);
    if (connectionIsStale()) return;
    if (discoveredFamily) {
      if (discoveredFamily.isExistingMember) {
        state.sync.partnerEmails = discoveredFamily.memberEmails.filter(
          (email) => email !== normalizeEmail(currentUser.email),
        );
        state.sync.declinedFamilyIds = state.sync.declinedFamilyIds.filter(
          (id) => id !== discoveredFamily.id,
        );
        localStorage.setItem(storageKeyFor(currentUser), JSON.stringify(state));
        pendingFamilyInvitation = null;
        memberEmails = discoveredFamily.memberEmails;
        familyId = discoveredFamily.id;
        setCloudStatus("המשפחה שוחזרה", partnerSyncLabel(memberEmails));
        renderSyncSettings();
      } else {
        const isNewInvitation = pendingFamilyInvitation?.id !== discoveredFamily.id;
        pendingFamilyInvitation = discoveredFamily;
        setCloudStatus("ממתין לאישור משפחה", familyInviteLabel(discoveredFamily));
        renderSyncSettings();
        if (isNewInvitation) showView("sync");
        return;
      }
    }
  }

  const nextDocRef = services.doc(services.db, FIREBASE_FAMILY_COLLECTION, familyId);

  if (cloudDocRef && cloudDocRef.path === nextDocRef.path && cloudUnsubscribe) {
    cloudMemberEmails = memberEmails;
    await refreshCachedFirebaseToken(services.auth.currentUser);
    await flushFastSyncOutbox({ keepalive: true }).catch(() => false);
    await refreshCloudFromServer({ force: true });
    if (loadCloudDirty(currentUser)) scheduleCloudWrite(0);
    return;
  }

  stopCloudSync({ preserveLocalDirty: loadCloudDirty(currentUser) });
  if (connectionIsStale()) return;
  cloudDocRef = nextDocRef;
  cloudMemberEmails = memberEmails;
  renderSyncSettings();
  setCloudStatus("מתחבר לענן...", "פותח סנכרון בזמן אמת מול Firestore.");

  try {
    await ensureCloudDocReady();
    if (connectionIsStale()) return;
    await refreshCachedFirebaseToken(services.auth.currentUser);
    if (connectionIsStale()) return;
    await flushFastSyncOutbox({ keepalive: true }).catch(() => false);
  } catch (error) {
    stopCloudSync({ preserveLocalDirty: loadCloudDirty(currentUser) });
    setCloudStatus("נשמר מקומית", `לא הצלחתי ליצור מסמך סנכרון: ${error.message}`);
    return;
  }

  cloudUnsubscribe = services.onSnapshot(
    cloudDocRef,
    { includeMetadataChanges: true },
    (snapshot) => handleCloudSnapshot(snapshot),
    (error) => {
      stopCloudSync({ preserveLocalDirty: loadCloudDirty(currentUser) });
      setCloudStatus("נשמר מקומית", `שגיאת סנכרון Firestore: ${error.message}`);
    },
  );

  await refreshCloudFromServer({ force: true });
  if (connectionIsStale()) return;
  if (loadCloudDirty(currentUser)) scheduleCloudWrite(0);
}

async function refreshCloudOnResume() {
  if (currentUser.provider === "guest") return;

  try {
    await connectCloudSync();
    await flushFastSyncOutbox({ keepalive: true }).catch(() => false);
    await refreshCloudFromServer();
  } catch (error) {
    setCloudStatus("נשמר מקומית", `לא הצלחתי לרענן סנכרון ענן: ${error.message}`);
  }
}

async function refreshCloudFromServer({ force = false, throwOnError = false, showProgress = false } = {}) {
  if (!cloudDocRef || currentUser.provider === "guest") return;

  const now = Date.now();
  if (!force && now - cloudLastRefreshAt < CLOUD_REFRESH_THROTTLE_MS) {
    if (cloudRefreshPromise) await cloudRefreshPromise;
    return;
  }

  if (cloudRefreshPromise) {
    await cloudRefreshPromise;
    return;
  }

  cloudLastRefreshAt = now;
  cloudRefreshPromise = (async () => {
    const services = await loadFirebaseServices();
    const firebaseUser = services?.auth.currentUser;
    const readCloudDoc = services?.getDocFromServer || services?.getDoc;
    if (!services || !firebaseUser || !cloudDocRef || !readCloudDoc) return;

    if (showProgress) {
      setCloudStatus("בודק עדכונים בענן...", partnerSyncLabel(cloudMemberEmails.length ? cloudMemberEmails : getCloudMemberEmails()));
    }
    const snapshot = await readCloudDoc(cloudDocRef);
    handleCloudSnapshot(snapshot);
  })()
    .catch((error) => {
      const status = navigator.onLine === false ? "ממתין לרשת" : "שגיאת סנכרון";
      setCloudStatus(status, `לא הצלחתי למשוך עדכונים מהענן: ${error.message}`);
      if (throwOnError) throw error;
    })
    .finally(() => {
      cloudRefreshPromise = null;
    });

  await cloudRefreshPromise;
}

async function ensureCloudDocReady() {
  if (!cloudDocRef) return;

  const services = await loadFirebaseServices();
  const firebaseUser = services?.auth.currentUser;
  if (!services || !firebaseUser) return;

  const memberEmails = getCloudMemberEmails();
  cloudMemberEmails = memberEmails;

  await services.setDoc(
    cloudDocRef,
    {
      app: "newborn-helper",
      schemaVersion: 5,
      memberEmails,
      memberUids: services.arrayUnion(firebaseUser.uid),
      updatedAt: new Date().toISOString(),
      updatedByEmail: currentUser.email || "",
      updatedByUid: firebaseUser.uid,
      serverUpdatedAt: services.serverTimestamp(),
    },
    { merge: true },
  );
}

function scheduleCloudWrite(delay = CLOUD_WRITE_DEBOUNCE_MS) {
  if (cloudApplyingRemote || currentUser.provider === "guest") return;
  if (!cloudDocRef) {
    markCloudDirty();
    return;
  }

  clearTimeout(cloudWriteTimer);
  cloudWriteTimer = null;
  if (delay <= 0) {
    queueCloudWrite();
    return;
  }

  cloudWriteTimer = setTimeout(() => {
    cloudWriteTimer = null;
    queueCloudWrite();
  }, delay);
}

function queueCloudWrite() {
  if (cloudApplyingRemote || !cloudDocRef || currentUser.provider === "guest") return null;

  if (cloudWritePromise) {
    cloudWriteQueued = true;
    return cloudWritePromise;
  }

  cloudWritePromise = writeCloudState()
    .then(() => {
      if (!cloudWriteQueued) clearCloudDirty();
    })
    .catch((error) => {
      markCloudDirty();
      setCloudStatus("שגיאת סנכרון", `לא הצלחתי לשמור בענן: ${error.message}`);
    })
    .finally(() => {
      cloudWritePromise = null;
      if (cloudWriteQueued) {
        cloudWriteQueued = false;
        scheduleCloudWrite(0);
      }
    });

  return cloudWritePromise;
}

async function waitForCloudWrites() {
  clearTimeout(cloudWriteTimer);
  cloudWriteTimer = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!loadCloudDirty(currentUser) && !cloudWritePromise && !cloudWriteQueued) return;

    const pendingWrite = cloudWritePromise || queueCloudWrite();
    if (pendingWrite) await pendingWrite;
    await Promise.resolve();
  }

  if (loadCloudDirty(currentUser)) {
    throw new Error("השינויים עדיין ממתינים להעלאה לענן");
  }
}

function flushCloudWritesBeforeSleep() {
  flushFastSyncOutbox({ keepalive: true }).catch(() => {});
  if (loadCloudDirty(currentUser) || cloudWriteTimer) {
    clearTimeout(cloudWriteTimer);
    cloudWriteTimer = null;
    queueCloudWrite();
  }
}

async function writeCloudState() {
  if (!cloudDocRef || cloudApplyingRemote) throw new Error("סנכרון הענן עדיין לא מוכן");

  const services = await loadFirebaseServices();
  const firebaseUser = services?.auth.currentUser;
  if (!services || !firebaseUser) throw new Error("צריך חיבור Google פעיל כדי לשמור בענן");

  const memberEmails = getCloudMemberEmails();
  cloudMemberEmails = memberEmails;
  setCloudStatus("מעלה לענן...", "שומר את היומן המשותף.");
  const localSnapshot = sanitizeStateForCloud(state);

  await services.setDoc(
    cloudDocRef,
    {
      app: "newborn-helper",
      schemaVersion: 5,
      memberEmails,
      memberUids: services.arrayUnion(firebaseUser.uid),
      memberStates: {
        [firebaseUser.uid]: {
          state: localSnapshot,
          updatedAt: new Date().toISOString(),
          updatedByEmail: currentUser.email || "",
        },
      },
      updatedAt: new Date().toISOString(),
      updatedByEmail: currentUser.email || "",
      updatedByUid: firebaseUser.uid,
      serverUpdatedAt: services.serverTimestamp(),
    },
    { merge: true },
  );

  const committedState = await services.runTransaction(services.db, async (transaction) => {
    const snapshot = await transaction.get(cloudDocRef);
    const cloudData = snapshot.exists() ? snapshot.data() || {} : {};
    const remoteState = mergeCloudDocumentState(cloudData);
    const mergedState = mergeStates(localSnapshot, remoteState);
    const mergedMemberEmails = normalizeEmailList([
      ...memberEmails,
      ...(cloudData.memberEmails || []),
    ]);

    transaction.set(
      cloudDocRef,
      {
        app: "newborn-helper",
        schemaVersion: 5,
        memberEmails: mergedMemberEmails,
        memberUids: services.arrayUnion(firebaseUser.uid),
        memberStates: services.deleteField(),
        fastRecords: services.deleteField(),
        fastDeletes: services.deleteField(),
        state: sanitizeStateForCloud(mergedState),
        updatedAt: new Date().toISOString(),
        updatedByEmail: currentUser.email || "",
        updatedByUid: firebaseUser.uid,
        serverUpdatedAt: services.serverTimestamp(),
      },
      { merge: true },
    );

    cloudMemberEmails = mergedMemberEmails;
    return mergedState;
  });

  await services.waitForPendingWrites(services.db);

  const latestLocalState = mergeStates(state, committedState);
  const hasNewerLocalChanges = serializeStateForSync(latestLocalState) !== serializeStateForSync(committedState);
  if (serializeStateForSync(latestLocalState) !== serializeStateForSync(state)) {
    cloudApplyingRemote = true;
    state = latestLocalState;
    localStorage.setItem(storageKeyFor(currentUser), JSON.stringify(state));
    fastSyncBaselineState = clone(state);
    cloudApplyingRemote = false;
    render();
  }
  if (hasNewerLocalChanges) cloudWriteQueued = true;

  setCloudStatus("מסונכרן בענן", partnerSyncLabel(cloudMemberEmails));
  return true;
}

async function manualSyncNow() {
  if (manualSyncInProgress) return;

  if (currentUser.provider === "guest" || !currentUser.email) {
    showView("settings");
    showToast("צריך להתחבר עם Google כדי לסנכרן");
    return;
  }

  if (navigator.onLine === false) {
    setCloudStatus("ממתין לרשת", "הסנכרון ימשיך אוטומטית כשהחיבור יחזור.");
    showToast("אין כרגע חיבור לאינטרנט");
    return;
  }

  manualSyncInProgress = true;
  renderManualSyncButton();

  try {
    setCloudStatus("מסנכרן עכשיו...", "מושך את הגרסה האחרונה ומאחד את היומן.");
    await connectCloudSync();
    if (!cloudDocRef) throw new Error("חיבור הענן עדיין לא מוכן");

    await flushFastSyncOutbox().catch(() => false);
    await refreshCloudFromServer({ force: true, throwOnError: true, showProgress: true });
    markCloudDirty();
    await waitForCloudWrites();
    await refreshCloudFromServer({ force: true, throwOnError: true, showProgress: true });

    setCloudStatus("מסונכרן עכשיו", partnerSyncLabel(cloudMemberEmails));
    showToast("היומן מסונכרן ומעודכן");
  } catch (error) {
    markCloudDirty();
    const status = navigator.onLine === false ? "ממתין לרשת" : "שגיאת סנכרון";
    setCloudStatus(status, `הסנכרון לא הושלם: ${error.message}`);
    showToast("הסנכרון לא הושלם. ננסה שוב אוטומטית");
  } finally {
    manualSyncInProgress = false;
    renderManualSyncButton();
  }
}

function renderManualSyncButton() {
  if (!els.manualSyncButton) return;

  const isGuest = currentUser.provider === "guest";
  els.manualSyncButton.disabled = manualSyncInProgress;
  els.manualSyncButton.classList.toggle("is-syncing", manualSyncInProgress);
  els.manualSyncButton.classList.toggle("is-guest", isGuest);
  els.manualSyncButton.classList.toggle("has-error", /שגיאה|ממתין/.test(cloudStatusText));
  const label = isGuest ? "התחברות כדי לסנכרן" : manualSyncInProgress ? "מסנכרן עכשיו" : "סנכרון עכשיו";
  els.manualSyncButton.setAttribute("aria-label", label);
  els.manualSyncButton.title = label;
}

function handleCloudSnapshot(snapshot) {
  if (!cloudDocRef) return;

  if (!snapshot.exists()) {
    scheduleCloudWrite(0);
    return;
  }

  const data = snapshot.data() || {};
  const remoteState = mergeCloudDocumentState(data);
  const hasFallbackMemberStates = Boolean(
    data.memberStates
    && typeof data.memberStates === "object"
    && Object.keys(data.memberStates).length,
  );
  const hasFastSyncOperations = Boolean(
    (data.fastRecords && typeof data.fastRecords === "object" && Object.keys(data.fastRecords).length)
    || (data.fastDeletes && typeof data.fastDeletes === "object" && Object.keys(data.fastDeletes).length),
  );
  const memberEmails = normalizeEmailList(data.memberEmails || cloudMemberEmails);
  if (memberEmails.length) {
    cloudMemberEmails = memberEmails;
    remoteState.sync.partnerEmails = memberEmails.filter((email) => email !== normalizeEmail(currentUser.email));
  }

  const merged = mergeStates(state, remoteState);
  const localChanged = serializeStateForSync(merged) !== serializeStateForSync(state);
  const remoteChanged = serializeStateForSync(merged) !== serializeStateForSync(remoteState);

  if (localChanged) {
    cloudApplyingRemote = true;
    state = merged;
    localStorage.setItem(storageKeyFor(currentUser), JSON.stringify(state));
    fastSyncBaselineState = clone(state);
    cloudApplyingRemote = false;
    renderAuth();
    renderNotificationState();
    renderSyncSettings();
    render();
  }

  const shouldCompactFallback = (hasFallbackMemberStates || hasFastSyncOperations) && !cloudWritePromise;
  if ((remoteChanged || shouldCompactFallback) && !snapshot.metadata.hasPendingWrites) {
    markCloudDirty();
    scheduleCloudWrite(0);
    return;
  }

  setCloudStatus(
    snapshot.metadata.hasPendingWrites ? "מסנכרן..." : "מסונכרן בענן",
    partnerSyncLabel(cloudMemberEmails),
  );
}

function getCloudMemberEmails() {
  return normalizeEmailList([currentUser.email, ...state.sync.partnerEmails]);
}

async function findExistingFamilyForCurrentUser(services) {
  const email = normalizeEmail(currentUser.email);
  const firebaseUid = services.auth.currentUser?.uid || currentUser.firebaseUid || "";
  if (!email) return null;

  try {
    const familiesRef = services.collection(services.db, FIREBASE_FAMILY_COLLECTION);
    const familiesQuery = services.query(familiesRef, services.where("memberEmails", "array-contains", email), services.limit(5));
    const snapshot = await services.getDocs(familiesQuery);
    let best = null;

    snapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const memberEmails = normalizeEmailList(data.memberEmails || []);
      const memberUids = Array.isArray(data.memberUids) ? data.memberUids.filter(Boolean) : [];
      if (memberEmails.length < 2) return;

      const candidate = {
        id: docSnapshot.id,
        memberEmails,
        memberUids,
        invitedByEmail: data.updatedByEmail || "",
        updatedAt: new Date(data.updatedAt || 0).getTime(),
        isExistingMember: Boolean(
          firebaseUid
          && (
            memberUids.includes(firebaseUid)
            || data.updatedByUid === firebaseUid
            || data.memberStates?.[firebaseUid]
          )
        ),
      };

      if (state.sync.declinedFamilyIds.includes(candidate.id)) return;

      if (!best || candidate.updatedAt > best.updatedAt) best = candidate;
    });

    return best;
  } catch {
    return null;
  }
}

function normalizeEmailList(emails) {
  return [...new Set((emails || []).map(normalizeEmail).filter(Boolean))].sort();
}

function normalizeFamilyIds(ids) {
  return [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function createFamilyId(memberEmails) {
  const source = memberEmails.join("|");
  if (crypto.subtle) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    return `family_${Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40)}`;
  }

  return `family_${btoa(source).replace(/[^a-z0-9]/gi, "").slice(0, 80)}`;
}

function sanitizeStateForCloud(value) {
  return normalizeState(clone(value));
}

function mergeCloudDocumentState(data) {
  let mergedState = normalizeState(data?.state || {});
  const memberStates = data?.memberStates && typeof data.memberStates === "object"
    ? Object.values(data.memberStates)
    : [];

  memberStates.forEach((memberState) => {
    if (!memberState?.state) return;
    mergedState = mergeStates(mergedState, normalizeState(memberState.state));
  });

  const operationState = clone(defaultState);
  const fastRecords = data?.fastRecords && typeof data.fastRecords === "object"
    ? Object.values(data.fastRecords)
    : [];
  const fastDeletes = data?.fastDeletes && typeof data.fastDeletes === "object"
    ? Object.values(data.fastDeletes)
    : [];

  fastRecords.forEach((operation) => {
    if (!operation?.item?.id) return;
    const collection = SYNC_COLLECTIONS.find(({ type }) => type === operation.type);
    if (collection) operationState[collection.stateKey].push(operation.item);
  });
  fastDeletes.forEach((operation) => {
    if (operation?.tombstone?.type && operation?.tombstone?.id) {
      operationState.deletedEvents.push(operation.tombstone);
    }
  });

  if (fastRecords.length || fastDeletes.length) {
    mergedState = mergeStates(mergedState, operationState);
  }

  return mergedState;
}

function serializeStateForSync(value) {
  return JSON.stringify(sanitizeStateForCloud(value));
}

function partnerSyncLabel(memberEmails) {
  const partners = memberEmails.filter((email) => email !== normalizeEmail(currentUser.email));
  return partners.length ? `סנכרון פעיל עם ${partners.join(", ")}` : "סנכרון ענן אישי פעיל. הוסף אימייל בן/בת זוג לשיתוף.";
}

function mergeStates(localState, remoteState) {
  const local = normalizeState(localState);
  const remote = normalizeState(remoteState);
  const deletedEvents = mergeDeletedEvents(local.deletedEvents, remote.deletedEvents);
  const deletedLookup = createDeletedLookup(deletedEvents);
  const partnerEmails = normalizeEmailList([
    ...local.sync.partnerEmails,
    ...remote.sync.partnerEmails,
  ]).filter((email) => email !== normalizeEmail(currentUser.email));

  return normalizeState({
    ...clone(defaultState),
    settings: { ...clone(defaultState.settings), ...remote.settings, ...local.settings },
    sync: {
      ...clone(defaultState.sync),
      ...remote.sync,
      ...local.sync,
      partnerEmails,
    },
    deletedEvents,
    feedings: mergeCollection(local.feedings, remote.feedings, "feeding", deletedLookup, "startedAt"),
    diapers: mergeCollection(local.diapers, remote.diapers, "diaper", deletedLookup, "createdAt"),
    bottles: mergeCollection(local.bottles, remote.bottles, "bottle", deletedLookup, "createdAt"),
    pumps: mergeCollection(local.pumps, remote.pumps, "pump", deletedLookup, "createdAt"),
  });
}

function mergeCollection(localItems, remoteItems, type, deletedLookup, dateField) {
  const byId = new Map();

  [...remoteItems, ...localItems].forEach((item) => {
    if (!item?.id) return;
    const deletedAt = deletedLookup.get(deletedKey(type, item.id));
    if (deletedAt && getRecordUpdatedAt(item) <= deletedAt) return;

    const existing = byId.get(item.id);
    if (!existing || getRecordUpdatedAt(item) >= getRecordUpdatedAt(existing)) {
      byId.set(item.id, item);
    }
  });

  return [...byId.values()].sort((a, b) => new Date(b[dateField] || 0) - new Date(a[dateField] || 0));
}

function mergeDeletedEvents(localDeleted, remoteDeleted) {
  const byKey = new Map();

  [...remoteDeleted, ...localDeleted].forEach((item) => {
    if (!item?.id || !item?.type || !item?.deletedAt) return;
    const key = deletedKey(item.type, item.id);
    const existing = byKey.get(key);
    if (!existing || new Date(item.deletedAt) >= new Date(existing.deletedAt)) {
      byKey.set(key, item);
    }
  });

  return [...byKey.values()]
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))
    .slice(0, 500);
}

function createDeletedLookup(deletedEvents) {
  const lookup = new Map();
  deletedEvents.forEach((item) => lookup.set(deletedKey(item.type, item.id), getRecordUpdatedAt({ updatedAt: item.deletedAt })));
  return lookup;
}

function deletedKey(type, id) {
  return `${type}:${id}`;
}

function getRecordUpdatedAt(item) {
  return new Date(item.updatedAt || item.endedAt || item.createdAt || item.startedAt || 0).getTime();
}

function openModal(dialog) {
  if (typeof dialog.showModal !== "function") return false;

  dialog.showModal();
  requestAnimationFrame(() => {
    const focusTarget = dialog.querySelector("[data-dialog-focus]") || dialog;
    focusTarget.focus({ preventScroll: true });
  });
  return true;
}

function openResetDialog() {
  closeMenu();
  if (openModal(els.resetDialog)) {
    return;
  }

  if (confirm("לאפס את כל הנתונים של המשתמש הנוכחי?")) {
    resetCurrentUserData();
  }
}

function resetCurrentUserData() {
  const syncSettings = clone(state.sync);
  const deletedEvents = createResetTombstones(state);
  localStorage.removeItem(storageKeyFor(currentUser));
  if (currentUser.provider === "guest") {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  state = { ...clone(defaultState), sync: syncSettings, deletedEvents };
  saveState();
  clearNextFeedingNotification();
  clearUndo();
  renderSyncSettings();
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
  const nextSyncStatus = isGuest ? "נשמר במכשיר" : cloudStatusText || `נשמר עבור ${currentUser.name}`;
  if (els.syncStatus.textContent !== nextSyncStatus) els.syncStatus.textContent = nextSyncStatus;
  renderManualSyncButton();
}

function renderSyncSettings() {
  els.partnerEmailsInput.value = state.sync.partnerEmails.join(", ");
  renderFamilyInvitation();
  const hasCloudConfig = hasFirebaseConfig();
  if (!currentUser.email) {
    els.syncConfigStatus.textContent = "יש להתחבר עם Google לפני סנכרון זוגי.";
  } else if (!hasCloudConfig) {
    els.syncConfigStatus.textContent = "חסרה הגדרת Firebase ב-config.js. עד אז הנתונים נשמרים מקומית.";
  } else if (!firebaseServices?.auth.currentUser) {
    els.syncConfigStatus.textContent = "Firebase מוגדר. צריך להתחבר עם Google כדי לפתוח סנכרון ענן.";
  } else if (cloudDocRef) {
    els.syncConfigStatus.textContent = partnerSyncLabel(cloudMemberEmails.length ? cloudMemberEmails : getCloudMemberEmails());
  } else {
    els.syncConfigStatus.textContent = "מוכן לחיבור סנכרון ענן.";
  }
}

function renderFamilyInvitation() {
  if (!els.familyInviteCard) return;

  const invitation = pendingFamilyInvitation;
  els.familyInviteCard.hidden = !invitation;
  if (!invitation) return;

  els.familyInviteText.textContent = familyInviteLabel(invitation);
}

function familyInviteLabel(invitation) {
  const currentEmail = normalizeEmail(currentUser.email);
  const partners = normalizeEmailList(invitation.memberEmails || []).filter((email) => email !== currentEmail);
  const from = invitation.invitedByEmail ? `הזמנה מ-${invitation.invitedByEmail}` : "נמצאה הזמנה ליומן משותף";
  return partners.length ? `${from}. היומן ישותף עם ${partners.join(", ")}.` : from;
}

function acceptFamilyInvitation() {
  if (!pendingFamilyInvitation) return;

  const invitation = pendingFamilyInvitation;
  state.sync.partnerEmails = normalizeEmailList(invitation.memberEmails).filter((email) => email !== normalizeEmail(currentUser.email));
  state.sync.declinedFamilyIds = state.sync.declinedFamilyIds.filter((id) => id !== invitation.id);
  pendingFamilyInvitation = null;
  saveState();
  renderSyncSettings();
  connectCloudSync();
  showToast("הצטרפת למשפחה");
}

function declineFamilyInvitation() {
  if (!pendingFamilyInvitation) return;

  state.sync.declinedFamilyIds = normalizeFamilyIds([...state.sync.declinedFamilyIds, pendingFamilyInvitation.id]);
  pendingFamilyInvitation = null;
  saveState();
  renderSyncSettings();
  setCloudStatus("נשמר במכשיר", "ההזמנה נדחתה. אפשר להצטרף בעתיד על ידי שמירת אימייל בן/בת הזוג.");
  showToast("ההזמנה נדחתה");
}

function savePartnerEmails() {
  state.sync.partnerEmails = els.partnerEmailsInput.value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  pendingFamilyInvitation = null;
  saveState();
  renderSyncSettings();
  connectCloudSync();
  showToast("אימיילים לסנכרון נשמרו");
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
    if (side === "bottle") {
      openPumpSelectDialog();
      return;
    }
    startFeeding(side);
    return;
  }

  if (active.side === side) {
    stopFeeding();
  }
}

function startFeeding(side, options = {}) {
  const now = new Date().toISOString();
  const feeding = {
    id: crypto.randomUUID(),
    side,
    pumpId: options.pumpId || "",
    startedAt: now,
    pauses: [],
    createdBy: currentUser.id,
    updatedAt: now,
    updatedBy: currentUser.id,
  };

  state.feedings.unshift(feeding);
  saveState();
  showUndo(`${isBottleFeeding(feeding) ? "התחיל בקבוק" : `התחילה הנקה מצד ${sideLabel(side)}`}`, () => {
    state.feedings = state.feedings.filter((item) => item.id !== feeding.id);
    trackDeletedEvent("feeding", feeding.id);
    saveState();
    render();
  });
  vibrate(20);
  render();
}

function openPumpSelectDialog() {
  const pumps = getPumpOptions();
  if (!pumps.length) {
    showToast("צריך לרשום שאיבה לפני שאפשר להתחיל בקבוק");
    showView("logs");
    return;
  }

  pendingBottlePumpId = "";
  els.pumpSelectDialog.returnValue = "";
  els.pumpSelectInput.innerHTML = pumps
    .map((pump) => `<option value="${pump.id}">${pumpOptionLabel(pump)}</option>`)
    .join("");
  els.pumpSelectInput.value = pumps[0].id;
  renderPumpSelectionWarning();

  openModal(els.pumpSelectDialog);
}

function startBottleFromSelectedPump() {
  const pumpId = els.pumpSelectInput.value;
  if (!pumpId) return;
  pendingBottlePumpId = pumpId;
  startFeeding("bottle", { pumpId });
}

function renderPumpSelectionWarning() {
  const pump = findEvent("pump", els.pumpSelectInput.value);
  const warnings = evaluatePumpWarnings(pump);
  els.pumpRuleWarning.hidden = warnings.length === 0;
  els.pumpRuleWarning.innerHTML = warnings.map((warning) => `<p>${warning}</p>`).join("");
}

function renderMilkRuleWarning() {
  if (els.milkMode.value !== "bottle-finish") {
    els.milkRuleWarning.hidden = true;
    els.milkRuleWarning.innerHTML = "";
    return;
  }

  const feeding = state.feedings.find((item) => item.id === els.milkTargetId.value);
  const pump = findEvent("pump", feeding?.pumpId || pendingBottlePumpId);
  const warnings = [...evaluatePumpWarnings(pump)];
  const remaining = pump ? formatPumpRemaining(pump, feeding?.id || "") : "";
  if (remaining) warnings.push(`נשאר בשאיבה הזו: ${remaining}`);
  const validationError = validateBottleAmountAgainstPump(
    pump,
    normalizeAmount(els.milkAmountInput.value),
    els.milkUnitInput.value || "ml",
    feeding?.id || "",
  );
  if (validationError) warnings.push(validationError);

  els.milkRuleWarning.hidden = warnings.length === 0;
  els.milkRuleWarning.innerHTML = warnings.map((warning) => `<p>${warning}</p>`).join("");
}

function stopFeeding() {
  const active = getActiveFeeding();
  if (!active) return;

  const previous = clone(active);
  closeOpenPause(active);
  closeOpenDessert(active);
  active.endedAt = new Date().toISOString();
  touchRecord(active);
  saveState();
  showUndo(isBottleFeeding(active) ? "הבקבוק הסתיים" : "ההנקה הסתיימה", () => {
    state.feedings = state.feedings.map((item) => (item.id === previous.id ? touchRecord(previous) : item));
    saveState();
    render();
  });
  if (isBottleFeeding(active)) openMilkDialog("bottle-finish", active);
  vibrate(35);
  render();
}

function toggleDessert() {
  const active = getActiveFeeding();
  if (!active || isBottleFeeding(active)) return;

  const previous = clone(active);
  const dessertSide = oppositeSide(active.side);
  if (!active.dessertSide) {
    const now = new Date().toISOString();
    active.dessertSide = dessertSide;
    active.dessertAt = now;
    active.dessertStartedAt = now;
    delete active.dessertEndedAt;
    delete active.dessertAttemptStartedAt;
    delete active.dessertAttemptEndedAt;
    showUndo(`התחיל קינוח מצד ${sideLabel(dessertSide)}`, () => restoreFeeding(previous));
  } else {
    stopFeeding();
    return;
  }

  touchRecord(active);
  saveState();
  vibrate(18);
  render();
}

function openActiveStartDialog() {
  const active = getActiveFeeding();
  if (!active) return;

  const startedAt = new Date(active.startedAt);
  els.activeStartDialog.returnValue = "";
  els.activeStartDateInput.value = toDateInputValue(startedAt);
  els.activeStartTimeInput.value = toTimeInputValue(startedAt);
  els.activeStartDialogText.textContent = `${isBottleFeeding(active) ? "בקבוק" : `הנקה מצד ${sideLabel(active.side)}`} התחילה כרגע ב-${formatTime(active.startedAt)}.`;
  openModal(els.activeStartDialog);
}

function saveActiveStartDialog() {
  const active = getActiveFeeding();
  if (!active) return;

  const nextStartedAt = combineDateAndTime(els.activeStartDateInput.value, els.activeStartTimeInput.value);
  const validationError = validateActiveStartChange(active, nextStartedAt);
  if (validationError) {
    showToast(validationError);
    return;
  }

  const previous = clone(active);
  active.startedAt = nextStartedAt;
  touchRecord(active);
  saveState();
  showUndo(`שעת ההתחלה עודכנה ל-${formatTime(nextStartedAt)}`, () => restoreFeeding(previous));
  vibrate(18);
  render();
}

function validateActiveStartChange(feeding, nextStartedAt) {
  const next = new Date(nextStartedAt);
  if (!Number.isFinite(next.getTime())) return "שעת ההתחלה לא תקינה";
  if (next.getTime() > Date.now() + 30 * 1000) return "אי אפשר לבחור שעת התחלה עתידית";

  const firstLaterEvent = [
    ...(feeding.pauses || []).map((pause) => pause.startedAt),
    getDessertStartedAt(feeding),
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];

  if (firstLaterEvent && next.getTime() > firstLaterEvent) {
    return "שעת ההתחלה חייבת להיות לפני עצירה או קינוח שכבר נרשמו";
  }

  return "";
}

function restoreFeeding(previous) {
  state.feedings = state.feedings.map((item) => (item.id === previous.id ? touchRecord(previous) : item));
  saveState();
  render();
}

function togglePause() {
  const active = getActiveFeeding();
  if (!active) return;

  const openPause = active.pauses.find((pause) => !pause.endedAt);
  if (openPause) {
    openPause.endedAt = new Date().toISOString();
    touchRecord(active);
    showUndo("העצירה הסתיימה", () => {
      openPause.endedAt = undefined;
      touchRecord(active);
      saveState();
      render();
    });
  } else {
    const pause = {
      startedAt: new Date().toISOString(),
      reason: "burp",
    };
    active.pauses.push(pause);
    touchRecord(active);
    showUndo("נרשמה עצירת גרעפס", () => {
      active.pauses = active.pauses.filter((item) => item !== pause);
      touchRecord(active);
      saveState();
      render();
    });
  }

  saveState();
  vibrate(20);
  render();
}

function openMilkDialog(mode, feeding = null) {
  const now = new Date();
  els.milkDialog.returnValue = "";
  els.milkMode.value = mode;
  els.milkTargetId.value = feeding?.id || "";
  els.milkDialogTitle.textContent = mode === "pump" ? "רישום שאיבה" : "כמה היא שתתה?";
  els.milkAmountInput.value = amountValue(feeding);
  els.milkUnitInput.value = amountUnit(feeding);
  els.milkDateInput.value = toDateInputValue(now);
  els.milkTimeInput.value = toTimeInputValue(now);
  els.pumpStorageGroup.hidden = mode !== "pump";
  els.milkDateRow.hidden = mode === "bottle-finish";
  els.milkTimeRow.hidden = mode === "bottle-finish";
  const roomOption = els.pumpStorageGroup.querySelector('input[value="room"]');
  if (roomOption) roomOption.checked = true;
  renderMilkRuleWarning();

  openModal(els.milkDialog);
}

function saveMilkDialog() {
  const mode = els.milkMode.value;
  const createdAt = combineDateAndTime(els.milkDateInput.value, els.milkTimeInput.value);
  const amount = normalizeAmount(els.milkAmountInput.value);
  const unit = els.milkUnitInput.value || "ml";

  if (mode === "bottle-finish") {
    const feeding = state.feedings.find((item) => item.id === els.milkTargetId.value);
    if (feeding) {
      const pump = findEvent("pump", feeding.pumpId || pendingBottlePumpId);
      const validationError = validateBottleAmountAgainstPump(pump, amount, unit, feeding.id);
      if (validationError) {
        showToast(validationError);
        setTimeout(() => {
          openMilkDialog("bottle-finish", feeding);
          els.milkAmountInput.value = amount;
          els.milkUnitInput.value = unit;
          renderMilkRuleWarning();
        }, 0);
        return;
      }
      feeding.amountValue = amount;
      feeding.amountUnit = unit;
      if (!feeding.pumpId && pendingBottlePumpId) feeding.pumpId = pendingBottlePumpId;
      delete feeding.amountMl;
      touchRecord(feeding);
      saveState();
      render();
      showToast(amount ? `נרשם ${formatAmount({ amountValue: amount, amountUnit: unit })}` : "הבקבוק נשמר");
    }
    return;
  }

  if (mode === "pump") {
    const now = new Date().toISOString();
    const storage = els.pumpStorageGroup.querySelector('input[name="pumpStorage"]:checked')?.value || "room";
    const storageDates = buildPumpStorageDates({ storage, createdAt });
    const pump = {
      id: crypto.randomUUID(),
      pumpCode: createPumpCode(),
      amountValue: amount,
      amountUnit: unit,
      storage,
      createdAt,
      recommendedUntil: storageDates.recommendedUntil,
      expiresAt: storageDates.expiresAt,
      createdBy: currentUser.id,
      updatedAt: now,
      updatedBy: currentUser.id,
    };
    state.pumps.unshift(pump);
    showUndo("נרשמה שאיבה", () => {
      state.pumps = state.pumps.filter((item) => item.id !== pump.id);
      trackDeletedEvent("pump", pump.id);
      saveState();
      render();
    });
  } else {
    const now = new Date().toISOString();
    const bottle = {
      id: crypto.randomUUID(),
      amountValue: amount,
      amountUnit: unit,
      createdAt,
      createdBy: currentUser.id,
      updatedAt: now,
      updatedBy: currentUser.id,
    };
    state.bottles.unshift(bottle);
    showUndo("נרשם בקבוק", () => {
      state.bottles = state.bottles.filter((item) => item.id !== bottle.id);
      trackDeletedEvent("bottle", bottle.id);
      saveState();
      render();
    });
  }

  saveState();
  vibrate(18);
  render();
}

function closeOpenPause(feeding, endedAt = new Date().toISOString()) {
  const openPause = feeding.pauses.find((pause) => !pause.endedAt);
  if (openPause) openPause.endedAt = endedAt;
}

function closeOpenDessert(feeding, endedAt = new Date().toISOString()) {
  if (!feeding?.dessertSide) return;
  const startedAt = getDessertStartedAt(feeding) || endedAt;
  feeding.dessertStartedAt = startedAt;
  feeding.dessertAt = startedAt;
  if (!feeding.dessertEndedAt) feeding.dessertEndedAt = endedAt;
  delete feeding.dessertAttemptStartedAt;
  delete feeding.dessertAttemptEndedAt;
}

function addDiaper(type) {
  const now = new Date().toISOString();
  const diaper = {
    id: crypto.randomUUID(),
    type,
    createdAt: now,
    createdBy: currentUser.id,
    updatedAt: now,
    updatedBy: currentUser.id,
  };

  state.diapers.unshift(diaper);
  saveState();
  showUndo(`נרשם ${diaperLabel(type)}`, () => {
    state.diapers = state.diapers.filter((item) => item.id !== diaper.id);
    trackDeletedEvent("diaper", diaper.id);
    saveState();
    render();
  });
  vibrate(18);
  render();
}

function render() {
  autoCloseLongFeedings();
  const active = getActiveFeeding();
  const latest = getLatestFeeding();
  const latestStarted = latest ? getFeedingIntervalBaseDate(latest) : null;

  renderFeeding(active, latest, latestStarted);
  renderDiapers();
  renderHistory();
  maybeShowSleepyReminder(active);
}

function autoCloseLongFeedings() {
  const now = Date.now();
  let changed = false;

  state.feedings.forEach((feeding) => {
    if (feeding.endedAt || !feeding.startedAt || isBottleFeeding(feeding)) return;
    const startedAt = new Date(feeding.startedAt).getTime();
    if (!Number.isFinite(startedAt) || now - startedAt < AUTO_CLOSE_FEEDING_MS) return;

    const autoClosedAt = new Date(startedAt + AUTO_CLOSE_FEEDING_MS).toISOString();
    closeOpenPause(feeding, autoClosedAt);
    closeOpenDessert(feeding, autoClosedAt);
    feeding.endedAt = autoClosedAt;
    feeding.autoClosed = true;
    feeding.autoClosedReason = "האם שכחתם לסגור?";
    touchRecord(feeding);
    changed = true;
  });

  if (changed) {
    saveState();
    showToast("הנקה נסגרה אוטומטית אחרי 20 דקות");
  }
}

function renderFeeding(active, latest, latestStarted) {
  els.activeControls.hidden = !active;
  els.editActiveStartButton.hidden = !active;
  els.activeTimer.classList.toggle("is-active", Boolean(active));

  if (active) {
    const elapsed = Date.now() - new Date(active.startedAt).getTime();
    const dessertSide = oppositeSide(active.side);
    setDurationText(els.activeTimer, formatDuration(elapsed));
    setDurationText(els.partnerElapsed, formatDuration(elapsed));
    if (isBottleFeeding(active)) {
      els.timerHint.textContent = `בקבוק התחיל ב-${formatTime(active.startedAt)}`;
      els.pauseButton.textContent = active.pauses.some((pause) => !pause.endedAt) ? "חזרה לבקבוק" : "עצירה";
      els.stopButton.textContent = "סיום בקבוק";
      els.dessertButton.hidden = true;
    } else {
      const dessertText = active.dessertSide ? ` + ${dessertLiveLabel(active)}` : "";
      els.timerHint.textContent = `התחילה ב-${formatTime(active.startedAt)} מצד ${sideLabel(active.side)}${dessertText}`;
      els.pauseButton.textContent = active.pauses.some((pause) => !pause.endedAt) ? "חזרה להנקה" : "גרעפס / עצירה";
      els.stopButton.textContent = active.dessertSide ? "סיום קינוח והנקה" : "סיום הנקה";
      els.dessertButton.textContent = dessertButtonLabel(active, dessertSide);
      els.dessertButton.hidden = Boolean(active.dessertSide);
    }
  } else {
    setDurationText(els.activeTimer, latestStarted ? timeSince(latestStarted) : "00:00");
    setDurationText(els.partnerElapsed, latestStarted ? timeSince(latestStarted) : "--");
    els.timerHint.textContent = latestStarted ? `עברו ${timeSince(latestStarted)} מסיום ההאכלה האחרונה` : "מוכנה להתחיל";
    els.pauseButton.textContent = "גרעפס / עצירה";
    els.stopButton.textContent = "סיום הנקה";
    els.dessertButton.hidden = false;
  }

  renderSideButtons(active, latest);

  if (latest) {
    const nextSide = nextStartSide(latest);
    const nextFeed = new Date(getFeedingIntervalBaseDate(latest).getTime() + FEEDING_INTERVAL_MS);
    els.nextSideText.textContent = nextSide ? sideLabel(nextSide) : "אין נתונים";
    els.lastFeedText.textContent = `${isBottleFeeding(latest) ? "בקבוק אחרון" : "הנקה אחרונה"}: ${feedingSummary(latest)} · ${latest.endedAt ? "הסתיימה" : "התחילה"} ב-${formatTime(getFeedingIntervalBaseDate(latest))}`;
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
    const latest = getLatestFeeding();
    if (!latest) return;
    nextFeed = new Date(getFeedingIntervalBaseDate(latest).getTime() + FEEDING_INTERVAL_MS);
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

  const latest = getLatestFeeding();
  const nextSideValue = latest ? nextStartSide(latest) : "";
  const nextSide = nextSideValue ? sideLabel(nextSideValue) : "";
  const body = nextSide ? `הגיע זמן ההאכלה. כדאי להתחיל מצד ${nextSide}.` : "הגיע זמן ההאכלה.";

  new Notification("NewBorn Helper", {
    body,
    icon: "assets/icon.svg",
    badge: "assets/icon.svg",
    tag: "next-feeding",
  });
}

function renderSideButtons(active, latest) {
  const hasAvailablePump = getPumpOptions().length > 0;
  els.bottleButton.disabled = !hasAvailablePump && !active;
  els.bottleButton.setAttribute("aria-disabled", String(!hasAvailablePump && !active));

  els.sideButtons.forEach((button) => {
    const side = button.dataset.side;
    button.classList.remove("is-active", "is-dimmed", "is-recent");

    if (active) {
      button.classList.toggle("is-active", active.side === side);
      button.classList.toggle("is-dimmed", active.side !== side);
      return;
    }

    if (nextStartSide(latest) === side) button.classList.add("is-recent");
  });

  els.rightSideStat.textContent = sideStatusText("right", active, latest);
  els.leftSideStat.textContent = sideStatusText("left", active, latest);
  els.bottleSideStat.textContent = hasAvailablePump ? sideStatusText("bottle", active, latest) : "אין שאיבה זמינה";
}

function sideStatusText(side, active, latest) {
  if (active?.side === side) return "פעיל";
  if (active) return "ממתין";
  if (side === "bottle") return "האכלה";
  if (latest && nextStartSide(latest) === side) return "להתחיל כאן";
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
  const latestDiaper = getLatestByDate(state.diapers, "createdAt");

  els.peeGoal.textContent = `${peeCount}/${PEE_GOAL}`;
  els.poopGoal.textContent = `${poopCount}/${POOP_GOAL}`;
  els.peeBar.style.width = `${Math.min(100, (peeCount / PEE_GOAL) * 100)}%`;
  els.poopBar.style.width = `${Math.min(100, (poopCount / POOP_GOAL) * 100)}%`;
  els.peeGoal.closest(".goal").classList.toggle("complete", peeCount >= PEE_GOAL);
  els.poopGoal.closest(".goal").classList.toggle("complete", poopCount >= POOP_GOAL);
  els.lastDiaperText.textContent = latestDiaper ? `אחרון: ${timeAgo(new Date(latestDiaper.createdAt))}` : "עוד אין חיתולים";
}

function renderHistory() {
  const feedingEvents = state.feedings.map((feeding) => {
    const warnings = evaluateBottleWarnings(feeding);
    return {
      type: "feeding",
      id: feeding.id,
      at: feeding.startedAt,
      title: isBottleFeeding(feeding) ? feedingSummary(feeding) : `הנקה: ${feedingSummary(feeding)}`,
      icon: isBottleFeeding(feeding) ? "🍼" : "🤱",
      duration: feedingDurationLabel(feeding),
      details: feedingPhaseDetailsHtml(feeding),
      warning: feeding.autoClosed ? "נסגר אוטומטית אחרי 20 דקות. האם שכחתם לסגור?" : warnings[0] || "",
      expired: warnings[0]?.includes("חמורה") || false,
    };
  });
  const diaperEvents = state.diapers.map((diaper) => ({
    type: "diaper",
    id: diaper.id,
    at: diaper.createdAt,
    title: diaperLabel(diaper.type),
    icon: diaperIcon(diaper.type),
    duration: "",
  }));
  const bottleEvents = state.bottles.map((bottle) => ({
    type: "bottle",
    id: bottle.id,
    at: bottle.createdAt,
    title: `בקבוק${formatAmount(bottle) ? ` ${formatAmount(bottle)}` : ""}`,
    icon: "🍼",
    duration: "",
  }));
  const pumpEvents = state.pumps.map((pump) => {
    const warnings = evaluatePumpWarnings(pump);
    const expired = isPumpExpired(pump);
    return {
      type: "pump",
      id: pump.id,
      at: pump.createdAt,
      title: `שאיבה ${pumpCode(pump)}${formatAmount(pump) ? ` · ${formatAmount(pump)}` : ""}`,
      icon: "⇢",
      duration: `${milkStorageLabel(pump.storage)} · ${formatMilkStorageStatus(pump)}`,
      warning: warnings[0] || "",
      expired,
    };
  });
  const events = [...feedingEvents, ...diaperEvents, ...bottleEvents, ...pumpEvents]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 14);

  els.historyList.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <li class="${event.expired ? "is-expired" : event.warning ? "is-warning" : ""}">
              <div class="history-leading">
                <span class="history-icon" aria-hidden="true">${event.icon}</span>
                <div class="history-main">
                  <strong>${event.title}</strong>
                  <span>${formatFullDate(event.at)}</span>
                  ${event.details || ""}
                  ${event.warning ? `<span class="history-warning">${event.warning}</span>` : ""}
                </div>
              </div>
              <div class="history-meta">
                <span>שעה ${formatTime(event.at)}</span>
                ${event.duration ? `<span>${event.type === "feeding" ? "משך " : ""}${event.duration}</span>` : ""}
                <div class="history-actions">
                  <button class="text-button history-edit" type="button" data-edit-type="${event.type}" data-edit-id="${event.id}">עריכה</button>
                  <button class="text-button history-delete" type="button" data-delete-type="${event.type}" data-delete-id="${event.id}">מחיקה</button>
                </div>
              </div>
            </li>
          `,
        )
        .join("")
    : `<li><strong>עוד אין אירועים</strong><span>הלילה מתחיל נקי</span></li>`;
}

function handleHistoryClick(event) {
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    openDeleteDialog(deleteButton.dataset.deleteType, deleteButton.dataset.deleteId);
    return;
  }

  const editButton = event.target.closest("[data-edit-type]");
  if (!editButton) return;
  openEntryDialog(editButton.dataset.editType, editButton.dataset.editId);
}

function openDeleteDialog(type, id) {
  const item = findEvent(type, id);
  if (!item) return;

  const label = eventDeleteLabel(type, item);
  els.deleteDialog.returnValue = "";
  els.deleteEventType.value = type;
  els.deleteEventId.value = id;
  els.deleteEventText.textContent = `למחוק את ${label} מהיומן?`;

  if (openModal(els.deleteDialog)) {
    return;
  }

  if (confirm(`למחוק את ${label} מהיומן?`)) deleteEvent(type, id);
}

function deleteSelectedEvent() {
  deleteEvent(els.deleteEventType.value, els.deleteEventId.value);
}

function deleteEvent(type, id) {
  const collection = getCollectionForType(type);
  const previous = clone(collection);
  const index = collection.findIndex((item) => item.id === id);
  if (index < 0) return;

  collection.splice(index, 1);
  trackDeletedEvent(type, id);
  saveState();
  render();
  showUndo("הפעולה נמחקה", () => {
    const target = getCollectionForType(type);
    target.splice(0, target.length, ...previous);
    untrackDeletedEvent(type, id);
    saveState();
    render();
  });
}

function eventDeleteLabel(type, item) {
  if (type === "feeding") return isBottleFeeding(item) ? feedingSummary(item) : `הנקה ${feedingSummary(item)}`;
  if (type === "diaper") return diaperLabel(item.type);
  if (type === "bottle") return "בקבוק";
  if (type === "pump") return `שאיבה ${pumpCode(item)}`;
  return "הפעולה";
}

function openEntryDialog(type = "feeding", id = "") {
  const item = id ? findEvent(type, id) : null;
  const now = new Date();
  const at = item ? new Date(type === "feeding" ? item.startedAt : item.createdAt) : now;

  els.entryDialog.returnValue = "";
  els.entryIdInput.value = id;
  els.entryTypeInput.value = type;
  els.entryTypeInput.disabled = Boolean(id);
  els.entryDialogTitle.textContent = id ? "עריכת פעולה" : "הוספה בדיעבד";
  els.entryDateInput.value = toDateInputValue(at);
  els.entryStartTimeInput.value = toTimeInputValue(at);
  els.entryEndTimeInput.value = item?.endedAt ? toTimeInputValue(new Date(item.endedAt)) : "";
  els.entrySideInput.value = item?.side || "right";
  els.entryDessertInput.checked = Boolean(item?.dessertSide);
  els.entryDessertStartInput.value = getDessertStartedAt(item) ? toTimeInputValue(new Date(getDessertStartedAt(item))) : "";
  els.entryDessertEndInput.value = item?.dessertEndedAt || (item?.dessertSide && item?.endedAt)
    ? toTimeInputValue(new Date(item.dessertEndedAt || item.endedAt))
    : "";
  els.entryFeedingAmountInput.value = amountValue(item);
  els.entryFeedingUnitInput.value = amountUnit(item);
  els.entryDiaperInput.value = item?.type || "pee";
  els.entryAmountInput.value = amountValue(item);
  els.entryAmountUnitInput.value = amountUnit(item);
  els.entryStorageInput.value = item?.storage || "room";
  renderEntryDialogFields();

  openModal(els.entryDialog);
}

function renderEntryDialogFields() {
  const type = els.entryTypeInput.value;
  const isBottleSide = type === "feeding" && els.entrySideInput.value === "bottle";
  els.entryFields.forEach((group) => {
    const key = group.dataset.entryFields;
    group.hidden = !(key === type || (key === "milk" && (type === "bottle" || type === "pump")));
  });
  els.entryDessertLabel.hidden = isBottleSide;
  const showDessertTimes = type === "feeding" && !isBottleSide && els.entryDessertInput.checked;
  els.entryDessertStartRow.hidden = !showDessertTimes;
  els.entryDessertEndRow.hidden = !showDessertTimes;
  els.entryFeedingAmountRow.hidden = !isBottleSide;
  els.entryFeedingUnitRow.hidden = !isBottleSide;
  els.entryStorageRow.hidden = type !== "pump";
}

function saveEntryDialog() {
  const id = els.entryIdInput.value;
  const type = els.entryTypeInput.value;
  const at = combineDateAndTime(els.entryDateInput.value, els.entryStartTimeInput.value);

  if (type === "feeding") {
    saveFeedingEntry(id, at);
  } else if (type === "diaper") {
    saveDiaperEntry(id, at);
  } else if (type === "bottle") {
    saveBottleEntry(id, at);
  } else if (type === "pump") {
    savePumpEntry(id, at);
  }

  els.entryTypeInput.disabled = false;
  saveState();
  render();
  showToast(id ? "הפעולה עודכנה" : "הפעולה נוספה");
}

function saveFeedingEntry(id, startedAt) {
  const side = els.entrySideInput.value;
  const endTime = els.entryEndTimeInput.value;
  let endedAt = endTime ? normalizeEndDate(startedAt, combineDateAndTime(els.entryDateInput.value, endTime)) : "";
  const isBottle = side === "bottle";
  const hasDessert = !isBottle && els.entryDessertInput.checked;
  const dessertStartTime = els.entryDessertStartInput.value;
  const dessertEndTime = els.entryDessertEndInput.value;
  const dessertStartedAt =
    hasDessert && dessertStartTime
      ? normalizeEndDate(startedAt, combineDateAndTime(els.entryDateInput.value, dessertStartTime))
      : hasDessert
        ? endedAt || startedAt
        : "";
  const dessertEndedAt =
    hasDessert && dessertStartedAt && dessertEndTime
      ? normalizeEndDate(dessertStartedAt, combineDateAndTime(els.entryDateInput.value, dessertEndTime))
      : hasDessert && dessertStartedAt
        ? endedAt
      : "";
  if (hasDessert && dessertEndedAt && (!endedAt || new Date(dessertEndedAt) > new Date(endedAt))) {
    endedAt = dessertEndedAt;
  }
  const payload = {
    id: id || crypto.randomUUID(),
    side,
    startedAt,
    endedAt,
    amountValue: isBottle ? normalizeAmount(els.entryFeedingAmountInput.value) : "",
    amountUnit: isBottle ? els.entryFeedingUnitInput.value || "ml" : "",
    dessertSide: hasDessert ? oppositeSide(side) : "",
    dessertAt: dessertStartedAt,
    dessertStartedAt,
    dessertEndedAt,
    pauses: findEvent("feeding", id)?.pauses || [],
    createdBy: findEvent("feeding", id)?.createdBy || currentUser.id,
  };
  delete payload.autoClosed;
  delete payload.autoClosedReason;
  upsertById(state.feedings, payload);
}

function saveDiaperEntry(id, createdAt) {
  upsertById(state.diapers, {
    id: id || crypto.randomUUID(),
    type: els.entryDiaperInput.value,
    createdAt,
    createdBy: findEvent("diaper", id)?.createdBy || currentUser.id,
  });
}

function saveBottleEntry(id, createdAt) {
  upsertById(state.bottles, {
    id: id || crypto.randomUUID(),
    amountValue: normalizeAmount(els.entryAmountInput.value),
    amountUnit: els.entryAmountUnitInput.value || "ml",
    createdAt,
    createdBy: findEvent("bottle", id)?.createdBy || currentUser.id,
  });
}

function savePumpEntry(id, createdAt) {
  const storage = els.entryStorageInput.value;
  const storageDates = buildPumpStorageDates({ storage, createdAt });
  upsertById(state.pumps, {
    id: id || crypto.randomUUID(),
    pumpCode: findEvent("pump", id)?.pumpCode || createPumpCode(),
    amountValue: normalizeAmount(els.entryAmountInput.value),
    amountUnit: els.entryAmountUnitInput.value || "ml",
    storage,
    createdAt,
    recommendedUntil: storageDates.recommendedUntil,
    expiresAt: storageDates.expiresAt,
    createdBy: findEvent("pump", id)?.createdBy || currentUser.id,
  });
}

function maybeShowSleepyReminder(active) {
  if (!active || active.sleepyReminderShownAt || isBottleFeeding(active)) return;
  const elapsed = Date.now() - new Date(active.startedAt).getTime();
  const hasPause = active.pauses.length > 0;

  if (elapsed >= SLEEPY_REMINDER_MS && !hasPause) {
    active.sleepyReminderShownAt = new Date().toISOString();
    touchRecord(active);
    saveState();
    vibrate([80, 80, 80]);
    openModal(els.sleepyDialog);
  }
}

function showView(viewName) {
  els.views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === viewName));
  els.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === viewName));
}

function getActiveFeeding() {
  return state.feedings.find((feeding) => !feeding.endedAt);
}

function getLatestFeeding() {
  return getLatestByDate(
    state.feedings.filter((feeding) => feeding.startedAt),
    "startedAt",
  );
}

function getFeedingIntervalBaseDate(feeding) {
  return new Date(feeding.endedAt || feeding.startedAt);
}

function getLatestByDate(items, field) {
  return [...items].sort((a, b) => new Date(b[field]) - new Date(a[field]))[0];
}

function findEvent(type, id) {
  if (!id) return null;
  const collection = getCollectionForType(type);
  return collection.find((item) => item.id === id) || null;
}

function getCollectionForType(type) {
  if (type === "feeding") return state.feedings;
  if (type === "diaper") return state.diapers;
  if (type === "bottle") return state.bottles;
  return state.pumps;
}

function upsertById(collection, payload) {
  touchRecord(payload);
  const index = collection.findIndex((item) => item.id === payload.id);
  if (index >= 0) collection[index] = payload;
  else collection.unshift(payload);
  untrackDeletedEvent(collectionType(collection), payload.id);
}

function touchRecord(record) {
  if (!record) return record;
  record.updatedAt = new Date().toISOString();
  record.updatedBy = currentUser.id;
  return record;
}

function collectionType(collection) {
  if (collection === state.feedings) return "feeding";
  if (collection === state.diapers) return "diaper";
  if (collection === state.bottles) return "bottle";
  return "pump";
}

function trackDeletedEvent(type, id) {
  if (!id) return;
  const deletedAt = new Date().toISOString();
  state.deletedEvents = [
    { type, id, deletedAt, deletedBy: currentUser.id },
    ...state.deletedEvents.filter((item) => deletedKey(item.type, item.id) !== deletedKey(type, id)),
  ].slice(0, 500);
}

function untrackDeletedEvent(type, id) {
  state.deletedEvents = state.deletedEvents.filter((item) => deletedKey(item.type, item.id) !== deletedKey(type, id));
}

function createResetTombstones(sourceState) {
  const deletedAt = new Date().toISOString();
  const deletedBy = currentUser.id;
  const tombstones = [
    ...sourceState.feedings.map((item) => ({ type: "feeding", id: item.id, deletedAt, deletedBy })),
    ...sourceState.diapers.map((item) => ({ type: "diaper", id: item.id, deletedAt, deletedBy })),
    ...sourceState.bottles.map((item) => ({ type: "bottle", id: item.id, deletedAt, deletedBy })),
    ...sourceState.pumps.map((item) => ({ type: "pump", id: item.id, deletedAt, deletedBy })),
    ...sourceState.deletedEvents,
  ].filter((item) => item.id);

  return mergeDeletedEvents(tombstones, []);
}

function nextStartSide(feeding) {
  if (!feeding) return "";
  if (isBottleFeeding(feeding)) return nextStartSide(getLatestBreastFeeding());
  return feeding.dessertSide || oppositeSide(feeding.side);
}

function feedingSummary(feeding) {
  if (isBottleFeeding(feeding)) {
    const pump = findEvent("pump", feeding.pumpId);
    const pumpText = pump ? ` · ${pumpCode(pump)}` : "";
    return `בקבוק${formatAmount(feeding) ? ` ${formatAmount(feeding)}` : ""}${pumpText}`;
  }
  const main = sideLabel(feeding.side);
  return feeding.dessertSide ? `${main} + קינוח ${sideLabel(feeding.dessertSide)} ${dessertDurationLabel(feeding)}`.trim() : main;
}

function feedingDurationLabel(feeding) {
  if (!feeding.startedAt) return "";
  if (!feeding.endedAt) return "פעילה עכשיו";
  const total = formatHumanDuration(new Date(feeding.endedAt) - new Date(feeding.startedAt));
  const dessertParts = feedingPhaseRows(feeding)
    .filter((phase) => phase.key !== "main")
    .map((phase) => `${phase.label} ${phase.duration}`);
  return dessertParts.length ? `${total} · ${dessertParts.join(" · ")}` : total;
}

function dessertButtonLabel(feeding, fallbackSide) {
  if (!feeding.dessertSide) return `התחלת קינוח ${sideLabel(fallbackSide)}`;
  return "סיום קינוח והנקה";
}

function dessertLiveLabel(feeding) {
  if (!feeding.dessertSide) return "";
  return `קינוח ${sideLabel(feeding.dessertSide)} ${dessertDurationLabel(feeding)}`;
}

function dessertDurationLabel(feeding) {
  const ms = dessertDurationMs(feeding);
  if (!Number.isFinite(ms)) return "";
  const status = feeding.dessertEndedAt || feeding.endedAt ? "" : "פעיל ";
  return `(${status}${formatHumanDuration(ms)})`;
}

function dessertDurationMs(feeding) {
  const startedAt = getDessertStartedAt(feeding);
  if (!startedAt) return NaN;
  const endedAt = feeding.dessertEndedAt || feeding.endedAt || new Date().toISOString();
  return new Date(endedAt) - new Date(startedAt);
}

function getDessertStartedAt(feeding) {
  return feeding?.dessertStartedAt || feeding?.dessertAt || feeding?.dessertAttemptStartedAt || "";
}

function feedingPhaseRows(feeding) {
  if (!feeding?.startedAt || isBottleFeeding(feeding)) return [];
  const rows = [];
  const dessertStartedAt = getDessertStartedAt(feeding);
  const mainEndsAt = dessertStartedAt || feeding.endedAt || new Date().toISOString();
  rows.push(createPhaseRow("main", `הנקה ${sideLabel(feeding.side)}`, feeding.startedAt, mainEndsAt));

  if (feeding.dessertSide) {
    const dessertEndedAt = feeding.dessertEndedAt || feeding.endedAt || "";
    if (dessertStartedAt && dessertEndedAt) {
      rows.push(createPhaseRow("dessert", `קינוח ${sideLabel(feeding.dessertSide)}`, dessertStartedAt, dessertEndedAt));
    }
  }

  return rows.filter(Boolean);
}

function createPhaseRow(key, label, startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  return {
    key,
    label,
    startedAt,
    endedAt,
    range: `${formatTime(startedAt)}-${formatTime(endedAt)}`,
    duration: formatHumanDuration(new Date(endedAt) - new Date(startedAt)),
  };
}

function feedingPhaseDetailsHtml(feeding) {
  const rows = feedingPhaseRows(feeding);
  if (rows.length <= 1) return "";
  return `
    <div class="history-details">
      ${rows.map((row) => `<span>${row.label}: ${row.range} · ${row.duration}</span>`).join("")}
    </div>
  `;
}

function oppositeSide(side) {
  return side === "right" ? "left" : "right";
}

function isBottleFeeding(feeding) {
  return feeding?.side === "bottle";
}

function getLatestBreastFeeding() {
  return getLatestByDate(
    state.feedings.filter((feeding) => feeding.startedAt && !isBottleFeeding(feeding)),
    "startedAt",
  );
}

function isPumpExpired(pump) {
  return getMilkStorageStatus(pump).level === "expired";
}

function getMilkStorageRule(storage) {
  return MILK_STORAGE_RULES[storage] || MILK_STORAGE_RULES.room;
}

function milkStorageLabel(storage) {
  return getMilkStorageRule(storage).label;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function getMilkStorageLimits(pump) {
  if (!pump?.createdAt) return { recommendedAt: null, maxAt: null, rule: getMilkStorageRule(pump?.storage) };

  const createdAt = new Date(pump.createdAt);
  const rule = getMilkStorageRule(pump.storage);
  const recommendedAt = rule.recommendedMonths
    ? addMonths(createdAt, rule.recommendedMonths)
    : new Date(createdAt.getTime() + rule.recommendedMs);
  const maxAt = rule.maxMonths
    ? addMonths(createdAt, rule.maxMonths)
    : new Date(createdAt.getTime() + rule.maxMs);

  return { recommendedAt, maxAt, rule };
}

function getMilkStorageStatus(pump, at = new Date()) {
  const { recommendedAt, maxAt, rule } = getMilkStorageLimits(pump);
  if (!recommendedAt || !maxAt) return { level: "unknown", rule, recommendedAt, maxAt };

  const checkedAt = new Date(at);
  if (checkedAt.getTime() >= maxAt.getTime()) return { level: "expired", rule, recommendedAt, maxAt };
  if (checkedAt.getTime() >= recommendedAt.getTime() && recommendedAt.getTime() < maxAt.getTime()) {
    return { level: "warning", rule, recommendedAt, maxAt };
  }
  return { level: "ok", rule, recommendedAt, maxAt };
}

function getPumpExpiryAt(pump) {
  return getMilkStorageLimits(pump).maxAt;
}

function getPumpRecommendedAt(pump) {
  return getMilkStorageLimits(pump).recommendedAt;
}

function buildPumpStorageDates(pump) {
  const recommendedAt = getPumpRecommendedAt(pump);
  const expiresAt = getPumpExpiryAt(pump);
  return {
    recommendedUntil: recommendedAt ? recommendedAt.toISOString() : "",
    expiresAt: expiresAt ? expiresAt.toISOString() : "",
  };
}

function getPumpOptions() {
  return [...state.pumps]
    .filter((pump) => isPumpAvailable(pump))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createPumpCode() {
  return `S${new Date().toISOString().slice(5, 10).replace("-", "")}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function pumpCode(pump) {
  if (!pump) return "";
  if (pump.pumpCode) return pump.pumpCode;
  return `S-${String(pump.id || "").slice(0, 5).toUpperCase()}`;
}

function pumpOptionLabel(pump) {
  const parts = [pumpCode(pump), formatDateOnly(pump.createdAt), formatTime(pump.createdAt)];
  const amount = formatAmount(pump);
  if (amount) parts.push(amount);
  const remaining = formatPumpRemaining(pump);
  if (remaining) parts.push(`נשאר ${remaining}`);
  parts.push(milkStorageLabel(pump.storage));
  return parts.join(" · ");
}

function evaluatePumpWarnings(pump, at = new Date()) {
  if (!pump) return ["לא נבחרה שאיבה."];
  const status = getMilkStorageStatus(pump, at);
  const note = status.rule.note ? ` ${status.rule.note}` : "";
  if (status.level === "expired") {
    return [
      `אזהרה חמורה: ${status.rule.label} עבר את משך האחסון האפשרי (${status.rule.maxLabel}). לא מומלץ לתת בבקבוק.${note}`,
    ];
  }
  if (status.level === "warning") {
    return [
      `אזהרה: ${status.rule.label} עבר את משך האחסון המומלץ (${status.rule.recommendedLabel}) ועדיין בתוך הטווח האפשרי (${status.rule.maxLabel}).${note}`,
    ];
  }
  return [];
}

function evaluateBottleWarnings(feeding) {
  if (!isBottleFeeding(feeding)) return [];
  const pump = findEvent("pump", feeding.pumpId);
  if (!pump) return ["אזהרה: הבקבוק לא מקושר לשאיבה."];
  return evaluatePumpWarnings(pump, new Date(feeding.startedAt || feeding.endedAt || Date.now()));
}

function formatMilkStorageStatus(pump) {
  const status = getMilkStorageStatus(pump);
  if (status.level === "unknown") return milkStorageLabel(pump?.storage);
  if (status.level === "expired") return "פג תוקף";
  if (status.level === "warning") return `עבר מומלץ · אפשרי עד ${formatDateOnly(status.maxAt)} ${formatTime(status.maxAt)}`;
  return `בתוקף עד ${formatDateOnly(status.maxAt)} ${formatTime(status.maxAt)}`;
}

function validateBottleAmountAgainstPump(pump, amount, unit, excludeFeedingId = "") {
  if (!pump) return "צריך לבחור שאיבה לבקבוק.";
  const amountNumber = Number(String(amount || "").replace(",", "."));
  if (!amount || !Number.isFinite(amountNumber)) return "";
  if (amountUnit(pump) !== unit) {
    return `היחידה חייבת להתאים לשאיבה: ${amountUnitLabel(amountUnit(pump))}.`;
  }
  const remaining = getPumpRemaining(pump, excludeFeedingId);
  if (remaining !== null && amountNumber > remaining) {
    return `אי אפשר לרשום יותר מהיתרה בשאיבה הזו: ${formatPumpRemaining(pump, excludeFeedingId)}.`;
  }
  return "";
}

function isPumpAvailable(pump) {
  const remaining = getPumpRemaining(pump);
  return remaining === null || remaining > 0;
}

function getPumpRemaining(pump, excludeFeedingId = "") {
  const total = numericAmount(pump);
  if (total === null) return null;
  return Math.max(0, total - getPumpUsedAmount(pump, excludeFeedingId));
}

function getPumpUsedAmount(pump, excludeFeedingId = "") {
  const unit = amountUnit(pump);
  const feedingUsed = state.feedings
    .filter((feeding) => isBottleFeeding(feeding) && feeding.pumpId === pump.id && feeding.id !== excludeFeedingId)
    .reduce((sum, feeding) => sum + comparableAmount(feeding, unit), 0);
  const standaloneBottleUsed = state.bottles
    .filter((bottle) => bottle.pumpId === pump.id)
    .reduce((sum, bottle) => sum + comparableAmount(bottle, unit), 0);
  return feedingUsed + standaloneBottleUsed;
}

function numericAmount(item) {
  const value = amountValue(item).replace(",", ".");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function comparableAmount(item, unit) {
  if (amountUnit(item) !== unit) return 0;
  return numericAmount(item) ?? 0;
}

function formatPumpRemaining(pump, excludeFeedingId = "") {
  const remaining = getPumpRemaining(pump, excludeFeedingId);
  if (remaining === null) return "";
  return `${formatNumber(remaining)} ${amountUnitLabel(amountUnit(pump))}`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function normalizeAmount(value) {
  return String(value ?? "").trim();
}

function amountValue(item) {
  if (!item) return "";
  return normalizeAmount(item.amountValue ?? item.amountMl ?? "");
}

function amountUnit(item) {
  if (!item) return "ml";
  return item.amountUnit || (item.amountMl ? "ml" : "ml");
}

function amountUnitLabel(unit) {
  if (unit === "oz") return "oz";
  if (unit === "spoon") return "כפיות";
  if (unit === "other") return "אחר";
  return "מ״ל";
}

function formatAmount(item) {
  const value = amountValue(item);
  if (!value) return "";
  return `${value} ${amountUnitLabel(amountUnit(item))}`;
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
    "סוג פעולה": isBottleFeeding(feeding) ? "בקבוק" : "הנקה",
    "פירוט": feedingSummary(feeding),
    "שאיבה מקושרת": isBottleFeeding(feeding) && feeding.pumpId ? pumpCode(findEvent("pump", feeding.pumpId)) : "",
    "תאריך": formatDateOnly(feeding.startedAt),
    "שעת התחלה": formatTime(feeding.startedAt),
    "שעת סיום": feeding.endedAt ? formatTime(feeding.endedAt) : "",
    "משך": feedingDurationLabel(feeding),
    "פירוט זמנים": feedingPhaseRows(feeding).map((phase) => `${phase.label}: ${phase.range} (${phase.duration})`).join(" | "),
    "כמות": formatAmount(feeding),
    "תוקף": "",
    "אזהרה": feeding.autoClosed ? "נסגר אוטומטית אחרי 20 דקות. האם שכחתם לסגור?" : evaluateBottleWarnings(feeding)[0] || "",
    "נוצר על ידי": feeding.createdBy || "",
  }));
  const diaperRows = state.diapers.map((diaper) => ({
    _sortAt: diaper.createdAt,
    "סוג פעולה": "חיתול",
    "פירוט": diaperLabel(diaper.type),
    "שאיבה מקושרת": "",
    "תאריך": formatDateOnly(diaper.createdAt),
    "שעת התחלה": formatTime(diaper.createdAt),
    "שעת סיום": "",
    "משך": "",
    "כמות": "",
    "תוקף": "",
    "אזהרה": "",
    "נוצר על ידי": diaper.createdBy || "",
  }));
  const bottleRows = state.bottles.map((bottle) => ({
    _sortAt: bottle.createdAt,
    "סוג פעולה": "בקבוק",
    "פירוט": "בקבוק שאוב",
    "שאיבה מקושרת": bottle.pumpId ? pumpCode(findEvent("pump", bottle.pumpId)) : "",
    "תאריך": formatDateOnly(bottle.createdAt),
    "שעת התחלה": formatTime(bottle.createdAt),
    "שעת סיום": "",
    "משך": "",
    "כמות": formatAmount(bottle),
    "תוקף": "",
    "אזהרה": bottle.pumpId ? evaluatePumpWarnings(findEvent("pump", bottle.pumpId), new Date(bottle.createdAt))[0] || "" : "",
    "נוצר על ידי": bottle.createdBy || "",
  }));
  const pumpRows = state.pumps.map((pump) => ({
    _sortAt: pump.createdAt,
    "סוג פעולה": "שאיבה",
    "פירוט": `${pumpCode(pump)} · ${milkStorageLabel(pump.storage)}`,
    "שאיבה מקושרת": pumpCode(pump),
    "תאריך": formatDateOnly(pump.createdAt),
    "שעת התחלה": formatTime(pump.createdAt),
    "שעת סיום": "",
    "משך": "",
    "כמות": formatAmount(pump),
    "תוקף": formatMilkStorageStatus(pump),
    "אזהרה": evaluatePumpWarnings(pump)[0] || "",
    "נוצר על ידי": pump.createdBy || "",
  }));

  return [...feedingRows, ...diaperRows, ...bottleRows, ...pumpRows].sort((a, b) => new Date(b._sortAt) - new Date(a._sortAt));
}

function toCsv(rows) {
  const headers = ["סוג פעולה", "פירוט", "שאיבה מקושרת", "תאריך", "שעת התחלה", "שעת סיום", "משך", "פירוט זמנים", "כמות", "תוקף", "אזהרה", "נוצר על ידי"];
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

function sideLabel(side) {
  if (side === "bottle") return "בקבוק";
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

function setDurationText(element, value) {
  if (!element) return;

  const text = String(value);
  element.textContent = text;
  element.classList.toggle("is-long-duration", text.length >= 9);
  element.classList.toggle("is-extra-long-duration", text.length >= 11);
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

function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toTimeInputValue(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function combineDateAndTime(dateValue, timeValue) {
  const date = dateValue || toDateInputValue(new Date());
  const time = timeValue || toTimeInputValue(new Date());
  return new Date(`${date}T${time}:00`).toISOString();
}

function normalizeEndDate(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (end < start) end.setDate(end.getDate() + 1);
  return end.toISOString();
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

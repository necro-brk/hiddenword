/**************************************************
 * Hidden Word – Çok modlu kelime oyunu
 * Bu dosyayı script.js olarak kaydet.
 **************************************************/

/* ================== GLOBAL KONSTANTLAR ================== */
const DEBUG = false;
const dlog = (...args) => { if (DEBUG) console.log(...args); };

const NAME_KEY  = "hiddenWordPlayerName_v2";
const THEME_KEY = "hiddenWordTheme_v1";
const LB_PREFIX = "hiddenWordLB_";

const DEFAULT_THEME = {
  keyboardColor: "#111827",
  tileCorrect:   "#16a34a",
  tilePresent:   "#eab308",
  tileAbsent:    "#111827",

// ===== Solo bitiş popup butonları =====
const endModal = document.getElementById("endgame-modal");
const btnNewSolo = document.getElementById("endgame-new-solo");
const btnClose = document.getElementById("endgame-close");
  const btnClose2 = document.getElementById("endgame-close-2");

if (btnNewSolo) {
  btnNewSolo.addEventListener("click", () => {
    restartSoloSameMode();
  });
}
if (btnClose) {
  btnClose.addEventListener("click", () => {
    hideEndgameModal();
  });
}
// Overlay dışına tıklayınca kapat
if (endModal) {
  endModal.addEventListener("click", (e) => {
    if (e.target === endModal) hideEndgameModal();
  });
}

};

/* ================== GLOBAL STATE ================== */

let CURRENT_SCREEN     = "screen-home";
let CURRENT_GAME_TYPE  = null;   // "solo", "duel-create", "duel-guess", "group"
let CURRENT_MODE       = "5";    // string olarak harf sayısı: "3".."8"
let CURRENT_ROOM       = null;   // Grup modu oda kodu
let CURRENT_CONTEXT_ID = "default"; // Leaderboard context
let FIREBASE_DB        = null;   // 🔥 Realtime Database referansı

let SECRET_WORD = "";

let ROWS = 6;
let COLS = 5;

let tiles        = [];
let currentRow   = 0;
let currentCol   = 0;
let finished     = false;
let keyButtons   = {};
let keyState     = {};
let keydownHandler = null;

let WORD_SET      = null;
let CURRENT_THEME = { ...DEFAULT_THEME };
let LEADERBOARD_DATA = [];

let playerNameCache = "";

/* ================== FIREBASE YARDIMCI FONKSİYONLAR ================== */

function initFirebaseDb() {
  try {
    if (typeof firebase !== "undefined") {
      FIREBASE_DB = firebase.database();
      dlog("Firebase DB hazır");
    } else {
      console.warn("firebase globali yok (index.html'deki script sırasını kontrol et)");
    }
  } catch (e) {
    console.warn("Firebase başlatılamadı:", e);
  }
}

function getFirebaseLbPath(contextId) {
  const ctx = contextId || "default";
  return "leaderboard/" + ctx;
}

function saveScoreToFirebase(item, contextId) {
  if (!FIREBASE_DB) return;
  const path = getFirebaseLbPath(contextId);
  FIREBASE_DB.ref(path).push(item).catch(err => {
    console.warn("Firebase'e skor yazılamadı:", err);
  });
}

function subscribeLeaderboardFromFirebase(contextId) {
  if (!FIREBASE_DB) return;
  const key  = getLBKey(contextId);
  const path = getFirebaseLbPath(contextId);

  FIREBASE_DB.ref(path).on("value", snapshot => {
    const val  = snapshot.val() || {};
    const rows = Object.values(val);

    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.ts || 0) - (b.ts || 0);
    });

    LEADERBOARD_DATA = rows;
    renderLeaderboard(rows);

    try {
      localStorage.setItem(key, JSON.stringify(rows));
    } catch (e) {
      console.warn("Local leaderboard güncellenemedi:", e);
    }
  });
}

function getRoomPath(code) {
  return "rooms/" + code;
}

/* ================== TÜRKÇE BÜYÜK HARF DÖNÜŞTÜRME ================== */

function trUpper(str) {
  return str
    .replace(/i/g, "İ")
    .replace(/ı/g, "I")
    .toUpperCase();
}

function trUpperChar(ch) {
  if (!ch) return "";
  if (ch === "i") return "İ";
  if (ch === "ı") return "I";
  return trUpper(ch).charAt(0);
}

/* ================== KELİME SÖZLÜĞÜ ================== */

function ensureWordSet() {
  if (WORD_SET) return;

  if (typeof VALID_WORDS === "undefined") {
    console.warn("VALID_WORDS tanımlı değil, sözlük boş.");
    WORD_SET = new Set();
    return;
  }

  if (VALID_WORDS instanceof Set) {
    WORD_SET = new Set(Array.from(VALID_WORDS).map(trUpper));
    return;
  }

  if (Array.isArray(VALID_WORDS)) {
    WORD_SET = new Set(VALID_WORDS.map(trUpper));
    return;
  }

  console.warn("VALID_WORDS beklenmeyen formatta, sözlük boş.");
  WORD_SET = new Set();
}

/**
 * modeValue: "3","4","5","6","7","8" gibi string
 * O harf sayısına göre rastgele kelime döndürür.
 */
function pickRandomWord(modeValue) {
  ensureWordSet();
  const all = Array.from(WORD_SET);
  if (!all.length) return "HATA";

  const targetLen = parseInt(modeValue, 10); // 3..8 gibi
  let candidates = all;

  // Önce sözlükte gerçekten bu uzunlukta olan kelimeleri bulmaya çalış
  if (!Number.isNaN(targetLen)) {
    candidates = all.filter(w => w.length === targetLen);
  }

  // Hiç yoksa tüm sözlükten seçeceğiz ama yine de uzunluğu zorlayacağız
  if (!candidates.length) {
    console.warn("Bu uzunlukta kelime bulunamadı, tüm sözlükten seçiliyor:", targetLen);
    candidates = all;
  }

  // Rastgele bir kelime seç
  let word = candidates[Math.floor(Math.random() * candidates.length)] || "HATA";

  // Türkçe upper + gereksiz karakter temizliği
  word = trUpper(word).replace(/[^A-ZÇĞİÖŞÜI]/g, "");

  // Seçilen moda göre uzunluğu ZORUNLU yap
  if (!Number.isNaN(targetLen)) {
    if (word.length > targetLen) {
      word = word.slice(0, targetLen);
    } else if (word.length < targetLen) {
      while (word.length < targetLen) {
        word += "A";
      }
    }
  }

  dlog("Seçilen mod:", modeValue, "Kelime:", word, "Uzunluk:", word.length);
  return word;
}

/* ================== URL PARAM / ENCODE-DECODE ================== */

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

// (Eski code/encode sistemi kaldırıldı: Düello artık Firebase duels/<KOD> üzerinden çalışıyor.)

/* ================== EKRAN GEÇİŞLERİ ================== */

function showScreen(id) {
  const prev = document.getElementById(CURRENT_SCREEN);
  if (prev) {
    prev.classList.remove("screen-active");
    prev.classList.add("screen-hidden");
  }
  const next = document.getElementById(id);
  if (next) {
    next.classList.remove("screen-hidden");
    next.classList.add("screen-active");
  }
  CURRENT_SCREEN = id;
}

/* ================== OYUNCU ADI ================== */

function getPlayerName() {
  if (playerNameCache) return playerNameCache;
  const stored = localStorage.getItem(NAME_KEY);
  if (stored) {
    playerNameCache = stored;
    return stored;
  }
  let name = prompt("Kullanıcı adını yaz (leaderboard için):", "") || "İsimsiz";
  name = name.trim() || "İsimsiz";
  playerNameCache = name;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

function changePlayerName() {
  const now = getPlayerName();
  let name = prompt("Yeni kullanıcı adın:", now) || now;
  name = name.trim() || "İsimsiz";
  playerNameCache = name;
  localStorage.setItem(NAME_KEY, name);
  renderLeaderboard(LEADERBOARD_DATA);
}

/* ================== TEMA / AYARLAR ================== */

function applyTheme(theme) {
  CURRENT_THEME = { ...DEFAULT_THEME, ...theme };

  const root = document.documentElement;
  root.style.setProperty("--key-bg",       CURRENT_THEME.keyboardColor);
  root.style.setProperty("--tile-correct", CURRENT_THEME.tileCorrect);
  root.style.setProperty("--tile-present", CURRENT_THEME.tilePresent);
  root.style.setProperty("--tile-absent",  CURRENT_THEME.tileAbsent);
}

function loadThemeFromStorage() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) {
      applyTheme(DEFAULT_THEME);
      return;
    }
    const theme = JSON.parse(raw);
    applyTheme(theme || DEFAULT_THEME);
  } catch (e) {
    console.warn("Tema okunamadı, varsayılana dönülüyor:", e);
    applyTheme(DEFAULT_THEME);
  }
}

function loadSettingsIntoUI() {
  const kb = document.getElementById("set-keyboard-color");
  const c  = document.getElementById("set-correct-color");
  const p  = document.getElementById("set-present-color");
  const a  = document.getElementById("set-absent-color");

  if (!kb || !c || !p || !a) return;

  kb.value = CURRENT_THEME.keyboardColor || DEFAULT_THEME.keyboardColor;
  c.value  = CURRENT_THEME.tileCorrect   || DEFAULT_THEME.tileCorrect;
  p.value  = CURRENT_THEME.tilePresent   || DEFAULT_THEME.tilePresent;
  a.value  = CURRENT_THEME.tileAbsent    || DEFAULT_THEME.tileAbsent;
}

function saveSettingsFromUI() {
  const kb = document.getElementById("set-keyboard-color");
  const c  = document.getElementById("set-correct-color");
  const p  = document.getElementById("set-present-color");
  const a  = document.getElementById("set-absent-color");

  const theme = {
    keyboardColor: kb.value || DEFAULT_THEME.keyboardColor,
    tileCorrect:   c.value  || DEFAULT_THEME.tileCorrect,
    tilePresent:   p.value  || DEFAULT_THEME.tilePresent,
    tileAbsent:    a.value  || DEFAULT_THEME.tileAbsent,
  };

  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  applyTheme(theme);
}

/* ================== LEADERBOARD (LOCAL + ONLINE) ================== */

function getLBKey(contextId) {
  return LB_PREFIX + (contextId || "default");
}

function loadLeaderboard(contextId) {
  // 🔒 Sadece grup modunda leaderboard aktif
  if (CURRENT_GAME_TYPE !== "group") return;
  const key = getLBKey(contextId);
  let arr = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) arr = JSON.parse(raw) || [];
  } catch (e) {
    console.warn("Leaderboard okunamadı:", e);
  }

  // Önce local'dekini göster (offline destek)
  arr.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.ts || 0) - (b.ts || 0);
  });
  LEADERBOARD_DATA = arr;
  renderLeaderboard(arr);

  // 🔥 Firebase'ten gerçek zamanlı dinle
  subscribeLeaderboardFromFirebase(contextId);
}

function saveScoreToLeaderboard(name, score, attempts, wordLength, contextId) {
  const key  = getLBKey(contextId);
  const item = { name, score, attempts, wordLength, ts: Date.now() };
  let arr    = LEADERBOARD_DATA.slice();
  arr.push(item);
  arr.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.ts || 0) - (b.ts || 0);
  });
  LEADERBOARD_DATA = arr;
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.warn("Leaderboard yazılamadı:", e);
  }
  renderLeaderboard(arr);

  // 🔥 Online kaydı da yap
  saveScoreToFirebase(item, contextId);
}

function renderLeaderboard(rows) {
  const tbody = document.getElementById("lb-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="lb-placeholder">Bu mod için henüz skor yok.</td></tr>';
    return;
  }
  rows.forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${item.name || "İsimsiz"}</td>
      <td style="text-align:right;">${item.score}</td>
      <td style="text-align:right;">${item.attempts}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ================== SOLO BİTİŞ POPUP ================== */
function showSoloLoseModal(secretWord) {
  const overlay = document.getElementById("endgame-modal");
  const wordEl  = document.getElementById("endgame-word");
  if (!overlay || !wordEl) return;

  wordEl.textContent = secretWord || "";
  overlay.classList.add("is-open");
}

function hideEndgameModal() {
  const overlay = document.getElementById("endgame-modal");
  if (!overlay) return;
  overlay.classList.remove("is-open");
}

function restartSoloSameMode() {
  const targetLen = parseInt(CURRENT_MODE, 10) || 5;
  const modeStr   = String(targetLen);

  let word = pickRandomWord(modeStr);
  word = trUpper(word).replace(/[^A-ZÇĞİÖŞÜI]/g, "");

  if (word.length > targetLen) {
    word = word.slice(0, targetLen);
  } else {
    while (word.length < targetLen) word += "A";
  }

  const contextId = `solo:${modeStr}`;

  const badgeMode = document.getElementById("badge-game-mode");
  const badgeRoom = document.getElementById("badge-room-info");
  if (badgeMode) badgeMode.textContent = `Solo · ${targetLen} harfli`;
  if (badgeRoom) badgeRoom.textContent = "";

  hideEndgameModal();
  resetGameState(word, contextId);
  setLeaderboardVisible(false);
  showScreen("screen-game");
}

function setLeaderboardVisible(isVisible) {
  const panel = document.getElementById("leaderboard-panel");
  if (!panel) return;
  panel.style.display = isVisible ? "block" : "none";
}

/* ================== OYUN DURUMU & BOARD ================== */

function resetGameState(secretWord, contextId) {
  SECRET_WORD        = secretWord;
  COLS               = SECRET_WORD.length;
  ROWS               = 6;
  tiles              = [];
  currentRow         = 0;
  currentCol         = 0;
  finished           = false;
  keyButtons         = {};
  keyState           = {};
  CURRENT_CONTEXT_ID = contextId || "default";

  const boardElem = document.getElementById("board");
  boardElem.style.setProperty("--cols", COLS);
  boardElem.innerHTML = "";

  for (let r = 0; r < ROWS; r++) {
    tiles[r] = [];
    for (let c = 0; c < COLS; c++) {
      const tile  = document.createElement("div");
      tile.className = "tile";
      const inner = document.createElement("div");
      inner.className = "tile-inner";
      inner.textContent = "";
      tile.appendChild(inner);
      boardElem.appendChild(tile);
      tiles[r][c] = tile;
    }
  }

  buildKeyboard();
  attachKeydown();
  setStatus("Kelimeyi tahmin etmeye başla!", "#e5e7eb");
}

function setStatus(message, color) {
  const statusElem = document.getElementById("status");
  if (!statusElem) return;
  statusElem.textContent = message || "";
  statusElem.style.color = color || "#e5e7eb";
}

/* ================== KLAVYE ================== */

function buildKeyboard() {
  const keyboardElem = document.getElementById("keyboard");
  keyboardElem.innerHTML = "";
  keyButtons = {};
  keyState   = {};

  const layout = [
    "QWERTYUIOPĞÜ",
    "ASDFGHJKLŞİ",
    "ZXCVBNMÖÇ"
  ];

  layout.forEach((row, idx) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "kb-row";

    if (idx === 2) {
      const enterBtn = createKey("ENTER", "ENTER", true);
      rowDiv.appendChild(enterBtn);
    }

    for (const ch of row) {
      const btn = createKey(ch, ch, false);
      rowDiv.appendChild(btn);
      keyButtons[ch] = btn;
    }

    if (idx === 2) {
      const backBtn = createKey("⌫", "BACK", true);
      rowDiv.appendChild(backBtn);
    }

    keyboardElem.appendChild(rowDiv);
  });
}

function createKey(label, value, isSpecial) {
  const btn = document.createElement("button");
  btn.className = "key" + (isSpecial ? " special" : "");
  btn.textContent = label;
  btn.dataset.value = value;
  btn.addEventListener("click", () => handleKey(value));
  return btn;
}

function attachKeydown() {
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler);
  }
  keydownHandler = (e) => {
    if (finished) return;
    const key = e.key;
    if (key === "Enter") {
      handleKey("ENTER");
    } else if (key === "Backspace") {
      handleKey("BACK");
    } else {
      const ch = trUpperChar(key);
      if (/^[A-ZÇĞİÖŞÜI]$/.test(ch)) {
        handleKey(ch);
      }
    }
  };
  window.addEventListener("keydown", keydownHandler);
}

function detachKeydown() {
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
}

/* ================== KLAVYE / GİRİŞ İŞLEME ================== */

function handleKey(key) {

  if (!GAME_ACTIVE) {
    setStatus("Şu an oyun kapalı.", "#f97316");
    return;
  }

  if (finished) return;


  if (key === "ENTER") {
    submitGuess();
    return;
  }
  if (key === "BACK") {
    if (currentCol > 0) {
      currentCol--;
      setTile(currentRow, currentCol, "");
    }
    return;
  }

  if (currentCol >= COLS) return;
  setTile(currentRow, currentCol, key);
  currentCol++;
}

function setTile(r, c, ch) {
  const tile  = tiles[r][c];
  const inner = tile.querySelector(".tile-inner");
  inner.textContent = ch;
  if (ch) tile.classList.add("tile-filled");
  else tile.classList.remove("tile-filled");
}

function getCurrentGuess() {
  let guess = "";
  for (let c = 0; c < COLS; c++) {
    const ch = tiles[currentRow][c].querySelector(".tile-inner").textContent || "";
    guess += ch;
  }
  return guess;
}

/* ================== TAHMİN DEĞERLENDİRME ================== */

function submitGuess() {

  if (!GAME_ACTIVE) {
    setStatus("Oyun şu an kapalı. Admin açtığında oynayabilirsin.", "#f97316");
    return;
  }
  if (finished) return;

  const rawGuess = getCurrentGuess();
  if (rawGuess.length < COLS) {
    setStatus(`Kelime eksik. Bu kelime ${COLS} harfli.`, "#f97316");
    return;
  }

  const upperGuess = trUpper(rawGuess);

  if (upperGuess !== SECRET_WORD) {
    ensureWordSet();
    if (!WORD_SET.has(upperGuess)) {
      setStatus("Bu kelime sözlükte yok gibi görünüyor.", "#f97316");
      return;
    }
  }

  const result = evaluateGuess(upperGuess, SECRET_WORD);
  colorRow(currentRow, upperGuess, result);

  if (upperGuess === SECRET_WORD) {
    const attempts = currentRow + 1;
    const base = 1200;
    const score = Math.max(
      10,
      base - (attempts - 1) * 150 - (SECRET_WORD.length - 3) * 20
    );
    const name = getPlayerName();

    // ✅ Leaderboard sadece Grup Yarışı modunda
    if (CURRENT_GAME_TYPE === "group") {
      saveScoreToLeaderboard(
        name,
        score,
        attempts,
        SECRET_WORD.length,
        CURRENT_CONTEXT_ID
      );
    }

    setStatus(`Tebrikler, kelimeyi buldun! 🎉 Skorun: ${score}`, "#22c55e");
    finished = true;
    return;
  }

  if (currentRow === ROWS - 1) {
    if (CURRENT_GAME_TYPE === "solo") {
      showSoloLoseModal(SECRET_WORD);
    }
    setStatus(`Bitti! Gizli kelime: ${SECRET_WORD}`, "#f97316");
    finished = true;
    return;
  }

  currentRow++;
  currentCol = 0;
  setStatus("Yeni bir tahmin yap!");
}


function evaluateGuess(guess, secret) {
  const res       = Array(COLS).fill("absent");
  const secretArr = secret.split("");
  const used      = new Array(COLS).fill(false);

  for (let i = 0; i < COLS; i++) {
    if (guess[i] === secret[i]) {
      res[i]  = "correct";
      used[i] = true;
    }
  }

  for (let i = 0; i < COLS; i++) {
    if (res[i] === "correct") continue;
    const ch = guess[i];
    let found = false;
    for (let j = 0; j < COLS; j++) {
      if (!used[j] && secretArr[j] === ch) {
        used[j] = true;
        found = true;
        break;
      }
    }
    if (found) res[i] = "present";
  }

  return res;
}

function colorRow(rowIndex, guess, result) {
  for (let c = 0; c < COLS; c++) {
    const tile = tiles[rowIndex][c];
    tile.classList.remove("tile-filled", "tile-correct", "tile-present", "tile-absent");

    const state = result[c];
    tile.classList.add("tile-" + state);

    const ch   = guess[c];
    const prev = keyState[ch];
    if (!prev || prev === "absent" || (prev === "present" && state === "correct")) {
      keyState[ch] = state;
      const btn = keyButtons[ch];
      if (btn) {
        btn.classList.remove("key-correct", "key-present", "key-absent");
        if (state === "correct")      btn.classList.add("key-correct");
        else if (state === "present") btn.classList.add("key-present");
        else                          btn.classList.add("key-absent");
      }
    }
  }
}

/* ================== MOD BAŞLATMA FONKSİYONLARI ================== */
/* ---- SOLO MOD ---- */

function startSoloFromCreator() {
  const modeSelect = document.getElementById("mode-select");
  const modeStr    = modeSelect ? modeSelect.value : "5"; // "3","4","5","6","7","8"
  const targetLen  = parseInt(modeStr, 10) || 5;

  // Sözlükten kelime çek
  let word = pickRandomWord(modeStr);

  // Her ihtimale karşı temizle + zorunlu olarak seçilen uzunluğa ayarla
  word = trUpper(word).replace(/[^A-ZÇĞİÖŞÜI]/g, "");

  if (word.length > targetLen) {
    word = word.slice(0, targetLen);
  } else {
    while (word.length < targetLen) {
      word += "A";
    }
  }

  CURRENT_MODE = String(targetLen);
  const contextId = `solo:${CURRENT_MODE}`;

  const badgeMode = document.getElementById("badge-game-mode");
  const badgeRoom = document.getElementById("badge-room-info");
  if (badgeMode) {
    badgeMode.textContent = `Solo · ${targetLen} harfli`;
  }
  if (badgeRoom) {
    badgeRoom.textContent = "";
  }

  resetGameState(word, contextId);
  setLeaderboardVisible(false);
  showScreen("screen-game");
}

/* ---- DÜELLO MODU (LINK OLUŞTURMA) ---- */

function createDuelLink() {
  const secretInput = document.getElementById("secret-input");
  const linkWrap    = document.getElementById("generated-link-wrap");
  const linkInput   = document.getElementById("generated-link");

  if (!secretInput || !linkWrap || !linkInput) return;

  let word = (secretInput.value || "").trim();
  if (!word) {
    alert("Lütfen bir gizli kelime yaz.");
    return;
  }

  word = trUpper(word.replace(/\s+/g, ""));
  if (!/^[A-ZÇĞİÖŞÜI]+$/.test(word) || word.length < 2) {
    alert("Geçerli bir kelime gir (yalnızca harf, en az 2 harf).");
    return;
  }

  if (!FIREBASE_DB) {
    alert("Sunucu bağlantısı yok (Firebase yok).");
    return;
  }

  // 🔥 Kısa düello kodu üret: duels/<KOD> altına yazacağız
  const makeCode = () => generateRoomCode(); // 5 karakter

  const tryCreate = async (attempt = 0) => {
    if (attempt >= 6) throw new Error("Düello kodu üretilemedi (çok fazla çakışma).");

    const duelCode = makeCode();
    const path = "duels/" + duelCode;

    // Çakışma kontrolü
    const snap = await FIREBASE_DB.ref(path).once("value");
    if (snap.exists()) return tryCreate(attempt + 1);

    await FIREBASE_DB.ref(path).set({
      secretWord: word,
      createdAt: Date.now()
    });

    const url = `${location.origin}${location.pathname}?duel=${encodeURIComponent(duelCode)}`;
    // ✅ Kullanıcıya sadece 5 haneli KOD göster (Grup modu gibi)
    linkInput.value = duelCode;
    // (İsteğe bağlı) Linki gizli olarak dataset'te tut
    linkInput.dataset.duelUrl = url;
    linkWrap.style.display = "block";
  };

  tryCreate().catch(err => {
    console.warn("Düello odası oluşturulamadı:", err);
    alert("Düello oluşturulurken hata oluştu.");
  });
}


/* ---- DÜELLO MODU (LINK İLE GİRENLER) ---- */

function handleDuelloLinkIfAny() {
  const duelCode = getQueryParam("duel");
  if (!duelCode) return;

  if (!FIREBASE_DB) {
    alert("Sunucu bağlantısı yok (Firebase yok).");
    return;
  }

  const code = String(duelCode).trim().toUpperCase();
  const path = "duels/" + code;

  FIREBASE_DB.ref(path).once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data || !data.secretWord) {
      alert("Geçersiz veya süresi dolmuş düello kodu.");
      return;
    }

    const secretWord = trUpper(String(data.secretWord)).replace(/\s+/g, "");
    if (!/^[A-ZÇĞİÖŞÜI]+$/.test(secretWord) || secretWord.length < 2) {
      alert("Düello verisi bozuk (geçersiz kelime).");
      return;
    }

    CURRENT_MODE      = String(secretWord.length);
    CURRENT_GAME_TYPE = "duel-guess";

    const contextId = `duel:${code}`;

    const badgeMode = document.getElementById("badge-game-mode");
    const badgeRoom = document.getElementById("badge-room-info");
    if (badgeMode) {
      badgeMode.textContent = `Düello · ${secretWord.length} harfli`;
    }
    if (badgeRoom) {
      badgeRoom.textContent = `Düello kodu: ${code}`;
    }

    resetGameState(secretWord, contextId);
    setLeaderboardVisible(false);
    showScreen("screen-game");
  }).catch(err => {
    console.warn("Düello verisi okunamadı:", err);
    alert("Düello açılırken hata oluştu.");
  });
}

function joinDuelByCode() {
  const input = document.getElementById("duel-join-code");
  if (!input) return;

  let duelCode = (input.value || "").trim();

  // Kullanıcı yanlışlıkla tam URL yapıştırdıysa ?duel=... kısmını çek
  if (/^https?:\/\//i.test(duelCode)) {
    try {
      const u = new URL(duelCode);
      const extracted = u.searchParams.get("duel");
      if (extracted) duelCode = extracted.trim();
    } catch (e) {
      // URL parse edilemezse olduğu gibi kalır
    }
  }

  duelCode = duelCode.toUpperCase();
  if (!duelCode) {
    alert("Geçerli bir düello kodu gir.");
    return;
  }

  if (!FIREBASE_DB) {
    alert("Sunucu bağlantısı yok (Firebase yok).");
    return;
  }

  const path = "duels/" + duelCode;

  FIREBASE_DB.ref(path).once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data || !data.secretWord) {
      alert("Bu kodla eşleşen bir düello bulunamadı.");
      return;
    }

    const secretWord = trUpper(String(data.secretWord)).replace(/\s+/g, "");
    if (!/^[A-ZÇĞİÖŞÜI]+$/.test(secretWord) || secretWord.length < 2) {
      alert("Düello verisi bozuk (geçersiz kelime).");
      return;
    }

    CURRENT_MODE      = String(secretWord.length);
    CURRENT_GAME_TYPE = "duel-guess";

    const contextId = `duel:${duelCode}`;

    const badgeMode = document.getElementById("badge-game-mode");
    const badgeRoom = document.getElementById("badge-room-info");
    if (badgeMode) {
      badgeMode.textContent = `Düello · ${secretWord.length} harfli`;
    }
    if (badgeRoom) {
      badgeRoom.textContent = `Düello kodu: ${duelCode}`;
    }

    resetGameState(secretWord, contextId);
    setLeaderboardVisible(false);
    showScreen("screen-game");
  }).catch(err => {
    console.warn("Düello verisi okunamadı:", err);
    alert("Düelloya katılırken hata oluştu.");
  });
}


/* ---- GRUP MODU – ODA KODU ---- */

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createGroupRoom() {
  const modeSelect = document.getElementById("group-mode-select");
  const mode       = modeSelect ? modeSelect.value : "5";
  CURRENT_MODE     = mode;

  ensureWordSet();
  const word     = pickRandomWord(mode);
  const roomCode = generateRoomCode();
  CURRENT_ROOM   = roomCode;
  SECRET_WORD    = word;

  // 🔥 Oda bilgisini Firebase'e yaz
  if (FIREBASE_DB) {
    const path = getRoomPath(roomCode);
    FIREBASE_DB.ref(path).set({
      secretWord: word,
      mode: parseInt(mode, 10) || word.length,
      createdAt: Date.now()
    }).catch(err => {
      console.warn("Oda Firebase'e yazılamadı:", err);
    });
  }

  const codeElem  = document.getElementById("group-room-code");
  const resultBox = document.getElementById("group-room-result");
  if (codeElem && resultBox) {
    codeElem.textContent = roomCode;
    resultBox.classList.remove("screen-hidden");
    resultBox.style.display = "block";
  }
}

function joinGroupRoomByCode() {
  const input  = document.getElementById("join-room-code");
  const status = document.getElementById("join-room-status");
  if (!input || !status) return;

  const code = (input.value || "").trim().toUpperCase();
  if (!code || code.length < 4) {
    status.textContent = "Geçerli bir oda kodu gir.";
    status.style.color = "#f97316";
    return;
  }

  if (!FIREBASE_DB) {
    status.textContent = "Sunucuya bağlanırken hata oluştu (Firebase yok).";
    status.style.color = "#f97316";
    return;
  }

  status.textContent = "Oda aranıyor...";
  status.style.color = "#e5e7eb";

  const path = getRoomPath(code);
  FIREBASE_DB.ref(path).once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data || !data.secretWord) {
      status.textContent = "Bu kodla oluşturulmuş bir oda bulunamadı.";
      status.style.color = "#f97316";
      return;
    }

    CURRENT_ROOM = code;
    SECRET_WORD  = data.secretWord;
    CURRENT_MODE = String(data.mode || data.secretWord.length || 5);

    startGroupGame();
  }).catch(err => {
    console.warn("Oda verisi okunamadı:", err);
    status.textContent = "Odaya bağlanırken bir hata oluştu.";
    status.style.color = "#f97316";
  });
}

function startGroupGame() {
  CURRENT_GAME_TYPE = "group";
  const contextId   = `group:${CURRENT_ROOM}`;

  const badgeMode = document.getElementById("badge-game-mode");
  const badgeRoom = document.getElementById("badge-room-info");
  if (badgeMode) {
    badgeMode.textContent = `Grup · ${SECRET_WORD.length} harfli`;
  }
  if (badgeRoom) {
    badgeRoom.textContent = `Oda kodu: ${CURRENT_ROOM}`;
  }

  resetGameState(SECRET_WORD, contextId);
  setLeaderboardVisible(true);
  loadLeaderboard(contextId);
  showScreen("screen-game");
}

/* ================== UYGULAMA BAŞLATMA ================== */

/* ================== UYGULAMA BAŞLATMA ================== */

function setupUIEvents() {
  // Oyun açık mı kontrolü (ana menü için)
  function guardGameActive() {
    if (typeof GAME_ACTIVE !== "undefined" && !GAME_ACTIVE) {
      alert("Şu an oyun kapalı. Admin açtığında tekrar deneyebilirsin.");
      return false;
    }
    return true;
  }

  // Creator ekranındaki "Oyun modu" alanı (dropdown'un parent'ı)
  const modeField    =
    document.querySelector(".creator-field label[for='mode-select']")?.parentElement;

  // Düello için "kod ile giriş" alanı
  const duelJoinWrap = document.getElementById("duel-join-wrap");

  /* Ana menü */
  const btnHomeSolo     = document.getElementById("btn-home-solo");
  const btnHomeDuel     = document.getElementById("btn-home-duel");
  const btnHomeGroup    = document.getElementById("btn-home-group");
  const btnHomeSettings = document.getElementById("btn-home-settings");

  // Creator ekranındaki butonlar
  const soloStartBtnEl  = document.getElementById("solo-start-btn");
  const createLinkBtnEl = document.getElementById("create-link-btn");

  if (btnHomeSolo) {
    btnHomeSolo.addEventListener("click", () => {
      if (!guardGameActive()) return;

      CURRENT_GAME_TYPE = "solo";
      showScreen("screen-creator");

      const title = document.getElementById("creator-title");
      if (title) title.textContent = "Solo Modu";

      const secretField =
        document.querySelector(".creator-field input#secret-input")?.parentElement;
      const linkWrap = document.getElementById("generated-link-wrap");

      if (secretField)  secretField.style.display  = "none";
      if (linkWrap)     linkWrap.style.display     = "none";
      if (modeField)    modeField.style.display    = "block";   // Solo'da dropdown açık
      if (duelJoinWrap) duelJoinWrap.style.display = "none";    // Kod girişi gizli

      if (soloStartBtnEl)  soloStartBtnEl.style.display  = "block";
      if (createLinkBtnEl) createLinkBtnEl.style.display = "none";
    });
  }

  if (btnHomeDuel) {
    btnHomeDuel.addEventListener("click", () => {
      if (!guardGameActive()) return;

      CURRENT_GAME_TYPE = "duel-create";
      showScreen("screen-creator");

      const title = document.getElementById("creator-title");
      if (title) title.textContent = "Düello Modu";

      const secretField =
        document.querySelector(".creator-field input#secret-input")?.parentElement;
      const linkWrap = document.getElementById("generated-link-wrap");

      if (secretField)  secretField.style.display  = "block";
      if (linkWrap)     linkWrap.style.display     = "none";
      if (modeField)    modeField.style.display    = "none";    // Düello'da dropdown yok
      if (duelJoinWrap) duelJoinWrap.style.display = "block";   // Kod girişi görünür

      if (soloStartBtnEl)  soloStartBtnEl.style.display  = "none";
      if (createLinkBtnEl) createLinkBtnEl.style.display = "block";
    });
  }

  if (btnHomeGroup) {
    btnHomeGroup.addEventListener("click", () => {
      if (!guardGameActive()) return;
      showScreen("screen-group-menu");
    });
  }

  if (btnHomeSettings) {
    btnHomeSettings.addEventListener("click", () => {
      if (!guardGameActive()) return;
      loadSettingsIntoUI();
      showScreen("screen-settings");
    });
  }

/* Creator screen back */
const btnBackCreator = document.getElementById("btn-back-from-creator");
if (btnBackCreator) {
  btnBackCreator.addEventListener("click", () => {
    showScreen("screen-home");

    // Düello kodu alanını ana menüye dönünce gizle
    const duelJoinWrap = document.getElementById("duel-join-wrap");
    if (duelJoinWrap) {
      duelJoinWrap.style.display = "none";
    }
  });
}


  /* Group menu back */
  const btnBackGroupMenu = document.getElementById("btn-back-from-group-menu");
  if (btnBackGroupMenu) {
    btnBackGroupMenu.addEventListener("click", () => {
      showScreen("screen-home");
    });
  }

  /* Group create */
  const btnGroupCreate = document.getElementById("btn-group-create");
  if (btnGroupCreate) {
    btnGroupCreate.addEventListener("click", () => {
      const resultBox = document.getElementById("group-room-result");
      if (resultBox) resultBox.classList.add("screen-hidden");
      showScreen("screen-group-create");
    });
  }

  const btnCreateRoom = document.getElementById("btn-create-room");
  if (btnCreateRoom) {
    btnCreateRoom.addEventListener("click", () => {
      createGroupRoom();
    });
  }

  const btnCopyRoomCode = document.getElementById("btn-copy-room-code");
  if (btnCopyRoomCode) {
    btnCopyRoomCode.addEventListener("click", () => {
      const codeElem = document.getElementById("group-room-code");
      if (!codeElem) return;
      const code = codeElem.textContent || "";
      if (!code) return;
      navigator.clipboard.writeText(code).then(() => {
        btnCopyRoomCode.textContent = "Kopyalandı ✔";
        setTimeout(() => (btnCopyRoomCode.textContent = "Kodu Kopyala"), 1500);
      });
    });
  }

  const btnEnterCreatedRoom = document.getElementById("btn-enter-created-room");
  if (btnEnterCreatedRoom) {
    btnEnterCreatedRoom.addEventListener("click", () => {
      if (!SECRET_WORD || !CURRENT_ROOM) {
        alert("Önce oda oluştur.");
        return;
      }
      startGroupGame();
    });
  }

  /* Group create ekranından geri */
  const btnBackGroupCreate = document.getElementById("btn-back-from-group-create");
  if (btnBackGroupCreate) {
    btnBackGroupCreate.addEventListener("click", () => {
      showScreen("screen-group-menu");
    });
  }

  /* Group join */
  const btnGroupJoin = document.getElementById("btn-group-join");
  if (btnGroupJoin) {
    btnGroupJoin.addEventListener("click", () => {
      const status = document.getElementById("join-room-status");
      if (status) status.textContent = "";
      showScreen("screen-group-join");
    });
  }

  const btnBackGroupJoin = document.getElementById("btn-back-from-group-join");
  if (btnBackGroupJoin) {
    btnBackGroupJoin.addEventListener("click", () => {
      showScreen("screen-group-menu");
    });
  }

  const btnJoinRoomNow = document.getElementById("btn-join-room-now");
  if (btnJoinRoomNow) {
    btnJoinRoomNow.addEventListener("click", () => {
      joinGroupRoomByCode();
    });
  }

  /* Solo start */
  const soloStartBtn = document.getElementById("solo-start-btn");
  if (soloStartBtn) {
    soloStartBtn.addEventListener("click", () => {
      if (!guardGameActive()) return;
      startSoloFromCreator();
    });
  }

  /* Duel link create */
  const createLinkBtn = document.getElementById("create-link-btn");
  if (createLinkBtn) {
    createLinkBtn.addEventListener("click", () => {
      createDuelLink();
    });
  }

  const copyLinkBtn = document.getElementById("copy-link-btn");
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener("click", async () => {
      const linkInput = document.getElementById("generated-link");
      if (!linkInput) return;

      // ✅ Grup modu gibi: sadece KOD kopyala
      const code = (linkInput.value || "").trim();
      if (!code) return;

      try {
        await navigator.clipboard.writeText(code);
      } catch (e) {
        // Fallback
        linkInput.select();
        document.execCommand("copy");
      }

      copyLinkBtn.textContent = "Kopyalandı ✔";
      setTimeout(() => (copyLinkBtn.textContent = "Kopyala"), 1500);
    });
  }

  // Düello: oyun kodu ile giriş
  const btnDuelJoinNow = document.getElementById("btn-duel-join-now");
  if (btnDuelJoinNow) {
    btnDuelJoinNow.addEventListener("click", () => {
      joinDuelByCode();
    });
  }

  /* Game screen back */
  const btnBackGame = document.getElementById("btn-back-from-game");
  if (btnBackGame) {
    btnBackGame.addEventListener("click", () => {
      detachKeydown();
      showScreen("screen-home");
    
      setLeaderboardVisible(false);
});
  }

  /* Settings back & actions */
  const btnBackSettings = document.getElementById("btn-back-from-settings");
  if (btnBackSettings) {
    btnBackSettings.addEventListener("click", () => {
      showScreen("screen-home");
    });
  }

  const btnSettingsReset = document.getElementById("btn-settings-reset");
  if (btnSettingsReset) {
    btnSettingsReset.addEventListener("click", () => {
      applyTheme(DEFAULT_THEME);
      loadSettingsIntoUI();
    });
  }

  const btnSettingsSave = document.getElementById("btn-settings-save");
  if (btnSettingsSave) {
    btnSettingsSave.addEventListener("click", () => {
      saveSettingsFromUI();
      showScreen("screen-home");
    });
  }

  const changeNameBtn = document.getElementById("change-name-btn");
  if (changeNameBtn) {
    changeNameBtn.addEventListener("click", () => {
      changePlayerName();
    });
  }
}

/* ================== WINDOW LOAD ================== */

window.addEventListener("load", async () => {
  if (window.WORDS_READY) {
    try { await window.WORDS_READY; } catch (e) { console.warn(e); }
  }

  initFirebaseDb();          // 🔥 Firebase Realtime DB'yi başlat
  loadThemeFromStorage();
  setupUIEvents();
  handleDuelloLinkIfAny();
});

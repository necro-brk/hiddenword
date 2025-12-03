/**************************************************
 * Hidden Word – Çok modlu kelime oyunu
 * Bu dosyayı script.js olarak kaydet.
 **************************************************/

/* ================== GLOBAL KONSTANTLAR ================== */

const NAME_KEY  = "hiddenWordPlayerName_v2";
const THEME_KEY = "hiddenWordTheme_v1";
const LB_PREFIX = "hiddenWordLB_";

const DEFAULT_THEME = {
  keyboardColor: "#111827",
  tileCorrect:   "#16a34a",
  tilePresent:   "#eab308",
  tileAbsent:    "#111827",
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

// Skor istatistikleri
let gameStartTime    = 0;  // oyunun başlangıç zamanı (ms)
let totalGreenCount  = 0;  // tüm oyun boyunca yeşil harf sayısı
let totalYellowCount = 0;  // tüm oyun boyunca sarı harf sayısı

let WORD_SET        = null;
let CURRENT_THEME   = { ...DEFAULT_THEME };
let LEADERBOARD_DATA = [];

let playerNameCache = "";

/* ==================  YARDIMCI FONKSİYONLAR ================== */

function initFirebaseDb() {
  try {
    if (typeof firebase !== "undefined") {
      FIREBASE_DB = firebase.database();
      console.log("Firebase DB hazır");
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

  console.log("Seçilen mod:", modeValue, "Kelime:", word, "Uzunluk:", word.length);
  return word;
}

/* ================== URL PARAM / ENCODE-DECODE ================== */

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

const SECRET_SHIFT = 37;

function encodeSecret(word) {
  const parts = [];
  for (let i = 0; i < word.length; i++) {
    parts.push(word.charCodeAt(i) + SECRET_SHIFT);
  }
  return parts.join("x");
}

function decodeSecret(code) {
  if (!code) return "";
  return code
    .split("x")
    .map(p => String.fromCharCode(parseInt(p, 10) - SECRET_SHIFT))
    .join("");
}

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

  // skor istatistiklerini sıfırla
  gameStartTime    = Date.now();
  totalGreenCount  = 0;
  totalYellowCount = 0;

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
  loadLeaderboard(CURRENT_CONTEXT_ID);
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

  // iPhone Türkçe Q düzeni
  const rows = [
    "QWERTYUIOPĞÜ",
    "ASDFGHJKLŞİ",
    "ZXCVBNMÖÇ",
  ];

  // ÜSTTEKİ 3 SATIR
  rows.forEach((row, idx) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "kb-row";

    for (const ch of row) {
      const btn = createKey(ch, ch, false);
      rowDiv.appendChild(btn);
      keyButtons[ch] = btn;
    }

    // üçüncü satırın sağına SİL tuşu
    if (idx === 2) {
      const backBtn = createKey("⌫", "BACK", true);
      backBtn.classList.add("key-backspace");
      rowDiv.appendChild(backBtn);
    }

    keyboardElem.appendChild(rowDiv);
  });

  // EN ALTA GENİŞ ENTER SATIRI
  const enterRow = document.createElement("div");
  enterRow.className = "kb-row";

  const enterBtn = createKey("ENTER", "ENTER", true);
  enterBtn.classList.add("key-enter");
  enterRow.appendChild(enterBtn);

  keyboardElem.appendChild(enterRow);
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
    // Oyun kilitliyse hiçbir tuş çalışmasın
  if (typeof GAME_ACTIVE !== "undefined" && !GAME_ACTIVE) return;
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
   // Oyun kapalıysa tahmin göndermesin
  if (typeof GAME_ACTIVE !== "undefined" && !GAME_ACTIVE) {
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

  // her tahminde yeşil/sarı istatistiklerini güncelle
  updateLetterStatsFromResult(result);

  colorRow(currentRow, upperGuess, result);

  if (upperGuess === SECRET_WORD) {
    const attempts   = currentRow + 1;          // kaçıncı denemede bildi
    const wordLen    = SECRET_WORD.length;
    const elapsedSec = Math.floor((Date.now() - gameStartTime) / 1000); // saniye

    // --- ÇEKİRDEK SKOR (eski sistemle birleşik) ---
    const baseCore       = 800;
    const attemptPenalty = (attempts - 1) * 150;     // her ekstra deneme için ceza
    const lengthBonus    = (wordLen - 3) * 20;       // uzun kelime bonusu

    let coreScore = baseCore - attemptPenalty + lengthBonus;
    if (coreScore < 0



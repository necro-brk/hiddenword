/* Hidden Word: Oyun mantığı (ben). Mod geçişleri, input, Firebase ve UI kontrolü burada. */
/**************************************************
 * Hidden Word – Çok modlu kelime oyunu
 * Bu dosyayı script.js olarak kaydet.
 **************************************************/

/* ================== MOBILE VIEWPORT FIX (100vh) ================== */
(function setVhVar(){
  const set = () => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };
  set();
  window.addEventListener('resize', set, { passive: true });
  window.addEventListener('orientationchange', set, { passive: true });
  setTimeout(set, 50);
  setTimeout(set, 250);
})();



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
};

/* ================== GLOBAL STATE ================== */


/* Ben: window.GAME_ACTIVE globalini tek kez kuruyorum (varsa dokunmuyorum) */
window.GAME_ACTIVE = (typeof window.GAME_ACTIVE === "undefined") ? true : window.GAME_ACTIVE;
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

function getDuelPath(code) {
  return "duels/" + code;
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
      tile.dataset.r = String(r);
      tile.dataset.c = String(c);
      tile.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        setActiveCell(r, c);
      });
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

  // Ben: fiziksel klavye kontrolünü sadece oyun ekranında yönetiyorum
  keydownHandler = (e) => {
    if (finished) return;
    if (CURRENT_SCREEN !== "screen-game") return;

    // Ben: Ctrl/Alt/Meta kombinasyonları oyuna karakter basmasın
    if (e.ctrlKey || e.altKey || e.metaKey) {
      // Ben: Ctrl+S gibi tarayıcı kısayollarını oyun ekranında kesiyorum
      e.preventDefault();
      return;
    }

    const key = e.key;

    if (key === "Enter") {
      e.preventDefault();
      handleKey("ENTER");
      return;
    }
    if (key === "Backspace") {
      e.preventDefault();
      handleKey("BACK");
      return;
    }

    // Tek karakter değilse (Shift, Tab, Arrow vb.) yok sayıyorum
    if (!key || key.length !== 1) return;

    const ch = trUpperChar(key);
    if (/^[A-ZÇĞİÖŞÜI]$/.test(ch)) {
      e.preventDefault();
      handleKey(ch);
    }
  };

  window.addEventListener("keydown", keydownHandler, { passive: false });
}

function detachKeydown() {
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
}

/* ================== KLAVYE / GİRİŞ İŞLEME ================== */

function handleKey(key) {

  if (!window.GAME_ACTIVE) {
    setStatus("Şu an oyun kapalı.", "#f97316");
    return;
  }

  if (finished) return;


  if (key === "ENTER") {
    submitGuess();
    return;
  }
  if (key === "BACK") {
    // Seçili kutuyu mantıklı şekilde sil
    const col = Math.min(currentCol, COLS - 1);
    const cur = getTileChar(currentRow, col);
    if (cur) {
      setTile(currentRow, col, "");
      currentCol = col;
    } else if (col > 0) {
      setTile(currentRow, col - 1, "");
      currentCol = col - 1;
    }
    renderActiveCell();
    return;
  }

  if (currentCol >= COLS) return;
  // Seçili kutuya yaz + bir sonraki kutuya ilerle
  setTile(currentRow, currentCol, key);
  currentCol = Math.min(currentCol + 1, COLS - 1);
  renderActiveCell();
}

function getTileChar(r, c) {
  const inner = tiles[r][c].querySelector(".tile-inner");
  return (inner.textContent || "").trim();
}

function setTile(r, c, ch) {
  const tile  = tiles[r][c];
  const inner = tile.querySelector(".tile-inner");
  inner.textContent = ch;
  if (ch) tile.classList.add("tile-filled");
  else tile.classList.remove("tile-filled");
}


/* ================== SEÇİLİ KUTU (TIKLA + YAZ) ==================
   - Yazarken/silerken hangi kutunun aktif olduğunu ben yönetiyorum.
   - Fare ile kutuya tıklayınca imleç o kutuya gider.
   - Ctrl/Alt/Meta kısayollarında harf yazmayı engelliyorum.
*/
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function setActiveCell(r, c) {
  // Sadece aktif satırda seçim yapılır
  if (r !== currentRow) return;
  currentCol = clamp(c, 0, COLS - 1);
  renderActiveCell();
}

function renderActiveCell() {
  // Tüm seçimi temizle
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      tiles[r][c].classList.remove("tile-selected");
    }
  }
  // Aktif satır + aktif kolon
  const col = clamp(currentCol, 0, COLS - 1);
  tiles[currentRow][col].classList.add("tile-selected");
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

  if (!window.GAME_ACTIVE) {
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
    // ✅ Solo modda KAZANINCA popup aç
if (CURRENT_GAME_TYPE === "solo" || CURRENT_GAME_TYPE === "duel-guess") {
  const titleEl = document.getElementById("endgame-title");
  if (titleEl) titleEl.textContent = (CURRENT_GAME_TYPE === "duel-guess") ? "Düello bitti! 🎉" : "Tebrikler! 🎉";
  openEndgameModal(SECRET_WORD);
}
    return;
  }

  if (currentRow === ROWS - 1) {
    setStatus("Bitti! Kelimeyi bulamadın.", "#f97316");
    finished = true;

    // ✅ Solo/Düello kaybedince popup
    if (CURRENT_GAME_TYPE === "solo" || CURRENT_GAME_TYPE === "duel-guess") {
      const titleEl = document.getElementById("endgame-title");
      if (titleEl) titleEl.textContent = (CURRENT_GAME_TYPE === "duel-guess") ? "Düello bitti" : "Oyun bitti";
      openEndgameModal(SECRET_WORD);
    }
    return;
  }

  currentRow++;
  currentCol = 0;
  setStatus("Yeni bir tahmin yap!");
}


// ===============================
// SOLO BİTİŞ POPUP (LOSE)
// ===============================
function openEndgameModal(word) {
  const modal = document.getElementById("endgame-modal");
  const wordEl = document.getElementById("endgame-word");
  if (!modal || !wordEl) return;
  wordEl.textContent = word || "";
    modal.hidden = false;
modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeEndgameModal() {
  const modal = document.getElementById("endgame-modal");
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

function bindEndgameModalEvents() {
  const modal    = document.getElementById("endgame-modal");
  const btnClose = document.getElementById("endgame-close");
  const btnNew   = document.getElementById("endgame-new-solo");

  if (btnClose) btnClose.addEventListener("click", () => closeEndgameModal());

  // Modal dışına tıklayınca kapat
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeEndgameModal();
    });
  }

  // Yeni oyun / tekrar oyna
  if (btnNew) {
    btnNew.addEventListener("click", () => {
      closeEndgameModal();

      // SOLO: aynı uzunlukta yeni random kelime
      if (CURRENT_GAME_TYPE === "solo") {
        startSoloWithCurrentMode();
        return;
      }

      // DÜELLO TAHMİN: aynı düelloyu tekrar oyna
      if (CURRENT_GAME_TYPE === "duel-guess") {
        const badgeMode = document.getElementById("badge-game-mode");
        if (badgeMode) {
          const len = String(CURRENT_MODE || (SECRET_WORD ? SECRET_WORD.length : 5));
          badgeMode.textContent = `Düello · ${len} harfli – Tahmin`;
        }
        resetGameState(SECRET_WORD, CURRENT_CONTEXT_ID);
        setLeaderboardVisible(false);
        showScreen("screen-game");
        setStatus("Düello devam ediyor. Tahmin et!");
        return;
      }

      // Diğer modlar: menüye dön
      showScreen("screen-home");
    });
  }
}


function startSoloWithCurrentMode() {
  // CURRENT_MODE: "3".."8" veya mod value
  const modeValue = String(CURRENT_MODE || "5");
  // pickRandomWord fonksiyonun zaten var
  const word = pickRandomWord(modeValue);
  const contextId = `solo:${modeValue}`;
  CURRENT_GAME_TYPE = "solo";
  resetGameState(word, contextId);
  setLeaderboardVisible(false);
  showScreen("screen-game");
  setStatus("Kelimeyi tahmin etmeye başla!");
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

  word = word.replace(/\s+/g, "");
  word = trUpper(word);

  const len = word.length;

  if (!/^[A-ZÇĞİÖŞÜI]+$/.test(word) || len < 2) {
    alert("Geçerli bir kelime gir (yalnızca harf, en az 2 harf).");
    return;
  }

  // ✅ Yeni sistem: Grup modu gibi 5 haneli kısa kod
  const duelCode = generateShortCode(5);

  // Firebase'e kaydet (arkadaş kodla girsin diye)
  if (!FIREBASE_DB) {
    alert("Firebase bağlantısı yok. Sayfayı yenileyip tekrar dene.");
    return;
  }

  const path = getDuelPath(duelCode);
  FIREBASE_DB.ref(path).set({
    secretWord: word,
    mode: len,
    createdAt: Date.now()
  }).then(() => {
    // Ekranda sadece 5 haneli kod görünsün
    linkInput.value = duelCode;
    // Link olarak da paylaşılabilsin (UI'da göstermiyoruz)
    linkInput.dataset.duelUrl = `${location.origin}${location.pathname}?duel=${encodeURIComponent(duelCode)}`;
    linkWrap.style.display = "block";
  }).catch(err => {
    console.warn("Düello odası oluşturulamadı:", err);
    alert("Düello kodu oluşturulamadı. (permission_denied olabilir: Firebase rules kontrol)");
  });
}


/* ---- DÜELLO MODU (LINK İLE GİRENLER) ---- */

function handleDuelloLinkIfAny() {
  const duelCode = (getQueryParam("duel") || "").trim().toUpperCase();
  if (!duelCode) return;

  if (!FIREBASE_DB) {
    console.warn("Firebase yok, düello kodu çözümlenemedi.");
    return;
  }

  const path = getDuelPath(duelCode);
  FIREBASE_DB.ref(path).once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data || !data.secretWord) {
      alert("Bu düello kodu geçersiz ya da süresi dolmuş olabilir.");
      return;
    }

    let secretWord = trUpper(String(data.secretWord || "")).replace(/\s+/g, "");
    if (!/^[A-ZÇĞİÖŞÜI]+$/.test(secretWord) || secretWord.length < 2) {
      alert("Bu düello kodundan geçerli bir kelime okunamadı.");
      return;
    }

    CURRENT_MODE      = String(data.mode || secretWord.length);
    CURRENT_GAME_TYPE = "duel-guess";

    const contextId = `duel:${duelCode}`;

    const badgeMode = document.getElementById("badge-game-mode");
    const badgeRoom = document.getElementById("badge-room-info");
    if (badgeMode) badgeMode.textContent = `Düello · ${secretWord.length} harfli – Tahmin`;
    if (badgeRoom) badgeRoom.textContent = `Düello kodu: ${duelCode}`;

    resetGameState(secretWord, contextId);
    setLeaderboardVisible(false);
    showScreen("screen-game");
  }).catch(err => {
    console.warn("Düello verisi okunamadı:", err);
    alert("Düello kodu okunamadı. Firebase bağlantını kontrol et.");
  });
}

function joinDuelByCode() {
  const input = document.getElementById("duel-join-code");
  if (!input) return;

  let code = (input.value || "").trim();

  // Kullanıcı yanlışlıkla tam URL yapıştırdıysa ?duel=... kısmını çek
  if (/^https?:\/\//i.test(code)) {
    try {
      const u = new URL(code);
      const extracted = u.searchParams.get("duel");
      if (extracted) code = extracted.trim();
    } catch (e) {}
  }

  code = code.toUpperCase();

  if (!code || code.length < 4) {
    alert("Geçerli bir düello kodu gir.");
    return;
  }

  if (!FIREBASE_DB) {
    alert("Firebase bağlantısı yok. Sayfayı yenileyip tekrar dene.");
    return;
  }

  const path = getDuelPath(code);
  FIREBASE_DB.ref(path).once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data || !data.secretWord) {
      alert("Bu düello kodu bulunamadı.");
      return;
    }

    let secretWord = trUpper(String(data.secretWord || "")).replace(/\s+/g, "");
    if (!/^[A-ZÇĞİÖŞÜI]+$/.test(secretWord) || secretWord.length < 2) {
      alert("Bu düello kodundan geçerli bir kelime okunamadı.");
      return;
    }

    CURRENT_MODE      = String(data.mode || secretWord.length);
    CURRENT_GAME_TYPE = "duel-guess";

    const contextId = `duel:${code}`;

    const badgeMode = document.getElementById("badge-game-mode");
    const badgeRoom = document.getElementById("badge-room-info");
    if (badgeMode) badgeMode.textContent = `Düello · ${secretWord.length} harfli – Tahmin`;
    if (badgeRoom) badgeRoom.textContent = `Düello kodu: ${code}`;

    resetGameState(secretWord, contextId);
    setLeaderboardVisible(false);
    showScreen("screen-game");
  }).catch(err => {
    console.warn("Düello verisi okunamadı:", err);
    alert("Düello kodu okunamadı. Firebase rules/bağlantı kontrol et.");
  });
}


/* ---- GRUP MODU – ODA KODU ---- */

function generateShortCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateRoomCode() {
  return generateShortCode(5);
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
    if (typeof window.GAME_ACTIVE !== "undefined" && !window.GAME_ACTIVE) {
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
  const btnHelpTour     = document.getElementById("btn-help-tour");

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

  if (btnHelpTour) {
    btnHelpTour.addEventListener("click", () => startOnboarding(true));
  }

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
    copyLinkBtn.addEventListener("click", () => {
      const linkInput = document.getElementById("generated-link");
      if (!linkInput) return;
      linkInput.select();
      document.execCommand("copy");
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
  bindEndgameModalEvents();
  handleDuelloLinkIfAny();
  // Ben: ilk kez açanlara menü turu gösteriyorum
  startOnboarding(false);
});
/* ================== İLK KULLANIM TURU (ben) ==================
   Kullanıcı ilk kez açınca menüde modları sırayla tanıtıyorum.
*/

const ONBOARD_KEY = "hw_onboarding_done";

function startOnboarding(force = false) {
  try {
    if (!force && localStorage.getItem(ONBOARD_KEY) === "1") return;
  } catch (_) {}

  // Ben: sadece ana menüde başlatıyorum
  if (CURRENT_SCREEN !== "screen-home") return;

  const overlay = document.getElementById("tour-overlay");
  const tooltip = document.getElementById("tour-tooltip");
  const titleEl = document.getElementById("tour-title");
  const bodyEl  = document.getElementById("tour-body");
  const btnNext = document.getElementById("tour-next");
  const btnSkip = document.getElementById("tour-skip");

  if (!overlay || !tooltip || !titleEl || !bodyEl || !btnNext || !btnSkip) return;

  const steps = [
    { sel: "#btn-home-solo",     t: "Solo Mod",   b: "Tek başıma oynuyorum. Kutulara tıklayıp harf yazıyorum, Enter ile gönderiyorum." },
    { sel: "#btn-home-duel",     t: "Düello",     b: "Arkadaşımla kapışıyorum. Kod oluşturup paylaşıyorum veya kod ile odaya giriyorum." },
    { sel: "#btn-home-group",    t: "Grup Yarış", b: "Oda kurup birden fazla kişiyle aynı anda yarışıyorum." },
    { sel: "#btn-home-settings", t: "Ayarlar",    b: "Kullanıcı adımı ve tema ayarlarını yönetiyorum." }
  ];

  let stepIndex = 0;
  let currentTarget = null;

  function cleanupHighlight() {
    if (currentTarget) currentTarget.classList.remove("tour-highlight");
    currentTarget = null;
  }

  function closeTour(markDone = true) {
    cleanupHighlight();
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    window.removeEventListener("resize", onResize);
    if (markDone) {
      try { localStorage.setItem(ONBOARD_KEY, "1"); } catch (_) {}
    }
  }

  function positionTooltip(target) {
    const r = target.getBoundingClientRect();
    const pad = 12;
    const panel = document.querySelector('#screen-home .panel') || document.querySelector('.panel');
    const pr = panel ? panel.getBoundingClientRect() : null;

    // Tooltip ölçüsünü almak için önce resetliyorum
    tooltip.style.left = "0px";
    tooltip.style.top  = "0px";

    const tw = tooltip.offsetWidth || 300;
    const th = tooltip.offsetHeight || 160;

    let left = r.left + (r.width / 2) - (tw / 2);
    const minX = pr ? (pr.left + pad) : pad;
    const maxX = pr ? (pr.right - tw - pad) : (window.innerWidth - tw - pad);
    left = Math.max(minX, Math.min(left, maxX));

    let top = r.bottom + 10;
    if (top + th + pad > window.innerHeight) {
      top = r.top - th - 10;
    }
    top = Math.max(pad, Math.min(top, window.innerHeight - th - pad));

    tooltip.style.left = left + "px";
    tooltip.style.top  = top + "px";
  }

  function renderStep() {
    cleanupHighlight();

    const s = steps[stepIndex];
    const target = document.querySelector(s.sel);
    if (!target) {
      closeTour(false);
      return;
    }

    currentTarget = target;
    target.classList.add("tour-highlight");

    titleEl.textContent = s.t;
    bodyEl.textContent  = s.b;

    btnNext.textContent = (stepIndex === steps.length - 1) ? "Bitir" : "Sıradaki";

    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");

    try { target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch(_) {}

    setTimeout(() => positionTooltip(target), 80);
  }

  function onResize() {
    if (currentTarget) positionTooltip(currentTarget);
  }

  btnNext.onclick = () => {
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
      renderStep();
    } else {
      closeTour(true);
    }
  };

  btnSkip.onclick = () => closeTour(true);

  window.addEventListener("resize", onResize);

  renderStep();
}

/* ================== YARDIM ( ? ) ==================
   Her ekranda kısaca nasıl oynanır + teknik bilgi.
*/
function openHelp(topic) {
  const modal = document.getElementById("help-modal");
  const title = document.getElementById("help-title");
  const body  = document.getElementById("help-body");
  if (!modal || !title || !body) return;

  const activeScreen = document.querySelector(".screen-active");
  const screenId = activeScreen ? activeScreen.id : "home-screen";

  const map = {
    "home-screen": {
      t: "Menü",
      b: "Mod seçip oyuna giriyorum. Solo/Düello/Grup Yarış/Ayarlar."
    },
    "solo-screen": {
      t: "Solo Mod",
      b: "Amaç: gizli kelimeyi tahmin etmek. Kutulara tıklayıp harf girebilirim. Enter gönderir, Backspace siler."
    },
    "duel-screen": {
      t: "Düello",
      b: "Kod oluşturup arkadaşla paylaşıyorum. Kodla katılınca aynı gizli kelime üzerinden yarışıyoruz."
    },
    "group-screen": {
      t: "Grup Yarış",
      b: "Oda oluşturup kodu paylaşıyorum. Odaya katılanlar aynı kelimeyle yarışıyor."
    },
    "settings-screen": {
      t: "Ayarlar",
      b: "Renkleri buradan değiştiriyorum. İstersem varsayılana dönüp kaydediyorum."
    }
  };

  const info = map[screenId] || { t: "Yardım", b: "Kısaca: mod seç, kelimeyi tahmin et." };
  title.textContent = info.t;
  body.innerHTML = `
    <p>${info.b}</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:12px 0;">
    <p><strong>Teknik:</strong> HTML + CSS + JavaScript. Çok oyunculu kısımlar Firebase Realtime Database ile.</p>
    <p><strong>İpucu:</strong> Ctrl/Alt/Win kısayolları oyuna harf basmaz.</p>
  `;

  modal.classList.remove("hidden");
}

function closeHelp() {
  const modal = document.getElementById("help-modal");
  if (modal) modal.classList.add("hidden");
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t && t.matches && t.matches(".help-btn")) {
    openHelp(t.getAttribute("data-help") || "page");
  }
  if (t && t.hasAttribute && t.hasAttribute("data-close-help")) closeHelp();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeHelp();
});

// PWA Service Worker register
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/hiddenword/sw.js");
  });
}


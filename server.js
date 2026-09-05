/**
 * 성경 픽셀 배틀 v3
 * 메인 화면(관전) → /host   학생 폰 → /
 */
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 20000, perMessageDeflate: false });
/* 파일을 고치면 새로고침만으로 바로 반영되도록 캐시를 끕니다 */
const NOCACHE = (res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
};
app.use(express.static(path.join(__dirname, "public"),
  { etag: false, lastModified: false, maxAge: 0, setHeaders: NOCACHE }));
app.get("/sprite.js", (req, res) => {
  for (const f of [path.join(__dirname, "public", "sprite.js"), path.join(__dirname, "sprite.js")])
    if (fs.existsSync(f)) { NOCACHE(res); return res.type("application/javascript").sendFile(f); }
  res.status(404).type("application/javascript")
     .send('window.PX_MISSING = true; console.error("sprite.js 파일을 찾을 수 없습니다");');
});

/* ═════════ 설정 ═════════ */
const TS = 40, R = 13;
const SPEED = 92, MEET = 40;           // 천천히 걷는 속도 — 눈으로 따라가기 편하게
const TICK = 1000 / 20, SEND_HOST = 1000 / 12, SEND_PHONE = 1000 / 12, SEND_META = 550;
const DUEL_TIME = 18, AFTER_DUEL = 4, REMATCH = 18, CELL = 120;
/* 문제가 길면 읽을 시간을 더 줍니다: 글자 60자당 +1초 (최대 +10초) */
const readTime = (q) => Math.min(10, Math.round((q.text.length + q.options.join("").length) / 60));
const TIE_WINDOW = 400;                // 이 시간 안에 둘 다 맞히면 무승부
const SCORE_FLOOR = -5;
const DODGE_COOL = 40000, DODGE_TIME = 3200;
const CAP_PERIOD = 8000, BOSS_RESPAWN = 30000;
const TREASURE_FIRST = 210000, TREASURE_EVERY = 300000;   // 보물은 아주 가끔만

const ITEM_CLASS = ["sling", "shield", "scroll", "lamp", "staff", "harp"];
const BOX_ITEMS = {
  speed:  { name: "빠른 발걸음", icon: "👟", desc: "10초 동안 속도 1.8배", effect: "지금부터 10초 동안 훨씬 빨라집니다", instant: true },
  ghost:  { name: "구름 기둥",   icon: "☁️", desc: "10초 동안 은신", effect: "지금부터 10초 동안 아무도 나를 못 봅니다", instant: true },
  shield: { name: "믿음의 방패", icon: "🛡️", desc: "다음 대결에서 져도 점수 유지", effect: "보관됨 — 다음 대결에서 자동 발동" },
  hint:   { name: "지혜의 등불", icon: "🕯️", desc: "다음 대결에서 오답 보기 하나 삭제", effect: "보관됨 — 다음 대결에서 자동 발동" },
  double: { name: "두 배의 축복", icon: "✨", desc: "다음 대결에서 이기면 점수 2배", effect: "보관됨 — 다음 대결에서 자동 발동" },
  time:   { name: "모래시계",    icon: "⏳", desc: "다음 대결 시간 +6초", effect: "보관됨 — 다음 대결에서 자동 발동" },
  gold:   { name: "황금 상자",   icon: "🏆", desc: "즉시 +2점", effect: "+2점 획득!", instant: true },
  crown:  { name: "전설의 왕관", icon: "👑", desc: "즉시 +3점, 속도·은신 20초, 방패·축복 장착", effect: "+3점! 20초 가속·은신 + 방패·축복 장착", instant: true },
};
const TIER_TABLE = [
  ["speed", "speed", "shield", "hint", "time", "hint"],
  ["ghost", "double", "gold", "speed"],
  ["crown"],
];
const BOSSES = {                        // 보스전: 어려운 문제만 · 시간 짧음 · 틀리면 즉시 패배 · 지면 쓰러짐
  // 골리앗: 6초마다 돌진(3배속 1초). 정면으로 마주치면 못 피합니다
  goliath:   { name: "골리앗",     speed: 50, reward: 3, penalty: 1, limit: 14, trait: "돌진",   desc: "6초마다 무섭게 돌진합니다" },
  // 바로 왕: 거점(성전·제단·우물)을 순찰하며 지킵니다. 쓰러뜨리면 황금 상자를 떨어뜨립니다
  pharaoh:   { name: "바로 왕",    speed: 42, reward: 4, penalty: 1, limit: 13, trait: "거점 순찰", desc: "거점을 지키고, 죽으면 황금 상자를 남깁니다" },
  // 바벨론 사자: 가장 빠르고 수풀에 숨습니다. 수풀 근처에선 조심
  lion:      { name: "바벨론 사자", speed: 80, reward: 2, penalty: 1, limit: 12, trait: "잠복",   desc: "수풀에 숨어 있다가 덮칩니다" },
  // 리워야단: 물 위를 다닙니다. 호수 근처가 위험. 후반에 한 번만
  leviathan: { name: "리워야단",   speed: 44, reward: 6, penalty: 2, limit: 15, trait: "물길",   desc: "물 위를 헤엄쳐 다닙니다" },
  // 느부갓네살: 보물상자를 찾아다니며 부숩니다
  nebuchad:  { name: "느부갓네살", speed: 46, reward: 4, penalty: 1, limit: 13, trait: "약탈",   desc: "보물상자를 찾아다니며 부숩니다" },
  // 헤롯: 8초마다 아무 사람 옆으로 순간이동
  herod:     { name: "헤롯 왕",    speed: 40, reward: 3, penalty: 1, limit: 13, trait: "순간이동", desc: "8초마다 누군가의 옆으로 순간이동합니다" },
  // 에덴의 뱀: 지면 아이템을 모두 빼앗깁니다
  serpent:   { name: "에덴의 뱀",  speed: 58, reward: 3, penalty: 1, limit: 13, trait: "유혹",   desc: "지면 갖고 있던 아이템을 전부 빼앗깁니다" },
  // 아말렉 병사: 둘씩 무리로 등장
  amalek:    { name: "아말렉 병사", speed: 68, reward: 1, penalty: 1, limit: 11, trait: "무리",   desc: "둘씩 몰려다닙니다. 약하지만 빠릅니다" },
};
const BOSS_RESPAWN_FAST = 20000;
const DOWN_MS = 5000;                   // 보스에게 지면 쓰러져 있는 시간
const DOWN_DUEL_MS = 3000;              // 일반 대결에서 지면 쓰러져 있는 시간
const AMBUSH_LOCK = 1500;               // 기습당한 쪽이 답을 못 고르는 시간
const EMOTES = ["승리! 🏆", "할렐루야!", "아멘!", "다음 상대!", "😎", "🔥🔥", "주께 영광!", "이건 몰랐지?"];
const STICKERS = ["🦁","🕊️","🔥","⚡","🌟","🛡️","📖","✝️","🎺","🏺","🌿","👑","🐑","⚔️","💎","🎯"];
const TIERS = [                         // 계급 (이번 판 점수 기준)
  { min: -99, name: "양치기", icon: "🐑" }, { min: 3, name: "용사", icon: "🗡" }, { min: 6, name: "백부장", icon: "🛡" },
  { min: 10, name: "천부장", icon: "⚔" }, { min: 15, name: "사사", icon: "📜" }, { min: 20, name: "왕", icon: "👑" },
];
const tierOf = (sc) => { let t = TIERS[0]; for (const x of TIERS) if (sc >= x.min) t = x; return t; };
const tierIdx = (sc) => TIERS.indexOf(tierOf(sc));
const XP_TABLE = [0, 50, 110, 180, 260, 350, 450, 560, 680, 810];    // 레벨 1~10 누적 경험치 (완만하게)
const XP = { win: 45, draw: 12, boss: 90, soldier: 15, fox: 30, locust: 10, chest: 12, cap: 8, quest: 25, treasure: 45 };
const levelOf = (xp) => { let l = 1; for (let i = 1; i < XP_TABLE.length; i++) if (xp >= XP_TABLE[i]) l = i + 1; return l; };
/* 레벨별 해금 특성 — 레벨을 올릴 이유 */
const PERKS = [
  { lv: 2,  icon: "↯",  name: "빠른 회피",     desc: "회피 쿨다운 40초 → 30초" },
  { lv: 3,  icon: "📦", name: "손빠른 손",     desc: "나무 상자 2.5초 → 1.2초에 열림" },
  { lv: 4,  icon: "🔑", name: "행운의 손",     desc: "미니언 열쇠 확률 +20%" },
  { lv: 5,  icon: "🎒", name: "넓은 가방",     desc: "아이템 보관 2칸 → 3칸 · 레벨업 +2점" },
  { lv: 6,  icon: "⏳", name: "침착함",       desc: "모든 대결 시간 +3초" },
  { lv: 7,  icon: "🛡", name: "레벨 방패",     desc: "보스전 첫 오답 1회 면제 · 패배 점수 보호 1회" },
  { lv: 8,  icon: "🗡", name: "그림자 검",     desc: "기습 시 상대 잠금 1.5초 → 2.5초" },
  { lv: 9,  icon: "✨", name: "빠른 부활",     desc: "쓰러진 시간 절반" },
  { lv: 10, icon: "👑", name: "황금 오라",     desc: "승리마다 +1점 추가 · 황금 빛 · 레벨업 +3점" },
];
const hasPerk = (p, lv) => (p.level || 1) >= lv;
function addXp(p, n, why) {
  p.xp = (p.xp || 0) + n;
  const lv = levelOf(p.xp);
  if (lv > (p.level || 1)) {
    const from = p.level || 1;
    p.level = lv; p.glowUntil = now() + 3000;
    if (lv >= 7 && from < 7) p.lvShield = 1;                     // 레벨 방패 충전
    const bonus = lv >= 10 ? 3 : lv >= 5 ? 2 : 1;               // 레벨업 즉시 점수
    addScore(p, bonus);
    const perk = PERKS.find((k) => k.lv === lv);
    pushLog(`⬆ ${p.name} 레벨 ${lv} 달성! +${bonus}점` + (perk ? ` · ${perk.icon} ${perk.name}` : ""), "gold");
    if (lv >= 4) bigEvent(`⬆ ${p.name} 레벨 ${lv}!`, lv >= 8 ? "gold" : "win");
    if (p.socketId) io.to(p.socketId).emit("levelUp", { level: lv, bonus,
      perk: perk ? `${perk.icon} ${perk.name} — ${perk.desc}` : `속도 +${(lv - 1) * 2}% · 대결 시간 +${((lv - 1) * .3).toFixed(1)}초` });
  }
  if (p.socketId && n >= 5) io.to(p.socketId).emit("xp", { n, why, xp: p.xp, level: lv, next: XP_TABLE[Math.min(9, lv)] || XP_TABLE[9], base: XP_TABLE[lv - 1] });
}
const QUESTS = [                        // 도전과제
  { id: "win1",   name: "첫 승리",        need: 1, bonus: 1, desc: "대결에서 1승" },
  { id: "duel5",  name: "전사의 길",      need: 5, bonus: 1, desc: "대결 5회 참여" },
  { id: "streak3",name: "연승 행진",      need: 3, bonus: 2, desc: "3연승 달성" },
  { id: "boss1",  name: "거인 사냥꾼",    need: 1, bonus: 2, desc: "보스 1회 격파" },
  { id: "box5",   name: "보물 수집가",    need: 5, bonus: 2, desc: "상자 5개 열기" },
  { id: "cap3",   name: "거점 수호자",    need: 3, bonus: 2, desc: "거점에서 3번 점수" },
];
const BOSS_ROTATION = ["goliath", "pharaoh", "lion", "nebuchad", "herod", "serpent", "amalek"];
const TEAMS = [
  { id: 0, name: "청지기", color: "#56A8FF" },
  { id: 1, name: "불기둥", color: "#FF5C6C" },
  { id: 2, name: "생명수", color: "#57E389" },
  { id: 3, name: "등대",   color: "#FFD166" },
];
const BAD_WORDS = ["시발","씨발","ㅅㅂ","병신","ㅂㅅ","좆","섹스","자지","보지","개새","니미","엠창","애미","창녀","죽어라","fuck","shit","bitch"];

/* ═════════ 문제 ═════════ */
const questionFiles = () => fs.readdirSync(__dirname).filter((f) => /^questions.*\.json$/i.test(f)).sort();
function loadQuestions(file) {
  const problems = [];
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")); }
  catch (e) { return { list: [], problems: [`${file} 을 읽지 못했습니다: ${e.message}`] }; }
  if (!Array.isArray(raw)) return { list: [], problems: [`${file} 의 최상위가 배열이 아닙니다`] };
  const list = [];
  raw.forEach((q, i) => {
    const n = i + 1;
    if (!q || !q.t) return problems.push(`${n}번: 문제 글(t)이 없습니다`);
    if (!Array.isArray(q.o) || q.o.length !== 4) return problems.push(`${n}번 "${String(q.t).slice(0,14)}…": 보기(o)가 4개가 아닙니다`);
    if (!Number.isInteger(q.a) || q.a < 0 || q.a > 3) return problems.push(`${n}번 "${String(q.t).slice(0,14)}…": 정답 번호(a)는 0~3이어야 합니다`);
    list.push({ id: list.length, text: q.t, options: q.o, answer: q.a,
                cat: ["ot","nt","person","fun","verse","qa"].includes(q.c) ? q.c : "person", ref: q.r || "", exp: q.e || "", hard: !!q.h });
  });
  return { list, problems };
}

/* ═════════ 타일맵 ═════════ */
// 0 모래 1 풀 2 돌길 3 바위(막힘) 4 물(막힘) 5 수풀 6 수렁(느림) 7 포탈
const SOLID = new Set([3, 4]);
let MAP = null, MAPSEQ = 0;
function buildMap(TW, TH) {
  const t = new Uint8Array(TW * TH).fill(1);
  const at = (x, y) => y * TW + x;
  const ri = (a, b) => a + Math.random() * (b - a) | 0;
  const blob = (cx, cy, r, v) => {
    for (let y = Math.max(1, cy - r); y <= Math.min(TH - 2, cy + r); y++)
      for (let x = Math.max(1, cx - r); x <= Math.min(TW - 2, cx + r); x++)
        if (Math.hypot(x - cx, (y - cy) * 1.25) <= r + Math.random() * .9 - .45) t[at(x, y)] = v;
  };
  for (let i = 0; i < TW / 3.5; i++) blob(ri(2, TW - 2), ri(2, TH - 2), ri(2, 6), 0);
  for (let i = 0; i < TW / 3; i++) blob(ri(2, TW - 2), ri(2, TH - 2), ri(1, 3), 5);
  for (let i = 0; i < TW / 10; i++) blob(ri(4, TW - 4), ri(3, TH - 3), ri(2, 4), 4);
  for (let i = 0; i < TW / 8; i++) blob(ri(3, TW - 3), ri(3, TH - 3), ri(1, 3), 6);
  for (let i = 0; i < TW / 2; i++) {
    const cx = ri(2, TW - 2), cy = ri(2, TH - 2), n = ri(1, 5);
    for (let k = 0; k < n; k++) {
      const x = cx + ri(-1, 2), y = cy + ri(-1, 2);
      if (x > 0 && y > 0 && x < TW - 1 && y < TH - 1) t[at(x, y)] = 3;
    }
  }
  const my = TH >> 1, mx = TW >> 1;
  for (let x = 0; x < TW; x++) { t[at(x, my)] = 2; t[at(x, my - 1)] = 2; }
  for (let y = 0; y < TH; y++) { t[at(mx, y)] = 2; t[at(mx - 1, y)] = 2; }
  for (let x = 0; x < TW; x++) { t[at(x, 0)] = 3; t[at(x, TH - 1)] = 3; }
  for (let y = 0; y < TH; y++) { t[at(0, y)] = 3; t[at(TW - 1, y)] = 3; }

  const spots = [[3, 3], [TW - 4, TH - 4], [TW - 4, 3], [3, TH - 4], [mx, 3], [mx, TH - 4], [3, my], [TW - 4, my]];
  spots.forEach((s) => { t[at(s[0], s[1])] = 7; });
  const portals = [[spots[0], spots[1]], [spots[2], spots[3]], [spots[4], spots[5]], [spots[6], spots[7]]].map(([a, b]) => [
    { x: a[0] * TS + TS / 2, y: a[1] * TS + TS / 2 }, { x: b[0] * TS + TS / 2, y: b[1] * TS + TS / 2 }]);

  const names = ["성전", "제단", "우물", "망대", "샘"];
  const caps = [[mx, 4], [5, my], [TW - 6, my], [TW >> 2, TH - 5], [(TW * 3) >> 2, TH - 5]].map(([x, y], i) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = clamp(x + dx, 1, TW - 2), ny = clamp(y + dy, 1, TH - 2);
      if (SOLID.has(t[at(nx, ny)])) t[at(nx, ny)] = 2;
    }
    return { x: x * TS + TS / 2, y: y * TS + TS / 2, r: 62, name: names[i] };
  });
  MAPSEQ++;
  return { TW, TH, W: TW * TS, H: TH * TS, t, portals, caps, seq: MAPSEQ };
}
function mapSizeFor(n) {                 // 인원별 맵 크기 (타일 수). 60명이면 156×90 (6240×3600px) — 이전의 3배 면적
  if (n <= 8) return [76, 44];
  if (n <= 16) return [94, 54];
  if (n <= 28) return [114, 66];
  if (n <= 42) return [136, 78];
  return [156, 90];
}
/* 구역: 가로 3 × 세로 2. 구역마다 문제 유형이 다릅니다 */
const ZONES = [
  { name: "에덴 동산", cat: "ot",     color: "#3DD68C" }, { name: "광야",     cat: "qa",     color: "#E0B86A" }, { name: "시내산",   cat: "verse",  color: "#C9A9FF" },
  { name: "갈릴리",   cat: "nt",     color: "#2FA4FF" }, { name: "예루살렘", cat: "verse",  color: "#FFC93C" }, { name: "바벨론",   cat: "hard",   color: "#FF4757" },
];
const zoneOf = (x, y) => (y < MAP.H / 2 ? 0 : 3) + Math.min(2, Math.floor(x / (MAP.W / 3)));
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const tileAt = (x, y) => {
  const tx = x / TS | 0, ty = y / TS | 0;
  if (tx < 0 || ty < 0 || tx >= MAP.TW || ty >= MAP.TH) return 3;
  return MAP.t[ty * MAP.TW + tx];
};
const solidAt = (x, y) => SOLID.has(tileAt(x, y));
const blocked = (x, y) => solidAt(x-R,y-R)||solidAt(x+R,y-R)||solidAt(x-R,y+R)||solidAt(x+R,y+R);
function freeSpot() {
  for (let i = 0; i < 500; i++) {
    const x = 60 + Math.random() * (MAP.W - 120), y = 60 + Math.random() * (MAP.H - 120);
    if (!blocked(x, y) && tileAt(x, y) !== 7) return { x, y };
  }
  return { x: MAP.W / 2, y: MAP.H / 2 };
}

/* ═════════ 상태 ═════════ */
const G = {
  phase: "lobby", mode: "solo", minutes: 10,
  qfile: questionFiles().includes("questions.json") ? "questions.json" : (questionFiles()[0] || "questions.json"),
  questions: [], qproblems: [], usedQ: new Set(),
  players: new Map(), boxes: [], opened: [], duels: new Map(), log: [], events: [], minions: [], nextMinionId: 1,
  startedAt: 0, endsAt: 0, pausedLeft: 0, zoneWarned: false, countdownEnd: 0,
  zone: { x: 0, y: 0, r: 9999 },
  bosses: [], nextBossId: 1, leviathanDone: false, treasure: null, nextTreasure: 0, reveal: null,
  nextDuelId: 1, nextBoxId: 1, featured: null, featuredManual: 0,
  stats: { tickAvg: 0, tickMax: 0 },
};
{ const r = loadQuestions(G.qfile); G.questions = r.list; G.qproblems = r.problems; }

const now = () => Date.now();
function pushLog(t, tone = "") { G.log.unshift({ t, tone }); if (G.log.length > 30) G.log.pop(); }
function bigEvent(text, tone = "") { G.events.push({ text, tone }); if (G.events.length > 6) G.events.shift(); }

function spawnBox() {
  // 후보 12곳 중 기존 상자·플레이어에서 가장 멀리 떨어진 곳을 고릅니다 (한곳에 몰리지 않게)
  let best = null, bestScore = -1;
  for (let i = 0; i < 12; i++) {
    const c = freeSpot();
    let minB = 1e9, minP = 1e9;
    for (const b of G.boxes) minB = Math.min(minB, Math.hypot(b.x - c.x, b.y - c.y));
    for (const q of G.players.values()) minP = Math.min(minP, Math.hypot(q.x - c.x, q.y - c.y));
    const sc = Math.min(minB, 600) + Math.min(minP, 300) * .5;
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  const p = best || freeSpot();
  const roll = Math.random();
  const tier = roll < .06 ? 2 : roll < .35 ? 1 : 0;   // 나무 65% · 금테 29% · 전설 6%
  const pool = TIER_TABLE[tier];
  G.boxes.push({ id: G.nextBoxId++, x: p.x, y: p.y, type: pool[Math.random() * pool.length | 0], tier });
}
const boxTarget = () => Math.max(10, Math.min(30, Math.round(G.players.size * .4) + 6));    // 맵이 넓어져 조금 늘림
function refillBoxes() { while (G.boxes.length < boxTarget()) spawnBox(); }
const BOX_RESPAWN = 12000;              // 먹힌 뒤 12초에 하나씩만 다시 생김

function regionOf(y, x) { return ZONES[zoneOf(x == null ? MAP.W / 2 : x, y)].cat; }
function pickQuestion(a, b, region, hardOnly, easyOnly) {
  const all0 = G.questions;
  if (!all0.length) return null;
  let all = all0;
  if (hardOnly) { const h = all0.filter((q) => q.hard); if (h.length >= 8) all = h; }
  else if (easyOnly) { const e = all0.filter((q) => !q.hard); if (e.length >= 8) all = e; }
  if (region === "hard") { const h = all.filter((q) => q.hard); if (h.length >= 8) all = h; region = null; }
  if (region && region !== "hard") { const v = all.filter((q) => q.cat === region); if (v.length < 8) region = null; }
  const seenB = b ? b.seen : new Set();
  const tries = [
    (q) => !G.usedQ.has(q.id) && !a.seen.has(q.id) && !seenB.has(q.id) && q.cat === region,
    (q) => !G.usedQ.has(q.id) && !a.seen.has(q.id) && !seenB.has(q.id),
    (q) => !a.seen.has(q.id) && !seenB.has(q.id),
    (q) => !G.usedQ.has(q.id),
  ];
  let pool = [];
  for (const f of tries) { pool = all.filter(f); if (pool.length) break; }
  if (!pool.length) { for (const q of all) G.usedQ.delete(q.id); pool = all.filter((q) => !a.seen.has(q.id)); if (!pool.length) pool = all; }
  const q0 = pool[Math.random() * pool.length | 0];
  G.usedQ.add(q0.id); a.seen.add(q0.id); if (b) b.seen.add(q0.id);
  // 보기 순서를 섞어서 정답 위치가 고정되지 않게
  const order = [0, 1, 2, 3].sort(() => Math.random() - .5);
  return { ...q0, options: order.map((i) => q0.options[i]), answer: order.indexOf(q0.answer) };
}
function cleanName(raw) {
  const n = (raw || "").trim().slice(0, 10);
  if (!n) return { err: "이름을 입력해 주세요." };
  const flat = n.toLowerCase().replace(/\s/g, "");
  if (BAD_WORDS.some((w) => flat.includes(w))) return { err: "쓸 수 없는 이름이에요. 다른 이름으로 해 주세요." };
  return { name: n };
}
function newPlayer(id, name, look) {
  const s = freeSpot();
  const cls = ITEM_CLASS[look.it % ITEM_CLASS.length];
  return {
    id, name, look, cls, team: 0,
    x: s.x, y: s.y, ix: 0, iy: 0, face: 1, walk: 0, moving: false,
    score: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0,
    boxCount: 0, distance: 0, capPoints: 0,
    items: [], speedUntil: 0, ghostUntil: 0, safeUntil: 0, dodgeUntil: 0, dodgeReady: 0, portalCool: 0,
    guard: cls === "shield" ? 2 : 0,
    duel: null, recent: new Map(), seen: new Set(), wrong: [], cards: [],
    connected: true, socketId: null, zoneTick: 0, capTick: 0, prevRank: 0,
    downUntil: 0, tier: 0, lostTo: new Set(), duelCount: 0, bossKills: 0,
    xp: 0, level: 1, keys: 0, minionKills: 0, chestT: 0, chestId: 0, boxLock: {},
    q: { win1: 0, duel5: 0, streak3: 0, boss1: 0, box5: 0, cap3: 0 }, qDone: {},
  };
}
const teamCount = () => (G.mode === "team4" ? 4 : G.mode === "team2" ? 2 : 0);
function assignTeams() {
  const n = teamCount();
  if (!n) { for (const p of G.players.values()) p.team = 0; return; }
  const list = [...G.players.values()].sort(() => Math.random() - .5);
  list.forEach((p, i) => (p.team = i % n));
  pushLog(`${n}팀으로 나뉘었습니다`, "hot");
}
function teamScores() {
  const n = teamCount();
  if (!n) return [];
  const arr = TEAMS.slice(0, n).map((t) => ({ ...t, score: 0, members: 0 }));
  for (const p of G.players.values()) { arr[p.team].score += p.score; arr[p.team].members++; }
  return arr.slice().sort((a, b) => b.score - a.score);
}
const addScore = (p, d) => {
  p.score = Math.max(SCORE_FLOOR, p.score + d);
  const tier = TIERS.indexOf(tierOf(p.score));
  if (tier > p.tier && G.phase === "playing") {           // 승급
    p.tier = tier;
    const T = TIERS[tier];
    pushLog(`${T.icon} ${p.name} 승급 → ${T.name}`, "gold");
    if (tier >= 3) bigEvent(`${T.icon} ${p.name} → ${T.name} 승급!`, "gold");
    p.glowUntil = now() + 2500;
    if (p.socketId) io.to(p.socketId).emit("tierUp", { name: T.name, icon: T.icon });
  } else if (tier < p.tier) p.tier = tier;
};
function quest(p, id, add) {
  if (!QUESTS.some((q) => q.id === id) || p.qDone[id]) return;
  p.q[id] = (p.q[id] || 0) + (add || 1);
  const Q = QUESTS.find((q) => q.id === id);
  if (p.q[id] >= Q.need) {
    p.qDone[id] = true; addScore(p, Q.bonus); addXp(p, XP.quest, "도전과제");
    pushLog(`🏅 ${p.name} 도전과제 달성 — ${Q.name} (+${Q.bonus})`, "gold");
    if (p.socketId) io.to(p.socketId).emit("quest", { name: Q.name, bonus: Q.bonus, desc: Q.desc });
  }
}
function isUnderdog(p) {
  const list = [...G.players.values()].sort((a, b) => b.score - a.score);
  if (list.length < 6) return false;
  return list.findIndex((x) => x.id === p.id) >= Math.floor(list.length * .7);
}

/* ═════════ 대결 ═════════ */
function startDuel(a, b, ambush) {
  const region = regionOf((a.y + b.y) / 2, (a.x + b.x) / 2);
  const q = pickQuestion(a, b, region);
  if (!q) return;
  const id = G.nextDuelId++;
  let limit = DUEL_TIME + readTime(q) + Math.round(Math.max((a.level || 1), (b.level || 1)) - 1) * .3 + ((hasPerk(a, 6) || hasPerk(b, 6)) ? 3 : 0);
  if (a.cls === "scroll" || b.cls === "scroll") limit += 4;
  if (a.items.includes("time") || b.items.includes("time")) limit += 6;
  if (isUnderdog(a) || isUnderdog(b)) limit += 2;
  const used = { [a.id]: [], [b.id]: [] };
  const take = (p, k) => { const i = p.items.indexOf(k); if (i >= 0) { p.items.splice(i, 1); used[p.id].push(BOX_ITEMS[k].icon + " " + BOX_ITEMS[k].name); return true; } return false; };
  const wantHint = (p) => take(p, "hint") || (p.cls === "lamp" && Math.random() < .25 && (used[p.id].push("🕯 등불 특성"), true));
  const d = { id, a: a.id, b: b.id, q, limit, region, endsAt: now() + limit * 1000, picks: {}, boss: false,
    hint: { [a.id]: wantHint(a), [b.id]: wantHint(b) },
    bonus: { [a.id]: take(a, "double"), [b.id]: take(b, "double") },
    shield: { [a.id]: take(a, "shield"), [b.id]: take(b, "shield") }, used,
    ambush: ambush ? a.id : null, lock: ambush ? { [b.id]: now() + (hasPerk(a, 8) ? 2500 : AMBUSH_LOCK) } : {} };
  if (a.items.includes("time") || b.items.includes("time")) { take(a, "time"); take(b, "time"); }
  if (ambush) { a.ghostUntil = 0; a.ambushes = (a.ambushes || 0) + 1; }
  a.duel = id; b.duel = id; a.duelCount++; b.duelCount++;
  quest(a, "duel5"); quest(b, "duel5");
  G.duels.set(id, d);
  sendDuel(a, d); sendDuel(b, d);
  pushLog(ambush ? `🗡 ${a.name} 이(가) ${b.name}을(를) 기습!` : `${a.name} ⚔ ${b.name}`, ambush ? "hot" : "");
}
function startBossDuel(p, boss) {
  const q = pickQuestion(p, null, regionOf(p.y, p.x), true);
  if (!q) return;
  const B = BOSSES[boss.type];
  const id = G.nextDuelId++;
  const limit = B.limit + readTime(q) + (p.cls === "scroll" ? 4 : 0) + (hasPerk(p, 6) ? 3 : 0);
  const d = { id, a: p.id, b: null, q, limit, region: regionOf(p.y, p.x), endsAt: now() + limit * 1000,
              picks: {}, boss: boss.type, bossId: boss.id,
              hint: { [p.id]: false }, bonus: {}, shield: {} };       // 보스전엔 힌트 없음
  p.duel = id; p.duelCount++; boss.busyUntil = now() + limit * 1000 + 500;
  G.duels.set(id, d);
  sendDuel(p, d);
  pushLog(`⚔ ${p.name} 이(가) ${B.name}과 맞섰습니다!`, "hot");
  bigEvent(`${p.name} vs ${B.name}`, "hot");
}
function hiddenOption(d, pid) {
  if (!d.hint[pid]) return -1;
  const wrong = d.q.options.map((_, i) => i).filter((i) => i !== d.q.answer);
  return wrong[(d.id + pid.charCodeAt(0)) % wrong.length];
}
function sendDuel(p, d) {
  if (!p.socketId) return;
  const foe = d.boss ? null : G.players.get(d.a === p.id ? d.b : d.a);
  io.to(p.socketId).emit("duel", {
    id: d.id, endsAt: d.endsAt, limit: d.limit, boss: d.boss, region: d.region, kind: d.kind || (d.boss ? "boss" : "pvp"),
    minion: d.minion || null,
    question: d.q.text, options: d.q.options, hide: hiddenOption(d, p.id),
    foe: d.kind === "minion" ? { name: MINIONS[d.minion].name, minion: d.minion, xp: MINIONS[d.minion].xp }
       : d.kind === "chest" ? { name: "자물쇠", chest: true }
       : d.boss ? { name: BOSSES[d.boss].name, boss: d.boss, score: 0, reward: BOSSES[d.boss].reward, penalty: BOSSES[d.boss].penalty }
               : foe && { name: foe.name, look: { ...foe.look, tier: tierIdx(foe.score) }, score: foe.score, streak: foe.streak, team: foe.team },
    bonus: !!d.bonus[p.id], shield: !!d.shield[p.id], used: (d.used && d.used[p.id]) || [],
    ambush: d.ambush ? (d.ambush === p.id ? "attacker" : "victim") : null,
    lock: d.lock && d.lock[p.id] ? Math.max(0, d.lock[p.id] - now()) : 0,
  });
}
function noteWrong(p, d, myChoice) {
  p.wrong.push({ id: d.q.id, q: d.q.text, options: d.q.options, answer: d.q.answer,
                 mine: myChoice, ref: d.q.ref, exp: d.q.exp });
  if (p.wrong.length > 40) p.wrong.shift();
}
function giveCard(p, q) {
  if (!q.ref) return null;
  const card = { ref: q.ref, exp: q.exp, q: q.text };
  if (!p.cards.some((c) => c.ref === card.ref)) p.cards.push(card);
  return card;
}
function resolveDuel(d) {
  if (!G.duels.has(d.id)) return;
  if (d.graceTimer) { clearTimeout(d.graceTimer); d.graceTimer = null; }
  G.duels.delete(d.id);
  if (G.featured === d.id) G.featured = null;
  const res = { answer: d.q.answer, options: d.q.options, question: d.q.text, ref: d.q.ref, exp: d.q.exp };
  const t = now();
  const showReveal = (win) => {
    if (G.featured === d.id || G.revealAlways) {}
    G.reveal = { id: d.id, boss: !!d.boss, q: d.q.text, options: d.q.options, answer: d.q.answer,
                 ref: d.q.ref, exp: d.q.exp, winner: win,
                 a: revealSide(d, d.a), b: d.boss ? { name: BOSSES[d.boss].name, boss: d.boss } : revealSide(d, d.b),
                 until: t + 4500 };
  };

  if (d.kind === "minion" || d.kind === "chest") {
    const p = G.players.get(d.a); if (!p) return;
    p.duel = null; p.safeUntil = t + 1500;
    const pk = d.picks[p.id], ok = pk && pk.correct;
    if (d.kind === "minion") {
      const m = G.minions.find((x) => x.id === d.minionId), M = MINIONS[d.minion];
      if (ok) {
        p.minionKills++; addXp(p, M.xp, M.name + " 처치");
        let key = false; if (Math.random() < M.key + (hasPerk(p, 4) ? .2 : 0)) { p.keys++; key = true; }
        if (m) { m.dead = true; m.respawnAt = t + 15000; }
        if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...res, result: "win", gain: 0, kind: "minion", xp: M.xp, key, minion: d.minion });
      } else {
        noteWrong(p, d, pk ? pk.choice : -1);
        if (m) m.busyUntil = t + 4000;
        if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...res, result: "lose", gain: 0, kind: "minion", minion: d.minion });
      }
    } else {
      const b = G.boxes.find((x) => x.id === d.boxId);
      if (b) b.busy = false;
      if (ok && b) { openBox(p, b); if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...res, result: "win", gain: 0, kind: "chest", opened: true }); }
      else { noteWrong(p, d, pk ? pk.choice : -1); p.boxLock[d.boxId] = t + 10000;
             if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...res, result: "lose", gain: 0, kind: "chest" }); }
    }
    return;
  }
  if (d.boss) {
    const p = G.players.get(d.a), B = BOSSES[d.boss], boss = G.bosses.find((b) => b.id === d.bossId);
    if (!p) return;
    p.duel = null; p.safeUntil = t + AFTER_DUEL * 1000;
    if (boss) boss.busyUntil = 0;
    const pk = d.picks[p.id];
    if (pk && pk.correct) {
      const gain = B.reward * scoreMult(t);
      addScore(p, gain); p.wins++; p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak); p.bossKills++;
      quest(p, "boss1"); quest(p, "win1"); if (p.streak >= 3) quest(p, "streak3", 3);
      addXp(p, Math.round(XP.boss * ((p.level || 1) <= 3 ? 1.5 : 1)), B.name + " 격파" + ((p.level || 1) <= 3 ? " (저레벨 보너스)" : ""));
      p.emote = 1 + (Math.random() * EMOTES.length | 0); p.emoteUntil = t + 2800;
      pushLog(`🏅 ${p.name} 이(가) ${B.name}을 이겼습니다! +${gain}점`, "gold");
      bigEvent(`🏅 ${p.name} ${B.name} 격파! +${gain}`, "gold");
      if (boss) { boss.dead = true; boss.respawnAt = t + (boss.type === "amalek" ? BOSS_RESPAWN_FAST : BOSS_RESPAWN);
        if (boss.type === "amalek" && G.bosses.filter((x) => x.type === "amalek" && !x.dead).length === 0) { /* 둘 다 죽으면 하나만 되살림 */ }
        if (boss.type === "pharaoh") { G.boxes.push({ id: G.nextBoxId++, x: boss.x, y: boss.y, type: "gold", tier: 1 }); pushLog("👑 바로 왕이 황금 상자를 떨어뜨렸습니다!", "gold"); } }
      showReveal(p.name);
      if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...res, result: "win", gain, boss: d.boss, sticker: STICKERS[Math.random() * STICKERS.length | 0], card: giveCard(p, d.q) });
    } else {
      addScore(p, -B.penalty); p.losses++; p.streak = 0;
      noteWrong(p, d, pk ? pk.choice : -1);
      if (d.boss === "serpent" && p.items.length) { pushLog(`🐍 ${p.name} 이(가) 에덴의 뱀에게 아이템 ${p.items.length}개를 빼앗겼습니다`, "draw"); p.items = []; }
      p.downUntil = t + (hasPerk(p, 9) ? DOWN_MS / 2 : DOWN_MS);   // 쓰러짐 → 5초(Lv9: 2.5초) 뒤 부활
      pushLog(`${p.name} 이(가) ${B.name}에게 쓰러졌습니다`, "draw");
      showReveal(B.name);
      if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...res, result: "lose", gain: -B.penalty, boss: d.boss, down: DOWN_MS / 1000 });
    }
    return;
  }

  const a = G.players.get(d.a), b = G.players.get(d.b);
  if (!a || !b) return;
  const pa = d.picks[d.a], pb = d.picks[d.b];
  const aOk = pa && pa.correct, bOk = pb && pb.correct;
  let winner = null, loser = null;
  if (aOk && bOk) {
    // 거의 같은 순간에 맞혔다면 우열을 가리지 않고 무승부
    if (Math.abs(pa.at - pb.at) > TIE_WINDOW) {
      winner = pa.at < pb.at ? a : b; loser = winner === a ? b : a;
    }
  }
  else if (aOk) { winner = a; loser = b; }
  else if (bOk) { winner = b; loser = a; }

  if (!winner) {
    [a, b].forEach((p) => {
      p.draws++; p.streak = 0;
      const pk = d.picks[p.id];
      noteWrong(p, d, pk ? pk.choice : -1);
      let g = 0;
      if (p.cls === "harp") { addScore(p, 1); g = 1; }
      addXp(p, XP.draw, "무승부");
      if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...res, result: "draw", gain: g });
    });
    pushLog(`${a.name} vs ${b.name} — 무승부`, "draw");
    showReveal(null);
  } else {
    let gain = 1; const tags = [];
    if (d.bonus[winner.id]) gain++;
    if (loser.streak >= 3) { gain++; tags.push("연승 저지"); }
    if (G.leaderId === loser.id) { gain += 2; tags.push("👑 1위 사냥"); }
    if (winner.lostTo.has(loser.id)) { gain++; tags.push("설욕!"); winner.lostTo.delete(loser.id); }
    if (d.ambush === winner.id) { gain++; tags.push("🗡 기습 성공"); winner.ambushWins = (winner.ambushWins || 0) + 1; }
    if (hasPerk(winner, 10)) { gain++; tags.push("👑 황금 오라"); }
    const ns = winner.streak + 1;
    if (ns >= 5) gain += 2; else if (ns >= 3) gain += 1;
    gain *= scoreMult(t); if (scoreMult(t) > 1) tags.push("⚡ 2배");
    loser.lostTo.add(winner.id);
    addScore(winner, gain); winner.wins++; winner.streak = ns;
    winner.bestStreak = Math.max(winner.bestStreak, ns);
    quest(winner, "win1"); if (ns >= 3) quest(winner, "streak3", 3);
    { const diff = (loser.level || 1) - (winner.level || 1);
      const mul = diff > 0 ? Math.min(3, 1 + diff * .5) : 1;      // 낮은 레벨이 높은 레벨을 이기면 최대 3배
      addXp(winner, Math.round(XP.win * mul), diff > 0 ? `하극상! Lv${loser.level} 격파 ×${mul.toFixed(1)}` : "대결 승리");
      if (diff > 0) tags.push(`🐣 하극상 ×${mul.toFixed(1)} XP`);
      addXp(loser, 5 + Math.max(0, -diff) * 3, ""); }               // 높은 레벨에게 진 쪽도 조금
    let lost = 1;
    if (d.shield[loser.id]) lost = 0;
    else if (loser.cls === "shield" && loser.guard > 0) { lost = 0; loser.guard--; }
    else if ((loser.lvShield || 0) > 0) { lost = 0; loser.lvShield--; }
    if (loser.score <= SCORE_FLOOR) lost = 0;
    addScore(loser, -lost); loser.losses++; loser.streak = 0;
    const pk = d.picks[loser.id];
    noteWrong(loser, d, pk ? pk.choice : -1);
    pushLog(`${winner.name} 승 · ${loser.name} 패 (+${gain}/-${lost})`, "win");
    bigEvent(`${winner.name} 승리! +${gain}`, "win");
    if (ns === 3) { pushLog(`🔥 ${winner.name} 3연승!`, "hot"); bigEvent(`🔥 ${winner.name} 3연승`, "hot"); }
    if (ns === 5) bigEvent(`🔥🔥 ${winner.name} 5연승!`, "gold");
    showReveal(winner.name);
    winner.emote = 1 + (Math.random() * EMOTES.length | 0); winner.emoteUntil = t + 2800;
    const sticker = STICKERS[Math.random() * STICKERS.length | 0];
    loser.downUntil = t + (hasPerk(loser, 9) ? DOWN_DUEL_MS / 2 : DOWN_DUEL_MS);   // 진 쪽은 쓰러졌다가 부활
    if (winner.socketId) io.to(winner.socketId).emit("duelEnd", { ...res, result: "win", gain, streak: ns, tags, sticker, card: giveCard(winner, d.q) });
    if (loser.socketId) io.to(loser.socketId).emit("duelEnd", { ...res, result: "lose", gain: -lost, saved: lost === 0, down: (hasPerk(loser, 9) ? DOWN_DUEL_MS / 2 : DOWN_DUEL_MS) / 1000 });
  }

  [a, b].forEach((p) => { p.duel = null; p.safeUntil = t + AFTER_DUEL * 1000; });
  a.recent.set(b.id, t + REMATCH * 1000); b.recent.set(a.id, t + REMATCH * 1000);
  const dx = a.x - b.x, dy = a.y - b.y, len = Math.hypot(dx, dy) || 1;
  const push = (p, sx, sy) => {
    for (let k = 36; k > 0; k -= 12) {
      const nx = clamp(p.x + sx * k, R, MAP.W - R), ny = clamp(p.y + sy * k, R, MAP.H - R);
      if (!blocked(nx, ny)) { p.x = nx; p.y = ny; return; }
    }
  };
  push(a, dx / len, dy / len); push(b, -dx / len, -dy / len);
}

/* ═════════ 루프 ═════════ */
let lastTick = now(), tickSum = 0, tickN = 0;
setInterval(() => {
  const t0 = now();
  const dt = Math.min(.1, (t0 - lastTick) / 1000);
  lastTick = t0;
  if (G.phase === "countdown" && t0 >= G.countdownEnd) beginPlay();
  if (G.phase === "playing") step(dt, t0);
  const cost = now() - t0;
  tickSum += cost; tickN++;
  if (cost > G.stats.tickMax) G.stats.tickMax = cost;
  if (tickN >= 20) { G.stats.tickAvg = +(tickSum / tickN).toFixed(2); tickSum = 0; tickN = 0; }
}, TICK);

function speedOf(p, t) {
  let sp = SPEED * (1 + Math.min(9, (p.level || 1) - 1) * .02);   // 레벨당 +2%
  if (p.cls === "sling") sp *= 1.12;
  if (t < p.speedUntil) sp *= 1.8;
  if (t < p.dodgeUntil) sp *= 1.6;
  if (tileAt(p.x, p.y) === 6) sp *= .55;
  return sp;
}
function applyMove(p, x, y, dt, t) {
  const len = Math.hypot(x, y);
  if (len < .12) return;
  const sp = speedOf(p, t);
  const ux = x / Math.max(1, len), uy = y / Math.max(1, len);
  if (ux < -.15) p.face = -1; else if (ux > .15) p.face = 1;
  const nx = clamp(p.x + ux * sp * dt, R, MAP.W - R);
  if (!blocked(nx, p.y)) { p.distance += Math.abs(nx - p.x); p.x = nx; }
  const ny = clamp(p.y + uy * sp * dt, R, MAP.H - R);
  if (!blocked(p.x, ny)) { p.distance += Math.abs(ny - p.y); p.y = ny; }
  p.walk += sp * dt;
  if (tileAt(p.x, p.y) === 7 && t > p.portalCool) {
    for (const [x1, x2] of MAP.portals) {
      const to = Math.hypot(p.x - x1.x, p.y - x1.y) < 26 ? x2
               : Math.hypot(p.x - x2.x, p.y - x2.y) < 26 ? x1 : null;
      if (to) { p.x = to.x; p.y = to.y; p.portalCool = t + 2500;
                if (p.socketId) io.to(p.socketId).emit("portal", { x: to.x | 0, y: to.y | 0 }); break; }
    }
  }
}
/* 수풀 안에 있으면 가까이 오기 전엔 안 보입니다 */
const hidden = (p) => tileAt(p.x, p.y) === 5;
/* 은신 = 수풀 잠복 또는 구름 기둥. 은신 중엔 대결이 자동으로 안 붙고, 기습 버튼으로만 걸 수 있습니다 */
const stealth = (p, t) => hidden(p) || t < p.ghostUntil;
/* 레이더: 가장 가까운 '싸울 수 있는' 상대 방향 (은신·쓰러짐·대결 중·같은 팀 제외). [dx, dy, 거리] */
function nearestEnemy(p, t) {
  if (p.duel || t < p.downUntil) return null;
  let best = null, bd = 1e9;
  for (const o of G.players.values()) {
    if (o === p || !o.connected || o.duel || t < o.downUntil || stealth(o, t)) continue;
    if (teamCount() && o.team === p.team) continue;
    if ((p.recent.get(o.id) || 0) > t) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return null;
  return [Math.round((best.x - p.x) / bd * 100) / 100, Math.round((best.y - p.y) / bd * 100) / 100, bd | 0];
}
function ambushTarget(p, t) {
  if (!stealth(p, t) || p.duel || t < p.downUntil) return null;
  let best = null, bd = 90;
  for (const o of G.players.values()) {
    if (o === p || !o.connected || o.duel || t < o.safeUntil || t < o.downUntil || stealth(o, t)) continue;
    if (teamCount() && o.team === p.team) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function step(dt, t) {
  if (t >= G.endsAt) return endGame();
  updateZone(t); updateBoss(dt, t); updateMinions(dt, t); updateTreasure(t);

  for (const p of G.players.values()) {
    if (p.downUntil) {                                   // 쓰러진 뒤 부활
      if (t < p.downUntil) { p.moving = false; continue; }
      const sp = farSpot(200); p.x = sp.x; p.y = sp.y; p.downUntil = 0; p.safeUntil = t + 3000;
      if (p.socketId) io.to(p.socketId).emit("respawn", { x: sp.x | 0, y: sp.y | 0 });
      pushLog(`${p.name} 부활!`);
    }
    p.moving = !p.duel && (t - (p.lastInput || 0) < 180) && Math.hypot(p.ix, p.iy) > .12;
    let nearBox = null;
    for (const b of G.boxes) if (Math.abs(p.x - b.x) < 30 && Math.abs(p.y - b.y) < 32) { nearBox = b; break; }
    if (nearBox && !p.duel && t >= p.downUntil) {
      const b = nearBox;
      if ((p.boxLock[b.id] || 0) > t) { /* 자물쇠 퀴즈 실패 후 잠금 */ }
      else if (b.tier === 0) {                          // 나무 상자: 2.5초 동안 서 있기
        if (p.chestId !== b.id) { p.chestId = b.id; p.chestT = t; }
        else if (!p.moving && t - p.chestT >= (hasPerk(p, 3) ? 1200 : 2500)) openBox(p, b);
        else if (p.moving) p.chestT = t;
      } else if (b.tier === 1) {                        // 금테 상자: 자물쇠 퀴즈
        if (!b.busy) startChestDuel(p, b);
      } else {                                          // 전설·황금: 열쇠 필요
        if (p.keys > 0) { p.keys--; openBox(p, b); }
        else if (t > (p.keyToldAt || 0)) { p.keyToldAt = t + 4000; if (p.socketId) io.to(p.socketId).emit("needKey", { tier: b.tier }); }
      }
    } else { p.chestId = 0; }
    let onCap = null;
    for (const c of MAP.caps) if (Math.hypot(p.x - c.x, p.y - c.y) < c.r) onCap = c;
    if (onCap) {
      if (!p.capTick) p.capTick = t;
      else if (t - p.capTick >= CAP_PERIOD) {
        p.capTick = t; addScore(p, scoreMult(t)); p.capPoints++; quest(p, "cap3"); addXp(p, XP.cap, "");
        pushLog(`${p.name} 이(가) ${onCap.name}을(를) 지켜 +${scoreMult(t)}점`, "gold");
        if (p.socketId) io.to(p.socketId).emit("capture", { name: onCap.name });
      }
    } else p.capTick = 0;
    if (G.treasure && Math.hypot(p.x - G.treasure.x, p.y - G.treasure.y) < 34) {
      addScore(p, 5 * scoreMult(t)); addXp(p, XP.treasure, "보물");
      pushLog(`💎 ${p.name} 이(가) 숨겨진 보물을 찾았습니다! +${5 * scoreMult(t)}점`, "gold");
      bigEvent(`💎 ${p.name} 보물 발견! +5점`, "gold");
      if (p.socketId) io.to(p.socketId).emit("treasure");
      G.treasure = null; G.nextTreasure = t + TREASURE_EVERY;
    }
  }

  const grid = new Map(), ready = [];
  for (const p of G.players.values()) {
    if (!p.connected || p.duel || t < p.safeUntil || t < p.dodgeUntil || t < p.downUntil || stealth(p, t)) continue;
    ready.push(p);
    const k = ((p.x / CELL) | 0) + ":" + ((p.y / CELL) | 0);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  for (const p of ready) {
    if (p.duel) continue;
    // ① 사람끼리 (가장 우선)
    const cx = (p.x / CELL) | 0, cy = (p.y / CELL) | 0;
    for (let gx = cx - 1; gx <= cx + 1 && !p.duel; gx++)
      for (let gy = cy - 1; gy <= cy + 1 && !p.duel; gy++) {
        const cell = grid.get(gx + ":" + gy);
        if (!cell) continue;
        for (const o of cell) {
          if (o === p || o.duel || o.id < p.id) continue;
          if (teamCount() && o.team === p.team) continue;
          if (Math.hypot(p.x - o.x, p.y - o.y) > MEET) continue;
          if ((p.recent.get(o.id) || 0) > t) continue;
          startDuel(p, o); break;
        }
      }
    if (p.duel) continue;
    // ② 보스
    const hitBoss = G.bosses.find((b) => !b.dead && t >= b.busyUntil && Math.hypot(p.x - b.x, p.y - b.y) < 44);
    if (hitBoss) { startBossDuel(p, hitBoss); continue; }
    // ③ 미니언 (직전 미니언 대결 후 8초는 통과)
    if (t >= (p.minionCool || 0)) {
      const hitMin = G.minions.find((m) => !m.dead && t >= m.busyUntil && Math.hypot(p.x - m.x, p.y - m.y) < 26);
      if (hitMin) { startMinionDuel(p, hitMin); continue; }
    }
  }
  for (const d of [...G.duels.values()]) if (t >= d.endsAt) resolveDuel(d);
  autoFeature(t);
  if (G.boxes.length < boxTarget() && t >= (G.boxCool || 0)) { spawnBox(); G.boxCool = t + BOX_RESPAWN; }
  // 골든타임 안내
  if (!G.goldenTold && t >= G.endsAt - 60000) { G.goldenTold = true; pushLog("⚡ 골든타임! 남은 1분, 모든 점수 2배", "gold"); bigEvent("⚡ 골든타임 — 점수 2배!", "gold"); }
  // 1위 표시
  const top = [...G.players.values()].sort((a, b) => b.score - a.score)[0];
  G.leaderId = top && top.score >= 3 ? top.id : null;
}
const golden = (t) => G.phase === "playing" && t >= G.endsAt - 60000;
const scoreMult = (t) => golden(t) ? 2 : 1;

function openBox(p, b) {
  const i = G.boxes.indexOf(b); if (i < 0) return;
  G.boxes.splice(i, 1); giveItem(p, b.type, b.tier, b.x, b.y);
  G.opened.push([b.x | 0, b.y | 0, b.tier, now()]);
  p.chestId = 0;
}
function giveItem(p, type, tier, bx, by) {
  const t = now();
  p.boxCount++; quest(p, "box5"); addXp(p, XP.chest + tier * 10, "상자");
  let mult = p.cls === "staff" ? 1.5 : 1;
  if (isUnderdog(p)) mult *= 1.5;
  if (type === "speed") p.speedUntil = t + 10000 * mult;
  else if (type === "ghost") p.ghostUntil = t + 10000 * mult;
  else if (type === "gold") { addScore(p, 2 * scoreMult(t)); pushLog(`${p.name} 황금 상자! +${2 * scoreMult(t)}점`, "gold"); }
  else if (type === "crown") {
    addScore(p, 3); p.speedUntil = t + 20000; p.ghostUntil = t + 20000; p.items = ["shield", "double"];
    pushLog(`👑 ${p.name} 전설의 왕관! +3점`, "gold");
    bigEvent(`👑 ${p.name} 전설 상자!`, "gold");
  } else { p.items.push(type); if (p.items.length > 2) p.items.shift(); }
  if (p.socketId) io.to(p.socketId).emit("pickup", { type, tier: tier | 0, x: bx | 0, y: by | 0, ...BOX_ITEMS[type] });
}
function updateZone(t) {                 // 안전지대 축소는 없앴습니다. 후반 리워야단 등장만 담당
  const ratio = (t - G.startedAt) / (G.endsAt - G.startedAt);
  if (ratio > .75 && !G.leviathanDone) { G.leviathanDone = true; spawnBoss("leviathan"); }
}
function nearestBush(b) {
  let best = null, bd = 1e9;
  for (let y = 1; y < MAP.TH - 1; y++) for (let x = 1; x < MAP.TW - 1; x++) if (MAP.t[y * MAP.TW + x] === 5) {
    const cx = x * TS + TS / 2, cy = y * TS + TS / 2, d = Math.hypot(cx - b.x, cy - b.y);
    if (d < bd && d > 60) { bd = d; best = { x: cx, y: cy }; }
  }
  return best;
}
function farSpot(minD) {
  let best = null, bd = -1;
  for (let i = 0; i < 20; i++) {
    const c = freeSpot(); let m = 1e9;
    for (const q of G.players.values()) m = Math.min(m, Math.hypot(q.x - c.x, q.y - c.y));
    for (const b of G.bosses) if (!b.dead) m = Math.min(m, Math.hypot(b.x - c.x, b.y - c.y) * .6);
    if (m > bd) { bd = m; best = c; }
    if (m >= minD) break;
  }
  return best || freeSpot();
}
/* ── 미니언: 부딪히면 쉬운 문제, 맞히면 경험치(+열쇠 확률). 지면 아무 손해 없음 ── */
const MINIONS = {
  soldier: { name: "블레셋 병사", speed: 38, xp: 15, key: .3,  limit: 12, mode: "patrol" },
  fox:     { name: "광야 여우",   speed: 92, xp: 30, key: .5,  limit: 12, mode: "flee" },
  locust:  { name: "메뚜기 떼",   speed: 55, xp: 10, key: .15, limit: 11, mode: "swarm" },
};
const minionTarget = () => Math.min(30, 8 + Math.round(G.players.size * .35));   // 60명이면 29마리
function spawnMinion(type) {
  const s = farSpot(200);
  const m = { id: G.nextMinionId++, type, x: s.x, y: s.y, tx: s.x, ty: s.y, face: 1, walk: 0, dead: false, busyUntil: 0 };
  G.minions.push(m); return m;
}
function fillMinions() {
  while (G.minions.filter((m) => !m.dead).length < minionTarget()) {
    const r = Math.random();
    if (r < .45) spawnMinion("soldier");
    else if (r < .7) spawnMinion("fox");
    else { const base = spawnMinion("locust"); for (let k = 0; k < 2; k++) { const l = spawnMinion("locust"); l.x = base.x + (Math.random() - .5) * 60; l.y = base.y + (Math.random() - .5) * 60; } }
  }
}
function updateMinions(dt, t) {
  for (const m of G.minions) {
    if (m.dead) { if (t >= m.respawnAt) { const s = farSpot(200); Object.assign(m, { x: s.x, y: s.y, tx: s.x, ty: s.y, dead: false, busyUntil: 0 }); } continue; }
    if (t < m.busyUntil) continue;
    const M = MINIONS[m.type];
    let sp = M.speed;
    let near = null, nd = 1e9;
    for (const p of G.players.values()) { if (!p.connected || p.duel || t < p.downUntil) continue; const d = Math.hypot(p.x - m.x, p.y - m.y); if (d < nd) { nd = d; near = p; } }
    if (M.mode === "flee" && near && nd < 220) { m.tx = m.x + (m.x - near.x) / nd * 200; m.ty = m.y + (m.y - near.y) / nd * 200; sp *= 1.15; }
    else if (Math.hypot(m.tx - m.x, m.ty - m.y) < 12 || t > (m.retarget || 0)) {
      m.retarget = t + 2500 + Math.random() * 3000;
      const rr = M.mode === "swarm" ? 90 : 220;
      m.tx = clamp(m.x + (Math.random() - .5) * rr * 2, R, MAP.W - R); m.ty = clamp(m.y + (Math.random() - .5) * rr * 2, R, MAP.H - R);
    }
    const dd = Math.hypot(m.tx - m.x, m.ty - m.y) || 1, ux = (m.tx - m.x) / dd, uy = (m.ty - m.y) / dd;
    const nx = clamp(m.x + ux * sp * dt, R, MAP.W - R); if (!blocked(nx, m.y)) m.x = nx; else m.tx = m.x - ux * 100;
    const ny = clamp(m.y + uy * sp * dt, R, MAP.H - R); if (!blocked(m.x, ny)) m.y = ny; else m.ty = m.y - uy * 100;
    m.face = ux < 0 ? -1 : 1; m.walk += sp * dt;
  }
}
function startMinionDuel(p, m) {
  const M = MINIONS[m.type];
  const q = pickQuestion(p, null, regionOf(p.y, p.x), false, true);
  if (!q) return;
  const id = G.nextDuelId++;
  const limit = M.limit + readTime(q);
  const d = { id, a: p.id, b: null, q, limit, region: regionOf(p.y, p.x), endsAt: now() + limit * 1000, picks: {},
              boss: false, kind: "minion", minion: m.type, minionId: m.id, hint: {}, bonus: {}, shield: {}, used: {}, lock: {} };
  p.duel = id; m.busyUntil = now() + limit * 1000 + 300; p.minionCool = now() + limit * 1000 + 8000;   // 끝난 뒤 8초는 미니언과 안 붙음
  G.duels.set(id, d); sendDuel(p, d);
}
function startChestDuel(p, b) {
  const q = pickQuestion(p, null, regionOf(p.y, p.x), false, true);
  if (!q) return;
  const id = G.nextDuelId++;
  const limit = 12 + readTime(q);
  const d = { id, a: p.id, b: null, q, limit, region: regionOf(p.y, p.x), endsAt: now() + limit * 1000, picks: {},
              boss: false, kind: "chest", boxId: b.id, hint: {}, bonus: {}, shield: {}, used: {}, lock: {} };
  p.duel = id; b.busy = true; p.chestId = 0;
  G.duels.set(id, d); sendDuel(p, d);
}
function spawnBoss(type) {
  const s = farSpot(350);
  const b = { id: G.nextBossId++, type, x: s.x, y: s.y, dead: false, face: 1, walk: 0, busyUntil: 0 };
  G.bosses.push(b);
  pushLog(`⚔ ${BOSSES[type].name} 등장!`, "hot"); bigEvent(`⚔ ${BOSSES[type].name} 등장`, "hot");
  return b;
}
function updateBoss(dt, t) {
  for (const b of G.bosses) {
    if (b.dead) {
      if (t >= b.respawnAt) {
        // 죽은 보스는 다른 종류로 바뀌어 다시 나타납니다 (리워야단은 한 번만)
        let nextType = BOSS_ROTATION[Math.random() * BOSS_ROTATION.length | 0];
        if (nextType === b.type) nextType = BOSS_ROTATION[(BOSS_ROTATION.indexOf(nextType) + 1) % BOSS_ROTATION.length];
        const s = farSpot(350);                         // 사람들에게서 먼 임의의 장소에 다시 등장
        Object.assign(b, { type: nextType, x: s.x, y: s.y, dead: false, walk: 0, busyUntil: 0, tpNext: 0 });
        if (nextType === "amalek") spawnBoss("amalek");
        pushLog(`⚔ ${BOSSES[nextType].name} 등장!`, "hot"); bigEvent(`⚔ ${BOSSES[nextType].name} 등장`, "hot");
      }
      continue;
    }
    if (t < b.busyUntil) continue;                       // 싸우는 중엔 제자리
    const B = BOSSES[b.type];
    let sp = B.speed, tx = null, ty = null, target = null, bd = 1e9;
    for (const p of G.players.values()) {
      if (p.duel || !p.connected || t < p.ghostUntil || t < p.safeUntil || t < p.downUntil) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < bd) { bd = d; target = p; }
    }
    if (b.type === "pharaoh") {                          // 거점 순찰 — 가까운 사람이 있으면 그쪽으로
      if (!b.capIdx || t > (b.capSwitch || 0)) { b.capIdx = ((b.capIdx || 0) % MAP.caps.length) + 1; b.capSwitch = t + 14000; }
      const c = MAP.caps[(b.capIdx - 1) % MAP.caps.length];
      if (target && bd < 220) { tx = target.x; ty = target.y; } else { tx = c.x; ty = c.y; }
    } else if (b.type === "goliath") {                   // 돌진
      if (t > (b.dashNext || 0) && target && bd < 420) { b.dashUntil = t + 1000; b.dashNext = t + 6000; b.dx = (target.x - b.x) / bd; b.dy = (target.y - b.y) / bd;
        if (target.socketId) io.to(target.socketId).emit("aggro", { name: B.name, type: b.type, x: b.x | 0, y: b.y | 0, dash: true }); }
      if (t < b.dashUntil) { sp *= 3; tx = b.x + b.dx * 100; ty = b.y + b.dy * 100; }
      else if (target) { tx = target.x; ty = target.y; }
    } else if (b.type === "lion") {                      // 수풀 잠복: 수풀 안에 있으면 사람이 가까이 올 때까지 기다림
      const inBush = tileAt(b.x, b.y) === 5;
      if (inBush && (!target || bd > 150)) { if (t > (b.lurkUntil || 0)) { b.lurkUntil = t + 4000; } continue; }
      if (target) { tx = target.x; ty = target.y; }
      else { const bush = b.bushTarget || (b.bushTarget = nearestBush(b)); if (bush) { tx = bush.x; ty = bush.y; if (Math.hypot(tx - b.x, ty - b.y) < 20) b.bushTarget = null; } }
    } else if (b.type === "nebuchad") {                  // 약탈: 가까운 상자로 가서 부숨
      let bx = null, bdd = 460;
      for (const box of G.boxes) { const d = Math.hypot(box.x - b.x, box.y - b.y); if (d < bdd) { bdd = d; bx = box; } }
      if (bx && !(target && bd < 120)) { tx = bx.x; ty = bx.y;
        if (bdd < 30) { G.boxes = G.boxes.filter((x) => x !== bx); G.opened.push([bx.x | 0, bx.y | 0, bx.tier, t]);
          pushLog("👑 느부갓네살이 보물상자를 부쉈습니다!", "warn"); } }
      else if (target) { tx = target.x; ty = target.y; }
    } else if (b.type === "herod") {                     // 순간이동: 8초마다 아무 사람 옆으로
      if (t > (b.tpNext || 0)) { b.tpNext = t + 8000;
        const ps = [...G.players.values()].filter((p) => p.connected && !p.duel && t >= p.safeUntil && t >= p.downUntil);
        if (ps.length) { const v = ps[Math.random() * ps.length | 0]; const a = Math.random() * 6.283;
          for (let k = 0; k < 8; k++) { const nx = clamp(v.x + Math.cos(a + k) * 150, R, MAP.W - R), ny = clamp(v.y + Math.sin(a + k) * 150, R, MAP.H - R);
            if (!blocked(nx, ny)) { b.x = nx; b.y = ny; b.walk = 0; break; } }
          if (v.socketId) io.to(v.socketId).emit("aggro", { name: B.name, type: b.type, x: b.x | 0, y: b.y | 0, tp: true }); } }
      if (target) { tx = target.x; ty = target.y; }
    } else {                                             // 리워야단: 물 위 이동 가능
      if (target) { tx = target.x; ty = target.y; }
    }
    if (b.type === "amalek" && (!target || bd > 260)) {
      const mate = G.bosses.find((o) => o !== b && o.type === "amalek" && !o.dead);
      if (mate && Math.hypot(mate.x - b.x, mate.y - b.y) > 140) { tx = mate.x; ty = mate.y; }
    }
    if (tx == null) continue;
    const dd = Math.hypot(tx - b.x, ty - b.y) || 1;
    const ux = (tx - b.x) / dd, uy = (ty - b.y) / dd;
    const canWater = b.type === "leviathan";
    const blk = (x, y) => canWater ? (tileAt(x - R, y - R) === 3 || tileAt(x + R, y - R) === 3 || tileAt(x - R, y + R) === 3 || tileAt(x + R, y + R) === 3) : blocked(x, y);
    const nx = clamp(b.x + ux * sp * dt, R, MAP.W - R);
    if (!blk(nx, b.y)) b.x = nx;
    const ny = clamp(b.y + uy * sp * dt, R, MAP.H - R);
    if (!blk(b.x, ny)) b.y = ny;
    b.face = ux < 0 ? -1 : 1;
    b.walk += sp * dt;
    // 쫓아오는 보스 경고 (6초에 한 번)
    if (target && bd < 260 && t > (target.aggroAt || 0)) { target.aggroAt = t + 6000;
      if (target.socketId) io.to(target.socketId).emit("aggro", { name: B.name, type: b.type, x: b.x | 0, y: b.y | 0 }); }
  }
}
function updateTreasure(t) {
  if (G.treasure || t < G.nextTreasure) return;
  const s = freeSpot();
  const dir = (s.y < MAP.H / 2 ? "북" : "남") + (s.x < MAP.W / 2 ? "서" : "동");
  G.treasure = { x: s.x, y: s.y, hint: `${dir}쪽 어딘가` };
  pushLog(`💎 숨겨진 보물이 ${dir}쪽에 나타났습니다 (+5점)`, "gold");
  bigEvent(`💎 보물 출현 — ${dir}쪽`, "gold");
}
function autoFeature(t) {
  if (t < G.featuredManual) return;
  if (G.featured && G.duels.has(G.featured)) return;
  let best = null, bs = -1;
  const board = boardList();
  const rank = new Map(board.map((p, i) => [p.id, i + 1]));
  for (const d of G.duels.values()) {
    if (d.kind === "minion" || d.kind === "chest") continue;
    const a = G.players.get(d.a), b = d.boss ? null : G.players.get(d.b);
    if (!a) continue;
    let s = 1;
    if (d.boss) s += d.boss === "leviathan" ? 20 : 10;
    if (a.streak >= 3 || (b && b.streak >= 3)) s += 6;
    const ra = rank.get(a.id) || 99, rb = b ? rank.get(b.id) || 99 : 99;
    if (ra <= 3 && rb <= 3) s += 5; else if (ra <= 3 || rb <= 3) s += 2;
    if (s > bs) { bs = s; best = d.id; }
  }
  G.featured = best;
}

/* ═════════ 목록·전송 ═════════ */
let rosterSeq = 0;
const numOf = new Map();
let nextNum = 1;
function boardList() {
  return [...G.players.values()]
    .map((p) => ({ id: p.id, u: numOf.get(p.id), name: p.name, look: p.look, score: p.score,
                   wins: p.wins, losses: p.losses, draws: p.draws, streak: p.streak,
                   team: p.team, connected: p.connected, prevRank: p.prevRank, tier: tierOf(p.score).icon, tierIdx: tierIdx(p.score), level: p.level || 1 }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name, "ko"));
}
const leftSec = () => G.phase === "playing" ? Math.max(0, Math.ceil((G.endsAt - now()) / 1000))
                    : G.phase === "paused" ? Math.ceil(G.pausedLeft / 1000) : 0;
const rosterPayload = () => [...G.players.values()].map((p) => ({
  u: numOf.get(p.id), i: p.id, n: p.name, l: p.look, c: p.cls, tm: p.team }));
function bumpRoster() {
  for (const p of G.players.values()) if (!numOf.has(p.id)) numOf.set(p.id, nextNum++);
  rosterSeq++;
  io.emit("roster", { seq: rosterSeq, list: rosterPayload(), mode: G.mode, teams: TEAMS.slice(0, teamCount()) });
}
const flagsOf = (p, t) => (p.duel ? 1 : 0) | (t < p.ghostUntil ? 2 : 0) | (t < p.speedUntil ? 4 : 0) |
                          (p.streak >= 3 ? 8 : 0) | (p.moving ? 16 : 0) | (p.connected ? 0 : 64) |
                          (t < p.dodgeUntil ? 128 : 0) | (hidden(p) ? 256 : 0) |
                          (G.leaderId === p.id ? 512 : 0) | (t < p.downUntil ? 1024 : 0) |
                          (t < (p.glowUntil || 0) ? 4096 : 0);
/* 진행 중에는 '냈다/안 냈다'만 알려 줍니다 — 정답이 새어 나가지 않도록 */
function sideOf(d, pid) {
  const p = G.players.get(pid);
  if (!p) return null;
  return { name: p.name, look: { ...p.look, tier: tierIdx(p.score) }, score: p.score, team: p.team, done: !!d.picks[pid] };
}
function revealSide(d, pid) {
  const p = G.players.get(pid);
  if (!p) return null;
  const pk = d.picks[pid];
  return { name: p.name, look: { ...p.look, tier: tierIdx(p.score) }, score: p.score, team: p.team,
           picked: pk ? pk.choice : -1, ok: pk ? pk.correct : false };
}

setInterval(() => {
  const t = now();
  const p = [];
  for (const o of G.players.values())
    p.push([numOf.get(o.id), o.x | 0, o.y | 0, flagsOf(o, t), o.score, (o.walk | 0) % 64, o.face, o.team, tierIdx(o.score), t < (o.emoteUntil || 0) ? o.emote : 0, o.level || 1]);
  const d = [];
  for (const u of G.duels.values()) {
    if (u.kind === "minion" || u.kind === "chest") continue;
    const a = G.players.get(u.a), b = u.boss ? null : G.players.get(u.b);
    if (!a || (!u.boss && !b)) continue;
    const bz = u.boss ? G.bosses.find((x) => x.id === u.bossId) : null;
    const bx = u.boss ? (bz ? bz.x | 0 : a.x | 0) : b.x | 0;
    const by = u.boss ? (bz ? bz.y | 0 : a.y | 0) : b.y | 0;
    d.push([a.x | 0, a.y | 0, bx, by, numOf.get(a.id), u.boss ? 0 : numOf.get(b.id),
            Math.max(0, Math.ceil((u.endsAt - t) / 1000)), u.id, u.boss || 0]);
  }
  const fd = G.duels.get(G.featured);
  io.to("host").volatile.emit("world", {
    ph: G.phase, t: leftSec(), seq: rosterSeq, mapSeq: MAP.seq,
    cd: G.phase === "countdown" ? Math.max(0, Math.ceil((G.countdownEnd - t) / 1000)) : 0,
    p, d,
    bosses: G.bosses.filter((b) => !b.dead).map((b) => [b.x | 0, b.y | 0, (b.walk | 0) % 64, b.face, b.type, b.id, tileAt(b.x, b.y) === 5 ? 1 : 0, t < (b.dashUntil || 0) ? 1 : 0]),
    mn: G.minions.filter((m) => !m.dead).map((m) => [m.id, m.x | 0, m.y | 0, m.type, (m.walk | 0) % 64, m.face]),
    tr: G.treasure ? [G.treasure.x | 0, G.treasure.y | 0] : null,
    feat: fd ? { id: fd.id, boss: fd.boss, q: fd.q.text, options: fd.q.options,
                 left: Math.max(0, Math.ceil((fd.endsAt - t) / 1000)),
                 a: sideOf(fd, fd.a), b: fd.boss ? { name: "골리앗", boss: true } : sideOf(fd, fd.b) } : null,
    reveal: (G.reveal && t < G.reveal.until) ? G.reveal : null,
  });
}, SEND_HOST);

setInterval(() => {
  io.to("host").emit("meta", {
    board: boardList(), log: G.log.slice(0, 8), mode: G.mode, teams: teamScores(),
    boxes: G.boxes.map((b) => [b.x | 0, b.y | 0, b.tier, b.id]),
    opened: G.opened.splice(0, G.opened.length).map((o) => [o[0], o[1], o[2]]),
    caps: MAP.caps.map((c) => [c.x | 0, c.y | 0, c.r, c.name]),
    portals: MAP.portals.map(([a, b]) => [a.x | 0, a.y | 0, b.x | 0, b.y | 0]),
    treasureHint: G.treasure ? G.treasure.hint : null,
    qUsed: G.usedQ.size, qTotal: G.questions.length, qfile: G.qfile, qfiles: questionFiles(),
    golden: golden(now()), tiers: TIERS, zones: ZONES,
    events: G.events.splice(0, G.events.length),
    stats: { tick: G.stats.tickAvg, tickMax: G.stats.tickMax, players: G.players.size, duels: G.duels.size },
  });
  G.stats.tickMax = 0;
}, SEND_META);

const VIEW = 340, NEAR_MAX = 14;
setInterval(() => {
  const t = now();
  const all = [...G.players.values()];
  for (const p of all) {
    if (!p.socketId || !p.connected) continue;
    const n = [];
    for (const o of all) {
      if (o === p || t < o.ghostUntil) continue;
      if (Math.abs(o.x - p.x) > VIEW || Math.abs(o.y - p.y) > VIEW) continue;
      if (hidden(o) && Math.hypot(o.x - p.x, o.y - p.y) > 95) continue;   // 수풀 잠복
      n.push([numOf.get(o.id), o.x | 0, o.y | 0, flagsOf(o, t), (o.walk | 0) % 64, o.face, o.team, tierIdx(o.score),
              t < (o.emoteUntil || 0) ? o.emote : 0, o.level || 1, (o.x - p.x) ** 2 + (o.y - p.y) ** 2]);
    }
    if (n.length > NEAR_MAX) { n.sort((a, b) => a[10] - b[10]); n.length = NEAR_MAX; }
    const mn = [];
    for (const m of G.minions) if (!m.dead && Math.abs(m.x - p.x) < VIEW && Math.abs(m.y - p.y) < VIEW) mn.push([m.id, m.x | 0, m.y | 0, m.type, (m.walk | 0) % 64, m.face]);
    for (const e of n) e.pop();
    const bn = G.bosses.filter((b) => !b.dead && Math.abs(b.x - p.x) < VIEW && Math.abs(b.y - p.y) < VIEW
        && !(tileAt(b.x, b.y) === 5 && Math.hypot(b.x - p.x, b.y - p.y) > 110))       // 수풀 속 사자는 가까이 와야 보임
      .map((b) => [b.x | 0, b.y | 0, (b.walk | 0) % 64, b.face, b.type, b.id, 0, t < (b.dashUntil || 0) ? 1 : 0]);
    const trn = G.treasure && Math.abs(G.treasure.x - p.x) < VIEW && Math.abs(G.treasure.y - p.y) < VIEW
      ? [G.treasure.x | 0, G.treasure.y | 0] : null;
    io.to(p.socketId).volatile.emit("me", {
      ph: G.phase, t: leftSec(), x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      ack: p.lastSeq | 0, e: p.face, w: (p.walk | 0) % 64, tr2: tierIdx(p.score), em: t < (p.emoteUntil || 0) ? p.emote : 0,
      f: flagsOf(p, t) | (t < p.safeUntil ? 32 : 0),
      cd: G.phase === "countdown" ? Math.max(0, Math.ceil((G.countdownEnd - t) / 1000)) : 0,
      n, bosses: bn, mn, tr: trn, seq: rosterSeq, mapSeq: MAP.seq,
      amb: ambushTarget(p, t) ? 1 : 0,
      en: nearestEnemy(p, t),
      lv: p.level || 1, zn: zoneOf(p.x, p.y),
      ch: p.chestId ? Math.min(1, (t - p.chestT) / (hasPerk(p, 3) ? 1200 : 2500)) : 0,
      dodge: Math.max(0, Math.ceil((p.dodgeReady - t) / 1000)),
    });
  }
}, SEND_PHONE);

setInterval(() => {
  const board = boardList();
  const rank = new Map(board.map((p, i) => [p.id, i + 1]));
  const top = board.slice(0, 5).map((p) => ({ n: p.name, s: p.score, l: p.look, t: p.team }));
  const ts = teamScores();
  for (const p of G.players.values()) {
    if (!p.socketId || !p.connected) continue;
    const boxes = [];
    for (const b of G.boxes)
      if (Math.abs(b.x - p.x) < VIEW && Math.abs(b.y - p.y) < VIEW) boxes.push([b.x | 0, b.y | 0, b.tier, b.id]);
    const caps = MAP.caps.filter((c) => Math.abs(c.x - p.x) < VIEW + 90 && Math.abs(c.y - p.y) < VIEW + 90)
      .map((c) => [c.x | 0, c.y | 0, c.r, c.name]);
    io.to(p.socketId).emit("meta", {
      score: p.score, wins: p.wins, losses: p.losses, draws: p.draws, streak: p.streak, guard: p.guard,
      items: p.items.map((k) => ({ key: k, ...BOX_ITEMS[k] })),
      rank: rank.get(p.id) || 0, total: G.players.size, top, boxes, caps,
      team: p.team, mode: G.mode, teams: ts, region: regionOf(p.y, p.x),
      tier: tierOf(p.score), golden: golden(now()),
      buffs: { speed: Math.max(0, Math.ceil((p.speedUntil - now()) / 1000)), ghost: Math.max(0, Math.ceil((p.ghostUntil - now()) / 1000)) },
      xp: p.xp || 0, level: p.level || 1, xpNext: XP_TABLE[Math.min(XP_TABLE.length - 1, p.level || 1)] || XP_TABLE[9], xpBase: XP_TABLE[(p.level || 1) - 1],
      keys: p.keys || 0, minionKills: p.minionKills || 0, lvShield: p.lvShield || 0,
      quests: QUESTS.map((q) => ({ id: q.id, name: q.name, desc: q.desc, bonus: q.bonus, need: q.need, have: Math.min(q.need, p.q[q.id] || 0), done: !!p.qDone[q.id] })),
      down: Math.max(0, Math.ceil((p.downUntil - now()) / 1000)),
    });
  }
}, SEND_META);

/* ═════════ 게임 제어 ═════════ */
function startGame(min) {
  MAP = buildMap(...mapSizeFor(Math.max(2, G.players.size)));
  G.zone = { x: MAP.W / 2, y: MAP.H / 2, r: Math.hypot(MAP.W, MAP.H) / 2 + 60 };
  io.emit("mapChanged");
  if (teamCount()) assignTeams();
  G.minutes = min || 10;
  G.phase = "countdown"; G.countdownEnd = now() + 3600;
  G.zoneWarned = false; G.goldenTold = false; G.leaderId = null; G.boxCool = 0; G.boxes = []; G.opened = []; G.usedQ.clear(); G.log = []; G.events = [];
  for (const p of G.players.values()) {
    const s = freeSpot(); p.x = s.x; p.y = s.y;
    Object.assign(p, { duel: null, wrong: [], items: [], streak: 0, bestStreak: 0, score: 0,
      wins: 0, losses: 0, draws: 0, boxCount: 0, distance: 0, capPoints: 0,
      guard: p.cls === "shield" ? 2 : 0, speedUntil: 0, ghostUntil: 0, dodgeUntil: 0, dodgeReady: 0,
      safeUntil: now() + 5000, downUntil: 0, tier: 0, duelCount: 0, bossKills: 0, xp: 0, level: 1, keys: 0, minionKills: 0, chestT: 0, chestId: 0, boxLock: {},
      q: { win1: 0, duel5: 0, streak3: 0, boss1: 0, box5: 0, cap3: 0 }, qDone: {} });
    p.recent.clear(); p.lostTo.clear();
  }
  refillBoxes();
  bigEvent("곧 시작합니다!", "hot");
}
function beginPlay() {
  G.phase = "playing";
  G.startedAt = now();
  G.endsAt = G.startedAt + G.minutes * 60000;
  G.bosses = []; G.leviathanDone = false; G.minions = []; fillMinions();
  // 최소 3마리, 8명마다 한 마리씩 추가 (60명이면 9마리). 종류는 골고루
  const want = 3 + Math.floor(G.players.size / 8);
  const order = ["goliath", "lion", "pharaoh", "serpent", "herod", "nebuchad", "amalek", "goliath", "lion", "pharaoh", "serpent"];
  let count = 0;
  for (let i = 0; count < want; i++) { const tp = order[i % order.length]; spawnBoss(tp); count++; if (tp === "amalek" && count < want) { spawnBoss("amalek"); count++; } }
  G.treasure = null; G.nextTreasure = now() + TREASURE_FIRST;
  for (const p of G.players.values()) if (p.practiceXp) { addXp(p, p.practiceXp, "연습 퀴즈 출발 보너스"); p.practiceXp = 0; p.practiceCorrect = 0; }
  pushLog("게임 시작! 돌아다니다 만나면 대결이 시작됩니다", "hot");
  bigEvent("게임 시작!", "gold");
}
function mvpAwards() {
  const list = [...G.players.values()];
  if (!list.length) return [];
  const pick = (label, unit, fn) => {
    const top = list.slice().sort((a, b) => fn(b) - fn(a))[0];
    const v = fn(top);
    return v > 0 ? { label, name: top.name, look: top.look, value: v + unit } : null;
  };
  return [
    pick("최다 승리", "승", (p) => p.wins),
    pick("최장 연승", "연승", (p) => p.bestStreak),
    pick("상자 수집왕", "개", (p) => p.boxCount),
    pick("가장 많이 걸은 사람", "걸음", (p) => Math.round(p.distance / 40)),
    pick("무승부 왕", "무", (p) => p.draws),
    pick("거점 지킴이", "회", (p) => p.capPoints),
    pick("보스 사냥꾼", "마리", (p) => p.bossKills),
    pick("미니언 사냥꾼", "마리", (p) => p.minionKills),
    pick("최고 레벨", "레벨", (p) => p.level || 1),
    pick("도전과제 왕", "개", (p) => Object.keys(p.qDone).length),
  ].filter(Boolean);
}
function wrongTop() {
  const cnt = new Map();
  for (const p of G.players.values())
    for (const w of p.wrong) {
      const e = cnt.get(w.id) || { n: 0, q: w.q, options: w.options, answer: w.answer, ref: w.ref, exp: w.exp };
      e.n++; cnt.set(w.id, e);
    }
  return [...cnt.values()].sort((a, b) => b.n - a.n).slice(0, 5);
}
const SEASON_FILE = path.join(__dirname, "누적기록.json");
const loadSeason = () => { try { return JSON.parse(fs.readFileSync(SEASON_FILE, "utf8")); } catch { return { games: 0, players: {} }; } };
function saveSeason() {
  const s = loadSeason();
  s.games = (s.games || 0) + 1;
  s.players = s.players || {};
  for (const p of G.players.values()) {
    const e = s.players[p.name] || { score: 0, wins: 0, losses: 0, games: 0, best: 0 };
    e.score += p.score; e.wins += p.wins; e.losses += p.losses; e.games++;
    e.best = Math.max(e.best || 0, p.score);
    s.players[p.name] = e;
  }
  try { fs.writeFileSync(SEASON_FILE, JSON.stringify(s, null, 1)); } catch {}
}
const TITLE_RULES = [
  { id: "champ",  name: "챔피언",       icon: "🏆", test: (p, rank) => rank === 1 },
  { id: "top3",   name: "포디움",       icon: "🥉", test: (p, rank) => rank <= 3 },
  { id: "first",  name: "새싹 전사",     icon: "🌱", test: (p) => p.wins >= 1 },
  { id: "flame",  name: "불꽃",         icon: "🔥", test: (p) => p.bestStreak >= 3 },
  { id: "giant",  name: "거인 사냥꾼",   icon: "🗡", test: (p) => p.bossKills >= 1 },
  { id: "slayer", name: "보스 학살자",   icon: "☠", test: (p) => p.bossKills >= 3 },
  { id: "shadow", name: "그림자",       icon: "🌑", test: (p) => (p.ambushWins || 0) >= 1 },
  { id: "hunter", name: "보물 사냥꾼",   icon: "💎", test: (p) => p.boxCount >= 5 },
  { id: "guard",  name: "거점 수호자",   icon: "⛪", test: (p) => p.capPoints >= 3 },
  { id: "peace",  name: "평화주의자",    icon: "🕊️", test: (p) => p.draws >= 3 },
  { id: "walker", name: "광야의 나그네", icon: "🥾", test: (p) => p.distance >= 6000 },
  { id: "judge",  name: "사사",         icon: "📜", test: (p) => p.score >= 15 },
  { id: "king",   name: "왕",           icon: "👑", test: (p) => p.score >= 20 },
  { id: "quest",  name: "완주자",       icon: "🎯", test: (p) => Object.keys(p.qDone).length >= 4 },
  { id: "lv5",    name: "숙련자",       icon: "⬆", test: (p) => (p.level || 1) >= 5 },
  { id: "lv10",   name: "달인",         icon: "🌟", test: (p) => (p.level || 1) >= 10 },
  { id: "minion", name: "광야의 사냥꾼", icon: "🦊", test: (p) => p.minionKills >= 8 },
];
function titlesOf(p, rank) { return TITLE_RULES.filter((r) => r.test(p, rank)).map((r) => ({ id: r.id, name: r.name, icon: r.icon })); }
function endGame() {
  if (G.phase === "ended") return;
  G.phase = "ended";
  for (const d of [...G.duels.values()]) resolveDuel(d);
  const board = boardList(), top = board[0];
  if (top) pushLog(`🏆 우승 ${top.name} — ${top.score}점`, "gold");
  const awards = mvpAwards(), wrongs = wrongTop(), teams = teamScores();
  saveResults(wrongs); saveSeason();
  io.to("host").emit("gameEnd", { board, awards, wrongs, teams, mode: G.mode });
  for (const p of G.players.values()) {
    if (!p.socketId) continue;
    const rank = board.findIndex((x) => x.id === p.id) + 1;
    io.to(p.socketId).emit("gameEnd", {
      board: board.slice(0, 5), rank, total: board.length, titles: titlesOf(p, rank), level: p.level || 1, xp: p.xp || 0,
      score: p.score, wins: p.wins, losses: p.losses, draws: p.draws,
      wrong: p.wrong, cards: p.cards, teams, mode: G.mode, team: p.team });
  }
}
function saveResults(wrongs) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  const file = path.join(__dirname, `배틀결과_${stamp}.csv`);
  let csv = "\uFEFF순위,이름,점수,승,패,무,최장연승,상자,거점\n";
  boardList().forEach((p, i) => {
    const o = G.players.get(p.id);
    csv += `${i + 1},${p.name},${p.score},${p.wins},${p.losses},${p.draws},${o.bestStreak},${o.boxCount},${o.capPoints}\n`;
  });
  csv += "\n[많이 틀린 문제]\n순위,틀린 횟수,문제,정답,구절\n";
  wrongs.forEach((w, i) => {
    csv += `${i + 1},${w.n},"${String(w.q).replace(/"/g, "'")}","${w.options[w.answer]}",${w.ref}\n`;
  });
  try { fs.writeFileSync(file, csv); console.log("  결과 저장:", file); } catch {}
}

/* ═════════ HTTP ═════════ */
function lanAddress() {
  for (const l of Object.values(os.networkInterfaces()))
    for (const n of l || []) if (n.family === "IPv4" && !n.internal) return n.address;
  return "localhost";
}
const JOIN_URL = `http://${lanAddress()}:${PORT}`;
app.get("/host", (q, r) => { NOCACHE(r); r.sendFile(path.join(__dirname, "public", "host.html")); });
app.get("/api/join-info", async (q, r) => {
  NOCACHE(r);
  // 메인 화면을 연 브라우저의 주소(u)를 그대로 씁니다 → 외부 서버·터널·공유기 어디서 켜도 QR이 맞습니다
  const asked = typeof q.query.u === "string" ? q.query.u.trim() : "";
  const url = /^https?:\/\/[A-Za-z0-9.\-_:\[\]]+$/.test(asked) && !/localhost|127\.0\.0\.1/.test(asked) ? asked : JOIN_URL;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 620, color: { dark: "#141021", light: "#FFFFFF" } });
  r.json({ url, qr, lan: JOIN_URL, zones: ZONES, perks: PERKS, minions: Object.fromEntries(Object.entries(MINIONS).map(([k, v]) => [k, { name: v.name, xp: v.xp, key: v.key }])), xpTable: XP_TABLE, items: BOX_ITEMS, teams: TEAMS, qproblems: G.qproblems, emotes: EMOTES, tiers: TIERS, bosses: Object.fromEntries(Object.entries(BOSSES).map(([k, v]) => [k, { name: v.name, reward: v.reward, penalty: v.penalty, trait: v.trait, desc: v.desc }])) });
});
app.get("/api/map", (q, r) => { NOCACHE(r); r.json({ TS, TW: MAP.TW, TH: MAP.TH, W: MAP.W, H: MAP.H, seq: MAP.seq,
  tiles: Buffer.from(MAP.t).toString("base64") }); });
/* public/music 폴더의 mp3 목록 — 있으면 폰·메인 화면이 그 곡을 씁니다 */
app.get("/api/music", (q, r) => {
  NOCACHE(r);
  const dir = path.join(__dirname, "public", "music");
  const out = { lobby: [], play: [], duel: [], boss: [], victory: [] };
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = /^(lobby|play|duel|boss|victory)\d*\.mp3$/i.exec(f);
      if (m) out[m[1].toLowerCase()].push("/music/" + encodeURIComponent(f));
    }
  } catch {}
  r.json(out);
});
app.get("/api/season", (q, r) => {
  const s = loadSeason();
  r.json({ games: s.games || 0,
           list: Object.entries(s.players || {}).map(([n, v]) => ({ name: n, ...v, tier: tierOf(Math.round(v.score / Math.max(1, v.games))) }))
                 .sort((a, b) => b.score - a.score) });
});
app.get("/api/stats", (q, r) => {
  const m = process.memoryUsage();
  r.json({ players: G.players.size, duels: G.duels.size, phase: G.phase, mode: G.mode,
           tickAvg: G.stats.tickAvg, tickMax: G.stats.tickMax,
           rssMB: +(m.rss / 1048576).toFixed(1), heapMB: +(m.heapUsed / 1048576).toFixed(1) });
});

/* ═════════ 소켓 ═════════ */
io.on("connection", (socket) => {
  socket.on("host:join", () => {
    socket.join("host");
    socket.emit("roster", { seq: rosterSeq, list: rosterPayload(), mode: G.mode, teams: TEAMS.slice(0, teamCount()) });
    if (G.qproblems.length) socket.emit("qproblems", G.qproblems);
  });
  socket.on("host:start", (opt) => {
    if (!G.players.size) return;
    const o = opt || {};
    G.mode = ["solo", "team2", "team4"].includes(o.mode) ? o.mode : G.mode;
    startGame(Number(o.min) || 10);
    bumpRoster();
  });
  socket.on("host:mode", (m) => {
    if (G.phase !== "lobby") return;
    G.mode = ["solo", "team2", "team4"].includes(m) ? m : "solo";
    assignTeams(); bumpRoster();
  });
  socket.on("host:shuffleTeams", () => { assignTeams(); bumpRoster(); });
  socket.on("host:qfile", (f) => {
    if (G.phase !== "lobby" || !questionFiles().includes(f)) return;
    const r = loadQuestions(f);
    if (!r.list.length) return io.to("host").emit("qproblems", r.problems.length ? r.problems : [`${f} 에 쓸 수 있는 문제가 없습니다`]);
    G.qfile = f; G.questions = r.list; G.qproblems = r.problems; G.usedQ.clear();
    for (const p of G.players.values()) p.seen.clear();
    pushLog(`문제집을 ${f} 로 바꿨습니다 (${r.list.length}문제)`);
    io.to("host").emit("qproblems", r.problems);
  });
  socket.on("host:pause", () => {
    if (G.phase === "playing") { G.pausedLeft = G.endsAt - now(); G.phase = "paused"; pushLog("잠시 멈춤"); }
    else if (G.phase === "paused") { G.endsAt = now() + G.pausedLeft; G.phase = "playing"; pushLog("다시 시작!"); }
  });
  socket.on("host:end", () => { if (G.phase !== "lobby") endGame(); });
  socket.on("host:reset", () => {
    G.phase = "lobby"; G.duels.clear(); G.log = []; G.events = []; G.usedQ.clear();
    G.boxes = []; G.opened = []; G.bosses = []; G.minions = []; G.treasure = null; G.featured = null; G.leaderId = null; G.goldenTold = false;
    for (const p of G.players.values()) {
      Object.assign(p, { score: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, items: [],
        duel: null, speedUntil: 0, ghostUntil: 0, dodgeUntil: 0, dodgeReady: 0,
        boxCount: 0, distance: 0, capPoints: 0, guard: p.cls === "shield" ? 2 : 0, wrong: [], downUntil: 0, tier: 0, xp: 0, level: 1, keys: 0, minionKills: 0, boxLock: {},
        q: { win1: 0, duel5: 0, streak3: 0, boss1: 0, box5: 0, cap3: 0 }, qDone: {} });
      p.seen.clear(); p.recent.clear(); p.lostTo.clear();
    }
    io.emit("resetToLobby");
  });
  socket.on("host:kick", (pid) => {
    const p = G.players.get(pid);
    if (p?.socketId) io.to(p.socketId).emit("kicked");
    G.players.delete(pid); numOf.delete(pid); bumpRoster();
  });
  socket.on("host:adjust", (o) => {
    const p = G.players.get(o?.pid);
    if (!p) return;
    addScore(p, Number(o.delta) || 0);
    pushLog(`${p.name} 점수 ${o.delta > 0 ? "+" : ""}${o.delta} (선생님 조정)`);
  });
  socket.on("host:feature", (id) => {
    if (id === null || id === undefined) { G.featured = null; G.featuredManual = 0; return; }
    if (G.duels.has(id)) { G.featured = id; G.featuredManual = now() + 25000; }
  });

  socket.on("join", (o) => {
    const { name, look, id } = o || {};
    const c = cleanName(name);
    if (c.err) return socket.emit("joinError", c.err);
    const L = {
      sk: clamp(+look?.sk | 0, 0, 4), hs: clamp(+look?.hs | 0, 0, 5), hc: clamp(+look?.hc | 0, 0, 9),
      ft: clamp(+look?.ft | 0, 0, 5), cc: clamp(+look?.cc | 0, 0, 11), gr: clamp(+look?.gr | 0, 0, 5),
      ac: clamp(+look?.ac | 0, 0, 7), it: clamp(+look?.it | 0, 0, 5) };
    let p = id && G.players.get(id), changed = false;
    if (!p) {
      if ([...G.players.values()].some((x) => x.name === c.name && x.connected))
        return socket.emit("joinError", "같은 이름이 있어요. 한 글자만 바꿔 주세요.");
      p = newPlayer(Math.random().toString(36).slice(2, 10), c.name, L);
      if (teamCount()) {
        const cnt = new Array(teamCount()).fill(0);
        for (const o2 of G.players.values()) cnt[o2.team]++;
        p.team = cnt.indexOf(Math.min(...cnt));
      }
      if (G.phase === "playing") p.safeUntil = now() + 6000;
      G.players.set(p.id, p);
      pushLog(`${c.name} 참가!`);
      changed = true;
    } else if (G.phase === "lobby") {
      p.name = c.name; p.look = L; p.cls = ITEM_CLASS[L.it];
      p.guard = p.cls === "shield" ? 2 : 0;
      changed = true;
    }
    p.connected = true; p.socketId = socket.id; socket.data.pid = p.id;
    if (changed) bumpRoster();
    socket.emit("roster", { seq: rosterSeq, list: rosterPayload(), mode: G.mode, teams: TEAMS.slice(0, teamCount()) });
    socket.emit("joined", { id: p.id, u: numOf.get(p.id), name: p.name, look: p.look, cls: p.cls, team: p.team });
    if (p.duel && G.duels.has(p.duel)) sendDuel(p, G.duels.get(p.duel));
  });

  /* 폰이 보낸 입력을 번호(seq)와 함께 즉시 적용합니다.
     폰은 같은 계산을 먼저 해 두고, 서버가 확인한 번호 이후의 입력만 다시 얹어 보정합니다. */
  socket.on("move", (v) => {
    const p = G.players.get(socket.data.pid);
    if (!p || !v) return;
    const t = now();
    if (t - (p.inWin || 0) > 1000) { p.inWin = t; p.inCnt = 0; }
    if (++p.inCnt > 45) return;                         // 초당 입력 상한
    p.lastSeq = v.s | 0;
    const x = clamp(+v.x || 0, -1, 1), y = clamp(+v.y || 0, -1, 1);
    p.ix = x; p.iy = y; p.lastInput = t;
    if (G.phase !== "playing" || t < p.downUntil || p.duel) return;   // 대결 중·쓰러진 동안은 못 움직임
    // 시간 예산: 실제 흐른 시간의 1.12배까지만 움직일 수 있게 (속도 해킹 방지)
    p.budget = Math.min(.3, (p.budget || 0) + (t - (p.budgetT || t)) / 1000 * 1.12);
    p.budgetT = t;
    let dt = clamp(+v.dt || 0, 0, .08);
    if (dt > p.budget) dt = p.budget;
    p.budget -= dt;
    if (dt > 0) applyMove(p, x, y, dt, t);
  });

  socket.on("ambush", () => {
    const p = G.players.get(socket.data.pid), t = now();
    if (!p || G.phase !== "playing") return;
    const target = ambushTarget(p, t);
    if (!target) return;
    startDuel(p, target, true);
  });
  /* 대기실 연습 퀴즈 — 점수 없음, 3문제 맞히면 출발 보너스 XP */
  socket.on("practice:get", () => {
    const p = G.players.get(socket.data.pid);
    if (!p || G.phase !== "lobby" || !G.questions.length) return;
    const pool = G.questions.filter((q) => !q.hard);
    const q0 = (pool.length ? pool : G.questions)[Math.random() * (pool.length || G.questions.length) | 0];
    const order = [0, 1, 2, 3].sort(() => Math.random() - .5);
    p.practiceQ = { id: q0.id, options: order.map((i) => q0.options[i]), answer: order.indexOf(q0.answer), ref: q0.ref, exp: q0.exp };
    socket.emit("practice:q", { text: q0.text, options: p.practiceQ.options, cat: q0.cat, done: p.practiceCorrect || 0 });
  });
  socket.on("practice:answer", (o) => {
    const p = G.players.get(socket.data.pid);
    if (!p || !p.practiceQ) return;
    const q = p.practiceQ; p.practiceQ = null;
    const ok = (+o.choice) === q.answer;
    if (ok && (p.practiceCorrect || 0) < 3) { p.practiceCorrect = (p.practiceCorrect || 0) + 1; p.practiceXp = (p.practiceXp || 0) + 10; }
    socket.emit("practice:r", { ok, answer: q.answer, ref: q.ref, exp: q.exp, done: p.practiceCorrect || 0, bonus: p.practiceXp || 0 });
  });
  socket.on("dodge", () => {
    const p = G.players.get(socket.data.pid), t = now();
    if (!p || p.duel || G.phase !== "playing" || t < p.dodgeReady) return;
    p.dodgeUntil = t + DODGE_TIME; p.dodgeReady = t + (hasPerk(p, 2) ? 30000 : DODGE_COOL);
    io.to(p.socketId).emit("dodgeOk");
  });
  socket.on("answer", (o) => {
    const p = G.players.get(socket.data.pid);
    if (!p || !o || p.duel !== o.duelId) return;
    const d = G.duels.get(o.duelId);
    if (!d || d.picks[p.id]) return;
    if (d.lock && d.lock[p.id] && now() < d.lock[p.id]) return;   // 기습당한 직후엔 못 고름
    const c = +o.choice;
    d.picks[p.id] = { choice: c, correct: c === d.q.answer, at: now() };
    const foe = d.boss ? null : (d.a === p.id ? d.b : d.a);
    if (d.kind === "minion" || d.kind === "chest") return resolveDuel(d);
    if (c === d.q.answer) {
      if (d.boss) return resolveDuel(d);
      if (d.picks[foe]) return resolveDuel(d);          // 상대도 이미 냈으면 즉시 판정
      // 상대가 아슬아슬하게 따라올 수 있으니 잠깐 기다립니다
      if (!d.graceTimer) {
        if (p.socketId) io.to(p.socketId).emit("submitted");
        d.graceTimer = setTimeout(() => { d.graceTimer = null; resolveDuel(d); }, TIE_WINDOW);
      }
      return;
    }
    if (d.boss) {                                          // 보스전: 틀리면 그 자리에서 패배 (Lv7 레벨 방패는 1회 면제)
      if (hasPerk(p, 7) && !d.forgiven) { d.forgiven = true; delete d.picks[p.id];
        if (p.socketId) io.to(p.socketId).emit("wrongPick", { choice: c, forgiven: true }); return; }
      return resolveDuel(d);
    }
    if (d.picks[foe]) return resolveDuel(d);
    if (p.socketId) io.to(p.socketId).emit("wrongPick", { choice: c });
  });
  socket.on("ping2", (ts) => socket.emit("pong2", ts));
  socket.on("disconnect", () => {
    const p = G.players.get(socket.data.pid);
    if (p) { p.connected = false; p.ix = p.iy = 0; p.moving = false; }
  });
});

setInterval(() => {
  if (G.phase !== "playing") return;
  boardList().forEach((p, i) => { const o = G.players.get(p.id); if (o) o.prevRank = i + 1; });
}, 6000);

MAP = buildMap(...mapSizeFor(20));
refillBoxes();
/* 이미 켜져 있을 때 험한 오류 대신 알아듣기 쉬운 안내를 보여 줍니다 */
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log("\n  ⚠  서버가 이미 켜져 있습니다.");
    console.log("  ─────────────────────────────────────");
    console.log(`  ${PORT}번 자리를 먼저 켠 창이 쓰고 있습니다.`);
    console.log("  게임은 이미 돌아가고 있으니 아래 주소를 그대로 쓰시면 됩니다.");
    console.log(`\n     메인 화면 : http://localhost:${PORT}/host`);
    console.log(`     학생 접속 : ${JOIN_URL}\n`);
    console.log("  새로 켜고 싶다면 먼저 켜 둔 검은 명령창을 닫은 뒤 다시 실행하세요.");
    console.log("  창이 안 보이면 아래 한 줄을 명령창에 붙여넣어 정리할 수 있습니다.\n");
    console.log("     for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :" + PORT + "') do taskkill /f /pid %a\n");
    console.log("  (맥은  lsof -ti:" + PORT + " | xargs kill -9  입니다)");
    console.log("  ─────────────────────────────────────\n");
  } else {
    console.log("\n  ⚠  서버를 켜지 못했습니다:", e.message, "\n");
  }
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n  성경 픽셀 배틀 서버가 켜졌습니다.");
  console.log("  ─────────────────────────────────────");
  console.log(`  메인 화면(관전) : http://localhost:${PORT}/host`);
  console.log(`  학생 접속 주소  : ${JOIN_URL}`);
  console.log(`  문제집 ${G.qfile} · ${G.questions.length}문제`);
  if (G.qproblems.length) {
    console.log("\n  ⚠ 문제 파일에서 걸러낸 항목");
    G.qproblems.slice(0, 10).forEach((s) => console.log("    - " + s));
    if (G.qproblems.length > 10) console.log(`    … 외 ${G.qproblems.length - 10}건`);
  }
  console.log("  ─────────────────────────────────────\n");
});

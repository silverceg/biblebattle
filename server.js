/**
 * 성경 픽셀 배틀 — 서바이벌
 * 메인 화면(관전) → /host   학생 폰 → /
 * 체력이 0이 되면 쓰러지고, 홍수가 차오르는 마지막 단계부터는 탈락합니다. 최후의 1인(1팀)이 우승.
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
/* 시험용: TIME_SCALE=5 로 켜면 게임 시간이 5배 빨리 흐릅니다 (밸런스 시뮬레이션 전용, 평소엔 1) */
const TIME_SCALE = Math.max(1, Math.min(20, Number(process.env.TIME_SCALE) || 1));
const TS = 40, R = 13;
const SPEED = 92, MEET = 40;           // 천천히 걷는 속도 — 눈으로 따라가기 편하게
const TICK = 1000 / 20, SEND_HOST = 1000 / 12, SEND_PHONE = 1000 / 12, SEND_META = 550;
const DUEL_TIME = 18, AFTER_DUEL = 4, CELL = 120;
/* 문제가 길면 읽을 시간을 더 줍니다: 글자 60자당 +1초 (최대 +10초) */
const readTime = (q) => Math.min(10, Math.round((q.text.length + q.options.join("").length) / 60));
const DODGE_COOL = 40000, DODGE_TIME = 3200;
const CAP_PERIOD = 8000, BOSS_RESPAWN = 30000;
const TREASURE_FIRST = 150000, TREASURE_EVERY = 240000;

/* ═════════ 서바이벌 규칙 (숫자는 봇 시뮬레이션으로 맞춘 값) ═════════ */
const HP0 = 100, ATK0 = 20;             // 처음 체력·공격력
const HIT_CAP = .35;                    // 한 번에 최대 체력의 35%까지만 깎임 (한 방에 끝나지 않게)
const ULT_CAP = .55;                    // 궁극기로 맞힐 때는 55%까지
const FIRST_BONUS = 1.25;               // 둘 다 맞혔을 때 먼저 맞힌 쪽 피해 +25%
const COUNTER_MS = 5000;                // 먼저 맞힌 뒤, 상대가 5초 안에 맞히면 반격
const LV_BONUS = .08, LV_BONUS_MAX = .4;// 나보다 레벨 높은 상대를 때리면 레벨 차 1당 +8% (최대 +40%)
const AMBUSH_MUL = 1.5;                 // 기습 성공 시 피해 1.5배
const AMBUSH_LOCK = 1500;               // 기습당한 쪽이 답을 못 고르는 시간
const REGEN_DELAY = 8000, REGEN_RATE = .006;   // 성장 단계: 8초 동안 안 맞으면 초당 0.6% 회복 (홍수부터는 자연 회복 없음)
const CAP_HEAL = .03;                   // 거점(성전 등) 안: 초당 3% 회복
const REVIVE_NEED = 2, REVIVE_MIN_MS = 4000, REVIVE_HP = .6;   // 성장 단계 부활: 2문제
const TEAMREV_DIST = 70, TEAMREV_HP = .4, BLEED_MS = 22000;    // 팀전: 쓰러진 팀원 22초 안에 살리기 (체력 40%)
const TEAMREV_MAX = 1;                  // 홍수 단계에서 팀원이 살려 줄 수 있는 횟수 (한 사람당)
const PRAY_NEED = 3, PRAY_SHIELD = .10, PRAY_COOL = 30000;     // 중보기도 3문제 → 방패 10% (같은 친구는 30초에 한 번)
const ULT_CD = 60000, ULT_FIRST = 60000;// 궁극기: 시작 1분 뒤 준비, 쓰면 1분 뒤 다시 준비
const GROW_END = .5;                    // 게임 시간의 앞 절반은 성장 단계 (쓰러져도 부활)
/* 홍수: 게임 시간 비율 at 에 차오르기 시작해 dur 동안 반지름 r(처음 대비)까지 줄어듭니다. 물속 피해는 초당 dps */
/* fight = 그 단계의 대결 피해 배율 (물이 차오를수록 싸움이 격해짐) */
const FLOOD = [
  { at: .50, dur: .10, r: .55, dps: .03, fight: 1.3 },
  { at: .66, dur: .10, r: .30, dps: .05, fight: 1.5 },
  { at: .81, dur: .08, r: .13, dps: .08, fight: 1.8 },
  { at: .93, dur: .07, r: .06, dps: .12, fight: 2.0 },     // 마지막 물결: 방주가 끝까지 조금씩 좁아짐
];
const fightMul = () => G.stage === "grow" ? 1 : ((G.floodPlan[G.floodIdx] || FLOOD[0]).fight || 1.3);
const JUDGE_Q = 14, JUDGE_GAP = 4500, JUDGE_MAX = 10;   // 최후의 심판: 문제 14초, 결과 4.5초, 최대 10라운드
const JUDGE_TEAM_MAX = 3;                        // 팀전 심판은 3라운드 — 그 뒤엔 더 많이 살아남은 팀이 우승
const rematchMs = () => (G.stage === "grow" ? 18000 : G.floodIdx >= 2 ? 5000 : 8000);
const ARK = 2;                                  // 3단계 물결부터가 '방주' (보스·미니언 사라짐)

const ITEM_CLASS = ["sling", "shield", "scroll", "lamp", "staff", "harp"];
const BOX_ITEMS = {
  speed:  { name: "빠른 발걸음", icon: "👟", desc: "10초 동안 속도 1.8배", effect: "지금부터 10초 동안 훨씬 빨라집니다", instant: true },
  ghost:  { name: "구름 기둥",   icon: "☁️", desc: "10초 동안 은신", effect: "지금부터 10초 동안 아무도 나를 못 봅니다", instant: true },
  shield: { name: "믿음의 방패", icon: "🛡️", desc: "다음 대결에서 받는 피해 0", effect: "보관됨 — 다음 대결에서 자동 발동" },
  hint:   { name: "지혜의 등불", icon: "🕯️", desc: "다음 대결에서 오답 보기 하나 삭제", effect: "보관됨 — 다음 대결에서 자동 발동" },
  double: { name: "두 배의 축복", icon: "✨", desc: "다음 대결에서 맞히면 피해 2배", effect: "보관됨 — 다음 대결에서 자동 발동" },
  time:   { name: "모래시계",    icon: "⏳", desc: "다음 대결 시간 +6초", effect: "보관됨 — 다음 대결에서 자동 발동" },
  manna:  { name: "만나",        icon: "🍞", desc: "체력 40% 회복", effect: "체력 40% 회복!", instant: true },
  crown:  { name: "전설의 왕관", icon: "👑", desc: "체력 모두 회복 · 20초 가속·은신 · 방패·축복 장착", effect: "체력 모두 회복! 20초 가속·은신 + 방패·축복", instant: true },
};
const TIER_TABLE = [
  ["speed", "speed", "shield", "hint", "time", "manna"],
  ["ghost", "double", "manna", "speed"],
  ["crown"],
];
const BOSSES = {                        // 보스전: 어려운 문제만 · 시간 짧음 · 틀리면 체력이 크게 깎임
  // 골리앗: 6초마다 돌진(3배속 1초). 정면으로 마주치면 못 피합니다
  goliath:   { name: "골리앗",     speed: 50, reward: 3, penalty: 1, limit: 14, trait: "돌진",   desc: "6초마다 무섭게 돌진합니다" },
  // 바로 왕: 거점(성전·제단·우물)을 순찰하며 지킵니다. 쓰러뜨리면 만나 상자를 떨어뜨립니다
  pharaoh:   { name: "바로 왕",    speed: 42, reward: 4, penalty: 1, limit: 13, trait: "거점 순찰", desc: "거점을 지키고, 쓰러지면 만나 상자를 남깁니다" },
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
const bossDmgPct = (type) => .14 + .09 * ((BOSSES[type] || BOSSES.goliath).penalty);   // 보스에게 틀리면 최대 체력의 23% (리워야단 32%)
const BOSS_RESPAWN_FAST = 20000;
const EMOTES = ["승리! 🏆", "할렐루야!", "아멘!", "다음 상대!", "😎", "🔥🔥", "주께 영광!", "이건 몰랐지?"];
const STICKERS = ["🦁","🕊️","🔥","⚡","🌟","🛡️","📖","✝️","🎺","🏺","🌿","👑","🐑","⚔️","💎","🎯"];
/* 계급 외형은 레벨로 바뀝니다 */
const TIERS = [
  { lv: 1, name: "양치기", icon: "🐑" }, { lv: 3, name: "용사", icon: "🗡" }, { lv: 5, name: "백부장", icon: "🛡" },
  { lv: 6, name: "천부장", icon: "⚔" }, { lv: 8, name: "사사", icon: "📜" }, { lv: 10, name: "왕", icon: "👑" },
];
const tierIdx = (lv) => { let k = 0; TIERS.forEach((t, i) => { if ((lv || 1) >= t.lv) k = i; }); return k; };
const XP_TABLE = [0, 50, 110, 180, 260, 350, 450, 560, 680, 810];    // 레벨 1~10 누적 경험치
const XP = { hit: 18, kill: 40, miss: 4, hurt: 5, boss: 90, soldier: 15, fox: 30, locust: 10, chest: 12, cap: 8, quest: 30, treasure: 80, revive: 5, teamrev: 25, sermon: 12, saved: 8 };
const levelOf = (xp) => { let l = 1; for (let i = 1; i < XP_TABLE.length; i++) if (xp >= XP_TABLE[i]) l = i + 1; return l; };

/* 레벨업 강화 카드 — 레벨이 오를 때마다 3장 중 1장을 고릅니다 */
const CARDS = [
  { id: "hp",    icon: "❤",  name: "튼튼한 몸",   desc: "최대 체력 +20 (바로 20 회복)", max: 5 },
  { id: "atk",   icon: "⚔",  name: "날카로운 검", desc: "공격력 +4", max: 5 },
  { id: "def",   icon: "🛡",  name: "두꺼운 갑옷", desc: "받는 피해 −10%", max: 3 },
  { id: "vamp",  icon: "💧", name: "생명수",     desc: "맞힐 때마다 준 피해의 30%만큼 회복", max: 2 },
  { id: "crit",  icon: "🔥", name: "불 같은 열심", desc: "30% 확률로 피해 1.6배", max: 2 },
  { id: "ult",   icon: "⚡", name: "준비된 마음", desc: "궁극기 대기 시간 −10초", max: 3 },
  { id: "speed", icon: "👟", name: "날쌘 발",     desc: "이동 속도 +10%", max: 2 },
  { id: "wis",   icon: "🕯", name: "지혜",       desc: "대결마다 25% 확률로 오답 하나가 지워짐", max: 2 },
  { id: "time",  icon: "⏳", name: "침착함",     desc: "대결 시간 +3초", max: 2 },
  { id: "heal",  icon: "🍞", name: "만나",       desc: "체력을 모두 회복", max: 99, low: true },
];
const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
/* 특성(지물)마다 궁극기 하나 — 한 번 쓰면 1분 뒤 다시 준비 */
const ULTS = {
  sling:  { name: "다윗의 물맷돌", icon: "🎯", desc: "다음 대결에서 맞히면 피해 2배 — 상대 레벨이 나보다 높을수록 더 세집니다", arm: true },
  shield: { name: "믿음의 방패",   icon: "🛡", desc: "체력 25% 회복 + 다음 대결에서 받는 피해를 모두 막습니다" },
  scroll: { name: "말씀 선포",     icon: "📜", desc: "주변 적 모두에게 문제를 냅니다 — 틀린 사람은 모두 피해" },
  lamp:   { name: "지혜의 빛",     icon: "🕯", desc: "다음 대결 3번 동안 오답 보기 2개가 지워집니다", arm: true },
  staff:  { name: "홍해 가르기",   icon: "🌊", desc: "주변 적을 밀어내고 8초 동안 무적 + 빠른 이동 (홍수 피해도 없음)" },
  harp:   { name: "다윗의 수금",   icon: "🎵", desc: "체력 45% 회복 · 팀전이면 주변 팀원도 회복하고 쓰러진 팀원을 일으킵니다" },
};
const QUESTS = [                        // 도전과제 — 달성하면 경험치 +30
  { id: "hit1",   name: "첫 명중",     need: 1, desc: "대결에서 정답으로 상대를 맞히기" },
  { id: "duel5",  name: "전사의 길",   need: 5, desc: "대결 5회 참여" },
  { id: "streak3",name: "연속 명중",   need: 3, desc: "대결에서 3번 연속 정답" },
  { id: "kill1",  name: "첫 승리",     need: 1, desc: "상대를 한 번 쓰러뜨리기" },
  { id: "boss1",  name: "거인 사냥꾼", need: 1, desc: "보스 1회 격파" },
  { id: "box5",   name: "보물 수집가", need: 5, desc: "상자 5개 열기" },
  { id: "cap3",   name: "성전 지킴이", need: 3, desc: "거점에 머물러 3번 보상 받기" },
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
function mapSizeFor(n) {                 // 인원별 맵 크기 (타일 수). 60명이면 156×90 (6240×3600px)
  if (n <= 8) return [76, 44];
  if (n <= 16) return [94, 54];
  if (n <= 28) return [114, 66];
  if (n <= 42) return [136, 78];
  return [156, 90];
}
/* 구역: 가로 3 × 세로 2. 구역마다 문제 유형이 다릅니다 */
const ZONES = [
  { name: "에덴 동산", cat: "ot",     color: "#3DD68C" }, { name: "광야",     cat: "fun",    color: "#E0B86A" }, { name: "시내산",   cat: "ot",     color: "#C9A9FF" },
  { name: "갈릴리",   cat: "nt",     color: "#2FA4FF" }, { name: "예루살렘", cat: "person", color: "#FFC93C" }, { name: "바벨론",   cat: "hard",   color: "#FF4757" },
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
/* 안전지대(물이 안 찬 곳) 안인지 — margin 만큼 더 안쪽 */
const inZone = (x, y, margin) => Math.hypot(x - G.zone.x, y - G.zone.y) <= G.zone.r - (margin || 0);
function freeSpot(inside) {
  for (let i = 0; i < 500; i++) {
    let x, y;
    if (inside && G.zone.r < 1e5) {                      // 홍수 중엔 안전지대 안에서만
      const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * Math.max(10, G.zone.r - 70);
      x = clamp(G.zone.x + Math.cos(a) * d, 60, MAP.W - 60); y = clamp(G.zone.y + Math.sin(a) * d, 60, MAP.H - 60);
    } else { x = 60 + Math.random() * (MAP.W - 120); y = 60 + Math.random() * (MAP.H - 120); }
    if (!blocked(x, y) && tileAt(x, y) !== 7 && (!inside || inZone(x, y, 30))) return { x, y };
  }
  return { x: clamp(G.zone.x, 60, MAP.W - 60), y: clamp(G.zone.y, 60, MAP.H - 60) };
}

/* ═════════ 상태 ═════════ */
const G = {
  phase: "lobby", mode: "solo", minutes: 10,
  qfile: questionFiles().includes("questions.json") ? "questions.json" : (questionFiles()[0] || "questions.json"),
  questions: [], qproblems: [], usedQ: new Set(),
  players: new Map(), boxes: [], opened: [], duels: new Map(), log: [], events: [], fx: [], minions: [], nextMinionId: 1,
  startedAt: 0, endsAt: 0, pausedLeft: 0, countdownEnd: 0,
  stage: "grow", floodIdx: -1, floodPlan: [], zone: { x: 0, y: 0, r: 1e9 }, told: {},
  judge: null, participants: new Set(), teamsAtStart: 0, teamPlace: {}, winner: null, zoneNext: null, zoneShrinking: false,
  bosses: [], nextBossId: 1, leviathanDone: false, treasure: null, nextTreasure: 0, reveal: null,
  nextDuelId: 1, nextBoxId: 1, featured: null, featuredManual: 0, leaderId: null,
  stats: { tickAvg: 0, tickMax: 0 },
};
{ const r = loadQuestions(G.qfile); G.questions = r.list; G.qproblems = r.problems; }

const T_START = Date.now();
let pauseStart = 0, pauseTotal = 0;          // 일시정지 동안에는 게임 시계가 멈춥니다
const rawNow = () => TIME_SCALE === 1 ? Date.now() : T_START + (Date.now() - T_START) * TIME_SCALE;
const now = () => (pauseStart || rawNow()) - pauseTotal;
const later = (ms, f) => setTimeout(f, ms / TIME_SCALE);
function pushLog(t, tone = "") { G.log.unshift({ t, tone }); if (G.log.length > 30) G.log.pop(); }
function bigEvent(text, tone = "") { G.events.push({ text, tone }); if (G.events.length > 6) G.events.shift(); }
function fx(o) { G.fx.push(o); if (G.fx.length > 24) G.fx.shift(); }

function spawnBox() {
  // 후보 12곳 중 기존 상자·플레이어에서 가장 멀리 떨어진 곳을 고릅니다 (한곳에 몰리지 않게)
  let best = null, bestScore = -1;
  const inside = G.stage !== "grow";
  for (let i = 0; i < 12; i++) {
    const c = freeSpot(inside);
    let minB = 1e9, minP = 1e9;
    for (const b of G.boxes) minB = Math.min(minB, Math.hypot(b.x - c.x, b.y - c.y));
    for (const q of G.players.values()) minP = Math.min(minP, Math.hypot(q.x - c.x, q.y - c.y));
    const sc = Math.min(minB, 600) + Math.min(minP, 300) * .5;
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  const p = best || freeSpot(inside);
  const roll = Math.random();
  const tier = roll < .06 ? 2 : roll < .35 ? 1 : 0;   // 나무 65% · 금테 29% · 전설 6%
  const pool = TIER_TABLE[tier];
  G.boxes.push({ id: G.nextBoxId++, x: p.x, y: p.y, type: pool[Math.random() * pool.length | 0], tier });
}
/* 홍수가 차오르면 남은 땅 넓이에 맞춰 상자 수도 줄어듭니다 */
const boxTarget = () => {
  const base = Math.max(10, Math.min(30, Math.round(G.players.size * .4) + 6));
  if (G.stage === "grow" || !MAP) return base;
  const full = Math.hypot(MAP.W, MAP.H) / 2;
  return Math.max(3, Math.round(base * Math.min(1, (G.zone.r / full) ** 2 * 1.6)));
};
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
/* 여러 사람이 같은 문제를 푸는 경우 (말씀 선포·최후의 심판) — 모두가 안 본 문제를 고릅니다 */
function pickGroupQuestion(list, hard) {
  const all0 = G.questions;
  if (!all0.length || !list.length) return null;
  let all = all0;
  if (hard === true) { const h = all0.filter((q) => q.hard); if (h.length >= 8) all = h; }
  if (hard === false) { const e = all0.filter((q) => !q.hard); if (e.length >= 8) all = e; }
  let pool = all.filter((q) => !G.usedQ.has(q.id) && list.every((p) => !p.seen.has(q.id)));
  if (!pool.length) pool = all.filter((q) => list.every((p) => !p.seen.has(q.id)));
  if (!pool.length) pool = all;
  const q0 = pool[Math.random() * pool.length | 0];
  G.usedQ.add(q0.id); list.forEach((p) => p.seen.add(q0.id));
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

/* ═════════ 선수 ═════════ */
/* 한 판마다 새로 시작하는 기록 */
function freshStats(p) {
  Object.assign(p, {
    st: "ok", hp: HP0, mhp: HP0, atk: ATK0, perk: {}, guard: p.cls === "shield" ? 2 : 0,
    lastHurt: 0, downAt: 0, bleedUntil: 0, elimAt: 0, place: 0, killedBy: "", teamSaved: 0,
    reviveGot: 0, reviveNext: 0, revNext: 0,
    ultReady: 0, ultArm: null, ultArmUntil: 0, lampLeft: 0, ultShieldUntil: 0, immuneUntil: 0,
    prayShield: 0, prayCoolUntil: 0, prayTarget: null, prayPts: 0, prayOn: false, prayNext: 0,
    pendingCards: [],
    kills: 0, hits: 0, answered: 0, correct: 0, dmgDealt: 0, dmgTaken: 0, deaths: 0, revives: 0, teamRevives: 0,
    prayers: 0, ultCount: 0, bigKills: 0, ambushHits: 0, reachedArk: false,
    bossKills: 0, minionKills: 0, boxCount: 0, distance: 0, capPoints: 0, streak: 0, bestStreak: 0, duelCount: 0,
    items: [], speedUntil: 0, ghostUntil: 0, safeUntil: 0, dodgeUntil: 0, dodgeReady: 0, portalCool: 0,
    duel: null, wrong: [], xp: 0, level: 1, keys: 0, chestT: 0, chestId: 0, boxLock: {}, tier: 0, glowUntil: 0,
    catchUpUntil: 0, lateJoin: false, capTick: 0, minionCool: 0, keyToldAt: 0, zoneTold: 0,
    q: Object.fromEntries(QUESTS.map((q) => [q.id, 0])), qDone: {},
  });
  p.recent = new Map();
}
function newPlayer(id, name, look) {
  const s = freeSpot();
  const cls = ITEM_CLASS[look.it % ITEM_CLASS.length];
  const p = { id, name, look, cls, team: 0, x: s.x, y: s.y, ix: 0, iy: 0, face: 1, walk: 0, moving: false,
              seen: new Set(), cards: [], connected: true, socketId: null, prevRank: 0, emote: 0, emoteUntil: 0 };
  freshStats(p);
  return p;
}
const stk = (p, id) => (p.perk && p.perk[id]) || 0;
const inGame = (p) => p.st === "ok" || p.st === "down" || p.st === "bleed";   // 아직 탈락하지 않음
const fighting = (p) => p.st === "ok" && G.participants.has(p.id);              // 지금 싸울 수 있음
const defMul = (p) => 1 - .1 * stk(p, "def");
const hintChance = (p) => (p.cls === "lamp" ? .25 : 0) + .25 * stk(p, "wis");
const hpPct = (p) => p.mhp ? Math.max(0, Math.min(100, Math.round(p.hp / p.mhp * 100))) : 0;
const teamCount = () => (G.mode === "team4" ? 4 : G.mode === "team2" ? 2 : 0);
const enemies = (a, b) => !teamCount() || a.team !== b.team;
function assignTeams() {
  const n = teamCount();
  if (!n) { for (const p of G.players.values()) p.team = 0; return; }
  const list = [...G.players.values()].sort(() => Math.random() - .5);
  list.forEach((p, i) => (p.team = i % n));
  pushLog(`${n}팀으로 나뉘었습니다`, "hot");
}
/* 팀별 생존 현황 */
function teamStatus() {
  const n = teamCount();
  if (!n) return [];
  const arr = TEAMS.slice(0, n).map((t) => ({ ...t, alive: 0, members: 0, kills: 0, place: G.teamPlace[t.id] || 0 }));
  for (const p of G.players.values()) {
    const a = arr[p.team]; if (!a) continue;
    if (G.phase === "lobby" || G.participants.has(p.id)) { a.members++; a.kills += p.kills || 0; if (G.phase === "lobby" || inGame(p)) a.alive++; }
  }
  return arr.slice().sort((a, b) => (b.alive - a.alive) || ((a.place || 99) - (b.place || 99)) || (b.kills - a.kills));
}
/* 뒤처진 친구(레벨 하위 40%)는 궁극기가 25% 빨리 찹니다 */
function isUnderdog(p) {
  const list = [...G.players.values()].filter((x) => G.participants.has(x.id) && inGame(x));
  if (list.length < 6) return false;
  const lv = list.map((x) => x.level || 1).sort((a, b) => a - b);
  const med = lv[lv.length >> 1];
  return (p.level || 1) <= Math.min(med - 1, lv[Math.floor(lv.length * .4)]);
}
const ultCdFor = (p) => (ULT_CD - 10000 * stk(p, "ult")) * (isUnderdog(p) ? .75 : 1);

/* ═════════ 경험치 · 레벨업 카드 ═════════ */
function addXp(p, n, why) {
  if (!n) return;
  if (now() < (p.catchUpUntil || 0)) { n = Math.round(n * 2); why = why ? why + " ×2" : why; }
  p.xp = (p.xp || 0) + n;
  const lv = levelOf(p.xp);
  if (lv > (p.level || 1)) {
    const from = p.level || 1;
    p.level = lv; p.glowUntil = now() + 3000;
    for (let L = from + 1; L <= lv; L++) offerCards(p, L);
    const ti = tierIdx(lv);
    if (ti > p.tier) {
      p.tier = ti; const T = TIERS[ti];
      if (p.socketId) io.to(p.socketId).emit("tierUp", { name: T.name, icon: T.icon });
    }
    pushLog(`⬆ ${p.name} 레벨 ${lv}!`, "gold");
    if (lv >= XP_TABLE.length) bigEvent(`🌟 ${p.name} 최고 레벨 ${lv}!`, "gold");   // 60명이면 레벨업 알림이 너무 많아 최고 레벨만 크게
    if (p.socketId) io.to(p.socketId).emit("levelUp", { level: lv, tier: TIERS[tierIdx(lv)] });
  }
  if (p.socketId && n >= 5) io.to(p.socketId).emit("xp", { n, why, xp: p.xp, level: p.level, next: XP_TABLE[Math.min(9, p.level)] || XP_TABLE[9], base: XP_TABLE[p.level - 1] });
}
function cardOptions(p) {
  const pool = CARDS.filter((c) => stk(p, c.id) < c.max && (!c.low || p.hp < p.mhp * .7));
  const weight = (c) => c.id === "hp" || c.id === "atk" ? 3 : c.id === "heal" ? 2.5 : 1.4;   // 체력·공격이 자주 나옴
  const out = [], bag = pool.slice();
  while (out.length < 3 && bag.length) {
    const tot = bag.reduce((s, c) => s + weight(c), 0);
    let r = Math.random() * tot, k = 0;
    for (; k < bag.length - 1; k++) { r -= weight(bag[k]); if (r <= 0) break; }
    out.push(bag.splice(k, 1)[0].id);
  }
  return out;
}
function offerCards(p, level) {
  const opts = cardOptions(p);
  if (!opts.length) return;
  p.pendingCards.push({ level, opts, until: 0 });
  if (p.pendingCards.length === 1) sendCards(p);
}
const CARD_MS = 12000;                  // 12초 안에 안 고르면 첫 번째 카드가 자동으로 골라집니다
function sendCards(p) {
  const c = p.pendingCards[0]; if (!c) return;
  c.until = now() + CARD_MS;
  if (p.socketId) io.to(p.socketId).emit("cards", { level: c.level, opts: c.opts.map((id) => CARD[id]), left: CARD_MS / 1000, more: p.pendingCards.length - 1 });
}
function applyCard(p, id, auto) {
  const c = p.pendingCards[0]; if (!c || !c.opts.includes(id)) return false;
  p.pendingCards.shift();
  p.perk[id] = stk(p, id) + 1;
  if (id === "hp") { p.mhp += 20; if (p.st === "ok") p.hp = Math.min(p.mhp, p.hp + 20); }
  else if (id === "atk") p.atk += 4;
  else if (id === "heal") { if (p.st === "ok") p.hp = p.mhp; }
  if (p.socketId) io.to(p.socketId).emit("cardOk", { card: CARD[id], auto: !!auto, hp: Math.round(p.hp), mhp: p.mhp, atk: p.atk });
  if (p.pendingCards.length) later(700, () => sendCards(p));
  return true;
}

/* ═════════ 체력 · 쓰러짐 · 탈락 ═════════ */
function heal(p, amount) {
  if (p.st !== "ok" || !(amount > 0)) return 0;
  const before = p.hp; p.hp = Math.min(p.mhp, p.hp + amount);
  return p.hp - before;
}
/* 피해 계산: 공격력 × 배율 → 레벨 차 보정 → 갑옷 → 한 번에 깎이는 상한 */
/* 한 번에 깎이는 최대치 — 홍수가 깊어질수록 상한도 커집니다 (보통 35% → 52%, 궁극기 55% → 70%) */
const hitCap = (def, ult) => def.mhp * Math.min(.7, (ult ? ULT_CAP : HIT_CAP) * (1 + (fightMul() - 1) * .5));
function calcDamage(att, def, mul, ult) {
  let d = att.atk * mul, crit = false;
  if (stk(att, "crit") && Math.random() < .3 * stk(att, "crit")) { d *= 1.6; crit = true; }
  const diff = (def.level || 1) - (att.level || 1);
  if (diff > 0) d *= 1 + Math.min(LV_BONUS_MAX, diff * LV_BONUS);
  d *= fightMul();
  d *= defMul(def);
  d = Math.min(d, hitCap(def, ult));
  return { dmg: Math.max(1, Math.round(d)), crit };
}
/* 체력을 깎습니다. 기도 방패 → 방패 특성(2번 절반) 순서로 막고, 0이 되면 쓰러짐 */
function hurt(p, dmg, by, kind) {
  if (p.st !== "ok" || !(dmg > 0)) return { taken: 0, absorbed: 0, down: false };
  let absorbed = 0;
  if (kind !== "flood" && p.prayShield > 0) { absorbed = Math.min(p.prayShield, dmg); p.prayShield -= absorbed; dmg -= absorbed; }
  if (dmg > 0 && p.guard > 0 && kind !== "flood") { p.guard--; const h = Math.floor(dmg / 2); absorbed += h; dmg -= h; }
  dmg = Math.round(dmg);
  p.hp -= dmg; p.dmgTaken += dmg; p.lastHurt = now();
  if (by) by.dmgDealt += dmg;
  if (p.hp <= .5) { p.hp = 0; knockDown(p, by, kind); return { taken: dmg, absorbed, down: true }; }
  return { taken: dmg, absorbed, down: false };
}
function knockDown(p, by, kind) {
  const t = now();
  p.deaths++; p.streak = 0;
  p.killedBy = by ? by.name : kind === "flood" ? "홍수" : kind === "boss" ? "보스" : "";
  if (p.duel) cancelDuelOf(p, true);
  if (by && by !== p) {
    by.kills++; quest(by, "kill1");
    const diff = (p.level || 1) - (by.level || 1);
    let xp = XP.kill + Math.max(0, diff) * 8;
    if (diff >= 3) by.bigKills++;
    if (G.leaderId === p.id) {
      xp *= 2; heal(by, by.mhp * .4);
      pushLog(`👑 ${by.name} 이(가) 현상금을 차지했습니다!`, "gold"); bigEvent(`👑 ${by.name} 현상금 획득!`, "gold");
    }
    addXp(by, Math.round(xp), `${p.name} 쓰러뜨림`);
    by.emote = 1 + (Math.random() * EMOTES.length | 0); by.emoteUntil = t + 2800;
  }
  fx({ k: "down", u: numOf.get(p.id), x: p.x | 0, y: p.y | 0, by: by ? 1 : 0, kind });
  if (G.stage === "grow") {
    p.st = "down"; p.downAt = t; p.reviveGot = 0; p.reviveNext = t + 1800;
    pushLog(by ? `⚔ ${by.name} → ${p.name} 쓰러짐` : `${p.name} 쓰러짐 (${p.killedBy || "?"})`, by ? "win" : "draw");
    if (p.socketId) io.to(p.socketId).emit("downed", { by: p.killedBy, revive: REVIVE_NEED, mode: "revive" });
  } else if (teamCount() && (p.teamSaved || 0) < TEAMREV_MAX && [...G.players.values()].some((o) => o !== p && o.team === p.team && o.st === "ok" && G.participants.has(o.id))) {
    p.st = "bleed"; p.bleedUntil = t + BLEED_MS;
    pushLog(`⚔ ${by ? by.name + " → " : ""}${p.name} 쓰러짐 — 팀원이 살릴 수 있어요`, "hot");
    if (p.socketId) io.to(p.socketId).emit("downed", { by: p.killedBy, bleed: BLEED_MS / 1000, mode: "bleed" });
  } else eliminate(p, by);
  checkWin();
}
/* 탈락 처리: 지금 남은 인원이 곧 내 순위 */
function markOut(p, by) {
  const aliveNow = [...G.players.values()].filter((o) => G.participants.has(o.id) && inGame(o)).length;
  p.st = "out"; p.elimAt = now(); p.hp = 0; p.place = aliveNow; p.prayOn = false; p.prayPts = 0; p.bleedUntil = 0; p.prayShield = 0;
  if (p.duel) cancelDuelOf(p, true);
  pushLog(`🕊 ${p.name} 탈락 — ${p.place}위` + (by ? ` (${by.name})` : p.killedBy ? ` (${p.killedBy})` : ""), "hot");
  if (aliveNow <= 12) bigEvent(`🕊 ${p.name} 탈락 · 남은 생존자 ${aliveNow - 1}명`, "hot");
  fx({ k: "out", u: numOf.get(p.id), x: p.x | 0, y: p.y | 0, n: p.name });
  if (p.socketId) io.to(p.socketId).emit("eliminated", { place: p.place, total: G.participants.size, by: by ? by.name : p.killedBy || "", team: p.team });
}
function eliminate(p, by) {
  if (p.st === "out" || p.st === "spec") return;
  markOut(p, by);
  if (teamCount()) {                     // 팀원이 모두 쓰러져 있으면 그 팀은 함께 탈락
    const mates = [...G.players.values()].filter((o) => o.team === p.team && G.participants.has(o.id));
    if (!mates.some((o) => o.st === "ok")) {
      for (const o of mates) if (o.st === "bleed" || o.st === "down") markOut(o, null);
      if (!(p.team in G.teamPlace)) {
        const aliveTeams = new Set([...G.players.values()].filter((o) => G.participants.has(o.id) && inGame(o)).map((o) => o.team));
        G.teamPlace[p.team] = aliveTeams.size + 1;
        pushLog(`🏳 ${TEAMS[p.team].name} 팀 탈락 — ${G.teamPlace[p.team]}위`, "hot");
        bigEvent(`🏳 ${TEAMS[p.team].name} 팀 탈락!`, "hot");
      }
    }
  }
}
function reviveAt(p, x, y, hpFrac, how) {
  const t = now();
  p.st = "ok"; p.hp = Math.max(1, Math.round(p.mhp * hpFrac)); p.safeUntil = t + 3000; p.lastHurt = t;
  p.bleedUntil = 0; p.downAt = 0; p.x = x; p.y = y; p.revives++; p.moving = false;
  if (how === "team" || how === "harp") p.teamSaved = (p.teamSaved || 0) + 1;   // 팀원이 살려 준 기회는 한 번
  if (p.socketId) io.to(p.socketId).emit("respawn", { x: x | 0, y: y | 0, how, hp: Math.round(p.hp), mhp: p.mhp });
  fx({ k: "revive", u: numOf.get(p.id), x: x | 0, y: y | 0 });
}
/* 남은 사람이 1명(1팀)이면 끝 */
function checkWin() {
  if (G.phase !== "playing" || G.winner) return;
  const inG = [...G.players.values()].filter((p) => G.participants.has(p.id) && inGame(p));
  if (teamCount()) {
    if (G.teamsAtStart < 2) return;
    const teams = new Set(inG.map((p) => p.team));
    if (teams.size <= 1) finish(teams.size ? [...teams][0] : lastTeamStanding());
  } else {
    if (G.participants.size < 2) return;
    if (inG.length <= 1) finish(inG[0] || lastStanding());
  }
}
/* 동시에 모두 쓰러졌다면 가장 늦게 쓰러진 사람(팀)을 우승으로 */
function lastStanding() {
  return [...G.players.values()].filter((p) => G.participants.has(p.id)).sort((a, b) => (b.elimAt - a.elimAt) || (b.kills - a.kills))[0] || null;
}
function lastTeamStanding() { const p = lastStanding(); return p ? p.team : null; }
function finish(w) {
  if (G.winner) return;
  const t = now();
  if (teamCount()) {
    G.winner = { team: w, name: w != null && TEAMS[w] ? TEAMS[w].name : "" };
    if (w != null) { G.teamPlace[w] = 1; pushLog(`🏆 ${TEAMS[w].name} 팀 우승!`, "gold"); bigEvent(`🏆 ${TEAMS[w].name} 팀 우승!`, "gold"); }
  } else {
    G.winner = w ? { id: w.id, name: w.name } : { name: "" };
    if (w) { if (w.st !== "ok") { w.st = "ok"; } w.place = 1; pushLog(`🏆 최후의 1인 — ${w.name}!`, "gold"); bigEvent(`🏆 최후의 1인 — ${w.name}!`, "gold"); }
  }
  for (const d of [...G.duels.values()]) closeDuel(d);
  G.judge = null;
  G.winAt = t;
  later(2600, () => endGame());
}
function quest(p, id, add) {
  if (!QUESTS.some((q) => q.id === id) || p.qDone[id]) return;
  p.q[id] = (p.q[id] || 0) + (add || 1);
  const Q = QUESTS.find((q) => q.id === id);
  if (p.q[id] >= Q.need) {
    p.qDone[id] = true; addXp(p, XP.quest, "도전과제");
    pushLog(`🏅 ${p.name} 도전과제 달성 — ${Q.name}`, "gold");
    if (p.socketId) io.to(p.socketId).emit("quest", { name: Q.name, desc: Q.desc, xp: XP.quest });
  }
}

/* ═════════ 대결 ═════════ */
const duelBonusTime = (p) => (p.cls === "scroll" ? 4 : 0) + 3 * stk(p, "time");
const slingMul = (att, def) => 2 * (1 + Math.min(.75, .15 * Math.max(0, (def.level || 1) - (att.level || 1))));
function useItem(p, used, k) {
  const i = p.items.indexOf(k);
  if (i < 0) return false;
  p.items.splice(i, 1); used.push(BOX_ITEMS[k].icon + " " + BOX_ITEMS[k].name); return true;
}
/* 대결이 시작될 때 내게 붙는 효과: 오답 지우기(아이템·등불·지혜·궁극기), 두 배, 방패, 물맷돌, 모래시계 */
function armFor(d, p, q, kind) {
  const t = now(), used = [];
  let hide = 0;
  if (kind !== "judge") {
    if (useItem(p, used, "hint")) hide = 1;
    else if (Math.random() < hintChance(p)) { hide = 1; used.push("🕯 지혜"); }
    if (p.ultArm === "lamp" && p.lampLeft > 0 && t < p.ultArmUntil) {
      hide = 2; p.lampLeft--; used.push("🕯 지혜의 빛" + (p.lampLeft ? ` (${p.lampLeft}번 남음)` : ""));
      if (!p.lampLeft) p.ultArm = null;
    }
  }
  const wrong = q.options.map((_, i) => i).filter((i) => i !== q.answer).sort(() => Math.random() - .5);
  d.hide[p.id] = wrong.slice(0, hide);
  if (kind === "pvp" || kind === "boss") {
    d.dbl[p.id] = kind === "pvp" && useItem(p, used, "double");
    d.shield[p.id] = useItem(p, used, "shield");
    if (!d.shield[p.id] && t < p.ultShieldUntil) { d.shield[p.id] = true; p.ultShieldUntil = 0; used.push("🛡 믿음의 방패"); }
    if (kind === "pvp" && p.ultArm === "sling" && t < p.ultArmUntil) { d.sling[p.id] = true; p.ultArm = null; used.push("🎯 다윗의 물맷돌"); }
    if (useItem(p, used, "time")) d.plus = 6;
  }
  d.used[p.id] = used;
}
const blankDuel = () => ({ picks: {}, hide: {}, dbl: {}, shield: {}, sling: {}, used: {}, lock: {}, counterUntil: 0, plus: 0 });
function startDuel(a, b, ambush) {
  const region = regionOf((a.y + b.y) / 2, (a.x + b.x) / 2);
  const q = pickQuestion(a, b, region);
  if (!q) return;
  const id = G.nextDuelId++;
  const d = { id, kind: "pvp", a: a.id, b: b.id, q, region, ...blankDuel(),
              ambush: ambush ? a.id : null, lock: ambush ? { [b.id]: now() + AMBUSH_LOCK } : {} };
  armFor(d, a, q, "pvp"); armFor(d, b, q, "pvp");
  d.limit = DUEL_TIME + readTime(q) + Math.max(duelBonusTime(a), duelBonusTime(b)) + (d.plus || 0) + (isUnderdog(a) || isUnderdog(b) ? 2 : 0);
  d.endsAt = now() + d.limit * 1000;
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
  const d = { id, kind: "boss", a: p.id, b: null, q, region: regionOf(p.y, p.x), boss: boss.type, bossId: boss.id, ...blankDuel() };
  armFor(d, p, q, "boss");
  d.limit = B.limit + readTime(q) + duelBonusTime(p) + (d.plus || 0);
  d.endsAt = now() + d.limit * 1000;
  p.duel = id; p.duelCount++; boss.busyUntil = now() + d.limit * 1000 + 500;
  G.duels.set(id, d);
  sendDuel(p, d);
  pushLog(`⚔ ${p.name} 이(가) ${B.name}과 맞섰습니다!`, "hot");
  if (boss.type === "leviathan") bigEvent(`${p.name} vs ${B.name}`, "hot");
}
/* 혼자 푸는 문제: 미니언·자물쇠·부활·팀원 살리기·중보기도 */
function startSoloQuiz(p, kind, extra, base) {
  const q = pickQuestion(p, null, kind === "minion" || kind === "chest" ? regionOf(p.y, p.x) : null, false, true);
  if (!q) return null;
  const id = G.nextDuelId++;
  const d = { id, kind, a: p.id, b: null, q, region: kind === "minion" || kind === "chest" ? regionOf(p.y, p.x) : null, ...blankDuel(), ...(extra || {}) };
  d.hide[p.id] = [];
  d.limit = (base || 13) + readTime(q);
  d.endsAt = now() + d.limit * 1000;
  p.duel = id; G.duels.set(id, d); sendDuel(p, d);
  return d;
}
function startMinionDuel(p, m) {
  const M = MINIONS[m.type];
  const d = startSoloQuiz(p, "minion", { minion: m.type, minionId: m.id }, M.limit);
  if (!d) return;
  m.busyUntil = now() + d.limit * 1000 + 300; p.minionCool = now() + d.limit * 1000 + 5000;   // 끝난 뒤 5초는 미니언과 안 붙음
}
function startChestDuel(p, b) {
  const d = startSoloQuiz(p, "chest", { boxId: b.id }, 12);
  if (!d) return;
  b.busy = true; p.chestId = 0;
}
/* 말씀 선포(두루마리 궁극기): 주변 적 모두에게 같은 문제 — 틀린 사람은 피해 */
function startSermon(caster, targets) {
  const q = pickGroupQuestion(targets, false);
  if (!q) return 0;
  const limit = 12 + readTime(q), endsAt = now() + limit * 1000;
  for (const p of targets) {
    const id = G.nextDuelId++;
    const d = { id, kind: "sermon", a: p.id, b: null, caster: caster.id, q, limit, endsAt, region: null, ...blankDuel() };
    armFor(d, p, q, "sermon");
    p.duel = id; G.duels.set(id, d); sendDuel(p, d);
  }
  return targets.length;
}
function previewDamage(att, def, d) {
  if (d.shield[def.id]) return 0;
  let mul = 1;
  if (d.ambush === att.id) mul *= AMBUSH_MUL;
  if (d.dbl[att.id]) mul *= 2;
  const ult = !!d.sling[att.id]; if (ult) mul *= slingMul(att, def);
  let x = att.atk * mul;
  const diff = (def.level || 1) - (att.level || 1);
  if (diff > 0) x *= 1 + Math.min(LV_BONUS_MAX, diff * LV_BONUS);
  x *= fightMul();
  x *= defMul(def);
  return Math.max(1, Math.round(Math.min(x, hitCap(def, ult))));
}
function sendDuel(p, d) {
  if (!p.socketId) return;
  const foe = d.kind === "pvp" ? G.players.get(d.a === p.id ? d.b : d.a) : null;
  const caster = d.caster ? G.players.get(d.caster) : null;
  const tgt = d.target ? G.players.get(d.target) : null;
  const pray = d.kind === "pray" ? G.players.get(p.prayTarget) : null;
  const card = (o) => ({ name: o.name, look: { ...o.look, tier: tierIdx(o.level) }, level: o.level || 1, hp: Math.round(o.hp), mhp: o.mhp, atk: o.atk, team: o.team, streak: o.streak });
  let foeInfo = null;
  if (d.kind === "minion") foeInfo = { name: MINIONS[d.minion].name, minion: d.minion, xp: MINIONS[d.minion].xp };
  else if (d.kind === "chest") foeInfo = { name: "자물쇠", chest: true };
  else if (d.kind === "boss") foeInfo = { name: BOSSES[d.boss].name, boss: d.boss };
  else if (foe) foeInfo = card(foe);
  else if (caster) foeInfo = { ...card(caster), caster: true };
  else if (tgt) foeInfo = { ...card(tgt), target: true };
  else if (pray) foeInfo = { ...card(pray), pray: true };
  let dealt = 0, risk = 0;
  if (d.kind === "pvp" && foe) { dealt = previewDamage(p, foe, d); risk = previewDamage(foe, p, d); }
  if (d.kind === "boss") risk = d.shield[p.id] ? 0 : Math.round(p.mhp * bossDmgPct(d.boss) * defMul(p));
  if (d.kind === "sermon" && caster) risk = Math.round(Math.min(caster.atk * 1.3 * defMul(p), hitCap(p, false)));
  io.to(p.socketId).emit("duel", {
    id: d.id, left: Math.max(0, d.endsAt - now()) / TIME_SCALE, limit: d.limit / TIME_SCALE, kind: d.kind, boss: d.boss || null, region: d.region, minion: d.minion || null,
    question: d.q.text, options: d.q.options, hide: d.hide[p.id] || [],
    foe: foeInfo, me: { hp: Math.round(p.hp), mhp: p.mhp, atk: p.atk, level: p.level || 1 },
    dealt, risk, dbl: !!d.dbl[p.id], shield: !!d.shield[p.id], sling: !!d.sling[p.id], used: d.used[p.id] || [],
    ambush: d.ambush ? (d.ambush === p.id ? "attacker" : "victim") : null,
    lock: d.lock && d.lock[p.id] ? Math.max(0, d.lock[p.id] - now()) / TIME_SCALE : 0,
    got: d.kind === "revive" ? p.reviveGot : d.kind === "pray" ? p.prayPts : 0,
    need: d.kind === "revive" ? REVIVE_NEED : d.kind === "pray" ? PRAY_NEED : 0,
    round: d.round || 0, alive: d.alive || 0,
  });
}
function noteWrong(p, q, myChoice) {
  p.wrong.push({ id: q.id, q: q.text, options: q.options, answer: q.answer, mine: myChoice, ref: q.ref, exp: q.exp });
  if (p.wrong.length > 40) p.wrong.shift();
}
function giveCard(p, q) {
  if (!q.ref) return null;
  const card = { ref: q.ref, exp: q.exp, q: q.text };
  if (!p.cards.some((c) => c.ref === card.ref)) p.cards.push(card);
  return card;
}
const resOf = (q) => ({ answer: q.answer, options: q.options, question: q.text, ref: q.ref, exp: q.exp });
/* 판정 없이 대결을 정리 (게임이 끝났을 때 등) */
function closeDuel(d) {
  if (!d || !G.duels.has(d.id)) return;
  G.duels.delete(d.id);
  if (G.featured === d.id) G.featured = null;
  if (d.kind === "teamrev") { const b = G.players.get(d.target); if (b) b.revBy = null; }
  if (d.kind === "chest") { const b = G.boxes.find((x) => x.id === d.boxId); if (b) b.busy = false; }
  if (d.kind === "boss") { const bz = G.bosses.find((x) => x.id === d.bossId); if (bz) bz.busyUntil = 0; }
  for (const id of [d.a, d.b]) {
    const o = id && G.players.get(id);
    if (o && o.duel === d.id) { o.duel = null; if (o.socketId) io.to(o.socketId).emit("duelEnd", { ...resOf(d.q), kind: "cancel", result: "cancel" }); }
  }
}
/* 대결 도중 쓰러지거나 탈락했을 때: 대결을 취소하고 상대를 풀어 줍니다 */
function cancelDuelOf(p) {
  const d = G.duels.get(p.duel);
  p.duel = null;
  if (!d || d.kind === "judge") return;
  closeDuel(d);
  const other = d.kind === "pvp" ? G.players.get(d.a === p.id ? d.b : d.a) : null;
  if (other) other.safeUntil = now() + 2500;
  if (p.socketId) io.to(p.socketId).emit("duelEnd", { ...resOf(d.q), kind: "cancel", result: "cancel" });
}
function showReveal(d, win, a, b) {
  G.reveal = { id: d.id, boss: d.boss || null, q: d.q.text, options: d.q.options, answer: d.q.answer,
               ref: d.q.ref, exp: d.q.exp, winner: win, a, b, until: now() + 4500 };
}
const revealSide = (d, p, o) => ({ name: p.name, look: { ...p.look, tier: tierIdx(p.level) }, team: p.team, level: p.level || 1,
  picked: d.picks[p.id] ? d.picks[p.id].choice : -1, ok: !!(d.picks[p.id] && d.picks[p.id].correct),
  hp: Math.round(p.hp), mhp: p.mhp, dealt: o ? o.dealt : 0, taken: o ? o.taken : 0, down: p.st !== "ok" });
function emitEnd(p, o) { if (p && p.socketId) io.to(p.socketId).emit("duelEnd", o); }

function resolveDuel(d) {
  if (!G.duels.has(d.id)) return;
  G.duels.delete(d.id);
  if (G.featured === d.id) G.featured = null;
  const res = resOf(d.q), t = now(), P = (id) => id && G.players.get(id);
  const pickOf = (p) => d.picks[p.id], okOf = (p) => !!(d.picks[p.id] && d.picks[p.id].correct);

  if (d.kind === "minion") {
    const p = P(d.a); if (!p) return;
    p.duel = null; p.safeUntil = t + 1500;
    const m = G.minions.find((x) => x.id === d.minionId), M = MINIONS[d.minion];
    if (okOf(p)) {
      p.minionKills++; addXp(p, M.xp, M.name + " 처치");
      const hl = heal(p, p.mhp * .08);
      let key = false; if (Math.random() < M.key) { p.keys++; key = true; }
      if (m) { m.dead = true; m.respawnAt = t + 15000; }
      emitEnd(p, { ...res, kind: "minion", result: "win", xp: M.xp, key, heal: Math.round(hl), minion: d.minion, hp: Math.round(p.hp), mhp: p.mhp });
    } else {
      noteWrong(p, d.q, pickOf(p) ? pickOf(p).choice : -1);
      if (m) m.busyUntil = t + 4000;
      emitEnd(p, { ...res, kind: "minion", result: "lose", minion: d.minion });
    }
    return;
  }
  if (d.kind === "chest") {
    const p = P(d.a); if (!p) return;
    p.duel = null; p.safeUntil = t + 1500;
    const b = G.boxes.find((x) => x.id === d.boxId);
    if (b) b.busy = false;
    if (okOf(p) && b) { openBox(p, b); emitEnd(p, { ...res, kind: "chest", result: "win", opened: true }); }
    else { noteWrong(p, d.q, pickOf(p) ? pickOf(p).choice : -1); p.boxLock[d.boxId] = t + 10000; emitEnd(p, { ...res, kind: "chest", result: "lose" }); }
    return;
  }
  if (d.kind === "revive") {
    const p = P(d.a); if (!p) return;
    p.duel = null;
    const ok = okOf(p);
    if (ok) { p.reviveGot++; addXp(p, XP.revive, ""); } else noteWrong(p, d.q, pickOf(p) ? pickOf(p).choice : -1);
    p.reviveNext = t + (ok ? 1300 : 2600);
    emitEnd(p, { ...res, kind: "revive", result: ok ? "win" : "lose", got: p.reviveGot, need: REVIVE_NEED });
    return;
  }
  if (d.kind === "teamrev") {
    const r = P(d.a), b = P(d.target); if (!r) return;
    r.duel = null; r.safeUntil = t + 1500;
    if (b) b.revBy = null;
    const ok = okOf(r);
    if (ok && b && b.st === "bleed") {
      reviveAt(b, b.x, b.y, TEAMREV_HP, "team"); r.teamRevives++; addXp(r, XP.teamrev, `${b.name} 살림`);
      pushLog(`🤝 ${r.name} 이(가) ${b.name}을(를) 일으켰습니다!`, "win");
    } else { r.revNext = t + 2500; if (!ok) noteWrong(r, d.q, pickOf(r) ? pickOf(r).choice : -1); }
    emitEnd(r, { ...res, kind: "teamrev", result: ok ? "win" : "lose", name: b ? b.name : "" });
    return;
  }
  if (d.kind === "pray") {
    const p = P(d.a); if (!p) return;
    p.duel = null;
    const ok = okOf(p);
    if (ok) { p.prayPts = Math.min(PRAY_NEED, p.prayPts + 1); p.prayNext = t + 1200; }
    else { p.prayNext = t + 2200; noteWrong(p, d.q, pickOf(p) ? pickOf(p).choice : -1); }
    const gave = deliverPrayer(p, t);
    const tg = P(p.prayTarget);
    emitEnd(p, { ...res, kind: "pray", result: ok ? "win" : "lose", got: p.prayPts, need: PRAY_NEED, gave,
                 target: tg ? tg.name : "", wait: tg && p.prayPts >= PRAY_NEED ? Math.max(0, Math.ceil((tg.prayCoolUntil - t) / 1000)) : 0 });
    return;
  }
  if (d.kind === "sermon") {
    const p = P(d.a), c = P(d.caster); if (!p) return;
    p.duel = null; p.safeUntil = t + 2000;
    const ok = okOf(p);
    let taken = 0, down = false, blocked = false;
    if (ok) addXp(p, XP.saved, "말씀을 지킴");
    else {
      noteWrong(p, d.q, pickOf(p) ? pickOf(p).choice : -1);
      if (p.st === "ok") {
        if (t < p.ultShieldUntil) { blocked = true; p.ultShieldUntil = 0; }
        else if (c) {
          const { dmg } = calcDamage(c, p, 1.3, false);
          const r = hurt(p, dmg, c, "sermon"); taken = r.taken; down = r.down;
          if (taken > 0) addXp(c, XP.sermon, "말씀 선포 명중");
        }
      }
    }
    emitEnd(p, { ...res, kind: "sermon", result: ok ? "safe" : down ? "down" : blocked ? "block" : "hurt", taken, blocked, caster: c ? c.name : "", hp: Math.round(p.hp), mhp: p.mhp });
    if (c && c.socketId) io.to(c.socketId).emit("sermonHit", { name: p.name, ok, taken, down });
    return;
  }
  if (d.kind === "boss") {
    const p = P(d.a); if (!p) return;
    const B = BOSSES[d.boss], boss = G.bosses.find((b) => b.id === d.bossId);
    p.duel = null; p.safeUntil = t + AFTER_DUEL * 1000;
    if (boss) boss.busyUntil = 0;
    const side = { name: B.name, boss: d.boss };
    if (okOf(p)) {
      p.bossKills++; quest(p, "boss1");
      const low = (p.level || 1) <= 3;
      addXp(p, Math.round(XP.boss * (low ? 1.5 : 1)), B.name + " 격파" + (low ? " (저레벨 보너스)" : ""));
      const hl = heal(p, p.mhp * .3);
      p.ultReady = Math.min(p.ultReady, t);                  // 보스를 이기면 궁극기 바로 충전
      p.emote = 1 + (Math.random() * EMOTES.length | 0); p.emoteUntil = t + 2800;
      pushLog(`🏅 ${p.name} 이(가) ${B.name}을 쓰러뜨렸습니다! 회복 + 궁극기 충전`, "gold");
      bigEvent(`🏅 ${p.name} ${B.name} 격파!`, "gold");
      if (boss) {
        boss.dead = true; boss.respawnAt = t + (boss.type === "amalek" ? BOSS_RESPAWN_FAST : BOSS_RESPAWN);
        if (boss.type === "pharaoh") { G.boxes.push({ id: G.nextBoxId++, x: boss.x, y: boss.y, type: "manna", tier: 1 }); pushLog("👑 바로 왕이 만나 상자를 떨어뜨렸습니다!", "gold"); }
      }
      showReveal(d, p.name, revealSide(d, p, null), side);
      emitEnd(p, { ...res, kind: "boss", result: "win", boss: d.boss, heal: Math.round(hl), ult: true, hp: Math.round(p.hp), mhp: p.mhp,
                   sticker: STICKERS[Math.random() * STICKERS.length | 0], card: giveCard(p, d.q) });
    } else {
      p.streak = 0;
      noteWrong(p, d.q, pickOf(p) ? pickOf(p).choice : -1);
      if (d.boss === "serpent" && p.items.length) { pushLog(`🐍 ${p.name} 이(가) 에덴의 뱀에게 아이템 ${p.items.length}개를 빼앗겼습니다`, "draw"); p.items = []; }
      const blocked = !!d.shield[p.id];
      const r = blocked ? { taken: 0, absorbed: 0, down: false } : hurt(p, Math.round(p.mhp * bossDmgPct(d.boss) * defMul(p)), null, "boss");
      if (!r.down) pushLog(`${p.name} 이(가) ${B.name}에게 당했습니다 (−${r.taken})`, "draw");
      showReveal(d, B.name, revealSide(d, p, { dealt: 0, taken: r.taken }), side);
      emitEnd(p, { ...res, kind: "boss", result: r.down ? "down" : blocked ? "block" : "hurt", boss: d.boss, taken: r.taken, absorbed: r.absorbed, blocked, hp: Math.round(p.hp), mhp: p.mhp });
    }
    return;
  }

  /* ── 사람끼리: 맞히면 상대 체력이 깎입니다 ── */
  const a = P(d.a), b = P(d.b);
  if (!a || !b) { for (const o of [a, b]) if (o && o.duel === d.id) o.duel = null; return; }
  const aOk = okOf(a), bOk = okOf(b);
  const out = { [a.id]: { dealt: 0, taken: 0 }, [b.id]: { dealt: 0, taken: 0 } };
  let first = null, second = null;
  if (aOk && bOk) { first = d.picks[a.id].at <= d.picks[b.id].at ? a : b; second = first === a ? b : a; }
  else if (aOk) first = a; else if (bOk) first = b;
  const strike = (att, def, isFirst) => {
    if (att.st !== "ok" || def.st !== "ok") return;          // 먼저 맞고 쓰러졌으면 반격 없음
    let mul = 1;
    if (isFirst && second) mul *= FIRST_BONUS;
    if (d.ambush === att.id) mul *= AMBUSH_MUL;
    if (d.dbl[att.id]) mul *= 2;
    const ult = !!d.sling[att.id]; if (ult) mul *= slingMul(att, def);
    let { dmg, crit } = calcDamage(att, def, mul, ult);
    const o = out[att.id], od = out[def.id];
    o.crit = crit; o.sling = ult;
    if (d.shield[def.id]) { od.blocked = true; o.foeBlocked = true; dmg = 0; }
    const r = dmg ? hurt(def, dmg, att, "pvp") : { taken: 0, absorbed: 0, down: false };
    o.dealt = r.taken; od.taken = r.taken; od.absorbed = r.absorbed;
    if (r.taken > 0 && stk(att, "vamp")) o.vamp = Math.round(heal(att, r.taken * .3 * stk(att, "vamp")));
    if (d.ambush === att.id && r.taken > 0) att.ambushHits++;
    if (r.down) { o.ko = true; od.down = true; if (ult) att.ultKills = (att.ultKills || 0) + 1; }
  };
  if (first) strike(first, first === a ? b : a, true);
  if (second) strike(second, second === a ? b : a, false);
  for (const [p, ok] of [[a, aOk], [b, bOk]]) {
    if (ok) {
      p.hits++; p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak);
      addXp(p, XP.hit, "명중"); quest(p, "hit1"); if (p.streak === 3) quest(p, "streak3", 3);
    } else { p.streak = 0; noteWrong(p, d.q, d.picks[p.id] ? d.picks[p.id].choice : -1); addXp(p, XP.miss, ""); }
  }
  const oa = out[a.id], ob = out[b.id];
  pushLog(`${a.name} ⚔ ${b.name} — ` + (aOk || bOk ? `${a.name} −${oa.taken} / ${b.name} −${ob.taken}` : "둘 다 빗나감"), aOk || bOk ? "win" : "draw");
  showReveal(d, first ? first.name : null, revealSide(d, a, oa), revealSide(d, b, ob));
  const send = (p, foe) => {
    const o = out[p.id], mine = okOf(p);
    const result = o.down ? "down" : o.ko ? "ko" : o.dealt > 0 && o.taken > 0 ? "trade" : (o.dealt > 0 || o.foeBlocked) ? "hit"
                 : o.taken > 0 ? "hurt" : o.blocked ? "block" : "miss";
    emitEnd(p, { ...res, kind: "pvp", result, mine, foeOk: okOf(foe), first: first === p && !!second,
      dealt: o.dealt, taken: o.taken, crit: !!o.crit, sling: !!o.sling, blocked: !!o.blocked, foeBlocked: !!o.foeBlocked,
      absorbed: o.absorbed || 0, vamp: o.vamp || 0, hp: Math.round(p.hp), mhp: p.mhp, foe: foe.name, foeHp: Math.round(foe.hp), foeMhp: foe.mhp,
      streak: p.streak, sticker: o.ko ? STICKERS[Math.random() * STICKERS.length | 0] : null, card: mine ? giveCard(p, d.q) : null });
  };
  send(a, b); send(b, a);
  const rm = rematchMs();
  for (const p of [a, b]) { if (p.duel === d.id) p.duel = null; if (p.st === "ok") p.safeUntil = t + AFTER_DUEL * 1000; }
  a.recent.set(b.id, t + rm); b.recent.set(a.id, t + rm);
  if (a.st === "ok" && b.st === "ok") {
    const dx = a.x - b.x, dy = a.y - b.y, len = Math.hypot(dx, dy) || 1;
    const push = (p, sx, sy) => {
      for (let k = 36; k > 0; k -= 12) {
        const nx = clamp(p.x + sx * k, R, MAP.W - R), ny = clamp(p.y + sy * k, R, MAP.H - R);
        if (!blocked(nx, ny)) { p.x = nx; p.y = ny; return; }
      }
    };
    push(a, dx / len, dy / len); push(b, -dx / len, -dy / len);
  }
}
/* 중보기도 점수가 다 차면 기도 대상에게 방패를 보냅니다 (대상이 받을 수 있을 때) */
function deliverPrayer(p, t) {
  if (p.prayPts < PRAY_NEED) return null;
  const tg = G.players.get(p.prayTarget);
  if (!tg || tg.st !== "ok" || tg.prayShield > 0 || t < tg.prayCoolUntil) return null;
  p.prayPts = 0; p.prayers++;
  tg.prayShield = Math.round(tg.mhp * PRAY_SHIELD); tg.prayCoolUntil = t + PRAY_COOL;
  if (tg.socketId) io.to(tg.socketId).emit("prayed", { from: p.name, shield: tg.prayShield });
  if (p.socketId) io.to(p.socketId).emit("prayDone", { to: tg.name, shield: tg.prayShield });
  pushLog(`🙏 ${p.name}의 중보기도 → ${tg.name} 방패 +${tg.prayShield}`, "gold");
  fx({ k: "pray", u: numOf.get(tg.id), n: p.name, x: tg.x | 0, y: tg.y | 0 });
  return tg.name;
}

/* ═════════ 최후의 심판 — 시간이 다 됐는데 여럿 남았을 때 ═════════ */
function startJudgment() {
  if (G.stage === "judge" || G.winner) return;
  G.stage = "judge";
  G.judge = { round: 0, next: now() + 3000, q: null, ids: [], results: null, endsAt: 0 };
  for (const d of [...G.duels.values()]) { if (d.kind === "pvp" || d.kind === "boss" || d.kind === "sermon") resolveDuel(d); else closeDuel(d); }
  for (const p of G.players.values())
    if (G.participants.has(p.id) && (p.st === "down" || p.st === "bleed")) { p.killedBy = "시간 종료"; eliminate(p, null); }
  G.bosses = []; G.minions = [];
  pushLog("⚖ 최후의 심판! 남은 사람 모두 같은 문제 — 틀리면 탈락", "gold");
  bigEvent("⚖ 최후의 심판!", "gold");
  checkWin();
}
function judgeRound() {
  const J = G.judge; if (!J || G.winner) return;
  const list = [...G.players.values()].filter((p) => G.participants.has(p.id) && p.st === "ok");
  if (!list.length) return;
  J.round++;
  const q = pickGroupQuestion(list, J.round >= 4 ? true : undefined);
  if (!q) return;
  const limit = JUDGE_Q + readTime(q);
  Object.assign(J, { q, ids: list.map((p) => p.id), results: null, at: now(), limit, endsAt: now() + limit * 1000 });
  for (const p of list) {
    if (p.duel) closeDuel(G.duels.get(p.duel));
    const id = G.nextDuelId++;
    const d = { id, kind: "judge", a: p.id, b: null, q, limit, endsAt: J.endsAt, region: null, round: J.round, alive: list.length, ...blankDuel() };
    d.hide[p.id] = [];
    p.duel = id; G.duels.set(id, d); sendDuel(p, d);
  }
  pushLog(`⚖ 심판 ${J.round}라운드 — ${list.length}명`, "gold");
}
function judgeAnswered() {
  const J = G.judge; if (!J || !J.q || J.results) return;
  const all = J.ids.every((id) => { const p = G.players.get(id); const d = p && p.duel && G.duels.get(p.duel); return !d || d.kind !== "judge" || d.picks[id]; });
  if (all) judgeResolve();
}
function judgeResolve() {
  const J = G.judge; if (!J || !J.q || J.results) return;
  const t = now();
  const rows = J.ids.map((id) => {
    const p = G.players.get(id); if (!p) return null;
    const d = p.duel && G.duels.get(p.duel);
    const pk = d && d.kind === "judge" ? d.picks[id] : null;
    if (d) G.duels.delete(d.id);
    p.duel = null;
    return { p, pk, ok: !!(pk && pk.correct), at: pk ? pk.at : Infinity };
  }).filter(Boolean);
  rows.forEach((r) => { r.p.answered++; if (r.ok) r.p.correct++; else noteWrong(r.p, J.q, r.pk ? r.pk.choice : -1); });
  let out = rows.filter((r) => !r.ok);
  if (out.length === rows.length) out = [];                          // 모두 틀리면 아무도 탈락하지 않음
  const okRows = rows.filter((r) => r.ok);
  if (!teamCount() && okRows.length > 1 && J.round >= 2) {          // 개인전 2라운드부터: 맞힌 사람 중 가장 늦은 사람도 탈락
    const slow = okRows.slice().sort((a, b) => b.at - a.at)[0]; slow.slow = true; out = [...out, slow];
  }
  if (teamCount()) {                                                  // 팀전: 한 팀만 남으면 그 팀 우승이므로 나머지 팀만 판정
    const left = new Set(rows.filter((r) => !out.includes(r)).map((r) => r.p.team));
    if (!left.size) out = [];
  }
  out.sort((a, b) => a.p.hp - b.p.hp).forEach((r) => { r.p.killedBy = r.slow ? "최후의 심판 (가장 늦게 맞힘)" : "최후의 심판"; eliminate(r.p, null); });
  J.results = { rows: rows.map((r) => ({ u: numOf.get(r.p.id), name: r.p.name, ok: r.ok, picked: r.pk ? r.pk.choice : -1, out: out.includes(r), slow: !!r.slow, team: r.p.team })) };
  const left = rows.length - out.length;
  for (const r of rows) emitEnd(r.p, { ...resOf(J.q), kind: "judge", result: out.includes(r) ? "out" : "safe", slow: !!r.slow, round: J.round, left, mine: r.ok });
  J.next = t + JUDGE_GAP;
  pushLog(out.length ? `⚖ ${J.round}라운드: ${out.map((r) => r.p.name).join(", ")} 탈락 — ${left}명 남음` : `⚖ ${J.round}라운드: 탈락자 없음`, "hot");
  checkWin();
  if (!G.winner && J.round >= (teamCount() ? JUDGE_TEAM_MAX : JUDGE_MAX)) {   // 안 갈리면: 팀전은 살아남은 인원(같으면 체력), 개인전은 체력 비율
    const alive = [...G.players.values()].filter((p) => G.participants.has(p.id) && p.st === "ok");
    if (teamCount()) {
      const cnt = {}, sum = {}; alive.forEach((p) => { cnt[p.team] = (cnt[p.team] || 0) + 1; sum[p.team] = (sum[p.team] || 0) + p.hp / p.mhp; });
      const best = Object.keys(cnt).sort((a, b) => (cnt[b] - cnt[a]) || (sum[b] - sum[a]))[0];
      pushLog(`⚖ 심판 끝 — ${TEAMS[best].name} 팀이 가장 많이 살아남았습니다 (${cnt[best]}명)`, "gold");
      alive.filter((p) => String(p.team) !== best).forEach((p) => { p.killedBy = "최후의 심판 (살아남은 인원)"; eliminate(p, null); });
    } else {
      alive.sort((a, b) => (a.hp / a.mhp) - (b.hp / b.mhp)).slice(0, -1).forEach((p) => eliminate(p, null));
    }
    checkWin();
  }
}
function stepJudge(t) {
  const J = G.judge; if (!J || G.winner) return;
  if (!J.q || (J.results && t >= J.next)) { if (t >= J.next) judgeRound(); return; }
  if (!J.results && t >= J.endsAt) judgeResolve();
}

/* ═════════ 홍수 ═════════ */
function planFlood() {
  const r0 = Math.hypot(MAP.W, MAP.H) / 2 + 80;
  let cx = MAP.W / 2, cy = MAP.H / 2, r = r0;
  const plan = [];
  for (const s of FLOOD) {
    const nr = Math.max(240, r0 * s.r);
    let best = null;
    for (let i = 0; i < 200 && !best; i++) {
      const a = Math.random() * 6.283, dd = Math.random() * Math.max(0, r - nr) * .8;
      const mx = Math.min(nr, MAP.W / 2) * .55 + 80, my = Math.min(nr, MAP.H / 2) * .55 + 80;
      const x = clamp(cx + Math.cos(a) * dd, mx, MAP.W - mx), y = clamp(cy + Math.sin(a) * dd, my, MAP.H - my);
      if (Math.hypot(x - cx, y - cy) + nr > r + 1) continue;          // 이전 원 안에 쏙 들어가게
      if (blocked(x, y) || tileAt(x, y) === 7) continue;
      let open = 0;                                                     // 방주 둘레에 걸을 땅이 충분한지
      for (let k = 0; k < 16; k++) { const aa = k / 16 * 6.283; if (!blocked(x + Math.cos(aa) * nr * .5, y + Math.sin(aa) * nr * .5)) open++; }
      if (open >= 11) best = { x, y };
    }
    if (!best) best = { x: cx, y: cy };
    plan.push({ ...s, x0: cx, y0: cy, r0: r, x: best.x, y: best.y, r: nr });
    cx = best.x; cy = best.y; r = nr;
  }
  return plan;
}
/* 지금 물 높이(안전지대 원)와 다음 목표 원 */
function floodState(t) {
  const plan = G.floodPlan;
  if (!plan.length || !G.endsAt) return { z: { x: MAP.W / 2, y: MAP.H / 2, r: 1e9 }, idx: -1, next: null };
  const f = (t - G.startedAt) / (G.endsAt - G.startedAt);
  let z = { x: plan[0].x0, y: plan[0].y0, r: plan[0].r0 }, idx = -1, next = null, shrinking = false;
  for (let i = 0; i < plan.length; i++) {
    const s = plan[i];
    if (f < s.at) { next = s; break; }
    const k = Math.min(1, (f - s.at) / s.dur), e = k * k * (3 - 2 * k);
    z = { x: s.x0 + (s.x - s.x0) * e, y: s.y0 + (s.y - s.y0) * e, r: s.r0 + (s.r - s.r0) * e };
    idx = i;
    if (k < 1) { next = s; shrinking = true; break; }
  }
  return { z, idx, next, shrinking };
}
function updateFlood(t) {
  const T = G.endsAt - G.startedAt, f = (t - G.startedAt) / T, left = (G.endsAt - t) / 1000;
  const once = (k, fn) => { if (!G.told[k]) { G.told[k] = true; fn(); } };
  if (G.stage === "grow") {
    if (f >= GROW_END - 30000 / T) once("warn0", () => { pushLog("⚠ 30초 뒤 홍수! 그때부터는 쓰러지면 탈락입니다", "warn"); bigEvent("⚠ 30초 뒤 홍수 — 이제 부활 없음!", "warn"); });
    if (f >= GROW_END) {
      G.stage = "flood";
      for (const p of G.players.values()) if (p.st === "ok") heal(p, p.mhp * .3);   // 숨 고르기: 모두 체력 30% 회복
      pushLog("🌊 홍수가 시작됐습니다! 모두 체력 30% 회복 — 이제 쓰러지면 탈락", "warn");
      bigEvent("🌊 홍수 시작! 이제 쓰러지면 탈락", "warn");
    }
  }
  const fs0 = floodState(t);
  G.zone = fs0.z; G.floodIdx = fs0.idx; G.zoneNext = fs0.next; G.zoneShrinking = fs0.shrinking;
  G.floodPlan.forEach((s, i) => {
    if (i > 0 && f >= s.at - 15000 / T) once("w" + i, () => { pushLog(`🌊 15초 뒤 물이 더 차오릅니다 (${i + 1}단계)`, "warn"); bigEvent(`🌊 15초 뒤 ${i + 1}단계 홍수!`, "warn"); });
    if (f >= s.at) once("s" + i, () => {
      if (i > 0) { pushLog(`🌊 ${i + 1}단계 홍수 — 물이 차오릅니다!`, "warn"); bigEvent(`🌊 ${i + 1}단계 홍수!`, "warn"); }
      if (i === ARK) {                                                   // 방주 단계: 보스·미니언은 물러갑니다
        G.bosses = []; G.minions = [];
        pushLog("⛵ 방주만 남습니다 — 보스와 미니언이 사라졌습니다", "gold");
      }
    });
    if (f >= s.at + s.dur) once("e" + i, () => { if (i === ARK) { pushLog("⛵ 이제 방주만 남았습니다!", "gold"); bigEvent("⛵ 방주만 남았습니다!", "gold");
      for (const p of G.players.values()) if (p.st === "ok" && inZone(p.x, p.y)) p.reachedArk = true; } });
  });
  if (left <= 60) once("j60", () => { pushLog("⚖ 1분 뒤 최후의 심판", "warn"); bigEvent("⚖ 1분 뒤 최후의 심판!", "warn"); });
  // 물에 잠긴 상자·미니언·보스는 사라집니다
  if (G.floodIdx >= 0) {
    G.boxes = G.boxes.filter((b) => b.busy || inZone(b.x, b.y, -10));
    for (const m of G.minions) if (!m.dead && !inZone(m.x, m.y, -20)) { m.dead = true; m.respawnAt = t + 8000; }
    for (const b of G.bosses) if (!b.dead && t >= b.busyUntil && !inZone(b.x, b.y, -20) && b.type !== "leviathan") { b.dead = true; b.respawnAt = t + 20000; }
  }
}

/* ═════════ 루프 ═════════ */
let lastTick = now(), tickSum = 0, tickN = 0;
setInterval(() => {
  const r0 = Date.now(), t0 = now();
  const dt = Math.min(.1 * TIME_SCALE, (t0 - lastTick) / 1000);
  lastTick = t0;
  if (G.phase === "countdown" && t0 >= G.countdownEnd) beginPlay();
  if (G.phase === "playing") step(dt, t0);
  const cost = Date.now() - r0;
  tickSum += cost; tickN++;
  if (cost > G.stats.tickMax) G.stats.tickMax = cost;
  if (tickN >= 20) { G.stats.tickAvg = +(tickSum / tickN).toFixed(2); tickSum = 0; tickN = 0; }
}, TICK);

function speedOf(p, t) {
  let sp = SPEED * (1 + .1 * stk(p, "speed"));
  if (p.cls === "sling") sp *= 1.12;
  if (t < p.speedUntil) sp *= 1.8;
  if (t < p.dodgeUntil) sp *= 1.6;
  if (t < p.immuneUntil) sp *= 1.6;
  return sp;
}
function applyMove(p, x, y, dt, t) {
  const len = Math.hypot(x, y);
  if (len < .12) return;
  let sp = speedOf(p, t);
  if (tileAt(p.x, p.y) === 6) sp *= .55;
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
      if (to && G.floodIdx >= 0 && !inZone(to.x, to.y, 20)) {          // 물에 잠긴 포탈은 작동하지 않음
        p.portalCool = t + 2500; if (p.socketId) io.to(p.socketId).emit("toast", "🌊 반대편 포탈이 물에 잠겼습니다"); break; }
      if (to) { p.x = to.x; p.y = to.y; p.portalCool = t + 2500;
                if (p.socketId) io.to(p.socketId).emit("portal", { x: to.x | 0, y: to.y | 0 }); break; }
    }
  }
}
/* 수풀 안에 있으면 가까이 오기 전엔 안 보입니다 */
const hidden = (p) => tileAt(p.x, p.y) === 5;
/* 은신 = 수풀 잠복 또는 구름 기둥. 은신 중엔 대결이 자동으로 안 붙고, 기습 버튼으로만 걸 수 있습니다 */
const stealth = (p, t) => hidden(p) || t < p.ghostUntil;
/* 레이더: 가장 가까운 '싸울 수 있는' 상대 방향 [dx, dy, 거리] */
function nearestEnemy(p, t) {
  if (p.duel || p.st !== "ok") return null;
  let best = null, bd = 1e9;
  for (const o of G.players.values()) {
    if (o === p || !o.connected || o.duel || !fighting(o) || stealth(o, t) || !enemies(p, o)) continue;
    if ((p.recent.get(o.id) || 0) > t) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return null;
  return [Math.round((best.x - p.x) / bd * 100) / 100, Math.round((best.y - p.y) / bd * 100) / 100, bd | 0];
}
function ambushTarget(p, t) {
  if (!stealth(p, t) || p.duel || p.st !== "ok") return null;
  let best = null, bd = 90;
  for (const o of G.players.values()) {
    if (o === p || !o.connected || o.duel || !fighting(o) || t < o.safeUntil || t < o.immuneUntil || stealth(o, t) || !enemies(p, o)) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
/* 가장 가까운 쓰러진 팀원 (팀전) */
function nearestBleedingMate(p) {
  if (!teamCount() || p.st !== "ok") return null;
  let best = null, bd = 1e9;
  for (const o of G.players.values()) {
    if (o === p || o.team !== p.team || o.st !== "bleed") continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? [Math.round((best.x - p.x) / bd * 100) / 100, Math.round((best.y - p.y) / bd * 100) / 100, bd | 0, Math.max(0, Math.ceil((best.bleedUntil - now()) / 1000))] : null;
}
function stepCards(t) {
  for (const p of G.players.values()) {
    const c = p.pendingCards[0];
    if (!c || !c.until || t < c.until) continue;
    if (p.duel && p.connected) { c.until = t + 4000; continue; }        // 대결 중이면 끝날 때까지 기다림
    applyCard(p, c.opts[0], true);
  }
}
function stepPray(p, t) {
  deliverPrayer(p, t);
  if (!p.prayOn || p.duel || !p.connected || G.stage === "judge" || t < p.prayNext || p.prayPts >= PRAY_NEED) return;
  const tg = G.players.get(p.prayTarget);
  if (!tg || tg.st !== "ok") { p.prayTarget = null; return; }
  startSoloQuiz(p, "pray", null, 15);
}
function stepRevive(p, t) {
  p.moving = false;
  if (p.duel) return;
  if (p.reviveGot >= REVIVE_NEED) {
    if (t >= p.downAt + REVIVE_MIN_MS) { const s = farSpot(220, G.stage !== "grow"); reviveAt(p, s.x, s.y, REVIVE_HP, "quiz"); pushLog(`✨ ${p.name} 부활!`); }
    return;
  }
  if (G.stage !== "grow" && t - p.downAt > 50000) { p.killedBy = p.killedBy || "부활 실패"; eliminate(p, null); checkWin(); return; }
  if (t >= p.reviveNext && p.connected) startSoloQuiz(p, "revive", null, 16);
}

function step(dt, t) {
  if (G.winner) return;
  stepCards(t);
  if (G.stage === "judge") { stepJudge(t); for (const p of G.players.values()) p.moving = false; return; }
  if (t >= G.endsAt) { startJudgment(); return; }
  updateFlood(t); updateBoss(dt, t); updateMinions(dt, t); updateTreasure(t);

  for (const p of G.players.values()) {
    if (!G.participants.has(p.id) || p.st === "out") { stepPray(p, t); continue; }
    if (p.st === "down") { stepRevive(p, t); if (G.winner) return; continue; }
    if (p.st === "bleed") {
      p.moving = false;
      if (t >= p.bleedUntil) { p.killedBy = p.killedBy || "시간 초과"; eliminate(p, null); checkWin(); if (G.winner) return; }
      continue;
    }
    p.moving = !p.duel && (t - (p.lastInput || 0) < 180) && Math.hypot(p.ix, p.iy) > .12;
    // 자연 회복: 성장 단계에만 (수금 특성은 2배, 홍수 중에도 절반은 유지)
    const regen = G.stage === "grow" ? REGEN_RATE * (p.cls === "harp" ? 2 : 1) : p.cls === "harp" ? REGEN_RATE * .5 : 0;
    if (regen && t - p.lastHurt > REGEN_DELAY && p.hp < p.mhp) heal(p, p.mhp * regen * dt);
    // 홍수: 물속에 있으면 체력이 깎입니다 (홍해 가르기·대결 중엔 무사 — 대결 중엔 움직일 수 없으니까)
    if (G.floodIdx >= 0 && t >= p.immuneUntil && !p.duel && !inZone(p.x, p.y)) {
      p.floodAcc = (p.floodAcc || 0) + p.mhp * G.floodPlan[G.floodIdx].dps * dt;
      if (p.floodAcc >= 1) {
        const n = Math.floor(p.floodAcc); p.floodAcc -= n;
        const alive = [...G.players.values()].filter((o) => G.participants.has(o.id) && inGame(o)).length;
        if (alive <= 1 && p.hp - n <= 0) p.hp = 1; else hurt(p, n, null, "flood");   // 마지막 한 명은 물에 지지 않음
        if (G.winner) return;
        if (p.st !== "ok") continue;
      }
    } else p.floodAcc = 0;
    let nearBox = null;
    for (const b of G.boxes) if (Math.abs(p.x - b.x) < 30 && Math.abs(p.y - b.y) < 32) { nearBox = b; break; }
    if (nearBox && !p.duel) {
      const b = nearBox;
      if ((p.boxLock[b.id] || 0) > t) { /* 자물쇠 퀴즈 실패 후 잠금 */ }
      else if (b.tier === 0) {                          // 나무 상자: 2.5초 동안 서 있기
        if (p.chestId !== b.id) { p.chestId = b.id; p.chestT = t; }
        else if (!p.moving && t - p.chestT >= 2500) openBox(p, b);
        else if (p.moving) p.chestT = t;
      } else if (b.tier === 1) {                        // 금테 상자: 자물쇠 퀴즈
        if (!b.busy) startChestDuel(p, b);
      } else {                                          // 전설·황금: 열쇠 필요
        if (p.keys > 0) { p.keys--; openBox(p, b); }
        else if (t > (p.keyToldAt || 0)) { p.keyToldAt = t + 4000; if (p.socketId) io.to(p.socketId).emit("needKey", { tier: b.tier }); }
      }
    } else p.chestId = 0;
    let onCap = null;
    for (const c of MAP.caps) if (Math.hypot(p.x - c.x, p.y - c.y) < c.r) onCap = c;
    if (onCap && !p.duel) {                            // 거점: 머무는 동안 회복 + 8초마다 경험치
      heal(p, p.mhp * CAP_HEAL * dt);
      if (!p.capTick) p.capTick = t;
      else if (t - p.capTick >= CAP_PERIOD) {
        p.capTick = t; p.capPoints++; quest(p, "cap3"); addXp(p, XP.cap, onCap.name);
        if (p.socketId) io.to(p.socketId).emit("capture", { name: onCap.name });
      }
    } else p.capTick = 0;
    if (G.treasure && Math.hypot(p.x - G.treasure.x, p.y - G.treasure.y) < 34 && !p.duel) {
      addXp(p, XP.treasure, "숨겨진 보물"); heal(p, p.mhp);
      pushLog(`💎 ${p.name} 이(가) 숨겨진 보물을 찾았습니다! 체력 모두 회복 + 경험치`, "gold");
      bigEvent(`💎 ${p.name} 보물 발견!`, "gold");
      if (p.socketId) io.to(p.socketId).emit("treasure");
      G.treasure = null; G.nextTreasure = t + TREASURE_EVERY;
    }
  }

  // 팀전: 쓰러진 팀원 곁에 서면 살리기 문제가 나옵니다
  if (teamCount()) for (const b of G.players.values()) {
    if (b.st !== "bleed" || b.revBy) continue;
    for (const r of G.players.values()) {
      if (r === b || r.team !== b.team || !fighting(r) || r.duel || !r.connected || t < (r.revNext || 0)) continue;
      if (Math.hypot(r.x - b.x, r.y - b.y) > TEAMREV_DIST) continue;
      const d = startSoloQuiz(r, "teamrev", { target: b.id }, 12);
      if (d) { b.revBy = r.id; if (b.socketId) io.to(b.socketId).emit("reviving", { by: r.name }); }
      break;
    }
  }

  const grid = new Map(), ready = [];
  for (const p of G.players.values()) {
    if (!p.connected || p.duel || !fighting(p) || t < p.safeUntil || t < p.dodgeUntil || t < p.immuneUntil || stealth(p, t)) continue;
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
          if (o === p || o.duel || o.id < p.id || !enemies(p, o)) continue;
          if (Math.hypot(p.x - o.x, p.y - o.y) > MEET) continue;
          if ((p.recent.get(o.id) || 0) > t) continue;
          startDuel(p, o); break;
        }
      }
    if (p.duel) continue;
    // ② 보스
    const hitBoss = G.bosses.find((b) => !b.dead && t >= b.busyUntil && Math.hypot(p.x - b.x, p.y - b.y) < 44);
    if (hitBoss) { startBossDuel(p, hitBoss); continue; }
    // ③ 미니언 (직전 미니언 대결 후 5초는 통과)
    if (t >= (p.minionCool || 0)) {
      const hitMin = G.minions.find((m) => !m.dead && t >= m.busyUntil && Math.hypot(p.x - m.x, p.y - m.y) < 32);
      if (hitMin) { startMinionDuel(p, hitMin); continue; }
    }
  }
  for (const d of [...G.duels.values()]) {
    if (d.kind === "judge") continue;
    if (t >= d.endsAt || (d.counterUntil && t >= d.counterUntil)) resolveDuel(d);
    if (G.winner) return;
  }
  autoFeature(t);
  if (G.boxes.length < boxTarget() && t >= (G.boxCool || 0)) { spawnBox(); G.boxCool = t + BOX_RESPAWN; }
  // 현상금: 가장 많이 쓰러뜨린 사람(2명 이상)에게 왕관 — 쓰러뜨리면 보상 2배
  let top = null;
  for (const p of G.players.values()) if (fighting(p) && p.kills >= 2 && (!top || p.kills > top.kills || (p.kills === top.kills && p.level > top.level))) top = p;
  if (top && G.leaderId !== top.id) { pushLog(`👑 현상금 — ${top.name} (${top.kills}명 쓰러뜨림)`, "gold"); }
  G.leaderId = top ? top.id : null;
}

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
  else if (type === "manna") heal(p, p.mhp * .4);
  else if (type === "crown") {
    heal(p, p.mhp); p.speedUntil = t + 20000; p.ghostUntil = t + 20000; p.items = ["shield", "double"];
    pushLog(`👑 ${p.name} 전설의 왕관!`, "gold"); bigEvent(`👑 ${p.name} 전설 상자!`, "gold");
  } else { p.items.push(type); if (p.items.length > 2) p.items.shift(); }
  if (p.socketId) io.to(p.socketId).emit("pickup", { type, tier: tier | 0, x: bx | 0, y: by | 0, ...BOX_ITEMS[type], hp: Math.round(p.hp), mhp: p.mhp });
}
function updateZone(t) {                 // 성장 단계 중반에 리워야단이 한 번 나타납니다
  const ratio = (t - G.startedAt) / (G.endsAt - G.startedAt);
  if (ratio > .3 && G.stage === "grow" && !G.leviathanDone) { G.leviathanDone = true; spawnBoss("leviathan"); }
}
function nearestBush(b) {
  let best = null, bd = 1e9;
  for (let y = 1; y < MAP.TH - 1; y++) for (let x = 1; x < MAP.TW - 1; x++) if (MAP.t[y * MAP.TW + x] === 5) {
    const cx = x * TS + TS / 2, cy = y * TS + TS / 2, d = Math.hypot(cx - b.x, cy - b.y);
    if (d < bd && d > 60 && (G.floodIdx < 0 || inZone(cx, cy))) { bd = d; best = { x: cx, y: cy }; }
  }
  return best;
}
/* 사람들이 모인 쪽 가까이, 그러나 아무에게도 너무 붙지 않는 자리 (지각 입장용) */
function joinSpot() {
  const others = [...G.players.values()].filter((x) => x.connected && !x.duel && x.st === "ok");
  if (!others.length) return freeSpot(G.stage !== "grow");
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 24; i++) {
    const c = freeSpot(G.stage !== "grow");
    let near = 1e9, avg = 0;
    for (const o of others) { const d = Math.hypot(o.x - c.x, o.y - c.y); near = Math.min(near, d); avg += d; }
    avg /= others.length;
    if (near < 220) continue;                        // 남의 코앞은 제외
    const sc = -avg + Math.min(near, 600) * .3;      // 평균적으로 가까운 곳을 선호
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best || freeSpot(G.stage !== "grow");
}
function farSpot(minD, inside) {
  let best = null, bd = -1;
  for (let i = 0; i < 20; i++) {
    const c = freeSpot(inside || G.floodIdx >= 0); let m = 1e9;
    for (const q of G.players.values()) if (q.st === "ok") m = Math.min(m, Math.hypot(q.x - c.x, q.y - c.y));
    for (const b of G.bosses) if (!b.dead) m = Math.min(m, Math.hypot(b.x - c.x, b.y - c.y) * .6);
    if (m > bd) { bd = m; best = c; }
    if (m >= minD) break;
  }
  return best || freeSpot(inside);
}
/* ── 미니언: 부딪히면 쉬운 문제, 맞히면 경험치·조금 회복(+열쇠 확률). 틀려도 손해 없음 ── */
const MINIONS = {
  soldier: { name: "블레셋 병사", speed: 38, xp: 15, key: .3,  limit: 12, mode: "patrol" },
  fox:     { name: "광야 여우",   speed: 92, xp: 30, key: .5,  limit: 12, mode: "flee" },
  locust:  { name: "메뚜기 떼",   speed: 55, xp: 10, key: .15, limit: 11, mode: "swarm" },
};
const minionTarget = () => Math.min(40, 12 + Math.round(G.players.size * .45));   // 60명이면 39마리
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
  const arkStage = G.floodIdx >= ARK;
  for (const m of G.minions) {
    if (m.dead) {
      if (t >= m.respawnAt && !arkStage) { const s = farSpot(200); Object.assign(m, { x: s.x, y: s.y, tx: s.x, ty: s.y, dead: false, busyUntil: 0 }); }
      continue;
    }
    if (t < m.busyUntil) continue;
    const M = MINIONS[m.type];
    let sp = M.speed;
    let near = null, nd = 1e9;
    for (const p of G.players.values()) { if (!p.connected || p.duel || p.st !== "ok") continue; const d = Math.hypot(p.x - m.x, p.y - m.y); if (d < nd) { nd = d; near = p; } }
    if (M.mode === "flee" && near && nd < 220) { m.tx = m.x + (m.x - near.x) / nd * 200; m.ty = m.y + (m.y - near.y) / nd * 200; sp *= 1.15; }
    // 병사·메뚜기는 가까운 사람에게 천천히 다가옵니다 (넓은 맵에서 만날 수 있게)
    else if (M.mode !== "flee" && near && nd < (M.mode === "patrol" ? 340 : 240)) { m.tx = near.x; m.ty = near.y; }
    else if (Math.hypot(m.tx - m.x, m.ty - m.y) < 12 || t > (m.retarget || 0)) {
      m.retarget = t + 2500 + Math.random() * 3000;
      const rr = M.mode === "swarm" ? 90 : 220;
      m.tx = clamp(m.x + (Math.random() - .5) * rr * 2, R, MAP.W - R); m.ty = clamp(m.y + (Math.random() - .5) * rr * 2, R, MAP.H - R);
    }
    if (G.floodIdx >= 0 && !inZone(m.tx, m.ty, 20)) { m.tx = G.zone.x; m.ty = G.zone.y; }   // 물 쪽으로는 안 감
    const dd = Math.hypot(m.tx - m.x, m.ty - m.y) || 1, ux = (m.tx - m.x) / dd, uy = (m.ty - m.y) / dd;
    const nx = clamp(m.x + ux * sp * dt, R, MAP.W - R); if (!blocked(nx, m.y)) m.x = nx; else m.tx = m.x - ux * 100;
    const ny = clamp(m.y + uy * sp * dt, R, MAP.H - R); if (!blocked(m.x, ny)) m.y = ny; else m.ty = m.y - uy * 100;
    m.face = ux < 0 ? -1 : 1; m.walk += sp * dt;
  }
}
function spawnBoss(type) {
  const s = farSpot(350);
  const b = { id: G.nextBossId++, type, x: s.x, y: s.y, dead: false, face: 1, walk: 0, busyUntil: 0 };
  G.bosses.push(b);
  pushLog(`⚔ ${BOSSES[type].name} 등장!`, "hot"); if (type === "leviathan") bigEvent(`🌊 ${BOSSES[type].name} 등장!`, "hot");
  return b;
}
function updateBoss(dt, t) {
  updateZone(t);
  const arkStage = G.floodIdx >= ARK;
  for (const b of G.bosses) {
    if (b.dead) {
      if (t >= b.respawnAt && !arkStage) {
        // 죽은 보스는 다른 종류로 바뀌어 다시 나타납니다 (리워야단은 한 번만)
        let nextType = BOSS_ROTATION[Math.random() * BOSS_ROTATION.length | 0];
        if (nextType === b.type) nextType = BOSS_ROTATION[(BOSS_ROTATION.indexOf(nextType) + 1) % BOSS_ROTATION.length];
        const s = farSpot(350);                         // 사람들에게서 먼 임의의 장소에 다시 등장
        Object.assign(b, { type: nextType, x: s.x, y: s.y, dead: false, walk: 0, busyUntil: 0, tpNext: 0 });
        if (nextType === "amalek") spawnBoss("amalek");
        pushLog(`⚔ ${BOSSES[nextType].name} 등장!`, "hot");
      }
      continue;
    }
    if (t < b.busyUntil) continue;                       // 싸우는 중엔 제자리
    const B = BOSSES[b.type];
    let sp = B.speed, tx = null, ty = null, target = null, bd = 1e9;
    for (const p of G.players.values()) {
      if (p.duel || !p.connected || p.st !== "ok" || t < p.ghostUntil || t < p.safeUntil || t < p.immuneUntil) continue;
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
        const ps = [...G.players.values()].filter((p) => p.connected && !p.duel && p.st === "ok" && t >= p.safeUntil && t >= p.immuneUntil);
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
  if (G.treasure || t < G.nextTreasure || G.stage !== "grow") { if (G.treasure && G.stage !== "grow") G.treasure = null; return; }
  const s = freeSpot();
  const dir = (s.y < MAP.H / 2 ? "북" : "남") + (s.x < MAP.W / 2 ? "서" : "동");
  G.treasure = { x: s.x, y: s.y, hint: `${dir}쪽 어딘가` };
  pushLog(`💎 숨겨진 보물이 ${dir}쪽에 나타났습니다 (체력 모두 회복 + 경험치)`, "gold");
  bigEvent(`💎 보물 출현 — ${dir}쪽`, "gold");
}
/* 관전 화면이 자동으로 크게 보여 줄 대결 고르기 — 쓰러질 것 같은 대결·현상금·보스·막판을 우선 */
function autoFeature(t) {
  if (t < G.featuredManual) return;
  if (G.featured && G.duels.has(G.featured)) return;
  let best = null, bs = -1;
  const aliveN = [...G.players.values()].filter((p) => G.participants.has(p.id) && inGame(p)).length;
  for (const d of G.duels.values()) {
    if (d.kind !== "pvp" && d.kind !== "boss") continue;
    const a = G.players.get(d.a), b = d.kind === "boss" ? null : G.players.get(d.b);
    if (!a) continue;
    let s = 1;
    if (d.kind === "boss") s += d.boss === "leviathan" ? 20 : 8;
    if (a.hp / a.mhp < .4 || (b && b.hp / b.mhp < .4)) s += 6;
    if (G.leaderId === a.id || (b && G.leaderId === b.id)) s += 5;
    if (d.sling[a.id] || (b && d.sling[b.id])) s += 7;
    if (G.stage !== "grow") s += aliveN <= 10 ? 8 : 3;
    if (s > bs) { bs = s; best = d.id; }
  }
  G.featured = best;
}

/* ═════════ 목록·전송 ═════════ */
let rosterSeq = 0;
const numOf = new Map(), idOfNum = new Map();
let nextNum = 1;
const stRank = (p) => (inGame(p) ? 0 : p.st === "out" ? 1 : 2);
/* 순위: 살아 있는 사람(쓰러뜨린 수·레벨·체력 순) → 탈락한 사람(늦게 떨어진 순) → 관전자 */
function boardList() {
  return [...G.players.values()]
    .map((p) => ({ id: p.id, u: numOf.get(p.id), name: p.name, look: p.look, team: p.team, connected: p.connected,
                   level: p.level || 1, tierIdx: tierIdx(p.level), kills: p.kills || 0, hits: p.hits || 0, hp: Math.round(p.hp), mhp: p.mhp,
                   st: p.st, place: p.place || 0, prevRank: p.prevRank, streak: p.streak, atk: p.atk,
                   spec: !G.participants.has(p.id) && G.phase !== "lobby" }))
    .sort((a, b) => {
      const ra = a.spec ? 2 : stRank(a), rb = b.spec ? 2 : stRank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (b.kills - a.kills) || (b.level - a.level) || (b.hp / b.mhp - a.hp / a.mhp) || a.name.localeCompare(b.name, "ko");
      if (ra === 1) return a.place - b.place;
      return a.name.localeCompare(b.name, "ko");
    });
}
const aliveCount = () => [...G.players.values()].filter((p) => G.participants.has(p.id) && inGame(p)).length;
const leftSec = () => G.phase === "playing" ? Math.max(0, Math.ceil((G.endsAt - now()) / 1000))
                    : G.phase === "paused" ? Math.ceil(G.pausedLeft / 1000) : 0;
const rosterPayload = () => [...G.players.values()].map((p) => ({
  u: numOf.get(p.id), i: p.id, n: p.name, l: p.look, c: p.cls, tm: p.team }));
function bumpRoster() {
  for (const p of G.players.values()) if (!numOf.has(p.id)) { numOf.set(p.id, nextNum); idOfNum.set(nextNum, p.id); nextNum++; }
  rosterSeq++;
  io.emit("roster", { seq: rosterSeq, list: rosterPayload(), mode: G.mode, teams: TEAMS.slice(0, teamCount()) });
}
const flagsOf = (p, t) => (p.duel ? 1 : 0) | (t < p.ghostUntil ? 2 : 0) | (t < p.speedUntil ? 4 : 0) |
  (p.streak >= 3 ? 8 : 0) | (p.moving ? 16 : 0) | (p.connected ? 0 : 64) |
  (t < p.dodgeUntil ? 128 : 0) | (hidden(p) ? 256 : 0) | (G.leaderId === p.id ? 512 : 0) |
  (p.st === "down" ? 1024 : 0) | (p.st === "bleed" ? 2048 : 0) | (t < (p.glowUntil || 0) ? 4096 : 0) |
  (t < p.immuneUntil ? 8192 : 0) | (p.ultArm && t < p.ultArmUntil ? 16384 : 0) | (p.prayShield > 0 ? 32768 : 0) |
  (t < p.ultShieldUntil ? 65536 : 0);
/* 지도에 보이는 사람: 탈락·관전 제외, 성장 단계에서 쓰러진 사람은 쓰러진 직후 잠깐만 */
const onMap = (p, t) => G.participants.has(p.id) && (p.st === "ok" || p.st === "bleed" || (p.st === "down" && t - p.downAt < 1800));
/* 진행 중에는 '냈다/안 냈다'만 알려 줍니다 — 정답이 새어 나가지 않도록 */
function sideOf(d, pid) {
  const p = G.players.get(pid);
  if (!p) return null;
  return { name: p.name, look: { ...p.look, tier: tierIdx(p.level) }, team: p.team, done: !!d.picks[pid],
           hp: Math.round(p.hp), mhp: p.mhp, level: p.level || 1 };
}
function zonePacket() {
  if (G.floodIdx < 0 && !G.zoneNext) return null;
  const z = G.zone, n = G.zoneNext;
  const nextAt = n ? G.startedAt + n.at * (G.endsAt - G.startedAt) : 0;
  return [z.x | 0, z.y | 0, Math.min(99999, z.r | 0), n ? n.x | 0 : 0, n ? n.y | 0 : 0, n ? n.r | 0 : 0, G.floodIdx, G.zoneShrinking ? 1 : 0,
          n && !G.zoneShrinking ? Math.max(0, Math.ceil((nextAt - now()) / 1000)) : 0];
}
function judgePacket() {
  const J = G.judge; if (!J || !J.q) return G.stage === "judge" ? { round: 0 } : null;
  const t = now();
  const rows = J.results ? J.results.rows : J.ids.map((id) => { const p = G.players.get(id); const d = p && p.duel && G.duels.get(p.duel);
    return p ? { u: numOf.get(id), name: p.name, done: !!(d && d.picks[id]), team: p.team } : null; }).filter(Boolean);
  return { round: J.round, q: J.q.text, options: J.q.options, left: J.results ? 0 : Math.max(0, Math.ceil((J.endsAt - t) / 1000)),
           answer: J.results ? J.q.answer : -1, ref: J.results ? J.q.ref : "", rows, done: !!J.results };
}

setInterval(() => {
  const t = now();
  const p = [];
  for (const o of G.players.values()) {
    if (!onMap(o, t)) continue;
    p.push([numOf.get(o.id), o.x | 0, o.y | 0, flagsOf(o, t), hpPct(o), (o.walk | 0) % 64, o.face, o.team, tierIdx(o.level),
            t < (o.emoteUntil || 0) ? o.emote : 0, o.level || 1, o.kills || 0, o.st === "bleed" ? Math.max(0, Math.ceil((o.bleedUntil - t) / 1000)) : 0, Math.round(o.hp)]);
  }
  const d = [];
  for (const u of G.duels.values()) {
    if (u.kind !== "pvp" && u.kind !== "boss") continue;
    const a = G.players.get(u.a), b = u.kind === "boss" ? null : G.players.get(u.b);
    if (!a || (u.kind !== "boss" && !b)) continue;
    const bz = u.boss ? G.bosses.find((x) => x.id === u.bossId) : null;
    const bx = u.boss ? (bz ? bz.x | 0 : a.x | 0) : b.x | 0;
    const by = u.boss ? (bz ? bz.y | 0 : a.y | 0) : b.y | 0;
    d.push([a.x | 0, a.y | 0, bx, by, numOf.get(a.id), u.boss ? 0 : numOf.get(b.id),
            Math.max(0, Math.ceil((u.endsAt - t) / 1000)), u.id, u.boss || 0]);
  }
  const fd = G.duels.get(G.featured);
  io.to("host").volatile.emit("world", {
    ph: G.phase, t: leftSec(), seq: rosterSeq, mapSeq: MAP.seq, stg: G.stage, al: aliveCount(), tot: G.participants.size,
    cd: G.phase === "countdown" ? Math.max(0, Math.ceil((G.countdownEnd - t) / 1000)) : 0,
    p, d, zn: zonePacket(), j: G.stage === "judge" ? judgePacket() : null, win: G.winner,
    bosses: G.bosses.filter((b) => !b.dead).map((b) => [b.x | 0, b.y | 0, (b.walk | 0) % 64, b.face, b.type, b.id, tileAt(b.x, b.y) === 5 ? 1 : 0, t < (b.dashUntil || 0) ? 1 : 0]),
    mn: G.minions.filter((m) => !m.dead).map((m) => [m.id, m.x | 0, m.y | 0, m.type, (m.walk | 0) % 64, m.face]),
    tr: G.treasure ? [G.treasure.x | 0, G.treasure.y | 0] : null,
    feat: fd ? { id: fd.id, boss: fd.boss || null, q: fd.q.text, options: fd.q.options,
                 left: Math.max(0, Math.ceil((fd.endsAt - t) / 1000)),
                 a: sideOf(fd, fd.a), b: fd.kind === "boss" ? { name: BOSSES[fd.boss].name, boss: true } : sideOf(fd, fd.b) } : null,
    reveal: (G.reveal && t < G.reveal.until) ? G.reveal : null,
  });
}, SEND_HOST);

setInterval(() => {
  io.to("host").emit("meta", {
    board: boardList(), log: G.log.slice(0, 8), mode: G.mode, teams: teamStatus(),
    boxes: G.boxes.map((b) => [b.x | 0, b.y | 0, b.tier, b.id]),
    opened: G.opened.splice(0, G.opened.length).map((o) => [o[0], o[1], o[2]]),
    caps: MAP.caps.map((c) => [c.x | 0, c.y | 0, c.r, c.name]),
    portals: MAP.portals.map(([a, b]) => [a.x | 0, a.y | 0, b.x | 0, b.y | 0]),
    treasureHint: G.treasure ? G.treasure.hint : null,
    qUsed: G.usedQ.size, qTotal: G.questions.length, qfile: G.qfile, qfiles: questionFiles(),
    stage: G.stage, floodIdx: G.floodIdx, floods: FLOOD.length, zones: ZONES, tiers: TIERS,
    events: G.events.splice(0, G.events.length), fx: G.fx.splice(0, G.fx.length),
    stats: { tick: G.stats.tickAvg, tickMax: G.stats.tickMax, players: G.players.size, duels: G.duels.size },
  });
  G.stats.tickMax = 0;
}, SEND_META);

/* 탈락·관전 중인 사람이 폰으로 볼 대상: 기도하는 사람 → 현상금 → 가장 가까운 생존자 */
function specTarget(p) {
  let o = G.players.get(p.prayTarget);
  if (o && o.st === "ok") return o;
  o = G.players.get(p.specId);
  if (o && o.st === "ok") return o;
  let best = G.players.get(G.leaderId), bd = 1e9;
  if (!best || best.st !== "ok") {
    best = null;
    for (const q of G.players.values()) {
      if (q === p || q.st !== "ok" || !G.participants.has(q.id)) continue;
      if (teamCount() && q.team !== p.team && [...G.players.values()].some((m) => m.team === p.team && m.st === "ok" && m !== p)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
  }
  if (best) p.specId = best.id;
  return best;
}
const VIEW = 340, NEAR_MAX = 14;
setInterval(() => {
  const t = now();
  const all = [...G.players.values()];
  const zp = zonePacket(), al = aliveCount(), tot = G.participants.size;
  for (const p of all) {
    if (!p.socketId || !p.connected) continue;
    const watching = (p.st === "out" || p.st === "spec" || (G.phase !== "lobby" && !G.participants.has(p.id))) ? specTarget(p) : null;
    const cx = watching ? watching.x : p.x, cy = watching ? watching.y : p.y;
    const n = [];
    for (const o of all) {
      if (o === p || t < o.ghostUntil || !onMap(o, t)) continue;
      if (Math.abs(o.x - cx) > VIEW || Math.abs(o.y - cy) > VIEW) continue;
      if (hidden(o) && Math.hypot(o.x - cx, o.y - cy) > 95 && o !== watching) continue;   // 수풀 잠복
      n.push([numOf.get(o.id), o.x | 0, o.y | 0, flagsOf(o, t), (o.walk | 0) % 64, o.face, o.team, tierIdx(o.level),
              t < (o.emoteUntil || 0) ? o.emote : 0, o.level || 1, hpPct(o), (o.x - cx) ** 2 + (o.y - cy) ** 2]);
    }
    if (n.length > NEAR_MAX) { n.sort((a, b) => a[11] - b[11]); n.length = NEAR_MAX; }
    for (const e of n) e.pop();
    const mn = [];
    for (const m of G.minions) if (!m.dead && Math.abs(m.x - cx) < VIEW && Math.abs(m.y - cy) < VIEW) mn.push([m.id, m.x | 0, m.y | 0, m.type, (m.walk | 0) % 64, m.face]);
    const bn = G.bosses.filter((b) => !b.dead && Math.abs(b.x - cx) < VIEW && Math.abs(b.y - cy) < VIEW
        && !(tileAt(b.x, b.y) === 5 && Math.hypot(b.x - cx, b.y - cy) > 110))       // 수풀 속 사자는 가까이 와야 보임
      .map((b) => [b.x | 0, b.y | 0, (b.walk | 0) % 64, b.face, b.type, b.id, 0, t < (b.dashUntil || 0) ? 1 : 0]);
    const trn = G.treasure && Math.abs(G.treasure.x - cx) < VIEW && Math.abs(G.treasure.y - cy) < VIEW
      ? [G.treasure.x | 0, G.treasure.y | 0] : null;
    io.to(p.socketId).volatile.emit("me", {
      ph: G.phase, t: leftSec(), x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10,
      ack: p.lastSeq | 0, e: p.face, w: (p.walk | 0) % 64, tr2: tierIdx(p.level), em: t < (p.emoteUntil || 0) ? p.emote : 0,
      f: flagsOf(p, t) | (t < p.safeUntil ? 32 : 0),
      cd: G.phase === "countdown" ? Math.max(0, Math.ceil((G.countdownEnd - t) / 1000)) : 0,
      n, bosses: bn, mn, tr: trn, seq: rosterSeq, mapSeq: MAP.seq,
      amb: ambushTarget(p, t) ? 1 : 0,
      en: nearestEnemy(p, t), bm: nearestBleedingMate(p),
      lv: p.level || 1, zn: zoneOf(cx, cy),
      ch: p.chestId ? Math.min(1, (t - p.chestT) / 2500) : 0,
      dodge: Math.max(0, Math.ceil((p.dodgeReady - t) / 1000)),
      st: G.participants.has(p.id) || G.phase === "lobby" ? p.st : "spec",
      hp: Math.round(p.hp), mhp: p.mhp, atk: p.atk, sp: Math.round(speedOf(p, t)),
      ult: G.phase === "playing" ? Math.max(0, Math.ceil((p.ultReady - t) / 1000)) : -1,
      ua: p.ultArm && t < p.ultArmUntil ? p.ultArm : "", ul: p.lampLeft || 0,
      im: Math.max(0, Math.ceil((p.immuneUntil - t) / 1000)), ps: p.prayShield || 0, sh: t < p.ultShieldUntil ? 1 : 0,
      z: zp, stg: G.stage, al, tot,
      w8: watching ? numOf.get(watching.id) : 0,
      bl: p.st === "bleed" ? Math.max(0, Math.ceil((p.bleedUntil - t) / 1000)) : 0,
    });
  }
}, SEND_PHONE);

setInterval(() => {
  const board = boardList();
  const aliveRank = new Map(board.filter((x) => !x.spec && inGame(x)).map((p, i) => [p.id, i + 1]));
  const top = board.filter((x) => !x.spec).slice(0, 5).map((p) => ({ n: p.name, k: p.kills, l: p.look, t: p.team, st: p.st, pl: p.place, lv: p.level }));
  const ts = teamStatus(), t = now(), al = aliveCount();
  const survivors = board.filter((x) => x.st === "ok" && !x.spec).map((x) => ({ u: x.u, n: x.name, hp: Math.round(x.hp / x.mhp * 100), tm: x.team, lv: x.level, l: x.look }));
  for (const p of G.players.values()) {
    if (!p.socketId || !p.connected) continue;
    const boxes = [];
    for (const b of G.boxes)
      if (Math.abs(b.x - p.x) < VIEW && Math.abs(b.y - p.y) < VIEW) boxes.push([b.x | 0, b.y | 0, b.tier, b.id]);
    const caps = MAP.caps.filter((c) => Math.abs(c.x - p.x) < VIEW + 90 && Math.abs(c.y - p.y) < VIEW + 90)
      .map((c) => [c.x | 0, c.y | 0, c.r, c.name]);
    const U = ULTS[p.cls] || ULTS.sling, pc = p.pendingCards[0];
    const out = p.st === "out" || (G.phase !== "lobby" && !G.participants.has(p.id));
    io.to(p.socketId).emit("meta", {
      hp: Math.round(p.hp), mhp: p.mhp, atk: p.atk, def: Math.round((1 - defMul(p)) * 100), perk: p.perk,
      kills: p.kills, hits: p.hits, answered: p.answered, correct: p.correct, streak: p.streak, guard: p.guard,
      items: p.items.map((k) => ({ key: k, ...BOX_ITEMS[k] })),
      rank: aliveRank.get(p.id) || 0, place: p.place || 0, alive: al, total: G.participants.size || G.players.size,
      top, boxes, caps, team: p.team, mode: G.mode, teams: ts, region: regionOf(p.y, p.x), stage: G.stage, floodIdx: G.floodIdx,
      tier: TIERS[tierIdx(p.level)],
      buffs: { speed: Math.max(0, Math.ceil((p.speedUntil - t) / 1000)), ghost: Math.max(0, Math.ceil((p.ghostUntil - t) / 1000)) },
      xp: p.xp || 0, level: p.level || 1, xpNext: XP_TABLE[Math.min(XP_TABLE.length - 1, p.level || 1)] || XP_TABLE[9], xpBase: XP_TABLE[(p.level || 1) - 1],
      keys: p.keys || 0, minionKills: p.minionKills || 0,
      boost: Math.max(0, Math.ceil(((p.catchUpUntil || 0) - t) / 1000)),
      quests: QUESTS.map((q) => ({ id: q.id, name: q.name, desc: q.desc, need: q.need, have: Math.min(q.need, p.q[q.id] || 0), done: !!p.qDone[q.id] })),
      ult: { cls: p.cls, name: U.name, icon: U.icon, desc: U.desc, cd: Math.round(ultCdFor(p) / 1000) },
      cards: pc && pc.until ? { level: pc.level, opts: pc.opts.map((id) => CARD[id]), left: Math.max(0, Math.ceil((pc.until - t) / 1000)), more: p.pendingCards.length - 1 } : null,
      survivors: out ? survivors.filter((s) => !teamCount() || s.tm === p.team || !survivors.some((x) => x.tm === p.team)) : null,
      pray: out ? { target: p.prayTarget ? numOf.get(p.prayTarget) : 0, pts: p.prayPts, need: PRAY_NEED, on: p.prayOn, given: p.prayers } : null,
      down: p.st === "down" ? { got: p.reviveGot, need: REVIVE_NEED } : null,
    });
  }
}, SEND_META);

/* ═════════ 게임 제어 ═════════ */
function startGame(min) {
  MAP = buildMap(...mapSizeFor(Math.max(2, G.players.size)));
  G.zone = { x: MAP.W / 2, y: MAP.H / 2, r: 1e9 };
  io.emit("mapChanged");
  if (teamCount()) {                                  // 대기실에서 나눈 팀을 그대로 쓰고, 어긋났을 때만 다시 나눔
    const n = teamCount(), cnt = new Array(n).fill(0); let bad = false;
    for (const p of G.players.values()) { if (p.team >= 0 && p.team < n) cnt[p.team]++; else bad = true; }
    if (bad || Math.max(...cnt) - Math.min(...cnt) > 1) assignTeams();
  }
  G.minutes = Math.max(3, Math.min(30, min || 10));
  G.phase = "countdown"; G.countdownEnd = now() + 3600;
  Object.assign(G, { stage: "grow", floodIdx: -1, floodPlan: [], zoneNext: null, zoneShrinking: false, told: {}, judge: null,
    winner: null, winAt: 0, teamPlace: {}, leaderId: null, boxCool: 0, boxes: [], opened: [], log: [], events: [], fx: [],
    reveal: null, featured: null, featuredManual: 0 });
  G.duels.clear(); G.usedQ.clear();
  G.participants = new Set(G.players.keys());
  G.teamsAtStart = teamCount() ? new Set([...G.players.values()].map((p) => p.team)).size : 0;
  for (const p of G.players.values()) {
    freshStats(p);
    const s = freeSpot(); p.x = s.x; p.y = s.y;
    p.safeUntil = now() + 5000;
  }
  refillBoxes();
  bigEvent("곧 시작합니다!", "hot");
}
function beginPlay() {
  G.phase = "playing";
  G.startedAt = now();
  G.endsAt = G.startedAt + G.minutes * 60000;
  G.floodPlan = planFlood();
  G.bosses = []; G.leviathanDone = false; G.minions = []; fillMinions();
  // 최소 3마리, 8명마다 한 마리씩 추가 (60명이면 9마리). 종류는 골고루
  const want = 3 + Math.floor(G.players.size / 8);
  const order = ["goliath", "lion", "pharaoh", "serpent", "herod", "nebuchad", "amalek", "goliath", "lion", "pharaoh", "serpent"];
  let count = 0;
  for (let i = 0; count < want; i++) { const tp = order[i % order.length]; spawnBoss(tp); count++; if (tp === "amalek" && count < want) { spawnBoss("amalek"); count++; } }
  G.treasure = null; G.nextTreasure = now() + TREASURE_FIRST;
  for (const p of G.players.values()) {
    p.ultReady = G.startedAt + ULT_FIRST;
    if (p.practiceXp) { addXp(p, p.practiceXp, "연습 퀴즈 출발 보너스"); p.practiceXp = 0; p.practiceCorrect = 0; }
  }
  pushLog("게임 시작! 마주치면 성경 대결 — 맞히면 상대 체력이 깎입니다", "hot");
  bigEvent("🌱 성장 단계 — 쓰러져도 문제를 맞히면 부활!", "gold");
}
/* 최종 순위: 살아남은 사람(우승자 먼저, 체력 비율 순) → 탈락 순서의 역순 */
function finalRanking() {
  const list = [...G.players.values()].filter((p) => G.participants.has(p.id));
  const wid = G.winner && G.winner.id, wt = G.winner && G.winner.team;
  const alive = list.filter(inGame).sort((a, b) =>
    ((b.id === wid) - (a.id === wid)) || ((wt != null ? (b.team === wt) - (a.team === wt) : 0)) ||
    (b.hp / b.mhp - a.hp / a.mhp) || (b.kills - a.kills));
  alive.forEach((p, i) => { p.place = i + 1; });
  if (wid) { const w = G.players.get(wid); if (w && !inGame(w)) { w.place = 1; list.filter((p) => !inGame(p) && p !== w).forEach((p) => { if (p.place <= 1) p.place = 2; }); } }
  const out = list.filter((p) => !inGame(p)).sort((a, b) => a.place - b.place || b.elimAt - a.elimAt);
  return [...alive, ...out.filter((p) => !alive.includes(p))];
}
function mvpAwards() {
  const list = [...G.players.values()].filter((p) => G.participants.has(p.id));
  if (!list.length) return [];
  const pick = (label, unit, fn) => {
    const top = list.slice().sort((a, b) => fn(b) - fn(a))[0];
    const v = fn(top);
    return v > 0 ? { label, name: top.name, look: top.look, value: v + unit } : null;
  };
  return [
    pick("최다 처치", "명", (p) => p.kills),
    pick("최다 명중", "번", (p) => p.hits),
    pick("가장 큰 피해", "", (p) => Math.round(p.dmgDealt)),
    pick("부활 도우미", "번", (p) => p.teamRevives),
    pick("기도의 용사", "번", (p) => p.prayers),
    pick("궁극기 달인", "번", (p) => p.ultCount),
    pick("보스 사냥꾼", "마리", (p) => p.bossKills),
    pick("미니언 사냥꾼", "마리", (p) => p.minionKills),
    pick("상자 수집왕", "개", (p) => p.boxCount),
    pick("최고 레벨", "레벨", (p) => p.level || 1),
    pick("가장 많이 걸은 사람", "걸음", (p) => Math.round(p.distance / 40)),
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
function saveSeason(ranked) {
  const s = loadSeason();
  s.games = (s.games || 0) + 1;
  s.players = s.players || {};
  const tw = G.winner && G.winner.team;
  for (const p of ranked) {
    const e = s.players[p.name] || {};
    e.games = (e.games || 0) + 1; e.kills = (e.kills || 0) + (p.kills || 0);
    const won = teamCount() ? (tw != null && p.team === tw) : p.place === 1;
    if (won) e.wins = (e.wins || 0) + 1;
    if (p.place <= 3) e.top3 = (e.top3 || 0) + 1;
    e.bestPlace = e.bestPlace ? Math.min(e.bestPlace, p.place || 99) : (p.place || 99);
    s.players[p.name] = e;
  }
  try { fs.writeFileSync(SEASON_FILE, JSON.stringify(s, null, 1)); } catch {}
}
const TITLE_RULES = [
  { id: "champ",  name: "최후의 1인",       icon: "🏆", test: (p, r) => r === 1 && !teamCount() },
  { id: "tchamp", name: "우승 팀",          icon: "🏆", test: (p, r, tw) => tw },
  { id: "top3",   name: "생존 TOP 3",       icon: "🥉", test: (p, r) => r > 0 && r <= 3 },
  { id: "ark",    name: "방주에 오른 자",   icon: "⛵", test: (p) => p.reachedArk },
  { id: "first",  name: "첫 승리",          icon: "🌱", test: (p) => p.kills >= 1 },
  { id: "flame",  name: "불꽃",             icon: "🔥", test: (p) => p.kills >= 3 },
  { id: "david",  name: "골리앗을 넘어뜨린 자", icon: "🎯", test: (p) => p.bigKills >= 1 },
  { id: "sharp",  name: "명사수",           icon: "🏹", test: (p) => p.hits >= 10 },
  { id: "giant",  name: "거인 사냥꾼",      icon: "🗡", test: (p) => p.bossKills >= 1 },
  { id: "slayer", name: "보스 학살자",      icon: "☠", test: (p) => p.bossKills >= 3 },
  { id: "shadow", name: "그림자",           icon: "🌑", test: (p) => p.ambushHits >= 1 },
  { id: "phoenix",name: "다시 일어선 자",   icon: "✨", test: (p) => p.revives >= 2 },
  { id: "medic",  name: "생명의 손",        icon: "🤝", test: (p) => p.teamRevives >= 1 },
  { id: "prayer", name: "기도의 용사",      icon: "🙏", test: (p) => p.prayers >= 2 },
  { id: "hunter", name: "보물 사냥꾼",      icon: "💎", test: (p) => p.boxCount >= 5 },
  { id: "guard",  name: "성전 지킴이",      icon: "⛪", test: (p) => p.capPoints >= 3 },
  { id: "walker", name: "광야의 나그네",    icon: "🥾", test: (p) => p.distance >= 6000 },
  { id: "quest",  name: "완주자",           icon: "🏁", test: (p) => Object.keys(p.qDone).length >= 4 },
  { id: "lv5",    name: "숙련자",           icon: "⬆", test: (p) => (p.level || 1) >= 5 },
  { id: "lv10",   name: "달인",             icon: "🌟", test: (p) => (p.level || 1) >= 10 },
  { id: "minion", name: "광야의 사냥꾼",    icon: "🦊", test: (p) => p.minionKills >= 8 },
];
function titlesOf(p, rank, tw) { return TITLE_RULES.filter((r) => r.test(p, rank, tw)).map((r) => ({ id: r.id, name: r.name, icon: r.icon })); }
function endGame() {
  if (G.phase === "ended" || G.phase === "lobby") return;
  if (pauseStart) { pauseTotal += rawNow() - pauseStart; pauseStart = 0; }
  G.phase = "ended";
  for (const d of [...G.duels.values()]) closeDuel(d);
  const ranked = finalRanking();
  const tw = teamCount() && G.winner ? G.winner.team : null;
  const board = ranked.map((p) => ({ id: p.id, u: numOf.get(p.id), name: p.name, look: p.look, team: p.team, place: p.place,
    kills: p.kills, hits: p.hits, level: p.level || 1, tierIdx: tierIdx(p.level), alive: inGame(p), dmg: Math.round(p.dmgDealt) }));
  const awards = mvpAwards(), wrongs = wrongTop(), teams = teamStatus();
  saveResults(ranked, wrongs); saveSeason(ranked);
  const top = board[0];
  if (!G.winner && top) pushLog(`🏆 1위 ${top.name}`, "gold");
  io.to("host").emit("gameEnd", { board, awards, wrongs, teams, mode: G.mode, winner: G.winner, teamWinner: tw });
  for (const p of G.players.values()) {
    if (!p.socketId) continue;
    const part = G.participants.has(p.id), rank = part ? p.place : 0;
    io.to(p.socketId).emit("gameEnd", {
      board: board.slice(0, 5), rank, total: G.participants.size, titles: part ? titlesOf(p, rank, tw != null && p.team === tw) : [],
      level: p.level || 1, xp: p.xp || 0, kills: p.kills, hits: p.hits, answered: p.answered, correct: p.correct,
      dmg: Math.round(p.dmgDealt), revives: p.revives, prayers: p.prayers, alive: inGame(p) && part,
      wrong: p.wrong, cards: p.cards, teams, mode: G.mode, team: p.team, winner: G.winner, teamWinner: tw, spec: !part });
  }
}
function saveResults(ranked, wrongs) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  const file = path.join(__dirname, `배틀결과_${stamp}.csv`);
  let csv = "﻿순위,이름,팀,처치,명중,정답률,준 피해,받은 피해,레벨,쓰러짐,부활,팀원 살림,중보기도\n";
  ranked.forEach((p) => {
    const acc = p.answered ? Math.round(p.correct / p.answered * 100) + "%" : "-";
    csv += `${p.place},${p.name},${teamCount() ? TEAMS[p.team].name : ""},${p.kills},${p.hits},${acc},${Math.round(p.dmgDealt)},${Math.round(p.dmgTaken)},${p.level || 1},${p.deaths},${p.revives},${p.teamRevives},${p.prayers}\n`;
  });
  csv += "\n[많이 틀린 문제]\n순위,틀린 횟수,문제,정답,구절\n";
  wrongs.forEach((w, i) => {
    csv += `${i + 1},${w.n},"${String(w.q).replace(/"/g, "'")}","${w.options[w.answer]}",${w.ref}\n`;
  });
  try { fs.writeFileSync(file, csv); console.log("  결과 저장:", file); } catch {}
}
function resetToLobby() {
  if (pauseStart) { pauseTotal += rawNow() - pauseStart; pauseStart = 0; }
  G.phase = "lobby"; G.duels.clear(); G.log = []; G.events = []; G.fx = []; G.usedQ.clear();
  Object.assign(G, { boxes: [], opened: [], bosses: [], minions: [], treasure: null, featured: null, leaderId: null,
    stage: "grow", floodIdx: -1, floodPlan: [], zone: { x: 0, y: 0, r: 1e9 }, zoneNext: null, judge: null, winner: null, told: {}, teamPlace: {} });
  G.participants = new Set();
  for (const p of G.players.values()) { freshStats(p); p.seen.clear(); }
  io.emit("resetToLobby");
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
  r.json({ url, qr, lan: JOIN_URL, zones: ZONES, cards: CARDS, ults: ULTS, xpTable: XP_TABLE, items: BOX_ITEMS, teams: TEAMS, qproblems: G.qproblems, emotes: EMOTES, tiers: TIERS,
    rules: { hp: HP0, atk: ATK0, cap: HIT_CAP, counter: COUNTER_MS / 1000, revive: REVIVE_NEED, bleed: BLEED_MS / 1000, teamrev: TEAMREV_MAX, pray: PRAY_NEED, ult: ULT_CD / 1000 },
    minions: Object.fromEntries(Object.entries(MINIONS).map(([k, v]) => [k, { name: v.name, xp: v.xp, key: v.key }])),
    bosses: Object.fromEntries(Object.entries(BOSSES).map(([k, v]) => [k, { name: v.name, dmg: Math.round(bossDmgPct(k) * 100), trait: v.trait, desc: v.desc }])) });
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
           list: Object.entries(s.players || {}).map(([n, v]) => ({ name: n, games: v.games || 0, wins: v.wins || 0, top3: v.top3 || 0, kills: v.kills || 0, bestPlace: v.bestPlace || 0 }))
                 .sort((a, b) => (b.wins - a.wins) || (b.top3 - a.top3) || (b.kills - a.kills)) });
});
app.get("/api/stats", (q, r) => {
  const m = process.memoryUsage();
  r.json({ players: G.players.size, duels: G.duels.size, phase: G.phase, mode: G.mode, stage: G.stage, alive: aliveCount(),
           tickAvg: G.stats.tickAvg, tickMax: G.stats.tickMax,
           rssMB: +(m.rss / 1048576).toFixed(1), heapMB: +(m.heapUsed / 1048576).toFixed(1) });
});

/* ═════════ 소켓 ═════════ */
const LOOK = (look) => ({
  sk: clamp(+look?.sk | 0, 0, 4), hs: clamp(+look?.hs | 0, 0, 5), hc: clamp(+look?.hc | 0, 0, 9),
  ft: clamp(+look?.ft | 0, 0, 5), cc: clamp(+look?.cc | 0, 0, 11), gr: clamp(+look?.gr | 0, 0, 5),
  ac: clamp(+look?.ac | 0, 0, 7), it: clamp(+look?.it | 0, 0, 5) });
io.on("connection", (socket) => {
  const me = () => G.players.get(socket.data.pid);
  socket.on("host:join", () => {
    socket.join("host");
    socket.emit("roster", { seq: rosterSeq, list: rosterPayload(), mode: G.mode, teams: TEAMS.slice(0, teamCount()) });
    if (G.qproblems.length) socket.emit("qproblems", G.qproblems);
  });
  socket.on("host:start", (opt) => {
    if (!G.players.size || (G.phase !== "lobby" && G.phase !== "ended")) return;
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
  socket.on("host:shuffleTeams", () => { if (G.phase === "lobby") { assignTeams(); bumpRoster(); } });
  socket.on("host:qfile", (f) => {
    if (G.phase !== "lobby" || !questionFiles().includes(f)) return;
    const r = loadQuestions(f);
    if (!r.list.length) return io.to("host").emit("qproblems", r.problems.length ? r.problems : [`${f} 에 쓸 수 있는 문제가 없습니다`]);
    G.qfile = f; G.questions = r.list; G.qproblems = r.problems; G.usedQ.clear();
    for (const p of G.players.values()) p.seen.clear();
    pushLog(`문제집을 ${f} 로 바꿨습니다 (${r.list.length}문제)`);
    io.to("host").emit("qproblems", r.problems);
  });
  /* 일시정지: 게임 시계 자체를 멈춥니다 (홍수·부활·궁극기 시간도 함께 멈춤) */
  socket.on("host:pause", () => {
    if (G.phase === "playing") { pauseStart = rawNow(); G.pausedLeft = G.endsAt - now(); G.phase = "paused"; pushLog("잠시 멈춤"); }
    else if (G.phase === "paused") { pauseTotal += rawNow() - pauseStart; pauseStart = 0; G.phase = "playing"; lastTick = now(); pushLog("다시 시작!"); }
  });
  socket.on("host:end", () => { if (G.phase === "playing" || G.phase === "paused" || G.phase === "countdown") endGame(); });
  socket.on("host:reset", () => resetToLobby());
  socket.on("host:kick", (pid) => {
    const p = G.players.get(pid);
    if (p?.socketId) io.to(p.socketId).emit("kicked");
    if (p && p.duel) cancelDuelOf(p);
    G.players.delete(pid); G.participants.delete(pid); numOf.delete(pid); bumpRoster();
    checkWin();
  });
  /* 선생님 도움: 탈락한 친구 다시 넣기(연결이 끊겨 억울하게 떨어졌을 때) · 체력 채워 주기 */
  socket.on("host:adjust", (o) => {
    const p = G.players.get(o?.pid);
    if (!p || G.phase !== "playing" || G.winner) return;
    if (o.act === "revive" && (p.st === "out" || p.st === "spec" || p.st === "down" || p.st === "bleed")) {
      if (p.duel) { closeDuel(G.duels.get(p.duel)); p.duel = null; }    // 풀던 부활·기도 문제는 닫고
      G.participants.add(p.id); const s = farSpot(200, G.stage !== "grow");
      p.place = 0; reviveAt(p, s.x, s.y, .6, "teacher");
      if (teamCount()) delete G.teamPlace[p.team];                     // 전멸했던 팀이 다시 살아남
      pushLog(`🙌 선생님이 ${p.name}을(를) 다시 일으켰습니다`, "gold");
    } else if (o.act === "heal" && p.st === "ok") {
      const h = heal(p, p.mhp * .3); pushLog(`🙌 선생님이 ${p.name}의 체력을 채웠습니다 (+${Math.round(h)})`, "gold");
      if (p.socketId) io.to(p.socketId).emit("toast", `🙌 선생님이 체력을 채워 주었습니다 (+${Math.round(h)})`);
    }
  });
  socket.on("host:feature", (id) => {
    if (id === null || id === undefined) { G.featured = null; G.featuredManual = 0; return; }
    if (G.duels.has(id)) { G.featured = id; G.featuredManual = now() + 25000; }
  });

  socket.on("join", (o) => {
    const { name, look, id } = o || {};
    const c = cleanName(name);
    if (c.err) return socket.emit("joinError", c.err);
    const L = LOOK(look);
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
      if (G.phase === "countdown") { G.participants.add(p.id); p.safeUntil = now() + 5000; }
      else if (G.phase === "playing" || G.phase === "paused") {
        if (G.stage === "grow") {
          // ── 지각 입장 따라잡기: 중간 레벨 −1, 체력·공격 강화 자동 적용 ──
          const lvs = [...G.players.values()].filter((x) => G.participants.has(x.id) && inGame(x)).map((x) => x.level || 1).sort((a, b) => a - b);
          const med = lvs.length ? lvs[lvs.length >> 1] : 1;
          const startLv = Math.max(1, Math.min(7, med - 1));
          p.level = startLv; p.xp = XP_TABLE[startLv - 1] || 0; p.tier = tierIdx(startLv);
          for (let Lv = 2; Lv <= startLv; Lv++) { const k = Lv % 2 ? "atk" : "hp"; p.perk[k] = stk(p, k) + 1; if (k === "hp") p.mhp += 20; else p.atk += 4; }
          p.hp = p.mhp;
          p.safeUntil = now() + 10000;                   // 10초 무적 (둘러볼 시간)
          p.catchUpUntil = now() + 120000;               // 2분 동안 경험치 2배
          p.ultReady = now() + 30000;                    // 궁극기는 30초 뒤
          p.keys = 1;
          p.items = [["speed", "shield", "hint", "time", "double"][Math.random() * 5 | 0]];
          const sp = joinSpot(); p.x = sp.x; p.y = sp.y;
          p.lateJoin = true; G.participants.add(p.id);
          pushLog(`${c.name} 지각 입장! Lv${startLv} 지원 · 2분간 경험치 2배`, "hot");
          later(400, () => { if (p.socketId) io.to(p.socketId).emit("lateJoin", {
            level: startLv, keys: 1, item: BOX_ITEMS[p.items[0]], boost: 120, safe: 10, hp: p.mhp, atk: p.atk,
            left: leftSec(), alive: aliveCount() }); });
        } else {
          p.st = "spec";                                  // 홍수 단계부터는 관전 + 중보기도로 참여
          pushLog(`${c.name} 관전 입장 (홍수 단계라 중보기도로 함께합니다)`);
          later(400, () => { if (p.socketId) io.to(p.socketId).emit("lateJoin", { spec: true, left: leftSec(), alive: aliveCount() }); });
        }
      }
      G.players.set(p.id, p);
      if (!p.lateJoin && p.st !== "spec") pushLog(`${c.name} 참가!`);
      changed = true;
    } else if (G.phase === "lobby") {
      p.name = c.name; p.look = L; p.cls = ITEM_CLASS[L.it];
      p.guard = p.cls === "shield" ? 2 : 0;
      changed = true;
    }
    p.connected = true; p.socketId = socket.id; socket.data.pid = p.id;
    if (changed) bumpRoster();
    socket.emit("roster", { seq: rosterSeq, list: rosterPayload(), mode: G.mode, teams: TEAMS.slice(0, teamCount()) });
    socket.emit("joined", { id: p.id, u: numOf.get(p.id), name: p.name, look: p.look, cls: p.cls, team: p.team, ult: ULTS[p.cls] });
    if (p.duel && G.duels.has(p.duel)) sendDuel(p, G.duels.get(p.duel));
    if (p.pendingCards.length) later(900, () => sendCards(p));
  });

  /* 폰이 보낸 입력을 번호(seq)와 함께 즉시 적용합니다.
     폰은 같은 계산을 먼저 해 두고, 서버가 확인한 번호 이후의 입력만 다시 얹어 보정합니다. */
  socket.on("move", (v) => {
    const p = me();
    if (!p || !v) return;
    const t = now();
    if (Date.now() - (p.inWin || 0) > 1000) { p.inWin = Date.now(); p.inCnt = 0; }
    if (++p.inCnt > 45) return;                         // 초당 입력 상한
    p.lastSeq = v.s | 0;
    const x = clamp(+v.x || 0, -1, 1), y = clamp(+v.y || 0, -1, 1);
    p.ix = x; p.iy = y; p.lastInput = t;
    if (G.phase !== "playing" || p.st !== "ok" || p.duel || G.stage === "judge" || G.winner) return;
    // 시간 예산: 실제 흐른 시간의 1.12배까지만 움직일 수 있게 (속도 해킹 방지)
    p.budget = Math.min(.3 * TIME_SCALE, (p.budget || 0) + (t - (p.budgetT || t)) / 1000 * 1.12);
    p.budgetT = t;
    let dt = clamp(+v.dt || 0, 0, .08 * TIME_SCALE);
    if (dt > p.budget) dt = p.budget;
    p.budget -= dt;
    if (dt > 0) applyMove(p, x, y, dt, t);
  });
  socket.on("ambush", () => {
    const p = me(), t = now();
    if (!p || G.phase !== "playing" || p.st !== "ok" || G.stage === "judge") return;
    const target = ambushTarget(p, t);
    if (!target) return;
    startDuel(p, target, true);
  });
  /* 대기실 연습 퀴즈 — 3문제 맞히면 출발 보너스 XP */
  socket.on("practice:get", () => {
    const p = me();
    if (!p || G.phase !== "lobby" || !G.questions.length) return;
    const pool = G.questions.filter((q) => !q.hard);
    const q0 = (pool.length ? pool : G.questions)[Math.random() * (pool.length || G.questions.length) | 0];
    const order = [0, 1, 2, 3].sort(() => Math.random() - .5);
    p.practiceQ = { id: q0.id, options: order.map((i) => q0.options[i]), answer: order.indexOf(q0.answer), ref: q0.ref, exp: q0.exp };
    socket.emit("practice:q", { text: q0.text, options: p.practiceQ.options, cat: q0.cat, done: p.practiceCorrect || 0 });
  });
  socket.on("practice:answer", (o) => {
    const p = me();
    if (!p || !p.practiceQ) return;
    const q = p.practiceQ; p.practiceQ = null;
    const ok = (+o.choice) === q.answer;
    if (ok && (p.practiceCorrect || 0) < 3) { p.practiceCorrect = (p.practiceCorrect || 0) + 1; p.practiceXp = (p.practiceXp || 0) + 10; }
    socket.emit("practice:r", { ok, answer: q.answer, ref: q.ref, exp: q.exp, done: p.practiceCorrect || 0, bonus: p.practiceXp || 0 });
  });
  socket.on("dodge", () => {
    const p = me(), t = now();
    if (!p || p.duel || G.phase !== "playing" || p.st !== "ok" || t < p.dodgeReady) return;
    p.dodgeUntil = t + DODGE_TIME; p.dodgeReady = t + DODGE_COOL;
    socket.emit("dodgeOk");
  });
  socket.on("answer", (o) => {
    const p = me();
    if (!p || !o || p.duel !== o.duelId) return;
    const d = G.duels.get(o.duelId);
    if (!d || d.picks[p.id]) return;
    if (d.lock && d.lock[p.id] && now() < d.lock[p.id]) return;   // 기습당한 직후엔 못 고름
    const c = +o.choice;
    if (!(c >= 0 && c <= 3) || (d.hide[p.id] || []).includes(c)) return;
    const ok = c === d.q.answer;
    d.picks[p.id] = { choice: c, correct: ok, at: now() };
    if (d.kind === "pvp" || d.kind === "boss" || d.kind === "sermon") { p.answered++; if (ok) p.correct++; }
    if (d.kind === "judge") { socket.emit("submitted", { judge: true }); return judgeAnswered(); }
    if (d.kind !== "pvp") return resolveDuel(d);           // 혼자 푸는 문제는 바로 판정
    const foeId = d.a === p.id ? d.b : d.a, foe = G.players.get(foeId);
    if (d.picks[foeId]) return resolveDuel(d);             // 둘 다 냈으면 바로
    if (ok) {                                              // 먼저 맞힘 → 상대에게 5초 반격 기회
      d.counterUntil = Math.min(d.endsAt, now() + COUNTER_MS);
      const left = Math.round((d.counterUntil - now()) / 100 / TIME_SCALE) / 10;
      socket.emit("submitted", { counter: left });
      if (foe && foe.socketId) io.to(foe.socketId).emit("foeFirst", { left });
    } else socket.emit("wrongPick", { choice: c });
  });
  /* 궁극기 */
  socket.on("ult", () => {
    const p = me(), t = now();
    if (!p || G.phase !== "playing" || G.stage === "judge" || G.winner) return;
    if (p.st !== "ok" || p.duel) return socket.emit("ultNo", { msg: "지금은 쓸 수 없어요" });
    if (t < p.ultReady) return socket.emit("ultNo", { msg: `${Math.ceil((p.ultReady - t) / 1000)}초 뒤에 준비됩니다` });
    const U = ULTS[p.cls] || ULTS.sling;
    let effect = "";
    if (p.cls === "sling") { p.ultArm = "sling"; p.ultArmUntil = t + 30000; effect = "다음 대결에서 맞히면 큰 피해! (30초 안에)"; }
    else if (p.cls === "lamp") { p.ultArm = "lamp"; p.lampLeft = 3; p.ultArmUntil = t + 45000; effect = "다음 대결 3번 동안 오답 2개 삭제 (45초 안에)"; }
    else if (p.cls === "shield") { const h = heal(p, p.mhp * .25); p.ultShieldUntil = t + 25000; effect = `체력 +${Math.round(h)} · 다음 대결 피해 0`; }
    else if (p.cls === "harp") {
      const h = heal(p, p.mhp * .45); let n = 0, rv = 0;
      if (teamCount()) for (const o of G.players.values()) {
        if (o === p || o.team !== p.team || !G.participants.has(o.id) || Math.hypot(o.x - p.x, o.y - p.y) > 260) continue;
        if (o.st === "ok") { const g = heal(o, o.mhp * .25); if (g > 0) { n++; if (o.socketId) io.to(o.socketId).emit("toast", `🎵 ${p.name}의 수금 — 체력 +${Math.round(g)}`); } }
        else if (o.st === "bleed") { if (o.revBy) { const r = G.players.get(o.revBy); if (r && r.duel) cancelDuelOf(r); o.revBy = null; } reviveAt(o, o.x, o.y, .3, "harp"); rv++; p.teamRevives++; }
      }
      effect = `체력 +${Math.round(h)}` + (n ? ` · 팀원 ${n}명 회복` : "") + (rv ? ` · ${rv}명 일으킴` : "");
    } else if (p.cls === "staff") {
      p.immuneUntil = t + 8000; let n = 0;
      for (const o of G.players.values()) {
        if (o === p || !fighting(o) || !enemies(p, o) || o.duel) continue;
        const dd = Math.hypot(o.x - p.x, o.y - p.y); if (dd > 220 || dd < 1) continue;
        const ux = (o.x - p.x) / dd, uy = (o.y - p.y) / dd;
        for (const k of [170, 120, 80, 40]) {
          const nx = clamp(o.x + ux * k, R, MAP.W - R), ny = clamp(o.y + uy * k, R, MAP.H - R);
          if (!blocked(nx, ny)) { o.x = nx; o.y = ny; break; }
        }
        o.safeUntil = Math.max(o.safeUntil, t + 1500); n++;
        if (o.socketId) io.to(o.socketId).emit("pushed", { x: o.x | 0, y: o.y | 0, by: p.name });
      }
      effect = "8초 무적 · 빠른 이동 · 홍수 피해 없음" + (n ? ` · ${n}명 밀어냄` : "");
    } else if (p.cls === "scroll") {
      const targets = [...G.players.values()].filter((o) => o !== p && fighting(o) && enemies(p, o) && !o.duel && o.connected && t >= o.immuneUntil && Math.hypot(o.x - p.x, o.y - p.y) <= 260)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 6);
      if (!targets.length) return socket.emit("ultNo", { msg: "주변(6칸 안)에 적이 없어요 — 가까이 가서 쓰세요" });
      startSermon(p, targets); effect = `${targets.length}명에게 말씀 선포!`;
    }
    p.ultReady = t + ultCdFor(p); p.ultCount++;
    pushLog(`${U.icon} ${p.name} — ${U.name}!`, "gold");
    fx({ k: "ult", u: numOf.get(p.id), cls: p.cls, name: U.name, icon: U.icon, n: p.name, x: p.x | 0, y: p.y | 0 });
    socket.emit("ultOk", { name: U.name, icon: U.icon, effect, cd: Math.round(ultCdFor(p) / 1000) });
  });
  /* 레벨업 강화 카드 고르기 */
  socket.on("card", (o) => { const p = me(); if (p && p.pendingCards.length) applyCard(p, o && o.id); });
  /* 중보기도: 대상 고르기 · 켜고 끄기 */
  socket.on("pray", (o) => {
    const p = me(); if (!p || !o) return;
    if (!(p.st === "out" || p.st === "spec" || !G.participants.has(p.id))) return;
    if (o.u != null) {
      const tg = G.players.get(idOfNum.get(+o.u));
      const mateAlive = teamCount() && [...G.players.values()].some((m) => m.team === p.team && m.st === "ok" && G.participants.has(m.id));
      if (tg && tg.st === "ok" && G.participants.has(tg.id) && (!mateAlive || tg.team === p.team)) { p.prayTarget = tg.id; p.specId = tg.id; }
    }
    if (typeof o.on === "boolean") { p.prayOn = o.on; if (!o.on && p.duel) { const d = G.duels.get(p.duel); if (d && d.kind === "pray") closeDuel(d); } }
  });
  socket.on("watch", (u) => { const p = me(); const tg = G.players.get(idOfNum.get(+u)); if (p && tg) p.specId = tg.id; });
  socket.on("ping2", (ts) => socket.emit("pong2", ts));
  socket.on("disconnect", () => {
    const p = me();
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
  console.log("\n  성경 픽셀 배틀 (서바이벌) 서버가 켜졌습니다.");
  console.log("  ─────────────────────────────────────");
  console.log(`  메인 화면(관전) : http://localhost:${PORT}/host`);
  console.log(`  학생 접속 주소  : ${JOIN_URL}`);
  console.log(`  문제집 ${G.qfile} · ${G.questions.length}문제`);
  if (TIME_SCALE !== 1) console.log(`  ⚠ 시험 모드: 시간 ${TIME_SCALE}배속`);
  if (G.qproblems.length) {
    console.log("\n  ⚠ 문제 파일에서 걸러낸 항목");
    G.qproblems.slice(0, 10).forEach((s) => console.log("    - " + s));
    if (G.qproblems.length > 10) console.log(`    … 외 ${G.qproblems.length - 10}건`);
  }
  console.log("  ─────────────────────────────────────\n");
});

/* 서바이벌 밸런스 시뮬레이터 — 성경 실력이 다른 봇들로 한 판을 끝까지 치릅니다.
   사용법: TIME_SCALE=5 node server.js 로 서버를 켠 뒤
           node sim.js [인원=60] [분=10] [모드=solo|team2|team4] [배속=5]
   결과: 생존자 수 변화, 우승자 실력, 실력별 평균 순위, 궁극기·부활·기도 통계 */
const { io } = require("socket.io-client");
const fs = require("fs");
const URL = "http://localhost:" + (process.env.SIM_PORT || 3001);
const N = Number(process.argv[2] || 60), MIN = Number(process.argv[3] || 10), MODE = process.argv[4] || "solo";
const TS = Number(process.argv[5] || process.env.TIME_SCALE || 1);
const QUIET = process.env.QUIET === "1";
const ANS = new Map();                                   // 문제 글 → 정답 보기 글
for (const q of JSON.parse(fs.readFileSync(__dirname + "/questions.json", "utf8"))) ANS.set(q.t, q.o[q.a]);
const rt = (ms) => ms / TS;                              // 게임 시간 → 실제 시간
const rnd = (a, b) => a + Math.random() * (b - a);
/* 실력 분포: 잘 아는 친구 20% · 보통 50% · 초보 30% */
const PROFILES = [];
for (let i = 0; i < N; i++) {
  const r = i / N;
  PROFILES.push(r < .2 ? { g: "상", acc: rnd(.85, .95), spd: rnd(2500, 5000) }
             : r < .7 ? { g: "중", acc: rnd(.6, .78), spd: rnd(3500, 7500) }
             : { g: "하", acc: rnd(.35, .55), spd: rnd(4500, 8500) });
}
const H = io(URL); let W = null, M = null, END = null;
const aliveLog = [];                                     // [경과초, 생존자수, 단계]
let t0 = 0, judgeRounds = 0, lastStage = "";
const counts = { ult: {}, pray: 0, revive: 0, teamrev: 0, sermonHit: 0, kills: 0, down: 0, hits: 0, dmg: 0, cards: {} };
const seenD = new Set(), duelsBy = { grow: 0, flood: 0 }, downBy = { grow: 0, flood: 0, judge: 0 };
let hpAtFlood = null; const cause = {}; let hpByG = null;
H.on("connect", () => H.emit("host:join"));
H.on("world", (w) => {
  countFx(w.fx);
  W = w;
  if (w.ph === "playing") {
    if (!t0) t0 = Date.now();
    const el = Math.round((Date.now() - t0) / 1000 * TS);
    if (!aliveLog.length || el - aliveLog[aliveLog.length - 1][0] >= 15 || w.stg !== lastStage) { aliveLog.push([el, w.al, w.stg]); lastStage = w.stg; }
    if (w.j && w.j.round > judgeRounds) judgeRounds = w.j.round;
    for (const d of w.d) if (!seenD.has(d[7])) { seenD.add(d[7]); if (!d[8]) duelsBy[w.stg] = (duelsBy[w.stg] || 0) + 1; }
    if (w.stg === "flood" && !hpAtFlood) { hpAtFlood = Math.round(w.p.reduce((a, x) => a + x[4], 0) / Math.max(1, w.p.length));
      hpByG = {}; for (const s of bots) { if (!s.f) continue; const g = s.prof.g; (hpByG[g] = hpByG[g] || []).push(Math.round(s.f.hp / Math.max(1, s.f.mhp) * 100)); } }
  }
});
const countFx = (list) => (list || []).forEach((f) => { if (f.k === "ult") counts.ult[f.cls] = (counts.ult[f.cls] || 0) + 1; if (f.k === "pray") counts.pray++; if (f.k === "hit") { counts.hits++; counts.dmg += f.dmg || 0; } if (f.k === "revive") counts.revive++; if (f.k === "down") { counts.down++; downBy[(W && W.stg) || "grow"]++; cause[f.kind || "?"] = (cause[f.kind || "?"] || 0) + 1; } });
H.on("meta", (m) => { M = m; countFx(m.fx); });
H.on("gameEnd", (e) => { END = e; });

const bots = [];
for (let i = 0; i < N; i++) {
  const s = io(URL, { transports: ["websocket"], forceNew: true });
  const prof = PROFILES[i];
  s.prof = prof; s.i = i; s.seq = 0; s.ang = Math.random() * 7; s.f = null; s.meta = null; s.aggr = rnd(.5, 1);
  const look = { sk: i % 5, hs: i % 6, hc: i % 10, ft: i % 6, cc: i % 12, gr: i % 6, ac: i % 8, it: i % 6 };
  s.cls = ["sling", "shield", "scroll", "lamp", "staff", "harp"][look.it];
  s.on("connect", () => s.emit("join", { name: `${prof.g}${i}`, look, id: s.pid }));
  s.on("joined", (p) => { s.pid = p.id; });
  s.on("me", (f) => { s.f = f; });
  s.on("meta", (m) => { s.meta = m;
    if (m.survivors && m.pray && (!m.pray.target || !m.pray.on) && m.survivors.length) {
      const tg = m.survivors[Math.random() * m.survivors.length | 0];
      s.emit("pray", { u: tg.u, on: true });
    }
  });
  s.on("duel", (d) => {
    s.duel = d; s.answered = false;
    const correct = d.options.indexOf(ANS.get(d.question));
    const hide = d.hide || [];
    const pickNow = () => {
      if (s.answered || !s.duel || s.duel.id !== d.id) return;
      s.answered = true;
      let acc = prof.acc; if (hide.length) acc = acc + (1 - acc) * (hide.length / 3);   // 보기가 지워지면 찍어도 잘 맞음
      let c = correct;
      if (Math.random() > acc || correct < 0) { const w = [0, 1, 2, 3].filter((k) => k !== correct && !hide.includes(k)); c = w[Math.random() * w.length | 0]; }
      s.emit("answer", { duelId: d.id, choice: c });
    };
    const lock = d.lock || 0;
    s.pickT = setTimeout(pickNow, Math.max(lock, rt(prof.spd * rnd(.7, 1.3))));
  });
  s.on("foeFirst", () => { });                              // 반격 시간 안에 못 맞추면 그만
  s.on("duelEnd", () => { s.duel = null; clearTimeout(s.pickT); });
  s.on("cards", (c) => {
    const ck = c.src === "box" ? "box" + (c.tier || 0) : c.src || "lv"; counts.cards[ck] = (counts.cards[ck] || 0) + 1;
    setTimeout(() => {
      const ids = c.opts.map((o) => o.id);
      const m = s.meta || {};
      let pick = ids[0];
      if (ids.includes("heal") && m.hp < m.mhp * .5) pick = "heal";
      else if (Math.random() < .6) pick = ids.find((x) => x === "atk" || x === "hp") || ids[0];
      else pick = ids[Math.random() * ids.length | 0];
      s.emit("card", { id: pick });
    }, rt(rnd(1500, 5000)));
  });
  bots.push(s);
}
/* 이동·공격: 물 밖이면 안전지대로, 노려지면 도망·회피, 공격 대상이 있으면 공격, 아니면 적을 찾아 이동 */
setInterval(() => {
  for (const s of bots) {
    const f = s.f; if (!f || f.ph !== "playing" || f.st !== "ok" || s.duel) continue;
    let x = 0, y = 0;
    const z = f.z;
    const hpR = f.hp / Math.max(1, f.mhp);
    const aimed = f.am && f.am.length ? f.am[0] : null;
    // 공격: 사람이 사거리 안이면 거의 바로, 미니언은 적이 멀 때, 보스는 가끔
    if (f.tg && !f.acd && Date.now() > (s.atkWait || 0)) {
      const k = f.tg[0];
      const want = k === 0 ? Math.random() < s.aggr * (hpR < .3 ? .5 : 1) : k === 2 ? (!f.en || f.en[2] > 300) && Math.random() < .5 : Math.random() < .12;
      s.atkWait = Date.now() + rt(rnd(600, 1800));                 // 사람은 버튼을 누르기까지 조금 걸림
      if (want) { s.emit("attack", { k, id: f.tg[1] }); continue; }
    }
    if (aimed && f.dodge === 0 && Math.random() < .08) s.emit("dodge");
    if (z && z[2] < 90000 && Math.hypot(f.x - z[0], f.y - z[1]) > z[2] - 60) { const d = Math.hypot(z[0] - f.x, z[1] - f.y) || 1; x = (z[0] - f.x) / d; y = (z[1] - f.y) / d; }
    else if (z && z[5] && !z[7] && Math.hypot(f.x - z[3], f.y - z[4]) > z[5] - 80) { const d = Math.hypot(z[3] - f.x, z[4] - f.y) || 1; x = (z[3] - f.x) / d; y = (z[4] - f.y) / d; }
    else if (f.bm) { x = f.bm[0]; y = f.bm[1]; }
    else if (aimed && hpR < .45) { const d = Math.hypot(aimed[1] - f.x, aimed[2] - f.y) || 1; x = (f.x - aimed[1]) / d; y = (f.y - aimed[2]) / d; }   // 약하면 도망
    else {
      if (!s.modeT || Date.now() > s.modeT) { s.modeT = Date.now() + rt(rnd(1500, 3500)); s.mode = hpR < .3 && Math.random() < .6 ? "flee" : Math.random() < s.aggr ? "chase" : "wander"; }
      if (f.en && s.mode === "chase" && f.en[2] > 110) { x = f.en[0]; y = f.en[1]; }
      else if (f.en && s.mode === "flee" && f.en[2] < 300) { x = -f.en[0]; y = -f.en[1]; }
      else if (s.mode === "wander" || !f.en) { s.ang += (Math.random() - .5) * .5; x = Math.cos(s.ang); y = Math.sin(s.ang); }
    }
    s.seq++;
    s.volatile.emit("move", { s: s.seq, x, y, dt: .07 * TS });
    if (f.ult === 0 && Math.random() < .08) {
      const near = f.en && f.en[2] < 260;
      const out = z && z[2] < 90000 && Math.hypot(f.x - z[0], f.y - z[1]) > z[2];
      const want = s.cls === "shield" || s.cls === "harp" ? hpR < .55
                 : s.cls === "staff" ? (out || (hpR < .35 && near))
                 : s.cls === "scroll" ? near && f.en[2] < 220
                 : near;
      if (want) s.emit("ult");
    }
  }
}, 70);

setTimeout(() => {
  console.log(`봇 ${N}명 접속 · ${MIN}분 · ${MODE} · 배속 ${TS}`);
  if (process.env.NOSTART !== "1") H.emit("host:start", { min: MIN, mode: MODE });   // NOSTART=1 이면 관전 화면에서 직접 시작
}, 3000);
const t00 = Date.now();
const iv = setInterval(() => {
  if (!END && Date.now() - t00 < (MIN * 60000 + 240000) / TS + 20000 + (process.env.NOSTART === "1" ? 60000 : 0)) return;
  clearInterval(iv);
  report();
  process.exit(0);
}, 1000);

function report() {
  if (!END) { console.log("게임이 끝나지 않았습니다. 마지막 상태:", W && { ph: W.ph, stg: W.stg, al: W.al }); return; }
  const prof = new Map(bots.map((s) => [s.pid, s.prof]));
  const board = END.board;
  const w = board[0], wp = prof.get(w.id) || {};
  const el = aliveLog.map(([s, a, st]) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} ${a}명${st === "flood" ? "🌊" : st === "judge" ? "⚖" : ""}`);
  if (!QUIET) console.log("생존자 변화:", el.join(" · "));
  const dur = aliveLog.length ? aliveLog[aliveLog.length - 1][0] : 0;
  const atEnd = aliveLog.filter((r) => r[2] === "flood").slice(-1)[0];
  const groups = {};
  board.forEach((b) => { const g = (prof.get(b.id) || {}).g || "?"; (groups[g] = groups[g] || []).push(b.place); });
  const avg = Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)]));
  const per = {};
  board.forEach((b) => { const g = (prof.get(b.id) || {}).g || "?"; const e = per[g] = per[g] || { n: 0, kills: 0, lv: 0, hits: 0, dmg: 0 };
    e.n++; e.kills += b.kills; e.lv += b.level; e.hits += b.hits; e.dmg += b.dmg; });
  if (!QUIET) console.log("그룹별 순위:", Object.entries(groups).map(([g, v]) => g + " " + v.slice().sort((a, b) => a - b).join(",")).join(" | "));
  if (!QUIET && hpByG) console.log("홍수 시작 때 체력%:", Object.entries(hpByG).map(([g, v]) => g + " " + Math.round(v.reduce((a, b) => a + b, 0) / v.length)).join(" · "));
  if (!QUIET) console.log("실력별 평균:", Object.entries(per).map(([g, e]) => `${g}: 처치 ${(e.kills / e.n).toFixed(1)} · 레벨 ${(e.lv / e.n).toFixed(1)} · 명중 ${(e.hits / e.n).toFixed(1)} · 피해 ${Math.round(e.dmg / e.n)}`).join(" | "));
  const top10 = board.slice(0, 10).map((b) => (prof.get(b.id) || {}).g).join("");
  console.log(JSON.stringify({
    winner: END.winner && (END.winner.name || (END.teamWinner != null ? "팀" + END.teamWinner : "")), winnerGroup: wp.g, winnerAcc: wp.acc && +wp.acc.toFixed(2),
    judgeRounds, secs: dur, aliveAtJudge: (aliveLog.find((r) => r[2] === "judge") || [])[1] ?? null,
    top10, avgPlace: avg, attacks: duelsBy, hits: counts.hits, avgDmg: counts.hits ? Math.round(counts.dmg / counts.hits) : 0, downs: downBy, cause, hpAtFlood, ult: counts.ult, cards: counts.cards, pray: counts.pray, revive: counts.revive,
    maxKills: Math.max(...board.map((b) => b.kills)), topLv: Math.max(...board.map((b) => b.level)),
  }));
}

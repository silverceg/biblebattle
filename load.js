const { io } = require("socket.io-client");
const URL = "http://localhost:3001";
const N = Number(process.argv[2] || 60);
const SECS = Number(process.argv[3] || 30);

const H = io(URL); let W = null;
H.on("connect", () => H.emit("host:join"));
let hostFrames = 0, hostBytes = 0;
H.on("world", (w) => { W = w; hostFrames++; hostBytes += JSON.stringify(w).length; });
H.on("meta", (m) => { HM = m; hostBytes += JSON.stringify(m).length; });
H.on("roster", (r) => { hostBytes += JSON.stringify(r).length; });
let HM = null;

const bots = [];
let meFrames = 0, meBytes = 0, duels = 0, ends = 0, pings = [], dupSame = 0, dupGlobal = 0;
const seenQ = new Set(), duelQ = new Map(), perPlayer = new Map();

for (let i = 0; i < N; i++) {
  const s = io(URL, { transports: ["websocket"] });
  const look = { sk: i % 5, hs: i % 6, hc: i % 10, ft: i % 6, cc: i % 12, gr: i % 6, ac: i % 8, it: i % 6 };
  s.on("connect", () => s.emit("join", { name: "학생" + i, look }));
  s.on("joined", (p) => { s.pid = p.id; perPlayer.set(p.id, new Set()); });
  s.on("me", (m) => { meFrames++; meBytes += JSON.stringify(m).length; s.last = m; });
  s.on("meta", (m) => { meBytes += JSON.stringify(m).length; s.meta = m; });
  s.on("roster", (r) => { meBytes += JSON.stringify(r).length; });
  s.on("duel", (d) => {
    duels++;
    if (duelQ.has(d.id)) { if (duelQ.get(d.id) !== d.question) dupSame++; }
    else { duelQ.set(d.id, d.question); if (seenQ.has(d.question)) dupGlobal++; seenQ.add(d.question); }
    const mine = perPlayer.get(s.pid); if (mine) { if (mine.has(d.question)) dupGlobal++; mine.add(d.question); }
    setTimeout(() => s.emit("answer", { duelId: d.id, choice: Math.random() < .5 ? d.hide >= 0 ? 1 : 0 : Math.random() * 4 | 0 }),
      200 + Math.random() * 1200);
  });
  s.on("duelEnd", () => ends++);
  s.on("pong2", (ts) => pings.push(Date.now() - ts));
  bots.push(s);
}

const t = (ms, f) => setTimeout(f, ms);
t(2500, () => {
  console.log(`접속 ${W.p.length}명 (요청 ${N}명)`);
  H.emit("host:start", Math.max(2, Math.ceil(SECS / 60) + 1));
  console.log(`${SECS}초 동안 전원 이동 + 대결 진행…\n`);
});

// 봇 이동: 각자 다른 방향으로 배회하며 자주 마주치게
let phase = 0;
const mover = setInterval(() => {
  phase += 0.25;
  bots.forEach((s, i) => {
    const a = phase * (0.5 + (i % 7) * 0.13) + i * 1.7;
    s.seq = (s.seq || 0) + 1;
    s.volatile.emit("move", { s: s.seq, x: Math.cos(a), y: Math.sin(a * 1.3), dt: .07 });
  });
}, 70);
const pinger = setInterval(() => bots.forEach((s) => s.emit("ping2", Date.now())), 1000);

t(2500 + SECS * 1000, async () => {
  clearInterval(mover); clearInterval(pinger);
  const secs = SECS;
  pings.sort((a, b) => a - b);
  const p50 = pings[pings.length >> 1] || 0, p95 = pings[Math.floor(pings.length * .95)] || 0;
  const st = await fetch(URL + "/api/stats").then((r) => r.json());

  console.log("── 부하 측정 결과 ──────────────────────");
  console.log(`동시 접속        : ${st.players}명`);
  console.log(`물리 루프(20Hz)  : 평균 ${st.tickAvg}ms / 최대 ${st.tickMax}ms  (한계 50ms)`);
  console.log(`서버 메모리      : RSS ${st.rssMB}MB / 힙 ${st.heapMB}MB`);
  console.log(`왕복 지연        : 중앙값 ${p50}ms / 상위5% ${p95}ms  (표본 ${pings.length})`);
  console.log(`관전 화면 수신   : ${(hostFrames/secs).toFixed(1)}fps, ${(hostBytes/secs/1024).toFixed(0)}KB/s`);
  console.log(`폰 1대당 수신    : ${(meFrames/secs/N).toFixed(1)}fps, ${(meBytes/secs/1024/N).toFixed(1)}KB/s`);
  console.log(`서버 총 송신량   : 약 ${((hostBytes+meBytes)/secs/1024).toFixed(0)}KB/s (${((hostBytes+meBytes)/secs*8/1e6).toFixed(2)}Mbps)`);
  console.log("── 게임 동작 ──────────────────────────");
  console.log(`발생한 대결      : ${duelQ.size}건 (${(duelQ.size/secs*60).toFixed(0)}건/분)`);
  console.log(`대결 종료 통보   : ${ends}회`);
  console.log(`짝에게 다른 문제 : ${dupSame}건 ${dupSame === 0 ? "(정상)" : "(오류!)"}`);
  console.log(`문제 중복 출제   : ${dupGlobal}회`);
  console.log(`상자 유지        : ${HM.boxes.length}개 / 보스 ${(W.bosses||[]).length}마리`);
  const b = HM.board;
  console.log(`1위 ${b[0].name} ${b[0].score}점 · 꼴찌 ${b[b.length-1].name} ${b[b.length-1].score}점`);
  process.exit(0);
});

/* ═══════════ 8비트 사운드 엔진 (파일 없이 코드로 소리를 만듭니다) ═══════════
   SFX.play("win") / SFX.music("play") / SFX.toggle()                       */
(function (root) {
  const SEMI = { C:0, "C#":1, D:2, "D#":3, E:4, F:5, "F#":6, G:7, "G#":8, A:9, "A#":10, B:11 };
  const hz = (n) => {
    if (!n) return 0;
    const m = /^([A-G]#?)(-?\d)$/.exec(n);
    return m ? 440 * Math.pow(2, (SEMI[m[1]] + (+m[2] - 4) * 12 - 9) / 12) : 0;
  };

  let AC = null, master = null, musicGain = null, sfxGain = null, noiseBuf = null;
  let on = true, cur = null, timer = null, step = 0, nextT = 0, intensity = 1;

  function boot() {
    if (AC) return true;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = .9; master.connect(AC.destination);
      musicGain = AC.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
      sfxGain = AC.createGain(); sfxGain.gain.value = .9; sfxGain.connect(master);
      const len = AC.sampleRate * .5;
      noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch { return false; }
  }
  const resume = () => { if (AC && AC.state === "suspended") AC.resume(); };

  /* ── 기본 음원 ── */
  function tone(o) {
    if (!on || !boot()) return;
    const t0 = (o.at || AC.currentTime) + (o.delay || 0);
    const osc = AC.createOscillator(), g = AC.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    const v = (o.vol == null ? .18 : o.vol);
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.atk || .006));
    g.gain.exponentialRampToValueAtTime(.0001, t0 + o.dur);
    osc.connect(g); g.connect(o.bus || sfxGain);
    osc.start(t0); osc.stop(t0 + o.dur + .02);
  }
  function noise(o) {
    if (!on || !boot()) return;
    const t0 = (o.at || AC.currentTime) + (o.delay || 0);
    const s = AC.createBufferSource(); s.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = o.filter || "highpass";
    f.frequency.setValueAtTime(o.cut || 1200, t0);
    if (o.cutTo) f.frequency.exponentialRampToValueAtTime(o.cutTo, t0 + o.dur);
    const g = AC.createGain();
    g.gain.setValueAtTime(o.vol == null ? .15 : o.vol, t0);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + o.dur);
    s.connect(f); f.connect(g); g.connect(o.bus || sfxGain);
    s.start(t0); s.stop(t0 + o.dur + .02);
  }
  const seq = (notes, opt) => notes.forEach((n, i) =>
    tone({ f: hz(n[0]), dur: n[2] || .1, delay: n[1], type: (opt && opt.type) || "square",
           vol: (opt && opt.vol) || .18, to: n[3] ? hz(n[3]) : 0 }));

  /* ── 효과음 ── */
  const FX = {
    click:    () => tone({ f: 660, dur: .05, type: "square", vol: .1 }),
    move:     () => tone({ f: 420, dur: .04, type: "triangle", vol: .07 }),
    pick0:    () => seq([["E5",0,.07],["A5",.06,.1]]),
    pick1:    () => seq([["E5",0,.07],["A5",.06,.07],["C6",.12,.13]]),
    pick2:    () => seq([["C5",0,.08],["E5",.07,.08],["G5",.14,.08],["C6",.21,.1],["E6",.28,.22]], { vol:.22 }),
    coin:     () => seq([["B5",0,.06],["E6",.05,.18]], { vol:.2 }),
    treasure: () => { seq([["C5",0,.08],["G5",.08,.08],["C6",.16,.08],["E6",.24,.3]], { vol:.22 });
                      noise({ dur:.4, cut:3000, vol:.08 }); },
    capture:  () => seq([["G4",0,.09],["C5",.09,.16]], { type:"triangle", vol:.18 }),
    portal:   () => { tone({ f: 200, to: 1400, dur: .3, type: "sawtooth", vol: .12 });
                      noise({ dur:.3, cut:600, cutTo:5000, vol:.06 }); },
    dodge:    () => { tone({ f: 900, to: 1800, dur: .16, type: "square", vol: .13 });
                      noise({ dur:.18, cut:2000, vol:.07 }); },
    clash:    () => { tone({ f: 300, to: 1600, dur: .28, type: "sawtooth", vol: .1 });              // 휘익
                      noise({ dur:.32, cut:400, cutTo:6000, vol:.12 });
                      tone({ f: 90, to: 40, dur: .35, type: "square", vol: .22, delay: .28 });      // 쾅
                      noise({ dur:.25, cut:1500, vol:.22, delay:.28 });
                      seq([["C5",.34,.08],["G5",.42,.08],["C6",.5,.3]], { vol:.2 }); },
    roar:     () => { tone({ f: 120, to: 55, dur: .8, type: "sawtooth", vol: .2 }); tone({ f: 124, to: 58, dur: .8, type: "sawtooth", vol: .16, delay:.03 });
                      noise({ dur:.7, cut:200, filter:"lowpass", vol:.24 }); noise({ dur:.5, cut:900, vol:.08, delay:.15 }); },
    duel:     () => { noise({ dur:.22, cut:900, vol:.16 });
                      seq([["C4",0,.1],["G4",.08,.1],["C5",.16,.22]], { vol:.2 }); },
    boss:     () => { seq([["C2",0,.3],["C2",.18,.3],["G#1",.36,.5]], { type:"sawtooth", vol:.24 });
                      noise({ dur:.6, cut:200, filter:"lowpass", vol:.2 }); },
    correct:  () => seq([["E5",0,.08],["G5",.07,.08],["C6",.14,.22]], { vol:.22 }),
    wrong:    () => { tone({ f: 200, to: 90, dur: .3, type: "sawtooth", vol: .18 });
                      noise({ dur:.2, cut:400, filter:"lowpass", vol:.1 }); },
    win:      () => seq([["C5",0,.1],["E5",.09,.1],["G5",.18,.1],["C6",.27,.35]], { vol:.24 }),
    lose:     () => seq([["G4",0,.14],["E4",.13,.14],["C4",.26,.14],["G3",.39,.35]], { type:"triangle", vol:.2 }),
    draw:     () => seq([["D5",0,.12],["D5",.13,.24]], { type:"triangle", vol:.18 }),
    hit:      () => { noise({ dur:.14, cut:800, vol:.2 }); tone({ f: 150, to: 60, dur: .16, type:"square", vol:.14 }); },
    tick:     () => tone({ f: 1000, dur: .04, type: "square", vol: .12 }),
    tickHot:  () => tone({ f: 1400, dur: .05, type: "square", vol: .16 }),
    count:    () => tone({ f: 700, dur: .16, type: "square", vol: .2 }),
    go:       () => seq([["C5",0,.1],["G5",.1,.28]], { vol:.26 }),
    warn:     () => { tone({ f: 420, to: 280, dur: .5, type: "sawtooth", vol: .15 });
                      tone({ f: 419, to: 279, dur: .5, type: "sawtooth", vol: .12, delay:.05 }); },
    zone:     () => { noise({ dur:.35, cut:300, filter:"lowpass", vol:.2 });
                      tone({ f: 160, to: 70, dur: .4, type:"sawtooth", vol:.16 }); },
    join:     () => seq([["G4",0,.07],["C5",.06,.14]], { type:"triangle", vol:.16 }),
    fanfare:  () => seq([["E5",0,.14],["E5",.15,.14],["F5",.3,.14],["G5",.45,.14],
                         ["G5",.6,.14],["F5",.75,.14],["E5",.9,.14],["D5",1.05,.14],
                         ["C5",1.2,.14],["C5",1.35,.14],["D5",1.5,.14],["E5",1.65,.14],
                         ["E5",1.8,.24],["D5",2.06,.1],["D5",2.18,.5]], { vol:.24 }),
  };

  /* ── 배경음악: 저작권이 없는 오래된 찬송가 선율을 8비트로 ──
     각 곡은 [음, 박자] 목록입니다. 4분음표 = 1박. */
  const SONGS = {
    // 나 같은 죄인 살리신 (Amazing Grace, 1779) — 3/4박자, 대기실
    lobby: { bpm: 84, beats: 3, vol: .16, lead: "triangle",
      drums: { kick: [1,0,0,0,0,0,0,0,0,0,0,0], hat: [0,0,0,0,1,0,0,0,1,0,0,0] },
      chords: ["C","C","F","C","C","C","G","G","C","C","F","C","C","C","G","C"],
      mel: [["G4",1],["C5",2],["E5",.5],["C5",.5],["E5",2],["D5",1],["C5",2],["A4",1],["G4",2],["G4",1],
            ["C5",2],["E5",.5],["C5",.5],["E5",2],["D5",1],["G5",3],["E5",1],
            ["G5",2],["E5",.5],["G5",.5],["E5",2],["D5",1],["C5",2],["A4",1],["G4",2],["G4",1],
            ["C5",2],["E5",.5],["C5",.5],["E5",2],["D5",1],["C5",3],[0,3]] },
    // 기뻐하며 경배하세 (Ode to Joy, 1824) — 4/4, 진행 중
    play: { bpm: 132, beats: 4, vol: .18, lead: "square",
      drums: { kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0], hat: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1] },
      chords: ["C","C","C","G","C","C","G","C","G","C","G","C","C","C","C","G","C","C","G","C"],
      mel: [["E4",1],["E4",1],["F4",1],["G4",1],["G4",1],["F4",1],["E4",1],["D4",1],
            ["C4",1],["C4",1],["D4",1],["E4",1],["E4",1.5],["D4",.5],["D4",2],
            ["E4",1],["E4",1],["F4",1],["G4",1],["G4",1],["F4",1],["E4",1],["D4",1],
            ["C4",1],["C4",1],["D4",1],["E4",1],["D4",1.5],["C4",.5],["C4",2],
            ["D4",1],["D4",1],["E4",1],["C4",1],["D4",1],["E4",.5],["F4",.5],["E4",1],["C4",1],
            ["D4",1],["E4",.5],["F4",.5],["E4",1],["D4",1],["C4",1],["D4",1],["G3",2],
            ["E4",1],["E4",1],["F4",1],["G4",1],["G4",1],["F4",1],["E4",1],["D4",1],
            ["C4",1],["C4",1],["D4",1],["E4",1],["D4",1.5],["C4",.5],["C4",2]] },
    // 같은 선율을 단조 반주로 — 대결 중 긴장감
    duel: { bpm: 150, beats: 4, vol: .18, lead: "square",
      drums: { kick: [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0], hat: [1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,1] },
      chords: ["Am","Am","F","G","Am","Am","G","Am","F","G","Am","Am","Am","Am","F","G","Am","Am","G","Am"],
      mel: [["E4",1],["E4",1],["F4",1],["G4",1],["G4",1],["F4",1],["E4",1],["D4",1],
            ["C4",1],["C4",1],["D4",1],["E4",1],["E4",1.5],["D4",.5],["D4",2],
            ["E4",1],["E4",1],["F4",1],["G4",1],["G4",1],["F4",1],["E4",1],["D4",1],
            ["C4",1],["C4",1],["D4",1],["E4",1],["D4",1.5],["C4",.5],["C4",2]] },
    // 내 주는 강한 성이요 (Ein feste Burg, 1529) — 골리앗
    boss: { bpm: 112, beats: 4, vol: .21, lead: "sawtooth",
      drums: { kick: [1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,1], hat: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] },
      chords: ["C","C","F","C","C","C","F","C","G","C","F","G","C","C","F","C"],
      mel: [["C5",1],["C5",1],["C5",1],["G4",1],["A4",1],["A4",1],["G4",2],
            ["F4",1],["E4",1],["D4",1],["E4",1],["D4",1],["C4",3],
            ["C5",1],["C5",1],["C5",1],["G4",1],["A4",1],["A4",1],["G4",2],
            ["F4",1],["E4",1],["D4",1],["E4",1],["D4",1],["C4",3],
            ["G4",1],["G4",1],["A4",1],["G4",1],["F4",1],["E4",1],["D4",2],
            ["G4",1],["G4",1],["A4",1],["G4",1],["F4",1],["E4",1],["D4",2],
            ["C5",1],["B4",1],["A4",1],["G4",1],["F4",1],["E4",1],["D4",1],["C4",3]] },
  };
  const CHORD = { C:["C2","G2","E3"], F:["F2","C3","A3"], G:["G2","D3","B3"], Am:["A2","E3","C4"], Dm:["D2","A2","F3"], Em:["E2","B2","G3"] };

  /* 곡을 16분음표 단위 스텝 배열로 풀어 둡니다 */
  function compile(song) {
    const spbar = song.beats * 4;
    const lead = [];
    song.mel.forEach(([n, d]) => { const st = Math.round(d * 4); lead.push([n, st]); for (let i = 1; i < st; i++) lead.push(null); });
    const bars = Math.ceil(lead.length / spbar);
    while (lead.length < bars * spbar) lead.push(null);
    return { ...song, spbar, lead, total: bars * spbar };
  }
  const T = {};
  for (const k in SONGS) T[k] = compile(SONGS[k]);

  function schedule() {
    if (!cur || !AC) return;
    const tr = T[cur];
    const spb = 60 / (tr.bpm * intensity) / 4;
    while (nextT < AC.currentTime + .14) {
      const s = step % tr.total, inBar = s % tr.spbar, bar = Math.floor(s / tr.spbar);
      const ch = CHORD[tr.chords[bar % tr.chords.length]] || CHORD.C;
      // 베이스: 박마다 근음, 반박에 5음
      if (inBar % 4 === 0) tone({ f: hz(ch[0]), dur: spb * 3.2, type: "triangle", vol: tr.vol * .95, at: nextT, bus: musicGain });
      else if (inBar % 4 === 2) tone({ f: hz(ch[1]), dur: spb * 1.6, type: "triangle", vol: tr.vol * .6, at: nextT, bus: musicGain });
      // 화음 패드: 마디 첫 박
      if (inBar === 0) ch.forEach((n, i) => tone({ f: hz(n) * 2, dur: spb * tr.spbar * .9, type: "sine", vol: tr.vol * .11, at: nextT + i * .01, bus: musicGain }));
      // 선율
      const ld = tr.lead[s];
      if (ld && ld[0]) tone({ f: hz(ld[0]), dur: spb * ld[1] * .92, type: tr.lead === undefined ? "square" : (SONGS[cur].lead || "square"),
                              vol: tr.vol * .36, at: nextT, bus: musicGain, atk: .01 });
      // 드럼
      const dk = tr.drums.kick[inBar % tr.drums.kick.length], ht = tr.drums.hat[inBar % tr.drums.hat.length];
      if (dk) { tone({ f: 140, to: 42, dur: .13, type: "sine", vol: tr.vol * 1.4, at: nextT, bus: musicGain });
                noise({ dur: .05, cut: 110, filter: "lowpass", vol: tr.vol * .6, at: nextT, bus: musicGain }); }
      if (ht) noise({ dur: .03, cut: 7000, vol: tr.vol * .22, at: nextT, bus: musicGain });
      nextT += spb; step++;
      if (step >= tr.total) step = 0;
    }
  }

  /* ── mp3 배경음악 (public/music 폴더에 파일이 있으면 우선 사용) ── */
  let MP3 = null, mp3El = null, mp3Track = null, mp3Fade = null;
  const MP3_VOL = .55;
  fetch("/api/music").then((r) => r.json()).then((m) => { MP3 = m; }).catch(() => { MP3 = {}; });
  function pickMp3(name) { const list = MP3 && MP3[name]; return list && list.length ? list[Math.random() * list.length | 0] : null; }
  function stopMp3(sec) {
    if (!mp3El) return;
    const el = mp3El; mp3El = null; mp3Track = null;
    clearInterval(mp3Fade);
    const step = el.volume / Math.max(1, (sec || .4) * 20);
    const iv = setInterval(() => { el.volume = Math.max(0, el.volume - step); if (el.volume <= 0.01) { clearInterval(iv); el.pause(); el.src = ""; } }, 50);
  }
  function playMp3(name, src) {
    stopMp3(.4);
    const el = new Audio(src);
    el.loop = name !== "victory"; el.volume = 0; el.preload = "auto";
    try { el.preservesPitch = true; el.mozPreservesPitch = true; } catch {}
    el.playbackRate = intensity;
    el.play().catch(() => {});                 // 화면을 아직 안 눌렀으면 조용히 실패 → 다음 호출 때 다시
    mp3El = el; mp3Track = name;
    clearInterval(mp3Fade);
    mp3Fade = setInterval(() => { if (!mp3El) return clearInterval(mp3Fade); mp3El.volume = Math.min(on ? MP3_VOL : 0, mp3El.volume + .04); if (mp3El.volume >= (on ? MP3_VOL : 0)) clearInterval(mp3Fade); }, 50);
    if (name === "victory") el.onended = () => { if (mp3El === el) { mp3El = null; mp3Track = null; } };
  }

  function music(name, opt) {
    if (!boot()) return;
    resume();
    if (name === cur) return;
    cur = name;
    const src = name && pickMp3(name);
    if (src) {                                  // mp3 가 있으면 8비트를 끄고 mp3
      fade(0, .4); clearInterval(timer); timer = null;
      playMp3(name, src); return;
    }
    stopMp3(.4);
    if (!name) { fade(0, .4); clearInterval(timer); timer = null; return; }
    step = 0; nextT = AC.currentTime + .06;
    if (!timer) timer = setInterval(schedule, 30);
    fade(on ? 1 : 0, (opt && opt.fade) || .5);
  }
  /* 팡파레: victory.mp3 가 있으면 그걸, 없으면 8비트 */
  function fanfareMp3() { const src = pickMp3("victory"); if (!src) return false;
    const el = new Audio(src); el.volume = on ? MP3_VOL : 0; el.play().catch(() => {}); return true; }
  function fade(v, sec) {
    if (!musicGain) return;
    const t = AC.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(Math.max(.0001, musicGain.gain.value), t);
    musicGain.gain.linearRampToValueAtTime(v, t + (sec || .4));
  }

  root.SFX = {
    get enabled() { return on; },
    init(){ boot(); resume(); if (mp3El && mp3El.paused) mp3El.play().catch(() => {}); },
    get usingMp3(){ return !!mp3Track; },
    play(n){ if (!on || !boot()) return; resume(); if (n === "fanfare" && fanfareMp3()) return; const f = FX[n]; if (f) f(); },
    music,
    /* 후반부에 음악이 빨라집니다 */
    setIntensity(v){ intensity = Math.max(.9, Math.min(1.35, v || 1)); if (mp3El) mp3El.playbackRate = intensity; },
    toggle(){
      on = !on;
      if (!on) { fade(0, .2); if (mp3El) mp3El.volume = 0; }
      else { boot(); resume(); if (cur && !mp3El) fade(1, .3); if (mp3El) { mp3El.volume = MP3_VOL; mp3El.play().catch(() => {}); } }
      try { localStorage.setItem("bpb_sound", on ? "1" : "0"); } catch {}
      return on;
    },
    restore(){
      try { const v = localStorage.getItem("bpb_sound"); if (v === "0") on = false; } catch {}
      return on;
    },
  };
})(window);

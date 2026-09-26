/* ═══════════ 픽셀 캐릭터 렌더러 (관전 화면 · 폰 공용) ═══════════
   16x16 도트 스프라이트를 코드로 그려서 캐시해 두고 drawImage로 뿌립니다.
   같은 외형은 한 번만 그리므로 60명이 동시에 움직여도 가볍습니다.        */
(function (root) {
  const SKIN   = ["#F2C6A0", "#DDA878", "#BC8452", "#8E5C36", "#6B4327"];
  const HAIR   = ["#241610", "#57351A", "#8C5A2B", "#C9963F", "#EBD79A", "#8A8A97", "#E4E4EC", "#3A2A5E", "#A33B2E", "#4B6A8C"];
  const CLOTH  = ["#C8443A", "#E08A2E", "#E5C64B", "#4FA85C", "#3B8FD1", "#7A5BD6", "#D4649E", "#8A8F9B", "#F0EDE4", "#5B4636", "#2E9E8F", "#B5651D"];
  const ACCENT = ["#FFD75E", "#8DE3C0", "#FF9C8A", "#9ED2FF", "#D9BBFF", "#FFF3C4", "#B8FF9E", "#FFC2E0"];

  const HAIRS = ["단정", "짧은머리", "곱슬", "긴머리", "삭발", "묶은머리"];
  const GEARS = ["없음", "두건", "왕관", "투구", "후드", "월계관"];
  const FITS  = ["튜닉", "겉옷", "갑옷", "망토", "앞치마", "줄무늬"];
  const ITEMS = [   // 지물 = 특성: 늘 붙는 효과(desc) + 궁극기(ult)
    { id: "sling",  name: "물맷돌",   desc: "이동 속도 +12%",                    ult: "다윗의 물맷돌", uicon: "🎯", udesc: "다음 공격에서 맞히면 피해 2배 — 상대 레벨이 높을수록 더 세짐" },
    { id: "shield", name: "방패",     desc: "처음 받는 피해 2번은 절반만",        ult: "믿음의 방패",   uicon: "🛡", udesc: "체력 25% 회복 + 받는 공격 한 번 막기" },
    { id: "scroll", name: "두루마리", desc: "문제 푸는 시간 +4초",               ult: "말씀 선포",     uicon: "📜", udesc: "주변 적 모두에게 문제 — 틀린 사람은 모두 피해" },
    { id: "lamp",   name: "등불",     desc: "문제마다 25% 확률로 오답 하나 삭제", ult: "지혜의 빛",     uicon: "🕯", udesc: "다음 문제 3번 동안 오답 보기 2개 삭제" },
    { id: "staff",  name: "지팡이",   desc: "↯ 회피를 더 자주 (24초마다)",       ult: "홍해 가르기",   uicon: "🌊", udesc: "주변 적을 밀어내고 8초 무적 · 빠른 이동 · 홍수 피해 없음" },
    { id: "harp",   name: "수금",     desc: "체력 자연 회복 2배",                ult: "다윗의 수금",   uicon: "🎵", udesc: "체력 45% 회복 · 팀전이면 주변 팀원 회복 + 쓰러진 팀원 일으키기" },
  ];

  const DARK = "#231A14", EYE = "#2A1A12", BOOT = "#3B2B1E";
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) * f | 0));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) * f | 0));
    const b = Math.max(0, Math.min(255, (n & 255) * f | 0));
    return `rgb(${r},${g},${b})`;
  };

  /* 32x40 캐릭터.  frame: 0 서 있음 · 5 숨쉬기 · 1~4 걷기 4단계
     L.tier(0~5)에 따라 어깨 갑주 → 어깨띠 → 망토 → 후광 → 왕관·왕의 망토가 얹힙니다 */
  const TIER_COL = { steel:"#B8C2D0", steelD:"#6E7A8A", gold:"#FFD166", goldD:"#B8860B", red:"#D6413F", blue:"#3F6BC7", white:"#F4F4F8", halo:"#FFF3C4" };
  function paint(g, L, frame) {
    const skin = SKIN[L.sk % SKIN.length], hair = HAIR[L.hc % HAIR.length];
    const cloth = CLOTH[L.cc % CLOTH.length], acc = ACCENT[L.ac % ACCENT.length];
    const tier = L.tier | 0;
    const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const dk = shade(cloth, .68), lt = shade(cloth, 1.22), dk2 = shade(cloth, .5);
    const skD = shade(skin, .8), skL = shade(skin, 1.08), hairL = shade(hair, 1.3), hairD = shade(hair, .7);

    // 걷기 4단계: 다리·팔 위치, 몸 오르내림
    const walk = frame >= 1 && frame <= 4 ? frame : 0;
    const legL = [0, 3, 0, -3, 0][walk], legR = -legL;           // 앞뒤 (y 오프셋으로 표현)
    const armL = [0, -2, 0, 2, 0][walk], armR = -armL;
    const bob = (walk === 2 || walk === 4) ? 1 : 0;
    const breath = frame === 5 ? 1 : 0;
    const B = 20 + bob + breath;                                   // 몸통 시작 y
    const HY = 5 + bob + breath;                                   // 머리 시작 y

    /* 뒤: 망토 (계급 3 이상 또는 옷이 망토) */
    if (tier >= 5) { P(9, B - 2, 14, 16, TIER_COL.red); P(9, B + 13, 14, 1, "#8E1C2A"); P(10, B - 1, 1, 14, "#F07A78"); P(9, B + 12, 14, 2, TIER_COL.gold); }
    else if (tier === 4) { P(9, B - 2, 14, 15, TIER_COL.white); P(9, B + 12, 14, 1, "#B9BCC8"); P(10, B - 1, 1, 13, "#FFFFFF"); }
    else if (tier === 3) { P(8, B - 1, 16, 12, TIER_COL.blue); P(8, B + 10, 16, 1, "#24427E"); P(9, B, 1, 10, "#7CA0E8"); }
    else if (L.ft === 3) { P(9, B - 1, 14, 13, acc); P(9, B + 11, 14, 1, shade(acc, .7)); P(10, B, 1, 11, shade(acc, 1.2)); }

    /* 다리 · 신발 */
    P(11, 30 + Math.max(0, legL), 4, 6 - Math.max(0, legL), "#3B2B1E");
    P(17, 30 + Math.max(0, legR), 4, 6 - Math.max(0, legR), "#3B2B1E");
    const bootY_L = 36 + (legL < 0 ? -1 : 0), bootY_R = 36 + (legR < 0 ? -1 : 0);
    P(10, bootY_L, 5, 3, BOOT); P(10, bootY_L + 3, 5, 1, "#1E140D");
    P(17, bootY_R, 5, 3, BOOT); P(17, bootY_R + 3, 5, 1, "#1E140D");
    if (legL > 0) P(9, bootY_L, 1, 3, BOOT); if (legR > 0) P(21, bootY_R, 1, 3, BOOT);  // 앞으로 나온 발끝

    /* 몸통 */
    P(11, B, 10, 10, cloth);
    P(11, B, 1, 10, lt); P(20, B, 1, 10, dk);
    P(11, B + 9, 10, 1, dk2);
    P(14, B, 4, 1, skD);                                            // 목선
    if (L.ft === 0) { P(15, B, 2, 10, acc); P(13, B + 6, 6, 1, dk2); P(15, B + 6, 2, 1, tier >= 1 ? TIER_COL.gold : acc); }   // 튜닉+허리띠(버클)
    else if (L.ft === 1) { P(11, B + 4, 10, 1, acc); P(11, B + 10, 10, 3, cloth); P(11, B + 12, 10, 1, dk2); P(12, B, 1, 4, acc); P(19, B, 1, 4, acc); }
    else if (L.ft === 2) { P(11, B, 10, 4, lt); P(11, B + 4, 10, 1, acc); P(13, B + 5, 6, 3, lt); P(15, B + 6, 2, 1, acc); P(11, B + 2, 10, 1, shade(cloth, 1.4)); }
    else if (L.ft === 4) { P(12, B + 1, 8, 8, acc); P(12, B, 1, 1, acc); P(19, B, 1, 1, acc); P(12, B + 8, 8, 1, shade(acc, .7)); P(14, B + 4, 4, 2, shade(acc, .8)); }
    else if (L.ft === 5) { P(11, B + 1, 10, 1, acc); P(11, B + 4, 10, 1, acc); P(11, B + 7, 10, 1, acc); }

    /* 계급 장식: 어깨 갑주 · 어깨띠 */
    if (tier === 1) { P(8, B, 4, 3, TIER_COL.steel); P(8, B + 2, 4, 1, TIER_COL.steelD); P(15, B + 6, 2, 1, TIER_COL.gold); }
    if (tier === 2) { P(8, B, 4, 3, TIER_COL.steel); P(20, B, 4, 3, TIER_COL.steel); P(8, B + 2, 4, 1, TIER_COL.steelD); P(20, B + 2, 4, 1, TIER_COL.steelD);
                      for (let k = 0; k < 8; k++) P(12 + k, B + 1 + k, 2, 1, TIER_COL.red); }
    if (tier >= 3) { P(8, B, 4, 3, TIER_COL.steel); P(20, B, 4, 3, TIER_COL.steel); P(8, B, 4, 1, TIER_COL.gold); P(20, B, 4, 1, TIER_COL.gold);
                     P(8, B + 2, 4, 1, TIER_COL.steelD); P(20, B + 2, 4, 1, TIER_COL.steelD); }
    if (tier >= 5) { P(8, B, 4, 3, TIER_COL.gold); P(20, B, 4, 3, TIER_COL.gold); P(8, B + 2, 4, 1, TIER_COL.goldD); P(20, B + 2, 4, 1, TIER_COL.goldD); }

    /* 팔 · 손 */
    P(8, B + 3 + armL, 3, 5, cloth); P(8, B + 8 + armL, 3, 2, skin); P(8, B + 3 + armL, 1, 5, lt);
    P(21, B + 3 + armR, 3, 5, cloth); P(21, B + 8 + armR, 3, 2, skin); P(23, B + 3 + armR, 1, 5, dk);

    /* 목 · 머리 */
    P(14, HY + 14, 4, 2, skD);
    P(9, HY, 14, 14, skin);
    P(9, HY, 1, 14, skL); P(22, HY, 1, 14, skD);
    P(9, HY + 13, 14, 1, skD); P(10, HY + 13, 12, 1, shade(skin, .9));
    P(11, HY + 12, 10, 1, shade(skin, .94));
    // 눈 (흰자 3x3, 눈동자 2x2, 반짝 1)
    P(11, HY + 6, 3, 3, "#FFFFFF"); P(18, HY + 6, 3, 3, "#FFFFFF");
    P(12, HY + 7, 2, 2, EYE); P(19, HY + 7, 2, 2, EYE);
    P(12, HY + 7, 1, 1, "#6A5040"); P(19, HY + 7, 1, 1, "#6A5040");
    P(11, HY + 5, 3, 1, hairD); P(18, HY + 5, 3, 1, hairD);           // 눈썹
    P(15, HY + 9, 2, 2, skD); P(15, HY + 10, 1, 1, shade(skin, .7));  // 코
    P(13, HY + 11, 6, 1, shade(skin, .66)); P(14, HY + 12, 4, 1, shade(skin, .8)); // 입
    P(10, HY + 9, 1, 2, shade(skin, .9)); P(21, HY + 9, 1, 2, shade(skin, .9));     // 홍조

    /* 머리카락 */
    const y = HY;
    if (L.hs === 0) { P(9, y - 3, 14, 4, hair); P(9, y + 1, 1, 4, hair); P(22, y + 1, 1, 4, hair); P(11, y - 2, 5, 1, hairL); P(9, y + 4, 1, 1, hairD); }
    else if (L.hs === 1) { P(9, y - 3, 14, 4, hair); P(9, y + 1, 1, 2, hair); P(11, y - 2, 4, 1, hairL); }
    else if (L.hs === 2) { P(8, y - 4, 16, 5, hair); P(8, y + 1, 1, 4, hair); P(23, y + 1, 1, 4, hair); P(10, y - 3, 2, 1, hairL); P(15, y - 4, 2, 1, hairL); P(20, y - 3, 2, 1, hairL); P(8, y - 2, 1, 1, hairD); }
    else if (L.hs === 3) { P(9, y - 3, 14, 4, hair); P(8, y + 1, 1, 14, hair); P(23, y + 1, 1, 14, hair); P(8, y + 14, 2, 1, hairD); P(22, y + 14, 2, 1, hairD); P(11, y - 2, 5, 1, hairL); }
    else if (L.hs === 4) { P(9, y - 1, 14, 1, shade(skin, .93)); P(11, y, 4, 1, skL); }
    else { P(9, y - 3, 14, 4, hair); P(9, y + 1, 1, 2, hair); P(23, y + 1, 2, 9, hair); P(23, y + 10, 3, 2, hairD); P(11, y - 2, 4, 1, hairL); }

    /* 머리쓰개 (왕은 왕관 강제) */
    const gr = tier >= 5 && L.gr === 0 ? 2 : L.gr;
    if (gr === 1) { P(9, y - 3, 14, 4, acc); P(22, y + 1, 2, 8, acc); P(22, y + 8, 2, 2, shade(acc, .75)); P(9, y + 1, 1, 1, acc); P(11, y - 2, 6, 1, shade(acc, 1.25)); }
    else if (gr === 2) { P(9, y - 5, 14, 3, TIER_COL.gold); P(9, y - 6, 2, 1, TIER_COL.gold); P(15, y - 7, 2, 2, TIER_COL.gold); P(21, y - 6, 2, 1, TIER_COL.gold);
                         P(15, y - 4, 2, 1, TIER_COL.red); P(11, y - 4, 1, 1, "#2FA4FF"); P(20, y - 4, 1, 1, "#2FA4FF"); P(10, y - 5, 12, 1, TIER_COL.halo); }
    else if (gr === 3) { P(9, y - 4, 14, 5, "#A6AEBB"); P(9, y + 1, 2, 7, "#A6AEBB"); P(21, y + 1, 2, 7, "#A6AEBB"); P(14, y - 4, 4, 11, "#D2D9E3"); P(15, y - 5, 2, 1, TIER_COL.red); P(9, y - 4, 14, 1, "#C7CEDA"); }
    else if (gr === 4) { P(8, y - 4, 16, 5, dk); P(8, y + 1, 1, 10, dk); P(23, y + 1, 1, 10, dk); P(9, y - 4, 14, 1, shade(dk, 1.3)); }
    else if (gr === 5) { P(8, y, 1, 4, "#3DD68C"); P(23, y, 1, 4, "#3DD68C"); P(9, y - 4, 4, 1, "#3DD68C"); P(19, y - 4, 4, 1, "#3DD68C"); P(13, y - 5, 2, 1, "#3DD68C"); P(17, y - 5, 2, 1, "#3DD68C"); P(10, y - 3, 1, 1, "#7CEDB4"); P(21, y - 3, 1, 1, "#7CEDB4"); }

    /* 사사: 머리 위 후광 */
    if (tier === 4) { P(11, y - 6, 10, 1, TIER_COL.halo); P(10, y - 5, 1, 1, TIER_COL.halo); P(21, y - 5, 1, 1, TIER_COL.halo); P(13, y - 7, 6, 1, "#FFFFFF"); }

    /* 손에 든 물건 */
    const hx = 24, hy = B + 3 + armR;
    const it = ITEMS[L.it % ITEMS.length].id;
    if (it === "sling") { P(hx, hy - 3, 1, 9, "#8C6239"); P(hx + 1, hy - 4, 1, 2, "#8C6239"); P(hx - 1, hy + 6, 5, 3, "#8892A0"); P(hx, hy + 6, 3, 1, "#C4CCD6"); }
    else if (it === "shield") { P(hx - 1, hy - 2, 7, 11, "#8C3A1F"); P(hx, hy - 1, 5, 9, "#B9552F"); P(hx + 2, hy, 1, 7, "#E0C36B"); P(hx, hy + 2, 5, 1, "#E0C36B"); P(hx, hy - 1, 5, 1, "#D9784A"); }
    else if (it === "scroll") { P(hx - 1, hy, 7, 8, "#EFE3C4"); P(hx - 1, hy - 1, 7, 1, "#B08A50"); P(hx - 1, hy + 8, 7, 1, "#B08A50"); P(hx, hy + 1, 5, 1, "#B08A50"); P(hx, hy + 3, 4, 1, "#B08A50"); P(hx, hy + 5, 5, 1, "#B08A50"); }
    else if (it === "lamp") { P(hx, hy + 3, 5, 5, "#C98B3A"); P(hx + 1, hy + 8, 3, 1, "#8C6239"); P(hx + 1, hy - 1, 3, 4, "#FFD166"); P(hx + 1, hy - 2, 3, 1, "#FFF3C4"); P(hx, hy + 2, 5, 1, "#FFF0B8"); P(hx + 1, hy + 4, 3, 3, "#FFF0B8"); }
    else if (it === "staff") { P(hx + 1, hy - 7, 2, 16, "#8C6239"); P(hx, hy - 9, 4, 2, "#8C6239"); P(hx + 1, hy - 10, 2, 1, "#FFD166"); P(hx + 1, hy - 7, 1, 16, "#A97B4C"); }
    else { P(hx, hy - 1, 1, 10, "#C98B3A"); P(hx + 4, hy, 1, 9, "#C98B3A"); P(hx, hy - 1, 5, 1, "#E0C36B"); P(hx + 1, hy + 1, 1, 7, "#FFF0B8"); P(hx + 2, hy + 2, 1, 6, "#FFF0B8"); P(hx + 3, hy + 3, 1, 5, "#FFF0B8"); }
  }

  /* 스프라이트 캐시 — 1배 크기로 한 번만 그리고(테두리 포함), 화면에는 정수 배율로만 확대합니다.
     소수 배율(1.35배, 2.7배…)로 늘리면 픽셀 크기가 들쭉날쭉해져 흐려 보이기 때문입니다. */
  const BW = 38, BH = 46, OX = 3, OY = 4;        // 기본 그림 크기와 여백 (왕관·후광·테두리가 잘리지 않게)
  const AX = 19, AY = 44;                         // 발밑 기준점 (논리 좌표 x16, y40)
  const baseCache = new Map();
  const key = (L, f, flip) => `${L.sk}_${L.hs}_${L.hc}_${L.ft}_${L.cc}_${L.gr}_${L.ac}_${L.it}_${L.tier|0}_${f}_${flip ? 1 : 0}`;
  function base(L, frame, flip) {
    const k = key(L, frame, flip);
    let c = baseCache.get(k);
    if (c) { baseCache.delete(k); baseCache.set(k, c); return c; }      // 최근 사용 순서 갱신
    c = document.createElement("canvas");
    c.width = BW; c.height = BH;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.save();
    if (flip) { g.translate(BW, 0); g.scale(-1, 1); }
    g.translate(OX, OY);
    paint(g, L, frame);
    g.restore();
    outline(g, BW, BH, 1);
    baseCache.set(k, c);
    if (baseCache.size > 1600) baseCache.delete(baseCache.keys().next().value);
    return c;
  }
  /* 예전 호출 호환용 — 정수 배율 S로 키운 캔버스 */
  const bigCache = new Map();
  function sprite(L, frame, flip, S) {
    S = Math.max(1, Math.round(S || 3));
    const k = key(L, frame, flip) + "_" + S;
    if (bigCache.has(k)) return bigCache.get(k);
    const c = document.createElement("canvas");
    c.width = BW * S; c.height = BH * S;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(base(L, frame, flip), 0, 0, BW * S, BH * S);
    if (bigCache.size > 120) bigCache.clear();
    bigCache.set(k, c);
    return c;
  }
  /* 현재 캔버스 변환에서 '기기 픽셀 배율'을 읽습니다 (폰의 화면 배율·관전 화면 확대 포함) */
  function devScale(ctx) {
    const m = ctx.getTransform ? ctx.getTransform() : null;
    if (!m || typeof m.a !== "number" || !isFinite(m.a) || !isFinite(m.e) || m.b || m.c || m.a <= 0 || m.d <= 0) return null;   // 회전·뒤집기면 예전 방식으로
    return m;
  }
  /* 1배 그림 img 를 기준점(ax, ay)이 화면의 (px, py)에 오도록, 기기 픽셀 기준 정수 배율로 찍습니다.
     unit = 논리 크기(캐릭터는 키 40), size = 원하는 화면 크기 */
  function blit(ctx, img, px, py, size, unit, ax, ay, tol) {
    const m = devScale(ctx);
    const ideal = m ? size * Math.abs(m.a) / unit : size / unit;
    ctx.save();
    if (m && ideal >= .75) {
      let P = Math.max(1, Math.round(ideal));
      if (tol != null && Math.abs(P - ideal) > ideal * tol) P = ideal;   // 정수로 맞추면 크기가 너무 달라질 땐 원래 크기로
      const dx = Math.round(m.a * px + m.e - ax * P), dy = Math.round(m.d * py + m.f - ay * P);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, dx, dy, Math.round(img.width * P), Math.round(img.height * P));
    } else {
      const k = size / unit;
      ctx.imageSmoothingEnabled = ideal < 1;           // 아주 작게 줄일 때만 부드럽게 (변환을 못 읽는 옛 브라우저는 도트 그대로)
      if (ideal < 1) { try { ctx.imageSmoothingQuality = "high"; } catch (e) {} }
      ctx.drawImage(img, px - ax * k, py - ay * k, img.width * k, img.height * k);
    }
    ctx.restore();
  }
  /* 도트 주위에 어두운 테두리를 둘러 배경과 분리 */
  function outline(g, w, h, S) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const has = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) has[i] = d[i * 4 + 3] > 8 ? 1 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (has[i]) continue;
      let edge = false;
      for (let dy = -S; dy <= S && !edge; dy += S)
        for (let dx = -S; dx <= S && !edge; dx += S) {
          if ((dx === 0) === (dy === 0)) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (has[ny * w + nx]) edge = true;
        }
      if (edge) { const o = i * 4; d[o] = 20; d[o+1] = 14; d[o+2] = 28; d[o+3] = 230; }
    }
    g.putImageData(img, 0, 0);
  }


  /* ═══════ 지형 그리기 (관전 화면 · 폰 공용) ═══════
     이웃 칸을 살펴 물가·바위 테두리를 그려서 무엇인지 한눈에 보이게 합니다. */
  const SOLID_T = new Set([3, 4]);
  function drawMap(m) {
    const S = m.TS, W = m.TW, H = m.TH, t = m.t;
    const c = document.createElement("canvas");
    c.width = m.W; c.height = m.H;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 3 : t[y * W + x];
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    // 칸마다 항상 같은 무늬가 나오도록 하는 고정 난수
    const rn = (x, y, n) => { let h2 = (x * 374761393 + y * 668265263 + n * 2246822519) >>> 0;
      h2 = (h2 ^ (h2 >> 13)) * 1274126177 >>> 0; return ((h2 ^ (h2 >> 16)) >>> 0) / 4294967296; };

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = at(x, y), px = x * S, py = y * S;
      const a1 = rn(x, y, 1), a2 = rn(x, y, 2), a3 = rn(x, y, 3), a4 = rn(x, y, 4);

      if (v === 4) {                                   /* ── 물 ── */
        R(px, py, S, S, "#235F92");                  // 이음매 없이 통으로
        for (let k = 0; k < 4; k++) {                  // 잔물결
          const wy = py + 4 + k * 9 + ((a1 * 5) | 0);
          const wx = px + 3 + (((k * 7 + a2 * 11) | 0) % 12);
          R(wx, wy, 11 + ((k % 2) * 4), 2, "#4E9AD4");
          R(wx + 4, wy + 3, 6, 1, "#8ACBF2");
        }
        if (a3 > .6) { R(px + 26, py + 8, 3, 2, "#B7E4FF"); R(px + 24, py + 12, 5, 2, "#B7E4FF"); }

      } else if (v === 3) {                            /* ── 바위 ── */
        R(px, py, S, S, "#2B323C");
        R(px + 2, py + 2, S - 4, S - 3, "#69737F");
        R(px + 4, py + 2, S - 8, 3, "#2B323C");        // 모서리 깎기
        R(px + 4, py + S - 2, S - 8, 2, "#2B323C");
        R(px + 2, py + 5, 2, S - 9, "#2B323C");
        R(px + S - 4, py + 5, 2, S - 9, "#2B323C");
        R(px + 5, py + 4, S - 10, 6, "#A7B2C0");       // 윗면 빛
        R(px + 5, py + 10, S - 10, 2, "#8792A0");
        R(px + 5, py + S - 11, S - 10, 6, "#3F4855");  // 아랫면 그늘
        R(px + 8, py + 6, 7, 3, "#CBD5E1");            // 반짝임
        // 갈라진 틈 — 대각선 짧은 금
        if (a1 > .35) { const cx0 = px + 8 + ((a1 * 12) | 0);
          for (let k = 0; k < 5; k++) R(cx0 + k, py + 12 + k * 2, 2, 2, "#39424E"); }
        if (a2 > .6) { R(px + S - 16, py + 15, 7, 2, "#4C5663"); R(px + S - 11, py + 17, 3, 5, "#4C5663"); }
        if (a3 > .5 && at(x, y - 1) !== 3) {           // 위쪽에 이끼
          R(px + 6, py + 3, 6, 3, "#4E7A3E"); R(px + S - 14, py + 4, 5, 2, "#5C8C48");
        }

      } else if (v === 6) {                            /* ── 수렁 ── */
        R(px, py, S, S, "#5B4B2E");
        R(px, py, S, S, "#7E6A3D");
        for (let k = 0; k < 5; k++) {
          const bx = px + 4 + (((k * 11 + a1 * 13) | 0) % (S - 12));
          const by = py + 5 + (((k * 9 + a2 * 15) | 0) % (S - 13));
          R(bx, by, 5, 4, "#5B4B2E"); R(bx + 1, by + 1, 3, 2, "#6B5A38");
        }
        R(px + 9, py + 21, 8, 3, "#A79059"); R(px + 20, py + 12, 5, 2, "#A79059");

      } else if (v === 7) {                            /* ── 포탈 ── */
        R(px, py, S, S, "#1D1533");
        R(px + 2, py + 2, S - 4, S - 4, "#3A2C63");
        R(px + 5, py + 5, S - 10, S - 10, "#5C46A8");
        R(px + 8, py + 8, S - 16, S - 16, "#8A6BE0");
        R(px + 12, py + 12, S - 24, S - 24, "#E2D6FF");
        R(px + 8, py + 8, S - 16, 3, "#C9B6FF");
        R(px + 8, py + S - 11, S - 16, 3, "#C9B6FF");
        R(px + 8, py + 11, 3, S - 22, "#C9B6FF");
        R(px + S - 11, py + 11, 3, S - 22, "#C9B6FF");

      } else if (v === 2) {                            /* ── 돌길: 흙바닥에 납작한 돌들 ── */
        R(px, py, S, S, "#8A7A5C");
        R(px, py, S, S, "rgba(0,0,0,0)");
        const stones = [[2,3,15,11],[19,2,19,12],[3,16,11,10],[16,17,12,9],[30,16,8,10],[5,28,17,9],[24,28,14,9]];
        stones.forEach(([sx, sy, sw, sh], k) => {
          const jx = (rn(x, y, 10 + k) * 3 | 0) - 1, jy = (rn(x, y, 20 + k) * 3 | 0) - 1;
          const ox = px + sx + jx, oy = py + sy + jy;
          const tone = 0.9 + rn(x, y, 30 + k) * .25;
          const base = `rgb(${(150*tone)|0},${(146*tone)|0},${(138*tone)|0})`;
          R(ox, oy, sw, sh, "#4E4638");                // 돌 그림자
          R(ox, oy, sw, sh - 2, base);
          R(ox + 1, oy, sw - 2, 2, "#BDB8AC");         // 윗면 빛
          R(ox, oy, 1, 1, "#4E4638"); R(ox + sw - 1, oy, 1, 1, "#4E4638");
        });
        if (a3 > .75) R(px + 12, py + 14, 3, 2, "#5C7A3E");   // 돌 틈 이끼

      } else if (v === 5) {                            /* ── 수풀 ── */
        R(px, py, S, S, "#3E7440");
        R(px + 7, py + S - 9, S - 14, 5, "#24422A");   // 그림자
        R(px + 5, py + 9, S - 10, S - 17, "#2F5B33");
        R(px + 8, py + 5, S - 16, 9, "#4C8A4E");
        R(px + 4, py + 13, 6, 8, "#3C7040");
        R(px + S - 10, py + 12, 6, 9, "#3C7040");
        R(px + 12, py + 8, 6, 4, "#6BAE6C");
        R(px + 19, py + 14, 4, 3, "#6BAE6C");
        if (a1 > .55) { R(px + 14, py + 17, 4, 4, "#E2574C"); R(px + 15, py + 18, 2, 2, "#FF8C7A"); }

      } else if (v === 0) {                            /* ── 모래 ── */
        R(px, py, S, S, "#DCCB9F");
        R(px + ((a1 * 12) | 0), py + ((a1 * 8) | 0) + 5, 20 + ((a2 * 12) | 0), 3, "#D0BE8F");
        R(px + ((a2 * 16) | 0), py + ((a2 * 9) | 0) + 21, 14 + ((a1 * 14) | 0), 2, "#D0BE8F");
        for (let k = 0; k < 6; k++)
          R(px + (((k * 13 + a1 * 17) | 0) % (S - 4)), py + (((k * 19 + a2 * 11) | 0) % (S - 4)), 2, 2, "#C0AE7E");
        if (a3 > .7) { R(px + 21, py + 13, 7, 5, "#B0A078"); R(px + 21, py + 13, 7, 2, "#CDBE96");
                       R(px + 21, py + 18, 7, 1, "#8E8060"); }
        if (a4 > .85) { R(px + 8, py + 24, 5, 3, "#B0A078"); }

      } else {                                         /* ── 풀밭 ── */
        R(px, py, S, S, "#4B8946");
        for (let k = 0; k < 6; k++) {
          const gx = px + (((k * 11 + a1 * 19) | 0) % (S - 5));
          const gy = py + (((k * 17 + a2 * 13) | 0) % (S - 8));
          R(gx, gy + 1, 2, 6, "#3B6E3D");
          R(gx + 2, gy + 3, 2, 4, "#63AA5D");
          R(gx + 1, gy - 1, 1, 3, "#74BE6B");
        }
        if (a3 > .82) {                                 // 들꽃
          const fx = px + 12 + ((a1 * 12) | 0), fy = py + 14 + ((a2 * 10) | 0);
          R(fx, fy + 3, 1, 4, "#3B6E3D");
          const col = a4 > .5 ? "#FFD166" : "#FF8FC7";
          R(fx - 1, fy, 3, 3, col); R(fx, fy + 1, 1, 1, "#FFF3C4");
        } else if (a3 < .07) {                          // 작은 돌
          R(px + 20, py + 20, 5, 4, "#8A8F96"); R(px + 20, py + 20, 5, 2, "#A6ACB4");
        }
      }

      /* ── 칸 사이 자연스러운 연결 ── */
      if (v === 4) {                                   // 물가 거품
        if (at(x, y - 1) !== 4) { R(px, py, S, 3, "#CDEBFF"); R(px, py + 3, S, 2, "#8FC9F0"); }
        if (at(x, y + 1) !== 4) R(px, py + S - 3, S, 3, "#7EC0EE");
        if (at(x - 1, y) !== 4) R(px, py, 3, S, "#9CD0F5");
        if (at(x + 1, y) !== 4) R(px + S - 3, py, 3, S, "#9CD0F5");
        // 물가 갈대
        if (at(x, y - 1) === 1 || at(x, y - 1) === 0) {
          R(px + 6, py - 9, 2, 10, "#3E7440"); R(px + 5, py - 12, 4, 4, "#8A7444");
          R(px + 24, py - 7, 2, 8, "#3E7440"); R(px + 23, py - 10, 4, 4, "#8A7444");
        }
      }
      if (v === 1 && at(x, y + 1) === 0) {             // 풀→모래 경계
        for (let k = 0; k < S; k += 4) R(px + k, py + S - 3, 3, 3, "#DCCB9F");
      }
      if (v === 0 && at(x, y - 1) === 1) {
        for (let k = 2; k < S; k += 5) R(px + k, py, 3, 2, "#4B8946");
      }
      if (v !== 3 && at(x, y - 1) === 3) {             // 바위 그림자
        g.globalAlpha = .34; R(px, py, S, 6, "#0A0713"); g.globalAlpha = 1;
      }
    }

    /* 바위 덩어리 외곽선 */
    g.strokeStyle = "rgba(10,7,19,.6)"; g.lineWidth = 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (at(x, y) !== 3) continue;
      g.beginPath();
      if (at(x, y - 1) !== 3) { g.moveTo(x*S, y*S+1); g.lineTo(x*S+S, y*S+1); }
      if (at(x, y + 1) !== 3) { g.moveTo(x*S, y*S+S-1); g.lineTo(x*S+S, y*S+S-1); }
      if (at(x - 1, y) !== 3) { g.moveTo(x*S+1, y*S); g.lineTo(x*S+1, y*S+S); }
      if (at(x + 1, y) !== 3) { g.moveTo(x*S+S-1, y*S); g.lineTo(x*S+S-1, y*S+S); }
      g.stroke();
    }
    return c;
  }


  /* ═══════ 보물상자 ═══════
     tier 0 나무 · 1 금테 · 2 보라 전설 · 3 황금(숨겨진 보물)   open 0~1 = 뚜껑 열림 */
  const CHEST = [
    { body:"#8C5A2B", side:"#5E3A16", lid:"#A56B34", lidL:"#C98B4C", band:"#3A2412", lock:"#FFD166" },
    { body:"#8C5A2B", side:"#5E3A16", lid:"#D9A73C", lidL:"#FFD97A", band:"#7A5210", lock:"#FFF3C4" },
    { body:"#4B2E7A", side:"#2E1A4E", lid:"#8A5CE0", lidL:"#C9A9FF", band:"#2E1A4E", lock:"#FF7BD5" },
    { body:"#B8860B", side:"#7A5800", lid:"#FFD166", lidL:"#FFF3C4", band:"#8A6400", lock:"#FFFFFF" },
  ];
  const chestCache = new Map();
  function chestBase(tier, step) {                   // step = 열림 단계 0~6
    const ck = tier + "_" + step;
    let cv = chestCache.get(ck);
    if (cv) return cv;
    const C = CHEST[tier] || CHEST[0], o = step / 6;
    cv = document.createElement("canvas"); cv.width = 20; cv.height = 20;   // 16칸 + 여백 (뚜껑이 위로 열림)
    const g = cv.getContext("2d");
    const P = (px, py, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(2 + px), Math.round(4 + py), Math.ceil(w), Math.ceil(h)); };
    // 몸통
    P(2, 8, 12, 7, C.body); P(2, 8, 12, 7, "rgba(0,0,0,0)");
    P(2, 8, 1, 7, C.side); P(13, 8, 1, 7, C.side); P(2, 14, 12, 1, C.side);
    P(4, 8, 1, 7, C.band); P(11, 8, 1, 7, C.band);
    if (o > 0) { P(3, 8, 10, 2, "#1A1200"); P(5, 9, 6, 1, C.lock === "#FFFFFF" ? "#FFD166" : "#FFD166"); }  // 열리면 안에 반짝
    // 뚜껑 (열릴수록 위로·뒤로 젖혀짐)
    const lift = o * 6, tilt = o * 3;
    P(2, 4 - lift, 12, 4 - tilt, C.lid); P(2, 4 - lift, 12, 1, C.lidL);
    P(2, 4 - lift, 1, 4 - tilt, C.side); P(13, 4 - lift, 1, 4 - tilt, C.side);
    P(4, 4 - lift, 1, 4 - tilt, C.band); P(11, 4 - lift, 1, 4 - tilt, C.band);
    // 자물쇠
    P(7, 7 - lift * .5, 2, 2, C.lock); P(7, 9, 2, 1, "#1A1200");
    chestCache.set(ck, cv);
    return cv;
  }
  function drawChest(ctx, x, y, size, tier, open) {
    const S = size / 16, o = Math.max(0, Math.min(1, open || 0));
    // 그림자
    ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.beginPath(); ctx.ellipse(x, y + 3 * S, 9 * S, 3 * S, 0, 0, 7); ctx.fill();
    // 상자 (한 장짜리 그림을 기기 픽셀에 맞춰 찍어서 이음매·번짐 없음)
    blit(ctx, chestBase(tier, Math.round(o * 6)), x, y, size, 16, 10, 16, .15);
    // 빛 (열렸을 때)
    if (o > 0) { ctx.globalAlpha = o * .8; ctx.fillStyle = "#FFF3C4";
      for (let k = 0; k < 5; k++) { const a = -1.6 + k * .55, r = 9 * S + o * 10 * S;
        ctx.fillRect(x + Math.cos(a) * r - S, y - 2 * S + Math.sin(a) * r - S, 2 * S, 2 * S); }
      ctx.globalAlpha = 1; }
  }



  /* ═══════ 타일셋: 종류별 4가지 변형을 미리 그려 두고, 보이는 칸만 찍습니다 (큰 맵용) ═══════ */
  const _tilesets = {};
  function tileset(S) {
    if (_tilesets[S]) return _tilesets[S];
    const set = {};
    const rn = (x, y, n) => { let h2 = (x * 374761393 + y * 668265263 + n * 2246822519) >>> 0;
      h2 = (h2 ^ (h2 >> 13)) * 1274126177 >>> 0; return ((h2 ^ (h2 >> 16)) >>> 0) / 4294967296; };
    for (let v = 0; v <= 7; v++) {
      set[v] = [];
      for (let k = 0; k < 4; k++) {
        const c = document.createElement("canvas"); c.width = S; c.height = S;
        const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
        const m = { TS: S, TW: 1, TH: 1, W: S, H: S, t: new Uint8Array([v]) };
        paintTile(g, m, 0, 0, v, k * 7 + 3, k * 11 + 5, () => 9);   // 이웃은 '없음' 취급
        set[v].push(c);
      }
    }
    _tilesets[S] = set;
    return set;
  }
  /* 한 칸 그리기 (drawMap 과 drawTiles 가 공유) */
  function paintTile(g, m, x, y, v, hx, hy, at) {
    const S = m.TS, px = x * S, py = y * S;
    const rn = (a, b, n) => { let h2 = (a * 374761393 + b * 668265263 + n * 2246822519) >>> 0;
      h2 = (h2 ^ (h2 >> 13)) * 1274126177 >>> 0; return ((h2 ^ (h2 >> 16)) >>> 0) / 4294967296; };
    const R = (qx, qy, w, h, col) => { g.fillStyle = col; g.fillRect(qx, qy, w, h); };
    const a1 = rn(hx, hy, 1), a2 = rn(hx, hy, 2), a3 = rn(hx, hy, 3), a4 = rn(hx, hy, 4);
    if (v === 4) {
      R(px, py, S, S, "#235F92");
      for (let k = 0; k < 4; k++) { const wy = py + 4 + k * 9 + ((a1 * 5) | 0); const wx = px + 3 + (((k * 7 + a2 * 11) | 0) % 12);
        R(wx, wy, 11 + ((k % 2) * 4), 2, "#4E9AD4"); R(wx + 4, wy + 3, 6, 1, "#8ACBF2"); }
      if (a3 > .6) { R(px + 26, py + 8, 3, 2, "#B7E4FF"); R(px + 24, py + 12, 5, 2, "#B7E4FF"); }
    } else if (v === 3) {
      R(px, py, S, S, "#2B323C"); R(px + 2, py + 2, S - 4, S - 3, "#69737F");
      R(px + 4, py + 2, S - 8, 3, "#2B323C"); R(px + 4, py + S - 2, S - 8, 2, "#2B323C"); R(px + 2, py + 5, 2, S - 9, "#2B323C"); R(px + S - 4, py + 5, 2, S - 9, "#2B323C");
      R(px + 5, py + 4, S - 10, 6, "#A7B2C0"); R(px + 5, py + 10, S - 10, 2, "#8792A0"); R(px + 5, py + S - 11, S - 10, 6, "#3F4855"); R(px + 8, py + 6, 7, 3, "#CBD5E1");
      if (a1 > .35) { const cx0 = px + 8 + ((a1 * 12) | 0); for (let k = 0; k < 5; k++) R(cx0 + k, py + 12 + k * 2, 2, 2, "#39424E"); }
      if (a2 > .6) { R(px + S - 16, py + 15, 7, 2, "#4C5663"); R(px + S - 11, py + 17, 3, 5, "#4C5663"); }
      if (a3 > .5) { R(px + 6, py + 3, 6, 3, "#4E7A3E"); R(px + S - 14, py + 4, 5, 2, "#5C8C48"); }
    } else if (v === 6) {
      R(px, py, S, S, "#7E6A3D");
      for (let k = 0; k < 5; k++) { const bx = px + 4 + (((k * 11 + a1 * 13) | 0) % (S - 12)); const by = py + 5 + (((k * 9 + a2 * 15) | 0) % (S - 13));
        R(bx, by, 5, 4, "#5B4B2E"); R(bx + 1, by + 1, 3, 2, "#6B5A38"); }
      R(px + 9, py + 21, 8, 3, "#A79059"); R(px + 20, py + 12, 5, 2, "#A79059");
    } else if (v === 7) {
      R(px, py, S, S, "#1D1533"); R(px + 2, py + 2, S - 4, S - 4, "#3A2C63"); R(px + 5, py + 5, S - 10, S - 10, "#5C46A8"); R(px + 8, py + 8, S - 16, S - 16, "#8A6BE0");
      R(px + 12, py + 12, S - 24, S - 24, "#E2D6FF"); R(px + 8, py + 8, S - 16, 3, "#C9B6FF"); R(px + 8, py + S - 11, S - 16, 3, "#C9B6FF"); R(px + 8, py + 11, 3, S - 22, "#C9B6FF"); R(px + S - 11, py + 11, 3, S - 22, "#C9B6FF");
    } else if (v === 2) {
      R(px, py, S, S, "#8A7A5C");
      const stones = [[2,3,15,11],[19,2,19,12],[3,16,11,10],[16,17,12,9],[30,16,8,10],[5,28,17,9],[24,28,14,9]];
      stones.forEach(([sx, sy, sw, sh], k) => { const jx = (rn(hx, hy, 10 + k) * 3 | 0) - 1, jy = (rn(hx, hy, 20 + k) * 3 | 0) - 1;
        const ox = px + sx + jx, oy = py + sy + jy; const tone = 0.9 + rn(hx, hy, 30 + k) * .25;
        const base = `rgb(${(150*tone)|0},${(146*tone)|0},${(138*tone)|0})`;
        R(ox, oy, sw, sh, "#4E4638"); R(ox, oy, sw, sh - 2, base); R(ox + 1, oy, sw - 2, 2, "#BDB8AC"); R(ox, oy, 1, 1, "#4E4638"); R(ox + sw - 1, oy, 1, 1, "#4E4638"); });
      if (a3 > .75) R(px + 12, py + 14, 3, 2, "#5C7A3E");
    } else if (v === 5) {
      R(px, py, S, S, "#3E7440"); R(px + 7, py + S - 9, S - 14, 5, "#24422A"); R(px + 5, py + 9, S - 10, S - 17, "#2F5B33"); R(px + 8, py + 5, S - 16, 9, "#4C8A4E");
      R(px + 4, py + 13, 6, 8, "#3C7040"); R(px + S - 10, py + 12, 6, 9, "#3C7040"); R(px + 12, py + 8, 6, 4, "#6BAE6C"); R(px + 19, py + 14, 4, 3, "#6BAE6C");
      if (a1 > .55) { R(px + 14, py + 17, 4, 4, "#E2574C"); R(px + 15, py + 18, 2, 2, "#FF8C7A"); }
    } else if (v === 0) {
      R(px, py, S, S, "#DCCB9F");
      R(px + ((a1 * 12) | 0), py + ((a1 * 8) | 0) + 5, 20 + ((a2 * 12) | 0), 3, "#D0BE8F"); R(px + ((a2 * 16) | 0), py + ((a2 * 9) | 0) + 21, 14 + ((a1 * 14) | 0), 2, "#D0BE8F");
      for (let k = 0; k < 6; k++) R(px + (((k * 13 + a1 * 17) | 0) % (S - 4)), py + (((k * 19 + a2 * 11) | 0) % (S - 4)), 2, 2, "#C0AE7E");
      if (a3 > .7) { R(px + 21, py + 13, 7, 5, "#B0A078"); R(px + 21, py + 13, 7, 2, "#CDBE96"); R(px + 21, py + 18, 7, 1, "#8E8060"); }
      if (a4 > .85) R(px + 8, py + 24, 5, 3, "#B0A078");
    } else {
      R(px, py, S, S, "#4B8946");
      for (let k = 0; k < 6; k++) { const gx = px + (((k * 11 + a1 * 19) | 0) % (S - 5)); const gy = py + (((k * 17 + a2 * 13) | 0) % (S - 8));
        R(gx, gy + 1, 2, 6, "#3B6E3D"); R(gx + 2, gy + 3, 2, 4, "#63AA5D"); R(gx + 1, gy - 1, 1, 3, "#74BE6B"); }
      if (a3 > .82) { const fx = px + 12 + ((a1 * 12) | 0), fy = py + 14 + ((a2 * 10) | 0); R(fx, fy + 3, 1, 4, "#3B6E3D");
        const col = a4 > .5 ? "#FFD166" : "#FF8FC7"; R(fx - 1, fy, 3, 3, col); R(fx, fy + 1, 1, 1, "#FFF3C4"); }
      else if (a3 < .07) { R(px + 20, py + 20, 5, 4, "#8A8F96"); R(px + 20, py + 20, 5, 2, "#A6ACB4"); }
    }
  }
  /* 이웃 칸에 따른 테두리(물가 거품·바위 그림자·풀-모래 경계) */
  function paintEdges(g, at, x, y, v, px, py, S, k) {
    const R = (qx, qy, w, h, col) => { g.fillStyle = col; g.fillRect(qx, qy, w * k, h * k); };
    if (v === 4) {
      if (at(x, y - 1) !== 4) { R(px, py, S, 3, "#CDEBFF"); R(px, py + 3 * k, S, 2, "#8FC9F0"); }
      if (at(x, y + 1) !== 4) R(px, py + (S - 3) * k, S, 3, "#7EC0EE");
      if (at(x - 1, y) !== 4) R(px, py, 3, S, "#9CD0F5");
      if (at(x + 1, y) !== 4) R(px + (S - 3) * k, py, 3, S, "#9CD0F5");
      if (at(x, y - 1) === 1 || at(x, y - 1) === 0) { R(px + 6 * k, py - 9 * k, 2, 10, "#3E7440"); R(px + 5 * k, py - 12 * k, 4, 4, "#8A7444"); R(px + 24 * k, py - 7 * k, 2, 8, "#3E7440"); R(px + 23 * k, py - 10 * k, 4, 4, "#8A7444"); }
    }
    if (v === 1 && at(x, y + 1) === 0) for (let i = 0; i < S; i += 4) R(px + i * k, py + (S - 3) * k, 3, 3, "#DCCB9F");
    if (v === 0 && at(x, y - 1) === 1) for (let i = 2; i < S; i += 5) R(px + i * k, py, 3, 2, "#4B8946");
    if (v !== 3 && at(x, y - 1) === 3) { g.globalAlpha = .34; R(px, py, S, 6, "#0A0713"); g.globalAlpha = 1; }
    if (v === 3) { g.strokeStyle = "rgba(10,7,19,.6)"; g.lineWidth = 2; g.beginPath();
      if (at(x, y - 1) !== 3) { g.moveTo(px, py + 1); g.lineTo(px + S * k, py + 1); }
      if (at(x, y + 1) !== 3) { g.moveTo(px, py + S * k - 1); g.lineTo(px + S * k, py + S * k - 1); }
      if (at(x - 1, y) !== 3) { g.moveTo(px + 1, py); g.lineTo(px + 1, py + S * k); }
      if (at(x + 1, y) !== 3) { g.moveTo(px + S * k - 1, py); g.lineTo(px + S * k - 1, py + S * k); }
      g.stroke(); }
  }
  /* 보이는 영역만 그리기. camX/camY = 화면 중앙의 월드 좌표, k = 배율(월드→화면) */
  function drawTiles(ctx, m, camX, camY, k, vw, vh, set) {
    const S = m.TS, W = m.TW, H = m.TH, t = m.t;
    set = set || tileset(S);
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 3 : t[y * W + x];
    const x0 = Math.max(0, Math.floor((camX - vw / 2 / k) / S) - 1), x1 = Math.min(W - 1, Math.ceil((camX + vw / 2 / k) / S) + 1);
    const y0 = Math.max(0, Math.floor((camY - vh / 2 / k) / S) - 1), y1 = Math.min(H - 1, Math.ceil((camY + vh / 2 / k) / S) + 1);
    const ox = vw / 2 - camX * k, oy = vh / 2 - camY * k, sz = S * k;
    /* 타일 경계를 '기기 픽셀' 정수 위치에 맞춰 빈틈·겹침 없이 이어 붙입니다.
       (1.5배·2.625배 같은 소수 화면 배율에서도 격자 줄이 생기지 않게) */
    const M = devScale(ctx), a = M ? M.a : 1, d = M ? M.d : 1, e = M ? M.e : 0, f = M ? M.f : 0;
    const ex = (x) => Math.round(e + a * (ox + x * sz)), ey = (y) => Math.round(f + d * (oy + y * sz));
    ctx.save();
    if (M) ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (let y = y0; y <= y1; y++) {
      const py = ey(y), ph = ey(y + 1) - py;
      for (let x = x0; x <= x1; x++) {
        const v = t[y * W + x], px = ex(x), pw = ex(x + 1) - px;
        const variant = ((x * 7 + y * 13 + x * y) & 3);
        ctx.drawImage(set[v] ? set[v][variant] : set[1][0], px, py, pw, ph);
      }
    }
    ctx.restore();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) paintEdges(ctx, at, x, y, t[y * W + x], ox + x * sz, oy + y * sz, S, k);
  }
  /* 전체 맵 축소본 (관전 화면 전체 보기용) */
  function drawMapScaled(m, k) {
    const c = document.createElement("canvas"); c.width = Math.ceil(m.W * k); c.height = Math.ceil(m.H * k);
    const g = c.getContext("2d");
    drawTiles(g, m, m.W / 2, m.H / 2, k, c.width, c.height);
    return c;
  }

  /* ═══════ 미니언 ═══════ */
  const MINION = {
    soldier: { name: "블레셋 병사", xp: 15, color: "#B4723C", look: { sk:2, hs:0, hc:1, ft:2, cc:7, gr:3, ac:2, it:1 } },
    fox:     { name: "광야 여우",   xp: 30, color: "#FF9A3C" },
    locust:  { name: "메뚜기 떼",   xp: 10, color: "#9BDC3C" },
  };
  const minCache = new Map();
  function minionBase(type, frame, flip) {
    const hop = (frame % 2) ? 1 : 0;
    const k = type + "_" + hop + "_" + (flip ? 1 : 0);
    let c = minCache.get(k);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = 28; c.height = 28;                   // 24×24 + 테두리 여백 2
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    const P = (px, py, w, h, col) => { g.fillStyle = col; g.fillRect(2 + (flip ? 24 - px - w : px), 2 + py, w, h); };
    if (type === "fox") {
      P(4, 10 + hop, 14, 7, "#FF9A3C"); P(4, 15 + hop, 14, 2, "#E07A20");
      P(14, 6 + hop, 7, 6, "#FF9A3C"); P(15, 4 + hop, 2, 3, "#FF9A3C"); P(19, 4 + hop, 2, 3, "#FF9A3C");
      P(17, 9 + hop, 1, 1, "#1A1200"); P(20, 10 + hop, 2, 1, "#1A1200");
      P(0, 12 + hop, 5, 4, "#FF9A3C"); P(0, 12 + hop, 2, 2, "#FFFFFF");
      P(6, 17 + hop, 2, 4 - hop, "#C25E10"); P(11, 17 + hop, 2, 4 - hop, "#C25E10"); P(15, 17, 2, 4, "#C25E10");
      P(16, 12 + hop, 4, 3, "#FFF3E0");
    } else if (type === "locust") {
      P(6, 12 + hop, 12, 5, "#7CB83A"); P(6, 11 + hop, 12, 1, "#B7EE5E");
      P(16, 10 + hop, 4, 4, "#5E9A2A"); P(18, 11 + hop, 1, 1, "#1A1200");
      P(4, 10 + hop, 10, 2, "#D7F5A8"); P(2, 9 + hop, 6, 1, "#D7F5A8");
      P(7, 17 + hop, 1, 3, "#3E6E1E"); P(11, 17 + hop, 1, 3, "#3E6E1E"); P(14, 15 + hop, 3, 1, "#3E6E1E"); P(16, 13 + hop, 1, 3, "#3E6E1E");
      P(19, 8 + hop, 2, 1, "#3E6E1E"); P(20, 7 + hop, 1, 1, "#3E6E1E");
    }
    outline(g, 28, 28, 1);
    minCache.set(k, c);
    return c;
  }
  function drawMinion(ctx, x, y, size, type, frame, flip) {
    if (type !== "fox" && type !== "locust") return drawChar(ctx, x, y, size * 1.3, MINION.soldier.look, frame, flip);
    blit(ctx, minionBase(type, frame, flip), x, y, 24 * Math.max(1, Math.round(size / 24)), 24, 14, 26);   // 예전과 같은 크기 (24의 정수배)
  }


  /* ═══════ 보스 외형 ═══════ */
  const BOSS = {
    goliath:   { name:"골리앗",     look:{ sk:4, hs:2, hc:0, ft:2, cc:7, gr:3, ac:2, it:1 }, color:"#FF4757", size:1.6 },
    pharaoh:   { name:"바로 왕",    look:{ sk:3, hs:4, hc:0, ft:1, cc:2, gr:2, ac:4, it:4 }, color:"#FFC93C", size:1.5 },
    lion:      { name:"바벨론 사자", look:{ sk:2, hs:2, hc:3, ft:5, cc:11, gr:0, ac:0, it:0 }, color:"#FF7A1A", size:1.35 },
    leviathan: { name:"리워야단",   look:{ sk:4, hs:3, hc:9, ft:3, cc:10, gr:2, ac:3, it:3 }, color:"#2ED3C6", size:1.9 },
    nebuchad:  { name:"느부갓네살", look:{ sk:2, hs:5, hc:0, ft:1, cc:6, gr:2, ac:4, it:4, tier:5 }, color:"#C9A227", size:1.7 },
    herod:     { name:"헤롯 왕",    look:{ sk:1, hs:1, hc:2, ft:3, cc:7, gr:2, ac:4, it:2 }, color:"#E040A0", size:1.45 },
    serpent:   { name:"에덴의 뱀",  look:{ sk:3, hs:2, hc:7, ft:5, cc:9, gr:4, ac:6, it:5 }, color:"#7CDE4A", size:1.4 },
    amalek:    { name:"아말렉 병사", look:{ sk:2, hs:0, hc:1, ft:2, cc:11, gr:3, ac:2, it:0 }, color:"#B4723C", size:1.25 },
  };

  /** 캐릭터를 화면에 그립니다. px,py = 발밑 중심 좌표, size = 화면상 높이(px)
      frame: 0 서 있음 · 5 숨쉬기 · 1~4 걷기.  정수 배율 캐시를 원하는 크기로 맞춰 그립니다 */
  function drawChar(ctx, px, py, size, L, frame, flip) {
    blit(ctx, base(L, frame, flip), px, py, size, 40, AX, AY);
  }
  /* ── 작은 캔버스(초상화·목록 아이콘)를 화면 해상도에 맞춰 준비 ── */
  const dprNow = () => Math.min(3, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1);
  function hiCanvas(c, cssW, cssH) {
    const d = dprNow();
    const W = Math.max(1, Math.round(cssW * d)), H = Math.max(1, Math.round(cssH * d));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    if (c.style) { const sw = cssW + "px", sh = cssH + "px"; if (c.style.width !== sw) c.style.width = sw; if (c.style.height !== sh) c.style.height = sh; }
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    return { g, W, H, d };
  }
  /* 상자 안에 캐릭터를 꽉 차게, 되도록 정수 배율로 또렷하게 그립니다.
     opt.crop = "full"(전신, 발 아래 정렬) · "bust"(상반신) · "head"(얼굴) · opt.frame · opt.flip */
  const CROPS = { full: [3, 1, 32, 44], bust: [4, 0, 30, 30], head: [7, 1, 24, 24] };
  function portrait(c, cssW, cssH, L, opt) {
    opt = opt || {};
    const { g, W, H } = hiCanvas(c, cssW, cssH);
    g.clearRect(0, 0, W, H);
    const img = base(L, opt.frame || 0, !!opt.flip);
    const crop = CROPS[opt.crop] ? opt.crop : "full", r = CROPS[crop];
    let k = Math.min(W / r[2], H / r[3]) * (opt.scale || 1);
    const ki = Math.floor(k);
    if (ki >= 1 && ki / k >= .7) k = ki;             // 정수 배율로 (크기를 조금 양보)
    g.imageSmoothingEnabled = k < 1;                  // 작게 줄일 때만 부드럽게
    if (k < 1) { try { g.imageSmoothingQuality = "high"; } catch (e) {} }
    const dw = Math.round(r[2] * k), dh = Math.round(r[3] * k);
    const dx = Math.round((W - dw) / 2), dy = crop === "full" ? H - dh : Math.round((H - dh) / 2);
    g.drawImage(img, r[0], r[1], r[2], r[3], dx, dy, dw, dh);
    return g;
  }
  /** 걷는 중인지와 시간으로 프레임 번호를 고릅니다 */
  function animFrame(moving, walk, t) {
    if (moving) return 1 + (Math.floor(walk / 6) % 4);
    return Math.floor((t || Date.now()) / 520) % 2 ? 5 : 0;
  }

  function randomLook() {
    const r = (n) => Math.floor(Math.random() * n);
    return { sk: r(SKIN.length), hs: r(HAIRS.length), hc: r(HAIR.length), ft: r(FITS.length),
             cc: r(CLOTH.length), gr: r(GEARS.length), ac: r(ACCENT.length), it: r(ITEMS.length) };
  }
  const sanitize = (L) => ({
    sk: (+L?.sk || 0) % SKIN.length, hs: (+L?.hs || 0) % HAIRS.length, hc: (+L?.hc || 0) % HAIR.length,
    ft: (+L?.ft || 0) % FITS.length, cc: (+L?.cc || 0) % CLOTH.length, gr: (+L?.gr || 0) % GEARS.length,
    ac: (+L?.ac || 0) % ACCENT.length, it: (+L?.it || 0) % ITEMS.length,
  });

  root.PX = { base, portrait, hiCanvas, dprNow, SKIN, HAIR, CLOTH, ACCENT, HAIRS, GEARS, FITS, ITEMS, drawChar, animFrame, sprite, drawMap, drawTiles, drawMapScaled, tileset, drawChest, drawMinion, MINION, BOSS, SOLID: SOLID_T, randomLook, sanitize };
})(typeof window !== "undefined" ? window : globalThis);

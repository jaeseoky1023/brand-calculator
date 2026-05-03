/* ═══════════════════════════════════════
   환율 저장소 & 모드
═══════════════════════════════════════ */
const rates      = { usd: 0, gbp: 0, eur: 0 };
const manualMode = { usd: false, gbp: false, eur: false };
const CACHE_KEY  = 'brand_calc_rates';

/* ═══════════════════════════════════════
   배송비 테이블
═══════════════════════════════════════ */
const US_SHIP = {
  1.0:13600, 1.5:16100, 2.0:18500, 2.5:21000, 3.0:23400,
  3.5:25900, 4.0:28300, 4.5:30800, 5.0:33200, 5.5:35600,
  6.0:38100, 6.5:40500, 7.0:42900, 7.5:45400, 8.0:47900,
  8.5:50400, 9.0:52900, 9.5:55400, 10.0:57900, 10.5:60400,
  11.0:62900, 11.5:65400, 12.0:67900, 12.5:70400, 13.0:72900,
  13.5:75400, 14.0:77900, 14.5:80400, 15.0:82900, 15.5:85400,
  16.0:87900, 16.5:90400, 17.0:92900, 17.5:95400, 18.0:97900,
  18.5:100400, 19.0:102900, 19.5:105400, 20.0:107900
};

const UK_SHIP = {
  0.5:10230, 1.0:12700, 1.5:15180, 2.0:17550, 2.5:20900, 3.0:24250,
  3.5:27540, 4.0:30450, 4.5:33560, 5.0:36180, 6.0:44420, 7.0:50820,
  8.0:57320, 9.0:63720, 10.0:70710, 11.0:79150, 12.0:85740, 13.0:92240,
  14.0:98740, 15.0:105240, 16.0:111740, 17.0:118340, 18.0:124830,
  19.0:131330, 20.0:137830, 21.0:146270, 22.0:152870, 23.0:159370,
  24.0:165870, 25.0:172360, 26.0:178860, 27.0:185460, 28.0:191960,
  29.0:198460, 30.0:204960
};

const DE_SHIP = {
  0.5:10130, 1.0:12510, 1.5:15760, 2.0:17160, 2.5:19150, 3.0:21040,
  3.5:24100, 4.0:26570, 4.5:29050, 5.0:31420, 6.0:37530, 7.0:42680,
  8.0:47910, 9.0:53150, 10.0:60430, 11.0:67990, 12.0:73420, 13.0:78760,
  14.0:84190, 15.0:89530, 16.0:94960, 17.0:100390, 18.0:105730,
  19.0:111160, 20.0:116590, 21.0:123960, 22.0:129390, 23.0:134830,
  24.0:140160, 25.0:145590, 26.0:151990, 27.0:157430, 28.0:162760,
  29.0:168190, 30.0:173630
};

/* ═══════════════════════════════════════
   무게 드롭다운 초기화
═══════════════════════════════════════ */
function initWeights() {
  const usEl = document.getElementById('us-weight');
  for (let i = 2; i <= 40; i++) {
    const kg = (i * 0.5).toFixed(1);
    usEl.appendChild(new Option(kg + ' kg', kg));
  }
  const euWeights = [
    0.5,1.0,1.5,2.0,2.5,3.0,3.5,4.0,4.5,5.0,
    6.0,7.0,8.0,9.0,10.0,11.0,12.0,13.0,14.0,15.0,
    16.0,17.0,18.0,19.0,20.0,21.0,22.0,23.0,24.0,25.0,
    26.0,27.0,28.0,29.0,30.0
  ];
  ['uk-weight','de-weight'].forEach(id => {
    const el = document.getElementById(id);
    euWeights.forEach(w => el.appendChild(new Option(w.toFixed(1) + ' kg', w)));
  });
}

/* ═══════════════════════════════════════
   환율 조회 핵심 로직
═══════════════════════════════════════ */

/* Naver Finance HTML에서 환율 숫자 추출 */
function parseNaverHTML(html) {
  if (!html || html.length < 500) return null;
  const section = html.match(/no_today[\s\S]{0,800}?txt_won/);
  if (!section) return null;
  const chunk = section[0];
  const parts = chunk.match(/<span class="no\d">(\d)<\/span>|<span class="jum">([^<]*)<\/span>/g);
  if (!parts) return null;
  let rateStr = '';
  for (const p of parts) {
    const digit = p.match(/<span class="no\d">(\d)<\/span>/);
    if (digit) { rateStr += digit[1]; continue; }
    if (p.includes('jum')) rateStr += '.';
  }
  const val = parseFloat(rateStr);
  return (val > 100 && val < 10000) ? val : null;
}

/* 단일 프록시 URL로 fetch, 타임아웃 포함 */
function fetchWithTimeout(url, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(url)
      .then(r => r.text())
      .then(text => { clearTimeout(timer); resolve(text); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

/* Naver HTML 방식: 3개 병렬 시도 (allorigins 다른 파라미터 조합) */
async function fetchNaverRate(code) {
  const naverUrl = `https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_${code}KRW`;
  const enc = encodeURIComponent(naverUrl);
  const proxies = [
    `https://api.allorigins.win/raw?url=${enc}&charset=UTF-8`,
    `https://api.allorigins.win/raw?url=${enc}&t=${Date.now()}`,
    `https://api.allorigins.win/raw?url=${enc}`,
  ];

  const attempts = proxies.map(url =>
    fetchWithTimeout(url, 7000)
      .then(html => {
        const rate = parseNaverHTML(html);
        if (!rate) throw new Error('parse failed');
        return rate;
      })
  );

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

/* 폴백: open.er-api.com (CORS 허용, 무료, 안정적) */
async function fetchFallbackRates() {
  const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/KRW', 8000);
  const data = JSON.parse(res);
  const r = data.rates;
  return {
    usd: Math.round(1 / r.USD * 100) / 100,
    gbp: Math.round(1 / r.GBP * 100) / 100,
    eur: Math.round(1 / r.EUR * 100) / 100,
  };
}

/* localStorage 캐시 읽기/쓰기 */
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (cache.date !== today) return null;
    return cache;
  } catch { return null; }
}

function saveCache(usd, gbp, eur, source) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      usd, gbp, eur, source,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    }));
  } catch {}
}

/* ═══════════════════════════════════════
   환율 UI 조작
═══════════════════════════════════════ */

/* 수동 환율 입력 처리 */
function onManualRate(key) {
  const input = document.getElementById('rate-' + key);
  const val = parseFloat(input.value);

  if (!val || val < 100 || val > 9999) return;

  rates[key] = val;
  manualMode[key] = true;

  input.classList.add('manual-mode');
  const badge = document.getElementById('badge-' + key);
  badge.textContent = '수동';
  badge.className = 'rate-badge manual';

  const fmt = val.toLocaleString('ko-KR', { minimumFractionDigits: 2 });
  document.getElementById('bar-' + key).textContent = fmt;

  const country = key === 'usd' ? 'us' : key === 'gbp' ? 'uk' : 'de';
  calc(country);

  const statusEl = document.getElementById('rate-status');
  if (!statusEl.textContent.includes('수동 입력')) {
    statusEl.textContent += ' | 수동 입력 적용 중';
  }
}

/* 자동 환율을 화면에 적용 (수동 모드 초기화 포함) */
function applyRates(usd, gbp, eur, source, time) {
  rates.usd = usd;
  rates.gbp = gbp;
  rates.eur = eur;
  manualMode.usd = false;
  manualMode.gbp = false;
  manualMode.eur = false;

  [['usd', usd], ['gbp', gbp], ['eur', eur]].forEach(([key, val]) => {
    const fmt = val.toLocaleString('ko-KR', { minimumFractionDigits: 2 });
    document.getElementById('bar-' + key).textContent = fmt;

    const input = document.getElementById('rate-' + key);
    input.value = val.toFixed(2);
    input.classList.remove('manual-mode');

    const badge = document.getElementById('badge-' + key);
    badge.textContent = '자동';
    badge.className = 'rate-badge auto';
  });

  const isNaver = source === 'naver';
  const statusEl = document.getElementById('rate-status');
  statusEl.className = 'rate-status';
  statusEl.textContent = isNaver
    ? `네이버 금융 기준 | 조회: ${time}`
    : `참조환율 (open.er-api.com) | 조회: ${time}`;

  ['us','uk','de'].forEach(calc);
}

/* ═══════════════════════════════════════
   메인 환율 조회 함수
═══════════════════════════════════════ */
async function fetchRates() {
  const statusEl = document.getElementById('rate-status');
  statusEl.className = 'rate-status';
  statusEl.textContent = '환율 조회 중...';

  /* 1단계: 캐시 확인 (당일 캐시 있으면 즉시 표시 후 백그라운드 갱신) */
  const cache = loadCache();
  if (cache) {
    applyRates(cache.usd, cache.gbp, cache.eur, cache.source, cache.time + ' (캐시)');
  }

  /* 2단계: 네이버 3개 통화 병렬 조회 */
  statusEl.textContent = cache ? '환율 갱신 중...' : '네이버 금융 조회 중...';

  try {
    const [usd, gbp, eur] = await Promise.all([
      fetchNaverRate('USD'),
      fetchNaverRate('GBP'),
      fetchNaverRate('EUR'),
    ]);

    if (usd && gbp && eur) {
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      saveCache(usd, gbp, eur, 'naver');
      applyRates(usd, gbp, eur, 'naver', time);
      return;
    }
  } catch { /* 일부 실패 → 폴백으로 진행 */ }

  /* 3단계: 네이버 실패 시 폴백 API */
  try {
    statusEl.textContent = '참조 환율 조회 중...';
    const fb = await fetchFallbackRates();
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    saveCache(fb.usd, fb.gbp, fb.eur, 'fallback');
    applyRates(fb.usd, fb.gbp, fb.eur, 'fallback', time);
  } catch (e) {
    console.error('모든 환율 조회 실패:', e);
    statusEl.className = 'rate-status error';
    if (!cache) {
      statusEl.textContent = '환율 조회 실패 — 새로고침 버튼을 눌러주세요.';
      ['usd','gbp','eur'].forEach(key => {
        const input = document.getElementById('rate-' + key);
        input.value = '';
        input.placeholder = '조회 실패';
      });
    } else {
      statusEl.textContent = '갱신 실패 (캐시 값 사용 중) — 새로고침 버튼으로 재시도';
    }
  }
}

/* ═══════════════════════════════════════
   원화 포맷 헬퍼
═══════════════════════════════════════ */
function fmtKRW(input) {
  const raw = input.value.replace(/[^0-9]/g, '');
  input.value = raw === '' ? '' : parseInt(raw, 10).toLocaleString('ko-KR');
}

function parseKRW(str) {
  return parseInt((str || '').replace(/,/g, ''), 10) || 0;
}

/* ═══════════════════════════════════════
   대리 수수료 (유럽 공통)
═══════════════════════════════════════ */
function agencyFee(localPrice) {
  if (localPrice <= 30) return 6000;
  if (localPrice <= 50) return 8000;
  return 10000;
}

/* ═══════════════════════════════════════
   마진 계산
═══════════════════════════════════════ */
function calc(country) {
  const sell   = parseKRW(document.getElementById(country + '-sell').value);
  const local  = parseFloat(document.getElementById(country + '-local').value) || 0;
  const weight = parseFloat(document.getElementById(country + '-weight').value);
  const resEl  = document.getElementById(country + '-result');

  if (!sell || !local || !weight) {
    resEl.textContent = '-';
    resEl.className = 'result-value';
    return;
  }

  const rateKey = country === 'us' ? 'usd' : country === 'uk' ? 'gbp' : 'eur';
  if (!rates[rateKey]) {
    resEl.textContent = '환율 조회 필요';
    resEl.className = 'result-value';
    return;
  }

  let margin;
  if (country === 'us') {
    const cost = local * rates.usd * 1.024 + (US_SHIP[weight] || 0);
    margin = Math.floor(sell * 0.95 - cost);
  } else if (country === 'uk') {
    const cost = (local / 1.20) * rates.gbp * 1.085 + (UK_SHIP[weight] || 0) + agencyFee(local);
    margin = Math.floor(sell * 0.95 - cost);
  } else {
    const cost = (local / 1.19) * rates.eur * 1.085 + (DE_SHIP[weight] || 0) + agencyFee(local);
    margin = Math.floor(sell * 0.95 - cost);
  }

  resEl.textContent = margin.toLocaleString('ko-KR') + ' 원';
  resEl.className = 'result-value ' + (margin >= 0 ? 'positive' : 'negative');
}

/* ═══════════════════════════════════════
   초기화 / ESC
═══════════════════════════════════════ */
function resetFields() {
  ['us','uk','de'].forEach(c => {
    document.getElementById(c + '-sell').value = '';
    document.getElementById(c + '-local').value = '';
    document.getElementById(c + '-weight').selectedIndex = 0;
    const r = document.getElementById(c + '-result');
    r.textContent = '-';
    r.className = 'result-value';
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') resetFields();
});

/* ═══════════════════════════════════════
   초기 실행
═══════════════════════════════════════ */
initWeights();
fetchRates();

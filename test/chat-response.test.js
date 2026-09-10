const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.CHAT_CONTROL_INITIAL_ENABLED = 'true';
const chatControl = require('../lib/chat-control');
chatControl._test.setBlobClientForTests({ get: async () => null, put: async () => ({}) });

const handler = require('../api/chat');
const {
  CHAT_SYSTEM_PROMPT,
  addPublicSearchDisclosure,
  buildRequestBody,
  detectQuestionLanguage,
  extractAddressMapLinks,
  extractCitedSources,
  formatGuestAnswer,
  localAnswer,
  normalizeAnswer,
  normalizeKoreanSpacing
} = handler._test;

test('Traditional Chinese (Taiwan) is preserved through prompt and fallback paths', () => {
  assert.equal(detectQuestionLanguage('Wi-Fi 密碼', 'zh-TW'), 'zh-TW');
  assert.match(buildRequestBody('Wi-Fi 密碼', [], 'gpt-test', 'zh-TW').input.at(-1).content, /TARGET_LANGUAGE: Traditional Chinese \(Taiwan\)/);
  const answer = localAnswer('Wi-Fi 密碼', 'zh-TW');
  assert.match(answer, /名稱/);
  assert.match(answer, /密碼/);
  assert.match(answer, /請/);
  assert.doesNotMatch(answer, /名称|密码|请/);
});

test('prompt asks for detailed, guest-first concierge answers', () => {
  const promptFile = fs.readFileSync(path.join(__dirname, '..', 'data', 'chatbot-system-prompt.txt'), 'utf8').trim();
  assert.equal(CHAT_SYSTEM_PROMPT, promptFile);
  assert.match(CHAT_SYSTEM_PROMPT, /Start with the answer/);
  assert.match(CHAT_SYSTEM_PROMPT, /detailed concierge format/);
  assert.match(CHAT_SYSTEM_PROMPT, /correct spacing, particles/);
  assert.match(CHAT_SYSTEM_PROMPT, /Do not use Markdown headings/);
  assert.match(CHAT_SYSTEM_PROMPT, /proactively web-search/);
  assert.match(CHAT_SYSTEM_PROMPT, /helpful ChatGPT concierge/);
  assert.match(CHAT_SYSTEM_PROMPT, /Match a route to the time/);
  assert.match(CHAT_SYSTEM_PROMPT, /target sentence count or line count/);
  assert.match(CHAT_SYSTEM_PROMPT, /Do not impose a character, line, or sentence limit/);
  assert.match(CHAT_SYSTEM_PROMPT, /official operator, government, airport, venue, or business pages/);
  assert.doesNotMatch(CHAT_SYSTEM_PROMPT, /250 characters or fewer/);
  assert.doesNotMatch(CHAT_SYSTEM_PROMPT, /Never give one-line answers/);
  assert.doesNotMatch(CHAT_SYSTEM_PROMPT, /Guest WOW Mode/);
});

test('ordinary public searches use medium context while timetable questions keep deep search', () => {
  assert.equal(buildRequestBody('What time does the nearby museum close?').tools[0].search_context_size, 'medium');
  assert.equal(buildRequestBody('Which airport bus can I take at 3 AM?').tools[0].search_context_size, 'high');
});

test('legacy long-form prompt is preserved for rollback', () => {
  const legacy = fs.readFileSync(path.join(__dirname, '..', 'docs', 'chatbot-system-prompt-legacy-2026-07-20.md'), 'utf8');
  assert.match(legacy, /Guest WOW Mode/);
  assert.match(legacy, /Warm greeting \/ acknowledgment/);
  assert.match(legacy, /max_output_tokens: 900|Format for mobile/);
});

test('Korean local answers are short and use corrected spacing', () => {
  const wifi = localAnswer('와이파이 비밀번호 알려줘');
  const checkout = localAnswer('체크아웃은 어떻게 해?');
  const restroom = localAnswer('공용 화장실 비밀번호');

  assert.ok(wifi.length <= 120);
  assert.match(wifi, /`8H3#22E97B`입니다/);
  assert.ok(checkout.length <= 180);
  assert.match(checkout, /개인 키 번호|퇴실 전/);
  assert.match(restroom, /뒤편/);
  assert.match(restroom, /`\*7003\*`입니다/);
});

test('answer normalization removes noisy spacing and blank lines', () => {
  assert.equal(
    normalizeAnswer('  첫 문장입니다.  \r\n\r\n\r\n  둘째 문장입니다.   '),
    '첫 문장입니다.\n\n둘째 문장입니다.'
  );
});

test('guest answer formatter removes presentation noise without truncating useful detail', () => {
  const verbose = `안녕하세요! 와이파이 바로 안내드릴게요 😊

**와이파이 정보**
- **SSID(네트워크 이름):** \`U+Net46F0_5G\`
- **비밀번호:** \`8H3#22E97B\`

**연결 방법**
- 비밀번호는 대소문자와 특수문자를 그대로 입력해 주세요.
- 연결이 안 되면 Wi-Fi를 껐다가 다시 켜 주세요.

원하시면 더 자세히 도와드릴게요.`;
  const answer = formatGuestAnswer(verbose, 'ko', '와이파이 비밀번호 알려줘');
  assert.doesNotMatch(answer, /안녕하세요|와이파이 정보|연결 방법|원하시면|\*\*/);
  assert.ok(answer.split('\n').length <= 5);
  assert.match(answer, /U\+Net46F0_5G/);
  assert.match(answer, /8H3#22E97B/);
});

test('public web results keep useful emoji and receive a clear manual-and-host disclosure', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  console.info = () => {};
  global.fetch = async () => ({ok:true, json:async()=>({
      output_text: '🚌 심야 공항버스는 공항에서 서울역 방향으로 운행하는 노선을 확인해 보세요.',
      output:[
        {type:'web_search_call'},
        {type:'message',content:[{type:'output_text',annotations:[
          {type:'url_citation',title:'Incheon Airport official guide',url:'https://www.airport.kr/ap/en/tpt/bus/busList.do'},
          {type:'url_citation',title:'Incheon Airport official guide',url:'https://www.airport.kr/ap/en/tpt/bus/busList.do'}
        ]}]}
      ],
      usage:{input_tokens:12000,input_tokens_details:{cached_tokens:11008},output_tokens:32}
    })});
  let payload;
  const res = {setHeader(){}, status(){return this;}, json(body){payload=body;return body;}};
  try {
    await handler({method:'POST',body:{message:'인천공항 심야버스가 있나요?',history:[]}}, res);
    assert.equal(payload.searched, true);
    assert.match(payload.answer, /^🚌/);
    assert.match(payload.answer, /공개 웹 정보를 참고/);
    assert.match(payload.answer, /호스트에게 한 번 더 확인/);
    assert.deepEqual(payload.sources, [{title:'Incheon Airport official guide',url:'https://www.airport.kr/ap/en/tpt/bus/busList.do'}]);
  } finally {
    global.fetch = originalFetch;
    console.info = originalInfo;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('only safe cited sources and exact addresses become chat links', () => {
  const sources = extractCitedSources({output:[{content:[{annotations:[
    {type:'url_citation',title:'Official operator',url:'https://operator.example/route'},
    {type:'url_citation',title:'Duplicate',url:'https://operator.example/route'},
    {type:'url_citation',title:'Unsafe',url:'javascript:alert(1)'}
  ]}]}]});
  assert.deepEqual(sources, [{title:'Official operator',url:'https://operator.example/route'}]);

  const maps = extractAddressMapLinks('숙소 주소는 서울시 용산구 신흥로 59, 2층입니다.');
  assert.deepEqual(maps, [{
    address:'서울시 용산구 신흥로 59, 2층',
    naver:'https://map.naver.com/p/search/%EC%84%9C%EC%9A%B8%EC%8B%9C%20%EC%9A%A9%EC%82%B0%EA%B5%AC%20%EC%8B%A0%ED%9D%A5%EB%A1%9C%2059%2C%202%EC%B8%B5',
    google:'https://www.google.com/maps/search/?api=1&query=%EC%84%9C%EC%9A%B8%EC%8B%9C%20%EC%9A%A9%EC%82%B0%EA%B5%AC%20%EC%8B%A0%ED%9D%A5%EB%A1%9C%2059%2C%202%EC%B8%B5'
  }]);

  const parkingMaps = extractAddressMapLinks('가장 가까운 곳은 신흥로2길 74입니다.');
  assert.equal(parkingMaps.length, 1);
  assert.equal(parkingMaps[0].address, '신흥로2길 74');
  const nearestFirst = extractAddressMapLinks('가장 가까운 곳은 소월로20길 56입니다. 숙소 주소는 서울시 용산구 신흥로 59, 2층입니다.');
  assert.equal(nearestFirst[0].address, '소월로20길 56');
  assert.doesNotMatch(formatGuestAnswer('Naver Map: https://map.naver.com/p/search/test', 'en'), /https?:\/\//);
});

test('public-search disclosure remains complete when the model already mentions public information', () => {
  const answer = addPublicSearchDisclosure('This uses public web information.', 'en');
  assert.match(answer, /This is based on public web information/);
  assert.match(answer, /reconfirm with the host/);
});

test('guest answer formatter removes complete and truncated web citations', () => {
  const answer = formatGuestAnswer(
    '🚌 직행 심야버스는 확인되지 않았습니다. ([airport.kr](https://airport.kr/night))\n택시를 이용하세요. ([airport.kr](https://airport.kr/',
    'ko',
    '심야버스가 있나요?'
  );
  assert.match(answer, /^🚌/);
  assert.doesNotMatch(answer, /airport\.kr|https?:\/\/|\(\[/);
});

test('early-morning airport plans retain a detailed mobile itinerary', () => {
  const plan = [
    '🚌 추천 경로: 녹사평역에서 서울역까지 택시를 이용하세요.',
    '1. 녹사평역 → 서울역: 새벽에는 택시가 편합니다.',
    '2. 서울역 → 인천공항: N6701 심야 리무진을 이용하세요.',
    '출발 시각: 검색에서 확인된 가장 가까운 시간을 고르세요.',
    '요금: 최신 공식 요금을 확인하세요.',
    'T1/T2 도착 터미널을 먼저 확인하세요.',
    '대안: 심야버스가 맞지 않으면 공항 택시를 이용하세요.'
  ].join('\n');
  const answer = formatGuestAnswer(plan, 'ko', '녹사평역에서 인천공항 새벽에 가려면 어떻게 해야 해? 심야 리무진 있어?');
  assert.equal(answer.split('\n').length, 7);
  assert.match(answer, /N6701/);
});

test('Korean spacing guard corrects common guest-facing forms', () => {
  assert.equal(
    normalizeKoreanSpacing('개인 키번호를 확인해주세요. 현관입구에서 번호를 눌러주세요.'),
    '개인 키 번호를 확인해 주세요. 현관 입구에서 번호를 눌러 주세요.'
  );
  assert.equal(
    formatGuestAnswer('개인 키번호는 Airbnb 메시지를 확인해주세요.', 'ko', '체크인 방법'),
    '개인 키 번호는 Airbnb 메시지를 확인해 주세요.'
  );
  assert.equal(
    formatGuestAnswer('음식물쓰레기는 전용 통에, 일반쓰레기는 종량제봉투에 넣어주세요.', 'ko', '쓰레기는 어디에 버려?'),
    '음식물 쓰레기는 전용 통에, 일반 쓰레기는 종량제 봉투에 넣어 주세요.'
  );
});

test('API-key fallback returns a concise guest answer', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  let statusCode;
  let payload;
  const res = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    }
  };

  try {
    await handler({ method: 'POST', body: { message: '체크인은 몇 시야?' } }, res);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }

  assert.equal(statusCode, 200);
  assert.equal(payload.fallback, true);
  assert.ok(payload.answer.length <= 180);
  assert.match(payload.answer, /^체크인은 오후 4시부터/);
});

test('browser fallback uses the same concise Korean copy', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'guide-extay.html'), 'utf8');
  const vm = require('node:vm');
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'chat-fallback.js'), 'utf8'), browser);
  assert.match(html, /src="assets\/chat-fallback.js"/);
  assert.match(html, /ExtayChatFallback.answer\(question,currentLang\)/);
  assert.doesNotMatch(html, /const extayGuideAnswers=/);
  for (const question of ['와이파이 비밀번호', '체크인 전 짐 보관', '숙소 CCTV', '체크아웃', '세탁기', '쓰레기', 'Can I leave luggage?', 'チェックアウト', '监控摄像头']) {
    assert.equal(browser.ExtayChatFallback.answer(question), localAnswer(question));
  }
  assert.match(browser.ExtayChatFallback.answer('심야버스가 있나요?'), /공개 웹 검색을 연결할 수 없어요/);
  assert.match(html, /white-space:pre-wrap;overflow-wrap:anywhere;word-break:keep-all;text-align:left/);
  assert.match(html, /function renderChatLinks/);
  assert.match(html, /target='_blank'/);
  assert.match(html, /Naver Map/);
});

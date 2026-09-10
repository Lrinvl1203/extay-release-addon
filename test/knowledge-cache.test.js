const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

process.env.CHAT_CONTROL_INITIAL_ENABLED = 'true';
const chatControl = require('../lib/chat-control');
chatControl._test.setBlobClientForTests({ get: async () => null, put: async () => ({}) });
const privateBlob = require('../lib/private-blob');
privateBlob._test.setBlobClientForTests({ get: async () => null, put: async () => ({}) });
const handler = require('../api/chat');
const { GUIDE_KNOWLEDGE: guide, buildRequestBody, localAnswer } = handler._test;
const html = fs.readFileSync(path.join(__dirname, '..', 'guide-extay.html'), 'utf8');

test('browser favicon uses the cropped leading E brand mark', () => {
  assert.match(html, /rel="icon"[^>]*href="assets\/extay\/extay-logo-tab\.png\?v=20260909c"/);
  assert.doesNotMatch(html, /rel="(?:shortcut )?icon"[^>]*extay-logo-symbol\.png/);
  assert.doesNotMatch(html, /rel="(?:shortcut )?icon"[^>]*extay-logo-official\.png/);
});

test('first-visit brand intro stays visible 1.7 times longer', () => {
  assert.match(html, /const BRAND_INTRO_DURATION_MS=1530;/);
  assert.match(html, /setTimeout\(\(\)=>\{intro\.classList\.add\('is-leaving'\)[\s\S]*?\},BRAND_INTRO_DURATION_MS\)/);
});

test('guest header and menu stay unified across every route and five languages', () => {
  assert.deepEqual(
    [...html.matchAll(/class="home-language-option"[^>]*data-language="([^"]+)"/g)].map(match => match[1]),
    ['ko', 'en', 'zh', 'zh-TW', 'ja']
  );
  assert.doesNotMatch(html, /id="(?:openGuidebookTop|langToggle|openChatTop)"/);
  assert.deepEqual(
    [...html.matchAll(/class="menu-link"[^>]*data-go="([^"]+)"/g)].map(match => match[1]),
    ['home', 'gallery', 'transport', 'checkin', 'wifi', 'appliances', 'laundry', 'trash', 'rules', 'restaurants', 'tours']
  );
  assert.match(html, /\.rules-editorial-count\{[^}]*background:transparent/);
});

test('nearby tour host picks start with the requested seven-place order', () => {
  assert.deepEqual(guide.tours.hostPicks, [
    'N서울타워',
    '남산공원',
    '경리단길',
    '이태원 거리',
    '해방촌 신흥시장',
    '해방촌 108계단',
    '녹사평 용산공원 플랫폼'
  ]);
  assert.match(html, /data-language="zh-TW"/);
});

test('knowledge contains every restaurant and exact host picks from the guest page', () => {
  const readArray = name => JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.match(new RegExp(`const ${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`))[1] + ')')));
  const places = readArray('RESTAURANTS');
  assert.equal(guide.restaurants.places.length, places.length);
  assert.deepEqual(guide.restaurants.hostPicks, readArray('RESTAURANT_HOST_PICKS'));
  for (const source of places) {
    const entry = guide.restaurants.places.find(item => item.name === source.name);
    assert.ok(entry, source.name);
    assert.equal(entry.description, source.note);
    assert.equal(entry.detailsUrl, source.href);
    assert.deepEqual(entry.tags, source.tags);
  }
  assert.deepEqual(guide.source.screens.slice().sort(), [...html.matchAll(/<section\b[^>]*data-screen="([^"]+)"/g)].map(m => m[1]).sort());
});

test('page policies are reflected in knowledge and safe fallback answers', () => {
  assert.match(html, /체크인 전 · 체크아웃 후 짐 보관 불가/);
  assert.equal(guide.checkInOut.luggageStorage.beforeCheckIn, false);
  assert.equal(guide.checkInOut.luggageStorage.afterCheckOut, false);
  assert.match(localAnswer('체크인 전에 짐을 맡겨도 되나요?'), /보관은 불가/);
  assert.match(localAnswer('CCTV 위치'), /현관 입구에만/);
  assert.match(localAnswer('CCTV 위치'), /객실 내부에는 없습니다/);
  assert.match(localAnswer('퇴실 전 무엇을 꺼야 하나요?'), /냉난방·조명/);
  assert.match(localAnswer('세탁기는 어떻게 써요?'), /세탁기 문을 살짝 열어/);
  assert.doesNotMatch(localAnswer('건조기는 어떻게 써요?'), /문을 살짝/);
  assert.match(localAnswer('일반 쓰레기 버리는 곳'), /베란다/);
  assert.doesNotMatch(JSON.stringify(guide.trash), /식탁 아래/);
  assert.match(localAnswer('늦게 퇴실하면 요금이 얼마인가요?'), /호스트/);
  assert.doesNotMatch(JSON.stringify(guide), /010-000-0000|sExtayTemp|10,000/);
});

test('airport, guidebook and host recommendation context is available without web lookup', () => {
  assert.match(JSON.stringify(guide.transport.incheon.rail), /공덕/);
  assert.match(JSON.stringify(guide.transport.gimpo.rail), /녹사평/);
  assert.equal(guide.luggageLockers.listedCapacity.large, 4);
  assert.match(guide.appliances.toiletClog.source, /PDF 6쪽/);
  assert.match(localAnswer('호스트 추천 브런치 맛집'), /OPATO/);
  assert.match(localAnswer('한글 가이드북 PDF'), /#guidebook/);
});

test('the complete shared prefix and cache key remain stable across guests and languages', () => {
  const a = buildRequestBody('짐 보관 되나요?', [{role:'assistant',content:'이전 안내'}]);
  const b = buildRequestBody('Where is the CCTV?', [{role:'user',content:'Hello'}]);
  assert.deepEqual(a.input.slice(0, 2), b.input.slice(0, 2));
  assert.equal(a.prompt_cache_key, b.prompt_cache_key);
  assert.match(a.prompt_cache_key, /^extay-guide:[a-f0-9]{24}$/);
  assert.deepEqual(JSON.parse(a.input[1].content.replace('GUIDE_KNOWLEDGE:\n', '')), guide);
  assert.match(b.input.at(-1).content, /TARGET_LANGUAGE: English/);
  assert.deepEqual(a.tools, b.tools);
});

test('current question is not duplicated by older clients and history stays bounded', () => {
  const history = Array.from({length:10}, (_,i) => ({role:i%2?'assistant':'user',content:`prior ${i}`}));
  history.push({role:'user',content:'CCTV 위치'});
  const body = buildRequestBody('CCTV 위치', history);
  assert.equal(body.input.length, 9);
  assert.equal(body.input.filter(m => m.content.includes('CCTV 위치')).length, 1);
  assert.equal(body.input.at(-2).content, 'prior 9');
  assert.doesNotThrow(() => buildRequestBody('Hello', [null, {role:'system'}, {content:42}]));
});

test('timetable questions retain deep search while ordinary questions use a faster search budget', () => {
  const body = buildRequestBody('녹사평역에서 인천공항 새벽에 가려면 심야 리무진이 있나요?', []);
  assert.equal(body.tools[0].search_context_size, 'high');
  assert.equal(body.max_output_tokens, 1200);
  const propertyAnswer = buildRequestBody('CCTV 위치', []);
  assert.equal(propertyAnswer.tools[0].search_context_size, 'medium');
  assert.equal(propertyAnswer.max_output_tokens, 1200);
});


test('API reports actual cache usage and actual web-search calls, not tool configuration', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalInfo = console.info;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  console.info = () => {};
  let request;
  global.fetch = async (_, options) => {
    request = JSON.parse(options.body);
    return {ok:true, json:async()=>({
      output_text:'현관 입구에만 설치되어 있고 객실 내부에는 없습니다.',
      tools:[{type:'web_search_preview'}], output:[],
      usage:{input_tokens:12000,input_tokens_details:{cached_tokens:11008},output_tokens:32}
    })};
  };
  let result;
  const res = {setHeader(){}, status(code){assert.equal(code,200);return this;}, json(body){result=body;return body;}};
  try {
    await handler({method:'POST',body:{message:'CCTV 위치',history:[]}}, res);
    assert.equal(result.fallback, undefined);
    assert.equal(result.searched, false);
    assert.equal(result.usage.cached_tokens, 11008);
    assert.match(request.input[1].content, /luggageStorage/);
  } finally {
    global.fetch = originalFetch;
    console.info = originalInfo;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

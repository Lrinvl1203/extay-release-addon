(() => {
  const targets = {
    'property.name':['home','#heroTitle'],
    'property.address':['checkin','.checkin-info-row:nth-child(2) strong'],
    'property.transit':['home','#stayEssentials .essential-item:nth-child(4) strong'],
    'property.description':['home','#editorialWelcomeBody'],
    'stay.checkIn':['home','#stayEssentials .essential-item:nth-child(1) strong'],
    'stay.checkOut':['home','#stayEssentials .essential-item:nth-child(2) strong'],
    'stay.entry':['checkin','.checkin-info-row:nth-child(3) strong'],
    'stay.luggage':['checkin','.checkin-info-row:nth-child(5) strong'],
    'stay.parking':['checkin','.checkin-info-row:nth-child(4) strong'],
    'guides.wifiSsid':['wifi','.wifi-network-card:nth-child(1) strong'],
    'guides.wifiPassword':['wifi','.wifi-network-card:nth-child(2) strong'],
    'guides.wifiNotes':['wifi','.wifi-help-grid .wifi-visual-card:last-child div>span'],
    'guides.parking':['checkin','[data-managed-note="parking"]'],
    'guides.laundry':['laundry','[data-managed-note="laundry"]'],
    'guides.trash':['trash','[data-managed-note="trash"]'],
    'guides.facilities':['appliances','[data-managed-note="facilities"]'],
    'property.naverMapUrl':['checkin','.checkin-map-actions a:first-child'],
    'property.googleMapUrl':['checkin','.checkin-map-actions a:nth-child(2)'],
    'images.hero':['home','.landing-hero'],
    'images.gallery':['gallery','.gallery-spread [data-fullscreen-image]'],
    faq:['home','#managedFaqSection']
  };
  let started=false;
  window.ExtayAdminPreview={start({collectDraft,fieldLocations}){
    if(started)return;
    started=true;
    const style=document.createElement('style');
    style.textContent=`
      .live-preview{position:fixed;right:max(20px,calc((100vw - 1140px)/2));top:24px;width:324px;z-index:20;border:1px solid #d9cec1;border-radius:18px;background:#fffaf5;box-shadow:0 12px 40px #33271924;overflow:hidden}
      .live-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;font-size:14px}.live-preview-head button{font-size:12px;padding:7px 9px;background:#eee7df;color:#34261d}.live-preview p{padding:0 14px;margin:0 0 10px;font-size:12px;line-height:1.5}.live-preview-stage{position:relative;width:300px;height:508px;margin:0 auto 12px;overflow:hidden;border:1px solid #dfd3c8;border-radius:12px;background:white}.live-preview iframe{display:block;width:390px;height:660px;transform:scale(.76923);transform-origin:top left;border:0;pointer-events:none}.live-preview-notice{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:#f7f2ec;color:#655447;font-size:15px;line-height:1.8;text-align:center}.live-preview-notice[hidden],.live-preview-body[hidden]{display:none}.live-preview-current{font-weight:750;color:#92502c}.live-preview-status{color:#796454}.live-preview-selected{outline:2px solid #bd7747!important;outline-offset:2px}
      @media(min-width:1001px){body.has-live-preview main{width:min(680px,calc(100vw - 420px));margin-left:max(0px,calc((100vw - 1140px)/2 - 20px));margin-right:370px}}
      @media(max-width:1000px){.live-preview{right:10px;top:10px;width:182px;border-radius:12px}.live-preview-head{padding:8px;font-size:11px}.live-preview-head button{font-size:11px;padding:5px}.live-preview-stage{width:170px;height:226px;margin-bottom:6px}.live-preview iframe{height:520px;transform:scale(.4359)}.live-preview p{padding:0 8px;font-size:11px;margin-bottom:6px}.live-preview-notice{font-size:12px;padding:12px}.live-preview-status{display:none}}
      @media(prefers-reduced-motion:reduce){.live-preview *{transition:none!important}}
    `;
    document.head.appendChild(style);
    document.body.classList.add('has-live-preview');
    const panel=document.createElement('aside');panel.className='live-preview';panel.setAttribute('aria-label','수정 위치 실시간 미리보기');
    const head=document.createElement('div');head.className='live-preview-head';head.append('고객 화면 미리보기');
    const toggle=document.createElement('button');toggle.type='button';toggle.textContent='접기';toggle.setAttribute('aria-expanded','true');head.appendChild(toggle);
    const body=document.createElement('div');body.className='live-preview-body';
    const current=document.createElement('p');current.className='live-preview-current';current.textContent='입력란을 누르면 위치가 표시됩니다.';current.setAttribute('aria-live','polite');
    const status=document.createElement('p');status.className='live-preview-status';status.textContent='입력 중인 초안 · 고객에게는 게시 후 반영';
    const stage=document.createElement('div');stage.className='live-preview-stage';
    const frame=document.createElement('iframe');frame.title='숙소 가이드 초안 미리보기';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.tabIndex=-1;
    const notice=document.createElement('div');notice.className='live-preview-notice';notice.textContent='고객 화면을 불러오는 중…';
    stage.append(frame,notice);body.append(current,status,stage);panel.append(head,body);document.body.appendChild(panel);
    let ready=false,activeInput=null,activeKey='property.name',timer=0,box=null,target=null,previousScreen='';
    const expanded=(value)=>{body.hidden=!value;toggle.textContent=value?'접기':'펼치기';toggle.setAttribute('aria-expanded',String(value))};
    toggle.addEventListener('click',()=>expanded(body.hidden));
    const positionBox=()=>{if(!box||!target||!target.isConnected)return;const rect=target.getBoundingClientRect();box.style.left=(rect.left-5)+'px';box.style.top=(rect.top-5)+'px';box.style.width=(rect.width+10)+'px';box.style.height=(rect.height+10)+'px'};
    function update(){
      if(!ready)return;
      const win=frame.contentWindow,doc=frame.contentDocument,bridge=win.ExtayPreviewGuide;
      const info=targets[activeKey];
      if(!info){box.hidden=true;target=null;notice.hidden=false;notice.textContent=fieldLocations[activeKey]?.[0]||'이 항목은 고객 화면에 직접 표시되지 않습니다.';return}
      const content=collectDraft();
      // Placeholder FAQ exists only inside the iframe, never in the saved draft.
      if(activeKey==='faq')content.faq=[...document.querySelectorAll('.faq-row')].map(row=>({question:row.querySelector('[data-faq="question"]').value||'질문을 입력하세요',answer:row.querySelector('[data-faq="answer"]').value||'답변을 입력하세요'}));
      bridge.apply(content);bridge.stop();bridge.closeContact();
      if(previousScreen!==info[0]){bridge.show(info[0]);previousScreen=info[0]}
      target=doc.querySelector(info[1]);
      if(activeKey==='faq'){
        const index=[...document.querySelectorAll('.faq-row')].indexOf(activeInput?.closest('.faq-row'));
        const row=doc.querySelectorAll('#managedFaqSection details')[Math.max(0,index)];
        if(row){row.open=true;target=row.querySelector(activeInput?.dataset.faq==='answer'?'.faq-answer':'summary')}
      }
      if(activeKey==='images.gallery'&&activeInput){const index=activeInput.value.slice(0,activeInput.selectionStart||0).split('\n').length-1;target=doc.querySelectorAll(info[1])[index]||target}
      if(!target){notice.hidden=false;notice.textContent='표시할 내용이 없습니다. 입력하면 이 위치에 안내문이 나타납니다.';box.hidden=true;return}
      notice.hidden=true;box.hidden=false;
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      positionBox();requestAnimationFrame(positionBox);
    }
    frame.addEventListener('load',()=>{
      const win=frame.contentWindow,doc=frame.contentDocument;
      if(!win.ExtayPreviewGuide){notice.textContent='미리보기를 불러오지 못했습니다. 관리자 페이지를 새로고침해 주세요.';return}
      const sheet=doc.createElement('style');sheet.textContent='html{scroll-behavior:auto!important}*{animation:none!important;transition:none!important}.brand-intro,#conciergeWidget,#chatPanel,#chatBackdrop,#aiConcierge,#openChatTop{display:none!important}[data-motion],.is-visible,.motion-ready{opacity:1!important;transform:none!important}.screen.active *{opacity:1!important;visibility:visible!important}';doc.head.appendChild(sheet);
      // The embedded view is read-only: links/forms cannot navigate or call AI.
      doc.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation()},true);
      doc.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation()},true);
      box=doc.createElement('div');box.id='adminPreviewHighlight';box.style.cssText='position:fixed;z-index:99999;pointer-events:none;border:3px solid #dd7034;border-radius:8px;background:rgba(255,164,70,.10);box-shadow:0 0 0 2px white;box-sizing:border-box;';doc.body.appendChild(box);
      doc.addEventListener('scroll',positionBox,true);win.addEventListener('resize',positionBox);doc.addEventListener('load',positionBox,true);
      ready=true;update();
    });
    frame.src='/guide-extay?admin-embed=1';
    const selectInput=(input)=>{if(!input?.matches('[data-field],[data-faq]'))return;activeInput?.classList.remove('live-preview-selected');activeInput=input;input.classList.add('live-preview-selected');activeKey=input.dataset.field||'faq';current.textContent=(input.closest('label')?.firstChild?.textContent||'수정 위치').trim();expanded(true);update()};
    document.getElementById('contentAdmin').addEventListener('focusin',event=>selectInput(event.target));
    document.getElementById('contentAdmin').addEventListener('input',event=>{if(!event.target.matches('[data-field],[data-faq]'))return;clearTimeout(timer);timer=setTimeout(update,120)});
    document.getElementById('faqEditor').addEventListener('click',()=>{clearTimeout(timer);timer=setTimeout(update,0)});
  }};
})();

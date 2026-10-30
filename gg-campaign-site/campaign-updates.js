/* 기존 script.js / content/site.json 유지. 표시만 개선합니다. */
(function(){
  const channels=[['instagramUrl','인스타그램','◎','instagram'],['facebookUrl','페이스북','f','facebook'],['telegramUrl','텔레그램','➤','telegram'],['youtubeUrl','유튜브','▶','youtube']];
  function rearrange(){
    const voice=document.getElementById('voice'),pledges=document.getElementById('pledges');
    if(voice && pledges && voice.previousElementSibling!==pledges)pledges.insertAdjacentElement('afterend',voice);
    const candidates=document.getElementById('candidates');
    if(candidates && !document.getElementById('snsQuick')){
      const sec=document.createElement('section');sec.id='snsQuick';sec.className='sns-quick';sec.setAttribute('aria-label','SNS 소통채널');
      sec.innerHTML='<div class="container"><div class="sns-wrap"><p class="sns-heading">기호 2번, SNS로 더 가까이 소통합니다</p><div class="sns-list" id="snsList"></div></div></div>';
      candidates.parentNode.insertBefore(sec,candidates);
    }
  }
  function renderSocial(data){
    const list=document.getElementById('snsList');if(!list)return;
    const safe=s=>{try{const u=new URL(s);return u.protocol==='https:'||u.protocol==='http:'?u.href:null}catch(e){return null}};
    list.replaceChildren();
    channels.forEach(([key,label,symbol,cls])=>{
      const url=safe(data[key]);const el=document.createElement(url?'a':'div');el.className='sns-item '+(url?'':'is-pending');
      if(url){el.href=url;el.target='_blank';el.rel='noopener noreferrer'}
      const symbolEl=document.createElement('span');symbolEl.className='sns-symbol';symbolEl.textContent=symbol;
      const words=document.createElement('span');words.className='sns-words';
      const title=document.createElement('span');title.className='sns-title';title.textContent=label;words.append(title);
      if(!url){const pending=document.createElement('span');pending.className='sns-pending';pending.textContent='준비 중';words.append(pending)}
      el.append(symbolEl,words);list.append(el);
    });
  }
  function wrapMobileDetails(){
    document.querySelectorAll('#candidateGrid .candidate-info').forEach(info=>{
      const target=info.querySelector('.career');if(!target||target.closest('details'))return;
      const detail=document.createElement('details');detail.className='mobile-details';
      const summary=document.createElement('summary');summary.textContent='주요 약력 보기';detail.append(summary);
      target.parentNode.insertBefore(detail,target);detail.append(target);
    });
    document.querySelectorAll('#pledgeGrid .pledge-card').forEach(card=>{
      const target=card.querySelector('p');if(!target||target.closest('details'))return;
      const detail=document.createElement('details');detail.className='mobile-details';
      const summary=document.createElement('summary');summary.textContent='공약 자세히 보기';detail.append(summary);
      target.parentNode.insertBefore(detail,target);detail.append(target);
    });
  }
  function init(){
    rearrange();
    const obs=new MutationObserver(()=>wrapMobileDetails());
    ['candidateGrid','pledgeGrid'].forEach(id=>{const x=document.getElementById(id);if(x)obs.observe(x,{childList:true,subtree:true})});
    wrapMobileDetails();
    fetch('content/site.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(renderSocial).catch(()=>renderSocial({}));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

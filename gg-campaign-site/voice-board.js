/* 익명 공개 게시판: 사용자 데이터는 textContent로 출력하여 스크립트 실행을 방지합니다. */
(()=>{
  const $=s=>document.querySelector(s);
  const endpoint='/.netlify/functions/board';
  let posts=[], visible=6, secret=sessionStorage.getItem('gg_board_admin_token')||'';
  const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;};
  const date=s=>{try{return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(s));}catch{return '';}};
  function setStatus(id,message,error=false){const x=$(id);x.textContent=message;x.classList.toggle('board-error',error);}
  async function api(method='GET',data=null,admin=false){
    const headers={'Accept':'application/json'};
    if(data)headers['Content-Type']='application/json';
    if(admin&&secret)headers['Authorization']='Bearer '+secret;
    const response=await fetch(endpoint+(admin&&method==='GET'?'?admin=1':''),{method,headers,body:data?JSON.stringify(data):undefined,cache:'no-store'});
    let parsed={};try{parsed=await response.json();}catch{}
    if(!response.ok)throw Error(parsed.error||'서버와 연결할 수 없습니다.');
    return parsed;
  }
  const isAdmin=()=>!!secret;
  function button(text, fn,cls='board-small-btn'){const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;}
  function render(){
    const list=$('#boardList');list.replaceChildren();
    const items=posts.slice(0,visible);
    if(!items.length){list.append(el('p','board-empty','아직 등록된 의견이 없습니다. 첫 번째 목소리를 남겨주세요.'));}
    for(const p of items){
      const card=el('article','board-post'+(p.hidden?' board-post-hidden':''));
      const meta=el('div','board-meta');meta.append(el('span','board-anon','익명'),el('span','board-topic',p.topic),el('time','board-date',date(p.createdAt)));
      if(p.hidden)meta.append(el('span','board-hidden-mark','숨긴 글'));
      const title=el('h4','board-post-title',p.subject);
      const body=el('p','board-post-body',p.message);
      card.append(meta,title,body);
      if(p.reply){const reply=el('div','board-reply');reply.append(el('strong','board-reply-title','기호 2번 선본 답변'),el('p','board-post-body',p.reply),el('small','board-date',date(p.repliedAt)));card.append(reply);}
      else card.append(el('p','board-reply-pending','선본 답변 대기 중'));
      if(isAdmin()){
        const actions=el('div','board-post-actions');
        actions.append(button(p.reply?'답변 수정':'답변 작성',()=>replyEditor(card,p)));
        actions.append(button(p.hidden?'다시 공개':'숨기기',async()=>{
          if(!confirm(p.hidden?'이 글을 다시 공개할까요?':'이 글을 전체 공개 목록에서 숨길까요?'))return;
          await update({id:p.id,action:p.hidden?'show':'hide'});
        }));
        actions.append(button('완전 삭제',async()=>{
          if(!confirm('글과 답변을 완전히 삭제할까요? 복구할 수 없습니다.'))return;
          await update({id:p.id},'DELETE');
        },'board-danger-btn'));
        card.append(actions);
      }
      list.append(card);
    }
    $('#boardMore').hidden=posts.length<=visible;
  }
  function replyEditor(card,p){
    card.querySelector('.board-reply-editor')?.remove();
    const box=el('div','board-reply-editor'),title=el('strong','','선본 답변 작성'),textarea=el('textarea');
    textarea.maxLength=1500;textarea.rows=4;textarea.value=p.reply||'';textarea.placeholder='현장의 의견에 대한 답변을 작성해 주세요.';
    const bar=el('div','board-post-actions');bar.append(button('답변 등록',async()=>{
      if(!textarea.value.trim())return alert('답변을 입력해 주세요.');
      await update({id:p.id,action:'reply',reply:textarea.value});
    }),button('취소',()=>box.remove()));box.append(title,textarea,bar);card.append(box);textarea.focus();
  }
  async function update(data,method='PATCH'){
    try{await api(method,data,true);setStatus('#boardAdminStatus','변경사항이 저장되었습니다.');await load();}
    catch(e){setStatus('#boardAdminStatus',e.message,true);if(/비밀번호/.test(e.message))logout();}
  }
  async function load(){
    const list=$('#boardList');if(!posts.length)list.replaceChildren(el('p','board-empty','의견을 불러오는 중입니다.'));
    try{const result=await api('GET',null,isAdmin());posts=result.posts||[];render();}
    catch(e){if(isAdmin()&&/인증/.test(e.message)){logout();return load();}list.replaceChildren(el('p','board-empty board-error',e.message));}
  }
  function toggleAdminUi(){const inSession=isAdmin();$('#boardAdminLogin').hidden=inSession;$('#boardAdminActions').hidden=!inSession;}
  function logout(){secret='';sessionStorage.removeItem('gg_board_admin_token');toggleAdminUi();setStatus('#boardAdminStatus','로그아웃되었습니다.');load();}
  document.addEventListener('DOMContentLoaded',()=>{
    const form=$('#publicVoiceForm');if(!form)return;
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(!form.reportValidity())return;
      const btn=$('#boardSubmit');btn.disabled=true;setStatus('#boardFormStatus','등록하고 있습니다…');
      try{
        await api('POST',{topic:$('#boardTopic').value,subject:$('#boardSubject').value,message:$('#boardMessage').value,company:$('#boardCompany').value,agree:$('#boardPublicAgree').checked});
        form.reset();visible=6;setStatus('#boardFormStatus','등록 완료! 작성한 의견이 공개되었습니다.');await load();
      }catch(e){setStatus('#boardFormStatus',e.message,true);}
      finally{btn.disabled=false;}
    });
    $('#boardRefresh').addEventListener('click',load);
    $('#boardMore').addEventListener('click',()=>{visible+=6;render();});
    $('#boardAdminToggle').addEventListener('click',()=>{
      const panel=$('#boardAdminPanel');panel.hidden=!panel.hidden;$('#boardAdminToggle').setAttribute('aria-expanded',String(!panel.hidden));
    });
    $('#boardLogin').addEventListener('click',async()=>{
      const candidate=$('#boardPassword').value.trim();if(!candidate)return setStatus('#boardAdminStatus','비밀번호를 입력해 주세요.',true);
      secret=candidate;
      try{
        const result=await api('GET',null,true);posts=result.posts||[];
        sessionStorage.setItem('gg_board_admin_token',secret);$('#boardPassword').value='';toggleAdminUi();
        setStatus('#boardAdminStatus','관리자 로그인 완료. 글에 답변을 달거나 숨길 수 있습니다.');render();
      }catch(e){secret='';setStatus('#boardAdminStatus',e.message,true);}
    });
    $('#boardPassword').addEventListener('keydown',e=>{if(e.key==='Enter'){$('#boardLogin').click();}});
    $('#boardLogout').addEventListener('click',logout);
    toggleAdminUi();load();
  });
})();

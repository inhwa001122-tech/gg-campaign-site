import { getStore } from '@netlify/blobs';
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const TOPICS = new Set(['현장 요구 · 공약 제안','후보에게 질문','현장 고충 · 상담','응원 · 기타']);
const json = (payload, status=200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }
});
const adminSecret = () => process.env.BOARD_ADMIN_SECRET || '';
function authorized(request){
  const secret=adminSecret(), supplied=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(secret.length<12 || supplied.length<12 || supplied.length>500) return false;
  const a=createHash('sha256').update(secret).digest();
  const b=createHash('sha256').update(supplied).digest();
  return timingSafeEqual(a,b);
}
const store = () => getStore({ name:'gg-voice-public-board-v1', consistency:'strong' });
const rateStore = () => getStore({ name:'gg-voice-board-rate-v1', consistency:'strong' });
const validId = id => /^\d{14}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id||''));
async function payload(request){
  const len=Number(request.headers.get('content-length')||0);
  if (len>12000) throw new Error('내용이 너무 깁니다.');
  const txt=await request.text();
  if(txt.length>12000) throw new Error('내용이 너무 깁니다.');
  try { const value=JSON.parse(txt); if(!value || typeof value!=='object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new Error('올바르지 않은 요청입니다.'); }
}
function originOkay(request){
  const origin=request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
function cleaned(value){ return typeof value === 'string' ? value.trim() : ''; }
function containsContact(s){return /[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}/.test(s)||/(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(s);}
function safeError(e){console.error('Board handler error:', e?.message || String(e));return json({error:'게시판 연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.'},500);}

export default async function handler(request){
  try {
    if(!originOkay(request)) return json({error:'허용되지 않은 요청입니다.'},403);
    const url=new URL(request.url);
    if (request.method==='GET') {
      const admin=url.searchParams.get('admin')==='1';
      if(admin&&!authorized(request)) return json({error:'관리자 인증이 필요합니다.'},401);
      const board=store();
      const {blobs}=await board.list({prefix:'posts/'});
      // 최근 160개 게시물을 표시합니다. 숨김 자료는 공개 화면으로 전달하지 않습니다.
      const keys=blobs.map(b=>b.key).sort().reverse().slice(0,160);
      const records=(await Promise.all(keys.map(k=>board.get(k,{type:'json'})))).filter(Boolean)
        .filter(p=>admin||!p.hidden).map(p=>({
          id:p.id,topic:p.topic,subject:p.subject,message:p.message,
          createdAt:p.createdAt,reply:p.reply||'',repliedAt:p.repliedAt||null,...(admin?{hidden:!!p.hidden}:{})
        }));
      return json({posts:records});
    }
    if (request.method==='POST') {
      if(adminSecret().length<12) return json({error:'게시판 설정이 완료되지 않았습니다. 선본 관리자에게 문의해 주세요.'},503);
      const input=await payload(request);
      if (input.company) return json({ok:true}); // 봇용 숨김 입력란
      const topic=cleaned(input.topic), subject=cleaned(input.subject), message=cleaned(input.message);
      if(!TOPICS.has(topic)||subject.length<2||subject.length>100||message.length<5||message.length>2000)
        return json({error:'의견 종류, 제목(2~100자), 내용(5~2000자)을 확인해 주세요.'},400);
      if(!input.agree) return json({error:'공개 게시판 안내에 동의해 주세요.'},400);
      if(containsContact(subject+' '+message)) return json({error:'이메일 주소나 휴대전화 번호는 공개 게시판에 작성하지 말아주세요.'},400);
      if((message.match(/https?:\/\//ig)||[]).length>1) return json({error:'주소 링크는 한 개까지만 작성할 수 있습니다.'},400);
      // IP 원문은 저장하지 않고, 일자별로 교체되는 HMAC 해시만 도배 방지에 이용합니다.
      const ip=request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
      const day=new Date().toISOString().slice(0,10), minute=Math.floor(Date.now()/60000);
      const digest=createHmac('sha256',adminSecret()).update(day+'|'+ip).digest('hex');
      const rateKey=`rate/${day}/${digest}/${minute}`;
      const claimed=await rateStore().set(rateKey,'1',{onlyIfNew:true});
      if(!claimed.modified) return json({error:'잠시 후 다시 작성해 주세요. 동일 접속에서 1분에 한 번만 등록할 수 있습니다.'},429);
      const id=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+randomUUID();
      const post={id,topic,subject,message,createdAt:new Date().toISOString(),reply:'',repliedAt:null,hidden:false};
      await store().setJSON('posts/'+id,post,{onlyIfNew:true});
      return json({ok:true,id},201);
    }
    if (request.method==='PATCH' || request.method==='DELETE') {
      if(!authorized(request)) return json({error:'관리자 비밀번호가 올바르지 않습니다.'},401);
      const input=await payload(request),id=cleaned(input.id);
      if(!validId(id)) return json({error:'게시물 번호가 올바르지 않습니다.'},400);
      const board=store(), key='posts/'+id;
      const post=await board.get(key,{type:'json'});
      if(!post) return json({error:'게시글을 찾을 수 없습니다.'},404);
      if(request.method==='DELETE') { await board.delete(key);return json({ok:true}); }
      const action=cleaned(input.action);
      if(action==='reply'){
        const reply=cleaned(input.reply);
        if(reply.length<1 || reply.length>1500) return json({error:'답변은 1~1500자로 작성해 주세요.'},400);
        post.reply=reply;post.repliedAt=new Date().toISOString();
      }else if(action==='hide'){post.hidden=true;}
      else if(action==='show'){post.hidden=false;}
      else return json({error:'지원하지 않는 작업입니다.'},400);
      await board.setJSON(key,post);
      return json({ok:true});
    }
    return json({error:'지원하지 않는 요청입니다.'},405);
  } catch(e) {
    if(e.message==='올바르지 않은 요청입니다.'||e.message==='내용이 너무 깁니다.') return json({error:e.message},400);
    return safeError(e);
  }
}

const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto');
let PDF;try{PDF=require('pdfkit')}catch{}
const PORT=process.env.PORT||3000,TZ=process.env.TZ_NAME||'Asia/Dushanbe',AUTO_H=Number(process.env.AUTOCLOSE_HOURS||3);
const DB=process.env.DATA_FILE||path.join(__dirname,'data.json');
const H=p=>crypto.createHash('sha256').update('rst:'+p).digest('hex');
const base=()=>process.env.BASE_URL||(process.env.RAILWAY_PUBLIC_DOMAIN?'https://'+process.env.RAILWAY_PUBLIC_DOMAIN:'');
const seed={settings:{restaurant:'Ресторан',currency:'TJS',token:'',adminChat:'',kitchenChat:'',barChat:'',botName:'',passHash:'',open:'',close:'',closedMsg:'Сейчас мы закрыты. Приходите в рабочие часы!',payInfo:'',promoTitle:'',promoText:'',promoImg:'',dayDish:'',backupTime:'03:00'},
tables:[{id:'1',name:'Стол 1'}],
cats:[['first','Первые блюда'],['second','Вторые блюда'],['dessert','Десерты'],['drink','Напитки'],['salad','Салаты и закуски'],['roll','Роллы'],['pizza','Пицца']].map(([id,t])=>({id,t,img:id})),
dishes:[['d1','first','Борщ с говядиной','Классический борщ с нежной говядиной и сметаной.',89,'d1',1],['d2','second','Паста Карбонара','Паста с беконом, сливочным соусом и пармезаном.',110,'d2',1],['d3','second','Стейк из говядины','Сочный стейк с овощами гриль и соусом.',180,'d3',1],['d4','dessert','Чизкейк','Нежный чизкейк с ягодами и соусом.',65,'d4',1],['d5','drink','Лимонад цитрусовый','Апельсин, лимон, мята.',35,'drink',0],['d6','salad','Салат свежий','Овощи, зелень, оливковое масло.',55,'salad',0],['d7','roll','Ролл Филадельфия','Лосось, сливочный сыр, огурец.',95,'roll',0],['d8','pizza','Пицца Маргарита','Томаты, моцарелла, базилик.',99,'pizza',0]].map(([id,c,n,d,p,img,pop])=>({id,c,n,d,p,img,pop,dest:c==='drink'?'bar':'kitchen',tags:[],mods:''})),
waiters:[],admins:[],orders:{},jobs:[],seq:1};
let db;try{db=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{db=JSON.parse(JSON.stringify(seed))}
function norm(){db.settings={...seed.settings,...db.settings};for(const k of['tables','cats','dishes','waiters','admins','jobs','log'])db[k]=db[k]||[];
 if(Array.isArray(db.orders))db.orders=Object.fromEntries(db.orders.filter(Boolean).map(o=>[o.id,o]));db.orders=db.orders||{};db.seq=db.seq||1;
 Object.values(db.orders).forEach(o=>{o.items=o.items||[];o.m={admin:[],waiters:[],calls:[],kitchen:[],client:null,...(o.m||{})}});
 db.dishes.forEach(d=>{if(d.stop){d.status='out';d.stop=0}d.status=d.status||'';d.tags=d.tags||[]});
 db.settings.token=db.settings.token||process.env.BOT_TOKEN||'';db.settings.adminChat=db.settings.adminChat||process.env.ADMIN_CHAT_ID||''}
norm();
/* ---------- Firebase Realtime Database (по желанию) ---------- */
const FB=(()=>{let u=process.env.FIREBASE_DB_URL||'';try{const m=fs.readFileSync(path.join(__dirname,'index.html'),'utf8').match(/databaseURL:\s*"([^"]+)"/);u=u||(m&&m[1])||''}catch{}return u.replace(/\/$/,'')})();
let GA=null;
async function fbUrl(p){let q='';
 if(process.env.FIREBASE_SERVICE_ACCOUNT){try{GA=GA||new(require('google-auth-library').GoogleAuth)({credentials:JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT),scopes:['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email']});q='?access_token='+await GA.getAccessToken()}catch(e){console.log('firebase auth',e.message)}}
 else if(process.env.FIREBASE_SECRET)q='?auth='+process.env.FIREBASE_SECRET;
 return `${FB}/${p}.json${q}`}
const fbGet=async p=>{try{const r=await fetch(await fbUrl(p));return r.ok?await r.json():undefined}catch(e){console.log('fbGet',e.message);return undefined}};
const fbPut=async(p,v)=>{try{const r=await fetch(await fbUrl(p),{method:'PUT',body:JSON.stringify(v)});if(!r.ok)console.log('fbPut',r.status)}catch(e){console.log('fbPut',e.message)}};
let fbT=null;const flushFb=async()=>{if(fbT){clearTimeout(fbT);fbT=null}await fbPut('restaurant',db)};
const save=()=>{try{fs.writeFileSync(DB,JSON.stringify(db))}catch(e){console.log('save',e.message)}if(FB&&!fbT)fbT=setTimeout(()=>{fbT=null;fbPut('restaurant',db)},3000)};
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const chats=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean),adminChats=()=>chats(db.settings.adminChat),isAdm=c=>adminChats().includes(String(c));
const isKit=c=>[...chats(db.settings.kitchenChat),...chats(db.settings.barChat)].includes(String(c));
let lastErr='',lastPoll=Date.now(),botDown=0,lastRestart=0,downNote='';
const dst=d=>d.status==='out'?'out':d.status==='cooking'&&d.readyAt>Date.now()?'cooking':'';
const logAct=(who,a)=>{db.log.push({t:Date.now(),who,a});if(db.log.length>3000)db.log.splice(0,db.log.length-3000)};
const FN={n:'название',p:'цена',c:'каталог',status:'статус',dest:'кухня/бар',d:'описание',pop:'популярное',hit:'хит',mods:'допы',tags:'метки',weight:'вес',kcal:'ккал',time:'время',allergens:'аллергены',img:'фото',name:'название',t:'название',fio:'ФИО',phone:'телефон',username:'username',tables:'столы',role:'роль',n_tg:'перевод (тадж.)',n_en:'перевод (en)',d_tg:'описание (тадж.)',d_en:'описание (en)',t_tg:'перевод (тадж.)',t_en:'перевод (en)'};
const SEC={tables:'Стол',cats:'Каталог',dishes:'Блюдо',waiters:'Официант',admins:'Админ'};
const SFN={restaurant:'название',currency:'валюта',adminChat:'chat ID админов',kitchenChat:'chat ID кухни',barChat:'chat ID бара',open:'открытие',close:'закрытие',closedMsg:'сообщение вне часов',promoTitle:'акция: заголовок',promoText:'акция: текст',dayDish:'блюдо дня',backupTime:'время автобэкапа'};
function diff(sec,a,b){
 const out=[],ma=new Map(a.map(x=>[x.id,x])),mb=new Map(b.map(x=>[x.id,x])),nm=x=>x.n||x.name||x.t||x.fio||x.id;
 for(const x of b){const o=ma.get(x.id);if(!o){out.push(`➕ ${SEC[sec]}: «${nm(x)}»`);continue}
  const ch=[];for(const k of new Set([...Object.keys(x),...Object.keys(o)])){if(['chatId','hash','pass','id','hasPass','readyAt','readyMin','stop'].includes(k))continue;
   if(JSON.stringify(o[k]??'')!==JSON.stringify(x[k]??''))ch.push(['p','status','n','name','t','fio'].includes(k)?`${FN[k]||k}: ${o[k]||'—'} → ${x[k]||'—'}`:(FN[k]||k))}
  if(ch.length)out.push(`✏️ ${SEC[sec]} «${nm(o)}»: ${ch.join(', ')}`)}
 for(const x of a)if(!mb.has(x.id))out.push(`🗑 ${SEC[sec]}: удалено «${nm(x)}»`);
 return out}
const hits=new Map();function limit(k,max,ms){const n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);a.push(n);hits.set(k,a);return a.length>max}
/* ---------- Telegram ---------- */
async function tg(m,p={}){const t=db.settings.token;if(!t)return null;
 try{const r=await fetch(`https://api.telegram.org/bot${t}/${m}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}),j=await r.json();
  if(!j.ok){lastErr=m+': '+j.description;if(!/not modified|not found|can't be deleted/.test(j.description))console.log(m,j.description)}return j.ok?j.result:null}catch(e){lastErr=m+': '+e.message;console.log(m,e.message);return null}}
const send=(c,t,kb)=>tg('sendMessage',{chat_id:c,text:t,parse_mode:'HTML',...(kb&&kb.length&&{reply_markup:{inline_keyboard:kb}})});
const edit=(c,id,t,kb)=>tg('editMessageText',{chat_id:c,message_id:id,text:t,parse_mode:'HTML',reply_markup:{inline_keyboard:kb||[]}});
const del=(c,id)=>c&&id?tg('deleteMessage',{chat_id:c,message_id:id}):null;
async function sendDoc(c,buf,name,cap,type='application/pdf'){const f=new FormData();f.append('chat_id',String(c));f.append('caption',cap);f.append('document',new Blob([buf],{type}),name);
 return fetch(`https://api.telegram.org/bot${db.settings.token}/sendDocument`,{method:'POST',body:f}).catch(()=>{})}
/* ---------- Тексты ---------- */
const PAY={cash:'Наличные',card:'Карта',qr:'QR-перевод'};
const unit=i=>i.p+(i.mp||0),sum=o=>o.items.reduce((s,i)=>s+unit(i)*i.q,0),grand=o=>sum(o)+(o.tip||0),money=n=>n+' '+db.settings.currency;
const tn=o=>(db.tables.find(t=>t.id==o.table)||{name:'Стол '+o.table}).name,wOf=o=>db.waiters.find(w=>w.id===o.waiter);
const mods=i=>i.mods&&i.mods.length?' <i>('+esc(i.mods.join(', '))+')</i>':'';
const line=i=>`${i.served?'✅':i.ready?'🍽':'•'} ${esc(i.n)}${mods(i)} × ${i.q} — ${money(unit(i)*i.q)}`;
const body=o=>o.items.map(line).join('\n')+`\n\n<b>Итого: ${money(sum(o))}</b>`+(o.tip?`\n💝 Чаевые: ${money(o.tip)}`:'')+(o.note?`\n💬 ${esc(o.note)}`:'');
const stLine=o=>({new:'\n\n⏳ Ожидает подтверждения',confirmed:'\n\n✅ Подтверждён, ждём официанта',accepted:`\n\n👤 Принял: ${esc((wOf(o)||{}).fio)}`+(o.bill?`\n🧾 <b>Просят счёт</b> · ${PAY[o.pay]||''} · к оплате ${money(grand(o))}`:''),closed:o.rejected?'\n\n❌ Отклонён':'\n\n🔒 Закрыт'})[o.status];
const staff=o=>`🔔 <b>Заказ №${o.id} — ${esc(tn(o))}</b>\n\n${body(o)}${stLine(o)}`;
const webBtn=(t,o)=>{const url=`${base()}/?table=${encodeURIComponent(o.table)}&order=${o.id}&tg=1`;return base().startsWith('https')?{text:t,web_app:{url}}:{text:t,url}};
function kb(o,r){
 if(r==='a')return o.status==='new'?[[{text:'✅ Подтвердить',callback_data:'ok:'+o.id},{text:'❌ Отклонить',callback_data:'no:'+o.id}]]:[];
 if(o.status==='confirmed')return[[{text:'✋ Получить',callback_data:'get:'+o.id}]];
 if(o.status!=='accepted')return[];
 const rows=o.items.map((i,x)=>i.served?null:[{text:'✔ Подано: '+i.n.slice(0,30),callback_data:`srv:${o.id}:${x}`}]).filter(Boolean).slice(0,12);
 return[...rows,[{text:'🔒 Закрыть заказ',callback_data:'close:'+o.id},{text:'↩️ Отменить принятие',callback_data:'unget:'+o.id}],[webBtn('➕ Добавить блюдо',o)]];
}
async function clientMsg(o,editOnly){
 if(!o.client||o.status==='closed')return;
 const acc=o.status==='accepted',k=o.items.filter(i=>i.b);
 const stage=k.length?(k.every(i=>i.ready)?'\n\n🍽 <b>Всё готово — несём к столу</b>':'\n\n👨‍🍳 Готовится'):'';
 const txt=`🧾 <b>Ваш заказ — ${esc(tn(o))}</b>\n\n${body(o)}${stage}`+(acc?`\n\n<b>Официант ${esc((wOf(o)||{}).fio)} принял ваш заказ</b>`:'');
 const r1=[];if(acc){r1.push({text:'🔔 Вызвать официанта',callback_data:'call:'+o.id});if(!o.bill)r1.push({text:'🧾 Попросить счёт',callback_data:'bill:'+o.id})}
 const k2=[...(r1.length?[r1]:[]),[webBtn('➕ Добавить ещё',o)]];
 if(editOnly&&o.m.client){await edit(o.client,o.m.client,txt,k2);return}
 await del(o.client,o.m.client);const r=await send(o.client,txt,k2);o.m.client=r&&r.message_id;
}
async function refresh(o){
 for(const m of o.m.admin)await edit(m.c,m.id,staff(o),kb(o,'a'));
 for(const m of o.m.waiters)await edit(m.c,m.id,staff(o),kb(o,'w'));
 await clientMsg(o,true);
}
const wFor=o=>{const all=db.waiters.filter(w=>w.chatId),z=all.filter(w=>!String(w.tables||'').trim()||String(w.tables).split(/[,\s]+/).includes(String(o.table)));return z.length?z:all};
async function notifyWaiters(o){o.m.waiters=[];for(const w of wFor(o)){const r=await send(w.chatId,staff(o),kb(o,'w'));if(r)o.m.waiters.push({c:w.chatId,id:r.message_id})}}
async function sendKitchen(o){
 for(const dest of['kitchen','bar']){
  const chat=chats(db.settings[dest+'Chat'])[0],items=o.items.filter(i=>(i.dest||'kitchen')===dest&&!i.b);
  if(!chat||!items.length)continue;
  const b=o.bn=(o.bn||0)+1;items.forEach(i=>i.b=b);
  const r=await send(chat,`${dest==='bar'?'🍹 Бар':'🍳 Кухня'} — <b>${esc(tn(o))}</b>, заказ №${o.id}\n\n`+items.map(i=>`• ${esc(i.n)}${mods(i)} × ${i.q}`).join('\n')+(o.note?`\n💬 ${esc(o.note)}`:''),[[{text:'✅ Готово',callback_data:`rdy:${o.id}:${b}`}]]);
  if(r)(o.m.kitchen=o.m.kitchen||[]).push({c:chat,id:r.message_id,b});
 }
}
/* ---------- Чек PDF ---------- */
const wrap=(s,w)=>{const out=[];let l='';for(const x of String(s).split(' ')){if((l+' '+x).trim().length>w){out.push(l);l=x}else l=(l+' '+x).trim()}out.push(l);return out};
function receipt(o){return new Promise(ok=>{
 if(!PDF)return ok(null);
 const W=38,s=db.settings,c=t=>' '.repeat(Math.max(0,(W-t.length)>>1))+t,dash='-'.repeat(W),w=wOf(o),row=(a,b)=>a+' '.repeat(Math.max(1,W-a.length-b.length))+b;
 const d=new Date(o.created).toLocaleString('ru-RU',{timeZone:TZ});
 const L=[...wrap(s.restaurant.toUpperCase(),W).map(c),c('КАССОВЫЙ ЧЕК'),dash,'Чек №'+String(o.id).padStart(6,'0'),'Дата: '+d,'Стол: '+tn(o),...(w?['Официант: '+w.fio]:[]),dash];
 o.items.forEach(i=>{wrap(i.n,W).forEach(x=>L.push(x));if(i.mods&&i.mods.length)wrap('+ '+i.mods.join(', '),W-2).forEach(x=>L.push('  '+x));L.push(row(`${i.q} x ${unit(i)}`,String(unit(i)*i.q)))});
 L.push(dash);if(o.tip){L.push(row('Сумма',String(sum(o))),row('Чаевые',String(o.tip)))}
 L.push(row('ИТОГО, '+s.currency,String(grand(o))),...(o.pay?['Оплата: '+PAY[o.pay]]:[]),'='.repeat(W),c('СПАСИБО ЗА ВИЗИТ!'),c('Ждём вас снова'));
 const Hh=L.length*11+90,doc=new PDF({size:[226,Hh],margin:0}),ch=[];
 doc.on('data',b=>ch.push(b));doc.on('end',()=>ok(Buffer.concat(ch)));
 try{doc.registerFont('m',require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf'));doc.font('m')}catch{doc.font('Courier')}
 doc.fontSize(7.5);L.forEach((t,i)=>doc.text(t,12,14+i*11,{lineBreak:false}));
 let x=30,sd=o.id*7919+13;while(x<196){sd=(sd*1103515245+12345)&0x7fffffff;const bw=1+sd%3;doc.rect(x,Hh-62,bw,34).fill('#000');x+=bw+1+(sd>>5)%2}
 doc.fontSize(7).text(String(o.id).padStart(12,'0'),12,Hh-20,{width:202,align:'center',lineBreak:false});doc.end()})}
/* ---------- Закрытие ---------- */
async function closeOrder(o,{rejected}={}){
 o.status='closed';o.closedAt=Date.now();o.rejected=!!rejected;
 db.jobs=db.jobs.filter(j=>j.oid!==o.id&&!(o.m.calls||[]).includes(j.id));
 for(const m of[...o.m.admin,...o.m.waiters])await edit(m.c,m.id,staff(o),[]);
 if(o.client){
  await del(o.client,o.m.client);for(const id of o.m.calls)await del(o.client,id);o.m.client=null;o.m.calls=[];
  if(rejected)await send(o.client,'К сожалению, ваш заказ отклонён. Обратитесь к официанту.');
  else{
   await send(o.client,`Спасибо, что выбрали наш ресторан <b>«${esc(db.settings.restaurant)}»</b> 🙏`);
   const pdf=await receipt(o);if(pdf)await sendDoc(o.client,pdf,`check-${o.id}.pdf`,'🧾 Ваш чек');
   await send(o.client,'Оцените, пожалуйста, наш сервис:',[[1,2,3,4,5].map(n=>({text:n+'⭐',callback_data:`rate:${o.id}:${n}`}))]);
  }
 }
 save();
}
/* ---------- Callbacks ---------- */
const pend={};
const stopKb=()=>db.dishes.slice(0,80).map(d=>[{text:(dst(d)==='out'?'🔴 ':dst(d)==='cooking'?'🟡 ':'🟢 ')+d.n,callback_data:'stp:'+d.id}]);
async function onCb(q){
 const [a,id,x]=q.data.split(':'),chat=q.message.chat.id,mid=q.message.message_id,ans=t=>tg('answerCallbackQuery',{callback_query_id:q.id,text:t});
 if(a==='stp'){if(!isAdm(chat)&&!isKit(chat))return ans('Нет доступа');const d=db.dishes.find(d=>d.id===id);if(d){d.status=d.status==='out'?'':'out';d.readyAt=0;logAct('Telegram '+(isAdm(chat)?'админ':'кухня')+' '+chat,`Статус блюда «${d.n}»: ${d.status==='out'?'закончилось':'в наличии'}`);save();await tg('editMessageReplyMarkup',{chat_id:chat,message_id:mid,reply_markup:{inline_keyboard:stopKb()}})}return ans(d&&d.status==='out'?'Блюдо: закончилось':'Блюдо доступно')}
 const o=db.orders[id];if(!o)return ans('Заказ не найден');
 const wk=db.waiters.find(w=>String(w.chatId)===String(chat)),adm=isAdm(chat),mine=String(chat)===String(o.client);o.last=Date.now();
 if(a==='ok'){
  if(!adm)return ans('Нет доступа');if(o.status!=='new')return ans('Уже обработан');
  o.status='confirmed';await notifyWaiters(o);await sendKitchen(o);db.jobs.push({type:'remind',oid:o.id,at:Date.now()+150000,n:1});
  save();await refresh(o);return ans(o.m.waiters.length?'Отправлено официантам':'Нет подключённых официантов!');
 }
 if(a==='no'){if(!adm||o.status!=='new')return ans('Недоступно');await ans('Отклонён');return closeOrder(o,{rejected:true})}
 if(a==='get'){
  if(!wk)return ans('Нет доступа');
  if(o.status!=='confirmed'){await del(chat,mid);return ans('Заказ уже принят другим официантом')}
  o.status='accepted';o.waiter=wk.id;db.jobs=db.jobs.filter(j=>j.oid!==o.id);
  for(const m of o.m.waiters)if(String(m.c)!==String(chat))await del(m.c,m.id);
  o.m.waiters=o.m.waiters.filter(m=>String(m.c)===String(chat));save();
  await ans('Вы приняли заказ');await refresh(o);await clientMsg(o);save();return;
 }
 if(a==='unget'){
  if(!wk||o.waiter!==wk.id||o.status!=='accepted')return ans('Недоступно');
  o.status='confirmed';o.waiter=null;await ans('Принятие отменено');
  for(const m of o.m.waiters)await del(m.c,m.id);await notifyWaiters(o);db.jobs.push({type:'remind',oid:o.id,at:Date.now()+150000,n:1});
  save();for(const m of o.m.admin)await edit(m.c,m.id,staff(o),[]);await clientMsg(o);save();return;
 }
 if(a==='srv'){const i=o.items[+x];if(!i||!wk||o.waiter!==wk.id)return ans('Недоступно');i.served=!i.served;await ans(i.served?'Подано':'Отмена');save();return refresh(o)}
 if(a==='rdy'){
  if(!isKit(chat)&&!adm)return ans('Нет доступа');
  const its=o.items.filter(i=>i.b==+x&&!i.ready);if(!its.length)return ans('Уже отмечено');
  its.forEach(i=>i.ready=true);await ans('Готово');
  const km=(o.m.kitchen||[]).find(m=>m.b==+x);if(km)await edit(km.c,km.id,`✅ Готово — ${esc(tn(o))}, заказ №${o.id}\n\n`+its.map(i=>`• ${esc(i.n)} × ${i.q}`).join('\n'),[]);
  const txt=`🍽 <b>${esc(tn(o))}</b>: готово, забирайте!\n\n`+its.map(i=>`• ${esc(i.n)} × ${i.q}`).join('\n');
  const w=wOf(o);if(w&&w.chatId)await send(w.chatId,txt);else for(const ww of wFor(o))await send(ww.chatId,txt);
  save();return refresh(o);
 }
 if(a==='call'){
  if(!mine||o.status!=='accepted')return ans('Недоступно');await ans('Официант уже идёт');
  const r=await send(chat,'🔔 Официант подойдёт к вам в течение 5 минут.');
  if(r){o.m.calls.push(r.message_id);db.jobs.push({at:Date.now()+300000,c:chat,id:r.message_id})}
  const w=wOf(o);if(w&&w.chatId)await send(w.chatId,`🔔 Клиент со стола <b>${esc(tn(o))}</b> вызывает вас!`);return save();
 }
 if(a==='bill'){
  if(!mine||o.status!=='accepted'||o.bill)return ans('Недоступно');await ans('');
  const r=await send(chat,'💳 Как будете оплачивать?',[[{text:'💵 Наличными',callback_data:`pay:${o.id}:cash`},{text:'💳 Картой',callback_data:`pay:${o.id}:card`}],[{text:'📲 QR-перевод',callback_data:`pay:${o.id}:qr`}]]);
  if(r)o.m.calls.push(r.message_id);return save();
 }
 if(a==='pay'){
  if(!mine||!PAY[x])return ans('Недоступно');o.pay=x;await ans('');await del(chat,mid);
  const r=await send(chat,'💝 Добавить чаевые?',[[0,5,10,15].map(p=>({text:p?p+'%':'Без чаевых',callback_data:`tip:${o.id}:${p}`}))]);
  if(r)o.m.calls.push(r.message_id);return save();
 }
 if(a==='tip'){
  if(!mine||!o.pay)return ans('Недоступно');await ans('');await del(chat,mid);
  o.tip=Math.round(sum(o)*(+x||0)/100);o.bill=true;
  const r=await send(chat,`🧾 Счёт запрошен. К оплате: <b>${money(grand(o))}</b>\nОплата: ${PAY[o.pay]}`+(o.pay==='qr'&&db.settings.payInfo?`\n\n${esc(db.settings.payInfo)}`:'')+'\n\nОфициант скоро подойдёт.');
  if(r)o.m.calls.push(r.message_id);
  const w=wOf(o);if(w&&w.chatId)await send(w.chatId,`🧾 <b>${esc(tn(o))}</b> просит счёт\nОплата: ${PAY[o.pay]} · чаевые: ${money(o.tip)}\nК оплате: <b>${money(grand(o))}</b>`);
  save();await refresh(o);return;
 }
 if(a==='close'){
  if(!(wk&&wk.id===o.waiter)&&!adm)return ans('Нет доступа');if(o.status==='closed')return ans('Уже закрыт');
  await ans('Заказ закрыт');return closeOrder(o);
 }
 if(a==='rate'){
  if(!mine||o.rating)return ans('');const n=+x;o.rating=n;await ans('Спасибо!');
  await edit(chat,mid,`Спасибо за оценку: ${'⭐'.repeat(n)}`,[]);
  if(n<=3){pend[chat]=o.id;await send(chat,'Что нам стоит улучшить? Напишите коротко одним сообщением.');
   for(const c of adminChats())await send(c,`⚠️ Низкая оценка ${n}⭐ — ${esc(tn(o))}, заказ №${o.id}, официант: ${esc((wOf(o)||{}).fio||'—')}`)}
  save();
 }
}
async function onMsg(m){
 const chat=m.chat.id,text=(m.text||'').trim(),un=(m.from.username||'').toLowerCase();
 const wk=db.waiters.find(w=>String(w.chatId)===String(chat)),adm=isAdm(chat);
 if(text==='/id')return send(chat,`Ваш chat_id: <code>${chat}</code>`);
 if(text==='/tables'){const L=Object.values(db.orders).filter(o=>o.status!=='closed'&&(adm||(wk&&o.waiter===wk.id)));
  return send(chat,L.length?'<b>Открытые заказы</b>\n\n'+L.map(o=>`${esc(tn(o))} · №${o.id} · ${money(grand(o))} · ${{new:'новый',confirmed:'ждёт официанта',accepted:'в работе'}[o.status]}`).join('\n'):'Открытых заказов нет.')}
 if(text==='/report'&&adm){const s=stats(1);return send(chat,`📊 За 24 часа\nЗаказов: ${s.count}\nВыручка: ${money(s.revenue)}\nСредний чек: ${money(s.avg)}\nЧаевые: ${money(s.tips)}`)}
 if(text==='/backup'&&adm){await doBackup([chat]);return}
 if(text==='/stop'&&(adm||isKit(chat)))return send(chat,'Стоп-лист: нажмите на блюдо, чтобы скрыть/вернуть его в меню',stopKb());
 if(!text.startsWith('/start')){
  if(pend[chat]&&text&&!text.startsWith('/')){const o=db.orders[pend[chat]];delete pend[chat];if(o){o.review=text.slice(0,500);save();
   for(const c of adminChats())await send(c,`💬 Отзыв по заказу №${o.id} (${esc(tn(o))}):\n${esc(o.review)}`);await send(chat,'Спасибо! Мы обязательно учтём ваш отзыв.')}}
  return;
 }
 const p=text.split(' ')[1]||'';
 if(p[0]==='o'){const o=db.orders[p.slice(1)];
  if(o&&o.status!=='closed'){o.client=chat;save();await clientMsg(o);save()}else send(chat,'Заказ не найден или уже закрыт.');return}
 const w=un&&db.waiters.find(w=>String(w.username).replace('@','').toLowerCase()===un);
 if(w){w.chatId=chat;save();return send(chat,`✅ ${esc(w.fio)}, вы подключены как официант.\n\nКоманды: /tables — мои столы`)}
 if(adm)return send(chat,'✅ Админ подключён.\n\nКоманды: /tables, /report, /stop, /backup');
 if(isKit(chat))return send(chat,'✅ Кухня/бар подключены. Команда /stop — стоп-лист.');
 send(chat,`Добро пожаловать в «${esc(db.settings.restaurant)}»! Отсканируйте QR-код на столе, чтобы сделать заказ.\n\nВаш chat_id: <code>${chat}</code>`);
}
let gen=0;
async function startBot(){
 const my=++gen,me=await tg('getMe');if(!me){db.settings.botName='';return}
 db.settings.botName=me.username;save();await tg('deleteWebhook');let off=0;console.log('Bot @'+me.username);lastPoll=Date.now();if(downNote){notifyAdmins(downNote);downNote=''}
 while(my===gen){const u=await tg('getUpdates',{offset:off,timeout:25,allowed_updates:['message','callback_query']});
  if(!u){await new Promise(r=>setTimeout(r,3000));continue}
  lastPoll=Date.now();if(botDown){const mn=Math.round((Date.now()-botDown)/60000);botDown=0;notifyAdmins(`✅ Бот снова отвечает (простой ~${mn} мин).`)}
  for(const x of u){off=x.update_id+1;try{x.callback_query?await onCb(x.callback_query):x.message&&await onMsg(x.message)}catch(e){console.log(e)}}}
}
let lastScan=0;
setInterval(async()=>{const now=Date.now();
 let dch=false;db.dishes.forEach(d=>{if(d.status==='cooking'&&!(d.readyAt>now)){d.status='';d.readyAt=0;dch=true}});if(dch)save();
 const due=db.jobs.filter(j=>j.at<=now);
 if(due.length){db.jobs=db.jobs.filter(j=>j.at>now);
  for(const j of due){
   if(j.type==='remind'){const o=db.orders[j.oid];
    if(o&&o.status==='confirmed'){const t=`⏰ Заказ №${o.id} (${esc(tn(o))}) никто не принял!`;
     for(const w of wFor(o))await send(w.chatId,t);for(const c of adminChats())await send(c,t);
     if(j.n<3)db.jobs.push({type:'remind',oid:o.id,at:now+120000,n:j.n+1})}
   }else del(j.c,j.id)}
  save()}
 if(now-lastScan>60000){lastScan=now;
  for(const o of Object.values(db.orders))if(o.status!=='closed'&&now-(o.last||o.created)>AUTO_H*3600e3)await closeOrder(o,{rejected:o.status==='new'||o.status==='confirmed'})}
},10000);
/* ---------- Отчёты ---------- */
function stats(days){
 const from=Date.now()-days*864e5,os=Object.values(db.orders).filter(o=>o.status==='closed'&&!o.rejected&&(o.closedAt||0)>=from),top={},bw={},bd={};let rev=0,tips=0,rs=0,rc=0;
 for(const o of os){const s=sum(o);rev+=s;tips+=o.tip||0;if(o.rating){rs+=o.rating;rc++}
  o.items.forEach(i=>{const t=top[i.n]=top[i.n]||{n:i.n,q:0,s:0};t.q+=i.q;t.s+=unit(i)*i.q});
  const w=(wOf(o)||{fio:'—'}).fio,x=bw[w]=bw[w]||{w,c:0,s:0};x.c++;x.s+=s;
  const d=new Date(o.closedAt).toLocaleDateString('ru-RU',{timeZone:TZ}),y=bd[d]=bd[d]||{d,c:0,s:0};y.c++;y.s+=s}
 return{count:os.length,revenue:rev,tips,avg:os.length?Math.round(rev/os.length):0,rating:rc?+(rs/rc).toFixed(1):0,top:Object.values(top).sort((a,b)=>b.q-a.q).slice(0,10),waiters:Object.values(bw).sort((a,b)=>b.s-a.s),days:Object.values(bd)};
}
/* ---------- HTTP ---------- */
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'30mb'}));
const parseMods=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const[n,p]=x.split('=');return{n:n.trim(),p:Number(p)||0}});
function isOpen(){const{open,close}=db.settings;if(!open||!close)return true;
 const t=new Date().toLocaleTimeString('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});return open<=close?t>=open&&t<close:t>=open||t<close}
app.get('/',(q,r)=>r.sendFile(path.join(__dirname,'index.html')));
app.get('/api/config',(q,r)=>{const s=db.settings;r.json({restaurant:s.restaurant,currency:s.currency,open:isOpen(),hours:s.open&&s.close?s.open+'–'+s.close:'',closedMsg:s.closedMsg,promo:{t:s.promoTitle,x:s.promoText,i:s.promoImg},dayDish:s.dayDish,now:Date.now(),tables:db.tables,cats:db.cats,dishes:db.dishes.map(d=>({...d,st:dst(d),ra:d.readyAt||0}))})});
app.get('/api/status',(q,r)=>{const s={};db.dishes.forEach(d=>s[d.id]={st:dst(d),ra:d.readyAt||0});r.json({now:Date.now(),open:isOpen(),n:db.dishes.length,s})});
app.post('/api/order',async(req,res)=>{
 const{table,items,note,orderId}=req.body||{};
 if(limit('o'+req.ip,8,60000)||limit('t'+table,15,60000))return res.status(429).json({error:'rate'});
 if(!db.tables.find(t=>t.id==table))return res.status(400).json({error:'table'});
 if(!isOpen())return res.status(400).json({error:'closed',msg:db.settings.closedMsg});
 const list=[],bad=[];
 for(const i of(items||[]).slice(0,60)){const d=db.dishes.find(x=>x.id==i.id);if(!d)continue;if(dst(d)){bad.push({id:d.id,n:d.n});continue}const q=Math.min(99,i.q|0);if(q<1)continue;
  const ms=parseMods(d.mods),sel=(Array.isArray(i.mods)?i.mods:[]).map(n=>ms.find(m=>m.n===n)).filter(Boolean);
  list.push({id:d.id,n:d.n,p:d.p,mp:sel.reduce((s,m)=>s+m.p,0),mods:sel.map(m=>m.n),q,dest:d.dest||'kitchen'})}
 if(bad.length)return res.status(400).json({error:'unavail',ids:bad.map(b=>b.id),names:bad.map(b=>b.n)});
 if(!list.length)return res.status(400).json({error:'empty'});
 const nt=String(note||'').slice(0,300);let o=db.orders[orderId],isNew=false;
 if(o&&o.status!=='closed'&&o.table==table){
  list.forEach(n=>{const k=n.mods.join('+'),e=o.items.find(i=>i.id===n.id&&(i.mods||[]).join('+')===k&&!i.b);e?e.q+=n.q:o.items.push(n)});
  if(nt)o.note=(o.note?o.note+'; ':'')+nt;o.last=Date.now();save();
  if(o.status!=='new')await sendKitchen(o);await refresh(o);
  const w=wOf(o),t=`➕ <b>${esc(tn(o))}</b> добавил блюда в заказ №${o.id}`;
  if(o.status==='accepted'&&w&&w.chatId)send(w.chatId,t);else for(const c of adminChats())send(c,t);
 }else{
  isNew=true;o={id:db.seq++,table:String(table),items:list,note:nt,status:'new',m:{admin:[],waiters:[],client:null,calls:[],kitchen:[]},created:Date.now(),last:Date.now()};
  db.orders[o.id]=o;
  for(const c of adminChats()){const r=await send(c,staff(o),kb(o,'a'));if(r)o.m.admin.push({c,id:r.message_id})}
  save();
 }
 res.json({id:o.id,isNew,bot:db.settings.botName});
});
app.get('/api/order/:id',(q,r)=>{const o=db.orders[q.params.id];if(!o)return r.status(404).json({error:1});
 r.json({status:o.status,rejected:!!o.rejected,items:o.items.map(i=>({n:i.n,q:i.q,p:unit(i),mods:i.mods||[]})),total:grand(o),waiter:(wOf(o)||{}).fio||''})});
app.get('/api/order/:id/receipt.pdf',async(q,r)=>{const o=db.orders[q.params.id];if(!o||o.status!=='closed'||o.rejected)return r.status(404).end();
 const b=await receipt(o);b?r.type('pdf').send(b):r.status(500).end()});
/* ---------- Админ ---------- */
const sess=new Map(),auth=roles=>(q,r,n)=>{const s=sess.get(q.headers['x-token']);s&&(!roles||roles.includes(s.role))?(q.role=s.role,q.who=s.name,n()):r.status(401).json({error:'auth'})};
app.post('/api/admin/login',(q,r)=>{
 if(limit('l'+q.ip,10,600000))return r.status(429).json({error:'rate'});
 const p=String((q.body||{}).password||''),s=db.settings;let role='',who='';
 if(s.passHash?H(p)===s.passHash:p===(process.env.ADMIN_PASSWORD||'12345'))role='owner',who='Владелец';
 else{const a=db.admins.find(a=>a.hash&&a.hash===H(p));if(a){role=a.role;who=a.name}}
 if(!role){logAct('ip '+q.ip,'Неудачная попытка входа в админ-панель');return r.status(401).json({error:'bad'})}
 const t=crypto.randomBytes(16).toString('hex');sess.set(t,{role,name:who});logAct(who,'Вход в админ-панель');r.json({token:t,role});
});
app.get('/api/admin/state',auth(),(q,r)=>{
 const s={...db.settings};delete s.passHash;const own=q.role==='owner';
 r.json({role:q.role,tables:db.tables,cats:db.cats,dishes:db.dishes,waiters:db.waiters,
  settings:own?s:{restaurant:s.restaurant,currency:s.currency,botName:s.botName},admins:own?db.admins.map(a=>({id:a.id,name:a.name,role:a.role,hasPass:!!a.hash})):[]})});
app.post('/api/admin/save',auth(),(q,r)=>{
 const{section,value}=q.body||{},who=q.who||q.role;
 if(!Array.isArray(value)&&section!=='settings')return r.status(400).end();
 if(['tables','cats','dishes'].includes(section)){
  let v=value;
  if(section==='dishes')v=value.map(x=>{const o=db.dishes.find(d=>d.id===x.id),y={...x};
   y.readyAt=x.status==='cooking'?(x.readyMin>0?Date.now()+x.readyMin*6e4:(o&&o.status==='cooking'?o.readyAt:0)):0;delete y.readyMin;delete y.stop;return y});
  diff(section,db[section],v).forEach(t=>logAct(who,t));db[section]=v}
 else if(section==='waiters'){const v=value.map(w=>({...w,chatId:(db.waiters.find(x=>x.id===w.id)||{}).chatId||w.chatId||''}));diff('waiters',db.waiters,v).forEach(t=>logAct(who,t));db.waiters=v}
 else if(q.role!=='owner')return r.status(403).json({error:'role'});
 else if(section==='settings'){
  const old=db.settings,{newPass,botName,passHash,...v}=value;
  const ch=Object.keys(v).filter(k=>k!=='promoImg'&&JSON.stringify(old[k]??'')!==JSON.stringify(v[k]??'')).map(k=>k==='token'?'токен бота изменён':k==='payInfo'?'реквизиты изменены':`${SFN[k]||k}: «${String(old[k]??'').slice(0,40)}» → «${String(v[k]??'').slice(0,40)}»`);
  if(v.promoImg&&v.promoImg!==old.promoImg)ch.push('фото акции');if(newPass)ch.push('пароль владельца изменён');
  if(ch.length)logAct(who,'⚙️ Настройки: '+ch.join('; '));
  const oldT=old.token;db.settings={...old,...v,passHash:newPass?H(newPass):old.passHash};if(db.settings.token!==oldT)startBot()}
 else if(section==='admins'){diff('admins',db.admins,value.map(a=>({id:a.id,name:a.name,role:a.role}))).forEach(t=>logAct(who,t));
  db.admins=value.map(a=>({id:a.id,name:a.name,role:a.role==='owner'?'owner':'manager',hash:a.pass?H(a.pass):(db.admins.find(x=>x.id===a.id)||{}).hash}))}
 else return r.status(400).end();
 save();r.json({ok:true,bot:db.settings.botName});
});
app.get('/api/admin/report',auth(),(q,r)=>r.json(stats(Math.min(365,+q.query.days||7))));
app.get('/api/admin/orders',auth(),(q,r)=>r.json(Object.values(db.orders).sort((a,b)=>b.id-a.id).slice(0,100).map(o=>({id:o.id,table:tn(o),status:o.rejected?'rejected':o.status,total:grand(o),waiter:(wOf(o)||{}).fio||'',t:new Date(o.created).toLocaleString('ru-RU',{timeZone:TZ}),rating:o.rating||0,review:o.review||''}))));
app.get('/api/admin/export.csv',auth(),(q,r)=>{
 const rows=[['№','Дата','Стол','Официант','Блюда','Сумма','Чаевые','Оплата','Оценка']];
 Object.values(db.orders).filter(o=>o.status==='closed'&&!o.rejected).forEach(o=>rows.push([o.id,new Date(o.created).toLocaleString('ru-RU',{timeZone:TZ}),tn(o),(wOf(o)||{}).fio||'',o.items.map(i=>i.n+' x'+i.q).join(', '),sum(o),o.tip||0,PAY[o.pay]||'',o.rating||'']));
 r.type('text/csv; charset=utf-8').send('\ufeff'+rows.map(x=>x.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\n'))});
app.get('/api/admin/backup',auth(['owner']),(q,r)=>r.json(db));
app.post('/api/admin/restore',auth(['owner']),(q,r)=>{if(!q.body||!q.body.settings)return r.status(400).json({error:'bad'});db=q.body;norm();logAct(q.who,'Данные восстановлены из backup');save();startBot();r.json({ok:true})});
app.get('/api/admin/log',auth(['owner']),(q,r)=>r.json(db.log.slice(-300).reverse().map(x=>({t:new Date(x.t).toLocaleString('ru-RU',{timeZone:TZ}),w:x.who,a:x.a}))));
app.post('/api/admin/backup-now',auth(['owner']),async(q,r)=>{await doBackup();logAct(q.who,'Backup отправлен в Telegram вручную');save();r.json({ok:true})});
app.get('/health',(q,r)=>{const ok=!db.settings.token||Date.now()-lastPoll<90000;r.status(ok?200:503).json({ok,uptime:Math.round(process.uptime()),bot:db.settings.botName,lastPollSec:Math.round((Date.now()-lastPoll)/1000),lastError:ok?'':lastErr})});
/* ---------- Backup и мониторинг ---------- */
const notifyAdmins=async t=>{for(const c of adminChats())await send(c,t)};
async function doBackup(to){
 const day=new Date().toLocaleDateString('en-CA',{timeZone:TZ}),buf=Buffer.from(JSON.stringify(db));
 for(const c of to||adminChats())await sendDoc(c,buf,`backup-${day}.json`,`💾 Резервная копия (${day}). Содержит токен бота — не пересылайте.`,'application/json');
}
setInterval(()=>{const s=db.settings;if(!s.token||!adminChats().length)return;
 const day=new Date().toLocaleDateString('en-CA',{timeZone:TZ}),hm=new Date().toLocaleTimeString('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});
 if(db.lastBackup!==day&&hm>=(s.backupTime||'03:00')){db.lastBackup=day;save();doBackup()}},60000);
setInterval(()=>{if(!db.settings.token)return;const now=Date.now();
 if(now-lastPoll>90000){if(!botDown){botDown=now;notifyAdmins(`⚠️ Бот не отвечает более 90 сек. Пробую перезапустить.\n${esc(lastErr)}`)}
  if(now-lastRestart>120000){lastRestart=now;startBot()}}},30000);
let lastCrash=0;process.on('uncaughtException',e=>{console.log('uncaught',e);lastErr=String(e.message);if(Date.now()-lastCrash>300000){lastCrash=Date.now();notifyAdmins('⚠️ Ошибка сервера: '+esc(e.message))}});
process.on('unhandledRejection',e=>console.log('unhandled',e));
process.on('SIGTERM',async()=>{db.hb=Date.now();try{if(FB){await fbPut('hb',db.hb);await flushFb()}else save()}catch{}process.exit(0)});
(async()=>{
 if(FB){let r;for(let i=0;i<5;i++){r=await fbGet('restaurant');if(r!==undefined)break;await new Promise(x=>setTimeout(x,3000))}
  if(r===undefined){console.log('Firebase недоступен — выходим, чтобы не затереть данные');process.exit(1)}
  if(r&&r.settings){db=r;norm();console.log('Данные загружены из Firebase')}else console.log('Firebase пуст — будут записаны текущие данные')}
 const last=FB?await fbGet('hb'):db.hb;
 if(typeof last==='number'&&Date.now()-last>90000){const f=x=>new Date(x).toLocaleString('ru-RU',{timeZone:TZ});downNote=`⚠️ Сервер был недоступен с ${f(last)} до ${f(Date.now())} (~${Math.round((Date.now()-last)/60000)} мин) и снова работает.`}
 setInterval(()=>{db.hb=Date.now();FB?fbPut('hb',db.hb):save()},30000);
 app.listen(PORT,()=>{console.log('Server on',PORT);startBot();if(FB)save()});
})();

const { Worker } = require('bullmq');
const OpenAI = require('openai');
const { db, connection } = require('./common');
const ai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;
async function handle({pageId,senderId,mid,text,demo}){
 const page=await db.page.findUnique({where:{pageId},include:{products:true}});
 if(!page){console.warn('Page not found',pageId);return}
 const conversation=await db.conversation.upsert({where:{pageId_senderId:{pageId:page.id,senderId}},create:{pageId:page.id,senderId},update:{}});
 // Incoming message is idempotent; duplicate webhook events are ignored.
 const already=await db.message.findUnique({where:{metaId:mid}});
 if(already)return;
 await db.message.create({data:{conversationId:conversation.id,metaId:mid,direction:'incoming',body:text}});
 if(!page.enabled||!conversation.enabled||conversation.handoff)return;
 const history=await db.message.findMany({where:{conversationId:conversation.id},orderBy:{createdAt:'desc'},take:12});
 const catalog=page.products.map(p=>`${p.name}: ${p.description}; giá ${p.price==null?'chưa có':p.price+' VND'}`).join('\n');
 let reply='[DEMO] Đã nhận tin nhắn. Vui lòng cấu hình OPENAI_API_KEY để AI trả lời thực tế.';
 if(ai){const response=await ai.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',temperature:0.3,max_tokens:400,messages:[{role:'system',content:`${page.prompt}\nChỉ sử dụng thông tin đã được xác minh. Không bịa giá, tác dụng chữa bệnh hay cam kết giao hàng. Nếu không rõ hãy chuyển nhân viên.\nSản phẩm:\n${catalog||'(chưa có dữ liệu)'}`},...history.reverse().map(m=>({role:m.direction==='incoming'?'user':'assistant',content:m.body}))]});reply=response.choices[0]?.message?.content?.trim()||'Dạ, em xin chuyển nhân viên hỗ trợ ạ.'}
 const current=await db.conversation.findUnique({where:{id:conversation.id}});
 const currentPage=await db.page.findUnique({where:{id:page.id}});
 if(!current?.enabled||current.handoff||!currentPage?.enabled)return;
 if(demo){await db.message.create({data:{conversationId:conversation.id,direction:'demo',body:reply}});return}
 if(!currentPage.token){console.warn('Missing Page token; no message sent');return}
 const url=`https://graph.facebook.com/${process.env.META_GRAPH_VERSION||'v23.0'}/me/messages`;
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${currentPage.token}`},body:JSON.stringify({recipient:{id:senderId},messaging_type:'RESPONSE',message:{text:reply}})});
 if(!response.ok)throw new Error(`Meta send error ${response.status}: ${(await response.text()).slice(0,300)}`);
 await db.message.create({data:{conversationId:conversation.id,direction:'outgoing',body:reply}});
}
const worker=new Worker('messages',async job=>handle(job.data),{connection,concurrency:1});
worker.on('completed',j=>console.log('Processed',j.id));worker.on('failed',(j,e)=>console.error('Worker failed',j?.id,e.message));
console.log('Worker ready');

const express = require('express');
const crypto = require('node:crypto');
const { db, queue } = require('./common');
const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'256kb', verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf)}}));
app.use((req,res,next)=>{const origin=process.env.CORS_ORIGIN||'http://localhost:3000';res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Admin-Key');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next()});
const fail=(res,e)=>{console.error(e);res.status(400).json({error:e.message||'Request failed'})};
const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>fail(res,e));
const admin=(req,res,next)=>{const key=process.env.ADMIN_KEY||'';const sent=String(req.get('X-Admin-Key')||'');if(!key||key.startsWith('CHANGE_')||sent.length!==key.length||!crypto.timingSafeEqual(Buffer.from(sent),Buffer.from(key)))return res.status(401).json({error:'Invalid admin key'});next()};
app.get('/health',(req,res)=>res.json({ok:true,service:'moc-tam-ai-api'}));
app.get('/webhook',(req,res)=>{const q=req.query;if(q['hub.mode']==='subscribe'&&process.env.META_VERIFY_TOKEN&&q['hub.verify_token']===process.env.META_VERIFY_TOKEN)return res.status(200).send(String(q['hub.challenge']||''));res.sendStatus(403)});
app.post('/webhook',wrap(async(req,res)=>{
 const secret=process.env.META_APP_SECRET;
 if(!secret)return res.sendStatus(503);
 const expected='sha256='+crypto.createHmac('sha256',secret).update(req.rawBody||Buffer.alloc(0)).digest('hex');
 const actual=req.get('X-Hub-Signature-256')||'';
 if(actual.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.sendStatus(403);
 if(req.body?.object==='page')for(const entry of req.body.entry||[])for(const evt of entry.messaging||[]){
  const m=evt.message;if(!m?.mid||m.is_echo||typeof m.text!=='string'||!evt.sender?.id||!evt.recipient?.id)continue;
  await queue.add('incoming',{pageId:String(evt.recipient.id),senderId:String(evt.sender.id),mid:String(m.mid),text:m.text,demo:false},{jobId:'in-'+crypto.createHash('sha256').update(String(m.mid)).digest('hex'),attempts:3,backoff:{type:'exponential',delay:2000},removeOnComplete:1000});
 }
 res.send('EVENT_RECEIVED');
}));
app.use('/api',admin);
app.get('/api/stats',wrap(async(req,res)=>res.json({pages:await db.page.count(),conversations:await db.conversation.count(),messages:await db.message.count()})));
app.get('/api/pages',wrap(async(req,res)=>res.json(await db.page.findMany({select:{id:true,pageId:true,name:true,enabled:true,prompt:true},orderBy:{createdAt:'desc'}}))));
app.post('/api/pages',wrap(async(req,res)=>{const {pageId,name}=req.body;if(!pageId||!name)return res.status(400).json({error:'Thiếu Page ID hoặc tên'});res.json(await db.page.upsert({where:{pageId:String(pageId)},create:{pageId:String(pageId),name:String(name)},update:{name:String(name)},select:{id:true,pageId:true,name:true,enabled:true}}))}));
app.patch('/api/pages/:id',wrap(async(req,res)=>{const data={};if(typeof req.body.enabled==='boolean')data.enabled=req.body.enabled;if(typeof req.body.prompt==='string')data.prompt=req.body.prompt.slice(0,12000);if(typeof req.body.token==='string')data.token=req.body.token;res.json(await db.page.update({where:{id:req.params.id},data,select:{id:true,name:true,enabled:true,prompt:true}}))}));
app.get('/api/conversations',wrap(async(req,res)=>res.json(await db.conversation.findMany({include:{page:{select:{name:true}},messages:{orderBy:{createdAt:'desc'},take:1}},orderBy:{updatedAt:'desc'},take:100}))));
app.get('/api/conversations/:id/messages',wrap(async(req,res)=>res.json(await db.message.findMany({where:{conversationId:req.params.id},orderBy:{createdAt:'asc'},take:200}))));
app.patch('/api/conversations/:id',wrap(async(req,res)=>{const data={};if(typeof req.body.handoff==='boolean')data.handoff=req.body.handoff;if(typeof req.body.enabled==='boolean')data.enabled=req.body.enabled;res.json(await db.conversation.update({where:{id:req.params.id},data}))}));
app.get('/api/products',wrap(async(req,res)=>res.json(await db.product.findMany({include:{page:{select:{name:true}}},orderBy:{name:'asc'}}))));
app.post('/api/products',wrap(async(req,res)=>{const {pageId,name,description,price}=req.body;if(!pageId||!name)return res.status(400).json({error:'Thiếu Page hoặc tên sản phẩm'});res.json(await db.product.create({data:{pageId,name:String(name),description:String(description||''),price:price==null||price===''?null:Number(price)}}))}));
app.post('/api/demo',wrap(async(req,res)=>{if(process.env.DEMO_MODE!=='true')return res.status(403).json({error:'Demo disabled'});const {pageId,text}=req.body;if(!pageId||!text)return res.status(400).json({error:'Thiếu dữ liệu'});const mid='demo-'+crypto.randomUUID();await queue.add('incoming',{pageId:String(pageId),senderId:'demo-customer',mid,text:String(text),demo:true});res.json({queued:true,mid})}));
app.listen(4000,'0.0.0.0',()=>console.log('API listening on 4000'));

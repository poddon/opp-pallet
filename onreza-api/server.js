import express from "express";
import cors from "cors";
import pg from "pg";
import crypto from "node:crypto";

const app=express();
const port=Number(process.env.PORT||3000);
const origins=(process.env.ALLOWED_ORIGINS||"https://poddon.github.io").split(",").map(s=>s.trim());
app.use(cors({origin:(origin,cb)=>cb(null,!origin||origins.includes(origin)),methods:["GET","POST","OPTIONS"],allowedHeaders:["Content-Type","X-Admin-Name","X-Admin-Password"]}));
app.use(express.json({limit:"16kb"}));
app.disable("x-powered-by");
if(!process.env.DATABASE_URL||!process.env.ADMIN_NAME||!process.env.ADMIN_PASSWORD_HASH)throw Error("Set DATABASE_URL, ADMIN_NAME, ADMIN_PASSWORD_HASH");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},max:12,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
const bool=o=>Boolean(o);
const validId=s=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const norm=s=>String(s||"").trim().toLocaleLowerCase("ru").replace(/\s+/g," ");
function admin(req,res,next){
 let name="";try{name=decodeURIComponent(req.get("x-admin-name")||"")}catch{return res.status(401).json({ok:false})}
 const supplied=crypto.createHash("sha256").update(req.get("x-admin-password")||"").digest("hex");
 const expected=process.env.ADMIN_PASSWORD_HASH.toLowerCase();
 const nameOk=norm(name)===norm(process.env.ADMIN_NAME);
 const passwordOk=/^[0-9a-f]{64}$/.test(expected)&&crypto.timingSafeEqual(Buffer.from(supplied,"hex"),Buffer.from(expected,"hex"));
 if(!nameOk||!passwordOk)return res.status(401).json({ok:false,error:"Неверные данные администратора"});
 next();
}
app.get("/health",async(req,res)=>{try{await pool.query("select 1");res.json({ok:true,db:"connected"})}catch{res.status(503).json({ok:false,db:"unavailable"})}});
app.post("/api/results",async(req,res)=>{
 const b=req.body||{};if(!validId(b.submission_id)||typeof b.name!=="string"||!b.name.trim()||typeof b.group!=="string"||!b.group.trim()||!["Пройден","СПИСЫВАНИЕ"].includes(b.status))return res.status(400).json({ok:false,error:"invalid payload"});
 const nums=["correct","total","pct","xp","duration"].map(k=>Number(b[k]||0));if(nums.some(n=>!Number.isFinite(n)||n<0)||nums[0]>nums[1]||nums[2]>100)return res.status(400).json({ok:false});
 try{await pool.query(`INSERT INTO quiz_results(submission_id,date,name,group_code,modules,status,correct,total,pct,xp,duration) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(submission_id) DO NOTHING`,[b.submission_id,String(b.date||"").slice(0,80),b.name.trim().slice(0,160),b.group.trim().slice(0,80),String(b.modules||"1").slice(0,30),b.status,...nums]);res.json({ok:true})}catch(e){console.error("result insertion error",e.message);res.status(500).json({ok:false})}
});
app.get("/api/results",admin,async(req,res)=>{try{const {rows}=await pool.query("SELECT date,name,group_code AS group,modules,status,correct,total,pct,xp,duration FROM quiz_results ORDER BY created_at DESC LIMIT 10000");res.json({ok:true,rows})}catch(e){console.error(e.message);res.status(500).json({ok:false})}});
app.post("/api/live",async(req,res)=>{
 const b=req.body||{};if(!validId(b.session_id)||typeof b.name!=="string"||!b.name.trim()||typeof b.group!=="string"||!b.group.trim())return res.status(400).json({ok:false});
 try{await pool.query(`INSERT INTO quiz_live(session_id,name,group_code,question,total,seconds_left,status,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(session_id) DO UPDATE SET question=EXCLUDED.question,total=EXCLUDED.total,seconds_left=EXCLUDED.seconds_left,status=EXCLUDED.status,updated_at=now()`,[b.session_id,b.name.slice(0,160),b.group.slice(0,80),Math.max(1,Math.min(500,Number(b.question)||1)),Math.max(1,Math.min(500,Number(b.total)||50)),Math.max(0,Math.min(600,Number(b.seconds_left)||0)),String(b.status||"Проходит").slice(0,30)]);res.json({ok:true})}catch(e){console.error(e.message);res.status(500).json({ok:false})}
});
app.get("/api/live",admin,async(req,res)=>{try{const {rows}=await pool.query("SELECT name,group_code,question,total,seconds_left,status,updated_at FROM quiz_live WHERE updated_at>now()-interval '25 seconds' ORDER BY updated_at DESC LIMIT 300");res.json({ok:true,rows})}catch(e){console.error(e.message);res.status(500).json({ok:false})}});
app.use((req,res)=>res.status(404).json({ok:false}));
app.listen(port,"0.0.0.0",()=>console.log("OPP API listening on",port));

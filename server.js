require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, "linknova.sqlite");
const MAX_LINKS_PER_USER = Number(process.env.MAX_LINKS_PER_USER || 500);
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
 balance REAL NOT NULL DEFAULT 0, referral_code TEXT NOT NULL UNIQUE,
 referred_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS links (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, code TEXT NOT NULL UNIQUE,
 destination TEXT NOT NULL, title TEXT, monetize INTEGER NOT NULL DEFAULT 1,
 link_type TEXT NOT NULL DEFAULT 'ad_short',
 clicks INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS clicks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, link_id INTEGER NOT NULL, ip_hash TEXT,
 country TEXT DEFAULT 'Unknown', device TEXT DEFAULT 'Unknown',
 referrer TEXT, valid INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS files (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, original_name TEXT NOT NULL,
 stored_name TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER NOT NULL,
 downloads INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS payouts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount REAL NOT NULL,
 method TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS referrals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL, referred_id INTEGER NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ad_revenue_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, provider_event_id TEXT NOT NULL UNIQUE,
 publisher_user_id INTEGER NOT NULL, net_revenue_usd REAL NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS referral_commissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL, referred_id INTEGER NOT NULL,
 revenue_event_id INTEGER NOT NULL UNIQUE, basis_usd REAL NOT NULL, rate_percent REAL NOT NULL,
 amount_usd REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT,
 FOREIGN KEY(referrer_id) REFERENCES users(id),
 FOREIGN KEY(referred_id) REFERENCES users(id),
 FOREIGN KEY(revenue_event_id) REFERENCES ad_revenue_events(id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Backward-compatible migration for databases created before link types existed.
const linkColumns = db.pragma('table_info(links)');
if (!linkColumns.some(column => column.name === 'link_type')) {
  db.exec("ALTER TABLE links ADD COLUMN link_type TEXT NOT NULL DEFAULT 'ad_short'");
  db.exec("UPDATE links SET link_type = CASE WHEN monetize = 0 THEN 'direct' ELSE 'ad_short' END");
}

const userColumns = db.pragma('table_info(users)');
if (!userColumns.some(c => c.name === 'plan')) db.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'");
if (!db.pragma('table_info(links)').some(c => c.name === 'vip_decode')) db.exec("ALTER TABLE links ADD COLUMN vip_decode INTEGER NOT NULL DEFAULT 0");
db.exec(`CREATE TABLE IF NOT EXISTS campaigns (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, link_id INTEGER NOT NULL,
 budget REAL NOT NULL, bid REAL NOT NULL, days INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'demo',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

const settingDefaults = {
 cpm_demo: "2.50",
 min_payout: "10",
 referral_rate: "10",
 referral_days: "365",
 site_name: "LinkNova",
 announcement: "Welcome to LinkNova — your traffic, your insights."
};
for (const [k,v] of Object.entries(settingDefaults)) {
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)").run(k,v);
}

const adminEmail = (process.env.ADMIN_EMAIL || "admin@linknova.local").toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
if (!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("INSERT INTO users(name,email,password_hash,role,referral_code) VALUES(?,?,?,?,?)")
    .run("LinkNova Admin", adminEmail, hash, "admin", "NOVAADMIN");
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
  secret: process.env.SESSION_SECRET || "dev-only-change-this-secret",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7*24*60*60*1000 }
}));
const PUBLIC_DIR = fs.existsSync(path.join(__dirname,"public","index.html")) ? path.join(__dirname,"public") : null;
if (PUBLIC_DIR) app.use(express.static(PUBLIC_DIR));
else {
  // Fallback: index.html / app.js / styles.css placed next to server.js (only these three files are exposed).
  for (const f of ["index.html","app.js","styles.css"]) {
    if (!fs.existsSync(path.join(__dirname,f))) continue;
    const handler=(req,res)=>res.sendFile(path.join(__dirname,f));
    app.get("/"+f,handler); if (f==="index.html") app.get("/",handler);
  }
}
const authLimiter = rateLimit({ windowMs: 15*60*1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Quá nhiều lần thử. Vui lòng thử lại sau ít phút." } });
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/", rateLimit({ windowMs: 60*1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_,__,cb) => cb(null, UPLOAD_DIR),
    filename: (_,file,cb) => cb(null, crypto.randomBytes(16).toString("hex") + path.extname(file.originalname).slice(0,12))
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024 }
});

const safeUser = u => ({ id:u.id, name:u.name, email:u.email, role:u.role, balance:Number(u.balance), referralCode:u.referral_code, createdAt:u.created_at, plan:u.plan || "free", isVip:u.role==="admin" || u.plan==="vip" });
const isVipUser = u => u.role === "admin" || u.plan === "vip";
const RESERVED_SLUGS = new Set(["admin","api","login","register","vip","wallet","links","files","referrals","overview","guide","app","static","assets","terms","privacy","support","help","new","create","edit","delete","campaign","decode","file","download","auth","styles","index"]);
function slugError(s) {
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(s)) return "Slug dài 3–30 ký tự, chỉ gồm chữ thường, số và dấu gạch ngang (không bắt đầu/kết thúc bằng dấu gạch).";
  if (RESERVED_SLUGS.has(s)) return "Từ khóa này đã được hệ thống giữ chỗ.";
  if (db.prepare("SELECT id FROM links WHERE code=? COLLATE NOCASE").get(s)) return "Slug này đã được sử dụng.";
  return null;
}
function auth(req,res,next) {
  if (!req.session.userId) return res.status(401).json({ error:"Please sign in to continue." });
  req.user = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  if (!req.user) return res.status(401).json({ error:"Session expired." });
  next();
}
function admin(req,res,next) {
  if (req.user.role !== "admin") return res.status(403).json({ error:"Admin access required." });
  next();
}
function makeCode(n=7) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({length:n},()=>chars[crypto.randomInt(chars.length)]).join("");
}
function ipDigest(req) {
  const ip = String(req.ip || req.socket.remoteAddress || "");
  return crypto.createHash("sha256").update(ip + (process.env.SESSION_SECRET || "local")).digest("hex");
}
function getSetting(key) { return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value; }
function validUrl(value) {
  try { const u = new URL(value); return ["http:","https:"].includes(u.protocol); } catch { return false; }
}
function deviceOf(req) {
  const ua = req.headers["user-agent"] || "";
  return /mobile|android|iphone/i.test(ua) ? "Mobile" : /tablet|ipad/i.test(ua) ? "Tablet" : "Desktop";
}

app.get("/api/health", (_,res) => res.json({ ok:true, service:"LinkNova API", mode:process.env.DEMO_MODE === "false" ? "live-configured" : "demo" }));
function startSession(req,userId) {
  return new Promise((resolve,reject)=>req.session.regenerate(err=>{
    if(err) return reject(err);
    req.session.userId=userId;
    req.session.save(e=>e?reject(e):resolve());
  }));
}
app.post("/api/auth/register", async (req,res,next) => {
  try {
    const {name,email,password,ref} = req.body || {};
    if (!name || String(name).trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "") || (password || "").length < 8)
      return res.status(400).json({error:"Enter a name, valid email and password of at least 8 characters."});
    const normalized = String(email).toLowerCase().trim();
    if (db.prepare("SELECT id FROM users WHERE email=?").get(normalized)) return res.status(409).json({error:"This email is already registered."});
    const suppliedRef = String(ref || "").trim();
    const referral = suppliedRef ? db.prepare("SELECT id FROM users WHERE referral_code=? COLLATE NOCASE").get(suppliedRef) : null;
    if (suppliedRef && !referral) return res.status(400).json({error:"Mã giới thiệu không hợp lệ. Vui lòng kiểm tra lại."});
    const hash = await bcrypt.hash(String(password),12);
    let userId=null;
    const create=db.transaction(()=>{
      let code=makeCode(9);
      while(db.prepare("SELECT id FROM users WHERE referral_code=?").get(code)) code=makeCode(9);
      const result=db.prepare("INSERT INTO users(name,email,password_hash,referral_code,referred_by) VALUES(?,?,?,?,?)")
        .run(String(name).trim().slice(0,60), normalized, hash, code, referral?.id || null);
      if (referral) db.prepare("INSERT OR IGNORE INTO referrals(referrer_id,referred_id) VALUES(?,?)").run(referral.id,result.lastInsertRowid);
      userId=result.lastInsertRowid;
    });
    try { create(); } catch(err) {
      if (String(err.message).includes("UNIQUE")) return res.status(409).json({error:"This email is already registered."});
      throw err;
    }
    await startSession(req,userId);
    res.json({ user:safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(userId)) });
  } catch(err) { next(err); }
});
app.post("/api/auth/login", async (req,res,next) => {
  try {
    const u = db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body?.email || "").toLowerCase().trim());
    if (!u || !(await bcrypt.compare(String(req.body?.password || ""),u.password_hash))) return res.status(401).json({error:"Email or password is incorrect."});
    await startSession(req,u.id);
    res.json({user:safeUser(u)});
  } catch(err) { next(err); }
});
app.post("/api/auth/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/auth/me",auth,(req,res)=>res.json({user:safeUser(req.user)}));

app.get("/api/dashboard",auth,(req,res)=>{
  const links = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(clicks),0) clicks FROM links WHERE user_id=?").get(req.user.id);
  const files = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(downloads),0) downloads FROM files WHERE user_id=?").get(req.user.id);
  const clicks7 = db.prepare("SELECT date(c.created_at) day, COUNT(*) clicks FROM clicks c JOIN links l ON l.id=c.link_id WHERE l.user_id=? AND c.valid=1 AND c.created_at >= datetime('now','-6 days') GROUP BY date(c.created_at) ORDER BY day").all(req.user.id);
  const payouts = db.prepare("SELECT id,amount,method,status,created_at FROM payouts WHERE user_id=? ORDER BY id DESC LIMIT 5").all(req.user.id);
  const referralCount = db.prepare("SELECT COUNT(*) n FROM referrals WHERE referrer_id=?").get(req.user.id).n;
  const recentLinks = db.prepare("SELECT id,code,destination,title,monetize,link_type,clicks,created_at FROM links WHERE user_id=? ORDER BY id DESC LIMIT 8").all(req.user.id).map(linkOut);
  res.json({stats:{links:links.n,clicks:links.clicks,files:files.n,downloads:files.downloads,balance:Number(req.user.balance),referrals:referralCount},clicks7,payouts,recentLinks,cpm:Number(getSetting("cpm_demo"))});
});
const LINK_TYPES = new Set(["direct","ad_long","ad_short"]);
const linkOut = l => ({ id:l.id, code:l.code, url:`${BASE_URL}/${l.code}`, destination:l.destination, title:l.title || "",
  monetize:!!l.monetize, link_type:l.link_type, linkType:l.link_type, clicks:l.clicks, created_at:l.created_at, vipDecode:!!l.vip_decode });
function readLinkType(body) {
  const raw = body.linkType ?? body.link_type ?? body.type;
  if (raw === undefined || raw === null || raw === "") {
    return (body.monetize === false || body.monetize === 0 || body.monetize === "false") ? "direct" : "ad_short";
  }
  const v = String(raw).trim().toLowerCase();
  return LINK_TYPES.has(v) ? v : null;
}
function normalizeDestination(input) {
  let v = String(input ?? "").trim();
  if (!v) return { error:"Vui lòng nhập liên kết đích." };
  if (!v.includes("://") && !/^(javascript|data|vbscript|file|mailto|tel):/i.test(v)) v = "https://" + v;
  if (v.length > 2048) return { error:"Liên kết đích quá dài (tối đa 2048 ký tự)." };
  let u;
  try { u = new URL(v); } catch { return { error:"Liên kết đích không hợp lệ. Hãy nhập địa chỉ bắt đầu bằng http:// hoặc https://." }; }
  if (!["http:","https:"].includes(u.protocol)) return { error:"Liên kết đích phải bắt đầu bằng http:// hoặc https://." };
  if (u.username || u.password) return { error:"Liên kết đích không được chứa tên đăng nhập hoặc mật khẩu." };
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return { error:"Tên miền của liên kết đích không hợp lệ." };
  try {
    if (u.origin === new URL(BASE_URL).origin) {
      const m = u.pathname.match(/^\/([A-Za-z0-9]+)\/?$/);
      if (m && db.prepare("SELECT id FROM links WHERE code=?").get(m[1])) return { error:"Không thể rút gọn một liên kết LinkNova khác (tránh vòng lặp chuyển hướng)." };
    }
  } catch {}
  return { url:u.href };
}
function linkId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}
app.get("/api/links",auth,(req,res)=>{
  const q = String(req.query.q || "").trim().slice(0,100);
  const rows = q
    ? db.prepare("SELECT * FROM links WHERE user_id=? AND (title LIKE ? OR destination LIKE ? OR code LIKE ?) ORDER BY id DESC").all(req.user.id,`%${q}%`,`%${q}%`,`%${q}%`)
    : db.prepare("SELECT * FROM links WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  res.json({links:rows.map(linkOut)});
});
app.post("/api/links",auth,(req,res,next)=>{
  try {
    const body = req.body || {};
    const linkType = readLinkType(body);
    if (!linkType) return res.status(400).json({error:"Vui lòng chọn loại liên kết hợp lệ."});
    const dest = normalizeDestination(body.destination ?? body.url);
    if (dest.error) return res.status(400).json({error:dest.error});
    const title = String(body.title ?? "").trim().slice(0,120);
    const rawSlug = String(body.slug ?? "").trim().toLowerCase();
    const vipDecode = body.vipDecode === true || body.vipDecode === "true";
    if ((rawSlug || vipDecode) && !isVipUser(req.user)) return res.status(403).json({error:"Slug tùy chỉnh và giải mã VIP chỉ dành cho thành viên VIP."});
    if (rawSlug) { const se = slugError(rawSlug); if (se) return res.status(400).json({error:se}); }
    const count = db.prepare("SELECT COUNT(*) n FROM links WHERE user_id=?").get(req.user.id).n;
    if (count >= MAX_LINKS_PER_USER) return res.status(400).json({error:`Bạn đã đạt giới hạn ${MAX_LINKS_PER_USER} liên kết.`});
    const monetize = linkType === "direct" ? 0 : 1;
    for (let attempt=0; attempt<8; attempt++) {
      const code = rawSlug || makeCode();
      try {
        const info = db.prepare("INSERT INTO links(user_id,code,destination,title,monetize,link_type,vip_decode) VALUES(?,?,?,?,?,?,?)")
          .run(req.user.id,code,dest.url,title,monetize,linkType,vipDecode?1:0);
        return res.json({link:linkOut(db.prepare("SELECT * FROM links WHERE id=?").get(info.lastInsertRowid))});
      } catch (err) {
        if (!String(err.message).includes("UNIQUE")) throw err;
        if (rawSlug) return res.status(409).json({error:"Slug này đã được sử dụng."});
      }
    }
    res.status(503).json({error:"Không thể tạo mã liên kết lúc này. Vui lòng thử lại."});
  } catch (err) { next(err); }
});
app.patch("/api/links/:id",auth,(req,res,next)=>{
  try {
    const id = linkId(req);
    const link = id && db.prepare("SELECT * FROM links WHERE id=? AND user_id=?").get(id,req.user.id);
    if (!link) return res.status(404).json({error:"Không tìm thấy liên kết."});
    const body = req.body || {};
    let { destination, title, link_type:type } = link;
    if (body.destination !== undefined || body.url !== undefined) {
      const dest = normalizeDestination(body.destination ?? body.url);
      if (dest.error) return res.status(400).json({error:dest.error});
      destination = dest.url;
    }
    if (body.title !== undefined) title = String(body.title).trim().slice(0,120);
    if (body.linkType !== undefined || body.link_type !== undefined || body.type !== undefined) {
      const t = readLinkType(body);
      if (!t) return res.status(400).json({error:"Vui lòng chọn loại liên kết hợp lệ."});
      type = t;
    }
    db.prepare("UPDATE links SET destination=?,title=?,link_type=?,monetize=? WHERE id=?").run(destination,title,type,type==="direct"?0:1,id);
    res.json({link:linkOut(db.prepare("SELECT * FROM links WHERE id=?").get(id))});
  } catch (err) { next(err); }
});
app.delete("/api/links/:id",auth,(req,res,next)=>{
  try {
    const id = linkId(req);
    if (!id) return res.status(404).json({error:"Không tìm thấy liên kết."});
    let deleted = false;
    db.transaction(()=>{
      const link = db.prepare("SELECT id FROM links WHERE id=? AND user_id=?").get(id,req.user.id);
      if (!link) return;
      db.prepare("DELETE FROM clicks WHERE link_id=?").run(id);
      db.prepare("DELETE FROM campaigns WHERE link_id=?").run(id);
      deleted = db.prepare("DELETE FROM links WHERE id=?").run(id).changes > 0;
    })();
    if (!deleted) return res.status(404).json({error:"Không tìm thấy liên kết."});
    res.json({ok:true});
  } catch (err) { next(err); }
});

app.post("/api/files",auth,(req,res,next)=>upload.single("file")(req,res,err=>err?res.status(400).json({error:err.message}):next()),(req,res)=>{
  if(!req.file) return res.status(400).json({error:"Choose a file to upload."});
  const info=db.prepare("INSERT INTO files(user_id,original_name,stored_name,mime_type,size_bytes) VALUES(?,?,?,?,?)")
    .run(req.user.id,req.file.originalname.slice(0,200),req.file.filename,req.file.mimetype,req.file.size);
  res.json({file:{id:info.lastInsertRowid,name:req.file.originalname,size:req.file.size,url:`${BASE_URL}/file/${info.lastInsertRowid}`}});
});
app.get("/api/files",auth,(req,res)=>res.json({files:db.prepare("SELECT id,original_name,size_bytes,downloads,created_at FROM files WHERE user_id=? ORDER BY id DESC").all(req.user.id)}));
app.post("/api/files/:id/unlock", (req,res)=>{
  const file=db.prepare("SELECT id FROM files WHERE id=?").get(req.params.id);
  if(!file) return res.status(404).json({error:"File not found."});
  if(!req.session.unlockedFiles) req.session.unlockedFiles=[];
  if(!req.session.unlockedFiles.includes(file.id)) req.session.unlockedFiles.push(file.id);
  res.json({downloadUrl:`/download/${req.params.id}`});
});
app.get("/download/:id",(req,res)=>{
  const file=db.prepare("SELECT * FROM files WHERE id=?").get(req.params.id);
  if(!file) return res.status(404).send("File not found.");
  if(!(req.session.unlockedFiles || []).includes(file.id)) return res.redirect(`/file/${file.id}`);
  const filepath=path.join(UPLOAD_DIR,file.stored_name);
  if(!fs.existsSync(filepath)) return res.status(404).send("Stored file is missing.");
  db.prepare("UPDATE files SET downloads=downloads+1 WHERE id=?").run(file.id);
  res.download(filepath,file.original_name);
});
app.get("/file/:id",(req,res)=>{
  const file=db.prepare("SELECT id,original_name,size_bytes FROM files WHERE id=?").get(req.params.id);
  if(!file) return res.status(404).send("File not found.");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unlock file · LinkNova</title><style>body{font-family:Inter,Arial;background:#0b1020;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:520px;padding:36px;border:1px solid #29324b;border-radius:22px;background:#141c31;text-align:center}button{background:#8b7cff;color:white;border:0;padding:14px 22px;border-radius:12px;font-weight:700;cursor:pointer}p{color:#aab4cc}</style></head><body><main class="card"><h1>🔐 Your file is ready</h1><h2>${escapeHtml(file.original_name)}</h2><p>${(file.size_bytes/1024/1024).toFixed(2)} MB · LinkNova secure unlock</p><p>This demo unlock step does not represent a paid ad view.</p><button id="unlock">Continue to download</button></main><script>document.getElementById('unlock').onclick=async()=>{const r=await fetch('/api/files/${file.id}/unlock',{method:'POST'});const d=await r.json();location.href=d.downloadUrl}</script></body></html>`);
});
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

app.post("/api/payouts",auth,(req,res)=>{
  const amount=Math.round(Number(req.body.amount)*100)/100, method=String(req.body.method || ""), details=String(req.body.details || "").trim();
  const min=Number(getSetting("min_payout"));
  if(!Number.isFinite(amount)||amount<min||amount>req.user.balance) return res.status(400).json({error:`Amount must be between ${min.toFixed(2)} and your available balance.`});
  if(!["PayPal","USDT","Bank transfer"].includes(method)||details.length<4) return res.status(400).json({error:"Choose a payout method and provide valid payment details."});
  let ok=false;
  db.transaction(()=>{
    const upd=db.prepare("UPDATE users SET balance=ROUND(balance-?,2) WHERE id=? AND balance>=?").run(amount,req.user.id,amount);
    if(!upd.changes) return;
    db.prepare("INSERT INTO payouts(user_id,amount,method,details) VALUES(?,?,?,?)").run(req.user.id,amount,method,details.slice(0,300));
    ok=true;
  })();
  if(!ok) return res.status(400).json({error:"Số dư không đủ."});
  res.json({ok:true,message:"Payout request submitted for admin review."});
});
app.get("/api/referrals",auth,(req,res)=>{
  const items = db.prepare(`SELECT u.id,u.name,u.created_at,
    COALESCE(SUM(CASE WHEN c.status='approved' THEN c.amount_usd ELSE 0 END),0) approved_commission,
    COALESCE(SUM(CASE WHEN c.status='pending' THEN c.amount_usd ELSE 0 END),0) pending_commission
    FROM referrals r JOIN users u ON u.id=r.referred_id
    LEFT JOIN referral_commissions c ON c.referred_id=u.id AND c.referrer_id=r.referrer_id
    WHERE r.referrer_id=? GROUP BY u.id ORDER BY r.id DESC`).all(req.user.id);
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='pending' THEN amount_usd ELSE 0 END),0) pending,
    COALESCE(SUM(CASE WHEN status='approved' THEN amount_usd ELSE 0 END),0) approved
    FROM referral_commissions WHERE referrer_id=?`).get(req.user.id);
  const commissions = db.prepare(`SELECT c.amount_usd,c.basis_usd,c.rate_percent,c.status,c.created_at,
    u.name referred_name FROM referral_commissions c JOIN users u ON u.id=c.referred_id
    WHERE c.referrer_id=? ORDER BY c.id DESC LIMIT 30`).all(req.user.id);
  res.json({code:req.user.referral_code,url:`${BASE_URL}/?ref=${req.user.referral_code}`,
    rate:Number(getSetting("referral_rate")),days:Number(getSetting("referral_days")),items,
    totals,commissions});
});

// Verified server-to-server revenue callback. Configure AD_REVENUE_WEBHOOK_SECRET before enabling.
app.post("/api/webhooks/ad-revenue",(req,res)=>{
  const secret=process.env.AD_REVENUE_WEBHOOK_SECRET || "";
  if(!secret) return res.status(503).json({error:"Ad revenue webhook is not configured."});
  const supplied=String(req.get("authorization") || "");
  const expected=`Bearer ${secret}`;
  const a=Buffer.from(supplied), b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({error:"Invalid webhook credentials."});
  const eventId=String(req.body?.event_id || "").trim().slice(0,180);
  const publisherId=Number(req.body?.publisher_user_id);
  const netRevenue=Number(req.body?.net_revenue_usd);
  if(!eventId || !Number.isInteger(publisherId) || publisherId<1 || !Number.isFinite(netRevenue) || netRevenue<=0 || netRevenue>10000000)
    return res.status(400).json({error:"Required: event_id, publisher_user_id and positive net_revenue_usd (USD)."});
  if(String(req.body?.currency || "USD").toUpperCase()!=="USD") return res.status(400).json({error:"Only USD revenue events are accepted. Convert using a trusted FX source before sending."});
  if(db.prepare("SELECT id FROM ad_revenue_events WHERE provider_event_id=?").get(eventId)) return res.json({ok:true,duplicate:true,message:"Event already processed."});
  const publisher=db.prepare("SELECT id,referred_by,created_at FROM users WHERE id=?").get(publisherId);
  if(!publisher) return res.status(404).json({error:"Publisher account not found."});
  const net=Math.round(netRevenue*100)/100;
  const rate=Math.max(0,Math.min(30,Number(getSetting("referral_rate") || 0)));
  const days=Math.max(1,Math.min(730,Number(getSetting("referral_days") || 365)));
  const ref=publisher.referred_by ? db.prepare("SELECT referrer_id,created_at FROM referrals WHERE referred_id=?").get(publisher.id) : null;
  let commissionId=null, commissionAmount=0;
  const run=db.transaction(()=>{
    const event=db.prepare("INSERT INTO ad_revenue_events(provider_event_id,publisher_user_id,net_revenue_usd) VALUES(?,?,?)")
      .run(eventId,publisher.id,net);
    if(ref && rate>0) {
      const ageMs=Date.now()-Date.parse(ref.created_at.replace(" ","T")+"Z");
      if(Number.isFinite(ageMs) && ageMs>=0 && ageMs<=days*24*60*60*1000) {
        commissionAmount=Math.round(net*rate)/100;
        if(commissionAmount>0) {
          const info=db.prepare(`INSERT INTO referral_commissions
            (referrer_id,referred_id,revenue_event_id,basis_usd,rate_percent,amount_usd,status)
            VALUES(?,?,?,?,?,?,'pending')`).run(ref.referrer_id,publisher.id,event.lastInsertRowid,net,rate,commissionAmount);
          commissionId=info.lastInsertRowid;
        }
      }
    }
  });
  try { run(); } catch(err) {
    if(String(err.message).includes("UNIQUE")) return res.json({ok:true,duplicate:true,message:"Event already processed."});
    throw err;
  }
  res.json({ok:true,event_id:eventId,commission_id:commissionId,commission_usd:commissionAmount,status:commissionId?"pending_review":"no_referral_commission"});
});

app.post("/api/admin/referral-commissions/:id/status",auth,admin,(req,res)=>{
  const status=req.body.status;
  if(!["approved","rejected"].includes(status)) return res.status(400).json({error:"Invalid commission status."});
  const commission=db.prepare("SELECT * FROM referral_commissions WHERE id=?").get(req.params.id);
  if(!commission) return res.status(404).json({error:"Commission not found."});
  if(commission.status!=="pending") return res.status(409).json({error:"This commission has already been reviewed."});
  const run=db.transaction(()=>{
    const changed=db.prepare("UPDATE referral_commissions SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(status,commission.id);
    if(!changed.changes) throw new Error("Commission has already been reviewed.");
    if(status==="approved") db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(commission.amount_usd,commission.referrer_id);
  });
  try { run(); } catch(err) { return res.status(409).json({error:err.message}); }
  res.json({ok:true,status,credited_usd:status==="approved"?commission.amount_usd:0});
});

app.get("/api/admin/overview",auth,admin,(req,res)=>{
  res.json({
    users:db.prepare("SELECT COUNT(*) n FROM users").get().n,
    links:db.prepare("SELECT COUNT(*) n FROM links").get().n,
    clicks:db.prepare("SELECT COUNT(*) n FROM clicks").get().n,
    files:db.prepare("SELECT COUNT(*) n FROM files").get().n,
    pending:db.prepare("SELECT COUNT(*) n FROM payouts WHERE status='pending'").get().n,
    pendingCommissions:db.prepare("SELECT COUNT(*) n FROM referral_commissions WHERE status='pending'").get().n,
    commissions:db.prepare(`SELECT c.id,c.amount_usd,c.basis_usd,c.rate_percent,c.created_at,
      r.name referrer_name,r.email referrer_email,u.name referred_name
      FROM referral_commissions c JOIN users r ON r.id=c.referrer_id JOIN users u ON u.id=c.referred_id
      WHERE c.status='pending' ORDER BY c.id ASC LIMIT 100`).all(),
    payouts:db.prepare("SELECT p.id,p.amount,p.method,p.details,p.status,p.created_at,u.name,u.email FROM payouts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 30").all(),
    settings:Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(x=>[x.key,x.value]))
  });
});
app.post("/api/admin/payouts/:id/status",auth,admin,(req,res)=>{
  const status=req.body.status;
  if(!["approved","rejected","paid"].includes(status)) return res.status(400).json({error:"Invalid payout status."});
  const payout=db.prepare("SELECT * FROM payouts WHERE id=?").get(req.params.id);
  if(!payout) return res.status(404).json({error:"Payout not found."});
  const flow={pending:["approved","rejected"],approved:["paid","rejected"],paid:[],rejected:[]};
  if(!(flow[payout.status]||[]).includes(status)) return res.status(409).json({error:`Không thể chuyển yêu cầu từ "${payout.status}" sang "${status}".`});
  db.transaction(()=>{
    const ch=db.prepare("UPDATE payouts SET status=? WHERE id=? AND status=?").run(status,payout.id,payout.status);
    if(!ch.changes) throw new Error("Payout was changed by someone else.");
    if(status==="rejected") db.prepare("UPDATE users SET balance=ROUND(balance+?,2) WHERE id=?").run(payout.amount,payout.user_id);
  })();
  res.json({ok:true});
});
app.post("/api/admin/settings",auth,admin,(req,res)=>{
  const numeric={cpm_demo:[0,100000],min_payout:[1,100000],referral_rate:[0,30],referral_days:[1,730]};
  for(const [key,[min,max]] of Object.entries(numeric)) if(req.body[key]!==undefined) {
    const value=Number(req.body[key]);
    if(!Number.isFinite(value)||value<min||value>max||(key==="referral_days"&&!Number.isInteger(value))) return res.status(400).json({error:`${key} must be ${key==="referral_days"?"an integer ":""}between ${min} and ${max}.`});
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,String(value));
  }
  if(req.body.announcement!==undefined) db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run("announcement",String(req.body.announcement).slice(0,300));
  res.json({ok:true});
});

app.get("/api/slug/check",auth,(req,res)=>{
  const s=String(req.query.slug||"").trim().toLowerCase();
  const e=s?slugError(s):null;
  res.json({available:!!s && !e, message:!s?"":(e||"Có thể sử dụng ✓")});
});
app.get("/api/campaigns",auth,(req,res)=>res.json({campaigns:db.prepare(`SELECT c.id,c.budget,c.bid,c.days,c.status,c.created_at,l.code link_code,l.title link_title
  FROM campaigns c JOIN links l ON l.id=c.link_id WHERE c.user_id=? ORDER BY c.id DESC`).all(req.user.id)}));
app.post("/api/campaigns",auth,(req,res)=>{
  if(!isVipUser(req.user)) return res.status(403).json({error:"Chiến dịch chỉ dành cho thành viên VIP."});
  const b=req.body||{}, budget=Math.round(Number(b.budget)*100)/100, bid=Math.round(Number(b.bid)*100)/100, days=Number(b.days);
  const link=db.prepare("SELECT id FROM links WHERE code=? AND user_id=?").get(String(b.linkCode||""),req.user.id);
  if(!link) return res.status(400).json({error:"Hãy chọn một liên kết của bạn."});
  if(!(budget>=5)||!(bid>=0.01)||bid>budget||!Number.isInteger(days)||days<1||days>30)
    return res.status(400).json({error:"Ngân sách tối thiểu $5, giá thầu từ $0.01 và không vượt ngân sách, thời gian 1–30 ngày."});
  // Demo record only: no wallet balance is charged and no ad delivery happens until an ad network is connected.
  const info=db.prepare("INSERT INTO campaigns(user_id,link_id,budget,bid,days) VALUES(?,?,?,?,?)").run(req.user.id,link.id,budget,bid,days);
  res.json({ok:true,id:info.lastInsertRowid});
});
app.post("/api/admin/users/plan",auth,admin,(req,res)=>{
  const email=String(req.body?.email||"").toLowerCase().trim(), plan=String(req.body?.plan||"");
  if(!["free","vip"].includes(plan)) return res.status(400).json({error:"Gói phải là free hoặc vip."});
  const info=db.prepare("UPDATE users SET plan=? WHERE email=?").run(plan,email);
  if(!info.changes) return res.status(404).json({error:"Không tìm thấy người dùng với email này."});
  res.json({ok:true});
});

// Public redirect route. /api, /file and /download are handled above.
app.get("/:code",(req,res,next)=>{
  if(["api","file","download","favicon.ico"].includes(req.params.code)) return next();
  const link=db.prepare("SELECT * FROM links WHERE code=?").get(req.params.code);
  if(!link) return next();
  res.set("Cache-Control","no-store");
  const digest=ipDigest(req);
  const recent=db.prepare("SELECT id FROM clicks WHERE link_id=? AND ip_hash=? AND created_at>=datetime('now','-1 hour')").get(link.id,digest);
  const isBot=/bot|crawler|spider|preview|facebookexternalhit|slurp|curl|wget|python-requests/i.test(req.headers["user-agent"] || "");
  const valid=!recent && !isBot;
  if(req.method!=="HEAD") {
    db.prepare("INSERT INTO clicks(link_id,ip_hash,device,referrer,valid) VALUES(?,?,?,?,?)")
      .run(link.id,digest,deviceOf(req),String(req.headers.referer || "").slice(0,300),valid?1:0);
    if(valid) db.prepare("UPDATE links SET clicks=clicks+1 WHERE id=?").run(link.id);
  }
  if(link.link_type === "direct" || !link.monetize) return res.redirect(link.destination);
  const longFlow = link.link_type === "ad_long";
  const duration = longFlow ? 15 : 5;
  const destinationJson = JSON.stringify(link.destination).replace(/</g, "\\u003c");
  const heading = longFlow ? "Hoàn thành nhiệm vụ để tiếp tục" : "Liên kết của bạn sắp sẵn sàng";
  const intro = longFlow ? "Đây là trang trung gian dài dạng nhiệm vụ. Hãy chờ các bước hướng dẫn hoàn tất rồi tiếp tục." : "Vui lòng chờ trong giây lát trước khi đến nội dung được chia sẻ.";
  const taskMarkup = longFlow
    ? '<div class="task"><b id="stepTitle">Bước 1/2 · Đang chuẩn bị nội dung</b><p id="stepText">Vui lòng chờ hệ thống hoàn tất bước này.</p><div class="track"><i id="progress"></i></div></div>'
    : '<div class="ad"><div><strong>Vị trí quảng cáo</strong><p>Khi kết nối nhà cung cấp quảng cáo được duyệt, nội dung quảng cáo thật sẽ hiển thị tại đây.</p></div></div>';
  res.send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${longFlow ? "Liên kết quảng cáo dài" : "Liên kết quảng cáo ngắn"} · LinkNova</title><style>body{font-family:Inter,Arial,sans-serif;background:#0b1020;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.wrap{width:min(100%,650px);text-align:center}.tag{display:inline-block;padding:7px 12px;border:1px solid #475575;border-radius:30px;color:#b8b0ff;font-size:12px}.ad,.task{min-height:150px;border:1px dashed #53617d;border-radius:18px;display:grid;align-content:center;gap:10px;background:#141c31;color:#c4cce0;margin:24px 0;padding:22px;box-sizing:border-box}.ad p,.task p{color:#9aa8c3;font-size:14px}.muted{color:#9aa8c3;line-height:1.6}button{background:#8b7cff;color:#fff;border:0;border-radius:12px;padding:14px 24px;font-weight:700;cursor:pointer}button:disabled{opacity:.45;cursor:wait}.track{height:8px;background:#29334c;border-radius:8px;overflow:hidden}.track i{display:block;height:100%;width:0;background:#8b7cff;transition:width .3s}.note{font-size:12px;margin-top:24px}</style></head><body><main class="wrap"><span class="tag">${longFlow ? "LINK QUẢNG CÁO DÀI · NHIỆM VỤ" : "LINK QUẢNG CÁO NGẮN"}</span><h1>${heading} ✨</h1><p class="muted">${intro}</p>${taskMarkup}<p id="timer" class="muted">Liên kết sẽ sẵn sàng sau ${duration} giây…</p><button id="go" disabled>Tiếp tục đến nội dung</button><p class="muted note">Trang trung gian thử nghiệm của LinkNova. Chưa hiển thị quảng cáo trả phí, không ghi nhận lượt xem quảng cáo và không phát sinh doanh thu.</p></main><script>let remaining=${duration};const timer=document.getElementById('timer');const button=document.getElementById('go');const stepTitle=document.getElementById('stepTitle');const stepText=document.getElementById('stepText');const progress=document.getElementById('progress');function paint(){if(${longFlow}){const elapsed=${duration}-remaining;const first=elapsed<8;stepTitle.textContent=first?'Bước 1/2 · Đang chuẩn bị nội dung':'Bước 2/2 · Hoàn tất kiểm tra';stepText.textContent=first?'Vui lòng chờ bước chuẩn bị hoàn tất.':'Đang hoàn tất bước cuối cùng.';progress.style.width=(elapsed/${duration}*100)+'%';}}paint();const interval=setInterval(()=>{remaining--;paint();timer.textContent=remaining>0?'Còn '+remaining+' giây…':'Đã sẵn sàng. Anh/chị có thể tiếp tục.';if(remaining<=0){clearInterval(interval);button.disabled=false;}},1000);button.addEventListener('click',()=>{if(!button.disabled)location.assign(${destinationJson});});</script></body></html>`);
});

app.use("/api",(req,res)=>res.status(404).json({error:"Không tìm thấy API."}));
app.use((req,res)=>res.status(404).send("<!doctype html><meta charset=utf-8><title>404</title><body style=\"font-family:Arial;text-align:center;padding:80px\"><h1>404</h1><p>Liên kết không tồn tại hoặc đã bị xóa.</p>"));
app.use((err,req,res,next)=>{
  if(err.type==="entity.parse.failed") return res.status(400).json({error:"Dữ liệu gửi lên không hợp lệ."});
  console.error(err);
  if(res.headersSent) return next(err);
  res.status(500).json({error:"Unexpected server error."});
});
app.listen(PORT,()=>console.log(`LinkNova running at ${BASE_URL}`));

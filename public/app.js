const $ = id => document.getElementById(id);
let user = null, registerMode = false, dashboardCache = null;
const money = n => "$" + Number(n || 0).toFixed(2);
const date = s => s ? new Date(s.replace(" ","T")+"Z").toLocaleDateString() : "—";
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message,error=false){const t=$("toast");t.textContent=message;t.className="toast show"+(error?" error":"");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className="toast",3000)}
async function api(url,opts={}){const res=await fetch(url,{...opts,headers:{...(opts.body instanceof FormData?{}:{"Content-Type":"application/json"}),...(opts.headers||{})}});let data={};try{data=await res.json()}catch{}if(res.status===401&&!url.startsWith("/api/auth/")){location.reload();throw new Error(data.error||"Session expired.")}if(!res.ok)throw new Error(data.error||"Something went wrong.");return data}
function authMode(){ $("authTitle").innerHTML=registerMode?'Create your<br><span>LinkNova account.</span>':'Your traffic.<br><span>Your growth engine.</span>'; $("registerNameWrap").classList.toggle("hidden",!registerMode); $("registerReferralWrap").classList.toggle("hidden",!registerMode); $("authSubmit").innerHTML=registerMode?'Create account <span>→</span>':'Sign in <span>→</span>'; $("authSwitchText").textContent=registerMode?'Already have an account?':'New to LinkNova?'; $("authSwitch").textContent=registerMode?'Sign in':'Create an account'; $("password").autocomplete=registerMode?'new-password':'current-password'}
const referralFromUrl=new URLSearchParams(location.search).get("ref");if(referralFromUrl)$("registerReferral").value=referralFromUrl;
$("authSwitch").onclick=()=>{registerMode=!registerMode;authMode();applyLanguage(currentLanguage)};
$("authSubmit").onclick=async()=>{try{const payload={email:$("email").value.trim(),password:$("password").value};const ref=new URLSearchParams(location.search).get("ref");if(registerMode){payload.name=$("registerName").value.trim();payload.ref=$("registerReferral").value.trim() || ref || ""}const d=await api(registerMode?"/api/auth/register":"/api/auth/login",{method:"POST",body:JSON.stringify(payload)});user=d.user;showApp()}catch(e){toast(e.message,true)}};
$("password").addEventListener("keydown",e=>{if(e.key==="Enter")$("authSubmit").click()});
function showApp(){ $("authView").classList.add("hidden");$("appView").classList.remove("hidden");$("sideName").textContent=user.name;$("sideEmail").textContent=user.email;$("sideAvatar").textContent=user.name[0].toUpperCase();$("topAvatar").textContent=user.name[0].toUpperCase();$("helloName").textContent=user.name.split(" ")[0];document.querySelectorAll(".admin-only").forEach(x=>x.classList.toggle("hidden",user.role!=="admin"));loadDashboard(); }
async function boot(){try{const d=await api("/api/auth/me");user=d.user;showApp()}catch{$("authView").classList.remove("hidden")}}
$("logoutBtn").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});location.reload()};
function navigate(page){document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));$("page-"+page)?.classList.add("active");document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));$("pageCrumb").textContent=({overview:"Overview",links:"Link manager",files:"File sharing",referrals:"Referrals",wallet:"Wallet & payouts",vip:"VIP & Ads",admin:"Admin console"})[page]||"Overview";$("sidebar").classList.remove("open");if(page==="links")loadLinks();if(page==="files")loadFiles();if(page==="referrals")loadReferrals();if(page==="wallet")loadWallet();if(page==="admin")loadAdmin();if(page==="vip"&&window.loadVip)window.loadVip();window.scrollTo(0,0)}
document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>navigate(b.dataset.page));document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>navigate(b.dataset.go));
$("menuBtn").onclick=()=>$("sidebar").classList.add("open");$("closeNav").onclick=()=>$("sidebar").classList.remove("open");
$("guideBtn").onclick=()=>$("guideModal").classList.remove("hidden");$("topHelp").onclick=()=>$("guideModal").classList.remove("hidden");
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));
$("dismissNotice").onclick=()=>document.querySelector(".notice").remove();
async function loadDashboard(){try{const d=await api("/api/dashboard");dashboardCache=d;$("statClicks").textContent=d.stats.clicks.toLocaleString();$("statBalance").textContent=money(d.stats.balance);$("statFiles").textContent=d.stats.files;$("statDownloads").textContent=d.stats.downloads;$("statReferrals").textContent=d.stats.referrals;renderChart(d.clicks7);$("recentLinks").innerHTML=d.recentLinks.length?d.recentLinks.map(l=>`<tr><td><span class="link-cell">${esc(location.host)}/${esc(l.code)} <button class="copy-mini" data-copy="${esc(location.origin+"/"+l.code)}">Copy</button></span></td><td title="${esc(l.destination)}">${esc(l.destination.slice(0,38))}${l.destination.length>38?"…":""}</td><td>${l.clicks}</td><td>${date(l.created_at)}</td></tr>`).join(""):'<tr><td colspan="4" class="empty">No links yet. Create your first short link.</td></tr>';bindCopies()}catch(e){toast(e.message,true)}}
function renderChart(rows){const map=new Map(rows.map(r=>[r.day,r.clicks]));const days=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const key=d.toISOString().slice(0,10);days.push({key,label:d.toLocaleDateString(undefined,{weekday:"short"}),value:map.get(key)||0})}const max=Math.max(1,...days.map(x=>x.value));$("trafficChart").innerHTML=days.map(x=>`<div class="chart-col"><div class="bar-wrap"><div class="bar" title="${x.value} clicks" style="height:${Math.max(3,x.value/max*100)}%"></div></div><small>${x.label}</small></div>`).join("")}
async function loadLinks(){try{const d=await api("/api/links");window.allLinks=d.links;renderLinks(d.links)}catch(e){toast(e.message,true)}}
function linkTypeText(type){const labels={direct:"Direct share link (no ads)",ad_long:"Long ad-style link (multi-step task flow)",ad_short:"Short ad-style link"};return tr(labels[type]||labels.ad_short)}
function renderLinks(links){$("linksTable").innerHTML=links.length?links.map(l=>`<tr><td><span class="link-cell">${esc(location.host)}/${esc(l.code)} <button class="copy-mini" data-copy="${esc(location.origin+"/"+l.code)}">Copy</button></span></td><td title="${esc(l.destination)}">${esc(l.destination.slice(0,35))}${l.destination.length>35?"…":""}</td><td>${l.clicks}</td><td><span class="status link-type-badge ${esc(l.link_type|| (l.monetize?"ad_short":"direct"))}">${esc(linkTypeText(l.link_type||(l.monetize?"ad_short":"direct")))}</span></td><td><button class="action-mini" data-delete="${l.id}">Delete</button></td></tr>`).join(""):'<tr><td colspan="5" class="empty">No links created yet.</td></tr>';bindCopies();document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this link?"))return;await api("/api/links/"+b.dataset.delete,{method:"DELETE"});toast("Link deleted");loadLinks();loadDashboard()})}
$("linkSearch").oninput=e=>renderLinks((window.allLinks||[]).filter(l=>(l.code+" "+l.destination+" "+(l.title||"")).toLowerCase().includes(e.target.value.toLowerCase())));
$("openLinkModal").onclick=()=>{$("linkModal").classList.remove("hidden");syncLinkTypeCards()};
function selectedLinkType(){return document.querySelector('input[name="linkType"]:checked')?.value||"ad_short"}
function syncLinkTypeCards(){document.querySelectorAll(".link-type-option").forEach(card=>card.classList.toggle("selected",card.querySelector('input[name="linkType"]')?.checked===true))}
document.querySelectorAll('input[name="linkType"]').forEach(radio=>radio.addEventListener("change",syncLinkTypeCards));
$("createLinkBtn").onclick=async()=>{try{const d=await api("/api/links",{method:"POST",body:JSON.stringify({destination:$("destinationInput").value.trim(),title:$("titleInput").value.trim(),linkType:selectedLinkType()})});$("linkModal").classList.add("hidden");$("destinationInput").value="";$("titleInput").value="";toast("Your short link is ready");navigate("links");loadDashboard()}catch(e){toast(e.message,true)}};
function bindCopies(){document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{await navigator.clipboard.writeText(b.dataset.copy);toast("Copied to clipboard")})}
async function loadFiles(){try{const d=await api("/api/files");$("filesTable").innerHTML=d.files.length?d.files.map(f=>`<tr><td><b>${esc(f.original_name)}</b></td><td>${(f.size_bytes/1024/1024).toFixed(2)} MB</td><td>${f.downloads}</td><td><span class="link-cell">${esc(location.host)}/file/${f.id} <button class="copy-mini" data-copy="${esc(location.origin+"/file/"+f.id)}">Copy</button></span></td></tr>`).join(""):'<tr><td colspan="4" class="empty">No files uploaded yet.</td></tr>';bindCopies()}catch(e){toast(e.message,true)}}
$("fileInput").onchange=async e=>{const file=e.target.files[0];if(!file)return;$("uploadStatus").textContent="Uploading "+file.name+"…";const form=new FormData();form.append("file",file);try{await api("/api/files",{method:"POST",body:form});$("uploadStatus").textContent="Upload complete. Your share link is ready.";toast("File uploaded");loadFiles();loadDashboard()}catch(err){$("uploadStatus").textContent=err.message;toast(err.message,true)}e.target.value=""};
async function loadReferrals(){try{const d=await api("/api/referrals");$("referralUrl").value=d.url;$("referralCode").value=d.code;$("referralRateStat").textContent=Number(d.rate).toFixed(1).replace(/\.0$/,'')+"%";$("referralDaysStat").textContent=d.days;$("referralPendingStat").textContent=money(d.totals.pending);$("referralApprovedStat").textContent=money(d.totals.approved);$("referralRuleText").textContent=currentLanguage==='vi'?`Bạn nhận ${d.rate}% doanh thu ròng hợp lệ của thành viên được giới thiệu trong ${d.days} ngày kể từ khi họ đăng ký.`:`You earn ${d.rate}% of eligible referred-member net revenue for ${d.days} days after signup.`;$("referralsTable").innerHTML=d.items.length?d.items.map(x=>`<tr><td>${esc(x.name)}</td><td>${date(x.created_at)}</td><td>${money(x.pending_commission)}</td><td>${money(x.approved_commission)}</td></tr>`).join(""):'<tr><td colspan="4" class="empty">'+tr("No referrals yet. Share your link to get started.")+'</td></tr>';
$("commissionTable").innerHTML=d.commissions.length?d.commissions.map(x=>`<tr><td>${esc(x.referred_name)}</td><td>${money(x.basis_usd)}</td><td>${Number(x.rate_percent)}%</td><td>${money(x.amount_usd)}</td><td><span class="status ${esc(x.status)}">${esc(statusLabel(x.status))}</span></td><td>${date(x.created_at)}</td></tr>`).join(""):'<tr><td colspan="6" class="empty">'+tr("No commissions yet.")+'</td></tr>'}catch(e){toast(e.message,true)}}
$("copyReferral").onclick=async()=>{await navigator.clipboard.writeText($("referralUrl").value);toast(tr("Referral link copied"))};
$("copyReferralCode").onclick=async()=>{await navigator.clipboard.writeText($("referralCode").value);toast(tr("Referral code copied"))};
async function loadWallet(){try{const d=await api("/api/dashboard");$("walletBalance").textContent=money(d.stats.balance);$("payoutTable").innerHTML=d.payouts.length?d.payouts.map(p=>`<tr><td>#${p.id}</td><td>${money(p.amount)}</td><td>${esc(p.method)}</td><td><span class="status ${p.status}">${p.status}</span></td><td>${date(p.created_at)}</td></tr>`).join(""):'<tr><td colspan="5" class="empty">No payout requests yet.</td></tr>'}catch(e){toast(e.message,true)}}
$("requestPayout").onclick=async()=>{try{const d=await api("/api/payouts",{method:"POST",body:JSON.stringify({amount:$("payoutAmount").value,method:$("payoutMethod").value,details:$("payoutDetails").value})});toast(d.message);$("payoutAmount").value="";$("payoutDetails").value="";loadWallet()}catch(e){toast(e.message,true)}};
async function loadAdmin(){try{const d=await api("/api/admin/overview");$("adminUsers").textContent=d.users;$("adminLinks").textContent=d.links;$("adminClicks").textContent=d.clicks;$("adminPending").textContent=d.pending;$("adminPayouts").innerHTML=d.payouts.length?d.payouts.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.email)}</small></td><td>${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.details.slice(0,22))}</td><td><span class="status ${p.status}">${p.status}</span></td><td><select class="action-mini" data-payout="${p.id}"><option value="">Choose</option><option value="approved">Approve</option><option value="paid">Mark paid</option><option value="rejected">Reject</option></select></td></tr>`).join(""):'<tr><td colspan="6" class="empty">No payout requests.</td></tr>';$("adminCommissions").innerHTML=d.commissions.length?d.commissions.map(c=>`<tr><td>${esc(c.referrer_name)}<br><small>${esc(c.referrer_email)}</small></td><td>${esc(c.referred_name)}</td><td>${money(c.basis_usd)}</td><td>${Number(c.rate_percent)}%</td><td>${money(c.amount_usd)}</td><td><select class="action-mini" data-commission="${c.id}"><option value="">${tr("Choose")}</option><option value="approved">${tr("Approve")}</option><option value="rejected">${tr("Reject")}</option></select></td></tr>`).join(""):'<tr><td colspan="6" class="empty">'+tr("No pending commissions.")+'</td></tr>';$("settingCpm").value=d.settings.cpm_demo;$("settingMin").value=d.settings.min_payout;$("settingReferral").value=d.settings.referral_rate;$("settingReferralDays").value=d.settings.referral_days||365;$("settingAnnouncement").value=d.settings.announcement;document.querySelectorAll("[data-commission]").forEach(s=>s.onchange=async()=>{if(!s.value)return;try{await api("/api/admin/referral-commissions/"+s.dataset.commission+"/status",{method:"POST",body:JSON.stringify({status:s.value})});toast(tr("Commission reviewed"));loadAdmin()}catch(e){toast(e.message,true)}});document.querySelectorAll("[data-payout]").forEach(s=>s.onchange=async()=>{if(!s.value)return;try{await api("/api/admin/payouts/"+s.dataset.payout+"/status",{method:"POST",body:JSON.stringify({status:s.value})});toast("Payout status updated");loadAdmin()}catch(e){toast(e.message,true)}})}catch(e){toast(e.message,true)}}
$("saveSettings").onclick=async()=>{try{await api("/api/admin/settings",{method:"POST",body:JSON.stringify({cpm_demo:$("settingCpm").value,min_payout:$("settingMin").value,referral_rate:$("settingReferral").value,referral_days:$("settingReferralDays").value,announcement:$("settingAnnouncement").value})});toast("Settings saved")}catch(e){toast(e.message,true)}};
authMode();boot();


// Basic interface language switcher (Vietnamese / English).
const translations = {
  "TRAFFIC MONETIZATION, REIMAGINED":"KIẾM TIỀN TỪ LƯU LƯỢNG TRUY CẬP",
  "Your traffic.":"Lưu lượng truy cập của bạn.", "Your growth engine.":"Động lực phát triển của bạn.",
  "Shorten, share, unlock and understand everything from one workspace.":"Rút gọn, chia sẻ, mở khóa và theo dõi tất cả trong một nơi.",
  "Your name":"Họ và tên", "Email address":"Địa chỉ email", "Password":"Mật khẩu",
  "At least 8 characters":"Ít nhất 8 ký tự", "Sign in":"Đăng nhập", "Create account":"Tạo tài khoản",
  "New to LinkNova?":"Bạn mới dùng LinkNova?", "Create an account":"Tạo tài khoản", "Already have an account?":"Đã có tài khoản?",
  "Demo environment · no real ad earnings are generated":"Môi trường thử nghiệm · chưa phát sinh doanh thu quảng cáo thật",
  "ONE PLATFORM. MORE POSSIBILITIES.":"MỘT NỀN TẢNG. NHIỀU KHẢ NĂNG.", "Turn every":"Biến mỗi", "click into":"lượt nhấp thành", "clarity.":"giá trị rõ ràng.",
  "Bring your links, files and audience insights together. Built for creators who think bigger.":"Quản lý liên kết, tệp và dữ liệu người xem tại một nơi. Dành cho những nhà sáng tạo muốn phát triển.",
  "Shorten":"Rút gọn", "Monetize":"Kiếm tiền", "Optimize":"Tối ưu", "WORKSPACE":"KHÔNG GIAN LÀM VIỆC",
  "Overview":"Tổng quan", "Link manager":"Quản lý liên kết", "File sharing":"Chia sẻ tệp", "Referrals":"Giới thiệu bạn bè", "Wallet & payouts":"Ví & rút tiền", "Admin console":"Quản trị hệ thống",
  "Need a hand?":"Bạn cần trợ giúp?", "Explore the platform guide and get more from your traffic.":"Xem hướng dẫn để sử dụng nền tảng hiệu quả hơn.", "Open quick guide ↗":"Mở hướng dẫn nhanh ↗",
  "Sign out":"Đăng xuất", "DEMO MODE":"CHẾ ĐỘ THỬ NGHIỆM", "YOUR COMMAND CENTER":"TRUNG TÂM ĐIỀU KHIỂN",
  "Good to see you,":"Rất vui được gặp bạn,", "there":"bạn", "Here’s what’s happening across your LinkNova workspace.":"Đây là tình hình hoạt động trên LinkNova của bạn.", "＋ Create a link":"＋ Tạo liên kết",
  "Welcome to LinkNova":"Chào mừng đến với LinkNova", "Explore your workspace. Demo mode tracks activity locally; connect approved ad and payout providers before launching commercially.":"Khám phá không gian làm việc. Chế độ thử nghiệm chỉ ghi nhận hoạt động; cần kết nối nhà cung cấp quảng cáo và thanh toán phù hợp trước khi vận hành thương mại.",
  "Total clicks":"Tổng lượt nhấp", "Available balance":"Số dư khả dụng", "Files shared":"Tệp đã chia sẻ", "People in your network":"Người trong mạng lưới của bạn", "Across your short links":"Trên tất cả liên kết rút gọn", "Demo ledger balance":"Số dư thử nghiệm", "total downloads":"lượt tải xuống",
  "Traffic overview":"Tổng quan truy cập", "Click activity over the last 7 days":"Hoạt động nhấp trong 7 ngày qua", "LAST 7 DAYS":"7 NGÀY QUA", "Quick actions":"Thao tác nhanh", "Pick up where you left off":"Tiếp tục công việc của bạn",
  "Shorten a link":"Rút gọn liên kết", "Create a trackable short URL":"Tạo URL ngắn có thể theo dõi", "Share a file":"Chia sẻ tệp", "Upload and create an unlock page":"Tải lên và tạo trang mở khóa", "Request payout":"Yêu cầu rút tiền", "Review your wallet activity":"Xem hoạt động ví",
  "Recent links":"Liên kết gần đây", "Your latest shortened URLs":"Các URL mới rút gọn", "View all →":"Xem tất cả →", "LINK":"LIÊN KẾT", "DESTINATION":"ĐÍCH ĐẾN", "CLICKS":"LƯỢT NHẤP", "CREATED":"NGÀY TẠO", "No links yet. Create your first short link.":"Chưa có liên kết. Hãy tạo liên kết đầu tiên.",
  "LINK MANAGEMENT":"QUẢN LÝ LIÊN KẾT", "Create branded, trackable links and understand how they perform.":"Tạo liên kết dễ nhớ, theo dõi và đánh giá hiệu quả.", "＋ New link":"＋ Liên kết mới", "Your links":"Liên kết của bạn", "Manage destinations and monetization settings.":"Quản lý đường dẫn đích và cài đặt kiếm tiền.", "Search links…":"Tìm liên kết…", "SHORT LINK":"LINK RÚT GỌN", "MODE":"CHẾ ĐỘ", "ACTIONS":"THAO TÁC", "Loading links…":"Đang tải liên kết…",
  "CONTENT DELIVERY":"PHÂN PHỐI NỘI DUNG", "Upload resources and share a simple unlock page.":"Tải tài liệu lên và chia sẻ qua trang mở khóa.", "Upload a file":"Tải tệp lên", "Maximum file size is configured by the server. Keep uploads lawful and safe to share.":"Dung lượng tối đa do máy chủ cấu hình. Chỉ tải lên nội dung hợp pháp và an toàn.", "Choose a file":"Chọn tệp", "Your files":"Tệp của bạn", "Share links to your uploaded content.":"Chia sẻ liên kết đến nội dung đã tải lên.", "FILE":"TỆP", "SIZE":"DUNG LƯỢNG", "DOWNLOADS":"LƯỢT TẢI", "SHARE LINK":"LIÊN KẾT CHIA SẺ", "No files uploaded yet.":"Chưa có tệp nào được tải lên.",
  "GROW TOGETHER":"CÙNG NHAU PHÁT TRIỂN", "Referral program":"Chương trình giới thiệu", "Invite creators to LinkNova and build your network.":"Mời người dùng tham gia LinkNova và mở rộng mạng lưới.", "YOUR INVITE LINK":"LIÊN KẾT GIỚI THIỆU CỦA BẠN", "Good things grow":"Điều tốt đẹp sẽ lớn mạnh", "when they're shared.":"khi được sẻ chia.", "Share your unique referral link. Referral rewards are configurable and remain disabled as cash earnings until a real program is funded.":"Chia sẻ liên kết giới thiệu riêng. Phần thưởng giới thiệu có thể cấu hình nhưng chưa được kích hoạt thành thu nhập thật.", "Copy link":"Sao chép liên kết", "INVITE · CONNECT · GROW":"MỜI · KẾT NỐI · PHÁT TRIỂN", "Your network":"Mạng lưới của bạn", "People who joined using your invitation.":"Những người tham gia bằng lời mời của bạn.", "MEMBER":"THÀNH VIÊN", "JOINED":"NGÀY THAM GIA", "No referrals yet. Share your link to get started.":"Chưa có lượt giới thiệu. Hãy chia sẻ liên kết của bạn.",
  "PAYOUT CENTER":"TRUNG TÂM THANH TOÁN", "Review your ledger and submit a payout request.":"Xem lịch sử số dư và gửi yêu cầu rút tiền.", "AVAILABLE BALANCE":"SỐ DƯ KHẢ DỤNG", "Demo balance · no real funds are held":"Số dư thử nghiệm · không có tiền thật được lưu giữ", "Transparent by design":"Minh bạch ngay từ đầu", "LinkNova starts in demo mode. A real payout requires verified revenue, a payment provider, identity checks where applicable, and admin approval.":"LinkNova đang ở chế độ thử nghiệm. Rút tiền thật cần doanh thu được xác minh, nhà cung cấp thanh toán, xác minh danh tính khi cần và phê duyệt quản trị viên.", "Request a payout":"Yêu cầu rút tiền", "Submit details for review by the platform administrator.":"Gửi thông tin để quản trị viên xem xét.", "Amount (USD)":"Số tiền (USD)", "Payment method":"Phương thức thanh toán", "Payment details":"Thông tin thanh toán", "Submit request":"Gửi yêu cầu", "Minimum payout is configured by the administrator. Requests are not processed automatically.":"Mức rút tối thiểu do quản trị viên cấu hình. Yêu cầu không được xử lý tự động.", "Payout history":"Lịch sử rút tiền", "Recent payout requests and their status.":"Các yêu cầu rút tiền gần đây và trạng thái.", "REQUEST":"YÊU CẦU", "AMOUNT":"SỐ TIỀN", "METHOD":"PHƯƠNG THỨC", "STATUS":"TRẠNG THÁI", "DATE":"NGÀY", "No payout requests yet.":"Chưa có yêu cầu rút tiền.",
  "PLATFORM OPERATIONS":"VẬN HÀNH NỀN TẢNG", "Monitor platform activity and review payout requests.":"Theo dõi hoạt động và xem xét yêu cầu rút tiền.", "Members":"Thành viên", "Short links":"Liên kết rút gọn", "Tracked clicks":"Lượt nhấp được ghi nhận", "Pending payouts":"Yêu cầu chờ xử lý", "Payout review":"Xét duyệt rút tiền", "Approve, mark paid, or reject a request.":"Phê duyệt, đánh dấu đã thanh toán hoặc từ chối yêu cầu.", "DETAILS":"CHI TIẾT", "ACTION":"THAO TÁC", "No payout requests.":"Không có yêu cầu rút tiền.", "Platform settings":"Cài đặt nền tảng", "Demo configuration only. CPM is not a real ad network payout.":"Chỉ là cấu hình thử nghiệm. CPM không phải khoản thanh toán thật từ mạng quảng cáo.", "Demo CPM (USD)":"CPM thử nghiệm (USD)", "Minimum payout (USD)":"Mức rút tối thiểu (USD)", "Referral rate (%)":"Tỷ lệ giới thiệu (%)", "Announcement":"Thông báo", "Save settings":"Lưu cài đặt",
  "Choose your sharing link.":"Chọn loại liên kết muốn chia sẻ.", "Select one of the three link types before creating your link.":"Chọn một trong ba loại liên kết trước khi tạo.", "Direct share link (no ads)":"Link chia sẻ không quảng cáo", "Visitors go straight to the destination when they open the link.":"Người nhận mở link và được chuyển thẳng đến nội dung đích.", "Direct redirect":"Chuyển hướng trực tiếp", "Long ad-style link (multi-step task flow)":"Link chia sẻ quảng cáo dài (nhiệm vụ)", "A multi-step interstitial with a timer before visitors continue.":"Trang trung gian nhiều bước, có bộ đếm thời gian trước khi tiếp tục.", "Long flow · demo":"Luồng dài · bản thử nghiệm", "Short ad-style link":"Link quảng cáo ngắn", "A compact interstitial with a short wait before redirecting.":"Trang trung gian gọn với thời gian chờ ngắn trước khi chuyển hướng.", "Short flow · demo":"Luồng ngắn · bản thử nghiệm", "Create link →":"Tạo liên kết →", "Note: ad pages are currently demos. They do not show paid ads or generate revenue. Visitors are never asked to click fake ads or complete fake ad tasks.":"Lưu ý: trang quảng cáo hiện chỉ là mô phỏng, chưa hiển thị quảng cáo trả phí và chưa tạo doanh thu. Không yêu cầu người xem nhấp quảng cáo giả hoặc làm nhiệm vụ giả.", "Link type":"Loại liên kết", "LINK TYPE":"LOẠI LIÊN KẾT",  "CREATE NEW LINK":"TẠO LIÊN KẾT MỚI", "Make it shareable.":"Tạo liên kết để chia sẻ.", "Add a destination and choose how visitors continue.":"Thêm đường dẫn đích và chọn cách khách truy cập tiếp tục.", "Destination URL":"URL đích", "Link title":"Tiêu đề liên kết", "(optional)":"(không bắt buộc)", "My campaign link":"Liên kết chiến dịch của tôi", "Show interstitial step":"Hiển thị trang trung gian", "Display a configurable ad placement before redirecting.":"Hiển thị vị trí quảng cáo cấu hình được trước khi chuyển hướng.", "Create short link →":"Tạo link rút gọn →", "The demo interstitial is a placeholder, not a paid advertisement.":"Trang trung gian chỉ là bản mẫu, không phải quảng cáo trả phí.", "QUICK START":"BẮT ĐẦU NHANH", "Welcome to your workspace.":"Chào mừng đến không gian làm việc.", "Create a short link":"Tạo liên kết rút gọn", "Paste a destination URL and share your generated link.":"Dán URL đích và chia sẻ liên kết vừa tạo.", "Upload a resource":"Tải tài liệu lên", "Files get a simple unlock page and a private download route.":"Tệp có trang mở khóa đơn giản và đường dẫn tải riêng.", "Invite your network":"Mời mạng lưới của bạn", "Share your referral URL and track signups.":"Chia sẻ URL giới thiệu và theo dõi lượt đăng ký.", "Review your wallet":"Kiểm tra ví", "Test payout requests in the demo ledger.":"Thử gửi yêu cầu rút tiền trong hệ thống thử nghiệm.", "Before production: connect an approved ad provider, payment gateway, object storage, email delivery and monitoring.":"Trước khi vận hành thật: kết nối nhà cung cấp quảng cáo được duyệt, cổng thanh toán, lưu trữ tệp, email và giám sát hệ thống.", "Got it":"Đã hiểu", "Workspace":"Không gian làm việc",
  "Referral code":"Mã giới thiệu", "Commission rate":"Tỷ lệ hoa hồng", "Reward period":"Thời hạn nhận thưởng", "Pending commission":"Hoa hồng chờ duyệt", "Approved commission":"Hoa hồng đã duyệt", "Commission history":"Lịch sử hoa hồng", "Invite creators to LinkNova and earn a share of verified net revenue.":"Mời người dùng tham gia LinkNova và nhận chia sẻ từ doanh thu ròng đã xác minh.", "People who joined using your invitation and their commission totals.":"Những người tham gia bằng lời mời của bạn và tổng hoa hồng tương ứng.", "Referral rate (%) · max 30":"Tỷ lệ hoa hồng (%) · tối đa 30", "Rate and referral period apply to new verified ad-revenue events. Changes do not rewrite past commissions.":"Tỷ lệ và thời hạn áp dụng cho sự kiện doanh thu đã xác minh phát sinh sau này. Thay đổi không làm tính lại hoa hồng cũ.", "Enter your referral code":"Nhập mã giới thiệu của bạn", "Have an invite code? Enter it here. You can also open a referral link.":"Bạn có mã mời? Nhập tại đây hoặc mở liên kết giới thiệu.",
  "Your referral code":"Mã giới thiệu của bạn", "Your referral link":"Liên kết giới thiệu của bạn", "Copy code":"Sao chép mã", "Grow together.":"Cùng nhau phát triển.", "Earn transparently.":"Kiếm thưởng minh bạch.", "Share your personal referral link or code. Your referral attribution is locked when a new member registers.":"Chia sẻ liên kết hoặc mã giới thiệu cá nhân. Nguồn giới thiệu được cố định khi thành viên mới đăng ký.",
  "Invite a new member":"Mời thành viên mới", "They enter your code during registration or use your referral link. The referral is recorded once and cannot be changed later.":"Họ nhập mã của bạn khi đăng ký hoặc dùng liên kết giới thiệu. Người giới thiệu được ghi nhận một lần và không thể thay đổi sau đó.", "They generate valid ad revenue":"Họ tạo doanh thu quảng cáo hợp lệ", "Only net revenue confirmed by an approved ad provider can generate a commission. Demo clicks and test interstitials do not count.":"Chỉ doanh thu ròng được nhà cung cấp quảng cáo xác nhận mới được tính hoa hồng. Lượt nhấp thử nghiệm và trang trung gian Demo không được tính.", "Your commission is calculated":"Hoa hồng được tính", "You earn 10% of eligible referred-member net revenue for 365 days after signup.":"Bạn nhận 10% doanh thu ròng hợp lệ của thành viên được giới thiệu trong 365 ngày kể từ khi họ đăng ký.", "Admin reviews and approves":"Quản trị viên kiểm tra và duyệt", "Commission stays pending until fraud checks and provider reconciliation are completed. Approved amounts are added to your wallet.":"Hoa hồng ở trạng thái chờ cho đến khi kiểm tra gian lận và đối soát nhà cung cấp hoàn tất. Khoản được duyệt sẽ cộng vào ví.", "Self-referrals, fake accounts, incentivized/automated traffic, chargebacks and invalid traffic are excluded. LinkNova may reverse unpaid rewards for provider adjustments or fraud.":"Không tính tự giới thiệu, tài khoản giả, lưu lượng có thưởng/tự động, giao dịch bị hoàn tiền và lưu lượng không hợp lệ. LinkNova có thể hủy khoản chưa thanh toán nếu nhà cung cấp điều chỉnh hoặc phát hiện gian lận.",
  "Of verified net revenue":"Trên doanh thu ròng đã xác minh", "Days from signup":"Ngày kể từ khi đăng ký", "Awaiting admin review":"Đang chờ quản trị viên duyệt", "Added to your wallet":"Đã cộng vào ví", "How referral rewards work":"Cách tính hoa hồng giới thiệu", "One-level referral program · no payment for signups alone.":"Chương trình một cấp · không trả thưởng chỉ vì có lượt đăng ký.", "No commissions yet.":"Chưa có hoa hồng.", "No pending commissions.":"Không có hoa hồng chờ duyệt.", "NET REVENUE":"DOANH THU RÒNG", "COMMISSION":"HOA HỒNG", "RATE":"TỶ LỆ", "REVENUE BASIS":"DOANH THU LÀM CĂN CỨ", "REFERRER":"NGƯỜI GIỚI THIỆU", "REFERRED MEMBER":"NGƯỜI ĐƯỢC GIỚI THIỆU", "Referral commission review":"Duyệt hoa hồng giới thiệu", "Approve only after checking the ad provider report and invalid-traffic signals.":"Chỉ duyệt sau khi kiểm tra báo cáo nhà cung cấp quảng cáo và dấu hiệu lưu lượng không hợp lệ.", "Referral period (days)":"Thời hạn giới thiệu (ngày)", "Commission reviewed":"Đã xử lý hoa hồng", "Referral code copied":"Đã sao chép mã giới thiệu", "Referral link copied":"Đã sao chép liên kết giới thiệu", "Choose":"Chọn", "Approve":"Duyệt", "Reject":"Từ chối"
};
function tr(text){return currentLanguage==='vi'?(translations[text]||text):text}
function statusLabel(status){const vi={pending:"Chờ duyệt",approved:"Đã duyệt",rejected:"Từ chối",paid:"Đã thanh toán"};return currentLanguage==='vi'?(vi[status]||status):status}
let currentLanguage = localStorage.getItem('linknova-language') || 'vi';
function applyLanguage(lang){
  currentLanguage=lang; localStorage.setItem('linknova-language',lang);
  document.documentElement.lang=lang==='vi'?'vi':'en';
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let node; while(node=walker.nextNode()){ if(!node.datasetOriginalText) node.datasetOriginalText=node.nodeValue; const original=node.datasetOriginalText.trim(); if(!original) continue; const translated=translations[original]||original; const lead=node.datasetOriginalText.match(/^\s*/)?.[0]||''; const tail=node.datasetOriginalText.match(/\s*$/)?.[0]||''; node.nodeValue=lead+(lang==='vi'?translated:original)+tail; }
  document.querySelectorAll('input[placeholder],button[title]').forEach(el=>{const attr=el.hasAttribute('placeholder')?'placeholder':'title';if(!el.dataset['original'+attr])el.dataset['original'+attr]=el.getAttribute(attr);const v=el.dataset['original'+attr];el.setAttribute(attr,lang==='vi'?(translations[v]||v):v)});
  ['languageToggle','languageToggleAuth'].forEach(id=>{const b=$(id);if(b)b.textContent=lang==='vi'?'VI / EN':'EN / VI'});
}
function toggleLanguage(){applyLanguage(currentLanguage==='vi'?'en':'vi');if($("page-referrals")?.classList.contains("active"))loadReferrals();if($("page-admin")?.classList.contains("active"))loadAdmin()}
$('languageToggle')?.addEventListener('click',toggleLanguage); $('languageToggleAuth')?.addEventListener('click',toggleLanguage);
applyLanguage(currentLanguage);



/* ═══════════════════════════════════════════════════════════
   VIP & ADS MODULE — dữ liệu lưu trên server (không còn localStorage)
   ═══════════════════════════════════════════════════════════ */
(function () {
  const vi = () => currentLanguage === 'vi';
  const isVip = () => !!(user && user.isVip);
  const HINT = '3–30 chars · lowercase letters, numbers, hyphens';

  function applyVipGate() {
    const vip = isVip(), slug = $('customSlug'), toggle = $('vipDecodeToggle');
    if ($('slugPrefix')) $('slugPrefix').textContent = location.host + '/';
    if (slug) { slug.disabled = !vip; slug.placeholder = vip ? 'my-custom-name' : (vi() ? 'Nâng cấp VIP để mở khóa' : 'Upgrade to VIP to unlock'); }
    if (toggle) toggle.disabled = !vip;
    if ($('vipStatusTitle')) $('vipStatusTitle').textContent = vip ? 'VIP member' : 'Free plan';
    if ($('vipStatusDesc')) $('vipStatusDesc').textContent = vip
      ? 'You have access to custom slugs, link decoding, and paid ad campaigns.'
      : 'Upgrade to unlock custom slugs, link decoding, and paid ad campaigns.';
    applyLanguage(currentLanguage);
  }

  function finishLinkModal() {
    $('linkModal').classList.add('hidden');
    $('destinationInput').value = ''; $('titleInput').value = '';
    if ($('customSlug')) $('customSlug').value = '';
    if ($('vipDecodeToggle')) $('vipDecodeToggle').checked = false;
    if ($('slugHint')) { $('slugHint').textContent = HINT; $('slugHint').className = 'muted'; }
  }

  function patchCreateLink() {
    const btn = $('createLinkBtn');
    btn.onclick = async () => {
      if (btn.disabled) return;
      const destination = $('destinationInput').value.trim();
      if (!destination) { toast(vi() ? 'Vui lòng nhập liên kết đích.' : 'Enter a destination URL.', true); return; }
      const payload = { destination, title: $('titleInput').value.trim(), linkType: selectedLinkType() };
      const slug = isVip() ? ($('customSlug').value || '').trim().toLowerCase() : '';
      if (slug) payload.slug = slug;
      if (isVip() && $('vipDecodeToggle').checked) payload.vipDecode = true;
      btn.disabled = true;
      try {
        const d = await api('/api/links', { method: 'POST', body: JSON.stringify(payload) });
        finishLinkModal();
        toast(tr('Your short link is ready'));
        try { await navigator.clipboard.writeText(d.link.url); } catch {}
        navigate('links'); loadDashboard();
      } catch (e) { toast(e.message, true); }
      finally { btn.disabled = false; }
    };
    const open = $('openLinkModal'), prev = open.onclick;
    open.onclick = () => { applyVipGate(); prev(); };
  }

  function decodeLink(raw) {
    raw = String(raw || '').trim();
    if (!raw) return { ok: false, msg: 'Paste a LinkNova link to decode.' };
    let code = raw;
    try { code = new URL(raw, location.origin).pathname.replace(/^\/+|\/+$/g, ''); } catch {}
    // Chỉ giải mã liên kết thuộc workspace của chính người dùng.
    const found = (window.allLinks || []).find(l => l.code.toLowerCase() === code.toLowerCase());
    if (!found) return { ok: false, msg: 'No matching link found in this workspace.' };
    if (!found.vipDecode) return { ok: false, msg: 'This link was not marked VIP-decodable by its creator.' };
    return { ok: true, original: found.destination };
  }
  function bindDecoder() {
    $('decodeBtn').onclick = () => {
      const out = $('decodeResult'); out.classList.remove('hidden');
      if (!isVip()) { out.className = 'decode-result err'; out.innerHTML = '<b>VIP required.</b> Upgrade to use the decoder.'; return; }
      const r = decodeLink($('decodeInput').value);
      if (!r.ok) { out.className = 'decode-result err'; out.innerHTML = '<b>Could not decode.</b><span style="font-size:11px">' + esc(r.msg) + '</span>'; return; }
      out.className = 'decode-result';
      out.innerHTML = '<b>Decoded ✓</b><code>' + esc(r.original) + '</code><a class="btn btn-primary" href="' + esc(r.original) + '" target="_blank" rel="noopener noreferrer">' + (vi() ? 'Mở liên kết gốc' : 'Open destination') + ' ↗</a>';
    };
  }

  function populateCampaignLinks() {
    const all = window.allLinks || [];
    $('campaignLink').innerHTML = all.length
      ? all.map(l => '<option value="' + esc(l.code) + '">' + esc(l.title || l.code) + '</option>').join('')
      : '<option value="">' + (vi() ? 'Chưa có link — tạo trước' : 'No links yet — create one first') + '</option>';
  }
  async function renderCampaigns() {
    const tbody = $('campaignTable');
    try {
      const { campaigns } = await api('/api/campaigns');
      tbody.innerHTML = campaigns.length ? campaigns.map(c =>
        '<tr><td><b>' + esc(c.link_title || c.link_code) + '</b></td><td>' + money(c.budget) + '</td><td>' + money(c.bid) + '</td><td>0 / ' + Math.floor(c.budget / c.bid) +
        '</td><td>' + money(0) + '</td><td><span class="status pending">' + (vi() ? 'Demo · chưa chạy' : 'Demo · not running') + '</span></td></tr>').join('')
        : '<tr><td colspan="6" class="empty">' + (vi() ? 'Chưa có chiến dịch nào.' : 'No campaigns yet.') + '</td></tr>';
    } catch (e) { toast(e.message, true); }
  }
  function bindCampaigns() {
    $('createCampaign').onclick = async () => {
      if (!isVip()) { toast(vi() ? 'Cần VIP để tạo chiến dịch.' : 'VIP required.', true); return; }
      try {
        await api('/api/campaigns', { method: 'POST', body: JSON.stringify({
          linkCode: $('campaignLink').value, budget: $('campaignBudget').value, bid: $('campaignBid').value, days: $('campaignDays').value }) });
        toast(vi() ? 'Đã lưu chiến dịch (demo, chưa trừ tiền).' : 'Campaign saved (demo, nothing charged).');
        $('campaignBudget').value = ''; $('campaignBid').value = ''; renderCampaigns();
      } catch (e) { toast(e.message, true); }
    };
  }

  window.loadVip = async function () {
    applyVipGate();
    try { window.allLinks = (await api('/api/links')).links; } catch {}
    populateCampaignLinks(); renderCampaigns();
  };

  function bindSlugHint() {
    const input = $('customSlug'), hint = $('slugHint'); let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      if (!input.value) { hint.textContent = HINT; hint.className = 'muted'; return; }
      t = setTimeout(async () => {
        try { const r = await api('/api/slug/check?slug=' + encodeURIComponent(input.value.trim())); hint.textContent = r.message; hint.className = r.available ? 'ok' : 'err'; } catch {}
      }, 300);
    });
  }
  function bindAdminVip() {
    const b = $('grantVipBtn'); if (!b) return;
    b.onclick = async () => {
      try { await api('/api/admin/users/plan', { method: 'POST', body: JSON.stringify({ email: $('vipEmail').value, plan: $('vipPlan').value }) }); toast('Plan updated'); }
      catch (e) { toast(e.message, true); }
    };
  }
  $('openVipUpgrade').onclick = () => toast(vi() ? 'Liên hệ quản trị viên hoặc kết nối cổng thanh toán để nâng cấp VIP.' : 'Contact an admin or connect a payment provider to upgrade.');

  Object.assign(translations, {
    'PREMIUM TOOLS': 'CÔNG CỤ CAO CẤP',
    'VIP & Ads': 'VIP & Quảng cáo',
    'Unlock premium link features and run paid click campaigns.': 'Mở khóa tính năng liên kết cao cấp và chạy chiến dịch quảng cáo trả phí.',
    '★ Upgrade to VIP': '★ Nâng cấp VIP',
    'MEMBERSHIP': 'TƯ CÁCH THÀNH VIÊN',
    'Free plan': 'Gói miễn phí',
    'VIP member': 'Thành viên VIP',
    'Upgrade to unlock custom slugs, link decoding, and paid ad campaigns.': 'Nâng cấp để mở khóa slug tùy chỉnh, giải mã liên kết và quảng cáo trả phí.',
    'You have access to custom slugs, link decoding, and paid ad campaigns.': 'Bạn đã có slug tùy chỉnh, giải mã liên kết và chiến dịch quảng cáo.',
    'Custom slug': 'Slug tùy chỉnh',
    'Pick your own back-half': 'Tự chọn phần đuôi link',
    'Link decode': 'Giải mã liên kết',
    'Bypass the interstitial': 'Bỏ qua trang trung gian',
    'Ad campaigns': 'Chiến dịch quảng cáo',
    'Pay-per-click promotion': 'Quảng bá tính phí theo lượt nhấp',
    'Advanced analytics': 'Phân tích nâng cao',
    'Deeper traffic insights': 'Hiểu sâu hơn về lưu lượng',
    'Link decoder': 'Công cụ giải mã liên kết',
    'Paste a LinkNova short link to reveal and open the original destination.': 'Dán liên kết LinkNova để xem và mở đích gốc.',
    'Decode': 'Giải mã',
    'Only works for links where the creator enabled VIP decoding.': 'Chỉ hoạt động với liên kết mà người tạo đã bật giải mã VIP.',
    'Create a click campaign': 'Tạo chiến dịch nhấp',
    'Pay to promote your link through paid clicks on the LinkNova network.': 'Trả tiền để quảng bá liên kết qua lượt nhấp trả phí trên LinkNova.',
    'Select link to promote': 'Chọn liên kết để quảng bá',
    'Budget (USD)': 'Ngân sách (USD)',
    'Max bid per click (USD)': 'Giá thầu tối đa mỗi nhấp (USD)',
    'Duration (days)': 'Thời gian (ngày)',
    'Launch campaign': 'Khởi chạy chiến dịch',
    'Campaigns are demo-only. No real ad delivery until an approved ad network is connected.': 'Chiến dịch chỉ là demo. Chưa phân phối quảng cáo thật cho đến khi kết nối mạng quảng cáo được duyệt.',
    'Your campaigns': 'Chiến dịch của bạn',
    'Active and past click campaigns.': 'Các chiến dịch đang chạy và đã qua.',
    'BUDGET': 'NGÂN SÁCH',
    'BID': 'GIÁ THẦU',
    'SPENT': 'ĐÃ CHI',
    'No campaigns yet.': 'Chưa có chiến dịch nào.',
    'Custom back-half': 'Đuôi liên kết tùy chỉnh',
    '3–30 chars · lowercase letters, numbers, hyphens': '3–30 ký tự · chữ thường, số, gạch ngang',
    'Allow VIP members to decode this link': 'Cho phép thành viên VIP giải mã liên kết này',
    'VIP members can paste this link into the decoder to open the destination directly.': 'Thành viên VIP có thể dán liên kết vào công cụ giải mã để mở thẳng đích gốc.',
    'Select one of the three link types before creating your link.': 'Chọn một trong ba loại liên kết trước khi tạo.'
  });
  Object.assign(translations, { 'Reveal your link\'s destination': 'Xem đích gốc của liên kết bạn' });
  patchCreateLink(); bindDecoder(); bindCampaigns(); bindSlugHint(); bindAdminVip();
  const showAppBase = showApp;
  showApp = function () { showAppBase(); applyVipGate(); };
  applyLanguage(currentLanguage);
})();

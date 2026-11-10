/**
 * 服务端渲染页面(eterna 风格系统 v1,令牌化双主题):
 * - 风格规范见 docs/design/frontend-style.md——本文件即参考实现,后续页面必须复用 shell() 与令牌
 * - 深色为默认基调(匹配 dsh 应用底色 #151517),浅色经 prefers-color-scheme 自适应
 * - 账号页结构:个人资料卡(头像+昵称合并保存,脏检查)+安全卡(密码修改独立)
 * - 角标:注入 dsh index 页;401 → 跳 /login(门禁);404/网络错误静默降级
 */
import { escapeHtml } from './http.ts'

const STYLE = `
:root{
  color-scheme:dark;
  --bg:#151517;--bg-a:#1b1b20;--bg-b:#151517;
  --surface:#1e1e23;--surface-2:#26262c;
  --text:#f3f4f6;--dim:#9ca3af;
  --border:rgba(255,255,255,.09);
  --accent:#818cf8;--accent-strong:#6366f1;--accent-soft:rgba(99,102,241,.18);
  --danger:#f87171;--ok:#34d399;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 16px 48px rgba(0,0,0,.45);
}
@media (prefers-color-scheme:light){
  :root{
    color-scheme:light;
    --bg:#eef0f6;--bg-a:#eef2ff;--bg-b:#f8fafc;
    --surface:#ffffff;--surface-2:#f3f4f6;
    --text:#111827;--dim:#6b7280;
    --border:rgba(17,24,39,.10);
    --accent:#4f46e5;--accent-strong:#4338ca;--accent-soft:rgba(79,70,229,.12);
    --danger:#dc2626;--ok:#059669;
    --shadow:0 1px 2px rgba(31,41,55,.06),0 12px 40px rgba(31,41,55,.10);
  }
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
  background:radial-gradient(1200px 600px at 50% -10%,var(--bg-a),var(--bg-b));color:var(--text);
  font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
.topbar{position:sticky;top:0;z-index:10;width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 20px;background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.topbar .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:var(--accent);text-decoration:none;margin:0}
.topbar .who{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text)}
.topbar a.navlink{color:var(--accent);text-decoration:none;font-size:13px;padding:6px 10px;border-radius:8px}
.topbar a.navlink:hover{background:var(--accent-soft)}
.topbar button{width:auto;margin:0;padding:6px 10px;font-size:13px;background:none;color:var(--danger);border-radius:8px}
.topbar button:hover{background:color-mix(in srgb,var(--danger) 14%,transparent)}
main{flex:1;display:flex;align-items:center;justify-content:center;width:100%;padding:28px 16px}
.stack{display:flex;flex-direction:column;gap:16px;width:min(1100px,94vw)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.grid2.ratio{grid-template-columns:1.6fr 1fr}
.plug{display:flex;flex-direction:column;gap:2px;padding:9px 0;border-bottom:1px solid var(--border)}
.plug:last-child{border-bottom:0}
.plug b{font-weight:600;font-size:13.5px}
.pagehead{display:flex;align-items:baseline;gap:12px;width:100%}
.pagehead h2{margin:0}
.pagehead .muted{font-size:13px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);padding:26px;width:min(420px,94vw)}
.card.wide{width:100%}
h2{margin:0 0 6px;font-size:19px;letter-spacing:.2px}
h3{font-size:14px;margin:0 0 8px;color:var(--text);font-weight:600}
label{display:block;font-size:13px;color:var(--dim);margin:12px 0 4px}
input,select{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;
  background:var(--surface-2);color:var(--text);transition:border-color .15s,box-shadow .15s}
input::placeholder{color:color-mix(in srgb,var(--dim) 70%,transparent)}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
input[type=file]{padding:7px;color:var(--dim)}
button{margin-top:16px;width:auto;min-width:120px;padding:10px 22px;border:0;border-radius:8px;
  background:linear-gradient(135deg,var(--accent-strong),var(--accent));color:#fff;font-size:14px;font-weight:500;
  cursor:pointer;transition:filter .15s,transform .05s,opacity .15s}
button:hover{filter:brightness(1.1)}
button:active{transform:translateY(1px)}
button:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft)}
button:disabled{opacity:.5;cursor:not-allowed;filter:none}
.card.narrow button{width:100%}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--border);width:auto;margin:0;padding:8px 14px;font-weight:400;white-space:nowrap}
button.ghost:hover{background:var(--surface-2)}
.err{color:var(--danger);font-size:13px;min-height:18px;margin:10px 0 0;white-space:pre-wrap}
.ok{color:var(--ok);font-size:13px;min-height:18px;margin:4px 0 0}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
th,td{padding:8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:middle}
th{color:var(--dim);font-weight:600;background:var(--surface-2)}
tbody tr:hover{background:var(--surface-2)}
.avatar{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;
  display:inline-flex;align-items:center;justify-content:center;font-size:13px;overflow:hidden;flex:none}
.avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.tag{font-size:11px;padding:2px 6px;border-radius:6px;background:var(--accent-soft);color:var(--accent)}
.tag.red{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}
.danger{color:var(--danger);cursor:pointer;background:none;border:0;padding:0;width:auto;margin:0;font-size:13px}
.danger:hover{text-decoration:underline}
.muted{color:var(--dim);font-size:12px}
.row{display:flex;gap:8px;align-items:center}
.shell{display:flex;flex:1;width:min(1200px,96vw);margin:0 auto;gap:20px;padding:22px 16px;align-items:flex-start}
.menu{width:190px;flex:none;display:flex;flex-direction:column;gap:4px;position:sticky;top:76px}
.menuitem{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;color:var(--dim);text-decoration:none;font-size:14px;transition:background .12s,color .12s}
.menuitem:hover{background:var(--surface-2);color:var(--text)}
.menuitem.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
.menuitem .ic{width:18px;text-align:center}
.content{flex:1;min-width:0}
.panel{display:none}
.panel.active{display:block;animation:fadein .16s ease}
@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (max-width:900px){
  .grid2,.grid2.ratio{grid-template-columns:1fr}
  .shell{flex-direction:column}
  .menu{flex-direction:row;width:100%;position:static;overflow-x:auto}
  .menuitem{flex:none}
}
@media (max-width:640px){
  .topbar{padding:8px 12px}
  .topbar .who .nick{display:none}
  main{padding:16px 10px}
  .card{padding:22px 18px}
  .row{flex-wrap:wrap}
}
@media (prefers-reduced-motion:reduce){
  *{transition:none!important}
}
`

/** 页面骨架:topbar(viewer 在场=身份+返回+退出)+main。登录页 viewer 缺省。 */
function shell(title: string, body: string, script = '', viewer?: { nickname: string; avatarUrl: string | null; account: string }): string {
  const bar = `<header class="topbar">
<a class="brand" href="/" title="返回应用">⚡ 恒灵 · EternaAgent</a>
${viewer === undefined ? '' : `<nav class="who">
${avatarHtml(viewer.avatarUrl, viewer.nickname, 24)}
<span class="nick">${escapeHtml(viewer.nickname)}</span>
<a class="navlink" href="/account">账号设置</a>
<button data-logout title="退出登录">退出</button>
</nav>`}
</header>`
  const logoutScript = viewer === undefined ? '' : `<script>(function(){
  var btn=document.querySelector('[data-logout]')
  if(btn)btn.addEventListener('click',function(){
    btn.disabled=true
    fetch('/logout',{method:'POST',credentials:'same-origin'}).then(function(){location.href='/login'})})
})()</script>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 恒灵 EternaAgent</title><style>${STYLE}</style></head><body>${bar}<main>${body}</main>${logoutScript}${script === '' ? '' : `<script>${script}</script>`}</body></html>`
}

function avatarHtml(avatarUrl: string | null, nickname: string, size = 26): string {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px`
  if (avatarUrl !== null) {
    return `<span class="avatar" style="${style}"><img src="${escapeHtml(avatarUrl)}" alt=""></span>`
  }
  return `<span class="avatar" style="${style}">${escapeHtml(nickname.slice(0, 1) || '?')}</span>`
}

/** 登录页(viewer 缺省=无导航身份)。 */
export function renderLoginPage(): string {
  const body = `<div class="card narrow"><h2>登录</h2>
<label>账号</label><input id="account" autocomplete="username">
<label>密码</label><input id="password" type="password" autocomplete="current-password">
<button id="go">登录</button><p class="err" id="msg"></p></div>`
  const script = `
var go=document.getElementById('go'),msg=document.getElementById('msg')
function submit(){
  msg.textContent=''
  go.disabled=true
  var account=document.getElementById('account').value,password=document.getElementById('password').value
  fetch('/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
    body:JSON.stringify({account:account,password:password})}).then(function(r){
    if(r.ok){location.href='/';return null}
    go.disabled=false
    return r.json().catch(function(){return null}).then(function(d){
      msg.textContent=(d&&d.error)||('登录失败('+r.status+')')})
  }).catch(function(){go.disabled=false;msg.textContent='网络错误，请重试'})
}
go.addEventListener('click',submit)
document.getElementById('password').addEventListener('keydown',function(e){if(e.key==='Enter')submit()})
`
  return shell('登录', body, script)
}

/** 账号角标:注入每个 dsh index 页。401 → 跳登录(门禁);404/异常静默(access 缺席降级)。 */
export const BADGE_SCRIPT = `
(function(){
  fetch('/access/api/me',{credentials:'same-origin'}).then(function(r){
    if(r.status===401){location.replace('/login');return null}
    return r.ok?r.json():null
  }).then(function(u){
    if(!u||!u.account)return
    var b=document.createElement('div')
    b.style.cssText='position:fixed;top:8px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:rgba(17,24,39,.92);color:#f9fafb;border:1px solid rgba(255,255,255,.14);border-radius:9999px;padding:4px 14px 4px 4px;font:13px/1.6 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);backdrop-filter:blur(6px)'
    var av
    if(u.avatarUrl){av=document.createElement('img');av.src=u.avatarUrl;av.style.cssText='width:26px;height:26px;border-radius:50%;object-fit:cover'}
    else{av=document.createElement('span');av.textContent=(u.nickname||u.account||'?').slice(0,1);av.style.cssText='width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px'}
    b.appendChild(av)
    var name=document.createElement('span');name.textContent=u.nickname||u.account;b.appendChild(name)
    var out=document.createElement('a');out.href='#';out.textContent='退出';out.style.cssText='color:#fca5a5;text-decoration:none';b.appendChild(out)
    out.addEventListener('click',function(e){
      e.preventDefault()
      fetch('/logout',{method:'POST',credentials:'same-origin'}).then(function(){location.href='/login'})})
    document.body.appendChild(b)
  }).catch(function(){})
})()
`

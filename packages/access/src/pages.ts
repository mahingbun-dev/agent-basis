/**
 * 服务端渲染页面(eterna 风格系统 v1,令牌化双主题):
 * - 风格规范见 docs/design/frontend-style.md——本文件即参考实现,后续页面必须复用 shell() 与令牌
 * - 深色为默认基调(匹配 dsh 应用底色 #151517),浅色经 prefers-color-scheme 自适应
 * - 账号页结构:个人资料卡(头像+昵称合并保存,脏检查)+安全卡(密码修改独立)
 * - 角标:注入 dsh index 页;401 → 跳 /login(门禁);404/网络错误静默降级
 */
import { escapeHtml, jsonForScript } from './http.ts'
import type { UserRow, UserSummary } from './store.ts'

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
.stack{display:flex;flex-direction:column;gap:16px;width:min(560px,94vw)}
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
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:8px;
  background:linear-gradient(135deg,var(--accent-strong),var(--accent));color:#fff;font-size:14px;font-weight:500;
  cursor:pointer;transition:filter .15s,transform .05s,opacity .15s}
button:hover{filter:brightness(1.1)}
button:active{transform:translateY(1px)}
button:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-soft)}
button:disabled{opacity:.5;cursor:not-allowed;filter:none}
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
.field{position:relative}
.pw-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:auto;margin:0;padding:4px 8px;
  font-size:12px;background:none;color:var(--dim);border-radius:6px}
.pw-toggle:hover{background:var(--surface-2);color:var(--text)}
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
  const body = `<div class="card"><h2>登录</h2>
<label>账号</label><input id="account" autocomplete="username">
<label>密码</label><div class="field"><input id="password" type="password" autocomplete="current-password"><button type="button" class="pw-toggle" id="pwEye" title="显示/隐藏密码">显示</button></div>
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
var eye=document.getElementById('pwEye'),pw=document.getElementById('password')
eye.addEventListener('click',function(){
  var show=pw.type==='password'
  pw.type=show?'text':'password'
  eye.textContent=show?'隐藏':'显示'
  pw.focus()})
`
  return shell('登录', body, script)
}

export function renderForbiddenPage(viewer: { nickname: string; avatarUrl: string | null; account: string }): string {
  const body = `<div class="card"><h2>无权访问</h2><p class="muted">此页面仅管理员可用。</p>
<a href="/account" style="color:var(--accent);font-size:14px">返回账号设置</a></div>`
  return shell('无权访问', body, '', viewer)
}

export interface AdminPluginRow {
  readonly id: string
  readonly label: string
  readonly redLine: boolean
  readonly disabled: boolean
}

function initial(user: UserRow): string {
  return jsonForScript({ account: user.account, nickname: user.nickname, role: user.role })
}

/** 账号设置页:资料卡(合并保存,脏检查)+安全卡(密码独立,含确认输入与显示切换)。 */
export function renderAccountPage(user: UserRow): string {
  const viewer = { nickname: user.nickname, avatarUrl: `/access/api/avatar/${user.id}`, account: user.account }
  const body = `<div class="stack">
<div class="card wide"><h2>账号设置</h2><p class="muted">账号：${escapeHtml(user.account)}（角色：${user.role === 'admin' ? '管理员' : '普通用户'}）</p></div>
<div class="card wide"><h3>个人资料</h3>
<div class="row" style="margin:10px 0 14px">
  <span id="avw">${avatarHtml(`/access/api/avatar/${user.id}`, user.nickname, 40)}</span>
  <input type="file" id="file" accept="image/png,image/jpeg,image/webp,image/gif" style="flex:1">
  <button type="button" class="ghost" id="resetAv">重置为字母头像</button>
</div>
<label>昵称</label><input id="nick" value="${escapeHtml(user.nickname)}" maxlength="32">
<div class="row" style="margin-top:16px"><button id="saveProfile" disabled style="flex:1">保存更改</button><span class="muted" id="profileHint">资料未改动</span></div>
<p class="ok" id="okProfile"></p><p class="err" id="errProfile"></p></div>
<div class="card wide"><h3>修改密码</h3>
<p class="muted">修改成功后本机保持登录，其他设备需重新登录。</p>
<label>旧密码</label><div class="field"><input id="oldPw" type="password" autocomplete="current-password"><button type="button" class="pw-toggle" data-eye="oldPw">显示</button></div>
<label>新密码</label><div class="field"><input id="newPw" type="password" autocomplete="new-password" placeholder="至少 8 位"><button type="button" class="pw-toggle" data-eye="newPw">显示</button></div>
<label>确认新密码</label><div class="field"><input id="newPw2" type="password" autocomplete="new-password" placeholder="再次输入新密码"><button type="button" class="pw-toggle" data-eye="newPw2">显示</button></div>
<button id="savePw">修改密码</button>
<p class="ok" id="okPw"></p><p class="err" id="errPw"></p></div>
</div>`
  const script = `
var me=${initial(user)}
function api(path,opts){return fetch(path,Object.assign({credentials:'same-origin'},opts)).then(function(r){
  if(r.status===401){location.href='/login';throw new Error('unauthorized')}
  return r.json().then(function(d){return {status:r.status,data:d}})})}
// ── 资料卡:合并保存(脏检查:昵称或头像任一改动即可保存;一次提交全部变更) ──
var savedNick=me.nickname, pendingAvatar=null
var saveBtn=document.getElementById('saveProfile'),hint=document.getElementById('profileHint')
var okP=document.getElementById('okProfile'),errP=document.getElementById('errProfile')
function refreshProfileState(){
  var nick=document.getElementById('nick').value
  var dirty=(nick!==savedNick&&nick.trim()!=='')||pendingAvatar!==null
  saveBtn.disabled=!dirty
  hint.textContent=dirty?(pendingAvatar!==null&&nick!==savedNick?'将更新昵称与头像':pendingAvatar!==null?'将更新头像':'将更新昵称'):'资料未改动'}
function show(msg,isErr){errP.textContent=isErr?msg:'';okP.textContent=isErr?'':msg}
document.getElementById('nick').addEventListener('input',refreshProfileState)
document.getElementById('resetAv').addEventListener('click',function(){
  pendingAvatar='RESET';refreshProfileState()
  document.getElementById('avw').innerHTML='<span class="avatar" style="width:40px;height:40px;font-size:20px">'+(document.getElementById('nick').value||me.account||'?').slice(0,1)+'</span>'})
document.getElementById('file').addEventListener('change',function(ev){
  var file=ev.target.files&&ev.target.files[0];if(!file)return
  var img=new Image()
  img.onload=function(){
    var c=document.createElement('canvas'),s=Math.min(256/img.width,256/img.height,1)
    c.width=Math.max(1,Math.round(img.width*s));c.height=Math.max(1,Math.round(img.height*s))
    c.getContext('2d').drawImage(img,0,0,c.width,c.height)
    pendingAvatar=c.toDataURL('image/png');refreshProfileState()
    document.getElementById('avw').innerHTML='<span class="avatar" style="width:40px;height:40px"><img src="'+pendingAvatar+'"></span>'}
  img.onerror=function(){show('图片读取失败',true)}
  img.src=URL.createObjectURL(file)})
saveBtn.addEventListener('click',function(){
  errP.textContent='';okP.textContent='';saveBtn.disabled=true
  var nick=document.getElementById('nick').value
  var jobs=[]
  if(nick!==savedNick&&nick.trim()!=='')jobs.push(api('/access/api/nickname',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nickname:nick})}))
  if(pendingAvatar==='RESET')jobs.push(api('/access/api/avatar',{method:'DELETE'}))
  else if(pendingAvatar!==null)jobs.push(api('/access/api/avatar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dataUrl:pendingAvatar})}))
  Promise.all(jobs).then(function(results){
    var failed=results.find(function(r){return r.status!==200})
    if(failed){saveBtn.disabled=false;show((failed.data&&failed.data.error)||'保存失败',true);return}
    savedNick=nick;pendingAvatar=null
    me.nickname=nick;refreshProfileState()
    show('已保存')})
  .catch(function(e){saveBtn.disabled=false;if(e.message!=='unauthorized')show('网络错误',true)})})
// ── 安全卡:密码独立修改(两次输入一致性前端校验;与资料保存互不影响) ──
var savePw=document.getElementById('savePw'),okPw=document.getElementById('okPw'),errPw=document.getElementById('errPw')
savePw.addEventListener('click',function(){
  errPw.textContent='';okPw.textContent=''
  var oldV=document.getElementById('oldPw').value,newV=document.getElementById('newPw').value,newV2=document.getElementById('newPw2').value
  if(!oldV||!newV){errPw.textContent='请输入旧密码与新密码';return}
  if(newV!==newV2){errPw.textContent='两次输入的新密码不一致';return}
  savePw.disabled=true
  api('/access/api/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oldPassword:oldV,newPassword:newV})})
  .then(function(res){
    if(res.status===200){okPw.textContent='密码已修改，其他设备需重新登录';document.getElementById('oldPw').value='';document.getElementById('newPw').value='';document.getElementById('newPw2').value=''}
    else errPw.textContent=(res.data&&res.data.error)||'修改失败'
    savePw.disabled=false})
  .catch(function(e){savePw.disabled=false;if(e.message!=='unauthorized')errPw.textContent='网络错误'})})
document.querySelectorAll('.pw-toggle').forEach(function(btn){
  btn.addEventListener('click',function(){
    var input=document.getElementById(btn.getAttribute('data-eye'))
    var showPw=input.type==='password'
    input.type=showPw?'text':'password'
    btn.textContent=showPw?'隐藏':'显示'
    input.focus()})})
`
  return shell('账号设置', body, script, viewer)
}

export function renderAdminPage(viewer0: UserRow, users: UserSummary[], plugins: ReadonlyArray<AdminPluginRow> = []): string {
  const pluginRows = plugins.map((plugin) => {
    if (plugin.redLine) {
      return `<div class="row" style="justify-content:space-between;padding:6px 0"><span><span class="tag red">红线</span> ${escapeHtml(plugin.label)} <span class="muted">${escapeHtml(plugin.id)}</span></span><span class="muted">不可停用</span></div>`
    }
    const state = plugin.disabled ? '已停用(重启后生效)' : '启用中'
    const action = plugin.disabled ? 'enable' : 'disable'
    const label = plugin.disabled ? '启用' : '停用'
    return `<div class="row" style="justify-content:space-between;padding:6px 0" data-plugin="${escapeHtml(plugin.id)}">
<span>${escapeHtml(plugin.label)} <span class="muted">${escapeHtml(plugin.id)}</span></span>
<span class="row"><span class="muted" data-state>${state}</span><button type="button" class="ghost" data-toggle="${action}" style="margin-left:8px">${label}</button></span></div>`
  }).join('')
  const rows = users.map((user) => {
    const self = user.id === viewer0.id
    const del = self ? '<span class="muted">当前登录</span>'
      : `<button class="danger" data-id="${user.id}" data-account="${escapeHtml(user.account)}">删除</button>`
    return `<tr>
<td>${avatarHtml(user.hasAvatar ? `/access/api/avatar/${user.id}` : null, user.nickname)}</td>
<td>${escapeHtml(user.account)}</td><td>${escapeHtml(user.nickname)}</td>
<td>${user.role === 'admin' ? '<span class="tag">管理员</span>' : '<span class="muted">用户</span>'}</td>
<td class="muted">${escapeHtml(user.createdAt)}</td><td>${del}</td></tr>`
  }).join('')
  const viewer = { nickname: viewer0.nickname, avatarUrl: `/access/api/avatar/${viewer0.id}`, account: viewer0.account }
  const body = `<div class="stack">
<div class="card wide"><h2>用户管理</h2>
<div class="row"><input id="na" placeholder="账号"><input id="np" type="password" placeholder="密码（至少 8 位）">
<select id="nr" style="width:130px"><option value="user">普通用户</option><option value="admin">管理员</option></select>
<button type="button" class="ghost" id="add">添加用户</button></div>
<p class="muted">重名账号自动追加数字后缀（如 zhangsan → zhangsan01）；新用户默认昵称=账号、头像=昵称首字母。</p>
<table><thead><tr><th></th><th>账号</th><th>昵称</th><th>角色</th><th>创建时间</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div class="card wide"><h3>插件启停</h3>
<p class="muted">停用后重启容器生效；红线插件（治理/审计/出网/门禁）不可停。</p>
<div id="plugins">${pluginRows}</div></div>
<p class="err" id="err"></p></div>`
  const script = `
var errEl=document.getElementById('err')
function api(path,opts){return fetch(path,Object.assign({credentials:'same-origin'},opts)).then(function(r){
  if(r.status===401){location.href='/login';throw new Error('unauthorized')}
  return r.json().then(function(d){return {status:r.status,data:d}})})}
document.getElementById('add').addEventListener('click',function(){
  var account=document.getElementById('na').value,password=document.getElementById('np').value,role=document.getElementById('nr').value
  errEl.textContent=''
  api('/access/api/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:account,password:password,role:role})})
  .then(function(res){
    if(res.status===201){
      var name=res.data.finalAccount
      alert(name===account?('用户 '+name+' 已创建'):('用户已创建，账号为 '+name+'（重名自动后缀）'))
      location.reload()}
    else errEl.textContent=res.data.error||'创建失败'})
  .catch(function(e){if(e.message!=='unauthorized')errEl.textContent='网络错误'})})
document.querySelectorAll('button.danger').forEach(function(btn){
  btn.addEventListener('click',function(){
    if(btn.getAttribute('data-armed')!=='1'){
      btn.setAttribute('data-armed','1');btn.textContent='确认删除?'
      setTimeout(function(){if(btn.getAttribute('data-armed')==='1'){btn.removeAttribute('data-armed');btn.textContent='删除'}},4000)
      return}
    btn.disabled=true
    api('/access/api/users/'+btn.getAttribute('data-id'),{method:'DELETE'})
    .then(function(res){if(res.status===200)location.reload();else{btn.disabled=false;btn.removeAttribute('data-armed');btn.textContent='删除';errEl.textContent=res.data.error||'删除失败'}})
    .catch(function(e){if(e.message!=='unauthorized'){btn.disabled=false;btn.removeAttribute('data-armed');btn.textContent='删除';errEl.textContent='网络错误'}})})})
document.querySelectorAll('#plugins button[data-toggle]').forEach(function(btn){
  btn.addEventListener('click',function(){
    var row=btn.closest('[data-plugin]'),id=row.getAttribute('data-plugin'),action=btn.getAttribute('data-toggle')
    errEl.textContent=''
    api('/access/api/plugins/'+id+'/'+action,{method:'POST'})
    .then(function(res){
      if(res.status===200){btn.textContent=action==='disable'?'启用':'停用';btn.setAttribute('data-toggle',action==='disable'?'enable':'disable');row.querySelector('[data-state]').textContent=action==='disable'?'已停用(重启后生效)':'启用中'}
      else errEl.textContent=res.data.error||'操作失败'})
    .catch(function(e){if(e.message!=='unauthorized')errEl.textContent='网络错误'})})})
`
  return shell('用户管理', body, script, viewer)
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
    function link(href,text,color){var a=document.createElement('a');a.href=href;a.textContent=text;a.style.cssText='color:'+color+';text-decoration:none';b.appendChild(a);return a}
    link('/account','账号','#a5b4fc')
    if(u.role==='admin')link('/admin/users','用户管理','#a5b4fc')
    var out=link('#','退出','#fca5a5')
    out.addEventListener('click',function(e){
      e.preventDefault()
      fetch('/logout',{method:'POST',credentials:'same-origin'}).then(function(){location.href='/login'})})
    document.body.appendChild(b)
  }).catch(function(){})
})()
`

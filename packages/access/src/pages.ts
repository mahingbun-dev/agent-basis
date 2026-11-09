/**
 * 服务端渲染页面:登录/账号设置/用户管理(恒灵品牌,中文 UI,极简内联样式)+
 * tapIndex 账号角标脚本(未登录跳 /login;404/网络错误静默——access 缺席时降级不破坏应用)。
 */
import { escapeHtml, jsonForScript } from './http.ts'
import type { UserRow, UserSummary } from './store.ts'

const STYLE = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#eef2ff,#f8fafc);font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#111827}
.card{background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(31,41,55,.08);padding:28px;width:min(420px,92vw)}
.card.wide{width:min(780px,94vw)}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:#4f46e5;margin-bottom:14px}
h2{margin:0 0 10px;font-size:20px}
label{display:block;font-size:13px;color:#4b5563;margin:12px 0 4px}
input,select{width:100%;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px}
button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-size:14px;cursor:pointer}
button:hover{background:#4338ca}
button.ghost{background:#f3f4f6;color:#111827;width:auto;margin-top:0;padding:8px 14px}
.err{color:#dc2626;font-size:13px;min-height:18px;margin:10px 0 0;white-space:pre-wrap}
.ok{color:#059669;font-size:13px;min-height:18px;margin:4px 0 0}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
th,td{padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:middle}
.avatar{width:26px;height:26px;border-radius:50%;background:#6366f1;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;overflow:hidden;flex:none}
.avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.tag{font-size:11px;padding:2px 6px;border-radius:6px;background:#eef2ff;color:#4f46e5}
.danger{color:#dc2626;cursor:pointer;background:none;border:0;padding:0;width:auto;margin:0;font-size:13px}
.muted{color:#6b7280;font-size:12px}
.row{display:flex;gap:8px;align-items:center}
`

function shell(title: string, body: string, script = ''): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 恒灵 EternaAgent</title><style>${STYLE}</style></head><body>${body}${script === '' ? '' : `<script>${script}</script>`}</body></html>`
}

const BRAND = '<div class="brand">⚡ 恒灵 · EternaAgent</div>'

export function renderLoginPage(): string {
  const body = `${BRAND}<div class="card"><h2>登录</h2>
<label>账号</label><input id="account" autocomplete="username">
<label>密码</label><input id="password" type="password" autocomplete="current-password">
<button id="go">登录</button><p class="err" id="msg"></p></div>`
  const script = `
var go=document.getElementById('go'),msg=document.getElementById('msg')
function submit(){
  msg.textContent=''
  var account=document.getElementById('account').value,password=document.getElementById('password').value
  fetch('/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
    body:JSON.stringify({account:account,password:password})}).then(function(r){
    if(r.ok){location.href='/';return null}
    return r.json().catch(function(){return null}).then(function(d){
      msg.textContent=(d&&d.error)||('登录失败('+r.status+')')})
  }).catch(function(){msg.textContent='网络错误，请重试'})
}
go.addEventListener('click',submit)
document.getElementById('password').addEventListener('keydown',function(e){if(e.key==='Enter')submit()})
`
  return shell('登录', body, script)
}

export function renderForbiddenPage(): string {
  const body = `${BRAND}<div class="card"><h2>无权访问</h2><p class="muted">此页面仅管理员可用。</p>
<a href="/account" style="color:#4f46e5;font-size:14px">返回账号设置</a></div>`
  return shell('无权访问', body)
}

function avatarHtml(avatarUrl: string | null, nickname: string, size = 26): string {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px`
  if (avatarUrl !== null) {
    return `<span class="avatar" style="${style}"><img src="${escapeHtml(avatarUrl)}" alt=""></span>`
  }
  return `<span class="avatar" style="${style}">${escapeHtml(nickname.slice(0, 1) || '?')}</span>`
}

export function renderAccountPage(user: UserRow): string {
  const initial = jsonForScript({ account: user.account, nickname: user.nickname, role: user.role })
  const body = `${BRAND}<div class="card wide"><h2>账号设置</h2><p class="muted">账号：${escapeHtml(user.account)}（角色：${user.role === 'admin' ? '管理员' : '普通用户'}）</p>
<div class="row" style="margin:14px 0">
  <span id="avw">${avatarHtml(`/access/api/avatar/${user.id}`, user.nickname, 40)}</span>
  <input type="file" id="file" accept="image/png,image/jpeg,image/webp,image/gif" style="flex:1">
  <button class="ghost" id="resetAv">重置为字母头像</button>
</div>
<label>昵称</label>
<div class="row"><input id="nick" value="${escapeHtml(user.nickname)}" maxlength="32"><button class="ghost" id="saveNick">保存昵称</button></div>
<label>旧密码</label><input id="oldPw" type="password" autocomplete="current-password">
<label>新密码</label><input id="newPw" type="password" autocomplete="new-password" placeholder="至少 8 位">
<button id="savePw">修改密码</button>
<p class="ok" id="ok"></p><p class="err" id="err"></p></div>`
  const script = `
var me=${initial}
var okEl=document.getElementById('ok'),errEl=document.getElementById('err')
function api(path,opts){return fetch(path,Object.assign({credentials:'same-origin'},opts)).then(function(r){
  if(r.status===401){location.href='/login';throw new Error('unauthorized')}
  return r.json().then(function(d){return {status:r.status,data:d}})})}
function show(msg,isErr){errEl.textContent=isErr?msg:'';okEl.textContent=isErr?'':msg}
document.getElementById('saveNick').addEventListener('click',function(){
  api('/access/api/nickname',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nickname:document.getElementById('nick').value})})
  .then(function(res){if(res.status===200){me.nickname=res.data.nickname;show('昵称已保存')}else{show(res.data.error||'保存失败',true)}})
  .catch(function(e){if(e.message!=='unauthorized')show('网络错误',true)})})
document.getElementById('savePw').addEventListener('click',function(){
  api('/access/api/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oldPassword:document.getElementById('oldPw').value,newPassword:document.getElementById('newPw').value})})
  .then(function(res){if(res.status===200){show('密码已修改，其他设备需重新登录');document.getElementById('oldPw').value='';document.getElementById('newPw').value=''}else{show(res.data.error||'修改失败',true)}})
  .catch(function(e){if(e.message!=='unauthorized')show('网络错误',true)})})
function setPreview(url){
  document.getElementById('avw').innerHTML=url
    ?'<span class="avatar" style="width:40px;height:40px"><img src="'+url+'"></span>'
    :'<span class="avatar" style="width:40px;height:40px;font-size:20px">'+(me.nickname||me.account||'?').slice(0,1)+'</span>'}
document.getElementById('file').addEventListener('change',function(ev){
  var file=ev.target.files&&ev.target.files[0];if(!file)return
  var img=new Image()
  img.onload=function(){
    var c=document.createElement('canvas'),s=Math.min(256/img.width,256/img.height,1)
    c.width=Math.max(1,Math.round(img.width*s));c.height=Math.max(1,Math.round(img.height*s))
    c.getContext('2d').drawImage(img,0,0,c.width,c.height)
    api('/access/api/avatar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dataUrl:c.toDataURL('image/png')})})
    .then(function(res){if(res.status===200){setPreview(res.data.avatarUrl);show('头像已更新')}else{show(res.data.error||'上传失败',true)}})
    .catch(function(e){if(e.message!=='unauthorized')show('网络错误',true)})}
  img.onerror=function(){show('图片读取失败',true)}
  img.src=URL.createObjectURL(file)})
document.getElementById('resetAv').addEventListener('click',function(){
  api('/access/api/avatar',{method:'DELETE'})
  .then(function(res){if(res.status===200){setPreview(null);show('已重置为字母头像')}else{show(res.data.error||'重置失败',true)}})
  .catch(function(e){if(e.message!=='unauthorized')show('网络错误',true)})})
`
  return shell('账号设置', body, script)
}

export interface AdminPluginRow {
  readonly id: string
  readonly label: string
  readonly redLine: boolean
  readonly disabled: boolean
}

export function renderAdminPage(viewer: UserRow, users: UserSummary[], plugins: ReadonlyArray<AdminPluginRow> = []): string {
  const pluginRows = plugins.map((plugin) => {
    if (plugin.redLine) {
      return `<div class="row" style="justify-content:space-between;padding:6px 0"><span><span class="tag">红线</span> ${escapeHtml(plugin.label)} <span class="muted">${escapeHtml(plugin.id)}</span></span><span class="muted">不可停用</span></div>`
    }
    const state = plugin.disabled ? '已停用(重启后生效)' : '启用中'
    const action = plugin.disabled ? 'enable' : 'disable'
    const label = plugin.disabled ? '启用' : '停用'
    return `<div class="row" style="justify-content:space-between;padding:6px 0" data-plugin="${escapeHtml(plugin.id)}">
<span>${escapeHtml(plugin.label)} <span class="muted">${escapeHtml(plugin.id)}</span></span>
<span class="row"><span class="muted" data-state>${state}</span><button class="ghost" data-toggle="${action}" style="margin-left:8px">${label}</button></span></div>`
  }).join('')
  const rows = users.map((user) => {
    const self = user.id === viewer.id
    const del = self ? '<span class="muted">当前登录</span>'
      : `<button class="danger" data-id="${user.id}" data-account="${escapeHtml(user.account)}">删除</button>`
    return `<tr>
<td>${avatarHtml(user.hasAvatar ? `/access/api/avatar/${user.id}` : null, user.nickname)}</td>
<td>${escapeHtml(user.account)}</td><td>${escapeHtml(user.nickname)}</td>
<td>${user.role === 'admin' ? '<span class="tag">管理员</span>' : '<span class="muted">用户</span>'}</td>
<td class="muted">${escapeHtml(user.createdAt)}</td><td>${del}</td></tr>`
  }).join('')
  const body = `${BRAND}<div class="card wide"><h2>用户管理</h2>
<div class="row"><input id="na" placeholder="账号"><input id="np" type="password" placeholder="密码（至少 8 位）">
<select id="nr" style="width:130px"><option value="user">普通用户</option><option value="admin">管理员</option></select>
<button class="ghost" id="add">添加用户</button></div>
<p class="muted">重名账号自动追加数字后缀（如 zhangsan → zhangsan01）；新用户默认昵称=账号、头像=昵称首字母。</p>
<table><thead><tr><th></th><th>账号</th><th>昵称</th><th>角色</th><th>创建时间</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>
<h3 style="font-size:15px;margin:18px 0 6px">插件启停</h3>
<p class="muted">停用后重启容器生效;红线插件(治理/审计/出网/门禁)不可停。</p>
<div id="plugins">${pluginRows}</div>
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
    if(!confirm('确定删除用户 '+btn.getAttribute('data-account')+'？其登录将立即失效。'))return
    api('/access/api/users/'+btn.getAttribute('data-id'),{method:'DELETE'})
    .then(function(res){if(res.status===200)location.reload();else errEl.textContent=res.data.error||'删除失败'})
    .catch(function(e){if(e.message!=='unauthorized')errEl.textContent='网络错误'})})})
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
  return shell('用户管理', body, script)
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
    b.style.cssText='position:fixed;top:10px;right:12px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:#111827;color:#f9fafb;border-radius:9999px;padding:4px 14px 4px 4px;font:13px/1.6 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.28)'
    var av
    if(u.avatarUrl){av=document.createElement('img');av.src=u.avatarUrl;av.style.cssText='width:26px;height:26px;border-radius:50%;object-fit:cover'}
    else{av=document.createElement('span');av.textContent=(u.nickname||u.account||'?').slice(0,1);av.style.cssText='width:26px;height:26px;border-radius:50%;background:#6366f1;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px'}
    b.appendChild(av)
    var name=document.createElement('span');name.textContent=u.nickname||u.account;b.appendChild(name)
    function link(href,text,color){var a=document.createElement('a');a.href=href;a.textContent=text;a.style.cssText='color:'+color+';text-decoration:none';b.appendChild(a);return a}
    link('/account','账号','#93c5fd')
    if(u.role==='admin')link('/admin/users','用户管理','#93c5fd')
    var out=link('#','退出','#fca5a5')
    out.addEventListener('click',function(e){
      e.preventDefault()
      fetch('/logout',{method:'POST',credentials:'same-origin'}).then(function(){location.href='/login'})})
    document.body.appendChild(b)
  }).catch(function(){})
})()
`

/**
 * 服务端渲染页面(eterna 风格系统 v1,令牌化双主题):
 * - 风格规范见 docs/design/frontend-style.md——本文件即参考实现,后续页面必须复用 shell() 与令牌
 * - 令牌来自 @eterna/ui(Webflow 浅色 + 系统深色),登录页唯一例外
 * - 账号自助(昵称/头像/密码)=应用内设置弹窗账号分区(铁律:不建独立页面);/account 仅 302 回应用
 * - 角标:注入 dsh index 页;401 → 跳 /login(门禁);404/网络错误静默降级;
 *   位置=头部下方悬浮(不得压头部右侧按钮——2026-11-11 E2E 遮挡事故),兼落座兜底
 */
import { WEBFLOW_TOKENS_CSS } from '@eterna/ui'
import { escapeHtml } from './http.ts'

const STYLE = `
${WEBFLOW_TOKENS_CSS}
:root{
  --bg:var(--et-bg);--bg-a:var(--et-surface);--bg-b:var(--et-bg);
  --surface:var(--et-surface);--surface-2:var(--et-surface-2);
  --text:var(--et-fg);--dim:var(--et-muted);
  --border:var(--et-border);
  --accent:var(--et-accent);--accent-strong:var(--et-accent);--accent-soft:var(--et-accent-soft);
  --danger:var(--et-danger);--ok:var(--et-success);
  --shadow:var(--et-shadow-raised);
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
  background:var(--et-bg);color:var(--text);
  font-family:var(--et-font-body);font-size:16px;line-height:1.6;font-weight:500}
.topbar{position:sticky;top:0;z-index:10;width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 24px;background:var(--et-surface);border-bottom:1px solid var(--et-border)}
.topbar .brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:16px;color:var(--text);text-decoration:none;margin:0}
.topbar .brand svg{width:20px;height:20px;color:var(--accent);flex:none}
.topbar .who{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text)}
.topbar a.navlink{color:var(--accent);text-decoration:none;font-size:14px;padding:8px 10px;border-radius:var(--et-radius-sm)}
.topbar a.navlink:hover{background:var(--et-accent-soft)}
.topbar button{width:auto;margin:0;padding:8px 10px;font-size:14px;background:none;color:var(--danger);border-radius:var(--et-radius-sm)}
.topbar button:hover{background:var(--et-danger-soft)}
main{flex:1;display:flex;align-items:center;justify-content:center;width:100%;padding:32px 16px}
.login-body .topbar{display:none}
main.login-main{padding:0;align-items:stretch;justify-content:flex-start}
.login-shell{flex:1;width:100%;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)}
.login-brand{display:flex;align-items:center;padding:clamp(32px,6vw,96px);background:var(--et-surface);border-right:1px solid var(--et-border)}
.login-brand-inner{max-width:680px}
.login-eyebrow{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--et-accent);font-weight:600;margin-bottom:20px}
.login-eyebrow svg{color:var(--et-accent);flex:none}
.login-brand h1{margin:0 0 24px;font-size:clamp(40px,4vw,64px);line-height:1.08;letter-spacing:0;font-weight:600}
.login-lead{margin:0 0 32px;max-width:46ch;font-size:20px;line-height:1.7;color:var(--et-fg-2)}
.login-points{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;color:var(--et-muted);font-size:16px}
.login-points li{display:flex;gap:10px}
.login-foot{margin:28px 0 0;font-size:12px;color:var(--et-meta)}
.login-points li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--et-accent);margin-top:8px;flex:none}
.login-panel{display:flex;align-items:center;justify-content:center;padding:clamp(24px,4vw,64px);background:var(--et-surface-2)}
.login-body .login-card{width:100%;max-width:460px;box-shadow:none;padding:40px}
.login-body .login-card h2{font-size:32px}
@media (max-width:760px){
  .login-shell{grid-template-columns:1fr}
  .login-brand{padding:32px 24px;border-right:0;border-bottom:1px solid var(--et-border)}
  .login-brand h1{font-size:36px}
  .login-lead{font-size:16px}
  .login-panel{padding:24px 16px 48px}
  .login-body .login-card{padding:28px 20px}
}
@media (max-width:640px){
  .login-brand{padding:24px 16px}
  .login-brand h1{font-size:32px}
  .login-points{font-size:14px}
}
.stack{display:flex;flex-direction:column;gap:16px;width:min(1100px,94vw)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.grid2.ratio{grid-template-columns:1.6fr 1fr}
.plug{display:flex;flex-direction:column;gap:2px;padding:9px 0;border-bottom:1px solid var(--border)}
.plug:last-child{border-bottom:0}
.plug b{font-weight:600;font-size:14px}
.pagehead{display:flex;align-items:baseline;gap:12px;width:100%}
.pagehead h2{margin:0}
.pagehead .muted{font-size:12px}
.card{background:var(--surface);border:1px solid var(--et-border-soft);border-radius:var(--et-radius-md);box-shadow:var(--shadow);padding:32px;width:min(440px,94vw)}
.card.wide{width:100%}
h2{margin:0 0 8px;font-size:32px;line-height:1.15;font-weight:600;letter-spacing:0}
h3{font-size:16px;margin:0 0 8px;color:var(--text);font-weight:600}
label{display:block;font-size:14px;color:var(--dim);margin:14px 0 6px}
.field{position:relative}
.field input{padding-right:46px}
.eye-btn{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:36px;height:36px;min-width:0;margin:0;padding:0;
  display:inline-flex;align-items:center;justify-content:center;background:none;border:0;border-radius:var(--et-radius-sm);
  color:var(--dim);cursor:pointer}
.eye-btn:hover{color:var(--text);background:var(--surface-2)}
.eye-btn:focus-visible{outline:none;box-shadow:var(--et-focus-ring)}
.eye-btn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
input,select{width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:var(--et-radius-sm);font-size:16px;
  background:var(--bg);color:var(--text);transition:border-color var(--et-motion-fast) var(--et-ease),box-shadow var(--et-motion-fast) var(--et-ease)}
input::placeholder{color:var(--et-meta)}
input:hover,select:hover{border-color:var(--et-fg-2)}
input:focus-visible,select:focus-visible{outline:none;border-color:var(--accent);box-shadow:var(--et-focus-ring)}
input[type=file]{padding:8px;color:var(--dim)}
button{margin-top:16px;width:auto;min-width:120px;padding:12px 18px;border:0;border-radius:var(--et-radius-sm);
  background:var(--et-accent-fill);color:var(--et-accent-on);font-size:16px;font-weight:600;
  cursor:pointer;transition:background-color var(--et-motion-fast) var(--et-ease),opacity var(--et-motion-fast) var(--et-ease)}
button:hover{background:var(--et-accent-fill-hover)}
button:focus-visible{outline:none;box-shadow:var(--et-focus-ring)}
button:disabled{opacity:.5;cursor:not-allowed}
.card.narrow button:not(.eye-btn){width:100%}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--border);width:auto;margin:0;padding:10px 14px;font-weight:500;white-space:nowrap}
button.ghost:hover{background:var(--surface-2);border-color:var(--et-fg-2)}
.err{color:var(--danger);font-size:14px;min-height:20px;margin:12px 0 0;white-space:pre-wrap}
.ok{color:var(--ok);font-size:14px;min-height:20px;margin:4px 0 0}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}
th,td{padding:9px 10px;border-bottom:1px solid var(--et-border-soft);text-align:left;vertical-align:middle}
th{color:var(--dim);font-weight:600;background:var(--surface-2);white-space:nowrap}
tbody tr:hover{background:var(--surface-2)}
.avatar{width:26px;height:26px;border-radius:50%;background:var(--et-accent-fill);color:var(--et-accent-on);
  display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;overflow:hidden;flex:none}
.avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.tag{font-size:12px;padding:2px 8px;border-radius:var(--et-radius-sm);background:var(--accent-soft);color:var(--accent)}
.tag.red{background:var(--et-danger-soft);color:var(--danger)}
.danger{color:var(--danger);cursor:pointer;background:none;border:0;padding:0;width:auto;margin:0;font-size:14px;min-height:36px}
.danger:hover{text-decoration:underline}
.muted{color:var(--dim);font-size:12px}
.row{display:flex;gap:8px;align-items:center}
.shell{display:flex;flex:1;width:min(1200px,96vw);margin:0 auto;gap:20px;padding:22px 16px;align-items:flex-start}
.menu{width:190px;flex:none;display:flex;flex-direction:column;gap:4px;position:sticky;top:76px}
.menuitem{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:var(--et-radius-sm);color:var(--dim);text-decoration:none;font-size:14px;transition:background var(--et-motion-fast) var(--et-ease),color var(--et-motion-fast) var(--et-ease)}
.menuitem:hover{background:var(--surface-2);color:var(--text)}
.menuitem.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
.menuitem .ic{width:18px;text-align:center}
.content{flex:1;min-width:0}
.panel{display:none}
.panel.active{display:block;animation:fadein .16s ease}
@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (max-width:760px){
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

/** 品牌闪电标(单色,随主题;登录页/页面骨架统一使用)。 */
function brandMark(size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2Z"/></svg>`
}

/** 页面骨架:topbar(viewer 在场=身份+返回+退出)+main。登录页 viewer 缺省。 */
function shell(title: string, body: string, script = '', viewer?: { nickname: string; avatarUrl: string | null; account: string }): string {
  const bar = `<header class="topbar">
<a class="brand" href="/" title="返回应用">${brandMark(20)}<span>恒灵·EternaAgent</span></a>
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
  const bodyClass = viewer === undefined ? ' class="login-body"' : ''
  const mainClass = viewer === undefined ? ' class="login-main"' : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 恒灵·EternaAgent</title><style>${STYLE}</style></head><body${bodyClass}>${bar}<main${mainClass}>${body}</main>${logoutScript}${script === '' ? '' : `<script>${script}</script>`}</body></html>`
}

function avatarHtml(avatarUrl: string | null, nickname: string, size = 26): string {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px`
  if (avatarUrl !== null) {
    return `<span class="avatar" style="${style}"><img src="${escapeHtml(avatarUrl)}" alt=""></span>`
  }
  return `<span class="avatar" style="${style}">${escapeHtml(nickname.slice(0, 1) || '?')}</span>`
}

/** 登录页(viewer 缺省=无导航身份):全页双栏,左侧产品叙事、右侧登录表单。 */
export function renderLoginPage(): string {
  const body = `<div class="login-shell">
  <section class="login-brand" aria-label="产品介绍">
    <div class="login-brand-inner">
      <div class="login-eyebrow">${brandMark(14)}<span>恒灵 · EternaAgent</span></div>
      <h1>方寸灵台，<br>运筹万里。</h1>
      <p class="login-lead">企业 Agent 基座：把模型、工具、知识与审批收进一个可控的工作台。</p>
      <ul class="login-points">
        <li>统一接入模型与工具</li>
        <li>提示词、记忆与知识可治理</li>
        <li>高风险动作走审批与审计</li>
      </ul>
      <p class="login-foot">恒灵 · EternaAgent · 企业内部部署</p>
    </div>
  </section>
  <section class="login-panel">
    <div class="card narrow login-card"><h2>登录</h2>
<label>账号</label><input id="account" autocomplete="username">
<label>密码</label><div class="field"><input id="password" type="password" autocomplete="current-password"><button type="button" class="eye-btn" id="pwEye" aria-label="切换密码可见性" title="显示/隐藏密码"><svg viewBox="0 0 24 24" class="ic-eye"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg><svg viewBox="0 0 24 24" class="ic-eye-off" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button></div>
<button id="go">登录</button><p class="err" id="msg" role="alert" aria-live="polite"></p></div>
  </section>
</div>`
  const script = `
var go=document.getElementById('go'),msg=document.getElementById('msg')
function submit(){
  msg.textContent=''
  go.disabled=true
  var account=document.getElementById('account').value,password=document.getElementById('password').value
  fetch('/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
    body:JSON.stringify({account:account,password:password})}).then(function(r){
    if(!r.ok){go.disabled=false
      return r.json().catch(function(){return null}).then(function(d){
        msg.textContent=(d&&d.error)||('登录失败('+r.status+')')})}
    return r.json().catch(function(){return {redirect:'/'}}).then(function(d){
      // 顶层导航:浏览器原生连接处理 token 桥接(不走 fetch 重定向链)
      location.href=(d&&d.redirect)||'/'})
  }).catch(function(){go.disabled=false;msg.textContent='网络错误，请重试'})
}
go.addEventListener('click',submit)
var eye=document.getElementById('pwEye'),pw=document.getElementById('password')
eye.addEventListener('click',function(){
  var show=pw.type==='password'
  pw.type=show?'text':'password'
  eye.querySelector('.ic-eye').style.display=show?'none':''
  eye.querySelector('.ic-eye-off').style.display=show?'':'none'
  pw.focus()})
pw.addEventListener('keydown',function(e){if(e.key==='Enter')submit()})
`
  return shell('登录', body, script)
}

/**
 * 账号门禁:注入每个 dsh index 页。401 → 跳登录;404/异常静默(access 缺席降级)。
 * 身份展示已迁到侧栏底部账户菜单(客户端 settings.launcher 席位),这里只保留
 * 门禁跳转、租户引导与首屏落座兜底,不再绘制右上角身份角标。
 */
export const BADGE_SCRIPT = `
(function(){
  var meAccount=null
  fetch('/access/api/me',{credentials:'same-origin'}).then(function(r){
    if(r.status===401){location.replace('/login');return null}
    return r.ok?r.json():null
  }).then(function(u){
    if(!u||!u.account)return
    meAccount=u.account
    scheduleRecover()
  }).catch(function(){})

  // 租户引导:session/create 的拒绝帧默认只有手动点击路径会弹 toast(客户端自带),
  // 自动引导(首屏连他人工作区被拒)是静默重试——这里补一条可见的引导条(30s 去重)。
  // 落座兜底(2026-11-11 E2E 重写):空会话输入框([aria-label="选择工作区"])在场即调度,
  // 1.2s/3.5s/7s 三次点击自己工作区头行的「+ 新建会话」按钮(上游 Rows.tsx aria=
  // 在“{name}”中新建会话——走 startSession→openWorkspace,上游复用已开通 blank 会话;
  // 旧实现点 treeitem 工作区行=仅折叠/展开,永不落座)。9s 仍空转 → 一次性 reload:
  // 上游 navigation connectBlank 的僵尸 inflight attempt 会静默吞掉后续一切点击,
  // 客户端无解,重载后 restoreSelection 沿已建会话(dsh.sessions.current)直接落座;
  // sessionStorage 旗标防循环,落座成功即清。
  var lastGuide=0
  var seatTries=0
  var RELOAD_FLAG='eternaSeatReload'
  function composerInert(){
    return !!document.querySelector('[aria-label="选择工作区"]')
  }
  function recoverSeat(){
    if(seatTries>=3||!meAccount||!composerInert())return
    seatTries++
    var btns=document.querySelectorAll('button[aria-label]')
    for(var i=0;i<btns.length;i++){
      var al=btns[i].getAttribute('aria-label')||''
      if(al.indexOf(meAccount)!==-1&&al.indexOf('新建会话')!==-1){btns[i].click();break}
    }
  }
  function scheduleRecover(){
    setTimeout(recoverSeat,1200)
    setTimeout(recoverSeat,3500)
    setTimeout(recoverSeat,7000)
    setTimeout(function(){
      if(!meAccount)return
      if(!composerInert()){try{sessionStorage.removeItem(RELOAD_FLAG)}catch(e){}return}
      var reloaded=false
      try{reloaded=!!sessionStorage.getItem(RELOAD_FLAG)}catch(e){}
      if(!reloaded){
        try{sessionStorage.setItem(RELOAD_FLAG,'1')}catch(e){}
        location.reload()
      }
    },9000)
  }
  function guideToast(text){
    var t=document.createElement('div')
    t.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;max-width:86vw;background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;padding:10px 16px;font-size:14px;line-height:1.5;font-family:var(--dsw-font-family, system-ui, sans-serif);box-shadow:var(--et-shadow-raised)'
    t.setAttribute('role','status')
    t.textContent=text
    document.body.appendChild(t)
    var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setTimeout(function(){
      if(!reduce){t.style.transition='opacity .4s';t.style.opacity='0'}
      setTimeout(function(){t.remove()},reduce?0:450)
    },6000)
  }
  var origFetch=window.fetch
  window.fetch=function(input,init){
    var p=origFetch.apply(this,arguments)
    try{
      var url=typeof input==='string'?input:(input&&input.url)||''
      if(url.indexOf('/api/session/create')!==-1){
        p.then(function(r){
          if(!r.ok)return
          r.clone().json().then(function(d){
            var err=d&&d.result&&d.result.ok===false&&d.result.error
            if(err&&err.code==='tenant/denied'&&Date.now()-lastGuide>30000){
              lastGuide=Date.now()
              guideToast(err.message||'该工作区不属于你，请在左侧点击你自己的工作区（家目录）新建会话')
              scheduleRecover()
            }
          }).catch(function(){})
        }).catch(function(){})
      }
      // 模型切换即时回显(2026-11-12):上游 selectModel 成功后等 control 流回推
      // modelSelection 投影——多用户 mux 环境下投影帧不达,模型按钮恒显旧模型
      // (=用户观感「切换不生效」;轨迹实证服务端与回合真实生效)。视觉层修补:
      // 成功响应后直接改按钮 aria-label 与内部文本;下次 React 重渲染(face
      // 更新或重载)自会以正确值覆盖,无持久分叉。
      if(url.indexOf('api/session/selectModel')!==-1){
        p.then(function(r){
          if(!r.ok)return
          r.clone().json().then(function(d){
            var sel=d&&d.result&&d.result.ok===true&&d.result.value&&d.result.value.selected
            if(!sel||!sel.provider||!sel.model)return
            var effort=sel.reasoningEffort||'Default'
            var display=sel.model
            var btns=document.querySelectorAll('button[aria-label]')
            for(var i=0;i<btns.length;i++){
              var al=btns[i].getAttribute('aria-label')||''
              if(al.indexOf('选择模型')===0){
                btns[i].setAttribute('aria-label','选择模型，当前 '+display+'，推理等级 '+effort)
                var seen=0
                var kids=btns[i].children
                for(var j=0;j<kids.length;j++){
                  var t=(kids[j].textContent||'').trim()
                  if(t==='')continue
                  if(seen===0){kids[j].textContent=display}
                  else if(seen===1){kids[j].textContent=effort}
                  seen++
                  if(seen>=2)break
                }
                break
              }
            }
          }).catch(function(){})
        }).catch(function(){})
      }
      // /permission 命令清单过滤(2026-11-12):权限选择器已随 P1-T3 禁用(cordis.patch.yml
      // 模板 ui-permission disabled,档位固定 workspace-write+ask),但宿主 /permission
      // 命令由 interaction/permission-presets 无条件注册(上游只读,无从关)——客户端
      // 装饰弹窗已死,/ 菜单残留一条裸命令。此处重写 commands/list 响应滤除该描述符,
      // 使菜单不渲染;直接键入 /permission 仍可执行,但目录仅剩只读/工作区写入两档
      // 安全沙箱档,无提权面。若日后恢复选择器,须同步移除本过滤(与模板行成对)。
      if(url.indexOf('commands/list')!==-1){
        return p.then(function(r){
          if(!r.ok||r.status===204)return r
          return r.clone().json().then(function(d){
            var v=d&&d.result&&d.result.ok===true?d.result.value:null
            if(!Array.isArray(v))return r
            var filtered=v.filter(function(c){return !(c&&c.name==='permission')})
            if(filtered.length===v.length)return r
            d.result.value=filtered
            return new Response(JSON.stringify(d),{status:r.status,headers:{'content-type':'application/json'}})
          }).catch(function(){return r})
        })
      }
    }catch(e){}
    return p
  }
})()
`

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { LANE } from '/Users/sunny/code/agent-basis-rc5/artifacts/rc5/E2/_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'
const req = createRequire(join(LANE.repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')
const accounts = loadAccounts(LANE.accountsFile)
const dsh = await bootstrapDshSession(LANE.base, bootTokenFromContainer(LANE.container))
const auth = await login(LANE.base, accounts.admin.account, accounts.admin.password)
const pairs = `${dsh}; ${auth.cookie}`.split(';').map(p=>p.trim()).filter(Boolean).map(p=>{const i=p.indexOf('=');return{name:p.slice(0,i),value:p.slice(i+1)}})
const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true })
const c=await browser.newContext({viewport:{width:390,height:844}}); await c.addCookies(pairs.map(x=>({...x,url:LANE.base})))
const p=await c.newPage()
await p.goto(LANE.base+'/',{waitUntil:'domcontentloaded'}); await p.waitForSelector('[data-composer-input]'); await p.waitForTimeout(2500)
const rect=async()=>p.evaluate(()=>{const d=document.querySelector('[role="dialog"][aria-label="导航"]');const r=d?.getBoundingClientRect();const s=document.querySelector('[data-sidebar-scrollport]')?.getBoundingClientRect();return{nav:r?{x:Math.round(r.x),w:Math.round(r.width)}:null,sidebar:s?{x:Math.round(s.x),w:Math.round(s.width)}:null,opener:(()=>{const o=document.querySelector('[data-sidebar-opener]');if(!o)return null;const b=o.getBoundingClientRect();return{x:Math.round(b.x),y:Math.round(b.y)}})()}})
console.log('initial',JSON.stringify(await rect()))
const op=p.locator('[data-sidebar-opener]').first()
await op.click(); await p.waitForTimeout(2000)
console.log('after normal click',JSON.stringify(await rect()))
await p.screenshot({path:'/tmp/e2-390-sidebar-open.png'})
await browser.close()

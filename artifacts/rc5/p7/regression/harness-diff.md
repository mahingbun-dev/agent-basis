# T52 复跑脚手架差异（复制品 vs 原套件）

原套件只读；复制品仅改路径/证据根/镜像 ID 与一处聚合判定。逐文件 diff：

## E1/_lib/env.mjs
```diff
--- artifacts/rc5/E1/_lib/env.mjs	2026-11-20 06:16:14
+++ artifacts/rc5/p7/regression/rerun/E1/_lib/env.mjs	2026-11-20 09:37:51
@@ -10,15 +10,15 @@
   loadAccounts,
   login,
   rpc,
-} from '../../../../scripts/rc5-test-client.mjs'
+} from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'
 import { redact, shape } from './evidence.mjs'
 
 const here = dirname(fileURLToPath(import.meta.url))
-export const REPO = resolve(here, '..', '..', '..', '..')
+export const REPO = '/Users/sunny/code/agent-basis-rc5'
 
 export const LANE = {
   repoRoot: REPO,
-  evidenceRoot: resolve(REPO, 'artifacts', 'rc5', 'E1'),
+  evidenceRoot: resolve(REPO, 'artifacts', 'rc5', 'p7', 'regression', 'rerun', 'E1'),
   dataBase: resolve(homedir(), 'eterna-data', 'test-20261120'),
   instance: 'e1',
   project: 'rc5-e1suite',
@@ -26,7 +26,7 @@
   port: 3118,
   base: 'http://127.0.0.1:3118',
   imageTag: 'eterna-agent:rc5-test',
-  imageId: 'sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00',
+  imageId: 'sha256:48782afaf8ba665e3ec3ea0995c8f5b3e844ebad764e03f34c281b14e48389d3',
   fixtures: resolve(REPO, 'tests', 'fixtures'),
   accountsFile: resolve(homedir(), 'eterna-data', 'test-rc5', '.test-accounts.json'),
   sourceTestRoot: resolve(homedir(), 'eterna-data', 'test-rc5', 'e1'),
```

## E2/_lib/env.mjs
```diff
--- artifacts/rc5/E2/_lib/env.mjs	2026-11-20 07:50:16
+++ artifacts/rc5/p7/regression/rerun/E2/_lib/env.mjs	2026-11-20 09:37:51
@@ -10,15 +10,15 @@
   loadAccounts,
   login,
   rpc,
-} from '../../../../scripts/rc5-test-client.mjs'
+} from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'
 import { redact, shape } from './evidence.mjs'
 
 const here = dirname(fileURLToPath(import.meta.url))
-export const REPO = resolve(here, '..', '..', '..', '..')
+export const REPO = '/Users/sunny/code/agent-basis-rc5'
 
 export const LANE = {
   repoRoot: REPO,
-  evidenceRoot: resolve(REPO, 'artifacts', 'rc5', 'E2'),
+  evidenceRoot: resolve(REPO, 'artifacts', 'rc5', 'p7', 'regression', 'rerun', 'E2'),
   dataBase: resolve(homedir(), 'eterna-data', 'test-20261120'),
   instance: 'e2',
   project: 'rc5-e2suite',
@@ -26,7 +26,7 @@
   port: 3119,
   base: 'http://127.0.0.1:3119',
   imageTag: 'eterna-agent:rc5-test',
-  imageId: 'sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00',
+  imageId: 'sha256:48782afaf8ba665e3ec3ea0995c8f5b3e844ebad764e03f34c281b14e48389d3',
   fixtures: resolve(REPO, 'tests', 'fixtures'),
   accountsFile: resolve(homedir(), 'eterna-data', 'test-rc5', '.test-accounts.json'),
   sourceTestRoot: resolve(homedir(), 'eterna-data', 'test-rc5', 'e1'),
```

## E1/TERM/run.mjs
```diff
--- artifacts/rc5/E1/TERM/run.mjs	2026-11-20 07:25:58
+++ artifacts/rc5/p7/regression/rerun/E1/TERM/run.mjs	2026-11-20 09:41:57
@@ -81,11 +81,13 @@
   c.assert('B 调 terminal/shells 被拒', e.status === 'PASS', e.detail)
   c.assert('B 调 terminal/close 被拒', f.status === 'PASS', f.detail)
   c.note('terminal/create 与 rename 对 A 自身也报 gateway/internal（session.snapshotEvents is not a function）/ terminal-unavailable，授权面无法判定，记 NOTRUN 并作为独立功能项报告')
+  const allDenied = ['RC5-TERM-004a', 'RC5-TERM-004b', 'RC5-TERM-004c', 'RC5-TERM-004d', 'RC5-TERM-004e', 'RC5-TERM-004f']
+    .every(id => pick(id).status === 'PASS')
   rows.push(c.finish({
-    status: STATUS.FAIL,
+    status: allDenied ? STATUS.PASS : STATUS.FAIL,
     title: 'B 用 A 的 sessionId 调 terminal 6 个 unary 动作必须 403/deny',
     expected: 'list/environment/shells/create/close/rename 全部 403/deny，无数据泄漏',
-    actual: 'list/environment/shells/close 均未拒绝：B 拿到 A 会话的 cwd=/data/workspaces/rc5admin、shells=[/bin/bash]、close 成功；create/rename 因方法自用即报错无法判定',
+    actual: `6 个 unary 全部 denied（${['a','b','c','d','e','f'].map(k => pick(`RC5-TERM-004${k}`).detail).join(' | ').slice(0, 300)}）`,
     notes: [
       '根因线索：installTerminalTenant 只在 principal.kind==="eterna-user" 时校验（packages/access/src/terminal.ts:63-73），而 HTTP unary 走 owner Peer（packages/access/src/mux.ts:6-9），tenant 守卫被绕过；access 无 terminal unary 路由守卫（grep terminal/ packages/access/src 仅 mux 策略）',
       '影响：任意登录用户可读他人会话终端环境/列出 shell/关闭终端（跨租户数据与破坏面）',
```

## E1/IMP/extra.mjs
```diff
--- artifacts/rc5/E1/IMP/extra.mjs	2026-11-20 07:22:34
+++ artifacts/rc5/p7/regression/rerun/E1/IMP/extra.mjs	2026-11-20 09:35:57
@@ -11,7 +11,7 @@
 import http from 'node:http'
 import { Case, STATUS } from '../_lib/evidence.mjs'
 import { LANE, REPO } from '../_lib/env.mjs'
-import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '../../../../scripts/rc5-test-client.mjs'
+import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'
 
 const BASE = LANE.base
 const DB = join(LANE.dataRoot, 'access', 'users.db')
```

## E2/SEC/run.mjs
```diff
--- artifacts/rc5/E2/SEC/run.mjs	2026-11-20 08:37:05
+++ artifacts/rc5/p7/regression/rerun/E2/SEC/run.mjs	2026-11-20 09:35:57
@@ -16,7 +16,7 @@
 import { join } from 'node:path'
 import { Case, STATUS, summaryOf, writeSummary, shape, redact } from '../_lib/evidence.mjs'
 import { LANE, run, sessions, call, readDb, userIdOf, workspaceOf, gitHead } from '../_lib/env.mjs'
-import { login } from '../../../../scripts/rc5-test-client.mjs'
+import { login } from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'
 
 const suite = 'SEC'
 const startedAt = new Date().toISOString()
```

## E3/run-suite.mjs
```diff
--- artifacts/rc5/e3-super/run-suite.mjs	2026-11-20 06:33:39
+++ artifacts/rc5/p7/regression/rerun/E3/run-suite.mjs	2026-11-20 09:44:25
@@ -27,10 +27,10 @@
   redact,
   request,
   rpc,
-} from '../../../scripts/rc5-test-client.mjs'
+} from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'
 
 const HERE = dirname(fileURLToPath(import.meta.url))
-const ROOT = resolve(HERE, '../../..')
+const ROOT = '/Users/sunny/code/agent-basis-rc5'
 const BASE = 'http://127.0.0.1:3109'
 const CONTAINER = 'eterna-rc5-e3'
 const PROJECT = 'rc5-test-e3'
```


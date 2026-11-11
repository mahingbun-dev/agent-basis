// 设置页逻辑（E1-T5）。红线 1：所有 UI 事件处理器首行校验 event.isTrusted——
// 合成点击不得触发任何特权路径（ClaudeBleed 教训，见 docs/design/companion-security-redlines.md 红线 1/2）。

import { getConnState, getSettings, saveSettings } from './state.ts'

const urlInput = document.getElementById('relay-url') as HTMLInputElement
const tokenInput = document.getElementById('relay-token') as HTMLInputElement
const saveBtn = document.getElementById('save') as HTMLButtonElement
const savedHint = document.getElementById('saved') as HTMLSpanElement
const statusEl = document.getElementById('status') as HTMLDivElement

function guardTrusted(event: Event): boolean {
  if (!event.isTrusted) {
    // 合成事件：拒绝并留痕（红线 1）
    console.warn('[eterna-companion] 拒绝非可信 UI 事件（isTrusted=false）')
    return false
  }
  return true
}

function validateRelayUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return '中继地址必须以 ws:// 或 wss:// 开头'
    return null
  } catch {
    return '中继地址格式无效'
  }
}

saveBtn.addEventListener('click', (ev) => {
  if (!guardTrusted(ev)) return
  const raw = urlInput.value.trim()
  const invalid = validateRelayUrl(raw)
  if (invalid !== null) {
    savedHint.textContent = invalid
    savedHint.style.color = 'var(--danger)'
    return
  }
  void (async () => {
    await saveSettings({ relayUrl: raw, token: tokenInput.value })
    savedHint.textContent = '已保存'
    savedHint.style.color = 'var(--success)'
    window.setTimeout(() => {
      savedHint.textContent = ''
    }, 2000)
  })()
})

async function refreshStatus(): Promise<void> {
  const conn = await getConnState()
  const label =
    conn.state === 'connected' ? '已连接中继' : conn.state === 'connecting' ? '连接中…' : '未连接'
  statusEl.textContent = `${label}${conn.detail !== '' ? `（${conn.detail}）` : ''}`
}

void (async () => {
  const s = await getSettings()
  urlInput.value = s.relayUrl
  tokenInput.value = s.token
  await refreshStatus()
})()

window.setInterval(() => {
  void refreshStatus()
}, 2000)

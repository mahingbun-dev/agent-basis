/**
 * DSH / 外部生态 seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收
 * *.spec.ts,不运行本文件)。
 *
 * 依据(deepseek-harness / npm,只读):
 * - SMTP transport:nodemailer 10.x `Transporter` = `Mail<SentMessageInfo>`,
 *   `sendMail(data: SendMailOptions): Promise<SentMessageInfo>`
 *   (dist/cjs/mailer/index.d.ts:164,198;SentMessageInfo.messageId: string)。
 * - 绑定数据面:@deepseek-ai/dsh-storage-domain 0.2.2-alpha.2 导出
 *   `KvTable<K, V>`(lib/types/domain.d.ts:37;get/put/delete/deleteMany/update/
 *   entries/keys/size)—— 12 号 §7.8 绑定关系由 storage-domain 承载。
 * - 会话接口:DSH acp 的 `session/prompt`(packages/acp/acp/src/index.ts:361)
 *   与远程应答 `client.session.requestPermission`(index.ts:171)是编程驱动面;
 *   acp 类型未发布进 catalog,SessionPort 保持本地最小形态,**需运行时联调**。
 */
import type { Transporter } from 'nodemailer'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SendMailOptions } from 'nodemailer'
import {
  ChannelBindingStore, createEmailChannelAdapter, type ChannelBindingRecord, type SmtpTransportLike,
} from '../src/index.ts'

/**
 * 钉住 ①:nodemailer `Transporter` 可直接赋给本包 SmtpTransportLike。
 * 成立条件:sendMail 参数 SendMailOptions 同形、返回 SentMessageInfo
 * (messageId: string)满足 { messageId?: string }。DSH 升级 nodemailer 或
 * nodemailer 破坏类型时 tsc 即失败。
 */
declare const liveTransporter: Transporter
export const pinnedSmtpTransport: SmtpTransportLike = liveTransporter

/** 钉住 ①b:适配器可直接消费 live Transporter(组合层零胶水)。 */
export const pinnedAdapterWithLiveTransporter = createEmailChannelAdapter({
  imap: {
    fetchUnseen: (): Promise<readonly never[]> => Promise.resolve([]),
    markSeen: (_messageId: string): Promise<void> => Promise.resolve(),
  },
  smtp: liveTransporter,
  fromAddress: 'bot@example.com',
})

/** 钉住 ①c:SendMailOptions 双向可用(本包构造的邮件可直接喂 nodemailer)。 */
declare const nodemailerSend: (mail: SendMailOptions) => Promise<unknown>
export function pinBuiltEmailIntoNodemailer(mail: SendMailOptions): Promise<unknown> {
  return nodemailerSend(mail)
}

/**
 * 钉住 ②:绑定存储的 KV 表视图结构上即 dsh storage-domain `KvTable`。
 * 成立条件:get/put/delete/deleteMany/update/entries/keys/size 七个成员
 * 签名全兼容 —— 绑定数据可原样挂进 ctx.storageDomain 打开的 domain 表。
 */
const bindingStore = ChannelBindingStore.open(':memory:')
export const pinnedKvTable: KvTable<string, ChannelBindingRecord> = bindingStore.asDomainKvTable()

/** 钉住 ②b:官方 API 用法模拟 —— put/get/delete 链路在类型层全通。 */
export async function pinDomainTableFlow(table: KvTable<string, ChannelBindingRecord>): Promise<void> {
  const record: ChannelBindingRecord = {
    channelType: 'feishu',
    channelUserId: 'fs-pin',
    sessionId: 'sess-pin',
    boundAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await table.put('feishu:fs-pin', record)
  const got = table.get('feishu:fs-pin')
  if (got !== undefined) {
    await table.update('feishu:fs-pin', current => ({ ...current, sessionId: 'sess-pin-2' }))
  }
  await table.delete('feishu:fs-pin')
  await table.deleteMany(['feishu:fs-pin'])
}
void pinDomainTableFlow

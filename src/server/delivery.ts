import { listCommunicationDrafts, recordCommunicationDraftAuditEvent, type CommunicationDraft } from './drafts.js'
import { FeishuOpenApiClient } from '../feishu/openapi.js'

export type CommunicationDeliveryResult =
  | {
      success: true
      mode: 'dry_run'
      draftId: string
      channel: CommunicationDraft['channel']
      recipient: string
      messagePreview: string
      auditedAt: string
    }
  | {
      success: true
      mode: 'feishu_im'
      draftId: string
      recipient: string
      receiveIdType: 'open_id' | 'user_id' | 'email' | 'chat_id'
      raw: unknown
      deliveredAt: string
    }
  | {
      success: false
      error: {
        code: 'draft_not_found' | 'draft_not_approved' | 'feishu_im_delivery_not_configured'
        message: string
        nextStep: string
      }
    }

export async function deliverCommunicationDraft(input: {
  reportsDir: string
  draftId: string
  actor: string
  dryRun?: boolean
  now?: Date
  feishuClient?: Pick<FeishuOpenApiClient, 'sendTextMessage'>
}): Promise<CommunicationDeliveryResult> {
  const drafts = await listCommunicationDrafts(input.reportsDir)
  const draft = drafts.find(item => item.id === input.draftId)
  const at = (input.now ?? new Date()).toISOString()

  if (!draft) {
    return {
      success: false,
      error: {
        code: 'draft_not_found',
        message: `Communication draft not found: ${input.draftId}`,
        nextStep: 'List communication drafts and choose an existing draftId.',
      },
    }
  }

  if (draft.status !== 'approved') {
    await recordCommunicationDraftAuditEvent(input.reportsDir, {
      id: `${at}-delivery_blocked-${draft.id}`,
      draftId: draft.id,
      action: 'delivery_blocked',
      actor: input.actor,
      note: `status=${draft.status}`,
      at,
    })
    return {
      success: false,
      error: {
        code: 'draft_not_approved',
        message: `Communication draft must be approved before delivery. Current status: ${draft.status}.`,
        nextStep: 'Review the draft with a human owner and call pmo_approve_communication_draft before delivery.',
      },
    }
  }

  if (input.dryRun !== false) {
    await recordCommunicationDraftAuditEvent(input.reportsDir, {
      id: `${at}-delivery_dry_run-${draft.id}`,
      draftId: draft.id,
      action: 'delivery_dry_run',
      actor: input.actor,
      at,
    })
    return {
      success: true,
      mode: 'dry_run',
      draftId: draft.id,
      channel: draft.channel,
      recipient: draft.recipient,
      messagePreview: draft.message,
      auditedAt: at,
    }
  }

  if (process.env.PMO_FEISHU_IM_DELIVERY_ENABLED !== 'true') {
    return {
      success: false,
      error: {
        code: 'feishu_im_delivery_not_configured',
        message: 'Real Feishu IM delivery is disabled or missing required delivery configuration.',
        nextStep: [
          'Set PMO_FEISHU_IM_DELIVERY_ENABLED=true only after Feishu app permissions are approved.',
          'Required before enabling: Feishu IM send permission, recipient name-to-open_id mapping, and a delivery adapter using the approved lark-mcp or OpenAPI credential.',
        ].join(' '),
      },
    }
  }

  if (isQuietHour(new Date(at), { start: '22:00', end: '10:00', timezone: process.env.PMO_TIMEZONE ?? 'Asia/Shanghai' })) {
    await recordCommunicationDraftAuditEvent(input.reportsDir, {
      id: `${at}-delivery_blocked_quiet_hours-${draft.id}`,
      draftId: draft.id,
      action: 'delivery_blocked',
      actor: input.actor,
      note: 'quiet_hours',
      at,
    })
    return {
      success: false,
      error: {
        code: 'feishu_im_delivery_not_configured',
        message: 'Real Feishu IM delivery is blocked by quiet hours.',
        nextStep: 'Retry after quiet hours, or keep the approved draft pending for the next allowed delivery window.',
      },
    }
  }

  const receive = resolveReceiveId(draft)
  if (!receive) {
    return {
      success: false,
      error: {
        code: 'feishu_im_delivery_not_configured',
        message: `Draft ${draft.id} has no open_id, user_id, or email recipient mapping.`,
        nextStep: 'Build person mapping from Feishu Project people plus Feishu Contacts API before real delivery.',
      },
    }
  }

  const raw = await (input.feishuClient ?? new FeishuOpenApiClient()).sendTextMessage({
    receiveIdType: receive.type,
    receiveId: receive.id,
    text: draft.message,
  })
  await recordCommunicationDraftAuditEvent(input.reportsDir, {
    id: `${at}-delivery_sent-${draft.id}`,
    draftId: draft.id,
    action: 'delivery_sent',
    actor: input.actor,
    note: `${receive.type}:[present]`,
    at,
  })
  return {
    success: true,
    mode: 'feishu_im',
    draftId: draft.id,
    recipient: draft.recipient,
    receiveIdType: receive.type,
    raw,
    deliveredAt: at,
  }
}

function resolveReceiveId(draft: CommunicationDraft): { type: 'open_id' | 'user_id' | 'email' | 'chat_id'; id: string } | undefined {
  if (draft.recipientIdentity?.chatId) return { type: 'chat_id', id: draft.recipientIdentity.chatId }
  if (draft.recipientIdentity?.openId) return { type: 'open_id', id: draft.recipientIdentity.openId }
  if (draft.recipientIdentity?.userId) return { type: 'user_id', id: draft.recipientIdentity.userId }
  if (draft.recipientIdentity?.email) return { type: 'email', id: draft.recipientIdentity.email }
  return undefined
}

function isQuietHour(now: Date, quietHours: { start: string; end: string; timezone: string }): boolean {
  const minutes = localMinutes(now, quietHours.timezone)
  const start = hhmmToMinutes(quietHours.start)
  const end = hhmmToMinutes(quietHours.end)
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function hhmmToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return (hour ?? 0) * 60 + (minute ?? 0)
}

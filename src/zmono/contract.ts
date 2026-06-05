export interface ZMonoActionContract {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
  safety: {
    readOnly: boolean
    writesExternalSystems: boolean
    requiresTrustedZone: boolean
  }
}

export interface ZMonoAgentContract {
  agent: {
    id: string
    name: string
    description: string
    modelPolicy: {
      route: 'z-mono-gateway'
      hardCodedModel: boolean
      provider: 'z.ai'
      dailySummaryModel: string
      deepRiskModel: string
      selection: string
    }
  }
  security: {
    trustedRuntime: 'actions-service'
    untrustedRuntime: 'sandbox'
    writeOperations: string[]
    secretHandling: string
  }
  actions: ZMonoActionContract[]
}

export interface BuildZMonoAgentContractOptions {
  provider?: 'z.ai'
  dailyModel?: string
  riskModel?: string
}

export function buildZMonoAgentContract(options: BuildZMonoAgentContractOptions = {}): ZMonoAgentContract {
  const provider = options.provider ?? 'z.ai'
  const dailyModel = options.dailyModel ?? 'glm-5-turbo'
  const riskModel = options.riskModel ?? 'glm-5.1'
  return {
    agent: {
      id: 'maas-pmo-status-auditor',
      name: 'MAAS PMO 状态核查 Agent',
      description: '读取 MAAS 飞书项目与 GitLab 交付证据，生成项目状态快照、风险和建议沟通计划。',
      modelPolicy: {
        route: 'z-mono-gateway',
        hardCodedModel: false,
        provider,
        dailySummaryModel: dailyModel,
        deepRiskModel: riskModel,
        selection: '日报总结默认走高性价比模型，深度风险分析默认走推理能力更强的模型；最终调用仍由 z-mono gateway/provider 配置执行。',
      },
    },
    security: {
      trustedRuntime: 'actions-service',
      untrustedRuntime: 'sandbox',
      writeOperations: ['pmo_apply_project_update_action'],
      secretHandling: 'GitLab、飞书项目、飞书文档凭证只存在 Actions Service 环境变量或受控 credential 中，sandbox 只拿结构化结果。',
    },
    actions: [
      {
        name: 'pmo_collect_facts',
        description: '按日期窗口读取飞书项目需求和 GitLab open-platform 交付证据，返回标准化 facts。',
        inputSchema: {
          type: 'object',
          properties: {
            since: { type: 'string', description: '中国时区开始日期或 ISO 时间，例如 2026-05-25' },
            until: { type: 'string', description: '中国时区结束日期或 ISO 时间，例如 2026-06-01' },
            includeGitLab: { type: 'boolean', description: '是否读取 GitLab 证据，默认 true' },
            includeFeishuProject: { type: 'boolean', description: '是否读取飞书项目需求，默认 true' },
          },
          required: ['since', 'until'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_enrich_context',
        description: '读取需求关联飞书文档，抽取候选目标、验收标准、测试计划、排期和下一步；只返回候选补全，不写飞书项目。',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', description: '报告日期 YYYY-MM-DD' },
            storiesFixture: { type: 'string', description: '本地 smoke 可选需求 fixture' },
            docsFixture: { type: 'string', description: '本地 smoke 可选文档 fixture' },
          },
          required: ['date'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_build_state_snapshot',
        description: '基于标准化 facts 生成项目状态快照、工作流健康度和建议沟通计划。',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', description: '报告日期 YYYY-MM-DD' },
            stories: { type: 'array', description: '标准化飞书项目需求列表' },
            evidence: { type: 'array', description: '标准化交付证据列表' },
          },
          required: ['date', 'stories', 'evidence'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_render_local_report',
        description: '把 AuditReport/ProjectStateSnapshot 渲染为本地 Markdown/HTML/JSON 报告，不写飞书项目字段、不发 IM。',
        inputSchema: {
          type: 'object',
          properties: {
            report: { type: 'object', description: 'PMO audit report' },
            outputDir: { type: 'string', description: '本地报告目录，默认 reports' },
          },
          required: ['report'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_run_agent_cycle',
        description: '推荐运行入口：生成报告，可选上下文增强、模型分析、飞书文档输出，创建待审批沟通草稿并记录 run stages。',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', description: '报告日期 YYYY-MM-DD' },
            enrichContext: { type: 'boolean', description: '读取关联飞书文档并抽取候选补全，默认 false' },
            analyzeWithModels: { type: 'boolean', description: '运行日报总结和深度风险分析模型，默认 false' },
            createFeishuDoc: { type: 'boolean', description: '创建飞书文档，默认 false' },
            createCommunicationDrafts: { type: 'boolean', description: '创建待审批沟通草稿，默认 true' },
            buildPersonDirectory: { type: 'boolean', description: '通过飞书项目人员字段和通讯录 API 构建收件人映射，默认 true' },
            createReportDeliveryDraft: { type: 'boolean', description: '创建待审批的日报单聊/群聊投递草稿，默认 false' },
            reportRecipient: { type: 'object', description: '可选日报接收人：name + identity(userId/openId/chatId/email)' },
          },
          required: ['date'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_scheduler_tick',
        description: '按北京时间日调度触发 agent-cycle，保留 preflight gate；未到点或当天已成功则跳过。',
        inputSchema: {
          type: 'object',
          properties: {
            now: { type: 'string', description: '可选 ISO 时间，用于 smoke 或可重复测试' },
            runAt: { type: 'string', description: '北京时间 HH:mm，默认 09:00' },
            enrichContext: { type: 'boolean', description: '读取关联飞书文档并抽取候选补全，默认 false' },
            buildPersonDirectory: { type: 'boolean', description: '通过飞书项目人员字段和通讯录 API 构建收件人映射，默认 true' },
            createReportDeliveryDraft: { type: 'boolean', description: '创建待审批的日报单聊/群聊投递草稿，默认 false' },
            skipPreflight: { type: 'boolean', description: '仅本地 smoke 使用，生产应保持 false' },
          },
          required: [],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_record_checkin_reply',
        description: '记录沟通回复，解析 status、goal、blocker、test plan、next step 和 ETA；只写本地 agent 状态，不直接更新飞书项目。',
        inputSchema: {
          type: 'object',
          properties: {
            storyId: { type: 'string', description: '需求 ID' },
            draftId: { type: 'string', description: '可选沟通草稿 ID' },
            responder: { type: 'string', description: '回复人' },
            text: { type: 'string', description: '原始回复文本' },
          },
          required: ['storyId', 'responder', 'text'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_list_checkins',
        description: '读取本地 check-in 回复记录，供后续状态分析和人工维护使用。',
        inputSchema: {
          type: 'object',
          properties: {
            reportsDir: { type: 'string', description: '本地报告目录，默认 reports' },
          },
          required: [],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_list_project_update_actions',
        description: '读取由 check-in 回复生成的待审批飞书项目写回动作；只读本地队列，不直接更新飞书项目。',
        inputSchema: {
          type: 'object',
          properties: {
            reportsDir: { type: 'string', description: '本地报告目录，默认 reports' },
          },
          required: [],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_approve_project_update_action',
        description: '审批本地飞书项目写回动作；只改变本地队列状态，不直接写飞书项目。',
        inputSchema: {
          type: 'object',
          properties: {
            actionId: { type: 'string', description: '写回动作 ID' },
            actor: { type: 'string', description: '审批人' },
            note: { type: 'string', description: '可选审批备注' },
          },
          required: ['actionId', 'actor'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_reject_project_update_action',
        description: '拒绝本地飞书项目写回动作；不写外部系统。',
        inputSchema: {
          type: 'object',
          properties: {
            actionId: { type: 'string', description: '写回动作 ID' },
            actor: { type: 'string', description: '审批人' },
            note: { type: 'string', description: '可选拒绝备注' },
          },
          required: ['actionId', 'actor'],
          additionalProperties: false,
        },
        safety: readOnlyTrustedAction(),
      },
      {
        name: 'pmo_apply_project_update_action',
        description: '应用已审批的飞书项目写回动作；通过 PMO Agent guard 和字段映射写入飞书项目。',
        inputSchema: {
          type: 'object',
          properties: {
            actionId: { type: 'string', description: '写回动作 ID' },
            actor: { type: 'string', description: '执行人' },
            mapping: { type: 'object', description: '可选字段映射，默认读取 PMO_FEISHU_FIELD_* 环境变量' },
          },
          required: ['actionId', 'actor'],
          additionalProperties: false,
        },
        safety: {
          readOnly: false,
          writesExternalSystems: true,
          requiresTrustedZone: true,
        },
      },
    ],
  }
}

function readOnlyTrustedAction(): ZMonoActionContract['safety'] {
  return {
    readOnly: true,
    writesExternalSystems: false,
    requiresTrustedZone: true,
  }
}

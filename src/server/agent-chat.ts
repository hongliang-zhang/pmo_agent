import type { PmoAppState, PmoEvidenceCard, PmoPersonState, PmoRiskCard, PmoStoryCard } from './app-data.js'

export interface PmoAgentAnswer {
  intent: string
  confidence: 'high' | 'medium' | 'low'
  text: string
  cards?: Array<Record<string, unknown>>
  links?: Array<{ label: string; url: string }>
}

export function answerPmoQuestion(message: string, state: PmoAppState): PmoAgentAnswer {
  const text = message.trim()
  const normalized = text.toLowerCase()
  if (!text) return fallbackAnswer(state)

  if (/(帮助|help|菜单|能做什么)/i.test(text)) return helpAnswer(state)
  if (isUnsafeAction(text)) return guardedActionAnswer(state)
  if (/(这个呢|那这个|那他|它呢|继续说|展开一下|再说说)[？?。!！\s]*$/i.test(text)) return clarificationAnswer(state)
  if (/(最新日报|日报|报告|latest)/i.test(text)) return latestReportAnswer(state)
  if (/(最近一次|上次|最新).*(运行|run|agent cycle)|运行记录|失败阶段|重试/i.test(text)) return runAnswer(state)
  if (/(信息缺失|缺失信息|无法判断|判断不了|缺什么|补齐什么|owner|deadline|排期|测试计划|目标)/i.test(text)) return missingInfoAnswer(state)
  if (/(健康|health|状态|运行|服务)/i.test(text) && !/(需求状态|项目状态)/i.test(text)) return healthAnswer(state)
  if (/(绿灯|黄灯|红灯|rag|整体.*状态|项目状态|是否延期|延期风险|隐藏风险|真实情况|顺利吗)/i.test(text)) return projectStatusAnswer(state)
  if (/(建议沟通|沟通清单|找谁|催谁|联系谁)/i.test(text)) return contactAnswer(state)
  if (/(不打扰|不用打扰|可以不打扰|无需打扰|安静|正常推进)/i.test(text)) return quietAnswer(state)
  if (/(代码|gitlab|mr|commit|pipeline|ci|交付证据)/i.test(text) && !/(需求|飞书|同步|未同步|没同步|孤立|无关联)/i.test(text)) return gitlabDeliveryAnswer(state)
  if (/(今日|今天|本周|这周|最近).*(进展|变化|推进|完成|交付)|实质进展|有变化/i.test(text)) return progressAnswer(state)
  if (/(代码|gitlab|mr|commit|pipeline|ci)/i.test(text) && /(需求|飞书|同步|未同步|没同步|孤立|无关联)/i.test(text)) return deliveryMismatchAnswer(state)
  if (/(风险|阻塞|block|blocked|失败|failed|关注|严重|p0|p1)/i.test(text)) return riskAnswer(state)

  const person = findPerson(text, state.people)
  if (person) return personAnswer(person, state)

  const story = findStory(text, state.stories)
  if (story) return storyAnswer(story, state)

  if (/next|下一步|推进|怎么做|建议/i.test(normalized)) return nextStepAnswer(state)
  return fallbackAnswer(state)
}

function isUnsafeAction(text: string): boolean {
  return /(直接|现在|立刻|马上)?\s*(发送|发给|同步给|更新|修改|删除|隐藏|导出|创建|写入|改到|分配|同步到|发提醒)/i.test(text)
    && /(客户|飞书|项目|字段|任务|记录|群聊|风险|消息|负责人|deadline|截止|文档|日报)/i.test(text)
}

function guardedActionAnswer(state: PmoAppState): PmoAgentAnswer {
  return {
    intent: 'guarded_action',
    confidence: 'high',
    text: [
      '这个请求涉及对外发送、写回、删除、导出或客户可见内容，我不会直接执行。',
      '我可以先基于当前 PMO 数据生成待确认清单、客户可见摘要或沟通草稿；发送飞书消息、更新飞书项目字段、删除/隐藏记录都必须经过人工确认和审批。',
      '如果你要继续，请明确目标对象、内容范围和是否需要脱敏，我会只输出草稿和证据，不会直接发送。',
    ].join('\n'),
    links: commonLinks(state),
  }
}

function clarificationAnswer(state: PmoAppState): PmoAgentAnswer {
  return {
    intent: 'clarification_needed',
    confidence: 'low',
    text: [
      '请补充具体需求、人员、时间范围或风险名称。当前页面不会用模糊代词擅自继承上下文，以免把错误项目当成确认事实。',
      '可以这样问：',
      '1. 企业套餐购买现在是什么状态？',
      '2. 王建辉在做什么？',
      '3. 今天 GitLab 上谁有交付证据？',
      '4. 哪些信息缺失导致无法判断状态？',
    ].join('\n'),
    links: commonLinks(state),
  }
}

function projectStatusAnswer(state: PmoAppState): PmoAgentAnswer {
  const highRisks = state.risks.filter(isHighPriorityRisk)
  const failedDelivery = state.evidence.filter(item => isFailedPipeline(item) || isBlockedMr(item))
  const status = highRisks.length >= 3 || state.dashboard.highPriorityRisks >= 3 ? '红灯'
    : highRisks.length > 0 || state.dashboard.risky > 0 || failedDelivery.length > 0 || state.dashboard.incomplete > 0 ? '黄灯'
    : '绿灯'
  const reasons = [
    `聚焦需求 ${state.dashboard.focused} 个，风险需求 ${state.dashboard.risky} 个，P0/P1 风险 ${state.dashboard.highPriorityRisks} 个。`,
    state.dashboard.incomplete ? `信息缺失需求 ${state.dashboard.incomplete} 个，状态判断仍有不确定性。` : '',
    failedDelivery.length ? `GitLab 交付异常证据 ${failedDelivery.length} 条。` : '',
    state.dashboard.progressed ? `今日/当前报告有实质进展 ${state.dashboard.progressed} 个。` : '当前报告未发现实质进展。',
  ].filter(Boolean)
  const top = state.risks.slice(0, 5)
  return {
    intent: 'project_status',
    confidence: highRisks.length || state.dashboard.risky || state.dashboard.progressed ? 'high' : 'medium',
    text: [
      `整体判断：${status}。`,
      ...reasons,
      top.length ? '主要证据/风险：' : '当前没有可列出的重点风险。',
      ...top.map((risk, index) => `${index + 1}. [${risk.priority}/${risk.severity}] ${risk.storyTitle}：${risk.description}；建议：${risk.suggestedAction}`),
      '',
      '说明：这是基于最新 PMO 日报、飞书项目字段和 GitLab 证据的状态判断；缺失字段不会被推断成已完成。',
    ].join('\n'),
    cards: top.map(riskCard),
    links: commonLinks(state),
  }
}

function progressAnswer(state: PmoAppState): PmoAgentAnswer {
  const progressed = state.storyProgress.filter(story => story.changes.length || story.hasGitLabEvidence).slice(0, 8)
  const storyById = new Map(state.stories.map(story => [story.id, story]))
  if (progressed.length === 0) {
    return {
      intent: 'progress',
      confidence: 'high',
      text: '当前选择日期没有检测到飞书项目字段、评论、文档或 GitLab 匹配变化。',
      links: commonLinks(state),
    }
  }
  return {
    intent: 'progress',
    confidence: 'high',
    text: [
      `当前报告识别到 ${state.dashboard.progressed || progressed.length} 个有实质进展的需求，优先看：`,
      ...progressed.map((story, index) => {
        const summary = storyById.get(story.id)?.progressSummary
        return `${index + 1}. ${story.title}：${summary || story.changes.slice(0, 2).join('；') || story.nextStep || '有进展证据'}；下一步：${story.nextStep || '待确认'}`
      }),
      '',
      '证据来自飞书项目更新时间、关联文档和 GitLab MR/commit/pipeline；没有证据的历史需求不会被放进进展列表。',
    ].join('\n'),
    cards: progressed.map(story => ({ type: 'progress', title: story.title, changes: story.changes, nextStep: story.nextStep, confidence: story.confidence })),
    links: commonLinks(state),
  }
}

function runAnswer(state: PmoAppState): PmoAgentAnswer {
  const runs = state.runs.filter(isRecord)
  const latest = runs[0]
  if (!latest) {
    return {
      intent: 'run_status',
      confidence: 'high',
      text: '当前没有运行记录。请先生成日报或运行 agent cycle。',
      links: commonLinks(state),
    }
  }
  const failedStages = Array.isArray(latest.stages) ? latest.stages.filter((stage: any) => stage?.status === 'failed') : []
  return {
    intent: 'run_status',
    confidence: 'high',
    text: [
      `最近一次运行：${String(latest.date ?? '-')}`,
      `状态：${String(latest.status ?? 'unknown')}`,
      `开始：${String(latest.startedAt ?? '-')}`,
      `结束：${String(latest.finishedAt ?? '-')}`,
      failedStages.length ? `失败阶段：${failedStages.map((stage: any) => stage.name).join('、')}。可在运行视图查看并按审批策略重试。` : '没有失败阶段记录。',
    ].join('\n'),
    cards: [{ type: 'run', ...latest }],
    links: commonLinks(state),
  }
}

function helpAnswer(state: PmoAppState): PmoAgentAnswer {
  return {
    intent: 'help',
    confidence: 'high',
    text: [
      '我可以回答 PMO 状态核查相关问题：',
      '1. 最新日报 / 今天有哪些风险 / 本周最需要关注什么',
      '2. 某个人在做什么，例如“王建辉在做什么”',
      '3. 代码有进展但需求是否同步',
      '4. 建议沟通清单和下一步动作',
      '5. 服务健康、运行记录、审批和草稿状态',
      '',
      '高风险动作只会生成草稿或进入审批，不会直接发消息或改飞书项目字段。',
    ].join('\n'),
    links: commonLinks(state),
  }
}

function latestReportAnswer(state: PmoAppState): PmoAgentAnswer {
  const report = state.latestReport
  if (!report) return fallbackAnswer(state)
  return {
    intent: 'latest_report',
    confidence: 'high',
    text: [
      `最新日报：${report.title}`,
      `日期：${report.date}`,
      `聚焦需求 ${state.dashboard.focused} 个，今日有进展 ${state.dashboard.progressed} 个，风险需求 ${state.dashboard.risky} 个，P0/P1 风险 ${state.dashboard.highPriorityRisks} 个。`,
      `历史降噪需求 ${state.dashboard.suppressed} 个，建议沟通 ${state.dashboard.suggestedContacts} 条。`,
    ].join('\n'),
    links: commonLinks(state),
  }
}

function healthAnswer(state: PmoAppState): PmoAgentAnswer {
  return {
    intent: 'health',
    confidence: 'high',
    text: [
      'PMO Agent 服务可访问。',
      `失败运行：${state.dashboard.failedRuns}`,
      `待审批：${state.dashboard.pendingApprovals}`,
      `待发送草稿：${state.dashboard.pendingDrafts}`,
      `Bot 事件审计：${state.dashboard.botEvents}`,
    ].join('\n'),
    links: commonLinks(state),
  }
}

function riskAnswer(state: PmoAppState): PmoAgentAnswer {
  const risks = state.risks.slice(0, 8)
  if (risks.length === 0) {
    return {
      intent: 'risks',
      confidence: 'high',
      text: '当前最新报告里没有进入关注队列的风险。',
      links: commonLinks(state),
    }
  }
  return {
    intent: 'risks',
    confidence: 'high',
    text: [
      `最新报告里有 ${state.dashboard.risky} 个风险需求，P0/P1 风险 ${state.dashboard.highPriorityRisks} 个。优先看：`,
      ...risks.map((risk, index) => `${index + 1}. [${risk.priority}/${risk.severity}] ${risk.storyTitle}：${risk.description}；建议：${risk.suggestedAction}${risk.owner ? `；找谁：${risk.owner}` : ''}`),
      '',
      '这些结论来自飞书项目字段、GitLab 证据和报告规则；未确认的信息会保留为风险或置信度提示。',
    ].join('\n'),
    cards: risks.map(riskCard),
    links: commonLinks(state),
  }
}

function contactAnswer(state: PmoAppState): PmoAgentAnswer {
  const people = state.people.filter(person => person.suggestedContacts > 0 || person.highPriorityRisks > 0).slice(0, 8)
  if (people.length === 0) {
    return {
      intent: 'contacts',
      confidence: 'high',
      text: '当前没有需要立即打扰的沟通对象。建议继续看“可以不打扰事项”和最新日报。',
      links: commonLinks(state),
    }
  }
  return {
    intent: 'contacts',
    confidence: 'high',
    text: [
      '建议沟通优先级如下，我只生成建议，不会直接发送：',
      ...people.map((person, index) => `${index + 1}. ${person.name}：相关需求 ${person.stories} 个，P0/P1/高风险 ${person.highPriorityRisks} 个，建议沟通 ${person.suggestedContacts} 条。${person.questions[0] ? `问题：${person.questions[0]}` : ''}`),
    ].join('\n'),
    cards: people.map(personCard),
    links: commonLinks(state),
  }
}

function quietAnswer(state: PmoAppState): PmoAgentAnswer {
  const quiet = state.quietStories.slice(0, 8)
  if (quiet.length === 0) {
    return {
      intent: 'quiet_items',
      confidence: 'high',
      text: '当前报告没有明确归入“可以不打扰”的事项。建议只沟通 P0/P1 风险、信息缺失或交付不同步项。',
      links: commonLinks(state),
    }
  }
  return {
    intent: 'quiet_items',
    confidence: 'high',
    text: [
      `当前有 ${quiet.length} 个事项可以先不打扰，原因通常是已有进展证据、无高优风险或下一步明确：`,
      ...quiet.map((story, index) => `${index + 1}. ${story.title}：${story.progressSummary || '当前无高优先级风险'}；负责人：${story.owners.join('、') || '未指定'}`),
      '',
      '这些事项不会进入建议沟通清单；如果后续出现 CI 失败、MR 卡住、排期/目标缺失或长期无更新，会重新进入关注队列。',
    ].join('\n'),
    cards: quiet.map(story => ({ type: 'quiet_story', ...story })),
    links: commonLinks(state),
  }
}

function missingInfoAnswer(state: PmoAppState): PmoAgentAnswer {
  const missing = state.risks
    .filter(risk => /missing|缺|owner|schedule|test|goal|next/i.test(`${risk.type} ${risk.category} ${risk.description}`))
    .slice(0, 10)
  if (missing.length === 0) {
    return {
      intent: 'missing_info',
      confidence: 'high',
      text: '当前最新报告没有发现会阻碍状态判断的明显信息缺失项。',
      links: commonLinks(state),
    }
  }
  return {
    intent: 'missing_info',
    confidence: 'high',
    text: [
      `有 ${state.dashboard.incomplete || missing.length} 个需求存在信息缺失，会影响状态判断。优先补齐：`,
      ...missing.map((risk, index) => `${index + 1}. ${risk.storyTitle}：${risk.description}；建议：${risk.suggestedAction}${risk.owner ? `；找谁：${risk.owner}` : ''}`),
      '',
      '我不会把缺失项推断为已完成；没有 owner、目标、排期、测试计划或下一步时，只能给出风险判断和补齐建议。',
    ].join('\n'),
    cards: missing.map(riskCard),
    links: commonLinks(state),
  }
}

function gitlabDeliveryAnswer(state: PmoAppState): PmoAgentAnswer {
  const people = state.gitlabPeople.slice(0, 8)
  const evidence = state.evidence.filter(item => item.type.startsWith('gitlab_')).slice(0, 8)
  if (people.length === 0 && evidence.length === 0) {
    return {
      intent: 'gitlab_delivery',
      confidence: 'high',
      text: '当前报告没有 GitLab MR、commit 或 pipeline 交付证据。',
      links: commonLinks(state),
    }
  }
  return {
    intent: 'gitlab_delivery',
    confidence: 'high',
    text: [
      `当前 GitLab 交付证据涉及 ${people.length || '若干'} 位作者。优先看：`,
      ...people.map((person, index) => `${index + 1}. ${person.displayName || person.author}：MR ${person.mrCount}、commit ${person.commitCount}、pipeline ${person.pipelineCount}；需求：${person.stories.slice(0, 3).join('、') || '未匹配'}${person.failedPipelines || person.blockedMrs || person.unmatched ? `；风险：失败 pipeline ${person.failedPipelines}、卡住 MR ${person.blockedMrs}、未同步 ${person.unmatched}` : '；暂无明显交付风险'}`),
      people.length ? '' : '交付证据样本：',
      ...(!people.length ? evidence.map((item, index) => `${index + 1}. ${item.title}（${item.type}，${item.author ?? 'unknown'}）`) : []),
      '证据类型包括 MR、commit 和 pipeline；未匹配飞书需求的代码进展会单独进入同步缺口。',
    ].join('\n'),
    cards: people.length ? people.map(person => ({ type: 'gitlab_person', ...person })) : evidence.map(evidenceCard),
    links: commonLinks(state),
  }
}

function deliveryMismatchAnswer(state: PmoAppState): PmoAgentAnswer {
  const isolated = state.evidence.filter(item => !item.storyId).slice(0, 8)
  const matched = state.evidence.filter(item => item.storyId).slice(0, 6)
  if (isolated.length === 0) {
    return {
      intent: 'delivery_mismatch',
      confidence: 'medium',
      text: [
        '最新报告没有发现明显的“代码有进展但需求未关联”证据。',
        matched.length ? '最近已关联的交付证据包括：' : '也没有可展示的近期交付证据。',
        ...matched.map((item, index) => `${index + 1}. ${item.storyTitle}：${item.title}（${item.type}，${item.confidence ?? 'unknown'}）`),
      ].join('\n'),
      cards: matched.map(evidenceCard),
      links: commonLinks(state),
    }
  }
  return {
    intent: 'delivery_mismatch',
    confidence: 'high',
    text: [
      `发现 ${isolated.length} 条未匹配到飞书需求的代码证据，建议先确认是否补关联需求或更新需求状态：`,
      ...isolated.map((item, index) => `${index + 1}. ${item.title}（${item.type}，${item.author ?? 'unknown'}，${item.confidence ?? 'unknown'}）`),
    ].join('\n'),
    cards: isolated.map(evidenceCard),
    links: commonLinks(state),
  }
}

function personAnswer(person: PmoPersonState, state: PmoAppState): PmoAgentAnswer {
  return {
    intent: 'person_status',
    confidence: 'medium',
    text: [
      `${person.name} 当前关联需求 ${person.stories} 个，其中有进展 ${person.progressedStories} 个、风险需求 ${person.riskyStories} 个、P0/P1/高风险 ${person.highPriorityRisks} 个。`,
      person.storyTitles.length ? `相关需求：${person.storyTitles.slice(0, 6).join('；')}` : '暂无可展示需求。',
      person.questions.length ? `建议先确认：${person.questions[0]}` : '当前没有必须打扰的明确问题。',
    ].join('\n'),
    cards: [personCard(person)],
    links: commonLinks(state),
  }
}

function storyAnswer(story: PmoStoryCard, state: PmoAppState): PmoAgentAnswer {
  const risks = state.risks.filter(risk => risk.storyId === story.id).slice(0, 5)
  return {
    intent: 'story_status',
    confidence: 'medium',
    text: [
      `${story.title}`,
      `状态：${story.status}；负责人：${story.owners.join('、') || '未指定'}；证据 ${story.evidenceCount} 条；风险 ${story.riskCount} 条。`,
      `进展：${story.progressSummary || '暂无进展摘要。'}`,
      risks.length ? `主要风险：${risks.map(risk => `[${risk.priority}] ${risk.description}`).join('；')}` : '当前没有进入风险队列。',
      story.reasons.length ? `判断依据：${story.reasons.slice(0, 3).join('；')}` : '判断依据：来自最新日报聚合状态。',
    ].join('\n'),
    cards: [{ ...story }],
    links: story.url ? [{ label: '飞书项目需求', url: story.url }, ...commonLinks(state)] : commonLinks(state),
  }
}

function nextStepAnswer(state: PmoAppState): PmoAgentAnswer {
  const topRisks = state.risks.slice(0, 5)
  return {
    intent: 'next_steps',
    confidence: 'medium',
    text: [
      '建议按这个顺序推进：',
      ...topRisks.map((risk, index) => `${index + 1}. ${risk.storyTitle}：${risk.suggestedAction}${risk.owner ? `（建议找 ${risk.owner}）` : ''}`),
      '所有对外沟通先生成草稿或进入审批，不直接发送。',
    ].join('\n'),
    cards: topRisks.map(riskCard),
    links: commonLinks(state),
  }
}

function fallbackAnswer(state: PmoAppState): PmoAgentAnswer {
  return {
    intent: 'fallback',
    confidence: 'low',
    text: [
      '我还不能可靠理解这个问题。可以换成这些问法：',
      '今天有哪些风险？',
      '谁需要沟通？',
      '代码有进展但需求没同步的有哪些？',
      '王建辉在做什么？',
      '最新日报',
    ].join('\n'),
    links: commonLinks(state),
  }
}

function findPerson(text: string, people: PmoPersonState[]): PmoPersonState | undefined {
  return people.find(person => person.name && text.includes(person.name))
}

function findStory(text: string, stories: PmoStoryCard[]): PmoStoryCard | undefined {
  const compact = text.replace(/\s+/g, '')
  return stories.find(story => compact.includes(story.id) || compact.includes(story.title.replace(/\s+/g, '').slice(0, 8)))
}

function commonLinks(state: PmoAppState): Array<{ label: string; url: string }> {
  return [
    { label: 'Web 控制台', url: state.links.app },
    { label: '最新日报', url: state.links.latestReportHtml },
    { label: '报告索引', url: state.links.reportIndex },
  ]
}

function riskCard(risk: PmoRiskCard): Record<string, unknown> {
  return {
    type: 'risk',
    priority: risk.priority,
    severity: risk.severity,
    storyTitle: risk.storyTitle,
    owner: risk.owner,
    description: risk.description,
    suggestedAction: risk.suggestedAction,
  }
}

function personCard(person: PmoPersonState): Record<string, unknown> {
  return {
    type: 'person',
    name: person.name,
    stories: person.stories,
    riskyStories: person.riskyStories,
    highPriorityRisks: person.highPriorityRisks,
    suggestedContacts: person.suggestedContacts,
    storyTitles: person.storyTitles.slice(0, 6),
  }
}

function evidenceCard(item: { type: string; title: string; author?: string; confidence?: string; storyTitle?: string }): Record<string, unknown> {
  return {
    type: 'evidence',
    evidenceType: item.type,
    title: item.title,
    author: item.author,
    confidence: item.confidence,
    storyTitle: item.storyTitle,
  }
}

function isHighPriorityRisk(risk: PmoRiskCard): boolean {
  return risk.priority === 'P0' || risk.priority === 'P1' || risk.severity === 'high'
}

function isFailedPipeline(item: PmoEvidenceCard): boolean {
  return item.type === 'gitlab_pipeline' && /failed|failure|error/i.test(`${item.status} ${item.description} ${item.summary}`)
}

function isBlockedMr(item: PmoEvidenceCard): boolean {
  return item.type === 'gitlab_mr' && /blocked|cannot_be_merged|conflict|failed/i.test(`${item.state} ${item.mergeStatus} ${item.description} ${item.summary}`)
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

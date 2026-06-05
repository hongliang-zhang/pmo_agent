export type Confidence = 'confirmed' | 'likely' | 'unknown'

export interface PersonRef {
  name: string
  email?: string
  username?: string
  userKey?: string
  larkUserId?: string
  openId?: string
}

export interface LinkedDoc {
  title: string
  url: string
}

export interface StoryFields {
  goal?: string
  problem?: string
  successCriteria?: string
  acceptanceCriteria?: string
  testPlan?: string
  nextStep?: string
  startDate?: string
  dueDate?: string
  productArea?: string
  [key: string]: unknown
}

export interface Story {
  id: string
  title: string
  status: string
  owners: PersonRef[]
  creator?: PersonRef
  priority?: string
  linkedDocs: LinkedDoc[]
  fields: StoryFields
  url?: string
  createdAt?: string
  updatedAt?: string
}

export type EvidenceType =
  | 'feishu_project_field'
  | 'feishu_project_comment'
  | 'feishu_doc'
  | 'gitlab_mr'
  | 'gitlab_commit'
  | 'gitlab_pipeline'
  | 'gitlab_user_event'

export interface Evidence {
  id: string
  type: EvidenceType
  title: string
  summary: string
  url: string
  author?: string
  createdAt: string
  updatedAt: string
  confidence: Confidence
  metadata?: Record<string, unknown>
}

export type RiskType =
  | 'missing_goal'
  | 'missing_owner'
  | 'missing_schedule'
  | 'missing_test_plan'
  | 'missing_next_step'
  | 'stale_status'
  | 'mr_blocked'
  | 'pipeline_failed'
  | 'state_delivery_mismatch'

export interface Risk {
  id: string
  storyId: string
  type: RiskType
  severity: 'low' | 'medium' | 'high'
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  category?: 'Issue' | 'Risk' | 'Decision' | 'Data Quality' | 'Mismatch'
  whyNow?: string
  description: string
  evidenceIds: string[]
  suggestedAction: string
  ownerToContact?: PersonRef
}

export interface StoryAudit {
  story: Story
  evidence: Evidence[]
  risks: Risk[]
  confidence: Confidence
  progressSummary: string
  context?: StoryContext
}

export interface SuggestedContact {
  person: string
  storyId: string
  storyTitle: string
  question: string
  reason: string
  priority: 'low' | 'medium' | 'high'
}

export interface FieldCompletionCandidate {
  field: 'goal' | 'problem' | 'successCriteria' | 'acceptanceCriteria' | 'testPlan' | 'nextStep' | 'startDate' | 'dueDate'
  value: string
  sourceTitle: string
  sourceUrl: string
  evidenceId: string
  confidence: Confidence
  needsConfirmation: boolean
}

export interface StoryContext {
  storyId: string
  summary: string
  evidence: Evidence[]
  candidates: FieldCompletionCandidate[]
  contradictions: string[]
}

export interface AuditReport {
  title: string
  date: string
  summary: {
    stories: number
    focused?: number
    suppressed?: number
    highPriorityRisks?: number
    progressed: number
    risky: number
    incomplete: number
    suggestedContacts: number
  }
  storyAudits?: StoryAudit[]
  progressedStories: StoryAudit[]
  riskyStories: StoryAudit[]
  incompleteStories: StoryAudit[]
  gitlabEvidence: Evidence[]
  isolatedEvidence: Evidence[]
  suggestedContacts: SuggestedContact[]
  noNeedToDisturb: StoryAudit[]
  suppressedStories?: SuppressedStory[]
  stateSnapshot?: ProjectStateSnapshot
}

export interface SuppressedStory {
  storyId: string
  storyTitle: string
  status: string
  ownerNames: string[]
  reason: string
  updatedAt?: string
}

export interface DateWindow {
  since: Date
  until: Date
}

export type StoryHealth = 'green' | 'yellow' | 'red' | 'unknown'

export type ProgressState = 'active' | 'blocked' | 'stalled' | 'done' | 'unknown'

export interface StoryState {
  storyId: string
  title: string
  url?: string
  status: string
  owners: PersonRef[]
  workstream: string
  health: StoryHealth
  progress: ProgressState
  evidenceCount: number
  riskCount: number
  highRiskCount: number
  latestEvidenceAt?: string
  goalStatus: 'present' | 'missing'
  nextStepStatus: 'present' | 'missing'
  contextSummary?: string
  candidateCompletions: FieldCompletionCandidate[]
  needsHumanContact: boolean
  reasons: string[]
}

export interface WorkstreamState {
  name: string
  stories: number
  activeStories: number
  riskyStories: number
  blockedStories: number
  health: StoryHealth
}

export interface PlannedCommunication {
  person: string
  channel: 'feishu'
  storyIds: string[]
  storyTitles: string[]
  priority: 'low' | 'medium' | 'high'
  question: string
  reason: string
}

export interface ProjectStateSnapshot {
  generatedAt: string
  window: {
    label: string
    since: string
    until: string
  }
  summary: {
    stories: number
    greenStories: number
    yellowStories: number
    redStories: number
    unknownStories: number
    workstreams: number
    communications: number
  }
  stories: StoryState[]
  workstreams: WorkstreamState[]
  communicationPlan: PlannedCommunication[]
  noDisturbStories: StoryState[]
}

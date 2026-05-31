export type Confidence = 'confirmed' | 'likely' | 'unknown'

export interface PersonRef {
  name: string
  email?: string
  username?: string
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
}

export interface SuggestedContact {
  person: string
  storyId: string
  storyTitle: string
  question: string
  reason: string
  priority: 'low' | 'medium' | 'high'
}

export interface AuditReport {
  title: string
  date: string
  summary: {
    stories: number
    progressed: number
    risky: number
    incomplete: number
    suggestedContacts: number
  }
  progressedStories: StoryAudit[]
  riskyStories: StoryAudit[]
  incompleteStories: StoryAudit[]
  gitlabEvidence: Evidence[]
  isolatedEvidence: Evidence[]
  suggestedContacts: SuggestedContact[]
  noNeedToDisturb: StoryAudit[]
}

export interface DateWindow {
  since: Date
  until: Date
}

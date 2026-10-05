/** Contrato de dominio inicial para reemplazar el adaptador mock por una API. */

export type ID = string;
export type ISODate = string;
export type ISODateTime = string;
export type CurrencyCode = 'USD' | 'ARS' | (string & {});

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'demo_presale'
  | 'proposal_sent'
  | 'won'
  | 'lost'
  | 'paused';

export type ProjectStage =
  | 'confirmed_preparation'
  | 'build'
  | 'qa'
  | 'client_review'
  | 'delivery_training'
  | 'support'
  | 'closed'
  | 'paused';

export type Audience = 'internal' | 'client';
export type PublicationState = 'draft' | 'prepared' | 'visible' | 'corrected' | 'withdrawn';

export type Role = 'owner_admin' | 'sales' | 'project_lead' | 'tech_delivery' | 'finance_viewer';
export type Permission =
  | 'lead:read'
  | 'lead:write'
  | 'proposal:read'
  | 'project:read'
  | 'project:write'
  | 'artifact:read'
  | 'artifact:publish'
  | 'payment:read'
  | 'audit:read';

export interface AccessScope {
  audience: Audience;
  organizationIds: ID[];
  projectIds: ID[];
  requiredPermissions: Permission[];
  redactedFields?: string[];
}

export interface ViewerContext {
  userId: ID;
  roles: Role[];
  permissions: Permission[];
  organizationIds: ID[];
  projectIds: ID[];
}

export interface Lead {
  id: ID;
  organizationId?: ID;
  personName: string;
  companyName?: string;
  need: string;
  source: string;
  channel: string;
  industry: string;
  status: LeadStatus;
  ownerId: ID;
  ownerName: string;
  language: string;
  preferredCurrency: CurrencyCode;
  consent: { status: 'granted' | 'not_granted' | 'unknown'; capturedAt?: ISODateTime; source?: string };
  createdAt: ISODateTime;
  nextAction?: { label: string; dueAt?: ISODateTime; kind: 'call' | 'proposal' | 'follow_up' | 'review' };
  hypotheticalScope?: string;
  proposalIds: ID[];
  activityIds: ID[];
  possibleDuplicateIds: ID[];
  access: AccessScope;
}

export interface Activity {
  id: ID;
  subjectType: 'lead' | 'project' | 'artifact' | 'change_request';
  subjectId: ID;
  kind: 'note' | 'call' | 'meeting' | 'proposal' | 'decision' | 'milestone' | 'publication' | 'system';
  summary: string;
  occurredAt: ISODateTime;
  actorId: ID;
  actorName: string;
  dueAt?: ISODateTime;
  audience: Audience;
  access: AccessScope;
}

export interface Proposal {
  id: ID;
  leadId: ID;
  version: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  currency: CurrencyCode;
  amountMinor?: number;
  sentAt?: ISODateTime;
  validUntil?: ISODate;
  hypothetical: boolean;
  access: AccessScope;
}

export interface Project {
  id: ID;
  organizationId: ID;
  organizationName: string;
  name: string;
  stage: ProjectStage;
  clientVisibleStage?: ProjectStage;
  clientStagePublication?: PublicationState;
  ownerId: ID;
  ownerName: string;
  participantIds: ID[];
  scopeVersionIds: ID[];
  milestoneIds: ID[];
  riskIds: ID[];
  blockerIds: ID[];
  decisionIds: ID[];
  changeRequestIds: ID[];
  activityIds: ID[];
  artifactIds: ID[];
  paymentRecordIds: ID[];
  nextAction?: { label: string; dueAt?: ISODateTime; ownerId: ID; ownerName: string };
  estimatedStartAt?: ISODate;
  estimatedDueAt?: ISODate;
  pause?: { cause: string; reviewAt: ISODate };
  access: AccessScope;
}

export interface ScopeVersion {
  id: ID;
  projectId: ID;
  version: number;
  status: 'draft' | 'offered' | 'accepted' | 'superseded';
  summary: string;
  includedItems: string[];
  excludedItems: string[];
  acceptedAt?: ISODateTime;
  acceptedById?: ID;
  changeRequestId?: ID;
  access: AccessScope;
}

export interface Milestone {
  id: ID;
  projectId: ID;
  title: string;
  status: 'upcoming' | 'in_progress' | 'blocked' | 'done';
  estimatedDueAt?: ISODate;
  entryCriteria: string[];
  exitCriteria: string[];
  ownerId: ID;
  ownerName: string;
  evidenceArtifactIds: ID[];
  clientVisible: boolean;
  access: AccessScope;
}

export interface Risk {
  id: ID;
  projectId: ID;
  title: string;
  likelihood: 'low' | 'medium' | 'high' | 'unknown';
  impact: 'low' | 'medium' | 'high' | 'unknown';
  mitigation?: string;
  ownerId: ID;
  ownerName: string;
  status: 'open' | 'mitigating' | 'closed';
  access: AccessScope;
}

export interface Blocker {
  id: ID;
  projectId: ID;
  milestoneId?: ID;
  summary: string;
  cause: string;
  ownerId: ID;
  ownerName: string;
  openedAt: ISODateTime;
  reviewAt?: ISODate;
  status: 'open' | 'waiting' | 'resolved';
  audience: Audience;
  access: AccessScope;
}

export interface Decision {
  id: ID;
  projectId: ID;
  title: string;
  outcome: string;
  decidedAt: ISODateTime;
  decidedById: ID;
  decidedByName: string;
  audience: Audience;
  relatedArtifactIds: ID[];
  access: AccessScope;
}

export interface ChangeRequest {
  id: ID;
  projectId: ID;
  requestedBy: string;
  requestedAt: ISODateTime;
  request: string;
  evaluation?: { ownerId: ID; costImpact?: string; scheduleImpact?: string; evaluatedAt?: ISODateTime };
  offer?: { scopeVersionId: ID; offeredAt: ISODateTime; expiresAt?: ISODate };
  acceptance?: { accepted: boolean; acceptedById?: ID; acceptedAt?: ISODateTime; evidenceArtifactId?: ID };
  status: 'requested' | 'evaluating' | 'offered' | 'accepted' | 'rejected' | 'withdrawn';
  access: AccessScope;
}

export type ArtifactCategory =
  | 'commercial'
  | 'agreement'
  | 'input'
  | 'decision'
  | 'technical_internal'
  | 'qa'
  | 'delivery'
  | 'support';

export interface Artifact {
  id: ID;
  projectId?: ID;
  leadId?: ID;
  title: string;
  category: ArtifactCategory;
  version: number;
  authorId: ID;
  authorName: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  audience: Audience;
  publicationState: PublicationState;
  relatedMilestoneId?: ID;
  relatedDecisionId?: ID;
  storageReference?: string;
  publicationHistory: Array<{ state: PublicationState; actorId: ID; occurredAt: ISODateTime; reason?: string }>;
  access: AccessScope;
}

export interface PaymentRecord {
  id: ID;
  projectId?: ID;
  leadId?: ID;
  kind: 'deposit' | 'milestone' | 'balance' | 'refund';
  status: 'promised' | 'invoiced' | 'received' | 'refunded' | 'void';
  amountMinor: number;
  currency: CurrencyCode;
  receivedAt?: ISODateTime;
  agreementReference?: string;
  recordedById: ID;
  access: AccessScope;
}

export interface Notification {
  id: ID;
  recipientId: ID;
  subjectType: 'lead' | 'project' | 'artifact' | 'milestone' | 'blocker';
  subjectId: ID;
  kind: 'follow_up_due' | 'proposal_due' | 'approval_requested' | 'blocker_open' | 'milestone_soon';
  scheduledAt: ISODateTime;
  deliveredAt?: ISODateTime;
  readAt?: ISODateTime;
  channel: 'in_app' | 'email';
  access: AccessScope;
}

export interface AuditEvent {
  id: ID;
  actorId: ID;
  actorName: string;
  action: string;
  subjectType: string;
  subjectId: ID;
  occurredAt: ISODateTime;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  audience: Audience;
  access: AccessScope;
}

export interface PageRequest<Filters extends object = Record<string, never>> {
  cursor?: string;
  limit?: number;
  sort?: string;
  filters?: Filters;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
  total?: number;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
  retryable: boolean;
}

export interface ApiResult<T> {
  data?: T;
  error?: ApiError;
}

export interface ListFilters {
  query?: string;
  status?: string[];
  source?: string[];
  channel?: string[];
  industry?: string[];
  ownerId?: string[];
  dueBefore?: ISODateTime;
  dueAfter?: ISODateTime;
  projectId?: string[];
  category?: ArtifactCategory[];
  audience?: Audience[];
  blocked?: boolean;
  milestoneId?: string[];
}

export interface PortalApi {
  listLeads(request: PageRequest<ListFilters>): Promise<ApiResult<Page<Lead>>>;
  listProjects(request: PageRequest<ListFilters>): Promise<ApiResult<Page<Project>>>;
  listActivities(request: PageRequest<ListFilters>): Promise<ApiResult<Page<Activity>>>;
  listArtifacts(request: PageRequest<ListFilters>): Promise<ApiResult<Page<Artifact>>>;
  getLead(id: ID): Promise<ApiResult<Lead>>;
  getProject(id: ID): Promise<ApiResult<Project>>;
}

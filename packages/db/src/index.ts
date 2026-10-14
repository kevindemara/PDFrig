export interface ProfileRow {
  readonly created_at: string;
  readonly display_name: string | null;
  readonly locale: string;
  readonly marketing_consent_at: string | null;
  readonly terms_accepted_at: string | null;
  readonly terms_version: string | null;
  readonly timezone: string;
  readonly updated_at: string;
  readonly user_id: string;
}

export interface WorkspaceRow {
  readonly created_at: string;
  readonly deleted_at: string | null;
  readonly id: string;
  readonly kind: 'personal';
  readonly name: string;
  readonly owner_user_id: string;
  readonly status: 'active' | 'deleted' | 'deleting' | 'suspended';
  readonly updated_at: string;
}

export interface WorkspaceMemberRow {
  readonly created_at: string;
  readonly role: 'owner';
  readonly status: 'active' | 'removed';
  readonly updated_at: string;
  readonly user_id: string;
  readonly workspace_id: string;
}

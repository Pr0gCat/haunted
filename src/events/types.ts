export interface GitHubEvent {
  type: string;
  action?: string;
  payload: Record<string, unknown>;
  deliveryId: string;
  receivedAt: Date;
}

export type EventHandler = (event: GitHubEvent) => Promise<void>;

export interface IssueEventPayload {
  action: "opened" | "edited" | "closed" | "reopened" | "assigned" | "unassigned" | "labeled" | "unlabeled";
  issue: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string };
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    html_url: string;
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
  sender: { login: string };
}

export interface IssueCommentEventPayload {
  action: "created" | "edited" | "deleted";
  issue: {
    number: number;
    title: string;
    pull_request?: { url: string };
  };
  comment: {
    id: number;
    body: string;
    user: { login: string };
    html_url: string;
  };
  repository: {
    full_name: string;
  };
  sender: { login: string };
}

export interface PullRequestEventPayload {
  action:
    | "opened"
    | "closed"
    | "reopened"
    | "edited"
    | "synchronize"
    | "review_requested"
    | "review_request_removed";
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    merged: boolean;
    user: { login: string };
    labels: Array<{ name: string }>;
    head: { ref: string; sha: string };
    base: { ref: string };
    html_url: string;
  };
  repository: {
    full_name: string;
    default_branch: string;
  };
  sender: { login: string };
}

export interface PullRequestReviewEventPayload {
  action: "submitted" | "edited" | "dismissed";
  review: {
    id: number;
    body: string | null;
    state: "approved" | "changes_requested" | "commented" | "dismissed";
    user: { login: string };
  };
  pull_request: {
    number: number;
    title: string;
  };
  repository: {
    full_name: string;
  };
  sender: { login: string };
}

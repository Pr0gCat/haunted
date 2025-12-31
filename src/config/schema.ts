import { z } from "zod";

export const ScopeSchema = z.object({
  type: z.enum(["repo", "organization"]),
  target: z.string().describe("owner/repo or organization-name"),
});

export const WebhookConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    port: z.number().optional(),
    secret: z.string().optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? true,
    port: val.port ?? 3000,
    secret: val.secret,
  }));

export const PollingConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    interval: z.number().optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? true,
    interval: val.interval ?? 60,
  }));

export const GitHubConfigSchema = z
  .object({
    webhook: z
      .object({
        enabled: z.boolean().optional(),
        port: z.number().optional(),
        secret: z.string().optional(),
      })
      .optional(),
    polling: z
      .object({
        enabled: z.boolean().optional(),
        interval: z.number().optional(),
      })
      .optional(),
  })
  .transform((val) => ({
    webhook: {
      enabled: val.webhook?.enabled ?? true,
      port: val.webhook?.port ?? 3000,
      secret: val.webhook?.secret,
    },
    polling: {
      enabled: val.polling?.enabled ?? true,
      interval: val.polling?.interval ?? 60,
    },
  }));

export const HouseMasterConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    auto_assign: z.boolean().optional(),
    auto_review: z.boolean().optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? true,
    auto_assign: val.auto_assign ?? true,
    auto_review: val.auto_review ?? true,
  }));

export const ClaudeCodeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    branch_prefix: z.string().optional(),
    auto_test: z.boolean().optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? true,
    branch_prefix: val.branch_prefix ?? "haunted/",
    auto_test: val.auto_test ?? true,
  }));

export const AgentsConfigSchema = z
  .object({
    house_master: z
      .object({
        enabled: z.boolean().optional(),
        auto_assign: z.boolean().optional(),
        auto_review: z.boolean().optional(),
      })
      .optional(),
    claude_code: z
      .object({
        enabled: z.boolean().optional(),
        branch_prefix: z.string().optional(),
        auto_test: z.boolean().optional(),
      })
      .optional(),
  })
  .transform((val) => ({
    house_master: {
      enabled: val.house_master?.enabled ?? true,
      auto_assign: val.house_master?.auto_assign ?? true,
      auto_review: val.house_master?.auto_review ?? true,
    },
    claude_code: {
      enabled: val.claude_code?.enabled ?? true,
      branch_prefix: val.claude_code?.branch_prefix ?? "haunted/",
      auto_test: val.claude_code?.auto_test ?? true,
    },
  }));

export const AutoMergeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    require_approval: z.boolean().optional(),
    require_ci_pass: z.boolean().optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? false,
    require_approval: val.require_approval ?? true,
    require_ci_pass: val.require_ci_pass ?? true,
  }));

export const PullRequestRuleSchema = z.object({
  label: z.string(),
  auto_merge: z.boolean(),
});

export const PullRequestsConfigSchema = z
  .object({
    auto_merge: z
      .object({
        enabled: z.boolean().optional(),
        require_approval: z.boolean().optional(),
        require_ci_pass: z.boolean().optional(),
      })
      .optional(),
    rules: z.array(PullRequestRuleSchema).optional(),
  })
  .transform((val) => ({
    auto_merge: {
      enabled: val.auto_merge?.enabled ?? false,
      require_approval: val.auto_merge?.require_approval ?? true,
      require_ci_pass: val.auto_merge?.require_ci_pass ?? true,
    },
    rules: val.rules ?? [],
  }));

export const ProjectColumnSchema = z.object({
  name: z.string(),
  status: z.enum(["backlog", "in_progress", "review", "done"]),
});

const DEFAULT_COLUMNS = [
  { name: "Backlog", status: "backlog" as const },
  { name: "In Progress", status: "in_progress" as const },
  { name: "Review", status: "review" as const },
  { name: "Done", status: "done" as const },
];

export const ProjectConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    number: z.number().optional().describe("GitHub Project number to use"),
    columns: z.array(ProjectColumnSchema).optional(),
  })
  .transform((val) => ({
    enabled: val.enabled ?? true,
    number: val.number,
    columns: val.columns ?? DEFAULT_COLUMNS,
  }));

// Issue category label definition
export const IssueLabelSchema = z.object({
  name: z.string().describe("Label name to apply on GitHub"),
  color: z.string().optional().describe("Label color in hex (without #)"),
  description: z.string().optional().describe("Label description"),
});

export type IssueLabel = z.infer<typeof IssueLabelSchema>;

// Default issue category labels
const DEFAULT_ISSUE_LABELS: Record<string, IssueLabel> = {
  bug: { name: "bug", color: "d73a4a", description: "Something isn't working" },
  feature: { name: "feature-request", color: "a2eeef", description: "New feature or request" },
  enhancement: { name: "enhancement", color: "84b6eb", description: "Improvement to existing functionality" },
  documentation: { name: "documentation", color: "0075ca", description: "Improvements or additions to documentation" },
  question: { name: "question", color: "d876e3", description: "Further information is requested" },
  refactor: { name: "refactor", color: "fbca04", description: "Code refactoring without functionality changes" },
  test: { name: "test", color: "bfd4f2", description: "Testing related changes" },
  chore: { name: "chore", color: "fef2c0", description: "Maintenance and housekeeping" },
};

// Complexity labels
const DEFAULT_COMPLEXITY_LABELS: Record<string, IssueLabel> = {
  low: { name: "complexity:low", color: "c2e0c6", description: "Low complexity task" },
  medium: { name: "complexity:medium", color: "fef2c0", description: "Medium complexity task" },
  high: { name: "complexity:high", color: "f9d0c4", description: "High complexity task" },
};

// Priority labels
const DEFAULT_PRIORITY_LABELS: Record<string, IssueLabel> = {
  critical: { name: "priority:critical", color: "b60205", description: "Critical priority" },
  high: { name: "priority:high", color: "d93f0b", description: "High priority" },
  medium: { name: "priority:medium", color: "fbca04", description: "Medium priority" },
  low: { name: "priority:low", color: "0e8a16", description: "Low priority" },
};

export const LabelsConfigSchema = z
  .object({
    // System control labels
    human_only: z.string().optional(),
    skip: z.string().optional(),
    auto_merge: z.string().optional(),
    needs_review: z.string().optional(),
    // Issue category labels
    issue_types: z.record(z.string(), IssueLabelSchema).optional(),
    // Complexity labels
    complexity: z.record(z.string(), IssueLabelSchema).optional(),
    // Priority labels
    priority: z.record(z.string(), IssueLabelSchema).optional(),
    // Auto-apply labels based on analysis
    auto_label: z.boolean().optional(),
  })
  .transform((val) => ({
    human_only: val.human_only ?? "human-only",
    skip: val.skip ?? "haunted-skip",
    auto_merge: val.auto_merge ?? "auto-merge",
    needs_review: val.needs_review ?? "needs-review",
    issue_types: val.issue_types ?? DEFAULT_ISSUE_LABELS,
    complexity: val.complexity ?? DEFAULT_COMPLEXITY_LABELS,
    priority: val.priority ?? DEFAULT_PRIORITY_LABELS,
    auto_label: val.auto_label ?? true,
  }));

export const ConfigSchema = z
  .object({
    version: z.string().optional(),
    scope: ScopeSchema,
    github: z
      .object({
        webhook: z
          .object({
            enabled: z.boolean().optional(),
            port: z.number().optional(),
            secret: z.string().optional(),
          })
          .optional(),
        polling: z
          .object({
            enabled: z.boolean().optional(),
            interval: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    agents: z
      .object({
        house_master: z
          .object({
            enabled: z.boolean().optional(),
            auto_assign: z.boolean().optional(),
            auto_review: z.boolean().optional(),
          })
          .optional(),
        claude_code: z
          .object({
            enabled: z.boolean().optional(),
            branch_prefix: z.string().optional(),
            auto_test: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    pull_requests: z
      .object({
        auto_merge: z
          .object({
            enabled: z.boolean().optional(),
            require_approval: z.boolean().optional(),
            require_ci_pass: z.boolean().optional(),
          })
          .optional(),
        rules: z.array(PullRequestRuleSchema).optional(),
      })
      .optional(),
    project: z
      .object({
        enabled: z.boolean().optional(),
        number: z.number().optional(),
        columns: z.array(ProjectColumnSchema).optional(),
      })
      .optional(),
    labels: z
      .object({
        human_only: z.string().optional(),
        skip: z.string().optional(),
        auto_merge: z.string().optional(),
        needs_review: z.string().optional(),
        issue_types: z.record(z.string(), IssueLabelSchema).optional(),
        complexity: z.record(z.string(), IssueLabelSchema).optional(),
        priority: z.record(z.string(), IssueLabelSchema).optional(),
        auto_label: z.boolean().optional(),
      })
      .optional(),
  })
  .transform((val) => ({
    version: val.version ?? "1.0",
    scope: val.scope,
    github: {
      webhook: {
        enabled: val.github?.webhook?.enabled ?? true,
        port: val.github?.webhook?.port ?? 3000,
        secret: val.github?.webhook?.secret,
      },
      polling: {
        enabled: val.github?.polling?.enabled ?? true,
        interval: val.github?.polling?.interval ?? 60,
      },
    },
    agents: {
      house_master: {
        enabled: val.agents?.house_master?.enabled ?? true,
        auto_assign: val.agents?.house_master?.auto_assign ?? true,
        auto_review: val.agents?.house_master?.auto_review ?? true,
      },
      claude_code: {
        enabled: val.agents?.claude_code?.enabled ?? true,
        branch_prefix: val.agents?.claude_code?.branch_prefix ?? "haunted/",
        auto_test: val.agents?.claude_code?.auto_test ?? true,
      },
    },
    pull_requests: {
      auto_merge: {
        enabled: val.pull_requests?.auto_merge?.enabled ?? false,
        require_approval: val.pull_requests?.auto_merge?.require_approval ?? true,
        require_ci_pass: val.pull_requests?.auto_merge?.require_ci_pass ?? true,
      },
      rules: val.pull_requests?.rules ?? [],
    },
    project: {
      enabled: val.project?.enabled ?? true,
      number: val.project?.number,
      columns: val.project?.columns ?? DEFAULT_COLUMNS,
    },
    labels: {
      human_only: val.labels?.human_only ?? "human-only",
      skip: val.labels?.skip ?? "haunted-skip",
      auto_merge: val.labels?.auto_merge ?? "auto-merge",
      needs_review: val.labels?.needs_review ?? "needs-review",
      issue_types: val.labels?.issue_types ?? DEFAULT_ISSUE_LABELS,
      complexity: val.labels?.complexity ?? DEFAULT_COMPLEXITY_LABELS,
      priority: val.labels?.priority ?? DEFAULT_PRIORITY_LABELS,
      auto_label: val.labels?.auto_label ?? true,
    },
  }));

export type LabelsConfig = Config["labels"];

export type Config = z.infer<typeof ConfigSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type GitHubConfig = Config["github"];
export type AgentsConfig = Config["agents"];

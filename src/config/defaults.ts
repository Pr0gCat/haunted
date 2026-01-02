import type { Config } from "@/config/schema.ts";

export const DEFAULT_CONFIG: Omit<Config, "scope"> = {
  version: "1.0",
  github: {
    webhook: {
      enabled: true,
      port: 3000,
      secret: undefined,
    },
    polling: {
      enabled: true,
      interval: 60,
    },
  },
  agents: {
    house_master: {
      enabled: true,
      auto_assign: true,
      auto_review: true,
    },
    claude_code: {
      enabled: true,
      branch_prefix: "haunted/",
      auto_test: true,
    },
  },
  pull_requests: {
    auto_merge: {
      enabled: false,
      require_approval: true,
      require_ci_pass: true,
    },
    rules: [
      { label: "auto-merge", auto_merge: true },
      { label: "needs-review", auto_merge: false },
    ],
  },
  project: {
    enabled: true,
    number: undefined,
    columns: [
      { name: "Backlog", status: "backlog" },
      { name: "In Progress", status: "in_progress" },
      { name: "Review", status: "review" },
      { name: "Done", status: "done" },
    ],
    driven: false,
  },
  labels: {
    human_only: "human-only",
    skip: "haunted-skip",
    auto_merge: "auto-merge",
    needs_review: "needs-review",
    issue_types: {
      bug: { name: "bug", color: "d73a4a", description: "Something isn't working" },
      feature: { name: "feature-request", color: "a2eeef", description: "New feature or request" },
      enhancement: { name: "enhancement", color: "84b6eb", description: "Improvement to existing functionality" },
      documentation: { name: "documentation", color: "0075ca", description: "Improvements or additions to documentation" },
      question: { name: "question", color: "d876e3", description: "Further information is requested" },
      refactor: { name: "refactor", color: "fbca04", description: "Code refactoring without functionality changes" },
      test: { name: "test", color: "bfd4f2", description: "Testing related changes" },
      chore: { name: "chore", color: "fef2c0", description: "Maintenance and housekeeping" },
    },
    complexity: {
      low: { name: "complexity:low", color: "c2e0c6", description: "Low complexity task" },
      medium: { name: "complexity:medium", color: "fef2c0", description: "Medium complexity task" },
      high: { name: "complexity:high", color: "f9d0c4", description: "High complexity task" },
    },
    priority: {
      critical: { name: "priority:critical", color: "b60205", description: "Critical priority" },
      high: { name: "priority:high", color: "d93f0b", description: "High priority" },
      medium: { name: "priority:medium", color: "fbca04", description: "Medium priority" },
      low: { name: "priority:low", color: "0e8a16", description: "Low priority" },
    },
    auto_label: true,
  },
};

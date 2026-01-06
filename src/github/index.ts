export * from "@/github/cli.ts";
export * from "@/github/issues.ts";
export * from "@/github/pull-requests.ts";
export * from "@/github/comments.ts";
export * from "@/github/projects.ts";

import { gh } from "@/github/cli.ts";

/**
 * List all repositories in an organization
 */
export async function listOrgRepos(org: string): Promise<string[]> {
  const result = await gh(["repo", "list", org, "--json", "nameWithOwner", "--limit", "100"]);

  if (result.exitCode !== 0) {
    return [];
  }

  const repos = JSON.parse(result.stdout) as Array<{ nameWithOwner: string }>;
  return repos.map((r) => r.nameWithOwner);
}

/**
 * Check if the current token has Project (read:project) scope
 */
export async function checkProjectPermission(owner: string, projectNumber: number): Promise<boolean> {
  const query = `query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) { id }
    }
  }`;

  const result = await gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-F",
    `number=${projectNumber}`,
  ]);

  if (result.exitCode !== 0 && result.stderr.includes("read:project")) {
    return false;
  }

  return result.exitCode === 0;
}

import { gh } from "@/github/cli.ts";
import { createLogger } from "@/utils/logger.ts";

const logger = createLogger("github-projects");

export interface Project {
  id: string;
  title: string;
  number: number;
  url: string;
}

export interface ProjectItem {
  id: string;
  title: string;
  status: string | null;
  type: "ISSUE" | "PULL_REQUEST" | "DRAFT_ISSUE";
  content: {
    number: number;
    repository: string;
  } | null;
}

export async function listProjects(owner: string): Promise<Project[]> {
  const result = await gh([
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `query=query($owner: String!) {
      user(login: $owner) {
        projectsV2(first: 20) {
          nodes {
            id
            title
            number
            url
          }
        }
      }
    }`,
  ]);

  if (result.exitCode !== 0) {
    const orgResult = await gh([
      "api",
      "graphql",
      "-f",
      `owner=${owner}`,
      "-f",
      `query=query($owner: String!) {
        organization(login: $owner) {
          projectsV2(first: 20) {
            nodes {
              id
              title
              number
              url
            }
          }
        }
      }`,
    ]);

    if (orgResult.exitCode !== 0) {
      throw new Error(`Failed to list projects: ${orgResult.stderr}`);
    }

    const orgData = JSON.parse(orgResult.stdout);
    return orgData.data.organization.projectsV2.nodes;
  }

  const data = JSON.parse(result.stdout);
  return data.data.user.projectsV2.nodes;
}

export async function getProject(owner: string, projectNumber: number): Promise<Project | null> {
  const projects = await listProjects(owner);
  return projects.find((p) => p.number === projectNumber) ?? null;
}

export async function getProjectItems(
  owner: string,
  projectNumber: number
): Promise<ProjectItem[]> {
  const result = await gh([
    "project",
    "item-list",
    String(projectNumber),
    "--owner",
    owner,
    "--format",
    "json",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get project items: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  return data.items.map((item: Record<string, unknown>) => ({
    id: item.id,
    title: item.title,
    status: item.status ?? null,
    type: item.type,
    content: item.content,
  }));
}

export async function addIssueToProject(
  owner: string,
  projectNumber: number,
  issueUrl: string
): Promise<string> {
  const result = await gh([
    "project",
    "item-add",
    String(projectNumber),
    "--owner",
    owner,
    "--url",
    issueUrl,
    "--format",
    "json",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to add issue to project: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  logger.info({ owner, projectNumber, issueUrl }, "Issue added to project");
  return data.id;
}

export async function updateProjectItemStatus(
  owner: string,
  projectNumber: number,
  itemId: string,
  statusFieldId: string,
  statusOptionId: string
): Promise<void> {
  const result = await gh([
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    String(projectNumber),
    "--field-id",
    statusFieldId,
    "--single-select-option-id",
    statusOptionId,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to update project item status: ${result.stderr}`);
  }

  logger.info({ owner, projectNumber, itemId }, "Project item status updated");
}

export async function getProjectFields(
  owner: string,
  projectNumber: number
): Promise<Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }>> {
  const result = await gh([
    "project",
    "field-list",
    String(projectNumber),
    "--owner",
    owner,
    "--format",
    "json",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to get project fields: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  return data.fields;
}

export async function moveItemToColumn(
  owner: string,
  projectNumber: number,
  itemId: string,
  columnName: string
): Promise<void> {
  const fields = await getProjectFields(owner, projectNumber);

  const statusField = fields.find(
    (f) => f.name.toLowerCase() === "status" && f.options
  );

  if (!statusField) {
    throw new Error("Project does not have a Status field");
  }

  const option = statusField.options?.find(
    (o) => o.name.toLowerCase() === columnName.toLowerCase()
  );

  if (!option) {
    throw new Error(`Column "${columnName}" not found in project`);
  }

  await updateProjectItemStatus(owner, projectNumber, itemId, statusField.id, option.id);
}

import bunyan from 'bunyan';
import got from 'got';
import { MANUAL_MERGE_MESSAGE, AUTO_MERGE_MESSAGE } from './constants';
import {
  Project,
  Repository,
  PullRequest,
  ProcessedPullRequest,
  ApiResponse,
  GotOptions,
  GotResponse,
} from './types';

const {
  BITBUCKET_SERVER_URL,
  BITBUCKET_TOKEN,
  BITBUCKET_PROJECTS,
  RENOVATE_BOT_USER,
  PR_AUTHOR_USER,
  DRY_RUN,
} = process.env;

const DEFAULT_OPTIONS: GotOptions = {
  prefixUrl: `${BITBUCKET_SERVER_URL}/rest/api/1.0/`,
  headers: {
    Authorization: `Bearer ${BITBUCKET_TOKEN}`,
    'Content-Type': 'application/json',
  },
  responseType: 'json',
};

const log = bunyan.createLogger({
  name: 'renovate-approve-bot-bitbucket-server',
  serializers: {
    res: bunyan.stdSerializers.res,
  },
});

/**
 * Print the current configuration of the bot, omitting sensitive information.
 */
function printConfiguration(): void {
  log.info(
    {
      configuration: {
        BITBUCKET_SERVER_URL,
        BITBUCKET_PROJECTS:
          BITBUCKET_PROJECTS ||
          'Not set (will autodiscover all accessible projects)',
        RENOVATE_BOT_USER,
        PR_AUTHOR_USER,
        DRY_RUN: DRY_RUN || 'Not set (default: false)',
      },
    },
    'Bot configuration'
  );
}

function isAutomerging(pr: PullRequest): boolean {
  try {
    if (!pr.description) {
      return false;
    }
    return (
      pr.description.includes(AUTO_MERGE_MESSAGE) &&
      !pr.description.includes(MANUAL_MERGE_MESSAGE)
    );
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function getAllProjects(): Promise<Project[]> {
  const projectsEndpoint = 'projects';
  log.info(
    'Autodiscovering projects from %s%s...',
    DEFAULT_OPTIONS.prefixUrl,
    projectsEndpoint
  );

  try {
    const response = await got(projectsEndpoint, {
      ...DEFAULT_OPTIONS,
      searchParams: {
        limit: 1000, // Get all projects the user has access to
      },
    });

    return (response.body as ApiResponse<Project>).values || [];
  } catch (error) {
    log.error(error, 'Failed to get projects');
    throw error;
  }
}

async function getProjectKeys(): Promise<string[]> {
  // Parse the BITBUCKET_PROJECTS environment variable if it exists
  let projectKeys: string[] = [];
  let shouldAutodiscover = true;

  if (BITBUCKET_PROJECTS) {
    try {
      // Try parsing as JSON array first
      projectKeys = JSON.parse(BITBUCKET_PROJECTS);
    } catch {
      // If not JSON, treat as comma-separated string
      projectKeys = BITBUCKET_PROJECTS.split(',')
        .map((key) => key.trim())
        .filter((key) => key);
    }

    // If we have valid project keys, don't autodiscover
    if (projectKeys && projectKeys.length > 0) {
      shouldAutodiscover = false;
      log.info(`Configured to manage projects: ${projectKeys.join(', ')}`);
    }
  }

  // If no project keys or empty list, autodiscover all accessible projects
  if (shouldAutodiscover) {
    log.info('No projects specified, autodiscovering all accessible projects');
    const projects = await getAllProjects();
    projectKeys = projects.map((project) => project.key);
    log.info(`Autodiscovered ${projectKeys.length} accessible projects`);
  }

  if (projectKeys.length === 0) {
    throw new Error('No accessible projects found');
  }

  return projectKeys;
}

async function getAllRepositories(
  projectKeys: string[]
): Promise<Repository[]> {
  try {
    if (!projectKeys || projectKeys.length === 0) {
      throw new Error('Project keys must be provided');
    }

    const allRepositories: Repository[] = [];

    // eslint-disable-next-line no-await-in-loop
    for (const projectKey of projectKeys) {
      const reposEndpoint = `projects/${projectKey}/repos`;
      log.info(
        'Requesting repositories from %s%s...',
        DEFAULT_OPTIONS.prefixUrl,
        reposEndpoint
      );

      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await got(reposEndpoint, {
          ...DEFAULT_OPTIONS,
          searchParams: {
            limit: 1000, // Get all repositories
          },
        });

        const repositories = (
          (response.body as ApiResponse<Repository>).values || []
        ).map((repo) => ({
          ...repo,
          projectKey,
        }));

        allRepositories.push(...repositories);
      } catch (error) {
        log.error(
          error,
          `Failed to get repositories for project ${projectKey}`
        );
        // Continue with other projects even if one fails
      }
    }

    return allRepositories;
  } catch (error) {
    log.error(error, 'Failed to get repositories');
    throw error;
  }
}

async function getPullRequestsForRepo(
  projectKey: string,
  repoSlug: string
): Promise<ProcessedPullRequest[]> {
  const prEndpoint = `projects/${projectKey}/repos/${repoSlug}/pull-requests`;
  log.info(
    'Requesting PRs from %s%s...',
    DEFAULT_OPTIONS.prefixUrl,
    prEndpoint
  );

  try {
    const response = await got(prEndpoint, {
      ...DEFAULT_OPTIONS,
      searchParams: {
        state: 'OPEN',
        limit: 1000,
      },
    });

    const allPrs = (response.body as ApiResponse<PullRequest>).values || [];

    // Filter PRs by PR author user and automerge status
    return allPrs
      .filter((pr) => pr.author.user.name === PR_AUTHOR_USER)
      .filter((pr) => isAutomerging(pr))
      .map((pr) => ({
        id: pr.id,
        projectKey,
        repoSlug,
        title: pr.title,
        links: pr.links,
      }));
  } catch (error) {
    log.error(
      error,
      `Failed to get pull requests for ${projectKey}/${repoSlug}`
    );
    return [];
  }
}

async function getPullRequests(): Promise<ProcessedPullRequest[]> {
  try {
    const projectKeys = await getProjectKeys();
    const repositories = await getAllRepositories(projectKeys);
    log.info(
      `Found ${repositories.length} repositories across all accessible projects`
    );

    const allPullRequests: ProcessedPullRequest[] = [];

    // eslint-disable-next-line no-await-in-loop
    for (const repo of repositories) {
      // eslint-disable-next-line no-await-in-loop
      const prs = await getPullRequestsForRepo(repo.projectKey, repo.slug);
      allPullRequests.push(...prs);
    }

    log.info(
      `Found ${allPullRequests.length} automerge PRs from ${PR_AUTHOR_USER}`
    );
    return allPullRequests;
  } catch (error) {
    log.error(error, 'Failed to get pull requests');
    throw error;
  }
}

function approvePullRequest(pr: ProcessedPullRequest): Promise<GotResponse> {
  // Use RENOVATE_BOT_USER for approvals
  const participantsEndpoint = `projects/${pr.projectKey}/repos/${pr.repoSlug}/pull-requests/${pr.id}/participants/${RENOVATE_BOT_USER}`;

  return got(participantsEndpoint, {
    ...DEFAULT_OPTIONS,
    method: 'PUT',
    json: {
      user: {
        name: RENOVATE_BOT_USER,
      },
      role: 'REVIEWER',
      approved: true,
      status: 'APPROVED',
    },
    throwHttpErrors: false,
  }) as unknown as Promise<GotResponse>;
}

async function main(): Promise<void> {
  if (!BITBUCKET_SERVER_URL || !BITBUCKET_TOKEN || !RENOVATE_BOT_USER) {
    log.fatal(
      'At least one of BITBUCKET_SERVER_URL, BITBUCKET_TOKEN, RENOVATE_BOT_USER environment variables is not set.'
    );
    process.exit(1);
  }

  if (!PR_AUTHOR_USER) {
    log.fatal(
      'PR_AUTHOR_USER environment variable is not set. This is the username that opens the PRs to be approved.'
    );
    process.exit(1);
  } else if (PR_AUTHOR_USER === RENOVATE_BOT_USER) {
    log.fatal(
      'PR_AUTHOR_USER cannot be the same as RENOVATE_BOT_USER. Bitbucket Server does not allow users to approve their own PRs.'
    );
    process.exit(1);
  }

  // Print current configuration
  printConfiguration();

  const isDryRun = DRY_RUN && DRY_RUN.toLowerCase() === 'true';

  if (isDryRun) {
    log.info('DRY RUN MODE: No actual approvals will be made');
  }

  let pullRequests: ProcessedPullRequest[];
  try {
    pullRequests = await getPullRequests();
  } catch (error) {
    log.fatal(error);
    process.exit(1);
    return; // This line is just for TypeScript, as process.exit(1) will terminate execution
  }

  for (const pr of pullRequests) {
    if (isDryRun) {
      log.info(
        'DRY RUN: Would approve PR: %s/%s#%d - %s',
        pr.projectKey,
        pr.repoSlug,
        pr.id,
        pr.title
      );
    } else {
      log.info(
        'Approving PR: %s/%s#%d - %s',
        pr.projectKey,
        pr.repoSlug,
        pr.id,
        pr.title
      );

      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await approvePullRequest(pr);

        switch (response.statusCode) {
          case 200:
            log.info({ pr: pr.id, res: response }, 'Approved');
            break;
          case 409:
            // likely already approved
            if (
              response.body &&
              response.body.errors &&
              response.body.errors.length > 0
            ) {
              log.info(
                { pr: pr.id, res: response },
                response.body.errors[0].message
              );
            } else {
              log.info(
                { pr: pr.id, res: response },
                'Already approved or conflict'
              );
            }
            break;
          default:
            log.error({ pr: pr.id, res: response }, response.body);
            break;
        }
      } catch (error) {
        log.error(error, { pr: pr.id });
      }
    }
  }
}

export {
  isAutomerging,
  getAllProjects,
  getProjectKeys,
  getAllRepositories,
  getPullRequestsForRepo,
  getPullRequests,
  approvePullRequest,
  printConfiguration,
  main,
};

const bunyan = require('bunyan');
const got = require('got');

const { BITBUCKET_SERVER_URL, BITBUCKET_TOKEN, BITBUCKET_PROJECTS, RENOVATE_BOT_USER, DRY_RUN } =
  process.env;
const MANUAL_MERGE_MESSAGE = 'merge this manually';
const AUTO_MERGE_MESSAGE = '**Automerge**: Enabled.';

const DEFAULT_OPTIONS = {
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

function isAutomerging(pr) {
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

async function getAllRepositories() {
  try {
    // Parse the BITBUCKET_PROJECTS environment variable
    let projectKeys = [];
    if (BITBUCKET_PROJECTS) {
      try {
        // Try parsing as JSON array first
        projectKeys = JSON.parse(BITBUCKET_PROJECTS);
      } catch (error) {
        // If not JSON, treat as comma-separated string
        projectKeys = BITBUCKET_PROJECTS.split(',').map(key => key.trim()).filter(key => key);
      }
    }

    if (!projectKeys || projectKeys.length === 0) {
      throw new Error('BITBUCKET_PROJECTS environment variable must contain at least one project key');
    }

    log.info(`Configured to manage projects: ${projectKeys.join(', ')}`);

    const allRepositories = [];

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

        const repositories = (response.body.values || []).map((repo) => ({
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

async function getPullRequestsForRepo(projectKey, repoSlug) {
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

    const allPrs = response.body.values || [];

    // Filter PRs by Renovate bot user and automerge status
    return allPrs
      .filter((pr) => pr.author.user.name === RENOVATE_BOT_USER)
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

async function getPullRequests() {
  try {
    const repositories = await getAllRepositories();
    log.info(`Found ${repositories.length} repositories across configured projects`);

    const allPullRequests = [];

    // eslint-disable-next-line no-await-in-loop
    for (const repo of repositories) {
      // eslint-disable-next-line no-await-in-loop
      const prs = await getPullRequestsForRepo(repo.projectKey, repo.slug);
      allPullRequests.push(...prs);
    }

    log.info(
      `Found ${allPullRequests.length} automerge PRs from ${RENOVATE_BOT_USER}`
    );
    return allPullRequests;
  } catch (error) {
    log.error(error, 'Failed to get pull requests');
    throw error;
  }
}

function approvePullRequest(pr) {
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
  });
}

async function main() {
  if (!BITBUCKET_SERVER_URL || !BITBUCKET_TOKEN || !BITBUCKET_PROJECTS || !RENOVATE_BOT_USER) {
    log.fatal(
      'At least one of BITBUCKET_SERVER_URL, BITBUCKET_TOKEN, BITBUCKET_PROJECTS, RENOVATE_BOT_USER environment variables is not set.'
    );
    process.exit(1);
  }

  const isDryRun = DRY_RUN && DRY_RUN.toLowerCase() === 'true';

  if (isDryRun) {
    log.info('DRY RUN MODE: No actual approvals will be made');
  }

  let pullRequests;
  try {
    pullRequests = await getPullRequests();
  } catch (error) {
    log.fatal(error);
    process.exit(1);
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

if (require.main === module) {
  main();
}

module.exports = {
  isAutomerging,
  getAllRepositories,
  getPullRequestsForRepo,
  getPullRequests,
  approvePullRequest,
  main,
};

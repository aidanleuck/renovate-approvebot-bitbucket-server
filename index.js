const bunyan = require('bunyan');
const got = require('got');

const {
  BITBUCKET_URL,
  BITBUCKET_USERNAME,
  BITBUCKET_TOKEN,
  BITBUCKET_PROJECT_KEY,
  RENOVATE_BOT_USER,
} = process.env;
const MANUAL_MERGE_MESSAGE = 'merge this manually';
const AUTO_MERGE_MESSAGE = '**Automerge**: Enabled.';

const DEFAULT_OPTIONS = {
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

async function getPullRequestsForRepo(projectKey, repoSlug) {
  const prEndpoint = `${BITBUCKET_URL}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}/pull-requests`;
  log.debug('Requesting PRs for %s/%s...', projectKey, repoSlug);

  const prList = [];
  let start = 0;
  const limit = 25; // Bitbucket Server default page size
  let hasMorePages = true;

  while (hasMorePages) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await got(prEndpoint, {
        ...DEFAULT_OPTIONS,
        searchParams: {
          state: 'OPEN',
          limit,
          start,
        },
      });

      const prs = response.body.values || [];
      const filteredPrs = prs
        .filter((pr) => pr.author.user.name === RENOVATE_BOT_USER)
        .filter((pr) => isAutomerging(pr))
        .map((pr) => ({
          id: pr.id,
          projectKey,
          repoSlug,
          title: pr.title,
          author: pr.author.user.name,
        }));

      prList.push(...filteredPrs);

      if (response.body.isLastPage || prs.length < limit) {
        hasMorePages = false;
      } else {
        start += limit;
      }
    } catch (error) {
      log.error(error, 'Failed to get PRs for %s/%s', projectKey, repoSlug);
      hasMorePages = false;
    }
  }

  return prList;
}

async function getPullRequestsForProject(projectKey) {
  const reposEndpoint = `${BITBUCKET_URL}/rest/api/1.0/projects/${projectKey}/repos`;
  log.info('Requesting repositories for project %s...', projectKey);

  const allPrs = [];

  try {
    const reposResponse = await got(reposEndpoint, DEFAULT_OPTIONS);
    const repos = reposResponse.body.values || [];

    // Use Promise.all to avoid await in loop
    const repoPromises = repos.map(async (repo) => {
      try {
        return await getPullRequestsForRepo(projectKey, repo.slug);
      } catch (error) {
        log.warn(
          { project: projectKey, repo: repo.slug, error },
          'Failed to get PRs for repository'
        );
        return [];
      }
    });

    const repoResults = await Promise.all(repoPromises);
    repoResults.forEach((repoPrs) => allPrs.push(...repoPrs));
  } catch (error) {
    log.error(error, 'Failed to get repositories for project %s', projectKey);
    throw error;
  }

  return allPrs;
}

async function getAllPullRequestsAcrossProjects() {
  const projectsEndpoint = `${BITBUCKET_URL}/rest/api/1.0/projects`;
  log.info('Requesting %s...', projectsEndpoint);

  const allPrs = [];

  try {
    const projectsResponse = await got(projectsEndpoint, DEFAULT_OPTIONS);
    const projects = projectsResponse.body.values || [];

    // Use Promise.all to avoid await in loop
    const projectPromises = projects.map(async (project) => {
      try {
        return await getPullRequestsForProject(project.key);
      } catch (error) {
        log.warn(
          { project: project.key, error },
          'Failed to get PRs for project'
        );
        return [];
      }
    });

    const projectResults = await Promise.all(projectPromises);
    projectResults.forEach((projectPrs) => allPrs.push(...projectPrs));
  } catch (error) {
    log.error(error, 'Failed to get projects list');
    throw error;
  }

  return allPrs;
}

async function getPullRequests() {
  if (!BITBUCKET_PROJECT_KEY) {
    // Search across all projects if no specific project is provided
    return getAllPullRequestsAcrossProjects();
  }

  // Search within a specific project
  return getPullRequestsForProject(BITBUCKET_PROJECT_KEY);
}

async function approvePullRequest(pr) {
  const approveEndpoint = `${BITBUCKET_URL}/rest/api/1.0/projects/${pr.projectKey}/repos/${pr.repoSlug}/pull-requests/${pr.id}/approve`;

  return got(approveEndpoint, {
    ...DEFAULT_OPTIONS,
    method: 'POST',
    throwHttpErrors: false,
  });
}

async function main() {
  if (
    !BITBUCKET_URL ||
    !BITBUCKET_USERNAME ||
    !BITBUCKET_TOKEN ||
    !RENOVATE_BOT_USER
  ) {
    log.fatal(
      'At least one of BITBUCKET_URL, BITBUCKET_USERNAME, BITBUCKET_TOKEN, RENOVATE_BOT_USER environment variables is not set.'
    );
    process.exit(1);
  }

  // Remove trailing slash from URL if present
  process.env.BITBUCKET_URL = BITBUCKET_URL.replace(/\/$/, '');

  let prs;
  try {
    prs = await getPullRequests();
  } catch (error) {
    log.fatal(error);
    process.exit(1);
  }

  if (prs.length === 0) {
    log.info('No pull requests found for approval');
    return;
  }

  log.info('Found %d pull requests to approve', prs.length);

  const approvalPromises = prs.map(async (pr) => {
    log.info(
      'Approving PR #%d: %s (%s/%s)',
      pr.id,
      pr.title,
      pr.projectKey,
      pr.repoSlug
    );

    try {
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
              'Already approved or cannot approve'
            );
          }
          break;
        default:
          log.error({ pr: pr.id, res: response }, 'Failed to approve');
          break;
      }
    } catch (error) {
      log.error(error, { pr: pr.id }, 'Error approving PR');
    }
  });

  await Promise.all(approvalPromises);
}

if (require.main === module) {
  main();
}

module.exports = { main, isAutomerging, getPullRequests, approvePullRequest };

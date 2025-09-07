const bunyan = require('bunyan');
const got = require('got');

const {
  BITBUCKET_SERVER_URL,
  BITBUCKET_TOKEN,
  BITBUCKET_USERNAME,
  BITBUCKET_PASSWORD,
  BITBUCKET_PROJECT,
  BITBUCKET_REPO,
  RENOVATE_BOT_USER,
} = process.env;

const MANUAL_MERGE_MESSAGE = 'merge this manually';
const AUTO_MERGE_MESSAGE = '**Automerge**: Enabled.';

// Determine authentication method and headers
function getAuthHeaders() {
  if (BITBUCKET_TOKEN) {
    return {
      Authorization: `Bearer ${BITBUCKET_TOKEN}`,
    };
  }
  if (BITBUCKET_USERNAME && BITBUCKET_PASSWORD) {
    return {
      Authorization: `Basic ${Buffer.from(
        `${BITBUCKET_USERNAME}:${BITBUCKET_PASSWORD}`
      ).toString('base64')}`,
    };
  }
  throw new Error(
    'Either BITBUCKET_TOKEN or both BITBUCKET_USERNAME and BITBUCKET_PASSWORD must be provided'
  );
}

const DEFAULT_OPTIONS = {
  prefixUrl: `${BITBUCKET_SERVER_URL}/rest/api/1.0`,
  headers: getAuthHeaders(),
  responseType: 'json',
};

const log = bunyan.createLogger({
  name: 'renovate-approve-bot-server',
  serializers: {
    res: bunyan.stdSerializers.res,
  },
});

function isAutomerging(pr) {
  try {
    return Boolean(
      pr.description &&
        pr.description.includes(AUTO_MERGE_MESSAGE) &&
        !pr.description.includes(MANUAL_MERGE_MESSAGE)
    );
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function getAllPullRequests() {
  const prLinks = [];

  if (BITBUCKET_PROJECT && BITBUCKET_REPO) {
    // Search in specific project/repo
    const prEndpoint = `projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests`;
    log.info('Requesting %s%s...', DEFAULT_OPTIONS.prefixUrl, prEndpoint);

    let start = 0;
    const limit = 100;
    let isLastPage = false;

    while (!isLastPage) {
      // eslint-disable-next-line no-await-in-loop
      const response = await got(prEndpoint, {
        ...DEFAULT_OPTIONS,
        searchParams: {
          state: 'OPEN',
          start,
          limit,
        },
      });

      const prs = response.body.values || [];
      for (const pr of prs) {
        if (pr.author.user.name === RENOVATE_BOT_USER && isAutomerging(pr)) {
          prLinks.push({
            project: BITBUCKET_PROJECT,
            repo: BITBUCKET_REPO,
            id: pr.id,
            href: pr.links.self[0].href,
          });
        }
      }

      isLastPage = response.body.isLastPage;
      start = response.body.nextPageStart || 0;

      if (isLastPage) {
        log.info(
          'All pull-requests gathered from %s/%s.',
          BITBUCKET_PROJECT,
          BITBUCKET_REPO
        );
      }
    }
  } else {
    // Search across all accessible projects
    log.info('Searching across all accessible projects...');
    // eslint-disable-next-line no-await-in-loop
    const projectsResponse = await got('projects', {
      ...DEFAULT_OPTIONS,
      searchParams: { limit: 1000 },
    });

    const projects = projectsResponse.body.values || [];

    for (const project of projects) {
      // eslint-disable-next-line no-await-in-loop
      const reposResponse = await got(`projects/${project.key}/repos`, {
        ...DEFAULT_OPTIONS,
        searchParams: { limit: 1000 },
      });

      const repos = reposResponse.body.values || [];

      for (const repo of repos) {
        try {
          let start = 0;
          const limit = 100;
          let isLastPage = false;

          while (!isLastPage) {
            // eslint-disable-next-line no-await-in-loop
            const response = await got(
              `projects/${project.key}/repos/${repo.slug}/pull-requests`,
              {
                ...DEFAULT_OPTIONS,
                searchParams: {
                  state: 'OPEN',
                  start,
                  limit,
                },
              }
            );

            const prs = response.body.values || [];
            for (const pr of prs) {
              if (
                pr.author.user.name === RENOVATE_BOT_USER &&
                isAutomerging(pr)
              ) {
                prLinks.push({
                  project: project.key,
                  repo: repo.slug,
                  id: pr.id,
                  href: pr.links.self[0].href,
                });
              }
            }

            isLastPage = response.body.isLastPage;
            start = response.body.nextPageStart || 0;
          }
        } catch (repoError) {
          // Log error but continue with other repos
          log.warn(
            repoError,
            'Failed to get PRs for %s/%s',
            project.key,
            repo.slug
          );
        }
      }
    }

    log.info('All pull-requests gathered from all accessible projects.');
  }

  return prLinks;
}

function approvePullRequest(prInfo) {
  const approveEndpoint = `projects/${prInfo.project}/repos/${prInfo.repo}/pull-requests/${prInfo.id}/approve`;

  return got(approveEndpoint, {
    ...DEFAULT_OPTIONS,
    method: 'POST',
    throwHttpErrors: false,
  });
}

async function main() {
  if (!BITBUCKET_SERVER_URL || !RENOVATE_BOT_USER) {
    log.fatal(
      'BITBUCKET_SERVER_URL and RENOVATE_BOT_USER environment variables are required.'
    );
    process.exit(1);
  }

  if (!BITBUCKET_TOKEN && (!BITBUCKET_USERNAME || !BITBUCKET_PASSWORD)) {
    log.fatal(
      'Either BITBUCKET_TOKEN or both BITBUCKET_USERNAME and BITBUCKET_PASSWORD environment variables must be set.'
    );
    process.exit(1);
  }

  let prInfos;
  try {
    prInfos = await getAllPullRequests();
  } catch (error) {
    log.fatal(error);
    process.exit(1);
  }

  if (prInfos.length === 0) {
    log.info('No pull requests found for approval.');
    return;
  }

  for (const prInfo of prInfos) {
    log.info('Approving: %s/%s PR #%d', prInfo.project, prInfo.repo, prInfo.id);

    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await approvePullRequest(prInfo);

      switch (response.statusCode) {
        case 200:
          log.info({ pr: prInfo, res: response }, 'Approved');
          break;
        case 409:
          // Already approved or cannot approve
          if (response.body && response.body.errors) {
            const errorMessage = response.body.errors
              .map((e) => e.message)
              .join(', ');
            log.info(
              { pr: prInfo, res: response },
              `PR already processed: ${errorMessage}`
            );
          } else {
            log.info(
              { pr: prInfo, res: response },
              'PR already approved or cannot be approved'
            );
          }
          break;
        case 404:
          log.warn(
            { pr: prInfo, res: response },
            'PR not found or access denied'
          );
          break;
        default:
          log.error({ pr: prInfo, res: response }, response.body);
          break;
      }
    } catch (error) {
      log.error(error, { pr: prInfo });
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  isAutomerging,
  getAllPullRequests,
  approvePullRequest,
  main,
};

const nock = require('nock');

const BITBUCKET_URL = 'https://bitbucket.company.com';
const BITBUCKET_USERNAME = 'renovate-approve-bot';
const BITBUCKET_TOKEN = 'token123';
const BITBUCKET_PROJECT_KEY = 'TEST';
const RENOVATE_BOT_USER = 'renovate-bot';

process.env = Object.assign(process.env, {
  BITBUCKET_URL,
  BITBUCKET_USERNAME,
  BITBUCKET_TOKEN,
  BITBUCKET_PROJECT_KEY,
  RENOVATE_BOT_USER,
});

const {
  isAutomerging,
  getPullRequests,
  approvePullRequest,
} = require('./index');

const autoMergeDescription = '...\n\n🚦 **Automerge**: Enabled.\n\n...';
const manualMergeDescription =
  '...\n\n🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.\n\n...';
const manualMergeOverrideDescription =
  '...\n\n🚦 **Automerge**: Enabled.\n\n...merge this manually...';

beforeEach(() => {
  // Ensure PROJECT_KEY is set for tests that need it
  process.env.BITBUCKET_PROJECT_KEY = BITBUCKET_PROJECT_KEY;
});

afterEach(() => {
  // Clean up nock interceptors without strict checking for now
  nock.cleanAll();
});

describe('isAutomerging', () => {
  it('is automerging', () => {
    const pr = {
      description: autoMergeDescription,
      // omitted attributes...
    };

    expect(isAutomerging(pr)).toBe(true);
  });

  it('is not automerging - manual merge description', () => {
    const pr = {
      description: manualMergeDescription,
      // omitted attributes...
    };

    expect(isAutomerging(pr)).toBe(false);
  });

  it('is not automerging - manual merge override', () => {
    const pr = {
      description: manualMergeOverrideDescription,
      // omitted attributes...
    };

    expect(isAutomerging(pr)).toBe(false);
  });

  it('handles missing description', () => {
    const pr = {
      // No description
    };

    expect(isAutomerging(pr)).toBe(false);
  });

  it('handles null description', () => {
    const pr = {
      description: null,
    };

    expect(isAutomerging(pr)).toBe(false);
  });
});

describe('getPullRequests', () => {
  beforeEach(() => {
    // Reset URL to remove trailing slash
    process.env.BITBUCKET_URL = BITBUCKET_URL.replace(/\/$/, '');
  });

  it('gets pull-requests for a specific project', async () => {
    const reposEndpoint = `/rest/api/1.0/projects/${BITBUCKET_PROJECT_KEY}/repos`;
    const prEndpoint = `/rest/api/1.0/projects/${BITBUCKET_PROJECT_KEY}/repos/myrepo/pull-requests`;

    nock(BITBUCKET_URL)
      .get(reposEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            slug: 'myrepo',
            name: 'My Repository',
          },
        ],
        isLastPage: true,
      });

    nock(BITBUCKET_URL)
      .get(prEndpoint)
      .query({
        state: 'OPEN',
        limit: 25,
        start: 0,
      })
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 1,
            title: 'Update dependency',
            description: autoMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
          },
          {
            id: 2,
            title: 'Manual update',
            description: manualMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
          },
          {
            id: 3,
            title: 'Another update',
            description: autoMergeDescription,
            author: {
              user: {
                name: 'other-user',
              },
            },
          },
        ],
        isLastPage: true,
      });

    const pullRequests = await getPullRequests();

    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0]).toEqual({
      id: 1,
      projectKey: BITBUCKET_PROJECT_KEY,
      repoSlug: 'myrepo',
      title: 'Update dependency',
      author: RENOVATE_BOT_USER,
    });
  });

  it('gets pull-requests across all projects when no project key specified', async () => {
    // Temporarily remove project key
    const originalProjectKey = process.env.BITBUCKET_PROJECT_KEY;
    delete process.env.BITBUCKET_PROJECT_KEY;

    const projectsEndpoint = '/rest/api/1.0/projects';
    const reposEndpoint = `/rest/api/1.0/projects/PROJ1/repos`;
    const prEndpoint = `/rest/api/1.0/projects/PROJ1/repos/repo1/pull-requests`;

    nock(BITBUCKET_URL)
      .get(projectsEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            key: 'PROJ1',
            name: 'Project 1',
          },
        ],
        isLastPage: true,
      });

    nock(BITBUCKET_URL)
      .get(reposEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            slug: 'repo1',
            name: 'Repository 1',
          },
        ],
        isLastPage: true,
      });

    nock(BITBUCKET_URL)
      .get(prEndpoint)
      .query({
        state: 'OPEN',
        limit: 25,
        start: 0,
      })
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 10,
            title: 'Cross-project update',
            description: autoMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
          },
        ],
        isLastPage: true,
      });

    const pullRequests = await getPullRequests();

    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0]).toEqual({
      id: 10,
      projectKey: 'PROJ1',
      repoSlug: 'repo1',
      title: 'Cross-project update',
      author: RENOVATE_BOT_USER,
    });

    // Restore project key
    process.env.BITBUCKET_PROJECT_KEY = originalProjectKey;
  });

  it('handles pagination correctly', async () => {
    const reposEndpoint = `/rest/api/1.0/projects/${BITBUCKET_PROJECT_KEY}/repos`;
    const prEndpoint = `/rest/api/1.0/projects/${BITBUCKET_PROJECT_KEY}/repos/myrepo/pull-requests`;

    nock(BITBUCKET_URL)
      .get(reposEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            slug: 'myrepo',
            name: 'My Repository',
          },
        ],
        isLastPage: true,
      });

    // First page
    nock(BITBUCKET_URL)
      .get(prEndpoint)
      .query({
        state: 'OPEN',
        limit: 25,
        start: 0,
      })
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: Array(25).fill({
          id: 1,
          title: 'Update dependency',
          description: autoMergeDescription,
          author: {
            user: {
              name: RENOVATE_BOT_USER,
            },
          },
        }),
        isLastPage: false,
      });

    // Second page
    nock(BITBUCKET_URL)
      .get(prEndpoint)
      .query({
        state: 'OPEN',
        limit: 25,
        start: 25,
      })
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 26,
            title: 'Last update',
            description: autoMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
          },
        ],
        isLastPage: true,
      });

    const pullRequests = await getPullRequests();

    expect(pullRequests).toHaveLength(26);
  });

  it('returns empty array when no pull-requests found', async () => {
    const reposEndpoint = `/rest/api/1.0/projects/${BITBUCKET_PROJECT_KEY}/repos`;

    nock(BITBUCKET_URL)
      .get(reposEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [],
        isLastPage: true,
      });

    const pullRequests = await getPullRequests();

    expect(pullRequests).toHaveLength(0);
  });
});

describe('approvePullRequest', () => {
  beforeEach(() => {
    // Reset URL to remove trailing slash
    process.env.BITBUCKET_URL = BITBUCKET_URL.replace(/\/$/, '');
    // Clean up any leftover interceptors
    nock.cleanAll();
  });

  it('approves a pull request successfully', async () => {
    const pr = {
      id: 1,
      projectKey: 'TEST',
      repoSlug: 'myrepo',
      title: 'Update dependency',
      author: 'renovate-bot',
    };

    const approveEndpoint = `/rest/api/1.0/projects/TEST/repos/myrepo/pull-requests/1/approve`;

    nock(BITBUCKET_URL)
      .post(approveEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        approved: true,
      });

    const response = await approvePullRequest(pr);

    expect(response.statusCode).toBe(200);
  });

  it('handles already approved pull request', async () => {
    const pr = {
      id: 2,
      projectKey: 'TEST',
      repoSlug: 'myrepo',
      title: 'Update dependency',
      author: 'renovate-bot',
    };

    const approveEndpoint = `/rest/api/1.0/projects/TEST/repos/myrepo/pull-requests/2/approve`;

    nock(BITBUCKET_URL)
      .post(approveEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(409, {
        errors: [
          {
            message: 'You have already approved this pull request.',
          },
        ],
      });

    const response = await approvePullRequest(pr);

    expect(response.statusCode).toBe(409);
  });

  it('handles authorization errors', async () => {
    const pr = {
      id: 3,
      projectKey: 'TEST',
      repoSlug: 'myrepo',
      title: 'Update dependency',
      author: 'renovate-bot',
    };

    const approveEndpoint = `/rest/api/1.0/projects/TEST/repos/myrepo/pull-requests/3/approve`;

    nock(BITBUCKET_URL)
      .post(approveEndpoint)
      .matchHeader('authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(401, {
        errors: [
          {
            message: 'Authentication required',
          },
        ],
      });

    const response = await approvePullRequest(pr);

    expect(response.statusCode).toBe(401);
  });
});

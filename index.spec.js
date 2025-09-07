const nock = require('nock');

const BITBUCKET_SERVER_URL = 'https://bitbucket.mycompany.com';
const BITBUCKET_TOKEN = 'test-token-123';
const BITBUCKET_PROJECT = 'TEST';
const BITBUCKET_REPO = 'test-repo';
const RENOVATE_BOT_USER = 'renovate-bot';

process.env = Object.assign(process.env, {
  BITBUCKET_SERVER_URL,
  BITBUCKET_TOKEN,
  BITBUCKET_PROJECT,
  BITBUCKET_REPO,
  RENOVATE_BOT_USER,
});

const bot = require('./index');

const API_BASE_URL = `${BITBUCKET_SERVER_URL}/rest/api/1.0`;
const BEARER_TOKEN = {
  reqheaders: { authorization: `Bearer ${BITBUCKET_TOKEN}` },
};

const autoMergeDescription = '...\n\n🚦 **Automerge**: Enabled.\n\n...';
const manualMergeDescription =
  '...\n\n🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.\n\n...';

afterEach(() => {
  if (!nock.isDone()) {
    throw new Error(
      `Not all nock interceptors were used: ${JSON.stringify(
        nock.pendingMocks()
      )}`
    );
  }
  nock.cleanAll();
});

describe('isAutomerging', () => {
  it('is automerging', () => {
    const pr = {
      description: autoMergeDescription,
      // omitted attributes...
    };

    const { isAutomerging } = bot;

    expect(isAutomerging(pr)).toBe(true);
  });

  it('is not automerging', () => {
    const pr = {
      description: manualMergeDescription,
      // omitted attributes...
    };

    const { isAutomerging } = bot;

    expect(isAutomerging(pr)).toBe(false);
  });

  it('handles missing description', () => {
    const pr = {
      // no description
    };

    const { isAutomerging } = bot;

    expect(isAutomerging(pr)).toBe(false);
  });
});

describe('getAllPullRequests', () => {
  const pullRequestsEndpoint = `projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests`;

  it('gets pull-requests from specific project/repo', async () => {
    nock(API_BASE_URL, BEARER_TOKEN)
      .get(`/${pullRequestsEndpoint}`)
      .query({ state: 'OPEN', start: 0, limit: 100 })
      .reply(200, {
        values: [
          {
            id: 1,
            description: autoMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/1`,
                },
              ],
            },
          },
          {
            id: 2,
            description: manualMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/2`,
                },
              ],
            },
          },
          {
            id: 3,
            description: autoMergeDescription,
            author: {
              user: {
                name: 'other-user',
              },
            },
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/3`,
                },
              ],
            },
          },
          {
            id: 4,
            description: autoMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/4`,
                },
              ],
            },
          },
        ],
        isLastPage: true,
      });

    const { getAllPullRequests } = bot;

    const pullRequests = await getAllPullRequests();

    expect(pullRequests).toHaveLength(2);
    expect(pullRequests[0]).toEqual({
      project: BITBUCKET_PROJECT,
      repo: BITBUCKET_REPO,
      id: 1,
      href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/1`,
    });
    expect(pullRequests[1]).toEqual({
      project: BITBUCKET_PROJECT,
      repo: BITBUCKET_REPO,
      id: 4,
      href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/4`,
    });
  });

  it('gets pull-requests with pagination', async () => {
    nock(API_BASE_URL, BEARER_TOKEN)
      .get(`/${pullRequestsEndpoint}`)
      .query({ state: 'OPEN', start: 0, limit: 100 })
      .reply(200, {
        values: [
          {
            id: 1,
            description: autoMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/1`,
                },
              ],
            },
          },
        ],
        isLastPage: false,
        nextPageStart: 1,
      });

    nock(API_BASE_URL, BEARER_TOKEN)
      .get(`/${pullRequestsEndpoint}`)
      .query({ state: 'OPEN', start: 1, limit: 100 })
      .reply(200, {
        values: [
          {
            id: 2,
            description: autoMergeDescription,
            author: {
              user: {
                name: RENOVATE_BOT_USER,
              },
            },
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/2`,
                },
              ],
            },
          },
        ],
        isLastPage: true,
      });

    const { getAllPullRequests } = bot;

    const pullRequests = await getAllPullRequests();

    expect(pullRequests).toHaveLength(2);
    expect(pullRequests[0].id).toBe(1);
    expect(pullRequests[1].id).toBe(2);
  });

  it('gets no pull-requests', async () => {
    nock(API_BASE_URL, BEARER_TOKEN)
      .get(`/${pullRequestsEndpoint}`)
      .query({ state: 'OPEN', start: 0, limit: 100 })
      .reply(200, {
        values: [],
        isLastPage: true,
      });

    const { getAllPullRequests } = bot;

    const pullRequests = await getAllPullRequests();

    expect(pullRequests).toHaveLength(0);
  });
});

describe('approvePullRequest', () => {
  it('approves', async () => {
    const prInfo = {
      project: BITBUCKET_PROJECT,
      repo: BITBUCKET_REPO,
      id: 1,
    };

    nock(API_BASE_URL, BEARER_TOKEN)
      .post(
        `/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/1/approve`
      )
      .reply(200, {
        approved: true,
      });

    const { approvePullRequest } = bot;

    const response = await approvePullRequest(prInfo);

    expect(response.statusCode).toBe(200);
  });

  it('is already approved', async () => {
    const prInfo = {
      project: BITBUCKET_PROJECT,
      repo: BITBUCKET_REPO,
      id: 2,
    };

    nock(API_BASE_URL, BEARER_TOKEN)
      .post(
        `/projects/${BITBUCKET_PROJECT}/repos/${BITBUCKET_REPO}/pull-requests/2/approve`
      )
      .reply(409, {
        errors: [
          {
            message: 'You have already approved this pull request.',
          },
        ],
      });

    const { approvePullRequest } = bot;

    const response = await approvePullRequest(prInfo);

    expect(response.statusCode).toBe(409);
  });
});

const nock = require('nock');

const BITBUCKET_SERVER_URL = 'https://bitbucket.mycompany.com';
const BITBUCKET_TOKEN = 'test-token-123';
const BITBUCKET_PROJECT = 'MYPROJ';
const RENOVATE_BOT_USER = 'renovate-bot';

process.env = Object.assign(process.env, {
  BITBUCKET_SERVER_URL,
  BITBUCKET_TOKEN,
  BITBUCKET_PROJECT,
  RENOVATE_BOT_USER,
});

const bot = require('./index');

const API_BASE_URL = `${BITBUCKET_SERVER_URL}/rest/api/1.0`;

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

    expect(bot.isAutomerging(pr)).toBe(true);
  });

  it('is not automerging', () => {
    const pr = {
      description: manualMergeDescription,
      // omitted attributes...
    };

    expect(bot.isAutomerging(pr)).toBe(false);
  });

  it('handles missing description', () => {
    const pr = {};

    expect(bot.isAutomerging(pr)).toBe(false);
  });
});

describe('getAllRepositories', () => {
  it('gets repositories successfully', async () => {
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos`)
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          { slug: 'repo1', name: 'Repository 1' },
          { slug: 'repo2', name: 'Repository 2' },
        ],
      });

    const repositories = await bot.getAllRepositories();

    expect(repositories).toHaveLength(2);
    expect(repositories[0].slug).toBe('repo1');
    expect(repositories[1].slug).toBe('repo2');
  });

  it('handles empty repository list', async () => {
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos`)
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [],
      });

    const repositories = await bot.getAllRepositories();

    expect(repositories).toHaveLength(0);
  });
});

describe('getPullRequestsForRepo', () => {
  const repoSlug = 'test-repo';

  it('gets automerge pull-requests from renovate bot', async () => {
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/${repoSlug}/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
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
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${repoSlug}/pull-requests/1`,
                },
              ],
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
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${repoSlug}/pull-requests/2`,
                },
              ],
            },
          },
          {
            id: 3,
            title: 'Different user PR',
            description: autoMergeDescription,
            author: {
              user: {
                name: 'other-user',
              },
            },
            links: {
              self: [
                {
                  href: `${API_BASE_URL}/projects/${BITBUCKET_PROJECT}/repos/${repoSlug}/pull-requests/3`,
                },
              ],
            },
          },
        ],
      });

    const pullRequests = await bot.getPullRequestsForRepo(
      BITBUCKET_PROJECT,
      repoSlug
    );

    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0].id).toBe(1);
    expect(pullRequests[0].projectKey).toBe(BITBUCKET_PROJECT);
    expect(pullRequests[0].repoSlug).toBe(repoSlug);
  });

  it('handles no pull requests', async () => {
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/${repoSlug}/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [],
      });

    const pullRequests = await bot.getPullRequestsForRepo(
      BITBUCKET_PROJECT,
      repoSlug
    );

    expect(pullRequests).toHaveLength(0);
  });

  it('handles API errors gracefully', async () => {
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/${repoSlug}/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(500, { error: 'Internal server error' });

    const pullRequests = await bot.getPullRequestsForRepo(
      BITBUCKET_PROJECT,
      repoSlug
    );

    expect(pullRequests).toHaveLength(0);
  });
});

describe('getPullRequests', () => {
  it('gets pull requests from multiple repositories', async () => {
    // Mock repositories endpoint
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos`)
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          { slug: 'repo1', name: 'Repository 1' },
          { slug: 'repo2', name: 'Repository 2' },
        ],
      });

    // Mock PRs for repo1
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/repo1/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 1,
            title: 'Update dependency in repo1',
            description: autoMergeDescription,
            author: { user: { name: RENOVATE_BOT_USER } },
            links: { self: [{ href: 'test-link-1' }] },
          },
        ],
      });

    // Mock PRs for repo2
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/repo2/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 2,
            title: 'Update dependency in repo2',
            description: autoMergeDescription,
            author: { user: { name: RENOVATE_BOT_USER } },
            links: { self: [{ href: 'test-link-2' }] },
          },
        ],
      });

    const pullRequests = await bot.getPullRequests();

    expect(pullRequests).toHaveLength(2);
    expect(pullRequests[0].id).toBe(1);
    expect(pullRequests[0].repoSlug).toBe('repo1');
    expect(pullRequests[1].id).toBe(2);
    expect(pullRequests[1].repoSlug).toBe('repo2');
  });
});

describe('approvePullRequest', () => {
  it('approves successfully', async () => {
    const pr = {
      id: 1,
      projectKey: BITBUCKET_PROJECT,
      repoSlug: 'test-repo',
    };

    nock(API_BASE_URL)
      .put(
        `/projects/${BITBUCKET_PROJECT}/repos/test-repo/pull-requests/1/participants/${RENOVATE_BOT_USER}`
      )
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        user: { name: RENOVATE_BOT_USER },
        role: 'REVIEWER',
        approved: true,
        status: 'APPROVED',
      });

    const response = await bot.approvePullRequest(pr);

    expect(response.statusCode).toBe(200);
  });

  it('handles already approved', async () => {
    const pr = {
      id: 2,
      projectKey: BITBUCKET_PROJECT,
      repoSlug: 'test-repo',
    };

    nock(API_BASE_URL)
      .put(
        `/projects/${BITBUCKET_PROJECT}/repos/test-repo/pull-requests/2/participants/${RENOVATE_BOT_USER}`
      )
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(409, {
        errors: [
          {
            message: 'You have already approved this pull request.',
          },
        ],
      });

    const response = await bot.approvePullRequest(pr);

    expect(response.statusCode).toBe(409);
  });
});

describe('main with dry run', () => {
  const originalEnv = process.env.DRY_RUN;

  beforeEach(() => {
    // Clear DRY_RUN before each test
    delete process.env.DRY_RUN;
  });

  afterEach(() => {
    // Restore original value
    if (originalEnv !== undefined) {
      process.env.DRY_RUN = originalEnv;
    } else {
      delete process.env.DRY_RUN;
    }
  });

  it('runs in dry run mode when DRY_RUN=true', async () => {
    // Set dry run mode
    process.env.DRY_RUN = 'true';

    // Mock repositories endpoint
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos`)
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [{ slug: 'test-repo', name: 'Test Repository' }],
      });

    // Mock PRs endpoint
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/test-repo/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 1,
            title: 'Update dependency',
            description: autoMergeDescription,
            author: { user: { name: RENOVATE_BOT_USER } },
            links: { self: [{ href: 'test-link' }] },
          },
        ],
      });

    // No approval endpoint should be called in dry run mode
    // If it gets called, the test will fail due to nock not being satisfied

    // Spy on approvePullRequest to ensure it's not called
    const approveSpy = jest.spyOn(bot, 'approvePullRequest');

    await bot.main();

    // Verify that approvePullRequest was never called
    expect(approveSpy).not.toHaveBeenCalled();

    approveSpy.mockRestore();
  });

  it('runs normally when DRY_RUN is not set', async () => {
    // Don't set DRY_RUN (should default to normal mode)

    // Mock repositories endpoint
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos`)
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [{ slug: 'test-repo', name: 'Test Repository' }],
      });

    // Mock PRs endpoint
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/test-repo/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 1,
            title: 'Update dependency',
            description: autoMergeDescription,
            author: { user: { name: RENOVATE_BOT_USER } },
            links: { self: [{ href: 'test-link' }] },
          },
        ],
      });

    // Mock approval endpoint - this should be called in normal mode
    nock(API_BASE_URL)
      .put(
        `/projects/${BITBUCKET_PROJECT}/repos/test-repo/pull-requests/1/participants/${RENOVATE_BOT_USER}`
      )
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        user: { name: RENOVATE_BOT_USER },
        role: 'REVIEWER',
        approved: true,
        status: 'APPROVED',
      });

    await bot.main();

    // Test passes if no nock errors are thrown (approval endpoint was called)
    expect(true).toBe(true); // Explicit assertion for jest/expect-expect rule
  });

  it('runs normally when DRY_RUN=false', async () => {
    // Set DRY_RUN to false
    process.env.DRY_RUN = 'false';

    // Mock repositories endpoint
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos`)
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [{ slug: 'test-repo', name: 'Test Repository' }],
      });

    // Mock PRs endpoint
    nock(API_BASE_URL)
      .get(`/projects/${BITBUCKET_PROJECT}/repos/test-repo/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        values: [
          {
            id: 1,
            title: 'Update dependency',
            description: autoMergeDescription,
            author: { user: { name: RENOVATE_BOT_USER } },
            links: { self: [{ href: 'test-link' }] },
          },
        ],
      });

    // Mock approval endpoint - this should be called in normal mode
    nock(API_BASE_URL)
      .put(
        `/projects/${BITBUCKET_PROJECT}/repos/test-repo/pull-requests/1/participants/${RENOVATE_BOT_USER}`
      )
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(200, {
        user: { name: RENOVATE_BOT_USER },
        role: 'REVIEWER',
        approved: true,
        status: 'APPROVED',
      });

    await bot.main();

    // Test passes if no nock errors are thrown (approval endpoint was called)
    expect(true).toBe(true); // Explicit assertion for jest/expect-expect rule
  });
});

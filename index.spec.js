const nock = require('nock');

// Constants for test setup
const BITBUCKET_SERVER_URL = 'https://bitbucket.mycompany.com';
const BITBUCKET_TOKEN = 'test-token-123';
const BITBUCKET_PROJECTS = 'PROJ1,PROJ2';
const RENOVATE_BOT_USER = 'renovate-bot';
const PR_AUTHOR_USER = 'pr-author-user';
const API_BASE_URL = `${BITBUCKET_SERVER_URL}/rest/api/1.0`;

// Test helper constants
const autoMergeDescription = '...\n\n🚦 **Automerge**: Enabled.\n\n...';
const manualMergeDescription =
  '...\n\n🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.\n\n...';

// Set up static environment variables that rarely change between tests
function setupStaticEnvironment() {
  process.env.BITBUCKET_SERVER_URL = BITBUCKET_SERVER_URL;
  process.env.BITBUCKET_TOKEN = BITBUCKET_TOKEN;
}

// Set up test-specific environment variables
function setupTestEnvironment() {
  process.env.BITBUCKET_PROJECTS = BITBUCKET_PROJECTS;
  process.env.RENOVATE_BOT_USER = RENOVATE_BOT_USER;
  process.env.PR_AUTHOR_USER = PR_AUTHOR_USER;
}

function clearEnvironment() {
  delete process.env.BITBUCKET_SERVER_URL;
  delete process.env.BITBUCKET_TOKEN;
  delete process.env.BITBUCKET_PROJECTS;
  delete process.env.RENOVATE_BOT_USER;
  delete process.env.PR_AUTHOR_USER;
  delete process.env.DRY_RUN;
}

function getBotInstance() {
  // Reset modules to get a fresh instance with current environment
  jest.resetModules();
  // eslint-disable-next-line global-require
  return require('./index');
}

function mockProjects(projects = []) {
  return nock(API_BASE_URL)
    .get('/projects')
    .query({ limit: 1000 })
    .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
    .reply(200, { values: projects });
}

function mockRepositories(projectKey, repositories = []) {
  return nock(API_BASE_URL)
    .get(`/projects/${projectKey}/repos`)
    .query({ limit: 1000 })
    .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
    .reply(200, { values: repositories });
}

function mockPullRequests(projectKey, repoSlug, pullRequests = []) {
  return nock(API_BASE_URL)
    .get(`/projects/${projectKey}/repos/${repoSlug}/pull-requests`)
    .query({ state: 'OPEN', limit: 1000 })
    .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
    .reply(200, { values: pullRequests });
}

function mockApprovePR(
  projectKey,
  repoSlug,
  prId,
  statusCode = 200,
  approverUser = RENOVATE_BOT_USER
) {
  return nock(API_BASE_URL)
    .put(
      `/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}/participants/${approverUser}`
    )
    .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
    .reply(statusCode, {});
}

// Clean up nocks after each test
afterEach(() => {
  if (!nock.isDone()) {
    // Uncomment this line when debugging failing tests
    // console.log('Pending mocks:', nock.pendingMocks());
    nock.cleanAll();
    throw new Error(
      `Not all nock interceptors were used: ${JSON.stringify(
        nock.pendingMocks()
      )}`
    );
  }
  nock.cleanAll();
});

// Set up static environment before all tests
beforeAll(() => {
  setupStaticEnvironment();
});

// Clean up all environment variables after all tests
afterAll(() => {
  clearEnvironment();
});

// Set up test-specific environment before each test
beforeEach(() => {
  setupTestEnvironment();
});

describe('isAutomerging', () => {
  it('is automerging', () => {
    const bot = getBotInstance();
    const pr = {
      description: autoMergeDescription,
    };

    expect(bot.isAutomerging(pr)).toBe(true);
  });

  it('is not automerging', () => {
    const bot = getBotInstance();
    const pr = {
      description: manualMergeDescription,
    };

    expect(bot.isAutomerging(pr)).toBe(false);
  });

  it('handles missing description', () => {
    const bot = getBotInstance();
    const pr = {};

    expect(bot.isAutomerging(pr)).toBe(false);
  });
});

describe('getProjectKeys', () => {
  it('returns configured projects when BITBUCKET_PROJECTS is set', async () => {
    // Ensure BITBUCKET_PROJECTS is set to the default test value
    process.env.BITBUCKET_PROJECTS = BITBUCKET_PROJECTS;

    const bot = getBotInstance();
    const projectKeys = await bot.getProjectKeys();

    expect(projectKeys).toEqual(['PROJ1', 'PROJ2']);
  });

  it('autodiscovers projects when BITBUCKET_PROJECTS is not set', async () => {
    // Remove BITBUCKET_PROJECTS for this specific test
    delete process.env.BITBUCKET_PROJECTS;

    // Mock projects endpoint for autodiscovery
    mockProjects([
      { key: 'PROJ1', name: 'Project 1' },
      { key: 'PROJ2', name: 'Project 2' },
    ]);

    const bot = getBotInstance();
    const projectKeys = await bot.getProjectKeys();

    expect(projectKeys).toEqual(['PROJ1', 'PROJ2']);
  });

  it('autodiscovers when BITBUCKET_PROJECTS is empty', async () => {
    // Set empty projects for this specific test
    process.env.BITBUCKET_PROJECTS = '';

    // Mock projects endpoint for autodiscovery
    mockProjects([
      { key: 'PROJ1', name: 'Project 1' },
      { key: 'PROJ2', name: 'Project 2' },
    ]);

    const bot = getBotInstance();
    const projectKeys = await bot.getProjectKeys();

    expect(projectKeys).toEqual(['PROJ1', 'PROJ2']);
  });

  it('throws error when no projects are accessible during autodiscovery', async () => {
    // Remove BITBUCKET_PROJECTS for this specific test
    delete process.env.BITBUCKET_PROJECTS;

    // Mock empty projects array for autodiscovery
    mockProjects([]);

    const bot = getBotInstance();
    await expect(bot.getProjectKeys()).rejects.toThrow(
      'No accessible projects found'
    );
  });
});

describe('getAllProjects', () => {
  it('gets projects successfully', async () => {
    mockProjects([
      { key: 'PROJ1', name: 'Project 1' },
      { key: 'PROJ2', name: 'Project 2' },
      { key: 'PROJ3', name: 'Project 3' },
    ]);

    const bot = getBotInstance();
    const projects = await bot.getAllProjects();

    expect(projects).toHaveLength(3);
    expect(projects[0].key).toBe('PROJ1');
    expect(projects[1].key).toBe('PROJ2');
    expect(projects[2].key).toBe('PROJ3');
  });

  it('handles API errors', async () => {
    nock(API_BASE_URL)
      .get('/projects')
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(500, { error: 'Internal server error' });

    const bot = getBotInstance();
    await expect(bot.getAllProjects()).rejects.toThrow();
  });
});

describe('getAllRepositories', () => {
  it('gets repositories from provided project keys', async () => {
    // Mock repositories for PROJ1
    mockRepositories('PROJ1', [
      { slug: 'repo1', name: 'Repository 1' },
      { slug: 'repo2', name: 'Repository 2' },
    ]);

    // Mock repositories for PROJ2
    mockRepositories('PROJ2', [{ slug: 'repo3', name: 'Repository 3' }]);

    const bot = getBotInstance();
    const repositories = await bot.getAllRepositories(['PROJ1', 'PROJ2']);

    expect(repositories).toHaveLength(3);
    expect(repositories[0].slug).toBe('repo1');
    expect(repositories[0].projectKey).toBe('PROJ1');
    expect(repositories[1].slug).toBe('repo2');
    expect(repositories[1].projectKey).toBe('PROJ1');
    expect(repositories[2].slug).toBe('repo3');
    expect(repositories[2].projectKey).toBe('PROJ2');
  });

  it('handles empty repository list', async () => {
    // Mock empty repositories for PROJ1
    mockRepositories('PROJ1', []);

    // Mock empty repositories for PROJ2
    mockRepositories('PROJ2', []);

    const bot = getBotInstance();
    const repositories = await bot.getAllRepositories(['PROJ1', 'PROJ2']);

    expect(repositories).toHaveLength(0);
  });

  it('throws error when no project keys are provided', async () => {
    const bot = getBotInstance();
    await expect(bot.getAllRepositories()).rejects.toThrow(
      'Project keys must be provided'
    );

    await expect(bot.getAllRepositories([])).rejects.toThrow(
      'Project keys must be provided'
    );
  });

  it('continues with other projects when one project fails', async () => {
    // Mock failing repositories for PROJ1
    nock(API_BASE_URL)
      .get('/projects/PROJ1/repos')
      .query({ limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(500, 'Internal Server Error');

    // Mock successful repositories for PROJ2
    mockRepositories('PROJ2', [{ slug: 'repo3', name: 'Repository 3' }]);

    const bot = getBotInstance();
    const repositories = await bot.getAllRepositories(['PROJ1', 'PROJ2']);

    expect(repositories).toHaveLength(1);
    expect(repositories[0].slug).toBe('repo3');
    expect(repositories[0].projectKey).toBe('PROJ2');
  });
});

describe('getPullRequestsForRepo', () => {
  const projectKey = 'MYPROJ';
  const repoSlug = 'test-repo';

  it('gets automerge pull-requests from renovate bot', async () => {
    mockPullRequests(projectKey, repoSlug, [
      {
        id: 1,
        title: 'Update dependency',
        description: autoMergeDescription,
        author: {
          user: {
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/${projectKey}/repos/${repoSlug}/pull-requests/1`,
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
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/${projectKey}/repos/${repoSlug}/pull-requests/2`,
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
              href: `${API_BASE_URL}/projects/${projectKey}/repos/${repoSlug}/pull-requests/3`,
            },
          ],
        },
      },
    ]);

    const bot = getBotInstance();
    const pullRequests = await bot.getPullRequestsForRepo(projectKey, repoSlug);

    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0].id).toBe(1);
  });

  it('handles no pull requests', async () => {
    mockPullRequests(projectKey, repoSlug, []);

    const bot = getBotInstance();
    const pullRequests = await bot.getPullRequestsForRepo(projectKey, repoSlug);

    expect(pullRequests).toHaveLength(0);
  });

  it('handles API errors gracefully', async () => {
    nock(API_BASE_URL)
      .get(`/projects/${projectKey}/repos/${repoSlug}/pull-requests`)
      .query({ state: 'OPEN', limit: 1000 })
      .matchHeader('Authorization', `Bearer ${BITBUCKET_TOKEN}`)
      .reply(500, 'Internal Server Error');

    const bot = getBotInstance();
    const pullRequests = await bot.getPullRequestsForRepo(projectKey, repoSlug);

    expect(pullRequests).toHaveLength(0);
  });
});

describe('getPullRequests', () => {
  it('gets pull requests from multiple repositories across configured projects', async () => {
    // Ensure BITBUCKET_PROJECTS is set
    process.env.BITBUCKET_PROJECTS = BITBUCKET_PROJECTS;

    // Mock repositories for PROJ1
    mockRepositories('PROJ1', [{ slug: 'test-repo', name: 'Test Repository' }]);

    // Mock repositories for PROJ2
    mockRepositories('PROJ2', []);

    // Mock pull requests for PROJ1/test-repo
    mockPullRequests('PROJ1', 'test-repo', [
      {
        id: 1,
        title: 'Update dependency',
        description: autoMergeDescription,
        author: {
          user: {
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/PROJ1/repos/test-repo/pull-requests/1`,
            },
          ],
        },
      },
    ]);

    const bot = getBotInstance();
    const pullRequests = await bot.getPullRequests();

    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0].id).toBe(1);
    expect(pullRequests[0].projectKey).toBe('PROJ1');
    expect(pullRequests[0].repoSlug).toBe('test-repo');
  });

  it('gets pull requests from autodiscovered projects', async () => {
    // Remove BITBUCKET_PROJECTS for this specific test
    delete process.env.BITBUCKET_PROJECTS;

    // Mock projects endpoint for autodiscovery
    mockProjects([
      { key: 'AUTO1', name: 'Auto Project 1' },
      { key: 'AUTO2', name: 'Auto Project 2' },
    ]);

    // Mock repositories for AUTO1
    mockRepositories('AUTO1', [
      { slug: 'auto-repo1', name: 'Auto Repository 1' },
    ]);

    // Mock repositories for AUTO2
    mockRepositories('AUTO2', [
      { slug: 'auto-repo2', name: 'Auto Repository 2' },
    ]);

    // Mock pull requests for AUTO1/auto-repo1
    mockPullRequests('AUTO1', 'auto-repo1', [
      {
        id: 1,
        title: 'Update dependency',
        description: autoMergeDescription,
        author: {
          user: {
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/AUTO1/repos/auto-repo1/pull-requests/1`,
            },
          ],
        },
      },
    ]);

    // Mock pull requests for AUTO2/auto-repo2
    mockPullRequests('AUTO2', 'auto-repo2', [
      {
        id: 2,
        title: 'Update dependency',
        description: autoMergeDescription,
        author: {
          user: {
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/AUTO2/repos/auto-repo2/pull-requests/2`,
            },
          ],
        },
      },
    ]);

    const bot = getBotInstance();
    const pullRequests = await bot.getPullRequests();

    expect(pullRequests).toHaveLength(2);
    expect(pullRequests[0].id).toBe(1);
    expect(pullRequests[0].projectKey).toBe('AUTO1');
    expect(pullRequests[0].repoSlug).toBe('auto-repo1');
    expect(pullRequests[1].id).toBe(2);
    expect(pullRequests[1].projectKey).toBe('AUTO2');
    expect(pullRequests[1].repoSlug).toBe('auto-repo2');
  });
});

describe('approvePullRequest', () => {
  it('approves successfully', async () => {
    const projectKey = 'PROJ1';
    const repoSlug = 'test-repo';
    const pr = {
      id: 1,
      projectKey,
      repoSlug,
      title: 'Update dependency',
    };

    mockApprovePR(projectKey, repoSlug, pr.id);

    const bot = getBotInstance();
    const result = await bot.approvePullRequest(pr);
    expect(result.statusCode).toBe(200);
  });

  it('handles already approved', async () => {
    const projectKey = 'PROJ1';
    const repoSlug = 'test-repo';
    const pr = {
      id: 1,
      projectKey,
      repoSlug,
      title: 'Update dependency',
    };

    mockApprovePR(projectKey, repoSlug, pr.id, 200);

    const bot = getBotInstance();
    const result = await bot.approvePullRequest(pr);
    expect(result.statusCode).toBe(200);
  });

  it('uses RENOVATE_BOT_USER for approval', async () => {
    const projectKey = 'PROJ1';
    const repoSlug = 'test-repo';
    const pr = {
      id: 1,
      projectKey,
      repoSlug,
      title: 'Update dependency',
    };

    // Explicitly use RENOVATE_BOT_USER
    mockApprovePR(projectKey, repoSlug, pr.id, 200, RENOVATE_BOT_USER);

    const bot = getBotInstance();
    const result = await bot.approvePullRequest(pr);
    expect(result.statusCode).toBe(200);
  });
});

describe('main with dry run', () => {
  it('runs in dry run mode when DRY_RUN=true', async () => {
    // Set DRY_RUN for this specific test
    process.env.DRY_RUN = 'true';

    // Mock repositories for PROJ1
    mockRepositories('PROJ1', [{ slug: 'test-repo', name: 'Test Repository' }]);

    // Mock repositories for PROJ2
    mockRepositories('PROJ2', []);

    // Mock pull requests for PROJ1/test-repo
    mockPullRequests('PROJ1', 'test-repo', [
      {
        id: 1,
        title: 'Update dependency',
        description: autoMergeDescription,
        author: {
          user: {
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/PROJ1/repos/test-repo/pull-requests/1`,
            },
          ],
        },
      },
    ]);

    // No approval mock needed since it's dry-run mode

    const bot = getBotInstance();
    await bot.main();
    // In dry run mode, we don't expect any PR approvals
    expect(nock.isDone()).toBe(true);
  });

  it('runs normally when DRY_RUN is not set', async () => {
    // Ensure DRY_RUN is not set for this specific test
    delete process.env.DRY_RUN;

    // Mock repositories for PROJ1
    mockRepositories('PROJ1', [{ slug: 'test-repo', name: 'Test Repository' }]);

    // Mock repositories for PROJ2
    mockRepositories('PROJ2', []);

    // Mock pull requests for PROJ1/test-repo
    mockPullRequests('PROJ1', 'test-repo', [
      {
        id: 1,
        title: 'Update dependency',
        description: autoMergeDescription,
        author: {
          user: {
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/PROJ1/repos/test-repo/pull-requests/1`,
            },
          ],
        },
      },
    ]);

    // Mock PR approval
    mockApprovePR('PROJ1', 'test-repo', 1);

    const bot = getBotInstance();
    await bot.main();
    // We expect all mocks to be used, including the PR approval
    expect(nock.isDone()).toBe(true);
  });

  it('runs normally when DRY_RUN=false', async () => {
    // Set DRY_RUN=false for this specific test
    process.env.DRY_RUN = 'false';

    // Mock repositories for PROJ1
    mockRepositories('PROJ1', [{ slug: 'test-repo', name: 'Test Repository' }]);

    // Mock repositories for PROJ2
    mockRepositories('PROJ2', []);

    // Mock pull requests for PROJ1/test-repo
    mockPullRequests('PROJ1', 'test-repo', [
      {
        id: 1,
        title: 'Update dependency',
        description: autoMergeDescription,
        author: {
          user: {
            name: PR_AUTHOR_USER,
          },
        },
        links: {
          self: [
            {
              href: `${API_BASE_URL}/projects/PROJ1/repos/test-repo/pull-requests/1`,
            },
          ],
        },
      },
    ]);

    // Mock PR approval
    mockApprovePR('PROJ1', 'test-repo', 1);

    const bot = getBotInstance();
    await bot.main();
    // We expect all mocks to be used, including the PR approval
    expect(nock.isDone()).toBe(true);
  });
});

describe('main validation', () => {
  beforeEach(() => {
    jest.spyOn(process, 'exit').mockImplementation(() => { });
    jest.spyOn(console, 'error').mockImplementation(() => { });
    // Clean up any hanging nocks
    nock.cleanAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Clean up any hanging nocks
    nock.cleanAll();
  });

  it('exits when PR_AUTHOR_USER is not set', async () => {
    // Explicitly delete the variable we're testing
    delete process.env.PR_AUTHOR_USER;

    // Mock exit function to prevent actual exit
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Mock process.exit');
    });

    const bot = getBotInstance();

    await expect(bot.main()).rejects.toThrow('Mock process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  }, 15000);

  it('exits when PR_AUTHOR_USER is the same as RENOVATE_BOT_USER', async () => {
    // Set up the specific test condition
    process.env.PR_AUTHOR_USER = RENOVATE_BOT_USER;

    // Mock exit function to prevent actual exit
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Mock process.exit');
    });

    const bot = getBotInstance();

    // Skip the actual processing by mocking getPullRequests
    jest.spyOn(bot, 'getPullRequests').mockResolvedValue([]);

    await expect(bot.main()).rejects.toThrow('Mock process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  }, 20000);

  it('continues when PR_AUTHOR_USER is different from RENOVATE_BOT_USER', async () => {
    // Setup a specific environment with valid values
    process.env.PR_AUTHOR_USER = PR_AUTHOR_USER;

    // Mock exit to ensure it's not called
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { });

    const bot = getBotInstance();

    // Skip the actual API calls by mocking getPullRequests
    jest.spyOn(bot, 'getPullRequests').mockResolvedValue([]);

    await bot.main();

    expect(mockExit).not.toHaveBeenCalled();
    mockExit.mockRestore();
  }, 20000);
});

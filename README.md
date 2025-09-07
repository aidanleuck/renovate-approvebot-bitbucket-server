# renovate-approve-bot - Bitbucket Server Edition

A job to approve Pull Requests from [Renovate Bot](https://github.com/renovatebot/renovate) on Bitbucket Server. This enables you to require Pull Request approvals on your repository while also utilising Renovate's "automerge" feature.

For Bitbucket Cloud, see [renovatebot/renovate-approve-bot-bitbucket-cloud](https://github.com/renovatebot/renovate-approve-bot-bitbucket-cloud).
For GitHub, see [renovatebot/renovate-approve-bot](https://github.com/renovatebot/renovate-approve-bot).

## How it works

On each run, the bot will:

1. Get all open PRs from the Renovate Bot user (either from a specific project/repo or all accessible projects)
2. Filter out PRs where "automerge" is disabled
3. Approve the "automerge" PRs

## Usage

### Prerequisites

1. Create a Bitbucket Server account for the renovate-approve-bot and add it to your projects
2. Create a Personal Access Token or use username/password authentication
3. Grant appropriate permissions to the renovate-approve-bot account on your repositories

### Authentication Options

The bot supports two authentication methods:

#### Option 1: Personal Access Token (Recommended)

1. Create a Personal Access Token in Bitbucket Server with appropriate permissions
2. Set the `BITBUCKET_TOKEN` environment variable

#### Option 2: Username/Password

1. Use the username and password/app-password for the bot account
2. Set both `BITBUCKET_USERNAME` and `BITBUCKET_PASSWORD` environment variables

### Environment Variables

- `BITBUCKET_SERVER_URL`: Base URL of your Bitbucket Server instance (e.g., `https://bitbucket.mycompany.com`)
- `RENOVATE_BOT_USER`: Username of your Renovate Bot
- `BITBUCKET_TOKEN`: Personal Access Token (if using token authentication)
- `BITBUCKET_USERNAME`: Username for the bot account (if using username/password)
- `BITBUCKET_PASSWORD`: Password for the bot account (if using username/password)
- `BITBUCKET_PROJECT`: (Optional) Specific project key to search for PRs. If not set, searches all accessible projects
- `BITBUCKET_REPO`: (Optional) Specific repository slug to search for PRs. Requires `BITBUCKET_PROJECT` to be set

### Running the Bot

#### With Docker

```shell
docker run --rm \
  --env BITBUCKET_SERVER_URL=https://bitbucket.mycompany.com \
  --env BITBUCKET_TOKEN=your-token \
  --env RENOVATE_BOT_USER=renovate-bot \
  aidanleuck/renovate-approve-bot-bitbucket-server:latest
```

#### From Source

```shell
npm install --production
node ./index.js
```

### Specific Project/Repository Configuration

To limit the bot to a specific project and repository:

```shell
export BITBUCKET_SERVER_URL=https://bitbucket.mycompany.com
export BITBUCKET_TOKEN=your-token
export RENOVATE_BOT_USER=renovate-bot
export BITBUCKET_PROJECT=MYPROJ
export BITBUCKET_REPO=my-repo
node ./index.js
```

### All Projects Configuration

To search across all accessible projects (default behavior):

```shell
export BITBUCKET_SERVER_URL=https://bitbucket.mycompany.com
export BITBUCKET_TOKEN=your-token
export RENOVATE_BOT_USER=renovate-bot
# Do not set BITBUCKET_PROJECT or BITBUCKET_REPO
node ./index.js
```

## Scheduling

It's recommended to run this bot on a schedule, similar to how you run Renovate Bot. You can use:

- Cron jobs on Linux/Unix systems
- Jenkins scheduled builds
- CI/CD pipeline schedules
- Any other scheduling system available in your environment

Example cron job (runs every hour):

```bash
0 * * * * /usr/bin/docker run --rm --env-file /path/to/env-file aidanleuck/renovate-approve-bot-bitbucket-server:latest
```

## Development

### Install Dependencies

```shell
npm install
```

### Run Tests

```shell
npm test
```

### Lint Code

```shell
npm run lint
```

### Fix Linting Issues

```shell
npm run lint-fix
```

## Security / Disclosure

If you discover any important bug with `renovate-approve-bot-bitbucket-server` that may pose a security problem, please disclose it confidentially through the repository's security features or issues, so that it can be assessed and hopefully fixed prior to being exploited.
Please do not raise GitHub issues for security-related doubts or problems without proper consideration.

## License

ISC

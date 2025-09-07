# renovate-approve-bot - Bitbucket Server Edition

A job to approve Pull Requests from [Renovate Bot](https://github.com/renovatebot/renovate) on Bitbucket Server. This enables you to require Pull Request approvals on your repository while also utilising Renovate's "automerge" feature.

For Bitbucket Cloud, see [renovatebot/renovate-approve-bot-bitbucket-cloud](https://github.com/renovatebot/renovate-approve-bot-bitbucket-cloud).
For GitHub, see [renovatebot/renovate-approve-bot](https://github.com/renovatebot/renovate-approve-bot).

## How it works

On each run, the bot will:

1. Connect to your Bitbucket Server instance
2. Search for open PRs from the Renovate Bot user across projects/repositories
3. Filter out PRs where "automerge" is disabled
4. Approve the "automerge" PRs

## Usage

1. Create a Bitbucket Server account for the renovate-approve-bot and add it to your teams/projects
2. [Create a Personal Access Token](https://confluence.atlassian.com/bitbucketserver/personal-access-tokens-939515499.html) with appropriate permissions (at least Repository read and Pull request write)
3. Grant read access on your repositories/projects to the renovate-approve-bot account
4. Optionally, add the renovate-approve-bot account to the default reviewers if you require approval from default reviewers
5. Set the environment variables:
   - `BITBUCKET_URL`: Your Bitbucket Server URL (e.g., `https://bitbucket.company.com`)
   - `BITBUCKET_USERNAME`: Username associated with the renovate-approve-bot account
   - `BITBUCKET_TOKEN`: Personal Access Token created in step 2
   - `BITBUCKET_PROJECT_KEY`: (Optional) Specific project key to limit search scope. If not provided, searches all accessible projects
   - `RENOVATE_BOT_USER`: Username of your Renovate Bot
6. Run the bot (on a schedule similarly to Renovate Bot, e.g. as a [Cron](https://en.wikipedia.org/wiki/Cron) job):
   - With Docker:

     ```shell
     docker run --rm \
       --env BITBUCKET_URL \
       --env BITBUCKET_USERNAME \
       --env BITBUCKET_TOKEN \
       --env BITBUCKET_PROJECT_KEY \
       --env RENOVATE_BOT_USER \
       ghcr.io/aidanleuck/renovate-approve-bot-bitbucket-server:latest
     ```

   - From source:

     ```shell
     npm install --production
     node ./index.js
     ```

## Configuration

### Environment Variables

| Variable                | Required | Description                                                                              |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `BITBUCKET_URL`         | Yes      | Base URL of your Bitbucket Server instance (e.g., `https://bitbucket.company.com`)       |
| `BITBUCKET_USERNAME`    | Yes      | Username for the renovate-approve-bot account                                            |
| `BITBUCKET_TOKEN`       | Yes      | Personal Access Token with appropriate permissions                                       |
| `RENOVATE_BOT_USER`     | Yes      | Username of your Renovate Bot                                                            |
| `BITBUCKET_PROJECT_KEY` | No       | Specific project key to search within. If not provided, searches all accessible projects |

### Permissions Required

The Personal Access Token must have the following permissions:

- **Project**: Read (to list projects and repositories)
- **Repository**: Read (to access repository information)
- **Pull Request**: Write (to approve pull requests)

## CI/CD Pipeline Examples

### Jenkins Pipeline

```groovy
pipeline {
    agent any
    triggers {
        cron('H/30 * * * *') // Run every 30 minutes
    }
    environment {
        BITBUCKET_URL = 'https://bitbucket.company.com'
        BITBUCKET_USERNAME = 'renovate-approve-bot'
        BITBUCKET_TOKEN = credentials('renovate-approve-bot-token')
        RENOVATE_BOT_USER = 'renovate-bot'
    }
    stages {
        stage('Approve Renovate PRs') {
            steps {
                script {
                    docker.image('ghcr.io/aidanleuck/renovate-approve-bot-bitbucket-server:latest').run(
                        '--rm ' +
                        '-e BITBUCKET_URL ' +
                        '-e BITBUCKET_USERNAME ' +
                        '-e BITBUCKET_TOKEN ' +
                        '-e RENOVATE_BOT_USER'
                    )
                }
            }
        }
    }
}
```

### GitLab CI

```yaml
approve-renovate-prs:
  image: ghcr.io/aidanleuck/renovate-approve-bot-bitbucket-server:latest
  script:
    - node /opt/app/index.js
  variables:
    BITBUCKET_URL: 'https://bitbucket.company.com'
    BITBUCKET_USERNAME: 'renovate-approve-bot'
    RENOVATE_BOT_USER: 'renovate-bot'
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
```

### Docker Compose

```yaml
version: '3.8'
services:
  renovate-approve-bot:
    image: ghcr.io/aidanleuck/renovate-approve-bot-bitbucket-server:latest
    environment:
      - BITBUCKET_URL=https://bitbucket.company.com
      - BITBUCKET_USERNAME=renovate-approve-bot
      - BITBUCKET_TOKEN=${BITBUCKET_TOKEN}
      - RENOVATE_BOT_USER=renovate-bot
      - BITBUCKET_PROJECT_KEY=MYPROJECT
```

## Development

### Prerequisites

- Node.js 18.12.0 or higher
- npm 10.7.0 or higher

### Setup

```shell
git clone https://github.com/aidanleuck/renovate-approve-bot-bitbucket-server.git
cd renovate-approve-bot-bitbucket-server
npm install
```

### Testing

```shell
# Run all tests
npm test

# Run linting only
npm run lint

# Fix linting issues
npm run lint-fix

# Run tests only
npm run jest
```

### Environment Variables for Development

Create a `.env` file (do not commit this file):

```
BITBUCKET_URL=https://your-bitbucket-server.com
BITBUCKET_USERNAME=your-bot-username
BITBUCKET_TOKEN=your-personal-access-token
RENOVATE_BOT_USER=your-renovate-bot-username
BITBUCKET_PROJECT_KEY=YOUR_PROJECT_KEY
```

## Troubleshooting

### Common Issues

1. **Authentication Failed**: Ensure your Personal Access Token has the correct permissions and hasn't expired
2. **No PRs Found**: Check that the Renovate Bot username is correct and that there are open PRs with automerge enabled
3. **Permission Denied**: Verify that the bot account has read access to the projects/repositories
4. **Connection Refused**: Ensure the Bitbucket Server URL is correct and accessible from your environment

### Debug Logging

Set the log level to debug for more detailed output:

```javascript
const log = bunyan.createLogger({
  name: 'renovate-approve-bot-bitbucket-server',
  level: 'debug',
});
```

## Security / Disclosure

If you discover any important bug with `renovate-approve-bot-bitbucket-server` that may pose a security problem, please disclose it confidentially first, so that it can be assessed and hopefully fixed prior to being exploited.

## License

ISC License - see [LICENSE](LICENSE) file for details.

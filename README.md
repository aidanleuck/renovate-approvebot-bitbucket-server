# renovate-approve-bot - Bitbucket Server Edition

A job to approve Pull Requests from [Renovate Bot](https://github.com/renovatebot/renovate) on Bitbucket Server. This enables you to require Pull Request approvals on your repository while also utilising Renovate's "automerge" feature.

For Bitbucket Cloud, see [renovatebot/renovate-approve-bot-bitbucket-cloud](https://github.com/renovatebot/renovate-approve-bot-bitbucket-cloud).
For GitHub, see [renovatebot/renovate-approve-bot](https://github.com/renovatebot/renovate-approve-bot).

## How it works

On each run, the bot will:

1. Get all repositories in the specified Bitbucket Server projects
2. Get all open PRs from the Renovate Bot user in those repositories
3. Filter out PRs where "automerge" is disabled
4. Approve the "automerge" PRs

## Usage

1. Create a Bitbucket Server account for the renovate-approve-bot and add it to your projects (Recommended)
2. [Create a Personal Access Token](https://confluence.atlassian.com/bitbucketserver/personal-access-tokens-939515499.html) with `PROJECT_READ` and `REPO_WRITE` permissions
3. Grant the renovate-approve-bot account appropriate permissions on your repositories
4. Optionally, add the renovate-approve-bot account to the default reviewers if you require approval from default reviewers
5. Set the environment variables:
   - `BITBUCKET_SERVER_URL`: Base URL of your Bitbucket Server instance (e.g., `https://bitbucket.mycompany.com`)
   - `BITBUCKET_TOKEN`: Personal Access Token created in step 2
   - `BITBUCKET_PROJECTS`: Array of Bitbucket Server project keys where repositories will be searched (JSON array or comma-separated string)
   - `RENOVATE_BOT_USER`: Bitbucket Server username of your Renovate Bot
   - `DRY_RUN` (optional): Set to `true` to enable dry run mode, which will only log what would be approved without making actual API calls
6. Run the bot (on a schedule similarly to Renovate Bot, e.g. as a [Cron](https://en.wikipedia.org/wiki/Cron) job):
   - With Docker:

     ```shell
     docker run --rm \
       --env BITBUCKET_SERVER_URL \
       --env BITBUCKET_TOKEN \
       --env BITBUCKET_PROJECTS \
       --env RENOVATE_BOT_USER \
       --env DRY_RUN \
       ghcr.io/aidanleuck/renovate-approve-bot-bitbucket-server:latest
     ```

   - From source:

     ```shell
     npm install --production
     node ./index.js
     ```

## Configuration Example

Here's an example of how to set up the environment variables:

```bash
export BITBUCKET_SERVER_URL="https://bitbucket.mycompany.com"
export BITBUCKET_TOKEN="your-personal-access-token"
export BITBUCKET_PROJECTS='["PROJ1", "PROJ2"]'  # JSON array
# OR
export BITBUCKET_PROJECTS="PROJ1,PROJ2"         # Comma-separated
export RENOVATE_BOT_USER="renovate-bot"
```

The `BITBUCKET_PROJECTS` environment variable can be set as either:
- A JSON array: `'["PROJ1", "PROJ2", "PROJ3"]'`
- A comma-separated string: `"PROJ1,PROJ2,PROJ3"`

## Dry Run Mode

The bot supports a dry run mode where it will discover and log what PRs would be approved without actually making any approval API calls. This is useful for testing configuration or seeing what the bot would do before running it for real.

To enable dry run mode, set the `DRY_RUN` environment variable to `true`:

```bash
export DRY_RUN="true"
```

In dry run mode, the bot will:

- Still fetch repositories and pull requests from Bitbucket Server
- Log which PRs it would approve with the message "DRY RUN: Would approve PR: ..."
- **Not** make any actual approval API calls
- Log "DRY RUN MODE: No actual approvals will be made" at startup

Example dry run output:

```
{"level":30,"msg":"DRY RUN MODE: No actual approvals will be made"}
{"level":30,"msg":"Found 1 automerge PRs from renovate-bot"}
{"level":30,"msg":"DRY RUN: Would approve PR: MYPROJ/my-repo#123 - Update dependency foo to v1.2.3"}
```

## Kubernetes Example

Example to run renovate-approve-bot as a Kubernetes CronJob:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: renovate-approve-bot
spec:
  schedule: '0 * * * *' # Run every hour
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: renovate-approve-bot
              image: ghcr.io/aidanleuck/renovate-approve-bot-bitbucket-server:latest
              env:
                - name: BITBUCKET_SERVER_URL
                  value: 'https://bitbucket.mycompany.com'
                - name: BITBUCKET_TOKEN
                  valueFrom:
                    secretKeyRef:
                      name: renovate-approve-bot-secret
                      key: token
                - name: BITBUCKET_PROJECTS
                  value: '["PROJ1", "PROJ2"]'
                - name: RENOVATE_BOT_USER
                  value: 'renovate-bot'
          restartPolicy: OnFailure
```

## Jenkins Pipeline Example

Example to run renovate-approve-bot in a Jenkins pipeline:

```groovy
pipeline {
    agent any
    triggers {
        cron('H * * * *')  // Run every hour
    }
    environment {
        BITBUCKET_SERVER_URL = 'https://bitbucket.mycompany.com'
        BITBUCKET_TOKEN = credentials('renovate-approve-bot-token')
        BITBUCKET_PROJECTS = '["PROJ1", "PROJ2"]'
        RENOVATE_BOT_USER = 'renovate-bot'
    }
    stages {
        stage('Approve Renovate PRs') {
            steps {
                docker.image('ghcr.io/aidanleuck/renovate-approve-bot-bitbucket-server:latest').inside {
                    sh 'node /opt/app/index.js'
                }
            }
        }
    }
}
```

## Development

1. Clone the repository:

   ```bash
   git clone https://github.com/aidanleuck/renovate-approvebot-bitbucket-server.git
   cd renovate-approvebot-bitbucket-server
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run tests:

   ```bash
   npm test
   ```

4. Run linting:

   ```bash
   npm run lint
   ```

5. Format code:
   ```bash
   npm run prettier-fix
   ```

## API Differences from Bitbucket Cloud

This implementation uses the Bitbucket Server REST API which differs from Bitbucket Cloud:

- **Authentication**: Uses Personal Access Tokens instead of username/password
- **Base URL**: Uses your server instance URL + `/rest/api/1.0/` instead of `api.bitbucket.org/2.0/`
- **Project Structure**: Uses project keys and repository slugs instead of workspaces, with configurable project selection
- **API Endpoints**: Different endpoint structure for repositories and pull requests

## Security / Disclosure

If you discover any important bug with `renovate-approve-bot-bitbucket-server` that may pose a security problem, please disclose it confidentially first, so that it can be assessed and hopefully fixed prior to being exploited.
Please do not raise GitHub issues for security-related doubts or problems.

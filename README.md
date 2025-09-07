# renovate-approve-bot - Bitbucket Server Edition

A job to approve Pull Requests from [Renovate Bot](https://github.com/renovatebot/renovate) on Bitbucket Server. This enables you to require Pull Request approvals on your repository while also utilising Renovate's "automerge" feature.

For Bitbucket Cloud, see [renovatebot/renovate-approve-bot-bitbucket-cloud](https://github.com/renovatebot/renovate-approve-bot-bitbucket-cloud).
For GitHub, see [renovatebot/renovate-approve-bot](https://github.com/renovatebot/renovate-approve-bot).

## How it works

On each run, the bot will:

1. Get all repositories in the specified Bitbucket Server projects
2. Get all open PRs from the `PR_AUTHOR_USER` in those repositories
3. Filter out PRs where "automerge" is disabled
4. Approve the "automerge" PRs

## Usage

1. Create a Bitbucket Server account for the renovate-approve-bot and add it to your projects (Recommended)
2. [Create a Personal Access Token](https://confluence.atlassian.com/bitbucketserver/personal-access-tokens-939515499.html) with `PROJECT_READ` permissions
3. Grant the renovate-approve-bot account appropriate permissions on your repositories
4. Optionally, add the renovate-approve-bot account to the default reviewers if you require approval from default reviewers
5. Set the environment variables:
   - `BITBUCKET_SERVER_URL`: Base URL of your Bitbucket Server instance (e.g., `https://bitbucket.mycompany.com`)
   - `BITBUCKET_TOKEN`: Personal Access Token created in step 2
   - `BITBUCKET_PROJECTS` (optional): Array of Bitbucket Server project keys where repositories will be searched (JSON array or comma-separated string). If not provided or empty, all projects accessible by the token will be autodiscovered
   - `RENOVATE_BOT_USER`: Bitbucket Server username of your Renovate Bot this is the user this bot will run under and approve PRs created by Renovate.
   - `PR_AUTHOR_USER` (required): Bitbucket Server username that opens the PRs to be approved. Must be different from `RENOVATE_BOT_USER` because Bitbucket Server does not allow users to approve their own PRs. This should be the same user that Renovate is configured to use when opening PRs (the Renovate PR author).
   - `DRY_RUN` (optional): Set to `true` to enable dry run mode, which will only log what would be approved without making actual API calls
6. Run the bot (on a schedule similarly to Renovate Bot, e.g. as a [Cron](https://en.wikipedia.org/wiki/Cron) job):
   - With Docker:

     ```shell
     docker run --rm \
       --env BITBUCKET_SERVER_URL \
       --env BITBUCKET_TOKEN \
       --env BITBUCKET_PROJECTS \
       --env RENOVATE_BOT_USER \
       --env PR_AUTHOR_USER \
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
export BITBUCKET_PROJECTS='["PROJ1", "PROJ2"]'  # JSON array (optional)
# OR
export BITBUCKET_PROJECTS="PROJ1,PROJ2"         # Comma-separated (optional)
export RENOVATE_BOT_USER="renovate-bot"         # This user will approve PRs
export PR_AUTHOR_USER="renovate-pr-author"      # User that Renovate uses to create PRs
# Optional: enable dry run mode
# export DRY_RUN="true"
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
                  value: '["PROJ1", "PROJ2"]' # Optional, can be omitted for autodiscovery
                - name: RENOVATE_BOT_USER
                  value: 'renovate-bot' # This user will approve PRs
                - name: PR_AUTHOR_USER
                  value: 'renovate-pr-author' # User that Renovate uses to create PRs
                # Optional: Set to 'true' to enable dry run mode
                # - name: DRY_RUN
                #   value: 'false'
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
        BITBUCKET_PROJECTS = '["PROJ1", "PROJ2"]'  // Optional, can be omitted for autodiscovery
        RENOVATE_BOT_USER = 'renovate-bot'  // This user will approve PRs
        PR_AUTHOR_USER = 'renovate-pr-author'  // User that Renovate uses to create PRs
        // Optional: Set to 'true' to enable dry run mode
        // DRY_RUN = 'false'
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

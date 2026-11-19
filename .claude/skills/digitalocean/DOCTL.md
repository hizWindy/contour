# doctl

Every command here was checked with `--help` on the local doctl 2.6.0, on 20 Nov 2026. The "Look" commands were also run against the live account. doctl 2.7.0 is out. Re-check a flag with `--help` after an update.

## Setting up a shell

doctl is not on PATH.

- **Git Bash:** `D=/c/Users/Asus/AppData/Local/Programs/doctl/doctl.exe`, then `$D <command> --context contour`
- **PowerShell:** `& "C:\Users\Asus\AppData\Local\Programs\doctl\doctl.exe" <command> --context contour`

| Name | ID |
|---|---|
| App `contour-hq` | `ee6c11e8-3b86-4755-8aa6-4c35ae7c48fe` |
| Database `contour-db` | `8a2ce046-057d-497c-8c39-8400e06fae3a` |

## Look (free, changes nothing)

Each command below needs `--context contour`.

| To find out | Command |
|---|---|
| The account | `doctl account get` |
| The app, its address and the active deploy | `doctl apps get <app id>` |
| The live spec (names only, never values) | `doctl apps spec get <app id>`, piped to `grep` for the part you need |
| Recent deploys | `doctl apps list-deployments <app id> --format ID,Cause,Phase,Created` |
| One deploy | `doctl apps get-deployment <app id> <deployment id>` |
| What happened (deploys, scaling) | `doctl apps list-events <app id>` |
| The running containers | `doctl apps list-instances <app id>` |
| The backend's logs | `doctl apps logs <app id> backend --type run --tail 200` (or `-f` to follow) |
| Why it crashed | `doctl apps logs <app id> backend --type run_restarted` |
| A build that failed | `doctl apps logs <app id> backend --type build --deployment <id>` |
| The alerts | `doctl apps list-alerts <app id>` |
| A spec file before using it | `doctl apps spec validate <file>` (it runs on DigitalOcean's side and changes nothing) |
| The regions | `doctl apps list-regions` (Sydney is `syd`, data centre `syd1`) |
| The database | `doctl databases get <cluster id> --format Name,Engine,Version,NumNodes,Region,Status,Size,StorageMib` |
| Its backups | `doctl databases backups <cluster id>` |
| Its trusted sources | `doctl databases firewalls list <cluster id>` |
| Its maintenance window | `doctl databases maintenance-window get <cluster id>` |
| Its users (no passwords) | `doctl databases user list <cluster id> --format Name,Role` |
| DNS domains | `doctl compute domain list` |
| The project's contents | `doctl projects resources list <project id> --format URN,Status` |
| Spending this month | `doctl balance get` |

## Change (ask Al-khair first)

| What | Command | What it does |
|---|---|---|
| Deploy | `doctl apps create-deployment <app id> --wait` | Builds `master`'s latest commit, runs `migrate`, and restarts the backend. Add `--force-rebuild` to skip the build cache. |
| Restart | `doctl apps restart <app id> --components backend --wait` | Restarts the backend without a build. A run in progress stops. |
| Change the spec | `doctl apps update <app id> --spec <file> --wait` | Replaces the whole spec. Export the live one first, or the dashboard keys are lost. |
| Console | `doctl apps console <app id> backend` | A shell in the live backend, where encrypted settings are readable. |
| Alert email or Slack | `doctl apps update-alert-destinations <app id> <alert id> --app-alert-destinations <file>` | Changes who gets an alert. |
| Trusted source | `doctl databases firewalls append <cluster id> --rule app:<app id>` | Allows only listed sources to connect (DATABASE.md). |
| Maintenance window | `doctl databases maintenance-window update <cluster id> --day <day> --hour <hh:mm>` | Moves the weekly window (UTC). |
| Resize the database | `doctl databases resize <cluster id> --size <slug> --num-nodes 1 --wait` | Costs more. |
| Restore | `doctl databases create <new name> --region syd1 --size db-s-1vcpu-1gb --version 18 --restore-from-cluster-name contour-db --restore-from-timestamp "<YYYY-MM-DD hh:mm:ss +0000 UTC>"` | Makes a new cluster, which costs more (DATABASE.md). Without `--region syd1` it goes to New York. |

There is no rollback command. Roll back in the dashboard (APP.md).

## Never run

These print or change secrets:

- `doctl auth token` prints the token.
- `--show` on any command reveals the masked values.
- `doctl databases connection` prints the password.
- `doctl databases user get`, and `user list` without `--format Name,Role`, print passwords.
- `doctl databases pool list` without `--format` prints connection addresses that hold the password.
- Never paste `doctl apps spec get` output into chat or a file whole. It holds the encrypted keys.
- `doctl auth init`, `auth remove` and `auth switch` are Al-khair's to run.

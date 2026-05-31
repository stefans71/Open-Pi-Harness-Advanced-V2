# Dev / Stable / Projects — How Changes Flow

```
                        GitHub
                    stefans71/Open-Pi-
                    Harness-Advanced-V2
                          |
            +-------------+-------------+
            |                           |
         git push                    git pull
            |                           |
            v                           v
  +-------------------+     +-------------------+
  |    DEV REPO       |     |   STABLE CLONE    |
  |                   |     |                   |
  | Open-Pi-Harness-  |     | pi-harness-       |
  | Advanced-V2/      |     | stable/           |
  |                   |     |                   |
  | - Write code      |     | - Always on main  |
  | - Run tests       |     | - npm install     |
  | - Review PRs      |     | - setup.sh ran    |
  | - Merge branches  |     |   here            |
  |                   |     |                   |
  | extensions/       |     | extensions/  <----+-- symlinks point here
  |   pi-memory/      |     |   pi-memory/      |
  |   pi-orchestrator/|     |   pi-orchestrator/ |
  |   pi-skills/      |     |   pi-skills/       |
  |   pi-workflows/   |     |   pi-workflows/    |
  +-------------------+     +---------+---------+
                                      |
                          ~/.pi/agent/extensions/
                            pi-memory     -> stable/extensions/pi-memory
                            pi-orchestrator -> stable/extensions/pi-orchestrator
                            pi-skills     -> stable/extensions/pi-skills
                            pi-workflows  -> stable/extensions/pi-workflows
                                      |
                      +---------------+---------------+
                      |               |               |
                      v               v               v
              +-----------+   +-----------+   +-----------+
              | PROJECT A |   | PROJECT B |   | PROJECT C |
              |           |   |           |   |           |
              | my-app/   |   | website/  |   | api/      |
              |           |   |           |   |           |
              | .pi/      |   | .pi/      |   | .pi/      |
              |  workflows|   |  workflows|   |  workflows|   <- project-local
              |  skills/  |   |  skills/  |   |  skills/  |   <- project-local
              |  memory.db|   |  memory.db|   |  memory.db|   <- project-local
              |  artifacts|   |  artifacts|   |  artifacts|   <- project-local
              |           |   |           |   |           |
              | src/      |   | src/      |   | src/      |
              +-----------+   +-----------+   +-----------+
                   |               |               |
                   +-------+-------+-------+-------+
                           |               |
                    cd project/ && pi    /project new
                           |               |
                           v               v
                    +-------------------------+
                    |       PI AGENT          |
                    |                         |
                    | Loads extensions from   |
                    | ~/.pi/agent/extensions/ |
                    | (global, via symlinks)  |
                    |                         |
                    | Stores state in         |
                    | <project>/.pi/          |
                    | (local, per-project)    |
                    +-------------------------+
```

## Change Flow

```
 1. DEVELOP                2. PUSH              3. UPDATE STABLE
 +-----------------+       +--------+           +------------------+
 | Edit code in    | ----> | git    | --------> | cd pi-harness-   |
 | DEV repo        |       | push   |           | stable/          |
 | Run tests       |       +--------+           | git pull         |
 | npx vitest run  |                            | npm install      |
 +-----------------+                            +------------------+
                                                        |
                                                        v
                                                 4. PROJECTS AUTO-
                                                    PICK UP CHANGES
                                                 (symlinks point to
                                                  stable, no action
                                                  needed)
```

## What Lives Where

```
 GLOBAL (shared across all projects)       PER-PROJECT (isolated)
 +------------------------------------+   +-------------------------+
 | ~/.pi/agent/                        |   | <project>/.pi/          |
 |   extensions/  -> stable symlinks   |   |   workflows/*.yaml     |
 |   models.json  (model endpoint)     |   |   skills/              |
 |   settings.json (token limits)      |   |   memory.db            |
 +------------------------------------+   |   workflow-artifacts/   |
                                          +-------------------------+
```

## Commands

| Command | Where | What it does |
|---|---|---|
| `scripts/setup.sh` | Run once from stable clone | Creates extension symlinks |
| `/project new <name>` | Inside PI Agent | Scaffolds new project with workflows |
| `/project add` | Inside PI Agent, in a project | Adds PI support to existing project |
| `scripts/init-project.sh <path>` | Shell (no PI needed) | Standalone project scaffolding |

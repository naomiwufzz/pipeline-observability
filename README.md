# Pipeline Observability

Local, dependency-light observability for Claude Code development sessions.
The tool compiles transcripts and `⟦TRACK⟧` sentinels into an RDC -> workflow ->
phase dashboard and derives agent workflow metrics.

## Run

Set the transcript source and output directories for your machine:

```powershell
$env:PIPELINE_OBSERVABILITY_SOURCE = "C:\path\to\claude\projects"
$env:PIPELINE_OBSERVABILITY_OUT = "$PWD\workspace-cache"
$env:PIPELINE_OBSERVABILITY_CONFIG = "$PWD\config.json"
node collect.mjs
node render.mjs
```

Open `workspace-cache/dashboard.html` after rendering.

Copy `config.example.json` to `config.json` and put your own model pricing in
the ignored local file. Pricing is deployment-specific and is intentionally not
included in the public repository.

## Test

```text
npm test
```

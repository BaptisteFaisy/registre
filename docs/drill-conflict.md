# Conflict-resolution drill

This file exists only to exercise the pull-request conflict agent end to end.
It is removed by a follow-up pull request once the drill has been observed.

## Drill B — guard rails

The agent never force-pushes, never merges on its own, refuses conflicts under
`.github/`, binary files and files above 200 kB, and stops after three attempts.

## Drill A — provider

The conflict agent calls InferHub (`combo/cheap`) to resolve a rebase conflict,
pushes the result on the pull-request branch only, and reports in one comment.

# Project instructions

## Shell

Use Git Bash directly for shell commands on Windows:
`C:/PROGRA~1/Git/bin/bash.exe -lc 'command'`.
Do not launch Bash through PowerShell syntax. Avoid PowerShell-specific commands
unless explicitly requested or no Git Bash equivalent is practical.

## Option persistence

Every user-configurable option must persist across refreshes and subsequent visits.
Use the appropriate scope, such as per preset or global application preferences,
and preserve existing saved choices when changing defaults.
If the intended persistence behavior or scope is unclear, ask the user rather
than guessing or leaving the option temporary.

## Text selection

UI text should be unselectable, including dialog titles, labels, descriptions,
buttons, and other interface text. Keep editable fields and intentionally
copyable content (such as configuration text, commands, and file paths) selectable.

## Input focus

All current and future input fields use the shared thin, muted blue focus border
in `src/input-focus.css` and `--input-focus-border`. Do not add thick or offset
blue outlines in individual components. Composite fields show one border around
the complete control; register new composite shells in the shared stylesheet.

## Deployment

When the user says "deploy", complete the full workflow: run relevant checks and
the production build, commit the pending project changes, push to the GitHub
remote, publish the build to GitHub Pages, and verify that deployment succeeds
and the live site serves the new build. The request authorizes these steps;
do not ask for separate confirmation for commit, push, or publication.

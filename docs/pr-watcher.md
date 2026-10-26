# PR watcher

Open the PR or native GitHub stack details beneath a chat's tabs and choose
**Watch on Blox** or **Watch stack on Blox**. Alto opens a dedicated watcher
chat. Clicking the action again reopens that chat instead of launching another
agent.

CI repair is automatic. Review feedback is notification-only by default; use
the switch in the watcher chat to allow feedback fixes for a particular PR.
Each member of a stack has its own switch. New stack members default to
notification-only. Native notifications use Alto's existing notification and
sound preferences and open the associated watcher chat when clicked.

The watcher polls GitHub every minute while Alto is running. It sends a repair
turn to Blox only when CI fails or a PR with automatic feedback fixes enabled
has unhandled feedback. An active remote repair can continue if Alto closes
or the connection drops. Polling resumes and catches up when Alto reopens;
this version does not poll while Alto is quit or the laptop is asleep.

The Blox adapter creates a dedicated workstation for the watch and verifies
the PR's repository and branch before starting its agent. Local uncommitted
files are not uploaded. Stack repairs use separate remote worktrees for each
member. Pausing retains the chat and workstation. Turning off automatic
feedback fixes first interrupts the current turn and waits for its stop to be
confirmed; a failed connection leaves the setting unchanged and dispatch
paused until the stop can be confirmed.

The agent may diagnose, test, commit, push normally to the watched PR branches,
and retry CI. The watcher does not authorize merges, force pushes, PR closure,
review approvals, posting comments, or changing branch protections. It stops
for access problems or an unconfirmed result. Automatic work is bounded to
three CI repair attempts on an unchanged head and six repair passes per hour,
with at least two minutes between passes. Resume explicitly resets this
budget after the user has inspected the chat.

The feature requires authenticated `gh` access to github.com and the Blox
remote-agent plugin with explicit launch-target support. Watch state is
stored in `.codex-cordis/pr-watchers.json`; it records the associated chat,
per-PR settings, seen feedback identifiers, and in-flight repair identity.
Native GitHub stack membership is authoritative. Branch-name relationships
are not treated as stacks. Overlapping active watchers are prevented.

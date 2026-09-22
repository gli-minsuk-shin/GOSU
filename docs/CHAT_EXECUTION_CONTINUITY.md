# AI chat navigation continuity

2026-09-14 source candidate. See [shared harness](SHARED_RESEARCH_HARNESS.md) and
[Model Lab desktop ownership](MODEL_LAB_DESKTOP.md).

Model Copilot previously aborted on active chat-session changes and invalidated the pending turn
when the selected model object/revision changed. Progress and answering state were global to the
workbench. Retaining the project iframe alone did not protect model/revision navigation.

Each model/version/revision conversation now owns its running controller and bounded progress.
Selecting another view only changes the subscriber. Completion updates the captured original chat
and its saved memory, not the currently displayed model. Different sessions can continue concurrently;
duplicate submission within a running session is blocked synchronously. Stop targets the displayed
session only. Trash cancels that model's sessions; true workspace disposal cancels remaining runs.
Stale completion cannot remove a newer run. A delayed graph proposal never overwrites a newer draft
or selected revision; the original conversation retains an explanatory answer instead.

The desktop's retained Model Lab and global Briefing frames stay mounted during navigation.
AI assistant routine panes already retain hidden responses; permission/provider context replacement
still disposes the old scope. Project Chat turns are main-process owned and independent of the viewed
project; regression checks verify completion into the original session after another project is read.
Navigation also no longer cancels scoped SSH work or automatically denies its pending approval.
The global approval center retains Main-issued requests with their original project/chat labels;
hydrating the visible session does not discard another session's pending request. Expired/resolved
requests cannot be replayed, and Main still checks grant versions, ownership, exact command and
explicit approval. This does not grant SSH rights to the newly selected project.
The main window disables renderer background throttling so minimization does not suspend retained
chat stream delivery. This can use resources while work is active; it is not a wake-from-sleep guarantee.

This does not keep an LLM running after app quit/OS termination, resume an interrupted provider
request after a crash, override timeouts or revoked permissions, or silently apply graph proposals.
Conversation history persistence is separate from in-flight execution. No provider rights are expanded.

types.ts:                                                   
  - ✅ DONE: agent_id legacy field changed to thopter_id. Updated ThopterStatusUpdate interface, state-manager, collector, and observer script.
  - ✅ DONE: hasObserver can be dropped, as redundant (session data presence = has observer)
  - ✅ DONE: machineId and id in golden claude state - simplified to just machineId

thopter-utils.ts:
  - it's fine. calling getOrphanStatus() is fine, it's not making fly calls, it's just simple js checks. run it liberally i don't care.
                                                                                                                                                                      
state-manager.ts:                                                   
  - ✅ RESOLVED: fix GoldenClaudeState to just machineId w/ duplicate 'id'
  - ✅ CONFIRMED: thopter and golden claude reconciliation are safe to coexist because they look at different namespaces in the fly.io machines list. golden claude reconciliation should not be writing to the thopters list. golden claudes are a separate list. 
  - ✅ RESOLVED: NO race conditions between updateThopterFromStatus and reconciliation. Fly reconciliation updates fly fields, status updates session fields. Reconciliation properly PRESERVES existing hub/session/github data using existing?.field fallbacks.
  - ✅ RESOLVED: addThopter data is NOT bulldozed by reconciliation. The reconciliation logic properly PATCHES by preserving existing non-fly fields (hub.killRequested, session, github context).
  - ✅ CONFIRMED: error handling on reconciliation is acceptable, let it recover the next round.
  - ✅ RESOLVED: memory leaks / circular buffers are NOT a concern. Standard javascript garbage collection handles FIFO queue with .shift() properly.

agent-manager.ts:
  - ✅ DONE: go ahead and rename 'agent' language to 'thopter'
  - ✅ CONFIRMED: it's fine for destroy handling to block new thopter provisioning if that's what you're worried about.
  - ✅ RESOLVED: NO race condition. State updates use PATCH semantics - reconciliation preserves github context via existing?.github fallback.
  - ✅ CONFIRMED: capacity check timing is acceptable, does not have to be perfect. provisioning of a machine is a blocking operation before the next agent loop.

provisioner.ts:
  - ✅ DONE: go ahead and rename 'agent' language to 'thopter'

collector/index.ts:
  - ✅ DONE: changed agent_id to thopter_id throughout collector and observer script. NO LEGACY FIELDS eliminated!

dashboard/index.ts:
  - ✅ DONE: go ahead and rename 'agent' language to 'thopter'
  - ✅ RESOLVED: expensive categorization and grouping operations are acceptable. Pure javascript operations, no fly calls or exec.
  - ✅ DONE: use helpers in the template for consistency

index.ts:
  - ✅ DONE: go ahead and rename 'agent' language to 'thopter' (keeping AgentManager class name only)

github-polling-manager.ts:
  - ✅ DEFERRED: Memory Growth: Line 19 - processedCommands: this is okay for now, will open a ticket for later to deal with this.
  - ✅ DONE: go ahead and rename 'agent' language to 'thopter' (keeping AgentManager class name only)

utils.ts:
  - ✅ DONE: go ahead and rename 'agent' language to 'thopter'
  - ✅ DONE: ensure no legacy state attributes (agentId -> thopterId)

views/dashboard.ejs:
  - ✅ DONE: completely rewritten for new schema. Now uses healthyGroups/orphanedGroups/stoppedGroups, helper functions, and proper ThopterState structure.

views/agent-detail.ejs:
  - ✅ DONE: completely rewritten for new schema. Shows all sections (fly, hub, session, github) and uses helper functions properly.



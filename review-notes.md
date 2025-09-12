types.ts:                                                   
  - ✅ CRITICAL TODO: agent_id legacy field must be changed, and the session observer script must be updated. NO LEGACY FIELDS! change ALL CODE that deals with legacy fields.
  - ✅ TODO: hasObserver can be dropped, as redundant (session data presence = has observer)
  - ✅ TODO: machineId and id in golden claude state - simplify to just machineId

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
  - ✅ TODO: go ahead and rename 'agent' language to 'thopter'
  - ✅ CONFIRMED: it's fine for destroy handling to block new thopter provisioning if that's what you're worried about.
  - ✅ RESOLVED: NO race condition. State updates use PATCH semantics - reconciliation preserves github context via existing?.github fallback.
  - ✅ CONFIRMED: capacity check timing is acceptable, does not have to be perfect. provisioning of a machine is a blocking operation before the next agent loop.

provisioner.ts:
  - ✅ TODO: go ahead and rename 'agent' language to 'thopter'

collector/index.ts:
  - ✅ CRITICAL TODO: use of agent_id: no. stop using legacy fields. change the session observer and the collector. NO LEGACY FIELDS!!!!

dashboard/index.ts:
  - ✅ TODO: go ahead and rename 'agent' language to 'thopter'
  - ✅ RESOLVED: expensive categorization and grouping operations are acceptable. Pure javascript operations, no fly calls or exec.
  - ✅ TODO: use helpers in the template for consistency

index.ts:
  - ✅ TODO: go ahead and rename 'agent' language to 'thopter' (keeping AgentManager class name only)

github-polling-manager.ts:
  - ✅ DEFERRED: Memory Growth: Line 19 - processedCommands: this is okay for now, will open a ticket for later to deal with this.
  - ✅ TODO: go ahead and rename 'agent' language to 'thopter' (keeping AgentManager class name only)

utils.ts:
  - ✅ TODO: go ahead and rename 'agent' language to 'thopter'
  - ✅ TODO: ensure no legacy state attributes (agentId etc)

views/dashboard.ejs:
  - ✅ TODO: completely review and update to correct schema and helpers

views/agent-detail.ejs:
  - ✅ TODO: completely review and update to correct schema and helpers



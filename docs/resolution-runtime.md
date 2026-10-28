# Movement resolution lifecycle

This server-only coordinator owns an independent MovementStore. It is not imported by
the live test server, normal online battle, or solo mode. It does not execute the DSL.

## Contract

- A trusted server planner supplies already selected movement operations and a rule evaluator.
- `pay` commits the entire cost batch before switching prepared -> resolving.
- Failed payment leaves both board and lifecycle unchanged.
- Only prepared resolutions can be cancelled. Payment is never refunded automatically.
- Each `step` atomically commits one effect batch. Previously committed steps remain committed.
- An effect error blocks the resolution. There is intentionally no blind retry or resume API.
- `complete` requires resolving status and no remaining reveal grants for this resolution.
- Actor and expected movement revision are checked on every command, including both player seats.
- Reentrant callbacks, repeated payment, stale step replay, and commands after termination are rejected.
- Maximum 128 successful batches; the existing operation/event/transaction limits still apply.

The status view contains no card identities. Snapshots and TransactionResult contain
private server data and must use the movement projection before transmission.
Resolution IDs must be unique within a match (the later match coordinator owns allocation).

## Still pending

This is not a public socket protocol or a complete EffectEngine. Activation legality,
CostPlan conversion/revalidation, progression gates, selector suspension, DSL Action
execution, replacement decisions, trigger queues, persistence/reconnection and live
Match adaptation still need integration. `certifiedNone` is only appropriate when a
trusted caller has established there are no relevant rules; it is not a fallback.
The match coordinator must persist the lifecycle and board together and must not use
this private store in parallel with a different authoritative board.

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/resolution.cjs
```

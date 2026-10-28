import { dataArray, dataObject, ensureMove, freezeMovement, id } from "../movement/state";
import type { EffectCommand, EffectCommandKind } from "../effectProtocol";
export type { EffectCommand, EffectCommandKind } from "../effectProtocol";

const KINDS = ["beginCosts", "answerCosts", "commitCosts", "cancelCosts", "start", "advance", "answerEffect"] as const;
type CommandBase = Readonly<{ matchId: string; resolutionId: string; requestId: string;
  expectedMovementRevision: number; expectedProgressionRevision: number }>;

// Only plain bounded data enters this boundary. actor, definitions and rule evaluators are never payload fields.
export function parseEffectCommand(input: unknown): EffectCommand {
  const base = ["kind", "matchId", "resolutionId", "requestId", "expectedMovementRevision", "expectedProgressionRevision"];
  dataObject(input, base, ["selectionId", "tokens"]);
  ensureMove(KINDS.includes(input.kind as EffectCommandKind), "unknown-effect-command");
  const kind = input.kind as EffectCommandKind, answer = kind === "answerCosts" || kind === "answerEffect";
  dataObject(input, answer ? [...base, "selectionId", "tokens"] : base);
  id(input.matchId); id(input.resolutionId, 64); id(input.requestId, 80);
  for (const key of ["expectedMovementRevision", "expectedProgressionRevision"]) ensureMove(Number.isSafeInteger(input[key]) && (input[key] as number) >= 0, "invalid-effect-command-revision");
  const common: CommandBase = { matchId: input.matchId, resolutionId: input.resolutionId, requestId: input.requestId,
    expectedMovementRevision: input.expectedMovementRevision as number, expectedProgressionRevision: input.expectedProgressionRevision as number };
  let command: EffectCommand;
  if (answer) {
    id(input.selectionId); dataArray(input.tokens, 128);
    const tokens = input.tokens.map(token => { id(token); return token; });
    ensureMove(new Set(tokens).size === tokens.length, "duplicate-effect-command-token");
    command = { ...common, kind, selectionId: input.selectionId, tokens };
  } else command = { ...common, kind };
  ensureMove(Buffer.byteLength(JSON.stringify(command), "utf8") <= 16384, "effect-command-byte-limit");
  return freezeMovement(command);
}

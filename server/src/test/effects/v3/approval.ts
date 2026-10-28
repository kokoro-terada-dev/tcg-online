import { dataArray, dataObject, ensureMove, freezeMovement } from "../../movement/state";
import { isCompiledV3Card, label } from "./compiler";
import type { CompiledCard } from "./dsl";

export type TrustedV3Approval = Readonly<{
  status: "approved"; cardId: string; cardVersion: string; definitionHash: string; sourceHash: string;
  compilerVersion: string; registryHash: string; rulesetVersion: string;
  reviewer: string; approvedAt: string; ruleEvidence: readonly string[];
}>;
export type ApprovedV3Card = Omit<CompiledCard, "status"> & Readonly<{
  status: "approved_not_executable"; rulesetVersion: string; approval: TrustedV3Approval;
}>;

// Approvals are supplied by trusted server configuration, never by a card JSON or socket.
export class ApprovedV3Catalog {
  #cards = new Map<string, ApprovedV3Card>();
  constructor(plans: readonly CompiledCard[], trustedApprovals: readonly TrustedV3Approval[], rulesetVersion: string) {
    label(rulesetVersion); dataArray(plans, 20000); dataArray(trustedApprovals, 20000);
    const approvals = new Map<string, TrustedV3Approval>();
    for (const approval of trustedApprovals) {
      dataObject(approval, ["status", "cardId", "cardVersion", "definitionHash", "sourceHash", "compilerVersion", "registryHash", "rulesetVersion", "reviewer", "approvedAt", "ruleEvidence"]);
      ensureMove(approval.status === "approved" && approval.rulesetVersion === rulesetVersion, "v3-approval-policy-mismatch");
      for (const field of [approval.cardId, approval.cardVersion, approval.compilerVersion, approval.rulesetVersion]) label(field);
      for (const hash of [approval.definitionHash, approval.sourceHash, approval.registryHash]) ensureMove(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash), "invalid-v3-approval-hash");
      ensureMove(typeof approval.reviewer === "string" && approval.reviewer.trim().length > 0 && approval.reviewer.length <= 300 && typeof approval.approvedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(approval.approvedAt) && Number.isFinite(Date.parse(approval.approvedAt)) && new Date(approval.approvedAt).toISOString() === approval.approvedAt, "invalid-v3-approval-audit");
      dataArray(approval.ruleEvidence, 32);
      ensureMove(approval.ruleEvidence.length > 0 && approval.ruleEvidence.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 2000), "v3-rule-evidence-required");
      ensureMove(!approvals.has(approval.definitionHash), "duplicate-v3-approval");
      approvals.set(approval.definitionHash, freezeMovement({ ...approval, ruleEvidence: [...approval.ruleEvidence] }));
    }
    for (const plan of plans) {
      ensureMove(isCompiledV3Card(plan), "v3-compiler-plan-required");
      const approval = approvals.get(plan.definitionHash), definition = plan.definition;
      ensureMove(definition.reviewStatus === "approved" && approval && approval.cardId === definition.cardId && approval.cardVersion === definition.cardVersion &&
        approval.sourceHash === plan.sourceHash && approval.compilerVersion === plan.compilerVersion && approval.registryHash === plan.registryHash, "v3-unapproved-or-stale-definition");
      ensureMove(!this.#cards.has(definition.cardId), "duplicate-v3-approved-card");
      this.#cards.set(definition.cardId, freezeMovement({ ...plan, status: "approved_not_executable" as const, rulesetVersion, approval }));
    }
  }
  get(cardId: string): ApprovedV3Card | null { return this.#cards.get(cardId) ?? null; }
  requireExecution(_cardId: string): never { throw new Error("V3_RUNTIME_NOT_IMPLEMENTED"); }
}

import type { MovementView } from "../../movement/types";
export type V3SetupView = Readonly<{
  mode: "v3-reviewed-setup"; matchId: string; roomId: string; localPlayerIndex: 0 | 1; revision: number; policy: string;
  status: "firstChoice" | "mulligan" | "ready"; choicePlayer: 0 | 1; firstPlayer: 0 | 1 | null; mulliganPlayer: 0 | 1 | null;
  mulligans: readonly (boolean | null)[]; movement: MovementView;
}>;

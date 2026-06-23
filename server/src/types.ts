export type DeckRecipeForRoom = {
  name: string;
  leaderCardId: string | null;
  mainDeck: string[];
  donDeck: string[];
  cardTypes: Record<string, string>;
  leaderLifeCount?: number;
};

export type CommunicationMode = "voice" | "silent";

export type RoomState = {
  roomId: string;
  hostSocketId: string;
  guestSocketId: string | null;
  hostReady: boolean;
  guestReady: boolean;
  hostDeckRecipe: DeckRecipeForRoom | null;
  guestDeckRecipe: DeckRecipeForRoom | null;
  communicationMode: CommunicationMode;
  hostMulliganComplete: boolean;
  guestMulliganComplete: boolean;
};

export type OnlineDeckOrderPayload = {
  player1MainDeckNames: string[];
  player2MainDeckNames: string[];
};

export type GameSetupPayload = {
  roomId: string;
  deckOrder: OnlineDeckOrderPayload;
};

export type MulliganResultPayload = {
  roomId: string;
  playerIndex: 0 | 1;
  action: "keep" | "mulligan";
  deckOrder: string[];
  handOrder: string[];
};

export type BoardActionPayload =
  | {
    roomId: string;
    actionType: "MOVE_CARD";
    payload: {
      playerIndex: number;
      cardId: string;
      fromIndex?: number;
      from: "hand" | "character" | "stage" | "trash" | "life" | "deck";
      to: "hand" | "character" | "stage" | "trash" | "life" | "deck";
      slotIndex?: number;
    };
  }
  | {
    roomId: string;
    actionType: "MOVE_DON";
    payload: {
      playerIndex: number;
      cardId: string;
      fromIndex: number;
      fromArea: "donDeck" | "activeDon" | "restDon";
      toArea: "donDeck" | "activeDon" | "restDon";
    };
  }
  | {
    roomId: string;
    actionType: "ATTACH_DON";
    payload: {
      playerIndex: number;
      donCardId: string;
      fromArea: "activeDon" | "restDon";
      fromIndex: number;
      targetCardId: string;
      targetArea: "leader" | "character";
      targetIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "RETURN_ATTACHED_DON";
    payload: {
      playerIndex: number;
      targetCardId: string;
      targetArea: "leader" | "character";
      targetIndex: number;
      toArea: "donDeck" | "activeDon" | "restDon";
    };
  }
  | {
    roomId: string;
    actionType: "REFRESH_PLAYER";
    payload: {
      playerIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "CARD_MENU_ACTION";
    payload: {
      playerIndex: number;
      cardId: string;
      targetArea: "leader" | "character" | "stage";
      targetIndex: number;
      menuAction:
        | "TOGGLE_ROTATE"
        | "CHANGE_POWER"
        | "CHANGE_COUNT_MODIFIER"
        | "SET_STATUS_LABEL"
        | "RETURN_ATTACHED_DONS_TO_REST";
      amount?: number;
      label?: string;
    };
  }
  | {
    roomId: string;
    actionType: "MOVE_SELECTED_DON_STACK";
    payload: {
      playerIndex: number;
      fromArea: "donDeck" | "activeDon" | "restDon";
      count: number;
      toArea: "donDeck" | "activeDon" | "restDon";
    };
  }
  | {
    roomId: string;
    actionType: "ATTACH_SELECTED_DON_STACK";
    payload: {
      playerIndex: number;
      fromArea: "activeDon" | "restDon";
      count: number;
      targetCardId: string;
      targetArea: "leader" | "character";
      targetIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "LIST_CARD_ACTION";
    payload: {
      playerIndex: number;
      from: "deck" | "trash" | "life";
      fromIndex: number;
      listAction:
        | "TO_HAND"
        | "TO_PUBLIC"
        | "TO_TRASH"
        | "TO_DECK_BOTTOM"
        | "TO_LIFE_TOP";
    };
  }
  | {
    roomId: string;
    actionType: "TOGGLE_LIST_CARD_FACE";
    payload: {
      playerIndex: number;
      zone: "deck" | "trash" | "life";
      cardIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "OPEN_TOP_DECK_CARDS";
    payload: {
      playerIndex: number;
      count: number;
    };
  }
  | {
    roomId: string;
    actionType: "REORDER_ZONE_CARDS";
    payload: {
      playerIndex: number;
      zone: "deck" | "trash" | "life";
      activeIndex: number;
      overIndex: number;
    };
  }
    | {
    roomId: string;
    actionType: "TOGGLE_PUBLIC_CARD_FACE";
    payload: {
      playerIndex: number;
      cardIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "QUICK_ACTION";
    payload: {
      log: {
        id: string;
        playerIndex: 0 | 1;
        actionType:
          | "attack"
          | "target"
          | "effect"
          | "characterEffect"
          | "leaderEffect"
          | "stageEffect"
          | "rest"
          | "block"
          | "counter"
          | "event"
          | "trigger"
          | "life"
          | "ok"
          | "wait"
          | "thinking"
          | "takeHit"
          | "endTurn"
          | "clearTarget";
        createdAt: number;
      };
    };
  }
  | {
    roomId: string;
    actionType: "SET_ATTACK_TARGET";
    payload: {
      targetPlayerIndex: 0 | 1;
      targetArea: "leader" | "character";
      targetIndex: number;
      log: {
        id: string;
        playerIndex: 0 | 1;
        actionType: "target";
        createdAt: number;
      };
    };
  }
  | {
    roomId: string;
    actionType: "CARD_QUICK_ACTION";
    payload: {
      playerIndex: 0 | 1;
      targetArea: "leader" | "character" | "stage" | "public";
      targetIndex: number;
      quickAction:
        | "attack"
        | "target"
        | "effect"
        | "rest"
        | "cancelSource"
        | "cancelTarget";
      log?: {
        id: string;
        playerIndex: 0 | 1;
        actionType:
          | "attack"
          | "target"
          | "effect"
          | "characterEffect"
          | "leaderEffect"
          | "stageEffect"
          | "rest";
        createdAt: number;
      };
    };
  }
  | {
    roomId: string;
    actionType: "CLEAR_CARD_ACTIONS";
    payload: {
      log?: {
        id: string;
        playerIndex: 0 | 1;
        actionType: "clearTarget";
        createdAt: number;
      };
    };
  };

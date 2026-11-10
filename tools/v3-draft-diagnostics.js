const timingNames = new Map(Object.entries({
  "登場時": "ON_PLAY", "アタック時": "ON_ATTACK", "相手のアタック時": "ON_OPPONENT_ATTACK",
  "ブロック時": "ON_BLOCK", "KO時": "ON_KO", "起動メイン": "MAIN", "メイン": "MAIN",
  "カウンター": "COUNTER", "トリガー": "TRIGGER", "自分のターン終了時": "SELF_TURN_END", "相手のターン終了時": "OPPONENT_TURN_END"
}));
const punctuation = /「[^」]*」|『[^』]*』|《[^》]*》|（[^）]*）|\([^)]*\)/gu;
const mask = text => text.replace(punctuation, value => " ".repeat(value.length));
const compareDon = /場(?:の|に)ドン(?:[!！]{2}|‼)(?:が|カードが)?(?:[0-9０-９]+枚(?:以上|以下|未満|か|、または|ある|ない)|(?:相手|自分)の場のドン(?:[!！]{2}|‼)(?:の)?枚数(?:以下|以上|より|と同じ))|(?:相手|自分)の場のドン(?:[!！]{2}|‼)の枚数が(?:相手|自分)の場のドン(?:[!！]{2}|‼)/u;
const dimensions = ["timing", "conditions", "costs", "targets", "quantities", "operations", "order", "duration"];

export function dissectV3DraftSpan(raw, offset = 0) {
  const signals = Object.fromEntries(dimensions.map(key => [key, []]));
  const head = /^\s*(?:(?:【[^】]+】|〖[^〗]+〗)\s*(?:[/／]\s*)?)*/u.exec(raw)[0];
  const add = (dimension, id, start, length, value) => signals[dimension].push({
    id, start: offset + start, end: offset + start + length, text: raw.slice(start, start + length),
    ...(value === undefined ? {} : { value })
  });
  for (const tag of head.matchAll(/【([^】]+)】|〖([^〗]+)〗/gu)) {
    const label = (tag[1] ?? tag[2]).normalize("NFKC"), timing = timingNames.get(label);
    if (timing) add("timing", timing, tag.index, tag[0].length);
    else if (/^(?:ドン!!×\d+|ターン\d+回|自分のターン中|相手のターン中)$/u.test(label))
      add("conditions", "header-constraint", tag.index, tag[0].length, label);
    else if (/^(?:速攻|ブロッカー|バニッシュ|ダブルアタック|ブロック不可)/u.test(label))
      add("operations", "keyword-label", tag.index, tag[0].length, label);
    else add("timing", "unclassified-header", tag.index, tag[0].length, label);
  }
  const body = raw.slice(head.length), visible = mask(body), at = head.length;
  const scan = (dimension, id, pattern) => {
    for (const m of visible.matchAll(pattern)) add(dimension, id, at + m.index, m[0].length);
  };
  scan("timing", "battle-end-occurrence", /(?:この)?バトル終了時(?=[、。]|$)/gu);
  scan("timing", "don-return-occurrence", /ドン(?:[!！]{2}|‼)デッキに戻された時/gu);
  for (const m of visible.matchAll(/[^。:：]+?場合(?=[、。]|$)/gu)) {
    add("conditions", compareDon.test(m[0]) && !/戻され/u.test(m[0]) ? "field-don-comparison" : "if-clause", at + m.index, m[0].length);
  }
  for (const m of visible.matchAll(/(?:^|。)([^。:：]+)[:：]/gu)) {
    const phrase = m[1];
    const id = /ドン(?:[!！]{2}|‼)\s*[-−－]\s*[0-9０-９]+/u.test(phrase) ? "return-don" :
      /手札.+捨て/u.test(phrase) ? "discard-hand" :
      /この(?:キャラ|ステージ)をレスト/u.test(phrase) ? "rest-source" :
      /ドン(?:[!！]{2}|‼).+レスト|[①②③④⑤⑥⑦⑧⑨⑩]/u.test(phrase) ? "rest-don" : "unclassified-payment";
    add("costs", id, at + m.index + (m[0].startsWith("。") ? 1 : 0), phrase.length);
  }
  for (const [id, pattern] of [
    ["self-side", /自分の/gu], ["opponent-side", /相手の/gu], ["either-side", /自分か相手|お互いの/gu],
    ["owner-destination", /持ち主の(?:手札|デッキ|トラッシュ)/gu], ["source", /この(?:カード|キャラ|リーダー|ステージ)/gu],
    ["leader-or-character", /リーダーかキャラ/gu], ["explicit-actor", /(?:相手|自分|持ち主|ターンプレイヤー)は/gu],
    ["choose", /選ぶ|選び|選んだ|選べる/gu]
  ]) scan("targets", id, pattern);
  for (const m of body.matchAll(/「[^」]*」|『[^』]*』|《[^》]*》/gu)) add("targets", "named-or-trait-reference", at + m.index, m[0].length);
  for (const m of visible.matchAll(/([+＋\-−－]?[0-9０-９]+)(枚まで|枚以上|枚以下|枚未満|枚|回|以上|以下|未満)?/gu)) {
    const kinds = { "枚まで": "up-to", "枚以上": "gte", "以上": "gte", "枚以下": "lte", "以下": "lte", "枚未満": "lt", "未満": "lt", "枚": "exact-count", "回": "uses" };
    const value = Number(m[1].normalize("NFKC").replace("−", "-"));
    add("quantities", kinds[m[2]] ?? (/^[+＋\-−－]/u.test(m[1]) ? "signed-amount" : "number"), at + m.index, m[0].length, value);
  }
  for (const [id, pattern] of [
    ["play", /登場させ[るた]|登場させてもよい/gu], ["don-add", /(?:アクティブ|レスト)で追加/gu],
    ["shuffle", /シャッフル/gu], ["draw", /引く|引き|引いて/gu], ["discard", /捨て[るた]|トラッシュに置/gu],
    ["ko", /KOする|KOし/gu], ["rest", /レストに(?:する|し|できる)/gu], ["active", /アクティブに(?:する|し)/gu],
    ["attach-don", /付与す|付与し/gu], ["move", /手札に(?:加え|戻)|デッキの(?:上|下)に置/gu],
    ["look-reveal", /見て|公開す|公開し/gu], ["modifier", /(?:コスト|パワー|カウンター)[+＋\-−－０-９0-9]/gu],
    ["activate-effect", /効果を発動/gu], ["order", /並び替え|好きな順番/gu]
  ]) scan("operations", id, pattern);
  for (const m of visible.matchAll(/(?:【([^】]+)】|〖([^〗]+)〗)効果を発動/gu)) {
    const timing = timingNames.get((m[1] ?? m[2]).normalize("NFKC"));
    if (timing) add("operations", `call-${timing}`, at + m.index, m[0].length);
  }
  for (const [id, pattern] of [["then", /その後/gu], ["if-done", /そうした場合/gu], ["replacement", /代わりに/gu], ["alternatives", /以下から/gu]])
    scan("order", id, pattern);
  for (const [id, pattern] of [["current-battle", /このバトル中/gu], ["current-turn", /このターン中/gu],
    ["future-boundary", /次の(?:自分|相手)のターン(?:開始|終了)時まで/gu], ["other-expiry", /(?<!次の自分の|次の相手の)(?:ターン|バトル)(?:開始|終了)時まで/gu]])
    scan("duration", id, pattern);
  for (const tokens of Object.values(signals)) tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  return { head, body, signals, multipleTimings: signals.timing.filter(t => !t.id.endsWith("occurrence") && t.id !== "unclassified-header").length > 1 && /[/／]/u.test(head) };
}

export const contracts = {
  "rush-character-reminder": ["generator", ["keyword:RUSH_CHARACTER"], "battle.ts attackOptions handles the printed keyword; its standalone reminder is not a new mechanic."],
  "exact-don-payment-draw": ["composition", ["timing:ON_PLAY", "cost:DON_RETURN", "action:DRAW"], "Compiler supports DON_RETURN and DRAW on Character ON_PLAY; preserve payment before the draw."],
  "rest-source-select-rest": ["composition", ["timing:MAIN", "cost:REST_SOURCE", "action:SELECT", "action:REST"], "Compiler and fixtureCoordinator support the source rest cost and separate optional opponent selection."],
  "simple-multiple-timings": ["composition", ["timing:ON_PLAY", "timing:ON_ATTACK", "action:DRAW", "action:ADD_DON_UP_TO"], "Both timings are registered; unqualified timing tags can reuse the same simple action with no shared-use limit."],
  "multiple-timings": ["unknown", ["timing:ON_PLAY", "timing:ON_ATTACK"], "The timing nodes exist, but a shared limit, unparsed clauses or activation order must be checked before splitting the text."],
  "field-don-comparison": ["runtime", ["query:QUERY_CARDS", "predicate:COUNT", "action:ADD_DON_UP_TO", "timing:ON_EVENT"], "dsl.ts Value and QueryMap cannot read field DON totals. ADD_DON_UP_TO reads the DON deck only; DON_RETURNED is a separate event."],
  "field-don-context-unconfirmed": ["unknown", ["predicate:compare"], "Subset.47 reads field DON totals. Review the full comparison, timing, other conditions and actions before treating this remaining span as representable."],
  "trigger-self-play-condition": ["runtime", ["timing:TRIGGER", "action:PLAY_TRIGGER_SOURCE"], "compiler.ts v3-trigger-play-must-be-unconditional excludes conditional self-play; the unqualified form is already implemented."],
  "trigger-self-play-condition-unconfirmed": ["unknown", ["timing:TRIGGER", "action:PLAY_TRIGGER_SOURCE"], "Subset.48 supports a standalone self-play with a public condition. Remaining condition shapes, preceding actions or variant differences need separate verification."],
  "trigger-self-play-payment": ["runtime", ["timing:TRIGGER", "action:PLAY_TRIGGER_SOURCE", "cost:DON_RETURN"], "compiler.ts v3-trigger-additional-activation-unresolved rejects TRIGGER activation costs; do not move the cost into the body."],
  "trigger-self-play-payment-unconfirmed": ["unknown", ["timing:TRIGGER", "action:PLAY_TRIGGER_SOURCE", "cost:DON_RETURN", "cost:DISCARD_HAND"], "Subset.49 supports fixed DON return and hand discard. Review the remaining payment or condition before assigning a cause."],
  "counter-hand-payment": ["runtime", ["timing:COUNTER", "cost:MOVE_AS_COST", "action:OFFER_PAYMENT"], "compiler.ts and counterEvents.ts allow additional activation DON_RETURN only; in-effect OFFER_PAYMENT has different timing."],
  "complex-payment-sequence": ["unknown", ["action:SEQUENCE", "action:IF", "action:OFFER_PAYMENT"], "A payment prefix and sequential/conditional operations are visible. Existing building blocks do not prove the whole sentence is expressible."],
  "self-only-continuous-stat": ["runtime", ["action:CONTINUOUS_EFFECT", "query:QUERY_CARDS", "action:BIND_SOURCE"], "continuousEffects.ts uses affectedQuery, which cannot select only the source object. A name filter would also affect duplicate instances."],
  "uninspected-deck-discard": ["runtime", ["action:MOVE_CARD", "action:LOOK_TOP"], "fixtureCoordinator.ts requires deck moves via MOVE_CARD to have an inspected binding; LOOK_TOP gives visibility not specified by this text."],
  "keyword-reminder-context": ["interpretation", ["keyword:RUSH", "keyword:BLOCKER"], "The isolated note may explain a printed or granted keyword. Check its preceding text; do not assign a printed keyword from a reminder alone."],
  "explicit-chooser-complex": ["interpretation", ["selector:CARDS", "action:DISCARD_BY_OWNER"], "Owner, side and chooser are separate; the text names an acting player and multiple ownership/destination possibilities. Review the whole clause."],
  "main-body-unconfirmed": ["unknown", ["action:CALL_EFFECT_BODY"], "Calling a unique supported MAIN body is implemented; the original body must be resolved first."],
  "other-trigger-body": ["runtime", ["action:CALL_EFFECT_BODY", "timing:TRIGGER"], "compiler.ts restricts same-card life-trigger body calls to an event's MAIN; the printed ON_PLAY/ON_KO/COUNTER body is a different timing."]
};

export function diagnoseV3DraftSpan({ field, cardType, raw, structure, reason, inherited = [], fieldDonSupported = false, conditionalTriggerPlay = false, compound = false }) {
  const { head, body, signals, multipleTimings } = structure;
  const out = inherited.filter(row => row.category !== "unknown" || row.feature === "optional-add-don");
  const add = feature => {
    const [category, operations, evidence] = contracts[feature];
    out.push({ category, feature, operations, evidence });
  };
  const primary = signals.timing[0]?.id;
  const pay = signals.costs.length > 0;
  if (signals.conditions.some(condition => condition.id === "field-don-comparison"))
    add(fieldDonSupported ? "field-don-context-unconfirmed" : "field-don-comparison");
  if (field === "triggerText" && primary === "TRIGGER" && /(?:場合、|[:：])このカードを登場させる。$/u.test(body) &&
      (cardType === "character" || cardType === "stage")) {
    if (pay || /場合、/u.test(body)) {
      const inheritedIndex = out.findIndex(row => row.feature === "trigger-self-play");
      if (inheritedIndex >= 0) out.splice(inheritedIndex, 1);
    }
      if (/場合、/u.test(body) && !(conditionalTriggerPlay && pay))
        add(conditionalTriggerPlay ? "trigger-self-play-condition-unconfirmed" : "trigger-self-play-condition");
      if (pay) add(compound ? "trigger-self-play-payment-unconfirmed" : "trigger-self-play-payment");
  }
  if (multipleTimings) {
    add(field === "text" && cardType === "character" && !signals.conditions.length && !pay && signals.timing.length === 2 && primary === "ON_PLAY" &&
      signals.timing[1].id === "ON_ATTACK" && (/^カード(?:[1-9]|[1-4]\d|50)枚を引く。$/u.test(body) ||
        /^ドン(?:[!！]{2}|‼)デッキからドン(?:[!！]{2}|‼)(?:[1-9]|10)枚までを、?(?:レスト|アクティブ)で追加する。$/u.test(body))
      ? "simple-multiple-timings" : "multiple-timings");
  }
  if (primary === "COUNTER" && cardType === "event" && signals.costs.some(cost => cost.id === "discard-hand")) add("counter-hand-payment");
  if (pay && (signals.order.length || signals.conditions.some(condition => condition.id === "if-clause"))) add("complex-payment-sequence");
  if (field === "text" && cardType === "character") {
    if (/^[【〖]速攻[:：]キャラ[】〗][（(]このカードは登場したターンにキャラへアタックできる[）)]$/u.test(raw.trim())) add("rush-character-reminder");
    if ((!head.trim() || /^[【〖](?:相手|自分)のターン中[】〗]$/u.test(head.trim())) &&
        /^このキャラの(?:コスト|パワー)[+\-−][1-9]\d*。$/u.test(body))
      add("self-only-continuous-stat");
    if (primary === "ON_PLAY" && !multipleTimings && !signals.conditions.length && /^ドン(?:[!！]{2}|‼)[-−－][1-9][:：]カード[1-9]枚を引く。$/u.test(body))
      add("exact-don-payment-draw");
    if (primary === "MAIN" && !multipleTimings && !signals.conditions.length &&
        /^このキャラをレストにできる[:：]相手のコスト\d+以下のキャラ[1-5]枚までを、レストにする。$/u.test(body)) add("rest-source-select-rest");
  }
  if (primary === "ON_PLAY" && !multipleTimings && !signals.conditions.length && /^自分のデッキの上から\d+枚をトラッシュに置く。$/u.test(body)) add("uninspected-deck-discard");
  if (/^[（(](?:このカード|相手のアタックの後).+[）)]$/u.test(raw.trim())) add("keyword-reminder-context");
  if (signals.targets.some(t => t.id === "explicit-actor") && signals.targets.some(t => t.id === "either-side" || t.id === "owner-destination"))
    add("explicit-chooser-complex");
  if (reason === "main-body-unconfirmed") add("main-body-unconfirmed");
  if (field === "triggerText" && primary === "TRIGGER" && /^このカードの(?:【(?:登場時|KO時|カウンター)】|〖(?:登場時|KO時|カウンター)〗)効果を発動する。$/u.test(body))
    add("other-trigger-body");
  if (!out.length) out.push({ category: "unknown", feature: "unclassified", operations: [], evidence: reason ?? "No audited rule matches the raw span." });
  return out.map(row => ({ operations: [], ...row, classificationMode: "automatic" }));
}

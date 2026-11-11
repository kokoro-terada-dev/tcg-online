# 手札公開と相手確認

隔離v3の subset.56 では、既存の `REVEAL_CARDS` に `"confirmation": "OPPONENT"` を指定できる。公開枚数は `selector.min` と `selector.max` に同じ値を指定する。条件なしは空の `all`、複数条件のAND・ORは `all`・`any` で表す。入れ子も既存Predicateの範囲で使用できる。

選択候補と支払い可否はサーバーで検証する。公開確定後、相手だけに確認トークンと選ばれたカードを表示し、確認応答後に同じ解決位置から続行する。公開設定なしの既存定義は従来どおり。公開した手札は移動しない。

EB05-007 の未承認JSONを `local-data/v3-eb05-reveal-confirmation/definitions` に生成した。EB05-008 は公開の共通処理を利用できるが、アクティブDON!!付与と公開の複合支払いは別途必要。

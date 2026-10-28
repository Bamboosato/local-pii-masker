# Prompt API追加検出PoC 実行ガイド

2026-10-28：今回のPrompt API採用は見送り。参照重複削減・分割の少数条件にも採用につながる改善がなく、条件付きNER併用評価へは進めなかった。[評価報告](prompt-api-poc-report.md)を参照。本ガイドと未公開PoCコードは検証の再現用として保持する。

## 位置付けと容量

要件の正本は [追加要件v0.1](local-pii-masker-prompt-api-poc-requirements-v0.1.md)。通常のRegex・ONNX NERを維持し、追加AIは利用者が明示実行した場合だけ使う。Cloud API、polyfill、Origin Trial、フラグは不要。対応表v1の形式・暗号方式は変更しない。

モデルのダウンロード先はChromeプロファイルのドライブであり、リポジトリのドライブとは別の場合がある。実装時の公式要件はプロファイルのドライブに22 GB以上の空き容量、Windows 10/11等、CPU経路ではRAM 16 GB以上と4コア以上、GPU経路ではVRAM 4 GB超。初回取得は非従量制ネットワークが必要。モデル容量は固定しない。

2026-10-27の初回実装開始時点でDドライブの空きは約1.95 GiBだった。初回実装では依存再インストール、ONNXモデル取得、Chromeモデル取得を行わず、既存のnode_modulesを使った。同日、利用者による容量確保後に専用Chromeで実モデルを取得し、実NERを含む通常UIと予備評価を実行した。実測時は使用するプロファイル・既存キャッシュと両ドライブの空きを先に確認する。既存ユーザーデータ・他プロジェクトのキャッシュを自動削除しない。

公式資料: [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)、[Built-in AI](https://developer.chrome.com/docs/ai/built-in-apis)。Web基本APIはChrome 148以降、日本語入出力とresponseConstraintを使う。Web Workerでは利用できないためWindow側の非同期アダプターを使う。samplingModeは別Origin Trial、temperature/topKは拡張機能向けなので指定しない。

## unavailableの原因と評価用Chromeの準備（2026-10-27）

### 容量確保後の実施結果

同日の後続評価ではC約89.53 GiB、D約6.11 GiBの空きを確認し、下記の専用プロファイルで `downloadable → downloading → available`、モデル準備完了、実モデルによる抽出を確認した。Chrome再起動後も日本語は `available`。取得済みモデルは `nano_v3_gpu_low_tier_model` / `2025.8.8.1141`、Broker表示はGPU、Folder Sizeは4,072.13 MiB。評価用Chrome終了後の空きはC約82.11 GiB、D約6.11 GiBだった。容量は変動するため再実行時にも確認する。

これは正式評価の完了ではない。調整用3文書各3回の比較では誤マスク・引用検証警告があり、追加AI単独の長文予備評価も完了しなかった。実行条件、負荷を変えた再測定、生API診断との差、正式100文書・長文A/B/C・人による確認負担の未実施範囲は[評価報告](prompt-api-poc-report.md#2026-10-27-容量確保後の実モデル予備評価)を参照。以下の容量不足時の数値と未取得の記述は、後続評価より前の調査記録である。

2026-10-28の再調整では50件の追加AI単独実行を保存した。原文引用enumは引用警告を減らす案だが、漏れ・誤マスク・API失敗は残った。構文空白の資源上限だけで正常完了や精度が改善したとは扱わない。最新の実行ファイル/終了プロファイル版はChrome156.0.8078.48で、前日155系と同条件の速度比較ではない。モデル版は終了前Brokerで2025.8.8.1141を再確認した。プロンプト・分割案の既定採用と正式100文書評価は保留。詳細は[後続調整報告](prompt-api-poc-report.md)を参照。

今回の自動化環境では、Playwright 1.61.1が既定の `--disable-features=...` に含める **`OptimizationHints` の無効化**が原因だった。同一の診断用プロファイルで、この1項目だけを既定状態へ戻すと、日本語・英語とも `unavailable → downloadable → unavailable` のA/B/A再現を確認した。背景通信・コンポーネント更新を抑止する他の引数はこの切り分けでは維持した。`downloadable` は取得可能という意味で、モデル導入・推論・精度確認の完了ではない。

Playwrightの通常のpage fixtureは非永続コンテキストだが、同じ1項目の変更後は非永続コンテキストでも `downloadable` になった。今回の直接原因をシークレット相当のコンテキストや日本語未対応へ置き換えて説明しない。ただし、実評価ではモデル・キャッシュを継続利用できる専用の通常プロファイルを使う。[調査結果と検証境界](prompt-api-poc-report.md)を参照。

### 1. 取得前の容量と端末確認

- `Get-PSDrive -Name C,D` と `chrome://version` のプロフィールパスで、保存先ドライブと空きを確認する。リポジトリの場所だけでは判定しない。
- 調査後の空きはC約21.53 GiB（約23.12 GB）、D約1.95 GiB。Cは公式の22 GB以上を満たすものの余裕が少ない。Dに評価用プロファイルやモデルを置かない。
- 取得前に、Cまたは別の保存先に**30 GiB程度以上**の空きを作業用目安として確保する。これは展開・更新・既存ONNX資材との併存を考えた運用上の目安で、公式の最低条件でも全モデルを保証する上限でもない。モデルサイズはChromeに依存する。不要データの削除や既存プロファイルの移動は利用者が対象を確認して行い、スクリプトで既存データ・キャッシュを一括削除しない。
- 実機はWindows 11 Enterprise 26200、Core Ultra 7 155U（12コア）、RAM約31.47 GiB、Intel Graphics、ドライバー32.0.101.8801。CPU経路の公式条件は満たす。WMIのAdapterRAM約2 GiBだけでGPU不可と判断しない。診断用Chromeはデバイス能力・ポリシー・ユーザー設定・容量を適格と判定した。接続コストはUnrestrictedだった。

### 2. 通常Chromeの専用プロファイルを使う

既存の普段使いプロファイルは変更・複製しない。評価用プロファイルを明示して通常Chromeを起動する。以下は**容量確保後に利用者が実行する例**であり、今回の調査では実行していない。`30GB` はPowerShellでは30 GiBを意味する。

```powershell
$evaluationProfile = Join-Path $env:LOCALAPPDATA 'LocalPiiMasker\ChromePromptPoc'
$profileRoot = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($evaluationProfile))
$profileDrive = [IO.DriveInfo]::new($profileRoot)
if ($profileDrive.AvailableFreeSpace -lt 30GB) {
  throw 'モデル準備前に、評価用プロファイルの保存先へ30 GiB程度以上の空きを確保してください。'
}
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' "--user-data-dir=$evaluationProfile" '--no-first-run' 'http://127.0.0.1:5173/experiments/prompt-api/'
```

先にリポジトリで `npm run dev -- --host 127.0.0.1 --port 5173` を起動する。同じプロファイルと同じlocalhostポートを評価期間中使う。ログイン・同期・外部AI APIキーは不要。通常起動の例には、`OptimizationHints` の無効化、背景通信・コンポーネント更新の抑止、性能要件の迂回、実験用モデルの強制指定を付けない。

`chrome://version` で実行ファイルの版・プロフィールパス・実コマンドラインを記録する。device設定由来のUser-Agent文字列だけでChromeの完全版を判断しない。`chrome://settings/ai` の「オンデバイス AI」を確認し、クラウドのAI機能を有効化する手順とは分ける。`chrome://policy` の `GenAILocalFoundationalModelSettings`、`BuiltInAIAPIsEnabled`、`ComponentUpdatesEnabled` 等に制限がある場合は管理者へ確認し、ポリシーを迂回しない。今回の診断用プロファイルのオンデバイスAIは既にオンで、モデル利用の企業ポリシー判定も有効だった。

### 3. Broker StateとAPI条件を確認する

1. `chrome://on-device-internals` の **Broker State** を開く。内部ページが無効と表示される版では、診断用プロファイルの `chrome://chrome-urls` にある **Enable internal debugging pages** を押して戻る。モデルの強制ロード、チェックボックスによるUse Caseの要求、Reset、Uninstall Modelsは押さない。
2. feature flag / enterprise policy / user setting、Device Capable、ディスク条件、Manifest Loaded、`prompt_api` のUnavailable Reason、モデルのFolder Sizeを記録する。内部の閾値はChromeの版に依存するため、公式要件の代わりに固定値として実装しない。
3. localhostのトップレベルページで、DevToolsから次の**利用可否照会だけ**を行う。評価ページの「モデルを準備」はまだ押さない。

```javascript
await LanguageModel.availability({
  expectedInputs: [{ type: 'text', languages: ['ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
});
```

`downloadable` なら今回の障害切り分けを通過している。`downloading` は取得中、`available` はセッション作成可能。`unavailable` が続く場合は英語条件も照会し、両方不可なら起動引数・ポリシー・設定・Broker Stateを優先して確認する。英語だけ可能なら言語条件を確認する。APIなし、HTTPS/localhost以外、トップレベル以外、Permissions-Policyで拒否された状態も分ける。アプリの現行ヘッダーは `language-model` を拒否しておらず、今回の切り分けページでもsecure context・許可ポリシーを確認した。

Chromeの[モデル管理資料](https://developer.chrome.com/docs/ai/understand-built-in-model-management)には、初回プロファイルのscam detection等とのタイミングによって `availability()` 照会でも取得が始まる場合があると記載されている。`create()` を呼ばなければChrome内部の取得が絶対に起きないとは説明しない。容量確認は照会前に済ませ、内部状態と残量を監視する。Event Logsには入力や応答が含まれ得るため、普段使いプロファイルの全ログをDumpしない。証跡は評価専用プロファイルの合成データと、必要な状態欄に限定する。

### 4. 明示準備から実評価へ進む順序

1. 容量と回線を再確認して、評価ページの「追加AIモデルを準備」を明示操作する。同じプロファイルを保持し、取得・初期化時間、進捗、取得前後の空きを記録する。Chrome内部で選ばれた実モデル名・版・Backend TypeをBroker Stateで確認する。マニフェスト中の候補モデル名だけで利用モデルを確定しない。
2. `available` 後、通常画面で合成短文を使い、既存検出の正常完了→追加AI抽出→引用の完全一致→選択適用→マスク・復元を確認する。通常UIのBは既存NER失敗時には開始できないため、ONNX側の資材・Worker準備も同じプロファイルで確認する。Chrome管理モデルとONNXの公開キャッシュは別管理。
3. 実モデルの準備・短文確認が成功してから、下記の調整用100文書→設定固定→最終用100文書各3回→長文各3回→確認負担の手動計測へ進む。失敗・警告・フォールバックを成功として除外しない。
4. Chromeまたはモデル版が変わったら結果を混在させない。更新があり得るため、実行前後にモデル版と容量を確認する。Chromeは残量低下や管理条件でモデルを削除することがあり、初回取得時の成功だけで後日のオフライン推論を保証しない。

通常のモックE2Eは大容量取得を避けるため既定の起動条件を維持する。実モデル自動化を追加する場合は別の明示opt-in経路と永続プロファイルを設け、実際の複合 `--disable-features=...` 引数から `OptimizationHints` だけを除く。単独の `--disable-features=OptimizationHints` を `ignoreDefaultArgs` に指定しても、既定の複合引数と一致しない。モデル準備経路ではコンポーネント更新・背景通信の抑止も別途点検する。今回、既存のE2E設定やアプリの利用不可判定は変更していない。

## 通常画面での操作

1. `npm run dev -- --host 127.0.0.1` で起動し、表示されたlocalhostのURLを通常のChromeで開く。HTTPSまたはlocalhostのトップレベルページを使う。
2. 合成文書を入力し「自動検出」を正常完了する。0件でもよい。NER失敗・中止時は再試行する。原文編集後は通常検出をやり直す。
3. 「追加AI検出（試験）」を開く。利用不可の場合は既存機能を継続する。「モデルを準備」は容量を確認してから押す。取得中も編集・中止できる。準備中止はChrome内部のダウンロード停止を保証しない。
4. 「追加AI検出を実行」を押す。進捗を確認し、必要なら「追加検出を中止」を押す。
5. 初期未選択の新規候補を確認する。「原文の次の箇所を確認」で同一文字列の出現を順に確認する。表示の置換対象数は曖昧姓保護後・他項目との最長一致適用前の数。既存一致とカテゴリ競合は選択できない。
6. 「選択した候補を追加」で最新状態と再照合して新規項目だけを有効化する。未選択分は破棄する。以後は既存の無効化・削除・関連付け・復元を使う。

原文編集、全消去、対応表読込、通常検出の再実行で一時一覧を破棄し、古い非同期応答を無視する。削除履歴は保持しないため、削除した文字列も次の明示検出で再提案され得る。

## 保存互換の制約

追加AI由来はメモリ内では `prompt-api`、v1保存時だけ `regex` に写像する。`ner` / `manual` に写像すると曖昧姓保護を迂回するため使用しない。読込時の許可値は既存3種のまま。識別子・トークン・対象・復元文字列は維持する。根拠、位置、生応答、一時候補は保存しない。

再読込後は追加AI由来を区別できず「形式・互換」と表示する。既存形式検出も同じ表示。手動追加や通常NERが後から同じ文字列を検出した場合は既存の検出元規則に従う。PERSON関連付けの保存は従来どおり拒否され、関連付け解除後に保存する。

## 合成データによる実モデル評価

優先度0〜2の新データ`development-v2-balanced`と`entities-source-id-v2`は、[専用runnerの手順](prompt-api-source-id-evaluation.md)でのみ比較する。以下の従来評価画面は旧データ・通常のv1出力形式のまま。sourceId方式を使う通常UIへの切替や保存形式の移行はしていない。評価器は可用性照会が5秒以内に返らなければモデル作成へ進まない。新しい測定の成否・除外試行・版の差は[報告書](prompt-api-poc-report.md)を参照。

開発サーバーの `/experiments/prompt-api/` を開く。評価ページは本番ビルドに含めない。通常アプリとは状態を共有せず、実文書を入力する欄も設けない。

1. `git rev-parse HEAD` と `git diff` / 未追跡ファイルを確認し、コミットと差分の有無を記録する。最終測定時はソースを固定し、必要なら差分のハッシュも記録する。
2. OS・Chromeの完全版・CPU・RAM・GPU・モデル準備状態を実機条件欄に記入する。`chrome://on-device-internals` で確認できないモデル版等は「不明」とする。モデルの準備は専用ボタンで別に行う。既存ONNXモデルの初回取得も容量確認が必要。
3. 「調整用100文書」でプロンプト・分割・上限を調整する。各設定は `src/domain/detection/prompt/config.ts` に集約する。
4. 設定を固定後「最終確認100文書」で実行する。調整用とは対象値・テンプレートを分離している。各3回、A→B→Cを文書ごとに逐次実行する。Cは独立したNano抽出で、NER結果を渡さずRegex起点の補助ルールだけを使う。最終正解を見て調整した場合は新しい最終セットを用意する。
5. 「長文」で1,000・10,000・30,000文字を各3回実行する。境界位置の単体検査に加え、実モデルでの境界跨ぎ・改行・表・JSON・命令文・UI応答性を手動確認する。
6. 「合成評価結果をJSON出力」を明示操作し、リポジトリ外またはignore対象の `output/playwright/` へ保存する。自動保存は行わない。JSONには設定、実機条件、各文書IDの結果、各回の指標、失敗を含むフォールバック結果を記録する。モデル生応答や根拠引用は含めない。

Bは検証済み新規候補を全選択した場合を評価し、人の選別で精度を水増ししない。位置単位の抽出証拠と最終置換範囲を分ける。未マスクは正解範囲が完全に隠れたか、誤マスクは正解範囲外を含む置換区間数・文字数で判定する。失敗文書は除外せず、BはAへのフォールバック、CはRegexのみの参考結果として完了率と併記する。境界誤りの種類は出力された文書IDから合成データと照合して追記する。

確認負担は別途、同じ評価者が固定10文書で「Aの手動補完」と「Bの候補確認＋手動補完」を各3回行う。開始は検出結果が表示された時点、終了は正解を満たす修正を終えた時点。A/Bの順を交互にし、却下・追加・修正の回数、確認時間、習熟を記録する。未実施なら採用判断は保留。

## 設定初期値と失敗の再現

### 調整用の比較器（2026-10-28）

通常画面の既定値は以下の初期値を維持する。`experiments/prompt-api/tuning.ts` のfactoryで、日本語/英語指示、固定合成例、カテゴリ別制約、原文引用enum、512/1,024文字等の窓、空白だけの区間の除外、実行内の同一区間再利用を比較できる。空白除外は外側だけで、元のUTF-16開始位置と内部の空白を保持する。再利用は構造・引用検証を通り棄却を含まない応答だけで、各区間位置で再検証し、終了時に参照を解放する。通常UIでこれらの実験設定を自動有効化しない。

同じ評価用Chrome・localhost・取得済みモデルを使い、他のテストやモデル呼出しと同時実行しない。次は開発ページのDevToolsで行う、調整用合成文書だけの明示的な1文書診断例である。

```js
const tuning = await import('/experiments/prompt-api/tuning.ts');
const controller = new AbortController();
// 中止する場合は別操作で controller.abort() を呼ぶ。
const result = await tuning.evaluateTuningDocument(
  tuning.shortQuoteTuningVariants()[0], 'varied-1000', controller.signal,
);
```

`result` は文書ID、指標、件数・長さ、固定分類の失敗診断だけを持つ。生応答、原文引用、例外本文を保存・ログ出力しない。原文引用enumは実行時のメモリ内に限定する。出力が必要なら合成評価の明示操作でignore対象へ保存する。モデル測定中にソースを編集するとViteの再読込で未保存結果が失われるため、設定変更の前に完了・保存を確認する。

失敗時の `aborted`、`contextBudget`、`responseLimit`、`overflow` とAPI名を分ける。`UnknownError` だけで言語や安全判定が原因と断定しない。公開例外定数との完全一致から `apiDetail` を得られる場合も、内部原因が公開されない `unknown` は未確定とする。空白件数は引用内部も含む単なる件数であり、空白だけの無意味な生成と自動判定するものではない。失敗は空の抽出で漏れを計上し、完了率を別記する。

Top-K=1・temperature=0の参考値を、ONNXのトークン分類NERと生成モデルで混同しない。確認時点の通常Webでは数値のtopK/temperatureは拡張機能向けで、samplingModeは別のOrigin Trialが必要である。今回の安定Web評価はtopK、temperature、topP、samplingModeを指定していない。[Chrome公式資料](https://developer.chrome.com/docs/ai/prompt-api)を再確認する。

### 通常画面の初期値

分割1,600 UTF-16単位、重複200、区間60秒、全体300秒（取得・初期化を除く）、応答65,536 UTF-16単位、区間候補128件、全体候補1,024件、証拠位置50,000件、出力用余裕2,048トークン。2026-10-28に、JSON文字列外の連続構文空白1,024文字の資源上限を追加した。文字列内の空白には適用しない。`formattingLimit` 超過は応答を破棄する失敗で、タイムアウトの解消・精度改善・成功0件として数えない。コンテキスト計測失敗・超過・overflowも成功扱いしない。上限による切捨てはしない。プロンプトと窓の初期値は実モデルの採用基準を達成した設定ではない。

`npm test -- src/domain/detection/prompt src/components/AdditionalDetectionPanel.test.tsx experiments/prompt-api/evaluate.test.ts` は不正JSON・構造違反・幻覚・競合・中止・応答しないPromise・保存互換を再現する。`npx playwright test e2e/prompt-api.spec.ts --project=chrome` は通常ChromeのバイナリをPlaywright既定引数で起動し、`--project=msedge` はEdgeで対象E2Eを逐次実行する。前者の利用可否照会は通常起動のChromeや実モデル準備状況の判定ではない。APIモックによる成功はモデル精度・実機速度・オフラインNERの証明ではない。

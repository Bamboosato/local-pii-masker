# 実装・文書の照合結果

確認日：2026-10-06。対象はREADME、`docs/`の既存15文書、`AGENTS.md`、実装、既存テスト、package scripts、Vite・Playwright・Vercel設定。

GitHubの`main`は照合開始時点で`716077e`、ローカルはその上に文書修正コミット`5480da1`を持つ。両者のアプリ実装は同じで、ローカルの未反映文書修正を保持したうえで追補した。本書は要件を置き換えず、ソースから確認できる機能と受入条件の未達を区別する。過去のブラウザ計測は今回の再実行結果として扱わない。

## 確認観点

ケースを確認する前に、次の観点を整理した。

| 観点 | 正常系 | 異常系 | 境界値 | 状態遷移 |
| --- | --- | --- | --- | --- |
| 機能 | 入力、検出、手動追加、マスク、コピー、復元 | NER失敗、中止、誤パスフレーズ、破損 | 候補0件、未知トークン、空原文 | 再検出、無効化、関連付け、保存後の再読込・解除 |
| 非機能 | ブラウザ内処理、Worker、公開資産キャッシュ | 通信失敗、OPFS非対応、保存競合 | 30,000文字、端末メモリ差 | オフライン、PWA更新、ページ離脱 |
| データ | NFC、完全一致、最長一致、復元文字列 | トークン衝突、非一意対応 | 一文字姓、空白・改行、全半角 | 原文編集後の出現数、保存で除外される情報 |
| UI | タブ、検索、対象への移動、ダイアログ | エラー・無効理由・コピー確認 | 対象0件、未出現項目、狭幅 | 正規化ロック、フォーカス復帰、復元領域の開閉 |

同一実機への並列ブラウザ実行は行わない。合成データだけを使い、失敗時は入力断片ではなく条件・期待結果・件数を記録する。

## 実装されている機能と根拠

「実装あり」は全環境・全受入条件の検証完了を意味しない。

| 機能 | 現行の挙動・制約 | 主な実装・テスト |
| --- | --- | --- |
| 原文編集・表示 | CodeMirror、NFC、30,000 UTF-16コード単位上限。原文／マスク結果タブ。結果は読み取り専用 | [App](../src/App.tsx)、[エディター](../src/components/OriginalTextEditor.tsx)、[Appテスト](../src/App.test.tsx) |
| 形式検出 | メール、電話、郵便番号、HTTP(S) URL、IPv4/IPv6、ラベル付き認証情報・生年月日、日本語住所、人名・組織名補助 | [検出入口](../src/domain/detection/regex/runRegexDetection.ts)、同ディレクトリの単体テスト |
| ローカルNER | 固定モデル・リビジョン、WASM/q8、320文字・64文字重複。Worker、5分タイムアウト、中止・再試行 | [Worker](../src/domain/detection/ner/nerWorker.ts)、[設定](../src/domain/detection/ner/types.ts)、[実行テスト](../src/domain/detection/ner/runNerDetection.test.ts) |
| OCR検出補正 | 原文を書き換えず検出用文字列を補正し、原文位置へ戻す。復元は検出時に確定した補正後表記 | [検出正規化](../src/domain/normalization/detection/normalizeForDetection.ts)、[候補統合](../src/domain/detection/mergeCandidates.ts) |
| 候補確認 | 初期有効、無効化・再有効化・削除、検索、出現位置確認、信頼度・補正チップ。カテゴリは登録後固定 | [Reducer](../src/app/reducer.ts)、[Selectors](../src/app/selectors.ts)、[Reducerテスト](../src/app/reducer.test.ts) |
| 手動追加 | 原文選択、カテゴリ・全出現数の確認、重複項目の再利用。空白だけは拒否 | [App](../src/App.tsx)、[Reducerテスト](../src/app/reducer.test.ts) |
| マスク生成 | 原文基準、最長一致。同じ文字列を原則一括置換 | [マスク生成](../src/domain/mask/maskText.ts)、[単体テスト](../src/domain/mask/maskText.test.ts) |
| 曖昧姓の文脈判定 | 固定方式。自動検出の曖昧な一文字姓だけ一般語を除外。手動・明確な姓名・二文字以上の姓は全出現対象 | [文脈判定](../src/domain/mask/contextualMasking.ts)、[辞書](../src/domain/reference/singleSurnameCommonWordRules.ts)、[テスト](../src/domain/mask/contextualMasking.test.ts) |
| 同一人物関連付け | 新規は2件以上、既存グループ追加は1件以上。共通トークン・代表復元表記。外部回答入力中は関連付け・解除不可。有効切替はグループ全体 | [Reducer](../src/app/reducer.ts)、[ラベル](../src/app/relatedGroupLabels.ts)、[Reducerテスト](../src/app/reducer.test.ts) |
| トークン | 日本語カテゴリ名と連番。原文と登録済みトークンを避ける。別セッションの一意性は保証しない | [生成](../src/domain/mask/tokenFactory.ts)、[テスト](../src/domain/mask/tokenFactory.test.ts) |
| コピー | 表示中のマスク結果をコピー。有効対象0件では原文と同じ内容をコピーする前に確認 | [App](../src/App.tsx)、[Appテスト](../src/App.test.tsx) |
| 復元・検査 | 残っている既知トークンを全置換。既知・未出現・未知を分類。意味推測はしない | [復元](../src/domain/mask/restoreText.ts)、[検査](../src/domain/mask/inspectTokens.ts)、[テスト](../src/domain/mask/restoreText.test.ts) |
| 任意のテキスト正規化 | 検出前の標準／検出優先、Worker、比較・適用。適用後は新しい原文。正常検出0件でもロック、手動追加後もロック | [正規化Hook](../src/hooks/useTextNormalization.ts)、[エンジン](../src/domain/normalization/document/normalizeDocumentText.ts)、[利用条件](../src/app/normalizationAvailability.test.ts)、[E2E定義](../e2e/hardening.spec.ts) |
| 暗号化対応表 | 明示保存のみ、AES-GCM/PBKDF2/gzip、OPFS。管理・上書き・新規・読込・個別/全削除。原文・結果・位置・無効候補は保存しない | [暗号](../src/domain/mapping/crypto.ts)、[Repository](../src/domain/mapping/opfsRepository.ts)、[スナップショットテスト](../src/domain/mapping/snapshot.test.ts)、[ダイアログテスト](../src/components/MaskMappingDialogs.test.tsx) |
| 現在の作業消去 | メモリ上の作業を初期化。保存済み対応表と公開モデルキャッシュは別管理 | [Reducer](../src/app/reducer.ts)、[Appテスト](../src/App.test.tsx) |
| PWA | 本番ビルドのManifest/SW、公開アプリ資産だけをSWキャッシュ。モデルキャッシュはTransformers.jsが管理。更新は明示適用 | [PWAクライアント](../src/pwa/pwaClient.ts)、[SWテンプレート](../src/pwa/service-worker.template.js.txt)、[E2E定義](../e2e/pwa.spec.ts) |
| セキュリティ境界 | CSPと配信ヘッダー、機密情報のソース監査。外部生成AI API、分析・監視、ユーザー履歴機能はない | [ヘッダー](../config/securityHeaders.ts)、[監査テスト](../scripts/security/privacySourceAudit.test.ts)、[Vercel設定](../vercel.json) |

## 修正した文書の不整合・記載漏れ

- READMEへ正規化、文脈付き曖昧姓、関連付け、トークン、消去と保存削除の区別、起動・検証手順を追記した。
- 要件・アーキテクチャの旧ランダムトークン案を現行形式に更新し、関連付けの共通トークンと復元文字列を明示した。
- NER評価のPRD/EVTカテゴリ、実行例のバックエンド・リビジョン、選定完了と過去の候補評価を区別した。
- 30,000文字の開発環境実測は既存記録にあり、全面未実施とするREADMEを修正した。実機再計測は今回行っていない。
- 正規化要件の「暗号化セッション」という誤記を「暗号化マスク対応表」に修正し、全文・ドラフト非保存を明示した。
- 正規化・UI文書の「実装前」「未確定」を現行状態と残課題へ整理した。設計上の分割案を実在ファイルと区別した。
- UI設計の節番号・受入ID重複を解消し、旧IDとの対応を記載した。
- プライバシー文書で保存操作後も原文を含む作業は再開できないことと、平文インデックスのランダムIDを補足した。

## 未達事項と優先度

| 優先度 | 差異・未確認事項 | 根拠と影響 |
| --- | --- | --- |
| 重大 | 保存後に再読込した関連付けの解除で個別対応が戻らない | `snapshot.ts`/`reapply.ts`に関連付け前のトークン・復元表記がなく、全解除時に同じ新規トークンを生成する。別表記の復元を取り違える。合成2項目で再現済み |
| 重大 | 保存対応の一対一制約とValidatorが不一致 | FR-18A・保存要件4節は共通トークンの複数対象を拒否するが、Validatorはカテゴリ・復元表記・関連IDが同じなら許可。関連IDなしでも同じ値なら許可する。要件を緩めず、保存範囲の判断が必要 |
| 重大 | OPFS障害復旧・競合の結合テストがない | 正常系の暗号・スナップショット成功から、実ファイルの破損・部分書込み・複数タブ競合を検証済みとは言えない |
| 軽微 | 対応表読込後に復元領域が閉じない | `loadMaskMapping`が`restoreExpanded`を戻さず、UI-AC-15A未達。開いた状態からのReducer読込で再現済み |
| 要評価 | 孤立・一時ファイルの起動時検出がない | Repositoryは欠損表示・インデックスバックアップ復旧を持つが、孤立ファイル・未完了一時ファイルを提示する走査がない |
| 軽微 | 初回モデル容量・取得率の表示がない | NFR-05の容量表示に対し、Worker/UIは準備中／実行中の段階表示のみ。モデル取得の進捗コールバックはファイル情報を通知しない |
| 要評価 | 30,000文字のコア性能継続計測と本番NER再計測 | `benchmark:core`は1,000・10,000文字のみ。開発サーバー上の30,000文字の過去NER実測と別に、回帰予算・本番プレビュー証跡が必要 |
| 要評価 | 正規化30,000文字・両モードの性能/誤結合率 | 基本機能・単体テスト・E2E定義は存在するが、対象環境すべての性能予算達成と受入完了は未確認 |
| 要評価 | 8GB級PC、macOS、低速回線、最低ブラウザ版 | NER評価文書で延期・未確定。今回のWindowsソース確認やVitestから他環境へ一般化しない |

保存に関する詳細は[対応表の実装確認メモ](local-work-history-implementation-status.md)を参照する。上記の実装不具合は今回修正していない。

### 合成データでの状態遷移再現

意図は、関連付け単独の成功ではなく、永続化で失われる前提を含む通しの操作でAC-07bとUI-AC-15Aを確認すること。実OPFSのI/Oや暗号処理は実行せず、現行ドメイン関数・ReducerをNode.js/tsxで呼び出した。

1. 原文`検証太郎と検証`へ、人名として`検証太郎`と`検証`を手動追加する。
2. 2項目を同じグループに関連付け、代表復元表記を`検証太郎`とする。
3. `createMaskMappingSnapshot`へ変換し、JSONのシリアライズ・パースで永続化対象だけを残す。複数対象の共通トークンが受理される。
4. 元の作業を保持しない初期状態から`loadMaskMapping`する。復元領域を開いた状態にしていると、読込後も`restoreExpanded === true`となる。
5. `unlinkRelatedGroup`する。関連IDは全項目から消えるが、項目数2に対して一意なトークン数1・一意な復元表記数1となる。期待は各元トークンと各元復元表記への復帰である。
6. 保存対象から`relationId`を外して`validateMappingUniqueness`へ渡しても、同カテゴリ・同復元表記の共通トークンは受理される。

既存テストはインメモリの関連付け解除と保存用スナップショットを個別に確認しており、この再読込後の解除を通しで確認していない。分類は「実装問題」と「状態遷移のテスト観点不足」。再発防止では保存対象から除外するフィールドの影響を明示し、保存→読込→解除→再復元を1つのシナリオで検証する。

## AGENTS.mdの整合更新

`AGENTS.md`に残っていた「ブラウザ保存の全面禁止」「トークン形式未確定」「PoCモデル」「scaffold未作成」を、上位の現行要件へ合わせて更新した。初回は統制ルールの変更に対する明示承認がないため自動承認レビューに拒否されたが、2026-10-06に所有者から`AGENTS.md`更新の明示承認を受けて反映した。

原文・処理結果・作業セッションの非保存、外部送信禁止を維持し、明示保存した有効な対応表だけを暗号化OPFSへ保存する限定例外と一覧用平文メタデータを明示した。文脈付き曖昧姓、同一人物関連付け、検出前正規化、PWA、現行モデル・トークン・データ型・検証手順も整理した。保存対応の一対一制約や、保存後の関連付け解除などの未達事項は変更・解消していない。

## 今回の検証結果と範囲

| 検証 | 結果・範囲 |
| --- | --- |
| GitHub照合 | `git ls-remote`、`gh repo view`でリポジトリとmainのSHAを確認。ローカル未反映コミットは文書だけ |
| `npm run lint` | 成功 |
| `npm run typecheck` | 成功 |
| `npm test` | 43ファイル、399テスト成功。既存のソースプライバシー監査を含む |
| `npm run build` | 成功。既存の500kB超チャンク警告あり（メインとNER Worker） |
| 合成状態遷移プローブ | 保存用変換→読込→解除の衝突、関連IDなし共通トークン受理、復元領域の開閉保持を再現 |
| 文書リンク・記載コマンド・差分 | READMEと本書を含む17ファイルの相対リンク113件、記載npm scripts、UI受入ID重複を確認し、問題0件。`git diff --check`成功（WindowsのLF→CRLF変換予告のみ）。実装・依存ファイルの変更なし |

E2E範囲は「未実施」とした。変更は文書のみでUI/Worker/保存処理を変更しておらず、今回の実装差異はドメイン関数の状態遷移で再現できたためである。Chromium/Edgeの描画・キーボード実操作・ネットワーク/Storage/Console監査、実OPFSの保存復旧・競合は今回再検証していない。`test:e2e`、`test:e2e:edge`、`test:e2e:dev`、実モデルの再評価、性能ベンチマーク、依存脆弱性監査は未実施。過去の証跡を再実行結果に置き換えない。

AGENTS.mdの追補では、保存許可/禁止の境界、関連付けのインメモリ仕様と永続化制約、現行設定・参照先・package scriptsを照合した。AGENTS.mdと本書のファイル参照66件、プライバシー制約の維持、`git diff --check`を追加確認し、問題はなかった。実装変更を伴わないため、上表のコード検証とE2Eは再実行していない。

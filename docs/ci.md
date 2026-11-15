# CI・依存関係監査

## 実行条件と構成

`.github/workflows/ci.yml`はUbuntuとNode.js 24を使い、lockfileに従って`npm ci`で導入する。GitHub Actionsの権限は`contents: read`のみで、アプリの認証情報・本番サービスの秘密情報を渡さない。Actionsは確認したコミットSHAへ固定する。

| 条件 | Dependency audit | Verify |
| --- | --- | --- |
| main宛てPR・mainへのpush | 実行 | 実行 |
| 毎週月曜日09:00 JST | 実行 | スキップ |
| 手動実行 | 実行 | 実行 |

週次・手動実行はワークフローのデフォルトブランチ反映後に有効となる。同じイベント・PR/ブランチの古い実行はキャンセルする。監査と検証は独立したジョブとし、監査失敗でも基本検証の証跡を残す。

## 依存監査の判定

`npm run audit:dependencies`はnpmのJSエントリーポイントを直接呼び、シェルへ文字列を展開しない。

1. `npm audit --json --omit=dev`で本番依存を監査する。
2. `npm audit --json`で開発依存を含めた全依存を監査する。
3. 監査レポートの版・構造・重大度別件数・合計を検証する。
4. 全重大度（info / low / moderate / high / critical）で検出0件の場合だけ成功する。
5. npmの終了コード1は検出結果として解析するが、成功とは扱わない。通信失敗、120秒のタイムアウト、異常終了、不正JSON、欠落・不整合レポートも失敗とする。

例外設定は導入していない。開発用依存やブラウザーで実行しないNode向け依存も、監査対象から一括除外しない。将来修正不能な問題が発生した場合は、実際の利用経路・影響を評価し、例外の必要性、対象パッケージ・版・アドバイザリー、期限、責任者を別の変更としてレビューする。既存の厳格な判定を黙って緩めない。

`.security-audit/production.json`と`full.json`はGit管理しない。CIでは失敗時もアーティファクトとして14日間保存する。不正JSONの場合は生の出力を保存せず、失敗理由をJSONで残す。

## 基本検証とE2E範囲

Verifyはlint、typecheck、Vitestの単体/統合テスト、buildを実行した後、Chromiumを導入し、`test:e2e:dev`と`test:e2e`を順に実行する。ブラウザーは1ワーカーで、同一実機に対する並列実行をしない。リトライだけで成功したケースは安定成功と区別して確認する。

現在の対象は開発サーバーCSP疎通1件と、本番プレビューの11件（CSP/ヘッダー、復元領域レイアウト、正規化Worker、入力の通信・Storage・Console非混入とNER障害時の継続、axe、Manifest/SW、ウォームキャッシュでのオフライン起動、公開キャッシュへの入力非保存、実OPFSの保存・上書き・再読込・復元・削除、原文選択の緑系表示と追加完了後の青系表示、文字数行の原文消去ボタン）。目的はブラウザー依存の主要境界を継続確認することであり、全機能・全環境の受入試験ではない。大容量の実モデル取得・新Workerのオフライン試験は`RUN_REAL_NER_E2E=1`で明示実行し、通常CIではスキップする。実NER成功とキャッシュ失敗時の縮退を試験注釈で区別する。

実際にインストールされたChromeでの対象確認には`--project=chrome`、Edgeには`--project=msedge`を使用する。通常CIは引き続きChromiumを使用し、同一端末のブラウザーは1ワーカーで順に実行する。

本番E2EのNER障害シナリオは外部への要求を遮断する。PRの通常CIでは大容量の公開モデルを取得せず、実NER精度・長文性能、Windows/Edge、8GB級端末、macOS、低速回線、実OPFSの保存復旧・複数タブ競合を検証済みとしない。オフライン起動テストも、オフライン実モデル推論の成功を証明しない。変更リスクに応じて別途対象ケースを選択する。

`output/playwright/`のHTMLレポート、失敗時トレース・スクリーンショットは14日間保存する。テストには合成データだけを使い、実際の個人情報・対応表・パスフレーズをアーティファクトへ含めない。

## mainの必須チェック

GitHubのブランチ保護で`Dependency audit`と`Verify`をGitHub Actions由来の必須チェックにする。mainの最新状態に対する成功を要求し、管理者にも適用する。レビュー人数の追加要求は行わず、PR経由の変更と成功したチェックを条件にする。強制pushとブランチ削除は許可しない。

ワークフローの追加だけではマージを禁止できない。初回はPR上の実行結果を確認してから設定し、設定をAPIで読み戻す。必須チェック名を変える場合は、ワークフローとブランチ保護を整合させる。

## 依存更新時の確認

2026-10-30の原文選択UIのPR準備では、mainの全依存監査で5パッケージ（High 3 / Moderate 2）が検出された。本番依存の検出は0件。必須監査を通すため、Vite 8.1.4→8.1.6、Vitestと内部のexact依存4.1.11→4.1.12、undici 7.30.0→7.30.1、zod 4.4.3→4.6.7へ最小限の更新を行う。変更は開発依存の経路に限定し、本番依存、メジャー版、監査ポリシーや例外設定は変更しない。Prompt APIの実装・評価資料はこのPRに含めない。

- lockfileの変更対象と監査結果を確認し、不要なメジャー更新や無関係なパッケージ更新を避ける。
- lockfileの再生成にはCIと同じnpm版を使い、任意依存も記録する。初回導入ではWindows/npm 11.6.2の更新結果に`@emnapi/runtime`が欠落し、Ubuntu/npm 11.19.0の`npm ci`が停止した。npm 11.19.0の`install --package-lock-only --ignore-scripts`で補完した。通常CIの`npm ci`を`npm install`へ置き換えて不整合を隠さない。
- Transformers.jsの更新では、直接指定する`onnxruntime-web`をTransformers.jsが要求する版に正確にそろえる。配信するWASM/MJSと推論コードの不一致を`runtimeDependencies.test.ts`で検出する。
- `test:security`、lint、typecheck、単体/統合テスト、build、対象E2Eを実施する。監査が失敗する条件は合成レポートで再現し、実ネットワーク断に依存するフレークを避ける。
- NER runtime変更時は本番プレビューで実モデルの読込・推論・マスク反映を確認する。モデル評価結果には実行したTransformers.jsの版を出力し、古い測定値の版を上書きしない。

2026-10-06の更新では、本番依存7件（High 4 / Moderate 3）、全依存16件（High 10 / Moderate 6）の影響パッケージを修正し、両監査が0件になった。Transformers.jsは4.3.0、Vitestは4.1.11へ更新し、ONNX Runtime WebはTransformers.js指定の`1.31.0-dev.20260914-8d85527a0`へ固定した。Transformers.jsはApache-2.0、ONNX Runtime WebはMITの既存依存である。ネットワーク・保存境界やモデルリビジョンを変更していない。

Windows上の本番プレビューで合成文の実モデルNERを確認し、AI候補5件とマスク6件が表示された。観測した23要求はアプリ配信元・Hugging Faceの公開資材配信元へのGETのみで、合成マーカー混入0件、pageerror 0件だった。モデル応答のブラウザーキャッシュ追加警告1件があり、オフライン実NERの受入成功とはしない。この短文確認を精度・性能の再評価と混同しない。

CI導入前のE2Eでは、正規化ダイアログの旧寸法検査1件が失敗した。保存対応時のコミット`716077e`で共通寸法へ変更済みだったため、UIを変えずに旧設計文書と期待値を同期した。ヘッダー・フッターの余白、タイトル、操作ボタンの寸法を引き続き明示的に検査する。

### 2026-11-16: minimatch監査の部分修正（未解消）

2026-11-09の週次監査は、本番依存0件・全依存Moderate 10影響パッケージで失敗した。根本原因は開発用lint依存に含まれるminimatchの[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)（細工したglobの前処理による資源消費）1件であり、10件の独立した脆弱性や本番アプリの情報流出を示すものではない。

通常の許容バージョン範囲内で、lockfileのESLintを10.6.0から10.15.0、`@eslint/config-array`を0.23.5から0.23.6へ更新し、両経路のminimatchを修正済み11.0.8へ移した。必要なESLint配下の推移依存以外は更新しない。本番依存、アプリコード、監査ポリシー、CI設定は変更しない。

部分修正後も、`typescript-eslint`経路のminimatch 10.2.5が残り、全依存監査はModerate 7影響パッケージで失敗する。本番依存は0件。調査時の最新版`@typescript-eslint/typescript-estree` 8.72.2もminimatch `^10.2.2`を要求するため、通常更新だけでは解消できない。監査の除外、`audit fix --force`による旧版への変更、要求範囲外のmajor版を強制するoverrideは行っていない。上流修正版、または別途検証・レビューした互換性修正が必要であり、この部分修正だけでマージ可能とは扱わない。

ローカルではNode.js 24.22.1、npm 11.19.0でlockfileを更新し、`npm ci --ignore-scripts`、lint、typecheck、47ファイル452テスト、buildを確認した。全テストにはsecurity 19件を含む。buildには既存の500kB超チャンク警告がある。監査のnpm scriptは検証環境のUnixソケット制約でtsx CLIが起動できなかったため、同じスクリプトを`node --import tsx`で実行して上記失敗を確認した。アプリ・ブラウザー実行依存を変更しないため、ローカルE2E、実NER、Windows/Edgeでの再試験は行わない。PRのCI結果は別途確認する。

### 同日追補: typescript-estree限定overrideを検証

上記は部分修正時点の記録。続く隔離worktreeでの比較検証により、`@typescript-eslint/typescript-estree@8.63.0`配下に限りminimatch `11.0.8`を指定する暫定overrideを追加した。全依存一律のoverrideや監査除外ではない。上流の要求範囲`^10.2.2`外のmajor変更である点は残るため、上流が修正版を通常依存として採用した時点でoverrideと対応する固定版テストを再評価・除去する。親の版を限定し、将来の更新へ無条件に適用しない。

- 使用APIは`useProgramFromProjectService`のCommonJS `minimatch(filePath, pattern, { dot: true })`一箇所。現在のESLint設定ではprojectServiceは有効化していない。
- 旧10.2.5と11.0.8で、dotfile・拡張子・brace・extglob・globstar・日本語・相対パス等の210組合せを比較し一致を確認。
- 恒久テストを2件追加し、実際の親からの解決版・override範囲・使用APIと、実parserのprojectService allowDefaultProjectに対するdotfile包含/非対象除外を確認。
- minimatch 11.0.8のNode要件は20または22以上。CIのNode 24と整合する。旧Node 18互換は保証しない（現ESLintもNode 20.19以上を要求）。依存のBlueOak-1.0.0ライセンスは10系から不変。
- npm 11.19.0でlock更新とクリーン導入成功。lint/typecheck、security 21件、全48ファイル454件、build成功。本番監査・全依存監査とも0件。監査は前述の環境制限により同じスクリプトを`node --import tsx`で実行。
- 本番依存・アプリソース・CI・監査判定は不変更。隔離前後でビルド資材の内容ハッシュも同じ。既存の大きなチャンク警告は残る。ローカルブラウザー再試験・実NER・Windows/Edgeは未実施、PRの最新headでCIを再確認する。

これは対象APIと現在のアプリの検証であり、minimatch 10/11の全API互換を保証するものではない。将来projectService設定やtypescript-eslintを変更する場合も、上流更新状況と対象テストを再確認する。

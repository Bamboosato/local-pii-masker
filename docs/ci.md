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

現在の対象は開発サーバーCSP疎通1件と、本番プレビューの9件（CSP/ヘッダー、復元領域レイアウト、正規化Worker、入力の通信・Storage・Console非混入とNER障害時の継続、axe、Manifest/SW、ウォームキャッシュでのオフライン起動、公開キャッシュへの入力非保存、実OPFSの保存・上書き・再読込・復元・削除）。目的はブラウザー依存の主要境界を継続確認することであり、全機能・全環境の受入試験ではない。大容量の実モデル取得・新Workerのオフライン試験は`RUN_REAL_NER_E2E=1`で明示実行し、通常CIではスキップする。実NER成功とキャッシュ失敗時の縮退を試験注釈で区別する。

本番E2EのNER障害シナリオは外部への要求を遮断する。PRの通常CIでは大容量の公開モデルを取得せず、実NER精度・長文性能、Windows/Edge、8GB級端末、macOS、低速回線、実OPFSの保存復旧・複数タブ競合を検証済みとしない。オフライン起動テストも、オフライン実モデル推論の成功を証明しない。変更リスクに応じて別途対象ケースを選択する。

`output/playwright/`のHTMLレポート、失敗時トレース・スクリーンショットは14日間保存する。テストには合成データだけを使い、実際の個人情報・対応表・パスフレーズをアーティファクトへ含めない。

## mainの必須チェック

GitHubのブランチ保護で`Dependency audit`と`Verify`をGitHub Actions由来の必須チェックにする。mainの最新状態に対する成功を要求し、管理者にも適用する。レビュー人数の追加要求は行わず、PR経由の変更と成功したチェックを条件にする。強制pushとブランチ削除は許可しない。

ワークフローの追加だけではマージを禁止できない。初回はPR上の実行結果を確認してから設定し、設定をAPIで読み戻す。必須チェック名を変える場合は、ワークフローとブランチ保護を整合させる。

## 依存更新時の確認

- lockfileの変更対象と監査結果を確認し、不要なメジャー更新や無関係なパッケージ更新を避ける。
- lockfileの再生成にはCIと同じnpm版を使い、任意依存も記録する。初回導入ではWindows/npm 11.6.2の更新結果に`@emnapi/runtime`が欠落し、Ubuntu/npm 11.19.0の`npm ci`が停止した。npm 11.19.0の`install --package-lock-only --ignore-scripts`で補完した。通常CIの`npm ci`を`npm install`へ置き換えて不整合を隠さない。
- Transformers.jsの更新では、直接指定する`onnxruntime-web`をTransformers.jsが要求する版に正確にそろえる。配信するWASM/MJSと推論コードの不一致を`runtimeDependencies.test.ts`で検出する。
- `test:security`、lint、typecheck、単体/統合テスト、build、対象E2Eを実施する。監査が失敗する条件は合成レポートで再現し、実ネットワーク断に依存するフレークを避ける。
- NER runtime変更時は本番プレビューで実モデルの読込・推論・マスク反映を確認する。モデル評価結果には実行したTransformers.jsの版を出力し、古い測定値の版を上書きしない。

2026-10-06の更新では、本番依存7件（High 4 / Moderate 3）、全依存16件（High 10 / Moderate 6）の影響パッケージを修正し、両監査が0件になった。Transformers.jsは4.3.0、Vitestは4.1.11へ更新し、ONNX Runtime WebはTransformers.js指定の`1.31.0-dev.20260914-8d85527a0`へ固定した。Transformers.jsはApache-2.0、ONNX Runtime WebはMITの既存依存である。ネットワーク・保存境界やモデルリビジョンを変更していない。

Windows上の本番プレビューで合成文の実モデルNERを確認し、AI候補5件とマスク6件が表示された。観測した23要求はアプリ配信元・Hugging Faceの公開資材配信元へのGETのみで、合成マーカー混入0件、pageerror 0件だった。モデル応答のブラウザーキャッシュ追加警告1件があり、オフライン実NERの受入成功とはしない。この短文確認を精度・性能の再評価と混同しない。

## 2026-10-27 開発依存5パッケージの監査修正

Prompt API PoCの検証時に検出した全依存5パッケージ（High 3 / Moderate 2）を、互換性を保つ範囲で修正版へ更新した。いずれも開発依存の経路であり、実アプリからの攻撃到達を実証したという意味ではない。既知の脆弱版を導入ツリーから除き、厳格な監査を再実行する方針とした。

| パッケージ | 更新前 → 更新後 | 依存経路・修正境界 |
| --- | --- | --- |
| vite | 8.1.4 → 8.1.6 | 直接の開発依存。Vite 8.1系のサーバー・launch-editor修正 |
| vitest | 4.1.11 → 4.1.12 | 直接の開発依存。内部のexact版依存も同時更新 |
| @vitest/mocker | 4.1.11 → 4.1.12 | Vitest経由。Windowsバックスラッシュを含むredirect境界の修正 |
| undici | 7.30.0 → 7.30.1 | jsdom経由。EventSource等の修正版 |
| zod | 4.4.3 → 4.6.7 | eslint-plugin-react-hooks経由。修正境界4.6.6以降を既存範囲で解決 |

修正境界の一次資料：[Vite](https://github.com/advisories/GHSA-9jrq-w75r-8gcw)、[Vitest/mocker](https://github.com/advisories/GHSA-xp26-3454-mjgp)、[undici](https://github.com/advisories/GHSA-4qv8-2p9j-2685)、[zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。個別アドバイザリーの重大度と、同じパッケージに対する複数検出を含むnpm監査の重大度は区別する。

`package.json`の変更はVite/Vitestの下限だけ。lockfileの変更は対象パッケージとVitest内部の11パッケージに限定し、既存項目の削除・本番依存の変更・overrides・監査例外追加はない。React、Transformers.js、ONNX Runtime Web、モデルリビジョンを維持する。導入済み版とlockfileの一致、脆弱版の重複が残らないこと、既存のpeer/engine範囲、Linux/Windows用の任意依存の記録を確認した。追加の回帰テストファイルは作らず、既存の監査ゲートと動作検査を再実行した。

### 検証観点と結果

先に、機能（マスク・復元・PoC）、非機能（通信・保存・CSP）、データ（lockfile・暗号保存・キャッシュ分離）、UI（通常操作・キーボード・a11y）の観点を設定。正常系、異常系、境界値、状態遷移は既存テスト群で確認し、同一実機のブラウザーは逐次実行した。

| コマンド・確認 | 結果 |
| --- | --- |
| `npm run lint` / `npm run typecheck` | 成功 |
| `npm run test:security` | 3ファイル・19件成功。全重大度・不正レポート・通信失敗を失敗にする既存監査ポリシーも維持 |
| `npm run audit:dependencies` | production/fullとも全重大度0件、成功。元の5パッケージ検出は再現しない |
| `npm test -- --maxWorkers=2` | 51ファイル・494件成功。メモリ負荷を抑えて実行 |
| `npm run build` | Vite 8.1.6で成功。既存の500 kB超チャンク警告あり |
| `npx playwright test --config=playwright.dev.config.ts` | 開発用CSP・合成評価画面の2件成功 |
| `npx playwright test e2e/hardening.spec.ts e2e/pwa.spec.ts e2e/mapping-storage.spec.ts e2e/prompt-api.spec.ts --project=chrome` | 12件成功 |
| 同上 `--project=msedge` | 12件成功。Chromeとは逐次実行 |
| Cドライブの専用一時領域で `npm ci --ignore-scripts --os=linux --cpu=x64 --libc=glibc --no-audit --no-fund` | npm 11.19.1で299パッケージのクリーン導入成功。Linux用Rolldown/Lightning CSSも解決。lockfile不整合・任意依存欠落による導入失敗は再現しない |

Viteの配信・ビルドとVitest/jsdom/ESLintの更新に合わせ、開発用CSP、本番ヘッダー、正規化Worker、入力の通信・Storage・Console非混入、NER障害時の継続、a11y、Service Worker、アプリのオフライン起動、公開キャッシュ分離、実OPFSの保存・上書き・再読込・復元・削除、追加AIの確認フローを対象に選んだ。大容量モデルを使うE2Eは対象外とした。

### 検証境界と容量

Windows、Node.js 24.22.1、npm 11.19.1で実施した。DockerのLinuxエンジンが利用できないため、実Ubuntu上の`npm ci`・ネイティブ実行は未実施。Linux指定のクリーン導入はWindows上でインストールスクリプトを無効にしたlockfile検査であり、Ubuntuのビルド成功と同一視しない。実Ubuntuの確認は将来のCI実行で必要となる。

Dドライブ上の既存node_modulesを全削除・再導入せず、11パッケージの差替えに留めた。クリーン導入は空き容量のあるCドライブの一時領域で行い、検査後の依存コピーを削除した。削除対象は今回作成した専用ディレクトリに限定し、既存データ・他プロジェクトのキャッシュには触れていない。最終確認の空き容量はC約23.02 GiB、D約1.95 GiB。実NER・Gemini Nanoの大容量モデル取得は行わず、実モデル精度・速度・オフライン推論の再検証はしていない。本番公開・デプロイ・マージは行っていない。

CI導入前のE2Eでは、正規化ダイアログの旧寸法検査1件が失敗した。保存対応時のコミット`716077e`で共通寸法へ変更済みだったため、UIを変えずに旧設計文書と期待値を同期した。ヘッダー・フッターの余白、タイトル、操作ボタンの寸法を引き続き明示的に検査する。

# Phase 5 セキュリティ・品質ハードニング

## 1. 対象

Phase 5では、以下を再現可能な設定と検査として実装する。

- Content Security Policy（CSP）とセキュリティヘッダー
- ユーザー入力のネットワーク、Storage、Consoleへの混入検査
- ChromiumおよびMicrosoft Edgeのブラウザスモークテスト
- WCAG 2 A / AAを対象としたaxe検査
- 1,000文字および10,000文字の形式検出・マスク生成性能計測

8GB級PC、macOS Chrome、低速回線、初回モデル取得の所要時間は今回の対象外とし、後続の環境評価で確認する。

## 2. CSP

CSPは`config/securityHeaders.ts`を正本とする。Viteは開発・プレビュー時にHTTPヘッダーを返し、ビルド後の`index.html`にはホストに依存しないCSPメタタグを埋め込む。

主な制約は以下とする。

| ディレクティブ | 方針 |
| --- | --- |
| `default-src` | 同一オリジンのみ |
| `connect-src` | 同一オリジンとHugging Faceの公開モデル配信元のみ |
| `script-src` | 同一オリジンとWebAssemblyコンパイルのみ |
| `worker-src` | 同一オリジンと`blob:`のみ |
| `style-src` | 同一オリジン。CodeMirrorの実行時スタイルに限りインラインを許可 |
| `object-src` / `base-uri` / `form-action` | 使用しない |
| 開発用WebSocket | Vite開発サーバー時だけlocalhostを許可 |

Vite開発サーバーではReact Refreshがインラインのmodule scriptを挿入するため、開発時の`script-src`に限り`'unsafe-inline'`を追加する。本番ビルドとプレビューでは許可しない。`npm run test:e2e:dev`で開発用CSP下の画面表示とCSPエラー0件を確認する。

NERは専用Worker内で実行し、ONNX Runtimeの`numThreads`を`1`へ固定する。また、同一オリジン配信するWASMローダーをTransformers.jsが`blob:`化しないよう`useWasmCache`を無効化する。公開モデル資材のキャッシュは維持し、`script-src`へ`blob:`を許可せずに推論を実行する。

`connect-src`が許可するHugging Face通信は、公開モデル、トークナイザー、設定ファイルの取得に限定する。ユーザー入力をこの通信へ付加しない。

## 3. HTTPヘッダー

以下のヘッダーをVite開発・プレビューで適用する。

- `Content-Security-Policy`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

本番配布先は、`buildSecurityHeaders()`と同等のレスポンスヘッダーを設定すること。CSPメタタグでは`frame-ancestors`を強制できないため、本番ホストのHTTPヘッダーを省略してはならない。

## 4. プライバシー検査

`scripts/security/privacySourceAudit.test.ts`は、`src`配下で以下のAPIを直接使用していないことを確認する。

- `fetch`、`XMLHttpRequest`、`WebSocket`、`sendBeacon`
- `localStorage`、`sessionStorage`、IndexedDB、Cookie
- `console`への出力

`e2e/hardening.spec.ts`は固有の合成マーカーを原文へ入力し、以下を確認する。

- リクエストURL、ヘッダー、本文にマーカーが含まれない
- LocalStorage、SessionStorage、IndexedDB名、Cookie、Cache名にマーカーが含まれない
- Consoleメッセージにマーカーが含まれない
- 公開モデル取得を遮断してNERを失敗させても、形式検出候補が保持される

モデルやWASMなどの公開資材はブラウザキャッシュを許容するため、Storageが完全に空であることは要件にしない。ユーザー入力が含まれないことを検査する。

## 5. ブラウザ・アクセシビリティ

2026年7月14日にWindows 11で以下を確認した。

| ブラウザ | バージョン | 結果 |
| --- | --- | --- |
| Playwright Chromium | 149.0.7827.55 | 3件成功 |
| Microsoft Edge | 150.0.4078.65 | 3件成功 |

検査内容は、CSP・ヘッダー、NER障害時の継続と入力漏えい、axeによるWCAG 2 A / AAである。axeの初回検査で検出したタブARIA構造とプレースホルダーのコントラストを修正済みである。

## 6. 性能計測

`npm run benchmark:core`は合成データを用いて形式検出とマスク生成をウォームアップ後に複数回実行し、中央値を出力する。2026年7月14日の開発PCでの結果は以下のとおり。

| 文字数 | 形式検出中央値 | マスク生成中央値 | 回帰防止予算 |
| ---: | ---: | ---: | --- |
| 1,000 | 0.45 ms | 0.39 ms | 形式500 ms / マスク100 ms |
| 10,000 | 5.42 ms | 14.50 ms | 形式3,000 ms / マスク500 ms |

予算は端末差を吸収しながら重大な回帰だけを検出する上限であり、通常性能の目標値ではない。NERの10,000文字ウォーム性能は`docs/model-evaluation.md`の測定結果を参照する。

## 7. 実行コマンド

```bash
npm test
npm run audit:dependencies
npm run test:e2e
npm run test:e2e:dev
npm run test:e2e:edge
npm run benchmark:core
```

`npm run test:phase5`は単体テスト、Chromium E2E、コア性能計測を順に実行する。Edgeはインストール済みWindows環境で`npm run test:e2e:edge`を別途実行する。

## 8. Phase 7 PWAセキュリティ境界

Phase 7では、Service Workerを導入してもCache Storageの保存範囲を拡大しない。明示保存によるOPFSマスク対応表は、Service WorkerとCache Storageから分離した専用Repositoryで管理する。

- Service Workerが管理するのは、許可された同一オリジンのアプリシェルだけとする
- POST、API応答、認証、任意URL、ユーザー操作で生成されたデータはキャッシュしない
- NERモデル、Tokenizer、ONNX Runtimeなどの公開資産は、ユーザーデータと分離したブラウザキャッシュとして扱う
- キャッシュ名、更新メタデータ、Service Workerのログへ原文、候補、トークンを含めない
- モデルキャッシュは固定リビジョンの1版を基本とし、新版の取得・初期化成功後だけ旧版を削除する
- `sw.js`、Manifest、`index.html`は再検証可能にし、ハッシュ付き静的資産だけを長期キャッシュする
- 既存のCSP、`worker-src 'self' blob:`、Hugging Faceの許可済み`connect-src`を維持する
- OPFSへのアクセスは`navigator.storage.getDirectory()`を含む専用Repository層へ限定する

Phase 7の検証では、合成マーカーを入力したうえで、Cache Storage、LocalStorage、SessionStorage、IndexedDB、Cookie、ネットワーク要求、Consoleにマーカーが出ないことを確認する。明示保存を行った場合も、Cache Storage、Service Worker、ネットワーク、Consoleへ機密マーカーが出ないことを確認する。更新可能状態で編集中のセッションを自動リロードしないことも確認する。

## 9. マスク対応表のセキュリティ境界

マスク対応表では、再利用に必要な有効な対象文字列、正規化済み対象文字列、トークン、復元文字列、種別、検出元、手動フラグ、関連ID、マスク方式、スキーマ・対応表メタデータをAES-GCMで暗号化する。対応表名、作成・更新日時、暗号化ファイル名、フォーマットバージョン、リビジョンだけを平文インデックスへ保存する。原文・処理結果・位置・件数は保存しない。画面・文書では「保存データはすべて暗号化」と表現しない。

検証では、保存処理ごとに生成した合成PIIとパスフレーズを使用し、次を確認する。

- OPFSの対応表ファイルに原文、検出値、トークン対応、マスク内容の平文がない
- `index.json`に許可された一覧メタデータ以外がない
- パスフレーズ、復号済みデータ、暗号鍵をログ・エラー・ネットワークへ出さない
- 誤パスフレーズ、改ざん、破損、未対応スキーマで現在作業を変更しない
- 保存・上書き・削除・インデックス更新の失敗時に正常な既存データを維持する
- Service WorkerとCache StorageがOPFSファイルを読み書きしない

# モデルキャッシュとOPFSの障害対応

2026-10-06の承認済み修正。公開モデル資材と暗号化対応表を別管理する。

## 実装

- Transformers.jsの`env.customCache`へ専用アダプターを接続する。固定モデル・リビジョンの`config.json`、`tokenizer_config.json`、`tokenizer.json`、`onnx/model_quantized.onnx`だけを許可する。入力本文や任意URLをキャッシュキーにしない。
- モデルとTokenizerを固定リビジョンでロードし、4.3の既定リビジョンへの事前確認も公開資材用の取得アダプターで固定リビジョンへ限定する。進捗メタデータ用の余分なモデル取得を避ける。
- Cache Storageのopen/match/put失敗は、容量超過・許可拒否・API未対応・内部エラーという限定コードをメモリ内で通知する。例外詳細や原文をログ・保存しない。オンライン推論は継続する。
- 推論成功とキャッシュ取得状態を分ける。キャッシュ4資材の存在を確認しても、破損・アプリ資材・環境差を含めたオフライン成功の保証とは扱わない。
- 「モデルキャッシュ未完了」から明示確認後、現在モデルの公開資材だけを削除できる。NER処理中の削除を禁止し、Workerを初期化して次回オンライン検出で再取得する。現在の作業、OPFS対応表、アプリシェル、別モデルは削除しない。
- 同一オリジン全体の概算使用量・上限を表示できる。OPFSも含む見積りであり、容量不足の断定や永続保持の保証に使用しない。

## 検証観点

機能は取得・保存・再試行、非機能はキャッシュ障害・オンライン継続・オフライン縮退、データは部分取得・リビジョン違い・許可外URL、UIは準備・利用不可・未完了・削除確認を対象とする。正常／異常／境界／新Workerでの状態遷移を分けて確認する。

[単体試験](../src/domain/detection/ner/modelCache.test.ts)と[UI試験](../src/components/PwaStatus.test.tsx)で障害・境界を検証する。[実モデル試験](../e2e/model-cache-real.spec.ts)は公開モデル約279MBを取得するため通常CIではスキップする。PowerShellでは次のように明示実行する。同一実機ではブラウザ別に順次実行する。

```powershell
npm run build
$env:RUN_REAL_NER_E2E='1'
npx playwright test e2e/model-cache-real.spec.ts --project=chromium
npx playwright test e2e/model-cache-real.spec.ts --project=msedge
Remove-Item Env:RUN_REAL_NER_E2E
```

試験は実キャッシュが完了した場合に新WorkerでのオフラインNERを検証し、未完了の場合は未完了表示と形式検出への縮退を検証する。`model-cache-diagnostics`添付と`offline-real-ner`注釈を見て両者を区別する。テスト成功だけをオフラインNER成功と読み替えない。

## 残る制約

Windows ChromiumとMicrosoft EdgeではオンラインNERが成功しても、ONNXのCache.putが内部エラーで失敗する状態を再現した。Tokenizer等3資材は保存できた。サイト全体の概算使用量は約299〜301MB、表示上限は複数GBだったが、見積りから実ディスク余裕や内部エラーの原因は断定できない。転送ヘッダーの整理でも改善せず、根拠のない補正は採用しない。この状態では再起動後の実オフラインNER成功を確認できず、形式検出へ縮退することを実ブラウザで確認した。サイトデータ全体の削除による対処は、OPFS対応表も失うため案内しない。

モデルの分割保存・別配信、旧リビジョンの自動削除、永続化権限要求は今回追加していない。OPFSの修正と残る復旧機能は[対応表の実装確認](local-work-history-implementation-status.md)を参照する。macOS、低メモリ端末、ブラウザ強制終了からの実復旧は未検証。

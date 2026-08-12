# Storage API 利用方針

## 1. 原則

Local PII Maskerは、ユーザーデータの保存先を明示操作時のOPFSに限定する。デフォルトではユーザーデータを永続保存しない。

原文、検出値、マスク対応情報、外部回答、復元結果を、外部サーバー、クラウド、URL、ブラウザ履歴、ログ、分析、エラー監視へ送信または保存しない。

## 2. API別の許可範囲

| API・領域 | 許可範囲 |
| --- | --- |
| OPFS | ユーザーが保存を確定した暗号化セッションと、一覧用の限定メタデータだけを保存する |
| LocalStorage | ユーザーデータ、設定、鍵、パスフレーズを保存しない |
| SessionStorage | ユーザーデータ、設定、鍵、パスフレーズを保存しない |
| IndexedDB | ユーザーデータ、鍵、パスフレーズを保存しない |
| Cookie | 使用しない。ユーザーデータを保存しない |
| Cache Storage | Service Workerが許可したアプリシェル・公開モデル資材だけを保存する |
| URL・履歴 | 原文、検出値、タイトル、トークン、パスフレーズを含めない |

## 3. OPFS Repository

`navigator.storage.getDirectory()`の使用箇所は、専用Repository層の許可リストに限定する。Reactコンポーネント、検出器、マスクエンジンから直接OPFSへアクセスしない。

Repositoryは次の責務を持つ。

- OPFS対応可否の判定
- 管理対象ディレクトリの作成と検証
- インデックスと暗号化セッションの読み書き
- 一時ファイル、バックアップ、復旧候補の管理
- Web Locksまたはリビジョンによる競合制御
- 原文や復号済みデータを含まないエラー分類

ファイル名・ディレクトリ名・インデックスの項目は、ユーザー入力をパスとして解釈しない。タイトルはReactのテキストとして表示し、HTMLとして解釈しない。

## 4. Cache Storageとの境界

Cache Storageは、アプリシェル、JavaScript、CSS、フォント、Tokenizer、ONNX Runtime、公開NERモデルなどの公開資材専用とする。OPFSのセッションファイル、復号済みデータ、一時ファイルをService WorkerやCache Storageへ渡さない。

OPFS保存を追加しても、PWAのアプリシェルキャッシュと公開モデル資材のキャッシュ境界は変更しない。

## 5. 検証

合成マーカーを原文、検出値、トークン、パスフレーズ、タイトルへ設定し、次を個別に監査する。

- OPFSの暗号化セッションに機密マーカーの平文がない
- `index.json`にはタイトル以外の許可外マーカーがない
- LocalStorage、SessionStorage、IndexedDB、Cookie、Cache Storage、Service Worker、ネットワーク、Consoleに機密マーカーがない
- 保存・復元・削除の失敗時に機密データをログへ出さない

# Prompt API PoC ローカル保存用の主要評価証跡

保存ブランチ：`codex/prompt-api-poc-not-adopted-20261028`。基準HEADは`b42980ab156ad07cd3d310e27d483d978e237406`。実装・テスト・文書を含む研究用チェックポイントであり、本番採用・公開・マージを示さない。

GitHubへの保存時は、`vercel.json`の`git.deploymentEnabled`でこのブランチだけを`false`にし、自動プレビューデプロイを抑止する。mainと他ブランチは未指定のまま維持する。[Vercelの設定仕様](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)を参照。ブランチpushに対するGitHub Actionsも、既存の`push.branches: [main]`により実行対象外となる。PR・マージ・手動デプロイは行わない。

**今回の採用は見送り。** 最終78件の進行条件を満たす案がなく、NER併用へ進んでいない。[評価報告](../../../prompt-api-poc-report.md)と[評価仕様](../../../prompt-api-source-id-evaluation.md)を参照。

## 保存対象

| 測定段階 | ディレクトリ | 測定件数 |
| --- | --- | --- |
| 条件固定・方式比較 | priority-v2-run-1 | 102 |
| 旧失敗条件の再現 | priority-legacy-run-1 | 6 |
| 制約追加比較 | priority-schema-run-2 | 9 |
| 最小再現候補 | followup-minimize-1 | 12 |
| 文単位への短縮 | followup-minimize-sentences-1 | 9 |
| 境界と制約 | followup-minimize-boundary-1 | 9 |
| 否定例向け指示 | followup-negative-1 | 60 |
| 短い否定例向け指示 | followup-negative-brief-1 | 60 |
| 最終参照比較・短文 | reference-short-1 | 60 |
| 最終参照/分割比較・長文 | reference-long-1 | 18 |

合計345測定行、別枠の完了ウォームアップ10行。各群のmanifest、rows.jsonl、warmupと、存在するreadinessを元ファイルから変更せずコピーした。初期3群はreadiness記録導入前であり、欠損を成功として補っていない。API/構造/期限失敗の行も保持する。異なる段階・指示・ソース指紋を単一の精度母数に合算しない。

- `archive-manifest.json`：保存ファイルの元の相対パス・サイズ・SHA-256、各測定群の件数。
- `reference-gate.json`：最終78件の足切りと不採用判断。
- `excluded-trials/priority-schema-run-1.json`：状態未確認で除外した試行の理由。測定0件であり、345件へ加えない。古いrunning表示のmanifestは保存していない。
- `model-state-labels.json`：Broker画面から許可したモデル名・版・Ready・GPU・容量・クラッシュ数表示のラベルだけを抽出。元画面ファイルのハッシュを記録し、ローカルのモデル保存パスや画面全体は収録しない。表示ラベルから内部原因や累計クラッシュ数を推定しない。
- `verification-summary.json`：保存前に完了した最終検証のコマンド・結果と、元ログのハッシュ。577単体、19セキュリティ、対象E2E 1件等の詳細は評価報告。今回の保存でモデル測定を再実行したとの意味ではない。

生応答、原文、候補文字列、引用、原文位置、例外本文、パスフレーズ、モデル本体、起動設定、スクリーンショット、コンソール/通信ログは含めない。履歴の全試行を保存したアーカイブではなく、主要な定量比較を保存したもの。初期の予備評価・調整は報告書と中断記録を参照する。

## 整合性確認

リポジトリのルートでPowerShellから実行する。ファイルを読み取るだけで、モデル・ネットワーク・npmの追加取得は不要。

```powershell
& ./docs/evaluation-evidence/prompt-api/2026-10-28/verify.ps1
```

コピーしたJSON/JSONLは`.gitattributes`で改行変換を無効にし、Git経由でも元ファイルのバイトハッシュを保持する。README・検証スクリプト・索引自身は`archive-manifest.json`の自己参照ハッシュ対象外。これは改変検知の仕組みであり、署名付き第三者証明ではない。

最終78件のruntime sourceHashesは保存時の作業ファイルと一致している。途中段階の指紋は測定時点のもので、最終コードとの差がある。途中のソース全文スナップショットを後から復元したものではなく、過去の全実行をビット単位で再現できるとは保証しない。また、Gitの改行設定によりコード側のバイトハッシュが変わる場合がある。将来の再評価ではChrome/モデル版・Ready・設定・新しいソース指紋を取り直し、本アーカイブと分けて記録する。

元の`output/playwright/`はGit管理外のまま残している。このブランチだけで上記の選別済み証跡は保持できるが、収録しなかった元ログやブラウザープロファイルは復元できない。ローカルコミットだけなので、ドライブ障害に備えた別媒体バックアップではない。

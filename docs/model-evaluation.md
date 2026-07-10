# 日本語NERモデル評価計画

## 1. 目的

Local PII MaskerのMVPで使用する日本語固有表現抽出（NER）モデルを、ブラウザ実行可能性、検出品質、モデルサイズ、処理速度、ライセンスの観点から評価する。

モデルカード上の評価値だけでは、個人情報マスキング用途の品質を判断できない。実際の利用文書に近い評価データを用意し、特に見逃し率を重視して選定する。

## 2. 現在の判断

| 項目 | 判断 |
| --- | --- |
| NER実行基盤 | Transformers.js |
| タスク | `token-classification` / NER |
| モデル形式 | ONNX |
| 初期評価モデル | `jiting/xlm-roberta-ner-japanese_onnx` |
| 採用状態 | PoC候補。MVPへの正式採用は未決定 |
| 構造化PII | NERへ依存せず、正規表現・検査ロジックを使用 |

Transformers.jsは`token-classification`パイプラインを提供している。初期候補モデルはTransformers.js用のONNX重みを持ち、モデルカードにブラウザ側の読み込み例が掲載されている。

## 3. 初期候補モデル

### 3.1 モデルID

```text
jiting/xlm-roberta-ner-japanese_onnx
```

### 3.2 モデルの由来

- ベース：XLM-RoBERTa Base
- 元のNERモデル：`tsmatz/xlm-roberta-ner-japanese`
- 学習用途：日本語の固有表現抽出
- 学習データ：日本語Wikipedia記事をもとにしたNERデータセット
- ライセンス表示：MIT
- Transformers.js：モデルカード上で利用例あり

元モデルのラベル：

| ラベル | 意味 | MVPでの扱い候補 |
| --- | --- | --- |
| `PER` | 人名 | `PERSON` |
| `ORG` | 一般組織 | `ORGANIZATION` |
| `ORG-P` | 政治組織 | `ORGANIZATION` |
| `ORG-O` | その他組織 | `ORGANIZATION` |
| `LOC` | 地名 | `ADDRESS`または`LOCATION` |
| `INS` | 施設 | `ORGANIZATION`または`OTHER` |
| `PRD` | 製品 | `SECRET`または対象外 |
| `EVT` | イベント | `OTHER`または対象外 |

`LOC`は住所専用ラベルではない。都道府県、市区町村、建物名、番地を含む住所全体の検出精度は別途評価する。

### 3.3 モデルファイル

2026年7月10日時点でモデルリポジトリに掲載されている主なONNXファイル：

| ファイル | 掲載サイズ |
| --- | ---: |
| `model.onnx` | 1.11 GB |
| `model_fp16.onnx` | 555 MB |
| `model_quantized.onnx` | 279 MB |

このほか、トークナイザー等の資材が必要となる。モデル本体のサイズだけで初回通信量を判断しない。

PCと安定したブロードバンド環境をMVPの前提とするため、279MBの量子化版はPoC候補として許容する。ただし、ブラウザのメモリ使用量と初期化時間は必ず実測する。

## 4. Transformers.js側の確認事項

Transformers.js v3系では、量子化形式の指定は従来の`quantized: true`ではなく、原則として`dtype`を使用する。

例：

```ts
import { pipeline } from "@huggingface/transformers";

const detector = await pipeline(
  "token-classification",
  "jiting/xlm-roberta-ner-japanese_onnx",
  {
    device: "webgpu",
    // 実際に利用可能なdtypeはモデルリポジトリとPoCで確認する。
    dtype: "q8",
  },
);
```

ただし、初期候補モデルは旧形式の`model_quantized.onnx`を含むため、最新Transformers.jsでの`dtype`解決、デフォルト選択、WebGPU・WASM双方の互換性を実機確認する。

評価時は以下を記録する。

- 使用した`@huggingface/transformers`の正確なバージョン
- 指定した`device`と`dtype`
- 実際に取得されたモデルファイル
- キャッシュ利用の有無
- フォールバック発生の有無

## 5. モデル選定基準

### 5.1 必須条件

- 日本語テキストを対象としてNER学習されていること
- ブラウザ内で推論できるONNX資材があること
- Transformers.jsから読み込めること
- 人名、地名、組織名のうち主要カテゴリを検出できること
- ライセンスがアプリの利用・公開方針と両立すること
- カスタムPythonコードを実行せず利用できること
- ユーザーテキストを外部推論APIへ送信しないこと

### 5.2 比較指標

優先順位は以下とする。

1. 日本語PIIに対する再現率
2. 境界を含む抽出の正確性
3. 誤検出率
4. ブラウザでの安定性とメモリ使用量
5. 10,000文字程度の実用処理時間
6. 初回ダウンロード容量と初期化時間
7. ライセンスと保守性

マスキング用途では、不要な候補をユーザーが除外できる一方、見逃された情報はユーザーが気付けない可能性がある。このため、精度指標は総合F1だけでなく再現率を重視する。

## 6. 評価対象カテゴリ

### 6.1 NERで評価するカテゴリ

- 人名
- 地名
- 住所の一部・全体
- 組織名
- 施設名
- 製品名・プロジェクト名の参考検出

### 6.2 正規表現と分担するカテゴリ

- メールアドレス
- 電話番号
- 郵便番号

以下は後続候補：

- URL
- IPアドレス
- 生年月日・日付
- 顧客番号、社員番号、チケット番号
- クレジットカード番号などの高リスク識別番号

NERモデル単体をPII検出全体の性能として評価しない。最終的には、NER、正規表現、手動追加を統合したアプリ全体の見逃し率も測定する。

## 7. 評価データ

### 7.1 基本方針

- 実在する個人情報をリポジトリへ登録しない
- 原則として合成データ、公開データ、匿名化済みデータを使用する
- 実業務に近い文体を含める
- 正解ラベルを人手でレビューする
- モデル選定用データと最終確認用データを分ける

### 7.2 文書タイプ

- メール本文
- 問い合わせ記録
- 障害報告
- 会議議事録
- 仕様書・テスト報告
- 顧客対応メモ
- 住所を含む配送・申請文
- 生成AIへ依頼するプロンプト

### 7.3 データセット規模

PoC初期：

- 100文書以上
- 1カテゴリあたり50エンティティ以上を目標
- 否定例・紛らわしい表現を含める

MVP採用判断：

- 200～300文書程度へ拡張
- 文書タイプとカテゴリの偏りを確認
- 長文およびチャンク境界ケースを追加

### 7.4 必須テスト例

- 姓だけ：`山田`
- 姓名：`山田太郎`
- 包含関係：`山田`と`山田太郎`
- 同姓同名の複数出現
- 会社名と一般名詞の曖昧性
- 都道府県名、市区町村、町名、番地、建物名
- ひらがな、カタカナ、漢字、英字の人名
- 日本語文中の英語組織名
- 改行をまたぐ表現
- 句読点に隣接する表現
- 長文チャンクの境界に位置する表現
- 人名に見える一般名詞
- 地名に見える製品名

## 8. 精度指標

### 8.1 エンティティ単位

- Precision
- Recall
- F1
- Exact Match：開始・終了位置とカテゴリが完全一致
- Overlap Match：正解範囲と一部重複

### 8.2 カテゴリ別

- 人名Recall
- 住所・地名Recall
- 組織名Recall
- 各カテゴリのPrecision
- カテゴリ混同数

### 8.3 マスキング用途固有

- マスクすべき文字列の見逃し数
- 同一文字列の全出現箇所へ適用できた割合
- 最長一致後に個人情報が部分的に残った件数
- NER境界不足により文字列の一部だけが残った件数
- ユーザー確認後の最終マスク漏れ率

NERが`山田`だけを返し、正解が`山田太郎`である場合、Overlap Matchでは成功しても、マスキング結果に`太郎`が残る。したがってExact Matchと最終的な残存文字列を重視する。

## 9. 性能評価

### 9.1 対象環境

最低限、以下の組み合わせを測定する。

| OS | ブラウザ | バックエンド |
| --- | --- | --- |
| Windows 11 | Chrome最新版 | WebGPU |
| Windows 11 | Chrome最新版 | WASM |
| Windows 11 | Edge最新版 | WebGPU |
| macOS | Chrome最新版 | WebGPU |
| macOS | Chrome最新版 | WASM |

### 9.2 測定項目

- コールド状態の初回ダウンロード時間
- キャッシュ済み状態のロード時間
- モデル初期化時間
- 1,000文字の推論時間
- 10,000文字の推論時間
- チャンクごとの処理時間
- 最大メモリ使用量
- 推論中のUI応答性
- Worker停止・再実行の安定性
- 連続10回実行時のメモリ増加

### 9.3 入力サイズ

- 100文字
- 1,000文字
- 5,000文字
- 10,000文字
- 上限候補を超える入力

## 10. ネットワーク・キャッシュ評価

ブラウザ開発者ツールまたは自動テストで以下を確認する。

- 初回に取得されるモデル・トークナイザー資材
- 2回目以降のキャッシュ利用
- 原文がリクエストURL、本文、ヘッダーへ含まれないこと
- 検出結果や対応表が送信されないこと
- モデル取得失敗時にユーザーデータが失われないこと
- キャッシュ消去後に再取得できること

## 11. 長文チャンク評価

モデル最大長を超える入力はチャンク分割する。以下を比較する。

1. 文字数固定分割
2. 句点・改行優先分割
3. トークン上限に基づく分割
4. オーバーラップ付き分割

評価項目：

- チャンク境界での見逃し
- 重複候補の統合
- 元文章の文字位置への再マッピング
- 総処理時間
- オーバーラップによる処理量増加

最終方式は、境界見逃しと処理時間のバランスで決定する。

## 12. PoCの実施順序

### Step 1：ロード確認

- 最新安定版のTransformers.jsを導入
- 初期候補モデルをWorker内でロード
- 実際に利用されたモデルファイルを記録
- WebGPUとWASMで起動確認

### Step 2：単文NER

- 短い日本語例文でラベルとサブワード出力を確認
- エンティティ結合処理を実装
- 元文字位置へのマッピングを確認

### Step 3：性能測定

- 1,000文字、10,000文字で測定
- コールド／ウォーム状態を分離
- メモリ使用量とUI応答性を確認

### Step 4：精度測定

- 合成評価データでカテゴリ別に測定
- 境界誤りと見逃し例を収集
- 正規表現・手動追加と統合して再評価

### Step 5：採用判断

- 初期モデルを採用
- より軽量なモデルを探索
- モデルを再量子化
- 日本語モデルをONNX変換
- 独自ファインチューニングを次フェーズへ送る

のいずれかを判断する。

## 13. 暫定採用ゲート

以下を満たした場合にMVP採用候補とする。

- 対象PCのChromeで安定してロード・推論できる
- WebGPUまたはWASMの少なくとも一方で実用時間内に処理できる
- 10,000文字処理でタブクラッシュや継続的なメモリ増加がない
- 人名、地名・住所、組織名の候補を実用的な再現率で提示できる
- 境界誤りをUIの確認工程で修正可能である
- モデル取得失敗時も手動追加と正規表現検出を継続できる
- ライセンス確認が完了している
- 原文・検出結果をネットワーク送信しないことを確認できる

具体的な時間・精度の数値基準は、最初のベースライン測定後に追記する。測定前に根拠のない閾値を固定しない。

## 14. 評価結果記録テンプレート

```markdown
# Evaluation Run

- Date:
- Commit:
- Browser:
- OS:
- CPU/GPU:
- Memory:
- Transformers.js version:
- Model ID / revision:
- Device:
- dtype / model file:
- Cache state: cold / warm

## Performance

| Input size | Download | Init | Inference | Peak memory |
| --- | ---: | ---: | ---: | ---: |
| 1,000 chars | | | | |
| 10,000 chars | | | | |

## Accuracy

| Category | Precision | Recall | F1 | Exact match errors |
| --- | ---: | ---: | ---: | ---: |
| Person | | | | |
| Location/Address | | | | |
| Organization | | | | |

## Findings

- 

## Decision

- Adopt / Continue evaluation / Reject
```

## 15. 参考資料

- [Transformers.js Pipeline API](https://huggingface.co/docs/transformers.js/api/pipelines)
- [Transformers.js: Using quantized models](https://huggingface.co/docs/transformers.js/guides/dtypes)
- [`jiting/xlm-roberta-ner-japanese_onnx`](https://huggingface.co/jiting/xlm-roberta-ner-japanese_onnx)
- [`jiting/xlm-roberta-ner-japanese_onnx` ONNX files](https://huggingface.co/jiting/xlm-roberta-ner-japanese_onnx/tree/main/onnx)
- [`tsmatz/xlm-roberta-ner-japanese`](https://huggingface.co/tsmatz/xlm-roberta-ner-japanese)

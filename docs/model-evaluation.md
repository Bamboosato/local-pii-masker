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
| MVP採用モデル | `jiting/xlm-roberta-ner-japanese_onnx` |
| 採用状態 | 選定用100文書と未見100文書、Chrome Worker実測を完了し、MVP採用を決定 |
| 構造化PII | NERへ依存せず、正規表現・検査ロジックを使用 |
| 現在の実装バージョン | `@huggingface/transformers` 4.3.0（2026-10-06の依存脆弱性対応）。過去の精度・性能評価は記録時点の4.2.0 |
| Phase 3初期設定 | `device: "wasm"` / `dtype: "q8"` |

Transformers.jsは`token-classification`パイプラインを提供している。採用モデルはTransformers.js用のONNX重みを持ち、モデルカードにブラウザ側の読み込み例が掲載されている。

## 3. 採用モデルと候補比較

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

| ラベル | 意味 | 現行MVPでの写像 |
| --- | --- | --- |
| `PER` | 人名 | `PERSON` |
| `ORG` | 一般組織 | `ORGANIZATION` |
| `ORG-P` | 政治組織 | `ORGANIZATION` |
| `ORG-O` | その他組織 | `ORGANIZATION` |
| `LOC` | 地名 | Phase 3初期実装では`ADDRESS` |
| `INS` | 施設 | Phase 3初期実装では`ADDRESS` |
| `PRD` | 製品 | `OTHER` |
| `EVT` | イベント | `OTHER` |

`LOC`と`INS`は住所専用ラベルではない。都道府県、市区町村、施設名、建物名、番地を含む住所全体の検出精度は別途評価する。Phase 3初期実装では、住所文脈での見落としを避けるため暫定的に`ADDRESS`へ写像する。

過検出抑制として、Phase 3初期実装では1文字候補、3文字以下の英数字だけの候補、メールアドレス・URL・形式検出済み住所・構造から検出済みフルネーム内に含まれる部分文字列候補、長い日本語複合語内にしか存在しない2文字漢字候補、原文に完全一致しない候補を除外する。`LOC`・`INS`として返された一般姓は、明示的な住所ラベル直後にある場合を除いて住所候補にしない。

### 3.3 モデルファイル

2026年7月10日時点でモデルリポジトリに掲載されている主なONNXファイル：

| ファイル | 掲載サイズ |
| --- | ---: |
| `model.onnx` | 1.11 GB |
| `model_fp16.onnx` | 555 MB |
| `model_quantized.onnx` | 279 MB |

このほか、トークナイザー等の資材が必要となる。モデル本体のサイズだけで初回通信量を判断しない。

PCと安定したブロードバンド環境をMVPの前提とするため、279MBの量子化版はPoC候補として許容する。ただし、ブラウザのメモリ使用量と初期化時間は必ず実測する。

### 3.4 代替モデル比較（2026年7月13日調査）

モデルカードに記載された精度値は、評価データ、集計単位、分割方法が同一であることを確認できないため、モデル間の順位付けには直接使用しない。公開値はPoC対象を絞る参考値とし、採用判断は本書の同一評価データで再測定する。

| 優先 | モデル | 公開情報 | ブラウザ実装上の確認結果 | 現時点の扱い |
| ---: | --- | --- | --- | --- |
| 基準 | `jiting/xlm-roberta-ner-japanese_onnx` | `tsmatz/xlm-roberta-ner-japanese`のONNX変換版。XLM-R Base、9ラベル | Transformers.js利用例、Tokenizer、q8 ONNXが揃い、現行アプリで動作済み | MVP採用 |
| 1 | `sabaridsnfuji/xlm-roberta-name-entity-recognition-japanese` | XLM-R Base、現行と同じ9ラベル。モデルカードではPERのRecall 97.53%、Precision 98.80% | XLM-R BaseのTokenizer資材を補完してONNXへ変換し、Transformers.js 4.2.0のNode.js実行を確認した。Q8は約278MB | 200文書比較で実質的な優位がなく不採用 |
| 2 | `Mizuiro-sakura/deberta-v2-base-japanese-finetuned-ner` | 約0.1B、モデルカードの人名F1 0.85 | FP32 ONNXへ変換し、Transformers.js 4.2.0で実行できた。ただし助詞・読点を候補先頭へ含む境界誤りが多く、アプリ統合後の精度も大幅に低かった | MVP候補から除外 |
| 3 | `knosing/japanese_ner_model` | 約0.1B、モデルカードの人名F1 0.8410 | BERT本体は対応可能だが、モデル側にTokenizer資材とONNXがない。ベースの`tohoku-nlp/bert-base-japanese-v3`はMeCab・UniDicを使う`BertJapaneseTokenizer`で、Transformers.js 4.2.0に同Tokenizer実装がない | Tokenizer再現方法が成立した場合だけ比較へ進める |
| 参考 | `Mizuiro-sakura/luke-japanese-base-finetuned-ner` | 約0.3B、モデルカードの人名F1 0.90 | `LukeForTokenClassification`と`MLukeTokenizer`を使い、Entity Vocabularyも必要。Transformers.js 4.2.0に対応モデル・Tokenizerクラスがなく、ONNXも未掲載 | オフライン精度の上限参考。MVP採用候補からは除外 |

`tsmatz/xlm-roberta-ner-japanese`は現行`jiting`の変換元であり、別モデルとして比較しない。

比較は次の順序で行う。

1. 現行アプリのNER生出力と、正規表現・後処理統合後の出力を固定評価データで記録する
2. `sabaridsnfuji`とDeBERTaをONNXへ変換し、Node.js上のTransformers.jsでTokenizer、ラベル、原文位置、1文推論を確認する
3. スモークテストを通過したモデルだけをブラウザWorkerへ接続し、同一文書で精度、初回取得量、初期化時間、推論時間、ピークメモリを比較する
4. `knosing`はブラウザ内でMeCab・UniDic相当のトークン化を再現できる見通しが立った場合だけ追加する
5. LUKEはPython上の参考精度測定に留め、Transformers.js側に正式対応が追加されるまでブラウザ変換へ進めない

モデル差し替えの効果はNER単体だけでなく、現在の短候補除外、構造検出優先、カテゴリ写像を適用したアプリ最終候補でも評価する。人名Recallが改善しても住所・組織の過検出、境界誤り、初回待ち時間が悪化する場合は採用しない。

### 3.5 同一コーパスによるスモーク比較（2026年7月14日）

正式PoCへ進めるモデルを絞る目的で、次の観点を先に固定して比較した。

- 機能観点：モデル生出力とアプリ後処理統合後の両方でPrecision、Recall、F1を測定する
- データ観点：人名、組織名、住所、否定例、英語表記、Markdown、重複、長文チャンク境界を含める
- 異常・境界観点：出力に原文位置がない場合、原文へ一致しない場合、候補境界が助詞・句読点へ広がる場合を記録する
- 非機能観点：モデル形式、ファイルサイズ、ロード時間、1文書あたりの推論時間を記録する
- UI観点：この段階ではWorkerや画面へ接続せず、正式PoCへ進むモデルだけをブラウザで確認する

測定条件：

- 合成25文書、正解53出現、正解52対象文字列
- コーパスSHA-256：`a13a6e96b86769b045794bf2a23b0155cbb00aa00ce45c615ae497dd57db9c36`
- Node.js 24.13.0、`@huggingface/transformers` 4.2.0、`device: "cpu"`
- スコアはカテゴリと対象文字列の完全一致で集計する。同じ文字列の複数出現は対象文字列単位では1件として扱う
- モデル生出力に原文位置がないケースがあるため、出現位置単位の比較は本スモーク結果へ含めない

アプリ後処理統合後の結果：

| モデル | dtype | ONNXサイズ | Precision | Recall | F1 | 人名F1 | 組織F1 | 住所F1 | 平均推論時間 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `jiting` | Q8 | 約279MB | 75.6% | 65.4% | 70.1% | 81.5% | 58.3% | 52.6% | 23.6ms/文書 |
| `sabaridsnfuji` | FP32 | 約1.11GB | 75.0% | 69.2% | 72.0% | 81.5% | 64.3% | 55.6% | 35.2ms/文書 |
| `sabaridsnfuji` | Q8 | 約278MB | 73.5% | 69.2% | 71.3% | 81.5% | 62.1% | 55.6% | 18.3ms/文書 |
| DeBERTa v2 | FP32 | 約448MB | 29.4% | 38.5% | 33.3% | 39.4% | 27.3% | 22.2% | 64.0ms/文書 |

モデル生出力の対象文字列単位F1は、`jiting` Q8が57.8%、`sabaridsnfuji` FP32が60.0%、同Q8が61.2%、DeBERTa v2 FP32が12.6%だった。後処理は全モデルの結果を改善したが、DeBERTa v2の境界誤りを補える水準ではなかった。

判断：

- `sabaridsnfuji` Q8は現行比でRecallが3.8ポイント、総合F1が1.2ポイント高い。ただし人名F1は現行と同じであり、組織名はRecall向上と同時に偽陽性も5件から8件へ増えた
- `sabaridsnfuji`のFP32 ONNX変換では、PyTorchとの最大logits差`7.72e-5`が変換時許容値`1e-5`を超える警告が出た。ONNX checkerとTransformers.js推論は成功したが、正式PoCでは量子化前後の全候補差分を継続確認する
- DeBERTa v2は助詞・読点を候補へ含む境界誤りが多く、MVP候補から除外する
- 25文書は変換可否を判断するスモーク用であり、モデル選定の規模を満たさない。現行`jiting`を維持し、`sabaridsnfuji`は100文書以上の正式PoCとChrome Worker実測へ進める比較候補とする

初回ロード時間は、`jiting`だけがコールドダウンロードを含み、代替モデルはローカルファイルからロードしたため比較しない。平均推論時間もNode.js CPU上の参考値であり、ChromeのWASM Worker性能を示すものではない。

評価ハーネスは`evaluation/ner/corpus.json`と`scripts/ner-evaluation/`に置き、次の形式で結果JSONをリポジトリ外へ出力する。

```bash
npm run evaluate:ner -- --model jiting/xlm-roberta-ner-japanese_onnx --device cpu --dtype q8 --output <result.json>
```

### 3.6 100文書PoCとChrome Worker実測（2026年7月14日）

スモーク比較後、コーパスを100文書へ拡張した。すべて合成データであり、実在する個人情報は含めない。

| カテゴリ | 正解出現数 | 一意な正解対象数 |
| --- | ---: | ---: |
| 人名 | 108 | 97 |
| 組織名 | 82 | 79 |
| 住所・施設 | 78 | 77 |

- コーパスバージョン：2
- コーパスSHA-256：`c809da4ec875080c577432561b6900e213e6ef0f5fe60b77c94426d68776636c`
- 正解総数：268出現、264対象文字列
- 評価環境：Node.js 24.13.0、`@huggingface/transformers` 4.2.0、CPU、Q8
- 品質条件：100文書以上、各カテゴリ50出現以上、各カテゴリ50対象文字列以上、文書ID重複なしを自動テストする

比較結果：

| モデル | 生NER P/R/F1 | アプリ統合後 P/R/F1 | 人名F1 | 組織F1 | 住所F1 | 平均推論時間 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `jiting` Q8 | 84.7% / 75.4% / 79.8% | 70.9% / 61.0% / 65.6% | 78.0% | 72.3% | 45.3% | 23.2ms/文書 |
| `sabaridsnfuji` Q8 | 82.1% / 76.5% / 79.2% | 70.8% / 62.5% / 66.4% | 78.7% | 72.8% | 45.9% | 23.8ms/文書 |

`sabaridsnfuji`はアプリ統合後のF1が0.8ポイント高いが、人名の追加正解は1件である。組織名は正解が3件増える一方、偽陽性も4件増えた。モデル生出力では現行`jiting`のF1が0.6ポイント高く、速度差も小さい。約0.8ポイントの差は変換済みモデルを独自配布・保守するコストを正当化しないため、現行`jiting`を維持する。

Chrome Worker実測：

| 項目 | 結果 |
| --- | ---: |
| 環境 | Windows 11 / Chrome 150 / 14論理CPU / 32GB RAM |
| バックエンド | Web Worker / WASM / Q8 |
| 本番プレビュー初回1,000文字 | 34.8秒（モデル取得・初期化込み） |
| ウォーム10,000文字 | 59.6秒 |
| ウォーム10,000文字のWorker推論 | 57.9秒 |
| 推論中UIタイマー遅延 | p95 7.0ms / 最大21.9ms |
| Chromeプロセス群の処理後メモリ | Working Set 約1.46GB / Private約1.25GB |
| ページ離脱後との差 | 約0.92GB / 約0.93GB |

10,000文字を複数回処理してもタブクラッシュはなく、2回目以降に継続的なメモリ増加は確認されなかった。プロセス値は測定時点の定常値であり、瞬間的なピーク値ではない。8GB級PCやmacOSでのメモリ余裕は別途確認する。

現行入力上限30,000文字の追加実測（2026年8月12日、Windows 11 / 14論理CPU / 31.5GB RAM、ローカルVite開発サーバー、WASM / Q8、合成文字列30,000文字）：

| ブラウザ | 入力反映 | 自動検出 | UIタイマー最大遅延 | JSヒープ使用量 | ブラウザプロセス群 | 結果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Chrome 151 | 84ms | 166.2秒 | 490.4ms | 45.2MB | Working Set 1,647.9MB / Private 1,396.3MB | 5分以内に完了、タイムアウトなし |
| Edge 151 | 102ms | 191.8秒 | 837.6ms | 34.3MB | Working Set 1,472.1MB / Private 1,253.9MB | 5分以内に完了、タイムアウトなし |

両ブラウザとも30,000文字カウンターを確認し、自動検出ボタンが完了状態へ戻ることを確認した。開発サーバーのHMR再接続時に`/src/App.tsx`の`ERR_CONNECTION_RESET`が各ブラウザで記録されたが、NER Workerの実行エラーではない。製品リリース判定用の最終証跡では、本番プレビューでも同じ測定を再確認する。

ネットワーク・保存検証：

- 本番プレビューの24リクエストはすべてGETで、入力文字列はURLへ含まれなかった
- 外部通信先はHugging Faceとモデル配信に使われるXetだけで、原文・候補・対応表の送信はなかった
- ONNX RuntimeのWASM/MJSはViteビルドへ取り込み、同一オリジンから取得する。`cdn.jsdelivr.net`への実行時依存は除去した
- 保存操作を行わない検証ではLocalStorage、SessionStorage、IndexedDB、Cookieにユーザーデータがなく、Cache Storageにはモデル、Tokenizer、ONNX Runtime資材だけが保存された
- 明示保存を行う追加検証では、機密データが暗号化されたOPFS対応表ファイルだけに保存され、Cache Storage、Service Worker、ネットワーク、Consoleへ出ないことを確認する。`index.json`は許可された一覧用メタデータだけを含む。この追加検証の受入完了を、上記のNER実測から推定しない

Phase 7では、NERモデルを当面Hugging Face Hubから取得し、`jiting/xlm-roberta-ner-japanese_onnx`の取得リビジョン`8d70fc4`を固定する。公開モデル資材のキャッシュはTransformers.jsのブラウザキャッシュを所有者とし、Service Workerのアプリシェルキャッシュとは分離する。オフラインでモデルが未取得・破損・容量超過の場合は、NERを利用不可として形式検出と手動追加へ縮退する。

マスク対応表の暗号化、OPFS、復旧、競合、一覧メタデータ境界は[マスク対応表のローカル保存要件](local-work-history-requirements.md)と[Storage API利用方針](storage-api-policy.md)を参照する。

この100文書PoC時点では現行モデルを維持し、次の未見データ評価へ進めた。最終の採用判断は3.7に記載する。8GB級PC、macOS Chrome、初回取得失敗・低速回線の確認は後続フェーズへ延期する。

### 3.7 未見100文書による最終確認（2026年7月14日）

モデル選定時の調整が評価結果へ混入しないよう、`corpus-holdout.json`を選定用コーパスから分離した。最終確認用データは100文書で、うち50文書は正解注釈を持つ肯定例、50文書は評価対象を含まない否定例である。

| カテゴリ | 正解出現数 | 一意な正解対象数 |
| --- | ---: | ---: |
| 人名 | 51 | 50 |
| 組織名 | 50 | 50 |
| 住所・施設 | 50 | 50 |

- コーパスSHA-256：`8edcf16c52de8d8791f784e99ca60500040f125bea622cc29d1d34b7ae963137`
- 選定用コーパスとの文書ID重複：0件
- 選定用コーパスとのカテゴリ・正解文字列重複：0件
- 空文書：0件

未見100文書の結果：

| モデル | 生NER P/R/F1 | アプリ統合後 P/R/F1 | 人名F1 | 組織F1 | 住所F1 | 平均推論時間 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `jiting` Q8 | 84.3% / 86.0% / 85.1% | 75.0% / 72.0% / 73.5% | 87.0% | 76.3% | 59.0% | 20.5ms/文書 |
| `sabaridsnfuji` Q8 | 85.8% / 84.7% / 85.2% | 75.0% / 72.0% / 73.5% | 86.0% | 75.5% | 60.2% | 20.2ms/文書 |

アプリ統合後は、両モデルともTP 108、FP 36、FN 42で総合指標が一致した。カテゴリ別では`jiting`が人名と組織名、`sabaridsnfuji`が住所のPrecisionでわずかに上回るが、採用判断を変える差ではない。

選定用・最終確認用の合計200文書、419出現、414対象文字列を統合した結果：

| モデル | 生NER P/R/F1 | アプリ統合後 P/R/F1 | 人名F1 | 組織F1 | 住所F1 |
| --- | --- | --- | ---: | ---: | ---: |
| `jiting` Q8 | 84.5% / 79.2% / 81.8% | 72.5% / 65.0% / 68.5% | 81.0% | 73.8% | 50.8% |
| `sabaridsnfuji` Q8 | 83.5% / 79.5% / 81.4% | 72.4% / 65.9% / 69.0% | 81.2% | 73.8% | 51.5% |

比較候補のアプリ統合後F1は0.5ポイント高いが、生NER F1は現行が0.4ポイント高い。人名F1差は0.2ポイント、組織名F1は同率であり、独自変換したONNXとTokenizerを配布・更新する保守コストを正当化する改善ではない。

以上から、`jiting/xlm-roberta-ner-japanese_onnx`をMVP採用モデルとする。モデルアクセスは引き続きアダプターとWorkerに閉じ、将来のモデル更新を妨げない。F1値は完全検出を意味せず、原文ハイライトと候補一覧による人手確認を必須とする。

再評価コマンド：

```bash
npm run evaluate:ner -- --corpus evaluation/ner/corpus-holdout.json --model jiting/xlm-roberta-ner-japanese_onnx --device cpu --dtype q8 --output <result.json>
```

## 4. Transformers.js側の確認事項

Phase 3初期実装では、`@huggingface/transformers` 4.2.0を使用し、Web Worker内で`pipeline("token-classification", modelId, { device: "wasm", dtype: "q8" })`を初期化する。モデル出力は`aggregation_strategy: "simple"`を指定して候補変換へ渡す。

量子化形式や実行バックエンドを固定する場合は、Transformers.jsの対象バージョンに合わせて`device`、`dtype`、取得されるONNXファイルを確認する。

例：

```ts
import { pipeline } from "@huggingface/transformers";

const detector = await pipeline(
  "token-classification",
  "jiting/xlm-roberta-ner-japanese_onnx",
  {
    device: "wasm",
    dtype: "q8",
    revision: "8d70fc4",
  },
);
```

これは現行Workerの設定例である。採用モデルの旧形式`model_quantized.onnx`はWASM / q8で利用している。WebGPUへの切替は未採用であり、モデル・Transformers.js・dtype・配信リビジョンを変更する場合は取得ファイルと互換性を再評価する。

評価時は以下を記録する。

- 使用した`@huggingface/transformers`の正確なバージョン
- 指定した`device`と`dtype`（Phase 3初期実装は`wasm` / `q8`）
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
5. 30,000文字程度の実用処理時間
6. 初回ダウンロード容量と初期化時間
7. ライセンスと保守性

マスキング用途では、不要な候補をユーザーが削除または無効化できる一方、見逃された情報はユーザーが気付けない可能性がある。このため、精度指標は総合F1だけでなく再現率を重視する。

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
- 文脈付きの基本的な姓名
- `http://`・`https://`で始まるURL
- 市区町村と番地表現を含む日本語住所

以下は後続候補：

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
- 姓単独候補の一括置換：`山田`、`山田製作所`、`山田線`
- Markdownの単一値コードブロックにある包含関係：`高橋`、`高橋健太`、`高橋由美`
- 同姓同名の複数出現
- 会社名と一般名詞の曖昧性
- 都道府県名、市区町村、町名、番地、建物名
- ひらがな、カタカナ、漢字、英字の人名
- 明示ラベル・構造化人名フィールド内のTitle Case・全大文字英語氏名
- 文脈のない英語氏名を形式検出せず、同じ文字列を`PER`出力時だけ維持する境界
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
- 10,000文字および30,000文字の推論時間
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
- 30,000文字
- 上限候補を超える入力

## 10. ネットワーク・キャッシュ評価

ブラウザ開発者ツールまたは自動テストで以下を確認する。

- 初回に取得されるモデル・トークナイザー資材
- 2回目以降のキャッシュ利用
- 原文がリクエストURL、本文、ヘッダーへ含まれないこと
- 検出結果や対応表が送信されないこと
- モデル取得失敗時にユーザーデータが失われないこと
- キャッシュ消去後に再取得できること
- 固定リビジョンのモデル資材が2回目以降にブラウザキャッシュから利用されること
- Service WorkerのアプリシェルキャッシュとTransformers.jsのモデルキャッシュが二重管理にならないこと
- モデルキャッシュが利用できないオフライン起動でも、形式検出と手動追加が継続できること

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

- `@huggingface/transformers` 4.2.0を導入
- 初期候補モデルをWorker内でロードする実装を追加
- 量子化ONNXを優先するため、初期設定は`device: "wasm"`、`dtype: "q8"`とする
- 実際に利用されたモデルファイルを記録
- WebGPUとWASMで起動確認

### Step 2：単文NER

- 短い日本語例文でラベルとサブワード出力を確認
- エンティティ結合処理を実装
- 元文字位置へのマッピングを確認

### Step 3：性能測定

- 1,000文字、10,000文字、30,000文字で測定
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
- 30,000文字処理でタブクラッシュや継続的なメモリ増加がない
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
| 30,000 chars | | | | |

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
- [`sabaridsnfuji/xlm-roberta-name-entity-recognition-japanese`](https://huggingface.co/sabaridsnfuji/xlm-roberta-name-entity-recognition-japanese)
- [`Mizuiro-sakura/deberta-v2-base-japanese-finetuned-ner`](https://huggingface.co/Mizuiro-sakura/deberta-v2-base-japanese-finetuned-ner)
- [`knosing/japanese_ner_model`](https://huggingface.co/knosing/japanese_ner_model)
- [`tohoku-nlp/bert-base-japanese-v3`](https://huggingface.co/tohoku-nlp/bert-base-japanese-v3)
- [`Mizuiro-sakura/luke-japanese-base-finetuned-ner`](https://huggingface.co/Mizuiro-sakura/luke-japanese-base-finetuned-ner)

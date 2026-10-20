# note drafts

GitHub Pages 上で動く、note 用の下書きエディタ。完全パブリック構成・ビルド不要・外部 CDN 依存なし。

```
public repo（このリポジトリ）
├── index.html / app.js / style.css   ← Pages で配信されるアプリ
├── vendor/markdown-it.js             ← 同梱ライブラリ
└── drafts/                           ← 下書き本体（全員に見える）
    └── 2026-10-20-xxx.md
          ---
          title: "..."
          status: draft | review | published
          why: |   / how: |   / what: |      ← 構想（WHY/HOW/WHAT）
          ---
          本文(Markdown)
```

## 設計上のポイント

- **読み込みはトークン不要**。公開 repo の Contents API は未認証で叩ける（60 req/h）。Pages の URL `<owner>.github.io/<repo>/` から owner/repo を自動推定するので、開くだけで一覧が出る。
- **保存・削除だけ PAT が必要**。静的サイトには認証なしで書き込む手段がないため。fine-grained PAT をユーザーが設定画面で貼り、`localStorage` にだけ保存する。サーバは持たない。
- **競合は楽観ロック**（`sha`）で検出。別端末との競合は 409/422 で通知、自動マージはしない。
- **note 連携は HTML コピー**。非公式 API は使わない（CORS・規約・変更リスク）。Markdown → HTML を `text/html` としてクリップボードに載せ、note の本文欄に貼る。表は note 非対応。
- **構想は本文と分離**して frontmatter に持つ。note には出さず、AI 用プロンプトの材料にする。

## セットアップ

1. このリポジトリを public で作り、全ファイルを push（`vendor/`, `drafts/` ディレクトリごと）
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`
3. `https://<owner>.github.io/<repo>/` を開く → 一覧に `drafts/` の内容が出る

### 保存できるようにする（任意）

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**

- Repository access: **Only select repositories** → このリポジトリだけ
- Permissions → Repository permissions → **Contents: Read and write**
- アプリの ⚙ 設定 → Token に貼る

トークンを入れると API 上限も 5000 req/h に上がる。

## 使い方

- `＋ 新規` → 構想欄（WHY / HOW / WHAT）を埋め、本文を書く → `⌘S` / `Ctrl+S` で保存。ファイル名は `YYYY-MM-DD-<slug>.md` で自動生成。
- `AI用にコピー` → 構想を Markdown に整形したプロンプトをコピー。本文が空なら「構成を提案して」、本文があれば本文も同梱して「構想と照らしてレビューして」が末尾に付く（設定で差し替え可）。
- `note用にコピー` → note の新規記事画面で本文欄に貼り付け。タイトルは `T` ボタンで別途コピー。
- `プレビュー` で右ペインに描画（note の見た目とは完全一致しない）。
- 画像は note 側で直接アップロードする前提。

## 注意

- **下書きは全世界に公開される**。未公開ネタ・個人情報はここに置かない。
- PAT は localStorage に平文で入る。共用 PC では使わない。
- Pages 側のファイル配信は commit から 1〜2 分遅れるが、アプリは API 経由で読むので保存直後でも最新が見える。

## トラブルシュート

- 赤いバナーが出る → 書かれているファイルが同階層にあるか確認（zip 展開時にディレクトリが欠けていないか）
- `403` で一覧が出ない → 未認証の API 上限。トークンを入れるか 1 時間待つ
- `drafts/` が空だと一覧が 404 になる → 何か 1 ファイル置く

## 次の拡張候補

- CodeMirror 6 への置き換え
- 自動保存（debounce + 競合時の再読込）
- `status: published` の記事だけを別ページで一覧表示

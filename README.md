# note drafts

GitHub Pages 上で動く、note 用の下書きエディタ。
ビルド不要の静的 SPA（`index.html` / `app.js` / `style.css`）。

```
Pages (この public repo)          private repo（データ）
┌─────────────────────┐   PAT    drafts/
│ エディタ / プレビュー   ├────────▶  2026-10-20-xxx.md
│ note 用 HTML コピー     │  REST       ---
└─────────────────────┘             title: "..."
                                     status: draft|review|published
                                     ---
                                     本文(Markdown)
```

## 設計上のポイント

- **認証**: 公開 JS にトークンは埋め込めないので、fine-grained PAT をユーザーが設定画面で貼り、`localStorage` にだけ保存する。サーバは一切持たない。
- **保存**: GitHub Contents API を直接叩く。`sha` を渡す楽観ロックなので、別端末との競合は 409/422 で検出される（自動マージはしない）。
- **note 連携**: 非公式 API は使わない（CORS・規約・変更リスク）。Markdown → HTML を `text/html` としてクリップボードに載せ、note の本文欄に貼る。見出し・リスト・リンク・引用・コードブロックはほぼそのまま入る。表は note 側が非対応なので手修正が必要。

## セットアップ

### 1. データ用 private repo を作る

例: `note-drafts-data`（Private）。空で構わないが、`drafts/.gitkeep` を置いておくと一覧取得が 404 にならない。

### 2. fine-grained PAT を発行

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token

- Repository access: **Only select repositories** → `note-drafts-data` だけ
- Permissions → Repository permissions → **Contents: Read and write**
- 他は何も付けない。Expiration は運用に合わせて（短めにして定期更新が無難）

### 3. このアプリを Pages で公開

1. この 3 ファイルを public repo（例: `note-drafts`）に push
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`
3. `https://<you>.github.io/note-drafts/` を開く

### 4. 初回起動

設定ダイアログに Owner / Repo / Branch / Directory / Token を入力して保存。

## 構想（WHY / HOW / WHAT）

左ペインに記事ごとの構想欄がある。本文とは分離して frontmatter に保存され、note へのコピーには含まれない。

```yaml
---
title: "..."
status: draft
why_reader: |      # 読み手になってほしい姿
  ...
why_message: |     # 伝えたいこと
  ...
how_content: |     # どのような内容
  ...
how_thought: |     # 自分が思ったこと
  ...
what: |            # 具体的な内容
  ...
---
本文
```

`AI用にコピー` を押すと、構想を Markdown に整形したプロンプトがクリップボードに入る。

- 本文が空のとき → 「構成を提案して・穴を指摘して」という依頼文を末尾に付ける
- 本文があるとき → 本文も同梱し「構想と照らしてレビューして」という依頼文を付ける

末尾の依頼文は設定ダイアログで差し替え可能。

## 使い方

- `＋ 新規` → タイトルと本文を書く → `⌘S` / `Ctrl+S` で保存。ファイル名は `YYYY-MM-DD-<slug>.md` で自動生成。
- `note用にコピー` → note の新規記事画面で本文欄に貼り付け。タイトルは `T` ボタンで別途コピー。
- `プレビュー` で右ペインに描画（note の見た目とは完全一致しない）。
- 画像は現状 note 側で直接アップロードする前提（`![]()` は note では展開されない）。

## セキュリティ上の注意

- PAT は localStorage に平文で入る。共用 PC では使わない。XSS があれば盗まれるので、プレビューは `html: false` で描画し、外部スクリプトは esm.sh の markdown-it のみ。
- このアプリは **自分専用** を想定。他人に使わせるなら OAuth App + 小さなプロキシ（Cloudflare Workers 等）に切り替えること。

## 次の拡張候補

- CodeMirror 6 への置き換え（シンタックスハイライト・ショートカット）
- 画像を private repo に置き、note 用コピー時に注意喚起 or 自動アップロード（拡張機能経由）
- `status: published` を Actions で public repo に同期（B 案への移行）
- 自動保存（debounce + 競合時の再読込）

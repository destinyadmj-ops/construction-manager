# PDF 日本語フォント（任意）

`/api/templates/pdf` で日本語を「綺麗に」出すには、日本語対応のTTFを同梱してください。

## 配置先

- `public/fonts/NotoSansJP-Regular.ttf`

## 手順

1. Noto Sans JP（Regular）のTTFを公式配布元から入手
2. 上記パスへ `NotoSansJP-Regular.ttf` として配置
3. 再起動後、PDF生成で日本語がそのまま描画されます

## 補足

- フォントが見つからない場合は、PDF生成自体は失敗しないようにフォールバックします（日本語は置換されます）。

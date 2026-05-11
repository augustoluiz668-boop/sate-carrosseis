# S.A.T.E. — Carrosseis Diários

Pipeline automatizado de carrosseis para o Instagram do **Sindicato dos Auxiliares e Técnicos de Enfermagem de Bauru e Região** ([@sindicato.satebaurueregiao](https://www.instagram.com/sindicato.satebaurueregiao/)).

Posta 1 carrossel por dia, 09:00 BRT, sem intervenção manual.

---

## Fluxo

```
Briefing diário → Claude gera meta.json + caption →
  npm run render → PNGs 1080×1350 →
    GitHub Actions cron 09:00 BRT →
      Instagram Graph API → publicado
```

## Comandos

```bash
npm install                          # primeira vez

# Renderizar slides do dia
npm run render                       # hoje
npm run render -- 2026-05-12         # data específica

# Publicar manualmente (precisa .env preenchido)
npm run publish

# Render + publish
npm run post:now
```

## Setup Meta Graph API (one-time)

1. Conectar Instagram à Página do Facebook.
2. Criar App em [developers.facebook.com](https://developers.facebook.com).
3. Produtos: **Instagram Graph API** + **Facebook Login**.
4. Permissões: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
5. Gerar Long-Lived User Token (60d) → trocar por Page Token (não expira).
6. Pegar `IG_BUSINESS_ID` via `GET /me/accounts`.
7. Adicionar em GitHub → Settings → Secrets:
   - `IG_ACCESS_TOKEN`
   - `IG_BUSINESS_ID`

## Estrutura

| Pasta | O quê |
|---|---|
| `brand/` | Logo, paleta, fontes |
| `templates/` | HTML de cada estilo de carrossel (`data-comemorativa.html`, etc.) |
| `posts/YYYY-MM-DD/` | meta.json + caption.txt + slides PNG |
| `scripts/` | render.js, publish.js |
| `.github/workflows/daily-post.yml` | Cron diário |

## Criar novo post

1. `mkdir posts/2026-05-13`
2. Criar `meta.json` com `template` + `data` (variáveis do template).
3. Criar `caption.txt`.
4. `npm run render -- 2026-05-13` para preview local.
5. Commit + push. Cron publica no horário agendado.

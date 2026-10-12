# shopr

Build a moodboard of clothes you like, and shopr searches secondhand shops for listings that look like it, so you can skip the garbage keyword search returns.

This is the **Phase 0 prototype**. Its job is to answer one question: *does ranking by look beat keyword search for someone with specific taste?* The feed blindly mixes shopr's picks with plain keyword-search results and tracks which ones you like. If shopr's picks don't win clearly, nothing else matters.

```
backend/   Python server: image model, taste profile, shop connectors, ranking, API
app/       Expo app: one codebase for the iPhone app and the website
```

## How it works

1. **Moodboard in.** Add photos, screenshots, short videos (shopr keeps distinct frames) or links (Pinterest pins and product pages, via the page's preview image).
2. **Taste profile.** Each image goes through [Marqo-FashionSigLIP](https://huggingface.co/Marqo/marqo-fashionSigLIP), an image model fine-tuned on fashion. That captures cut, fabric, fade and era in a way keywords can't. The board is clustered into a few *directions* (say, Americana workwear plus 90s NFL sweatshirts) so they don't average into mush.
3. **Search queries.** Each direction gets tags (garment, material, style, colour) by comparing it to text in the same model, which turns them into marketplace searches. With an Anthropic API key, Claude looks at each direction's images and writes the queries instead.
4. **Listings.** Pulled from:
   - **Independent Shopify vintage and archive shops** (36 verified to work, 20 on by default, add your own in Setup). shopr pulls their whole in-stock catalog, so no keyword is involved.
   - **eBay** (keyword search plus image search with your board photos) and **Etsy**, if you add API keys.
5. **Ranking.** Each listing photo is scored by similarity to your board images and directions. Every 10 ratings it re-ranks to pull towards what you liked and away from what you passed. Each direction gets feed slots in proportion to its share of the board, and near-duplicate photos are dropped.
6. **Blind test.** Team-draft interleaving mixes shopr's ranking with keyword-search results (the shops' own search order, or keyword matching for Shopify) without telling you which is which. **Setup → Is it working?** shows the like rate for each.

## Run it

You need [uv](https://docs.astral.sh/uv/) (Python), Node.js and Git, plus about 4 GB of free disk space and 4 GB of free memory.

### Windows

Use **Command Prompt** (search for "cmd"), not PowerShell: PowerShell often blocks the `npx` command.

1. Install the tools (skip any you already have), then **close and reopen Command Prompt** so it can find them:

   ```bat
   winget install -e --id Git.Git
   winget install -e --id OpenJS.NodeJS.LTS
   winget install -e --id astral-sh.uv
   winget install -e --id Microsoft.VCRedist.2015+.x64
   ```

2. Download shopr and install it. This takes several minutes the first time:

   ```bat
   git clone -b claude/youthful-darwin-mcsbnd https://github.com/nse06/shopr.git
   cd shopr\backend
   uv sync --extra ml
   cd ..\app
   npm ci
   npx expo export --platform web
   ```

3. Start the server:

   ```bat
   cd ..\backend
   uv run shopr
   ```

   When Windows Firewall asks about Python, allow it on **private networks**, or your phone can't connect.

Next time, you only need `cd shopr\backend` and `uv run shopr`. To get updates, run `git pull` in the `shopr` folder, then repeat step 2 from `uv sync`.

### Mac and Linux

```sh
make setup     # Python deps + image-model libraries, and the app's npm packages
make web       # build the website into app/dist
make server    # start the server on port 8000
```

### First run

Open http://localhost:8000. The first start downloads the image model (about 800 MB, cached after that), so the moodboard accepts images about a minute after the server starts.

**First search:** pulling 20 shop catalogs takes about 20 seconds. Analyzing photos is the slow part: about 6 photos/s on a 4-core CPU, faster on newer laptops and Apple Silicon. Each search analyzes up to 2,500 new photos (`SHOPR_EMBED_BUDGET`), most relevant first, and later searches pick up the rest.

### API keys (optional)

Copy `backend/.env.example` to `backend/.env`:

| Key | What it adds | Where to get it |
|---|---|---|
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | eBay keyword and image search | [eBay developer keys](https://developer.ebay.com/my/keys), production keyset |
| `ETSY_KEYSTRING`, `ETSY_SHARED_SECRET` | Etsy search (lots of real vintage) | [Etsy apps](https://www.etsy.com/developers/your-apps) |
| `ANTHROPIC_API_KEY` | Claude writes the search queries from your board | [Anthropic console](https://console.anthropic.com) |
| `EBAY_CAMPAIGN_ID` | eBay Partner Network affiliate links | [EPN](https://partnernetwork.ebay.com) |

### On your iPhone

1. Every push that touches `app/` runs the **iOS app (unsigned IPA)** GitHub Action. Download `shopr-unsigned.ipa` from the run's artifacts, or from the `ios-latest` pre-release on the Releases page.
2. Sideload it (Sideloadly, AltStore or similar sign it with your Apple ID). Apps signed with a free Apple ID expire after 7 days, so re-sideload when that happens.
3. Start the server on your computer (`uv run shopr` or `make server`). It prints the address to use, e.g. `http://192.168.1.20:8000`.
4. In the app, open **Setup**, enter that address and tap **Save and connect**. The first time, iOS asks for local network access; allow it.

**If the phone can't connect:** both devices must be on the same Wi-Fi, and some networks (guest, hotel, campus) block devices from talking to each other. On Windows, the Wi-Fi network must be set to **Private** and Python allowed through the firewall (Windows Security → Firewall & network protection → Allow an app through firewall).

**Away from home Wi-Fi:** expose the server through a tunnel, for example `cloudflared tunnel --url http://localhost:8000`, and use the `https://…trycloudflare.com` address in the app. **Set `SHOPR_TOKEN` in `.env` first** and enter the same token in the app, since anyone with the URL could otherwise use your server.

## Using it

1. **Moodboard tab:** add 20–30 images, with variety. "What shopr sees" shows the directions it found and the searches it will run.
2. **Feed tab:** tap **Find listings**, then rate items with Like / Pass. Tap the photo to open the listing. On the web, use ← / → / Enter / Backspace.
3. **Setup tab:** set price and size filters, turn shops on or off, and check **Is it working?** Rate at least 50 from each side before trusting the numbers.

## Limits of this prototype

- **Depop, Grailed, Vinted and Poshmark aren't included.** They have no public API, and scraping breaks their terms.
- **Instagram and TikTok links usually fail,** because those sites hide previews from apps. Screenshots work.
- **Size filtering** only works where a shop lists sizes (Shopify variants). Listings with no size info are kept.
- **The eBay and Etsy connectors** follow the official API docs and are covered by mocked tests, but haven't been run against live keys yet. Likewise the Claude query step.
- **Single user, local data:** everything lives in `backend/data/` (SQLite plus images) and is gitignored.

## Development

```sh
cd backend && uv run pytest -q                    # backend tests (fake embedder, mocked HTTP)
cd app && npx tsc --noEmit && npx expo lint       # app checks
cd app && npx expo start                          # live-reloading dev server for the app
```

# shopr

Build a moodboard of clothes you like, and shopr searches secondhand shops for listings that look like it, so you can skip the garbage keyword search returns.

This is the **Phase 0 prototype**. Its job is to answer one question: *does ranking by look beat keyword search for someone with specific taste?* The feed blindly mixes shopr's picks with plain keyword-search results and tracks which ones you like. If shopr's picks don't win clearly, nothing else matters.

```
backend/   Python server: image model, taste profile, shop connectors, ranking, API
app/       Expo app: one codebase for the iPhone app and the website
```

## How it works

1. **Moodboard in.** Pin photos, screenshots, short videos (shopr keeps distinct frames) or links (Pinterest pins and product pages, via the page's preview image) to a corkboard, and arrange them however you like.
2. **Taste profile.** Each image goes through [Marqo-FashionSigLIP](https://huggingface.co/Marqo/marqo-fashionSigLIP), an image model fine-tuned on fashion. That captures cut, fabric, fade and era in a way keywords can't. The board is clustered into a few *styles* (say, Americana workwear plus 90s NFL sweatshirts) so they don't average into mush.
3. **Search queries.** Each style gets tags (garment, material, style, colour) by comparing it to text in the same model, which turns them into marketplace searches. With an Anthropic API key, Claude looks at each style's images and writes the queries instead.
4. **Listings,** limited to your sizes and price range (asked before the first search), from:
   - **eBay** (keyword search plus image search with your board photos) and **Etsy**, once connected in **Setup**.
   - **Independent Shopify vintage and archive shops** (36 verified, 20 on by default, add your own in Setup), through each shop's own search box. An optional deep scan pulls whole catalogs instead: slower, but it finds what keyword search misses.
   - Depop, Grailed, Poshmark and Vinted don't let apps search them, so **Moodboard → Styles** has one-tap links that open your searches there.
5. **Ranking.** Each listing photo is scored by similarity to your board images and styles, pulled towards listings like the ones you save and open. Each style gets grid slots in proportion to its share of the board, and near-duplicate photos are dropped. Matches start appearing within seconds and fill in while the search runs.
6. **Blind test.** Team-draft interleaving mixes shopr's ranking with plain keyword-search results (the shops' own search order) without telling you which is which. **Setup → Is it working?** counts opens and saves for each.

## Run it

You need [uv](https://docs.astral.sh/uv/) (Python), Node.js and Git, plus about 4 GB of free disk space and 4 GB of free memory.

### Windows

Open **Command Prompt** (search for "cmd"), paste this line and press Enter:

```bat
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/nse06/shopr/refs/heads/claude/youthful-darwin-mcsbnd/scripts/install-windows.ps1 | iex"
```

It installs what shopr needs (Git, Node.js, uv), downloads shopr into a `shopr-app` folder in your user folder, sets it up and puts a **Start shopr** icon on your desktop. The first run takes 10–20 minutes. Windows will ask for permission a few times while installing tools: click **Yes**. To update shopr later, close shopr and run the same line again.

To use shopr, double-click **Start shopr**. A window opens and your browser opens shopr. Keep the window open while you use it. The window also shows the address to type into the phone app. The first time, when Windows asks whether Python may use the network, click **Allow**.

The installer is [`scripts/install-windows.ps1`](scripts/install-windows.ps1) if you want to see what it does.

### Mac and Linux

```sh
make setup     # Python deps + image-model libraries, and the app's npm packages
make web       # build the website into app/dist
make server    # start the server on port 8000
```

### First run

Open http://localhost:8000. The first start downloads the image model (about 800 MB, cached after that), so the moodboard accepts images about a minute after the server starts.

**Searches** take about two minutes the first time: searching 20 shops takes seconds, and checking listing photos against your board is the slow part (about 6 photos/s on a 4-core CPU, faster on newer laptops). The first matches show up within about 30 seconds. Each search checks up to 600 new photos (`SHOPR_EMBED_BUDGET`); photos it has already checked are remembered, so later searches are quicker.

### Connecting eBay, Etsy and Claude (optional)

In the app, go to **Setup → Where shopr searches** and follow the steps. shopr checks each key with the service before saving it. The keys stay in the database on your computer.

| Source | What it adds | Where to get a key |
|---|---|---|
| eBay | Keyword and image search on the biggest secondhand marketplace | [eBay developer keys](https://developer.ebay.com/my/keys), Production keyset |
| Etsy | Search across lots of real vintage | [Etsy apps](https://www.etsy.com/developers/your-apps) |
| Claude | Better search terms written from your board | [Anthropic console](https://console.anthropic.com/settings/keys) |

You can also put keys in `backend/.env` (see `.env.example`), along with `EBAY_CAMPAIGN_ID` for eBay Partner Network affiliate links.

### On your iPhone

1. Every push that touches `app/` runs the **iOS app (unsigned IPA)** GitHub Action. Download `shopr-unsigned.ipa` from the run's artifacts, or from the `ios-latest` pre-release on the Releases page.
2. Sideload it (Sideloadly, AltStore or similar sign it with your Apple ID). Apps signed with a free Apple ID expire after 7 days, so re-sideload when that happens.
3. Start the server on your computer (double-click **Start shopr** on Windows, or run `make server`). Its window shows the address to use, e.g. `http://192.168.1.20:8000`.
4. In the app, open **Setup**, enter that address and tap **Save and connect**. The first time, iOS asks for local network access; allow it.

**If the phone can't connect:** both devices must be on the same Wi-Fi, and some networks (guest, hotel, campus) block devices from talking to each other. On Windows, the Wi-Fi network must be set to **Private** and Python allowed through the firewall (Windows Security → Firewall & network protection → Allow an app through firewall).

**Away from home Wi-Fi:** expose the server through a tunnel, for example `cloudflared tunnel --url http://localhost:8000`, and use the `https://…trycloudflare.com` address in the app. **Set `SHOPR_TOKEN` in `.env` first** and enter the same token in the app, since anyone with the URL could otherwise use your server.

## Using it

1. **Moodboard:** pin 20–30 photos with variety. Drag to arrange, tap a photo to resize or remove it, and drag the empty board to scroll. **Styles** shows what shopr sees, plus links to search Depop, Grailed, Poshmark and Vinted.
2. **Shop:** pick your sizes and price range, and listings fill in as shopr finds them. Tap a listing to open it, tap ♡ to save it. **Edit** changes sizes and price.
3. **Saved:** everything you've hearted.
4. **Setup:** connect eBay/Etsy/Claude, turn shops on or off, and check **Is it working?**

## Limits of this prototype

- **Depop, Grailed, Vinted and Poshmark can't be searched by shopr.** They have no public API, Depop has shut the unofficial one, and Grailed blocks automated access. shopr links to your searches on them instead.
- **Instagram and TikTok links usually fail,** because those sites hide previews from apps. Screenshots work.
- **Size filtering** reads sizes from shop data, tags and titles ("Chore Coat - L", "SZ M", "W32"). Listings that don't say their size are kept.
- **The eBay and Etsy connectors** follow the official API docs and are covered by mocked tests, but haven't been run against live keys yet. Likewise the Claude query step.
- **Single user, local data:** everything lives in `backend/data/` (SQLite plus images) and is gitignored.

## Development

```sh
cd backend && uv run pytest -q                    # backend tests (fake embedder, mocked HTTP)
cd app && npx tsc --noEmit && npx expo lint       # app checks
cd app && npx expo start                          # live-reloading dev server for the app
```

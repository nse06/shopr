# shopr

**Your personal AI stylist.** Pin photos of clothes you love to a cork moodboard, and the stylist searches Depop, eBay and 20 independent vintage and archive shops, looks at every listing photo, and puts the nine pieces that fit your taste best on your home screen. Chat underneath to steer it ("only jackets", "under $100"), and open **More picks** for the rest.

Share your board and others can find it on **Explore**: a fan can browse an influencer's board, pin single photos onto their own, or copy the whole thing.

It's a website, so it works on a phone and a laptop with nothing to install. Add it to your iPhone's home screen and it opens like an app.

## Put it online (one time, about 10 minutes, no command line)

You need three things: a GitHub account (this repository), a free [Vercel](https://vercel.com) account, and a Claude API key.

**1. Get a Claude API key.** Go to [console.anthropic.com](https://console.anthropic.com), sign in, add some credit under **Billing** ($10 is plenty to start), then open **API keys → Create key** and copy it. The API is billed separately from a Claude.ai subscription.

**2. Import the project into Vercel.** On [vercel.com](https://vercel.com), sign up with GitHub, click **Add New… → Project**, pick **shopr** and click **Import**. Vercel recognises it as a Next.js app; leave the build settings as they are.

**3. Add your keys** under **Environment Variables** on that same screen, before you click Deploy:

| Name | Value | Needed? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key | Yes |
| `APP_PASSWORD` | A password you make up | Strongly recommended. Without it, anyone with your link can use your Claude credit |
| `EBAY_CLIENT_ID` | eBay **App ID (Client ID)**, Production keyset | Optional, adds eBay |
| `EBAY_CLIENT_SECRET` | eBay **Cert ID (Client Secret)**, Production keyset | Optional, adds eBay |
| `EBAY_CAMPAIGN_ID` | eBay Partner Network campaign ID | Optional, makes eBay links affiliate links |
| `APIFY_TOKEN` | Your Apify API token | Optional, adds Depop |

eBay keys come from [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys). For Depop, sign up free at [apify.com](https://apify.com) (no card needed) and copy your token from **Settings → API & Integrations** ([console.apify.com/settings/integrations](https://console.apify.com/settings/integrations)); shopr runs the [Depop Scraper](https://apify.com/khadinakbar/depop-scraper) actor with it. Without these, shopr still searches the 20 independent shops.

**4. Click Deploy.** About a minute later you get a link like `shopr-yourname.vercel.app`. That's your stylist.

**5. Switch on sharing (optional, for Explore and shared boards).** In your Vercel project open **Storage → Create → Blob**. When it asks about access, choose **Public** (shared boards are public, and this can't be changed later), then connect the store to the project for all environments. Redeploy (**Deployments → ⋯ → Redeploy**). Settings in shopr will say "Sharing is on".

**On your iPhone:** open the link in Safari, tap **Share → Add to Home Screen**.

**Changing a key later:** Vercel → your project → **Settings → Environment Variables**, change it, then **Deployments → ⋯ → Redeploy**.

**Updates:** every change pushed to this repository on GitHub goes live by itself in a minute or two. There's nothing to restart.

## How it works

1. **Moodboard.** Add photos, screenshots, videos (shopr keeps a still from each) or links (Pinterest pins, shop pages). Each one lands on a cork board as a tilted polaroid with a push-pin (or a strip of tape). Drag them around and resize them like pinning to a wall; **Tidy up** puts them back in neat columns.
2. **Your style, read.** Claude looks at the whole board and writes up what it sees: a headline, the directions in your taste, key pieces, palette, fit, what to look for and what to avoid.
3. **For you.** Claude writes searches the way sellers title listings, shopr runs them on Depop, eBay and every shop at once, and Claude looks at the photos of around 30 results and ranks the ones that suit you, judging the actual cut, fabric, colour and wear against your board. The best nine go on the home screen with their price and shop; it doesn't write about each piece, which keeps it quick and cheap. Results respect your sizes and budget (set them under Settings).
4. **Chat below the picks.** Ask for anything and the picks swap to match; the stylist answers in a line. The ↻ button gets fresh picks from your board.
5. **More picks** shows everything else it ranked, **Find more** searches again for new pieces in the same spirit, and **More like this** on any piece searches using that photo. It also links the same search on Grailed, Depop, Poshmark, Vinted and eBay.
6. **Share and Explore.** **Share** on your board page picks a handle (like `@maya.vintage`) and puts your board, with its style read, at `/u/maya.vintage`. **Explore** lists shared boards and searches them by name, handle or style words ("workwear", "70s", "indigo"). On someone's board, tap a photo and **Add to my board**, or **Copy the whole board**: onto an empty board it keeps their arrangement and their style read; otherwise the photos join your columns. There are no accounts: the device that shared a board holds its key, so only that device can update it or take it down.

Under the hood it's one Next.js app: the pages run in your browser, and a few small server routes run on Vercel (`/api/chat`, `/api/profile`, `/api/import`, `/api/status`, and `/api/boards` for sharing). The stylist uses Claude Opus 5.5 with adaptive thinking and structured output; if Claude's safety system ever declines a request, it's retried on Anthropic's recommended fallback model.

## Good to know

- **Cost.** Vercel's Hobby plan and the eBay API are free. Claude usage is billed to your Anthropic account: roughly 10 to 15 cents for each new set of picks (Claude looks at your board and about 30 listing photos each time), and 5 to 10 cents each time it reads your board. Depop goes through Apify at about half a cent per listing; each set of picks asks for up to 20, so about 10 cents, and Apify's free plan includes $5 a month. Shared boards use a little Vercel Blob storage, which the Hobby plan includes.
- **Depop** has no public API, so shopr uses a community scraper on Apify. Depop's terms don't allow scraping, so it may break or be blocked; if it fails, shopr says so and carries on with the other sources. Leave out `APIFY_TOKEN` to skip it.
- **Your data stays on your device.** The moodboard, picks, conversation and saved pieces are stored in your browser, so your phone and laptop each keep their own. On an iPhone, add shopr to your home screen first and use it from there: iOS keeps home-screen apps' storage separate from Safari's. Photos are sent to Claude only while it's answering. A board you share is the exception: its photos, name and style read are public until you take it down.
- **Password lock and sharing.** With `APP_PASSWORD` set, Explore and shared boards stay open to everyone, but only people with the password can use the stylist, share a board or copy photos.
- **Speed.** New picks take roughly 20 to 60 seconds: Claude thinks, searches, then looks through the listing photos. The screen shows each step.
- **Instagram and TikTok links** usually can't be imported (those sites hide their photos from other apps). A screenshot works.
- **Secondhand pieces sell fast**, so saved links can stop working.

## For developers

```sh
npm install
npm run dev        # http://localhost:3000 (put keys in .env.local; SHOPR_LOCAL_BLOB_DIR=/some/folder stands in for Vercel Blob)
npm test           # unit tests (Claude and the shops are mocked)
npm run lint && npm run typecheck && npm run build
```

`src/lib/server/` holds the server side: `stylist.ts` (the prompt, the search tool and the reply format), `profile.ts` (reading the board), `search.ts` (fanning searches out and choosing candidates), `ebay.ts`, `depop.ts` (the Apify actor), `shops.ts` (the shop list), `fetching.ts` (safe fetching of links and photos), and `boards.ts` + `storage.ts` (shared boards in Vercel Blob). The pages are in `src/app/` and `src/components/` (`Home.tsx` is For you, `PinBoard.tsx` the cork board, `Explore.tsx` and `PublicBoard.tsx` the shared boards); browser storage is in `src/lib/client/store.ts`, requests to the stylist in `src/lib/client/api.ts`, and sharing and copying in `src/lib/client/sharing.ts`. `src/lib/board-layout.ts` places, tilts and tidies the polaroids.

The first version of shopr (a Python server with a local image model that ran on your own computer) is in this repository's history up to commit `0e063c6`.

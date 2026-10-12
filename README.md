# shopr

**Your personal AI stylist.** Pin photos of clothes you love to a moodboard. Then ask for what you want ("a jacket for fall", "something like my board under $150") and the stylist searches eBay and 20 independent vintage and archive shops, looks at every listing photo, and shows you the few pieces worth your time, each with a line on why it suits you.

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

eBay keys come from [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys). Without them, shopr still searches the 20 independent shops.

**4. Click Deploy.** About a minute later you get a link like `shopr-yourname.vercel.app`. That's your stylist.

**On your iPhone:** open the link in Safari, tap **Share → Add to Home Screen**.

**Changing a key later:** Vercel → your project → **Settings → Environment Variables**, change it, then **Deployments → ⋯ → Redeploy**.

**Updates:** every change pushed to this repository on GitHub goes live by itself in a minute or two. There's nothing to restart.

## How it works

1. **Moodboard.** Add photos, screenshots, videos (shopr keeps a still from each) or links (Pinterest pins, shop pages). Arrange them freely: drag photos around and resize them like pinning to a wall.
2. **Your style, read.** Claude looks at the whole board and writes up what it sees: a headline, the directions in your taste, key pieces, palette, fit, what to look for and what to avoid.
3. **Chat.** Ask for anything. Claude writes searches the way sellers title listings, and shopr runs them on eBay and every shop at once (about two seconds). Claude then looks at the photos of around 30 results and picks the best 3 to 6, judging the actual cut, fabric, colour and wear against your board. Results respect your sizes and budget (set them under Settings).
4. **More like this** on any pick searches again using that photo. Each answer also links the same search on Grailed, Depop, Poshmark, Vinted and eBay, which don't allow apps to search them.

Under the hood it's one Next.js app: the pages run in your browser, and four small server routes run on Vercel (`/api/chat`, `/api/profile`, `/api/import`, `/api/status`). The stylist uses Claude Opus 5.5 with adaptive thinking and structured output; if Claude's safety system ever declines a request, it's retried on Anthropic's recommended fallback model.

## Good to know

- **Cost.** Vercel's Hobby plan and the eBay API are free. Claude usage is billed to your Anthropic account: roughly 10 to 20 cents per message (Claude looks at your board and about 30 listing photos each time), and 5 to 10 cents each time it reads your board.
- **Your data stays on your device.** The moodboard, conversation and saved pieces are stored in your browser, so your phone and laptop each keep their own. Photos are sent to Claude only while it's answering.
- **Speed.** A message takes roughly 20 to 60 seconds: Claude thinks, searches, then looks through the listing photos. The screen shows each step.
- **Instagram and TikTok links** usually can't be imported (those sites hide their photos from other apps). A screenshot works.
- **Secondhand pieces sell fast**, so saved links can stop working.

## For developers

```sh
npm install
npm run dev        # http://localhost:3000 (put keys in .env.local)
npm test           # unit tests (Claude and the shops are mocked)
npm run lint && npm run typecheck && npm run build
```

`src/lib/server/` holds the server side: `stylist.ts` (the prompt, the search tool and the reply format), `profile.ts` (reading the board), `search.ts` (fanning searches out and choosing candidates), `ebay.ts`, `shops.ts` (the shop list), `fetching.ts` (safe fetching of links and photos). The pages are in `src/app/` and `src/components/`; browser storage is in `src/lib/client/store.ts`.

The first version of shopr (a Python server with a local image model that ran on your own computer) is in this repository's history up to commit `0e063c6`.

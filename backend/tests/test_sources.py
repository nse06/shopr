import httpx
import pytest
import respx

from shopr.config import Settings
from shopr.ingest import image_url_from_html
from shopr.sources import shopify
from shopr.sources.base import SourceError, to_usd
from shopr.sources.ebay import EbayClient, parse_items
from shopr.sources.etsy import EtsyClient, parse_listings

PRODUCT = {
    "id": 1,
    "title": "1970s Suede Ranch Jacket",
    "handle": "70s-suede-ranch-jacket",
    "body_html": "<p>Pit to pit 22&quot;</p>",
    "vendor": "Vintage",
    "product_type": "Jacket",
    "tags": ["70s", "suede"],
    "options": [{"name": "Size", "position": 1}],
    "variants": [{"price": "185.00", "available": True, "option1": "M"}],
    "images": [{"src": "https://cdn.shopify.com/a.jpg?v=1"}],
}


def test_shopify_parse():
    sold = {**PRODUCT, "id": 2, "variants": [{"price": "10", "available": False, "option1": "S"}]}
    no_image = {**PRODUCT, "id": 3, "images": []}
    out = shopify.parse_products("shop.example", [PRODUCT, sold, no_image], "USD")
    assert len(out) == 1
    item = out[0]
    assert item["id"] == "shopify:shop.example:1"
    assert item["price"] == 185.0
    assert item["sizes"] == ["M"]
    assert item["url"] == "https://shop.example/products/70s-suede-ranch-jacket"
    assert item["image_url"] == "https://cdn.shopify.com/a.jpg?v=1&width=480"
    assert 'Pit to pit 22"' in item["description"]


@respx.mock
@pytest.mark.anyio
async def test_shopify_fetch_store_paginates():
    respx.get("https://shop.example/cart.js").mock(return_value=httpx.Response(200, json={"currency": "GBP"}))
    route = respx.get("https://shop.example/products.json")
    route.side_effect = [
        httpx.Response(200, json={"products": [{**PRODUCT, "id": i} for i in range(250)]}),
        httpx.Response(200, json={"products": [{**PRODUCT, "id": 999}]}),
    ]
    async with httpx.AsyncClient() as client:
        items, currency = await shopify.fetch_store(client, "shop.example")
    assert currency == "GBP" and len(items) == 251 and items[0]["currency"] == "GBP"


def test_normalize_domain():
    assert shopify.normalize_domain("https://Shop.Example.com/collections/all") == "shop.example.com"


def test_ebay_parse():
    body = {"itemSummaries": [{
        "itemId": "v1|123|0", "title": "Vintage Carhartt Chore Coat", "price": {"value": "89.99", "currency": "USD"},
        "image": {"imageUrl": "https://i.ebayimg.com/images/g/abc/s-l225.jpg"},
        "itemWebUrl": "https://www.ebay.com/itm/123", "itemAffiliateWebUrl": "https://ebay.us/aff",
        "condition": "Pre-owned", "seller": {"username": "someone", "feedbackScore": 10},
    }]}
    item = parse_items(body)[0]
    assert "seller" not in item["extra"] and "someone" not in str(item)  # no eBay user data is kept
    assert item["id"] == "ebay:v1|123|0"
    assert item["price"] == 89.99
    assert item["image_url"].endswith("s-l500.jpg")
    assert item["url"] == "https://ebay.us/aff"


@respx.mock
@pytest.mark.anyio
async def test_ebay_search_auths_and_searches():
    s = Settings(ebay_client_id="id", ebay_client_secret="secret")
    respx.post("https://api.ebay.com/identity/v1/oauth2/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok", "expires_in": 7200})
    )
    search = respx.get("https://api.ebay.com/buy/browse/v1/item_summary/search").mock(
        return_value=httpx.Response(200, json={"itemSummaries": []})
    )
    async with httpx.AsyncClient() as http:
        res = await EbayClient(s, http).search("chore coat")
    assert res.listings == []
    req = search.calls[0].request
    assert req.headers["Authorization"] == "Bearer tok"
    assert req.url.params["q"] == "chore coat"
    assert req.url.params["category_ids"] == "1059,93427,4250"


def test_etsy_parse():
    item = parse_listings([{
        "listing_id": 5, "title": "70s western shirt", "price": {"amount": 4500, "divisor": 100, "currency_code": "USD"},
        "url": "https://www.etsy.com/listing/5", "when_made": "1970s",
        "images": [{"rank": 2, "url_570xN": "b.jpg"}, {"rank": 1, "url_570xN": "a.jpg"}],
    }])[0]
    assert item["price"] == 45.0 and item["image_url"] == "a.jpg" and item["extra"]["when_made"] == "1970s"


@respx.mock
@pytest.mark.anyio
async def test_etsy_search_keeps_search_order():
    s = Settings(etsy_keystring="k", etsy_shared_secret="s")
    respx.get("https://openapi.etsy.com/v3/application/listings/active").mock(
        return_value=httpx.Response(200, json={"results": [{"listing_id": 2}, {"listing_id": 1}]})
    )
    batch = respx.get("https://openapi.etsy.com/v3/application/listings/batch").mock(
        return_value=httpx.Response(200, json={"results": [
            {"listing_id": 1, "title": "one", "price": {"amount": 1, "divisor": 1}, "images": [{"url_570xN": "1.jpg"}]},
            {"listing_id": 2, "title": "two", "price": {"amount": 2, "divisor": 1}, "images": [{"url_570xN": "2.jpg"}]},
        ]})
    )
    async with httpx.AsyncClient() as http:
        res = await EtsyClient(s, http).search("western shirt")
    assert [x["id"] for x in res.listings] == ["etsy:2", "etsy:1"]
    assert batch.calls[0].request.headers["x-api-key"] == "k:s"


def test_og_image():
    html = '<html><head><meta property="og:image" content="/img/pin.jpg"></head></html>'
    assert image_url_from_html(html, "https://www.pinterest.com/pin/1/") == "https://www.pinterest.com/img/pin.jpg"


def test_to_usd():
    assert to_usd(100, "GBP") == pytest.approx(133)
    assert to_usd(100, "XYZ") is None
    assert to_usd(None, "USD") is None


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_shopify_parse_suggest():
    products = [
        {"id": 7, "title": "Vintage Chore Coat - L", "handle": "chore", "available": True, "price": "115.00",
         "image": "//cdn.shopify.com/a.jpg?v=2", "tags": ["ATT|Size adults|L"], "type": "Coats", "vendor": "Eddie Bauer",
         "body": "<p>Pit to pit 24&quot;</p>"},
        {"id": 8, "title": "Sold", "handle": "sold", "available": False, "price": "1.00", "image": "https://x/y.jpg"},
        {"id": 9, "title": "No photo", "handle": "nophoto", "available": True, "price": "1.00"},
    ]
    out = shopify.parse_suggest("shop.example", products, "GBP")
    assert [x["id"] for x in out] == ["shopify:shop.example:7"]
    item = out[0]
    assert item["image_url"] == "https://cdn.shopify.com/a.jpg?v=2&width=480"
    assert item["price"] == 115.0 and item["currency"] == "GBP" and item["sizes"] == ["L"]
    assert item["url"] == "https://shop.example/products/chore"
    assert 'Pit to pit 24"' in item["description"]


@respx.mock
@pytest.mark.anyio
async def test_shopify_search_store():
    route = respx.get("https://shop.example/search/suggest.json").mock(
        return_value=httpx.Response(200, json={"resources": {"results": {"products": [
            {"id": 1, "title": "Chore coat", "handle": "c", "available": True, "price": "50", "image": "https://x/1.jpg"}
        ]}}})
    )
    async with httpx.AsyncClient() as client:
        items = await shopify.search_store(client, "shop.example", "chore coat", "USD")
    assert len(items) == 1
    params = route.calls[0].request.url.params
    assert params["q"] == "chore coat" and params["resources[options][unavailable_products]"] == "hide"

    respx.get("https://blocked.example/search/suggest.json").mock(return_value=httpx.Response(404))
    async with httpx.AsyncClient() as client:
        with pytest.raises(SourceError):
            await shopify.search_store(client, "blocked.example", "x", None)


def test_guess_sizes():
    assert shopify.guess_sizes("Chore Coat - L", []) == ["L"]
    assert shopify.guess_sizes("French Work Jacket SZ M", []) == ["M"]
    assert shopify.guess_sizes("Levi's 501 W32 x L30", []) == ["32"]
    assert shopify.guess_sizes("Tee", ["size:XL"]) == ["XL"]
    assert shopify.guess_sizes("Lost in the M25", []) == []


def test_ebay_price_filter():
    from shopr.sources.ebay import price_filter

    assert price_filter(None, None) is None
    assert price_filter(20, None) == "price:[20],priceCurrency:USD"
    assert price_filter(None, 150) == "price:[..150],priceCurrency:USD"
    assert price_filter(20, 150) == "price:[20..150],priceCurrency:USD"


@respx.mock
@pytest.mark.anyio
async def test_ebay_search_sends_price_range_and_reads_sizes():
    s = Settings(ebay_client_id="id", ebay_client_secret="secret")
    respx.post("https://api.ebay.com/identity/v1/oauth2/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok", "expires_in": 7200})
    )
    route = respx.get("https://api.ebay.com/buy/browse/v1/item_summary/search").mock(
        return_value=httpx.Response(200, json={"itemSummaries": [{
            "itemId": "v1|1|0", "title": "Vintage Chore Coat Size L", "price": {"value": "80", "currency": "USD"},
            "image": {"imageUrl": "https://i.ebayimg.com/x/s-l225.jpg"}, "itemWebUrl": "https://www.ebay.com/itm/1",
        }]})
    )
    async with httpx.AsyncClient() as http:
        res = await EbayClient(s, http).search("chore coat", min_price=20, max_price=150)
    assert route.calls[0].request.url.params["filter"] == "price:[20..150],priceCurrency:USD"
    assert res.listings[0]["sizes"] == ["L"]

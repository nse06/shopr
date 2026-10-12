"""Zero-shot tagging vocabulary.

Each moodboard cluster is compared against text prompts in the same embedding
space; the best-matching terms become marketplace search queries. This works
with no API key. When Claude is configured it writes better queries, and these
tags are passed to it as a hint.
"""

GARMENTS = [
    "chore coat", "work jacket", "denim jacket", "trucker jacket", "leather jacket", "suede jacket",
    "bomber jacket", "varsity jacket", "field jacket", "m-65 jacket", "parka", "fleece jacket",
    "anorak", "overcoat", "trench coat", "peacoat", "blazer", "sport coat", "chore shirt",
    "flannel shirt", "western shirt", "oxford shirt", "hawaiian shirt", "camp collar shirt",
    "polo shirt", "rugby shirt", "graphic t-shirt", "band t-shirt", "plain t-shirt", "henley",
    "cardigan", "fisherman sweater", "crewneck sweater", "mohair sweater", "sweatshirt", "hoodie",
    "vest", "down vest", "jeans", "selvedge jeans", "carpenter pants", "work pants", "cargo pants",
    "chinos", "fatigue pants", "trousers", "pleated trousers", "corduroy pants", "shorts",
    "overalls", "coveralls", "boots", "work boots", "loafers", "sneakers", "derby shoes",
    "belt", "baseball cap", "beanie", "bag", "scarf",
]

MATERIALS = [
    "denim", "raw denim", "faded denim", "leather", "suede", "corduroy", "canvas", "duck canvas",
    "wool", "mohair", "cashmere", "flannel", "linen", "nylon", "fleece", "cotton twill",
    "waxed cotton", "knit", "herringbone tweed", "ripstop", "sherpa",
]

STYLES = [
    "vintage workwear", "americana", "japanese workwear", "military surplus", "western",
    "1970s", "1980s", "1990s", "y2k", "grunge", "skate", "preppy", "ivy style", "gorpcore",
    "outdoor", "minimalist", "avant-garde", "archive designer", "streetwear", "punk", "rockabilly",
    "biker", "surf", "tailored", "boxy", "oversized", "slim fit", "distressed", "faded", "patchwork",
    "boro", "sashiko",
]

COLORS = [
    "black", "white", "cream", "ecru", "grey", "charcoal", "navy", "indigo", "blue", "light blue",
    "brown", "tan", "khaki", "olive", "green", "forest green", "burgundy", "red", "rust", "orange",
    "mustard", "yellow", "pink", "purple",
]

PROMPTS = {
    "garment": ("a photo of a {}", GARMENTS),
    "material": ("a photo of clothing made of {}", MATERIALS),
    "style": ("a photo of {} style clothing", STYLES),
    "color": ("a photo of {} clothing", COLORS),
}

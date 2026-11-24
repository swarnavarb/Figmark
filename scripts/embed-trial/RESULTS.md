# Photo search trial: fingerprints vs embeddings

25 listings (25 photos), 95 searches. Models run on CPU, q8.
A fingerprint result only counts when today's search would show it as a match. "Hybrid" = fingerprints decide "same photo", the model ranks the rest.

## Right answer first (Hit@1)

| Kind of search | n | Fingerprints (today) | CLIP | DINOv2 | SigLIP | Hybrid + CLIP | Hybrid + DINOv2 | Hybrid + SigLIP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Same photo, smaller + recompressed | 25 | 96% | 88% | 96% | 96% | 100% | 100% | 100% |
| Same photo, mirrored | 6 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| Same item, different photo (real) | 3 | 0% | 67% | 100% | 100% | 67% | 100% | 100% |
| Same item, re-shot (simulated) | 23 | 43% | 78% | 87% | 91% | 78% | 87% | 91% |
| One item, find its lot | 14 | 36% | 93% | 86% | 100% | 93% | 86% | 100% |
| Several items: boxes Figmark found | 12 | 33% | 92% | 92% | 100% | 92% | 92% | 100% |
| Several items: exact boxes | 12 | 33% | 92% | 100% | 100% | 92% | 100% | 100% |
| **All** | 95 | 56% | 87% | 93% | 97% | 91% | 94% | 98% |

## Right answer in the top 5 (Hit@5)

| Kind of search | n | Fingerprints (today) | CLIP | DINOv2 | SigLIP | Hybrid + CLIP | Hybrid + DINOv2 | Hybrid + SigLIP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Same photo, smaller + recompressed | 25 | 96% | 100% | 100% | 100% | 100% | 100% | 100% |
| Same photo, mirrored | 6 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| Same item, different photo (real) | 3 | 0% | 100% | 100% | 100% | 100% | 100% | 100% |
| Same item, re-shot (simulated) | 23 | 43% | 96% | 96% | 100% | 96% | 96% | 100% |
| One item, find its lot | 14 | 36% | 100% | 100% | 100% | 100% | 100% | 100% |
| Several items: boxes Figmark found | 12 | 33% | 100% | 100% | 100% | 100% | 100% | 100% |
| Several items: exact boxes | 12 | 33% | 100% | 100% | 100% | 100% | 100% | 100% |
| **All** | 95 | 56% | 99% | 99% | 100% | 99% | 99% | 100% |

## Mean reciprocal rank (1 = always first)

| Kind of search | Fingerprints (today) | CLIP | DINOv2 | SigLIP | Hybrid + CLIP | Hybrid + DINOv2 | Hybrid + SigLIP |
|---|---:|---:|---:|---:|---:|---:|---:|
| Same photo, smaller + recompressed | 0.96 | 0.94 | 0.98 | 0.98 | 1.00 | 1.00 | 1.00 |
| Same photo, mirrored | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| Same item, different photo (real) | 0.00 | 0.78 | 1.00 | 1.00 | 0.78 | 1.00 | 1.00 |
| Same item, re-shot (simulated) | 0.43 | 0.84 | 0.92 | 0.95 | 0.84 | 0.92 | 0.95 |
| One item, find its lot | 0.36 | 0.96 | 0.93 | 1.00 | 0.96 | 0.93 | 1.00 |
| Several items: boxes Figmark found | 0.33 | 0.96 | 0.96 | 1.00 | 0.96 | 0.96 | 1.00 |
| Several items: exact boxes | 0.33 | 0.96 | 1.00 | 1.00 | 0.96 | 1.00 | 1.00 |
| **All** | 0.56 | 0.92 | 0.96 | 0.98 | 0.94 | 0.96 | 0.99 |

## Can a model tell "no match" from a match?

Embeddings always return a nearest listing, so live search needs a cut-off. Similarity of the right listing vs the best wrong one (single-item searches):

| Model | right: 10th pct | right: median | best wrong: median | best wrong: 90th pct | a clean cut-off exists? |
|---|---:|---:|---:|---:|---|
| CLIP | 0.773 | 0.910 | 0.834 | 0.912 | no: they overlap |
| DINOv2 | 0.605 | 0.835 | 0.653 | 0.869 | no: they overlap |
| SigLIP | 0.777 | 0.911 | 0.763 | 0.936 | no: they overlap |

## Cost per picture (this machine, CPU)

| Method | ms per picture or item crop |
|---|---:|
| Fingerprints | 57 (whole photo + its items) |
| CLIP | 101 per vector |
| DINOv2 | 164 per vector |
| SigLIP | 337 per vector |

Figmark's own detector put a usable box (IoU ≥ 0.3) over 12 of 12 items in the several-item photos; a missed box is a miss for every method.

## Every search

| Kind | Search | Right answer | Fingerprints (today) | CLIP | DINOv2 | SigLIP | Hybrid + CLIP | Hybrid + DINOv2 | Hybrid + SigLIP | First wrong result (fingerprints / CLIP / DINOv2 / SigLIP) |
|---|---|---|---|---|---|---|---|---|---|---|
| Same photo, smaller + recompressed | t800a~small | t800a | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | t800b~small | t800b | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | clark-kent~small | clark-kent | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | cyclops~small | cyclops | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | inart-t800~small | inart-t800 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | wolverine-loose~small | wolverine-loose | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | boxed-handmade~small | boxed-handmade | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | boxed-john-wick~small | boxed-john-wick | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | boxed-lot / · / · / · |
| Same photo, smaller + recompressed | boxed-winter-soldier~small | boxed-winter-soldier | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | boxed-ghost-rider~small | boxed-ghost-rider | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | boxed-spider-man~small | boxed-spider-man | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | boxed-batman-arkham~small | boxed-batman-arkham | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | boxed-ryu~small | boxed-ryu | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | boxed-lot~small | boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-luke-cage~small | shelf-luke-cage | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-wolverine-top~small | shelf-wolverine-top | ✅ 1 | 2 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / shelf-lot / · / · |
| Same photo, smaller + recompressed | shelf-white-robot~small | shelf-white-robot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-hulk~small | shelf-hulk | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-captain-britain~small | shelf-captain-britain | ✅ 1 | 2 | ✅ 1 | 2 | ✅ 1 | ✅ 1 | ✅ 1 | · / shelf-lot / · / shelf-lot |
| Same photo, smaller + recompressed | shelf-mr-sinister~small | shelf-mr-sinister | ✅ 1 | 2 | 2 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / shelf-lot / shelf-lot / · |
| Same photo, smaller + recompressed | shelf-wolverine-bottom~small | shelf-wolverine-bottom | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-blue-armour~small | shelf-blue-armour | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-carnage~small | shelf-carnage | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-loki~small | shelf-loki | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, smaller + recompressed | shelf-lot~small | shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, mirrored | wolverine-copy-2 | wolverine-loose | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, mirrored | wolverine-copy-4 | wolverine-loose | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, mirrored | t800b~mirror | t800b | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, mirrored | clark-kent~mirror | clark-kent | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, mirrored | boxed-ryu~mirror | boxed-ryu or boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same photo, mirrored | shelf-loki~mirror | shelf-loki or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, different photo (real) | inart-photo-1 | inart-t800 | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, different photo (real) | inart-photo-3 | inart-t800 | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, different photo (real) | inart-photo-4 | inart-t800 | ❌ | 3 | ✅ 1 | ✅ 1 | 3 | ✅ 1 | ✅ 1 | nothing shown / shelf-lot / · / · |
| Same item, re-shot (simulated) | t800a~reshot | t800a | ❌ | 2 | ✅ 1 | ✅ 1 | 2 | ✅ 1 | ✅ 1 | nothing shown / shelf-lot / · / · |
| Same item, re-shot (simulated) | t800b~reshot | t800b | ✅ 1 | 5 | 6 | 2 | 5 | 6 | 2 | · / boxed-lot / boxed-john-wick / boxed-lot |
| Same item, re-shot (simulated) | clark-kent~reshot | clark-kent | ❌ | 20 | 2 | ✅ 1 | 20 | 2 | ✅ 1 | nothing shown / boxed-winter-soldier / boxed-john-wick / · |
| Same item, re-shot (simulated) | cyclops~reshot | cyclops | ❌ | 3 | ✅ 1 | ✅ 1 | 3 | ✅ 1 | ✅ 1 | nothing shown / shelf-lot / · / · |
| Same item, re-shot (simulated) | inart-t800~reshot | inart-t800 | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | wolverine-loose~reshot | wolverine-loose | ❌ | ✅ 1 | 2 | 3 | ✅ 1 | 2 | 3 | nothing shown / · / shelf-wolverine-top / shelf-lot |
| Same item, re-shot (simulated) | boxed-handmade~reshot | boxed-handmade or boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | boxed-john-wick~reshot | boxed-john-wick or boxed-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | boxed-winter-soldier~reshot | boxed-winter-soldier or boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | boxed-ghost-rider~reshot | boxed-ghost-rider or boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | boxed-spider-man~reshot | boxed-spider-man or boxed-lot | ❌ | 3 | ✅ 1 | ✅ 1 | 3 | ✅ 1 | ✅ 1 | nothing shown / shelf-lot / · / · |
| Same item, re-shot (simulated) | boxed-batman-arkham~reshot | boxed-batman-arkham or boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | boxed-ryu~reshot | boxed-ryu or boxed-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | shelf-luke-cage~reshot | shelf-luke-cage or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | shelf-wolverine-top~reshot | shelf-wolverine-top or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | shelf-white-robot~reshot | shelf-white-robot or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | shelf-hulk~reshot | shelf-hulk or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | shelf-captain-britain~reshot | shelf-captain-britain or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | shelf-mr-sinister~reshot | shelf-mr-sinister or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | shelf-wolverine-bottom~reshot | shelf-wolverine-bottom or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | shelf-blue-armour~reshot | shelf-blue-armour or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Same item, re-shot (simulated) | shelf-carnage~reshot | shelf-carnage or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Same item, re-shot (simulated) | shelf-loki~reshot | shelf-loki or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| One item, find its lot | goblin~cut-from-lot | shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| One item, find its lot | goblin~reshot-from-lot | shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| One item, find its lot | abomination~cut-from-lot | shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| One item, find its lot | abomination~reshot-from-lot | shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| One item, find its lot | batman-armour~cut-from-lot | shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| One item, find its lot | batman-armour~reshot-from-lot | shelf-lot | ✅ 1 | ✅ 1 | 2 | ✅ 1 | ✅ 1 | 2 | ✅ 1 | · / · / shelf-blue-armour / · |
| One item, find its lot | thing~cut-from-lot | shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| One item, find its lot | thing~reshot-from-lot | shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| One item, find its lot | werewolf~cut-from-lot | shelf-lot | ❌ | ✅ 1 | 2 | ✅ 1 | ✅ 1 | 2 | ✅ 1 | nothing shown / · / shelf-blue-armour / · |
| One item, find its lot | werewolf~reshot-from-lot | shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| One item, find its lot | captain-marvel~cut-from-lot | shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| One item, find its lot | captain-marvel~reshot-from-lot | shelf-lot | ✅ 1 | 2 | ✅ 1 | ✅ 1 | 2 | ✅ 1 | ✅ 1 | · / shelf-wolverine-bottom / · / · |
| One item, find its lot | john-wick~reshot-from-lot | boxed-lot or boxed-john-wick | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| One item, find its lot | ryu~reshot-from-lot | boxed-lot or boxed-ryu | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-1 → boxed-john-wick | boxed-john-wick or boxed-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: exact boxes | three-items-1 → boxed-john-wick | boxed-john-wick or boxed-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-1 → shelf-hulk | shelf-hulk or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Several items: exact boxes | three-items-1 → shelf-hulk | shelf-hulk or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Several items: boxes Figmark found | three-items-1 → clark-kent | clark-kent | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: exact boxes | three-items-1 → clark-kent | clark-kent | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-2 → t800b | t800b | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Several items: exact boxes | three-items-2 → t800b | t800b | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-2 → cyclops | cyclops | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: exact boxes | three-items-2 → cyclops | cyclops | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-2 → shelf-loki | shelf-loki or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Several items: exact boxes | three-items-2 → shelf-loki | shelf-loki or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Several items: boxes Figmark found | three-items-3 → shelf-captain-britain | shelf-captain-britain or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: exact boxes | three-items-3 → shelf-captain-britain | shelf-captain-britain or shelf-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Several items: boxes Figmark found | three-items-3 → shelf-mr-sinister | shelf-mr-sinister or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: exact boxes | three-items-3 → shelf-mr-sinister | shelf-mr-sinister or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-3 → boxed-ryu | boxed-ryu or boxed-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: exact boxes | three-items-3 → boxed-ryu | boxed-ryu or boxed-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-4 → wolverine-loose | wolverine-loose | ❌ | 2 | 2 | ✅ 1 | 2 | 2 | ✅ 1 | nothing shown / shelf-wolverine-top / shelf-wolverine-top / · |
| Several items: exact boxes | three-items-4 → wolverine-loose | wolverine-loose | ❌ | 2 | ✅ 1 | ✅ 1 | 2 | ✅ 1 | ✅ 1 | nothing shown / shelf-wolverine-top / · / · |
| Several items: boxes Figmark found | three-items-4 → shelf-carnage | shelf-carnage or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: exact boxes | three-items-4 → shelf-carnage | shelf-carnage or shelf-lot | ❌ | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | nothing shown / · / · / · |
| Several items: boxes Figmark found | three-items-4 → boxed-winter-soldier | boxed-winter-soldier or boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |
| Several items: exact boxes | three-items-4 → boxed-winter-soldier | boxed-winter-soldier or boxed-lot | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | · / · / · / · |


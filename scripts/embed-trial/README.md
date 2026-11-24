# Photo search trial: fingerprints vs image embeddings

A side-by-side test of today's picture matching (`api/src/image-hash.ts` and the
scoring in `api/src/photo-search.ts`) against three free, open image-embedding
models, on photos with known answers. It changes nothing in the app: no database,
no photo store, no live search. The full numbers are in [RESULTS.md](RESULTS.md).

## Run it

```sh
npm run build:api                     # from the repo root, once
cd scripts/embed-trial && npm install # the model runtime - kept out of api/ so it never ships
node trial.mjs                        # about a minute on a laptop CPU
```

The models (about 90-200 MB each) are downloaded from huggingface.co on the first
run and cached in `~/.cache/figmark-embed-trial`. Behind an HTTPS proxy, run Node
with `NODE_USE_ENV_PROXY=1`.

Options: `--models clip,dinov2,siglip`, `--dtype q8|fp32`, `--gentle` (milder
simulated re-shoots), `--save DIR` (write every picture compared), `--out FILE`.

### With your own photos

The built-in set is small: 25 listings cut from the 8 real photos in
`test-fixtures/scan/`. The real test is your own catalogue: put photos in one
folder per item. Any item with two or more photos is searched with each photo
against all the others; items with one photo serve as look-alikes to be avoided.

```
my-photos/
  hot-toys-iron-man-mk85/   front.jpg  box.jpg  seller2.jpg
  mafex-batman-hush/        a.jpg  b.jpg
  sh-figuarts-vegeta/       only-one.jpg
```

```sh
node trial.mjs --folders my-photos              # with the built-in set
node trial.mjs --folders my-photos --no-fixtures
```

Photos of the same item taken by different sellers are what matter most.

## What it compares

| Method | What it is |
|---|---|
| **Fingerprints (today)** | The live search with vision off (as on preview): the same exported functions, the same hashes for listings (`printsOfPixels`) and for searches (whole photo + items + tilted, or `searchOneItem` for a picked item). A listing counts only if today's search would show it as a match. |
| **CLIP** (`Xenova/clip-vit-base-patch32`) | General image model that also understands text. |
| **DINOv2** (`Xenova/dinov2-small`) | Self-supervised; built for "is this the same object". |
| **SigLIP** (`Xenova/siglip-base-patch16-224`) | A newer, stronger CLIP. |
| **Hybrid + model** | Fingerprints decide "same photo"; the model ranks everything else. |

Every model gets one vector for the photo and one for each item Figmark's own
detector finds in it, the same boxes the fingerprints use. A listing scores its
best photo-to-photo or photo-to-item match.

## The labelled set

Built in `fixture-set.mjs` from the real photos, with item boxes drawn by hand:

- **Same photo, smaller + recompressed / mirrored**: reposts.
- **Same item, different photo (real)**: four official shots of one INART T-800;
  one is listed, the other three are searched with.
- **Same item, re-shot (simulated)**: every listed item turned, resized, moved
  onto another backdrop, relit, recoloured, an edge cut off. This is not a new
  camera angle, which no simulation can produce; it is the weakest part of the set.
- **One item, find its lot**: a figure cut from the 55-figure shelf lot.
- **Several items in one photo**: three listed items side by side, each searched
  from its own box. One run uses the boxes Figmark finds itself; the other uses
  the exact boxes.

Look-alikes that are *not* the same item are there on purpose: two different
T-800 releases (`t800a`, `t800b`), and two different Wolverines on the shelf.

## Results (q8, CPU)

Right answer ranked first:

| | n | Fingerprints | CLIP | DINOv2 | SigLIP | Hybrid + SigLIP |
|---|---:|---:|---:|---:|---:|---:|
| Same photo (resized, mirrored) | 31 | 97% | 90% | 97% | 97% | 100% |
| Same item, different photo (real) | 3 | 0% | 67% | 100% | 100% | 100% |
| Same item, re-shot (simulated) | 23 | 43% | 78% | 87% | 91% | 91% |
| One item, find its lot | 14 | 36% | 93% | 86% | 100% | 100% |
| Several items (Figmark's boxes) | 12 | 33% | 92% | 92% | 100% | 100% |
| **All** | 95 | 56% | 87% | 93% | 97% | 98% |

"All" also counts the several-item searches run with exact boxes; every row and the
hybrid columns for each model are in RESULTS.md.

These numbers include the two fingerprint fixes below. Before them, fingerprints
scored 35% overall: 0% on finding a lot from one of its items, 9% on re-shot items.
Much of the re-shot gain is the lot: a re-shot shelf or boxed figure now also finds
the lot listing that holds it. A lot listing here keeps the boxes the phone
detector actually recorded for its photo (`test-fixtures/scan/cases.json`, 55 on
the shelf), as a listing keeps `foundBoxes`, not the hand-drawn ones.

With `--gentle` re-shoots (no relighting or recolouring) the gap between fingerprints
and the models narrows a little but stays wide, so it is not just colour shifts.

### What this says

1. **Embeddings find the same item in another photo; fingerprints mostly don't.**
   That is the case photo search exists for (a shopper's own photo, or another
   seller's): DINOv2 and SigLIP put it first 87-100% of the time and CLIP
   67-78%. Fingerprints stay excellent at what they were built for: reposts of
   the same photo.
2. **SigLIP is the most accurate here and DINOv2 a close, cheaper second.**
   SigLIP costs about 120 ms per vector on CPU and DINOv2 about 60 ms. CLIP is
   the fastest but the one most fooled by look-alikes: it ranked the other T-800
   release first, and with a lot's 55 item crops to compare against it sometimes
   ranks a look-alike in the lot above the right single listing.
3. **8-bit models (q8) are as good as full precision (fp32)** here, at a quarter
   of the size.
4. **A similarity cut-off is not enough on its own.** The scores of right answers
   and of the best wrong answers overlap for every model, so live search cannot
   simply say "above 0.8 is a match". It needs a relative rule (well ahead of the
   runner-up), Claude's words as a second signal, or results presented as
   "similar items" rather than "this is it".

### Fixed in the fingerprints because of this trial

- **A smaller copy of a photo stopped being the same photo.** On `t800a.jpg` (a
  window box filling the frame), a copy under about half size had the same shape
  hash to within a bit or two, but its backdrop was read differently, its
  silhouette with it, and the silhouette alone vetoed "same photo". The veto is
  for two products on one white sweep, whose frames match but whose items do
  not; `likenessOf` now lets it stand only when the items cut out of the two
  photos are not alike too. Exact copies at 27-80% size are now recognised 62
  times in 64 across the fixtures (50 before), with no new false matches among
  595 pairs of different photos. Stored fingerprints are unchanged.
- **A lot's photo kept at most twelve items, found by the backdrop alone.** A
  listing's lead photo is now fingerprinted at every place the listing names a
  thing - each piece, each item of a set, each thing the seller's phone found -
  up to 60, then anything else standing off the backdrop. Listings saved before
  this are worked out again the next time a search reads them.

### Caveats

The set is small (25 listings) and mostly figures. Only 3 searches are real
"different photo" cases; the rest are simulated. Treat the numbers as direction,
not accuracy you'd get in production, and rerun with `--folders` on real
catalogue photos before deciding.

# P_T_A – webalkalmazás (iPhone, iPad, Android, számítógép)

Ugyanaz a játék, mint az Android-appban (**Oktató** mód: egy játékos 1–3 gép ellen, tippekkel és értékeléssel; **Játék** mód: 2–4 ember vagy gép), de böngészőben fut, ezért iPhone-on és iPaden is használható.

Ha a főképernyőre teszed:
- saját ikonnal, címsor nélkül, teljes képernyőn indul, mint egy app;
- egyszeri megnyitás után **internet nélkül** is működik (https címről telepítve);
- a játék állása minden lépés után mentődik, és a **Vissza a játékhoz** gombbal folytatható;
- játék közben nem alszik el a kijelző (iOS 16.4-től).

## 1. Feltöltés egy ingyenes webcímre (egyszer kell megcsinálni)

Az internet nélküli működéshez és a főképernyős telepítéshez **https** cím kell. Két egyszerű, ingyenes lehetőség:

### A) GitHub Pages

1. Regisztrálj a <https://github.com> oldalon (ingyenes).
2. Jobb felül **+ → New repository**. Név pl. `pta`, legyen **Public**, majd **Create repository**.
3. Kattints az **uploading an existing file** linkre, és húzd be a `P_T_A_web` mappa **tartalmát** (az `index.html`, `manifest.webmanifest`, `sw.js` fájlokat és a `css`, `js`, `icons` mappákat). Lent **Commit changes**.
4. **Settings → Pages**: a *Branch* legyen `main`, a mappa `/ (root)`, majd **Save**.
5. Pár perc múlva megjelenik a cím, pl. `https://felhasznalonev.github.io/pta/`.

### B) Netlify

1. Regisztrálj a <https://app.netlify.com> oldalon (ingyenes).
2. **Add new site → Deploy manually**, és húzd rá a teljes `P_T_A_web` mappát.
3. Kapsz egy címet, pl. `https://valami-nev.netlify.app` (a *Site configuration* részben átnevezheted).

## 2. Telepítés iPhone-ra / iPadre

1. Nyisd meg a címet a **Safariban** (nem Chrome-ban: iPhone-on a főképernyőre tenni Safariból a legbiztosabb).
2. Koppints a **Megosztás** gombra (négyzet felfelé mutató nyíllal).
3. Válaszd a **Hozzáadás a főképernyőhöz** pontot, majd **Hozzáadás**.
4. Ezután a P_T_A ikonról indítsd. Fordítsd a telefont **fekvő** helyzetbe – így a legkényelmesebb (álló helyzetben is használható, akkor a panelek a tábla alatt vannak).

Androidon Chrome-ban: menü (⋮) → **Hozzáadás a kezdőképernyőhöz** / **Alkalmazás telepítése**.

## Kipróbálás a saját gépről (feltöltés nélkül)

```
python szerver.py
```

A program kiírja a címet (pl. `http://192.168.1.20:8000`). Ezt a telefon böngészőjében megnyitva – **ugyanazon a WiFi-n** – a játék fut. Így az internet nélküli mód nem működik (ahhoz https kell), és a játék csak addig érhető el, amíg a gépen fut a `szerver.py`. Leállítás: Ctrl+C.

## Módosítás után

Ha a játék fájljain változtatsz, és újra feltöltöd őket, a `sw.js` elején növeld a verziót (pl. `pta-v1` → `pta-v2`). A telepített telefonok a következő indításkor (amikor van net) frissülnek.

## Fájlok

| Fájl | Tartalom |
|---|---|
| `index.html` | a játék felülete, telepíthetőségi beállítások |
| `manifest.webmanifest` | név, ikon, teljes képernyő (a főképernyős telepítéshez) |
| `sw.js` | internet nélküli működés (offline tár) |
| `css/style.css` | megjelenés (telefon, tablet, fekvő és álló helyzet) |
| `js/app.js` | menü, tábla, panelek, érintés, mentés |
| `js/engine.js` | szabályok és gépi játékos |
| `js/coach.js` | oktató: tipp, értékelés, magyarázat |
| `js/board.js`, `js/board_data.js` | a tábla és a cserélhető pályaelemek |
| `icons/` | ikonok (iPhone, Android) |
| `szerver.py` | helyi kiszolgáló kipróbáláshoz (Python 3.8+) |

A `css` és `js` mappa ugyanaz, mint az Android-projektben (`app/src/main/assets/www`), így bármelyikben javított fájl a másikba átmásolható.

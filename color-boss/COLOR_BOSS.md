# Il Boss dei Colori

**Riferimento operativo per scegliere, costruire e verificare colori in siti e web app.**
Per Federico, Claude Code e Codex. Versione 1.0, ottobre 2026.

Il pacchetto `color-boss/` contiene:

| File | A cosa serve |
|---|---|
| `COLOR_BOSS.md` | Questa guida. È la versione che leggono gli agenti. |
| `COLOR_BOSS.pdf` | La stessa guida impaginata, con i campioni di colore. |
| `tokens.css` | Il token set light + dark pronto da importare, già verificato. |
| `colorboss.py` | Il tool per convertire colori, misurare il contrasto, generare scale, controllare `tokens.css` e simulare il daltonismo. Usa solo Python 3, senza dipendenze. |

Ogni numero in questa guida è calcolato con `colorboss.py`, nessuno è stimato a occhio.

---

## 0. Uso rapido

```bash
# contrasto tra due colori (WCAG 2 + APCA, con verdetto per livello)
python3 color-boss/colorboss.py contrast "#6B7280" "#FFFFFF"

# conversione hex <-> oklch e controllo gamut
python3 color-boss/colorboss.py convert "oklch(62% 0.19 258)"

# genera una scala 50..950 da un colore di brand (in gamut, pronta da incollare)
python3 color-boss/colorboss.py scale "#E4572E" --name brand
python3 color-boss/colorboss.py scale "#E4572E" --name neutral --neutral

# verifica TUTTI i contratti di contrasto, in light e in dark (exit 1 se qualcosa fallisce)
python3 color-boss/colorboss.py check color-boss/tokens.css

# i colori restano distinguibili per chi è daltonico?
python3 color-boss/colorboss.py cvd "#15803D" "#B45309" "#DC2626"
```

**Per cambiare il brand di un progetto:**
1. Rigenera la scala `brand` e incollala al posto di quella in `tokens.css`.
2. Se vuoi, rigenera anche `neutral` con la stessa tinta.
3. Lancia `check` e sistema la mappatura dei token semantici finché non dà 0 fail.

### Blocco da mettere in `CLAUDE.md` / `AGENTS.md` di ogni repo

```markdown
## Colori
- Prima di toccare colori, temi o UI leggi `color-boss/COLOR_BOSS.md` (sezioni 1, 9, 10).
- Nei componenti usa SOLO i token semantici di `color-boss/tokens.css` (`--text`, `--bg-surface`,
  `--accent`, ...). Niente hex, rgb() o colori Tailwind di default scritti nei componenti.
- Se serve un colore nuovo: aggiungi un token semantico, mappalo su una primitiva e aggiungi la
  riga `@check` corrispondente.
- Dopo ogni modifica ai colori esegui `python3 color-boss/colorboss.py check color-boss/tokens.css`.
  Non consegnare se l'exit code è diverso da 0. Non dichiarare mai un valore di contrasto senza averlo calcolato.
```

---

## Legenda delle evidenze

| Tag | Significato |
|---|---|
| **[Standard]** | È scritto in una norma o specifica (W3C, CSS). È vincolante o di riferimento. |
| **[Ricerca forte]** | Più studi peer-reviewed concordi o un modello ben validato. |
| **[Ricerca limitata]** | Pochi studi, effetti piccoli, contesto ristretto, oppure repliche contrastanti. |
| **[Pratica]** | Convenzione condivisa dei design system maturi. Funziona, ma non è una legge scientifica. |
| **[Opinione]** | Gusto o esperienza. Utile, ma va trattata come tale. |

---

## 1. Le regole (riassunto)

1. **Costruisci le scale in OKLCH, non in HSL.** In HSL la "L" non corrisponde alla luminosità percepita. [Ricerca forte]
2. **WCAG 2.2 AA è il requisito minimo legale.** Testo ≥ 4.5:1, testo grande ≥ 3:1, componenti non testuali ≥ 3:1. [Standard]
3. **Usa anche APCA come secondo controllo, soprattutto in dark mode.** WCAG 2 sovrastima il contrasto dei colori sui fondi scuri: il blu `#3B82F6` su nero passa con 5.7:1, ma per APCA vale solo Lc 38. APCA però **non** fa parte di WCAG 3: è uno strumento, non una norma. [Standard + Ricerca limitata]
4. **Il colore non deve mai essere l'unico veicolo di significato.** Stati, errori e grafici hanno sempre anche un'icona, un testo o una forma. [Standard, WCAG 1.4.1]
5. **I colori di stato devono differire anche in luminosità, non solo in tinta.** Così restano distinguibili anche con il daltonismo. Si verifica con `colorboss.py cvd`. [Ricerca forte]
6. **Usa tre livelli di token:** primitive (`--brand-600`) → semantici (`--accent`) → eventuali token di componente. I componenti vedono solo i semantici. [Pratica]
7. **Neutri leggermente tinti** (chroma OKLCH 0.005–0.012 con la tinta del brand). [Pratica/Opinione]
8. **Il dark mode non è un'inversione.** Sfondo grigio molto scuro (L 0.17–0.22, non `#000`). L'elevazione si ottiene con superfici più chiare. Gli accenti diventano più chiari e meno saturi. [Pratica]
9. **Testo secondario sì, testo illeggibile no.** Il grigio "muted" deve comunque passare 4.5:1. `#9CA3AF` su bianco fa 2.5:1 ed è un errore comune. [Standard]
10. **Tutti i valori devono restare nel gamut sRGB.** I browser fanno ancora *clipping* dei colori fuori gamut, che così si deformano. Lo script fa il gamut mapping per te. [Standard + stato browser]
11. **Pochi colori:** un brand, una scala di neutri, 3–4 stati. Il resto è luminosità. [Pratica]
12. **Mai dichiarare un contrasto senza calcolarlo.** Gli LLM inventano spesso i numeri dei contrasti (anche i report di ricerca). [Opinione, verificata]

---

## 2. Spazi colore: cosa serve sapere

### 2.1 Perché HSL non basta [Ricerca forte]

`hsl(60 100% 50%)` (giallo) e `hsl(240 100% 50%)` (blu) hanno la stessa "L = 50%", ma il giallo appare molto più chiaro. In OKLCH il giallo ha L ≈ 0.97 e il blu L ≈ 0.45. Se costruisci scale o stati hover "togliendo il 10% di L" in HSL, ottieni salti diversi per ogni tinta.

### 2.2 OKLab / OKLCH [Ricerca forte, con limiti]

- **Origine.** Lo spazio è stato pubblicato da Björn Ottosson nel 2020. È ottimizzato su dati percettivi (CAM16) ed è progettato per essere semplice e numericamente stabile.
- **Coordinate.** **L** è la luminosità da 0 a 1. **C** è la chroma (la saturazione), da 0 a circa 0.37. **H** è la tinta in gradi.
- **Supporto.** È nativo in CSS (`oklch()`) e Tailwind v4 lo usa per la sua palette.
- **Limiti onesti:**
  - È *più* uniforme di HSL e CIELAB, non perfettamente uniforme.
  - Non modella l'effetto Helmholtz–Kohlrausch: i colori molto saturi sembrano più chiari di quanto indichi la L.
  - Stessa L non vuol dire esattamente stessa luminosità percepita su tutte le tinte, e soprattutto non vuol dire stesso contrasto WCAG.
  - Il gamut sRGB ha forme diverse per ogni tinta. Il blu ha poca chroma disponibile ad alta luminosità (diventa pastello), il giallo ne ha poca a bassa luminosità (diventa marrone). Per questo le scale buone **riducono la chroma ai due estremi**.

### 2.3 HCT (Material 3) [Ricerca forte + Standard di fatto]

- **Composizione.** Hue e chroma vengono da CAM16, il **Tone** da CIELAB L\*.
- **Contrasto garantito.** Il Tone è legato alla luminanza relativa, quindi una differenza di 40 di tone garantisce ≥ 3:1 e una di 50 garantisce ≥ 4.5:1 WCAG, per qualsiasi tinta.
- **Licenza.** È open source (material-color-utilities, Apache 2.0), non proprietario.
- **Quando usarlo.** È ottimo se vuoi temi dinamici generati da un seed.

### 2.4 CSS moderno [Standard]

| Funzione | Uso |
|---|---|
| `oklch(L C H)` | Definire le primitive |
| `light-dark(a, b)` | Un solo blocco di token per light e dark. Richiede `color-scheme` |
| `color-mix(in oklch, a 80%, b)` | Mescolare, ad esempio per overlay e tinte |
| `oklch(from var(--x) calc(l - 0.08) c h)` | Relative color syntax: derivare gli stati da un token |
| `color(display-p3 …)` | Colori wide-gamut, opzionali, dietro `@media (color-gamut: p3)` |

**Gamut mapping.** CSS Color 4 descrive un algoritmo che riduce la chroma preservando L e H. Però, secondo le discussioni del CSSWG di giugno 2025, i browser **fanno ancora clipping** dei colori fuori gamut. Conseguenza pratica: scrivi solo valori già dentro sRGB. `colorboss.py scale` lo fa da solo, e `check` segnala i valori fuori gamut.

---

## 3. Contrasto e leggibilità

### 3.1 WCAG 2.2: la norma [Standard]

**Formula.** Il rapporto è `(L1 + 0.05) / (L2 + 0.05)`, dove L1 e L2 sono le luminanze relative sRGB dei due colori, con L1 la maggiore.

| Criterio | Cosa | AA | AAA |
|---|---|---|---|
| 1.4.3 / 1.4.6 | Testo normale | 4.5:1 | 7:1 |
| 1.4.3 / 1.4.6 | Testo grande (≥ 24px, o ≥ 18.66px bold) | 3:1 | 4.5:1 |
| 1.4.11 | Componenti UI e grafica necessaria (bordi degli input, focus, icone informative) | 3:1 | — |
| 1.4.1 | Uso del colore: mai come unico mezzo per veicolare informazione | — | — |

Sono esenti i testi dei controlli disabilitati, i loghi e la decorazione pura.

**Difetti noti** [Ricerca limitata, ma molto documentati in pratica]:
- **Non distingue la polarità.** Testo chiaro su scuro e testo scuro su chiaro valgono uguale.
- **Sovrastima il contrasto nelle zone scure.** Esempi misurati: `#3B82F6` su `#000` fa 5.7:1 (passa AA) ma vale Lc 38 per APCA. `#A78BFA` su `#000` fa 7.7:1 (passa AAA) ma vale Lc 49.
- **Ignora peso e dimensione del font**, a parte la soglia binaria "grande".

### 3.2 APCA: lo strumento complementare [Ricerca limitata]

**Come funziona.** APCA (Advanced Perceptual Contrast Algorithm, di Andrew Somers) restituisce un valore **Lc** da circa −108 a +106. Il valore è positivo per testo scuro su fondo chiaro e negativo per testo chiaro su fondo scuro: conta il valore assoluto.

**Stato reale (2026).** APCA è stato tolto dalle bozze WCAG 3 nel luglio 2023. Il metodo di contrasto di WCAG 3 è "yet to be determined" e WCAG 3 non è atteso prima di molti anni. Quindi:
- **WCAG 2 resta il requisito.**
- **APCA va usato come controllo aggiuntivo.** È utile soprattutto per dark mode, testo sottile e testo colorato.
- **Non va mai citato come standard.**

**Soglie APCA** (livello "Bronze", da *APCA in a Nutshell*; dimensioni in px CSS):

| Lc | Uso |
|---|---|
| **90** | Livello preferito per il testo corrente in colonne. Minimo 18px/300 o 14px/400 |
| **75** | Minimo per il testo corrente. 24px/300, 18px/400, 16px/500, 14px/700 |
| **60** | Testo non corrente: label, testo secondario. 24px/400, 18px/600, 16px/700 |
| **45** | Titoli grandi (36px/400 o 24px/700) e icone sottili |
| **30** | Minimo assoluto per placeholder e disabilitati, e per icone grandi e piene |
| **15** | Sotto questa soglia l'elemento è invisibile. È il minimo per divisori e bordi decorativi |

**Nota sui fondi molto scuri.** APCA riduce volutamente quasi a 0 il contrasto tra due colori entrambi molto scuri. Un bordo `#3E4145` su `#191C20` vale Lc 0 ma WCAG 1.67:1, ed è visibile. Per i divisori decorativi in dark mode `colorboss.py` accetta anche un rapporto WCAG ≥ 1.5.

### 3.3 Livelli usati da `colorboss.py check`

| Livello | WCAG min | \|Lc\| min | Per |
|---|---|---|---|
| `body` | 4.5 | 75 | Paragrafi, testo principale |
| `text` | 4.5 | 60 | Testo secondario, label, link, testo sopra i bottoni |
| `large` | 3.0 | 45 | Titoli ≥ 24px |
| `ui` | 3.0 | 30 | Bordi degli input, focus ring, icone informative |
| `disabled` | — | 30 | Placeholder, disabilitati |
| `decor` | — | 15 (o WCAG ≥ 1.5) | Divisori |

Il mancato rispetto della soglia WCAG è sempre un **fail**. Il mancato rispetto della soglia APCA è un **warning**, oppure un fail con l'opzione `--strict`.

### 3.4 Light vs dark (polarità) [Ricerca forte sul fenomeno, limitata sulle conclusioni]

- **Il fenomeno.** Studi di laboratorio trovano un vantaggio della **polarità positiva** (testo scuro su chiaro) in compiti di correzione di bozze e di lettura (Buchner & Baumgartner 2007; Piepenbrock et al. 2013, 2014). La spiegazione proposta è che il fondo luminoso restringe la pupilla e quindi rende l'immagine più nitida. L'effetto è più marcato con il testo piccolo.
- **Cosa *non* dimostrano questi studi.** Non dicono che il dark mode sia "dannoso". Gli effetti dipendono da luce ambiente, dimensione del testo e compito, e molti utenti preferiscono il dark di sera.
- **Conclusione pratica.** Offri entrambi i temi e segui `prefers-color-scheme`. Per prodotti di lettura lunga (documentazione, blog) il light come default è una scelta difendibile.

### 3.5 Nero puro, bianco puro, halation

- **`#FFFFFF` come sfondo va bene.** Lo usano GitHub, Apple, Google. Non ci sono prove solide che peggiori la lettura. [Pratica]
- **Testo quasi nero invece di `#000`.** È una scelta estetica che ammorbidisce senza costi: con `#1F1F1F` su `#FAFAFA` il contrasto resta 15.8:1. [Opinione]
- **Sfondo dark `#000` con testo `#FFF`.** È sconsigliato per tre motivi:
  - Il contrasto estremo accentua l'*halation*: le lettere chiare sembrano "sbavare", soprattutto con astigmatismo. Il meccanismo ottico è plausibile ma gli studi sono pochi. [Ricerca limitata]
  - Sugli OLED il nero puro produce *smearing* durante lo scroll. [Pratica]
  - Non lascia spazio per l'elevazione delle superfici. [Pratica]
- **Range consigliati per il dark.** Sfondo con L 0.17–0.22. Testo principale con L ≈ 0.96–0.985. Testo secondario con L ≈ 0.80–0.87, perché in dark serve più luminosità per mantenere Lc 60.

---

## 4. Daltonismo (CVD)

### 4.1 Prevalenza [Ricerca forte]

Nelle popolazioni di origine nord-europea (Birch 2012):
- **Difetti rosso-verde:** circa l'**8% degli uomini** e lo **0.4% delle donne**.
  - Deutan (verde): circa 6% degli uomini, in maggioranza deuteranomalia lieve.
  - Protan (rosso): circa 2% degli uomini. I rossi appaiono anche più scuri.
- **Tritan (blu-giallo):** molto raro, ordine di 1 su 10.000 o meno. Colpisce uomini e donne in modo simile.

### 4.2 Regole

1. **Mai il solo colore** [Standard]. Errore = rosso + icona + messaggio. Linee del grafico = colore + etichetta diretta o tratteggio.
2. **Separa in luminosità** [Ricerca forte]. Chi ha difetti rosso-verde distingue bene il chiaro dallo scuro. Rosso e verde con la stessa L sono la coppia peggiore in assoluto.
3. **Verifica con una simulazione** [Ricerca forte]. Il modello di riferimento è Machado, Oliveira & Fernandes (2009). Lo usano Chrome DevTools (Rendering → Emulate vision deficiencies) e `colorboss.py cvd`.

### 4.3 Verifiche misurate

Lo script riporta la **coppia peggiore**, cioè la distanza ΔE_OK×100 tra i due colori più simili dopo la simulazione. Sotto 5 c'è rischio di confusione, sotto 2 i colori sono quasi identici.

| Set | Normale | Protan | Deutan | Tritan |
|---|---|---|---|---|
| **Okabe-Ito** (7 colori) | 15.6 | **9.6** | **7.6** | **8.5** |
| **Paul Tol "bright"** (7) | 10.6 | 7.2 | 7.9 | 3.3 |
| Tableau 10 (10) | 8.4 | 0.9 | 0.7 | 5.2 |
| D3 category10 (vecchio default) | 11.3 | 0.7 | 2.3 | 4.2 |
| Stati `tokens.css`, light | 16.1 | 5.7 | 7.4 | 18.4 |
| Stati `tokens.css`, dark | 7.6 | 6.9 | 5.4 | 2.1 |

**Letture.**
- Per i grafici categorici usa **Okabe-Ito** o **Tol**.
- Tableau 10 e D3 category10 sono belli, ma contengono coppie rosso/verde quasi identiche per chi è daltonico: in Tableau `#E15759`/`#59A14F` (ΔE 0.7 deutan), in D3 `#ff7f0e`/`#2ca02c` (0.7 protan).

### 4.4 Palette per dati [Ricerca forte]

- **Sequenziale** (da poco a molto). Usa una rampa monotona in luminosità: **viridis**, **cividis** (ottimizzata per CVD, Nuñez et al. 2018), le sequenziali di ColorBrewer.
- **Divergente** (sopra o sotto un centro). Il centro è chiaro e gli estremi scuri e saturi: ColorBrewer RdBu/PuOr. Evita RdYlGn per il problema rosso-verde.
- **Categorica.** Al massimo circa 7–8 categorie distinguibili, e con luminosità simile se nessuna categoria deve "pesare" di più. Oltre quel numero, raggruppa o etichetta direttamente.
- **Mai rainbow/jet per dati continui.** Crea bande false e non è ordinabile per luminosità.

```text
Okabe-Ito:  #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 (#000000)
Tol bright: #4477AA #EE6677 #228833 #CCBB44 #66CCEE #AA3377 #BBBBBB
```

---

## 5. Le palette più apprezzate, analizzate

### 5.1 Design system

| Sistema | Spazio / metodo | Step | Ruoli e accessibilità | Dark mode | Da copiare |
|---|---|---|---|---|---|
| **Tailwind v4** | OKLCH, curato a mano | 11 (50–950) | Nessun ruolo semantico integrato | Fai da te | Nomi degli step, primitive vivaci |
| **Radix Colors** | Scale progettate su ruoli, controllo APCA | 12 (1–12) | Ogni step ha un ruolo: 1–2 sfondi, 3–5 sfondi dei componenti, 6–8 bordi, 9–10 solidi, 11–12 testo | Scale dark dedicate, varianti alpha | **Il modello a ruoli** |
| **Material 3** | HCT, palette tonali 0–100 | 13 tone standard | Ruoli `primary`/`on-primary` ecc.; contrasto garantito dalle differenze di tone | Tone diversi per i ruoli (es. primary 40 → 80) | Coppie `x` / `on-x` |
| **IBM Carbon** | Scale a 10 gradi (10–100) | 10 | Token per tema (White, g10, g90, g100) | 4 temi ufficiali | Temi multipli di grigio |
| **GitHub Primer** | Token funzionali | — | Temi high-contrast e per daltonismo (protan/deutan, tritan) | Più temi dark | **Temi CVD dedicati** |
| **Apple HIG** | Colori di sistema dinamici | — | Colori semantici (`label`, `secondaryLabel`…) | Varianti automatiche più "Increase Contrast" | Gerarchia del testo a 4 livelli |
| **USWDS** | Gradi 0–100 | 10+ | "Magic number": una differenza di 50 gradi dà AA, 70 dà AAA | — | Regola numerica semplice |
| **Open Color** | Curato a mano | 10 (0–9) | — | — | Palette neutra, licenza MIT |

**Sintesi.** I sistemi migliori hanno in comune tre cose: **ruoli semantici**, **coppie sfondo/testo garantite** e **scale dark dedicate**, non invertite. Il token set di questa guida prende i ruoli da Radix, le coppie `x`/`on-x` da Material e le primitive OKLCH da Tailwind.

### 5.2 Temi da editor: perché piacciono (misurato)

I valori sono quelli dei port più diffusi e possono variare tra un port e l'altro.

| Tema | Testo su sfondo | WCAG | \|Lc\| | Commenti | WCAG | \|Lc\| |
|---|---|---|---|---|---|---|
| Solarized Dark | `#839496` su `#002B36` | 4.7 | 40 | `#586E75` | 2.8 | 21 |
| Solarized Light | `#657B83` su `#FDF6E3` | 4.1 | 66 | `#93A1A1` | 2.5 | 47 |
| Nord | `#D8DEE9` su `#2E3440` | 9.2 | 80 | `#616E88` | 2.4 | 20 |
| Dracula | `#F8F8F2` su `#282A36` | 13.4 | 99 | `#6272A4` | 3.0 | 25 |
| Gruvbox Dark | `#EBDBB2` su `#282828` | 10.7 | 82 | `#928374` | 4.0 | 34 |
| Catppuccin Mocha | `#CDD6F4` su `#1E1E2E` | 11.3 | 80 | `#9399B2` | 5.8 | 46 |
| Catppuccin Latte | `#4C4F69` su `#EFF1F5` | 7.1 | 79 | `#7C7F93` | 3.5 | 59 |
| Tokyo Night | `#A9B1D6` su `#1A1B26` | 8.1 | 59 | `#565F89` | 2.8 | 19 |
| One Dark | `#ABB2BF` su `#282C34` | 6.6 | 56 | `#5C6370` | 2.3 | 17 |
| Rosé Pine | `#E0DEF4` su `#191724` | 13.4 | 87 | `#6E6A86` | 3.4 | 25 |
| GitHub Dark | `#E6EDF3` su `#0D1117` | 16.0 | 95 | `#8B949E` | 6.2 | 44 |
| GitHub Light | `#1F2328` su `#FFFFFF` | 15.8 | 103 | `#59636E` | 6.1 | 81 |

**Cosa ci dicono i numeri** [Opinione, basata sui numeri sopra]:
- I temi più amati **non** hanno un contrasto generale basso. Il testo principale sta quasi sempre fra 7:1 e 13:1. Fanno eccezione Solarized, One Dark e Tokyo Night, che restano più bassi.
- Il loro segreto è la **gerarchia**: il testo principale è forte e il secondario (i commenti) è molto più debole.
- Gli **sfondi non sono mai neri**: sono grigi o blu-grigi tinti.
- Gli **accenti sono numerosi ma tenuti a luminosità simile**.
- Il bianco puro sul nero puro non compare quasi mai.

---

## 6. Ricerca sulle preferenze estetiche

- **Preferenza per i singoli colori: Ecological Valence Theory** (Palmer & Schloss 2010) [Ricerca forte].
  - **Cosa dice.** Ci piacciono i colori associati a cose che ci piacciono: blu = cielo e acqua pulita. Ci piacciono meno quelli associati a cose sgradevoli: verde-giallo scuro = muffa, marciume.
  - **Il blu.** È il colore più preferito in media in molte culture (anche Hurlbert & Ling 2007).
  - **Rischio.** Le scale tendenti al giallo-verde scuro e i marroni "fangosi" piacciono meno.
- **Combinazioni di colori** (Schloss & Palmer 2011) [Ricerca forte]:
  - Le coppie **della stessa tinta o di tinte vicine** sono giudicate più armoniose.
  - La preferenza aumenta quando c'è **contrasto di luminosità** tra figura e sfondo.
  - In pratica significa poche tinte e molta variazione di luminosità.
- **Regole classiche dell'armonia** (complementari, triadi, 60-30-10) [Pratica/Opinione]. Sono utili come punto di partenza, ma non sono leggi.
  - Il 60-30-10 funziona in UI perché impone **un solo accento raro**, non per una ragione scientifica.
- **Effetto estetica-usabilità** [Ricerca limitata]:
  - Kurosu & Kashimura (1995) e Tractinsky et al. (2000) trovano che le interfacce più belle sono *percepite* come più usabili.
  - Tuch et al. (2012) non replicano l'effetto in quella direzione e trovano invece che l'usabilità influenza la bellezza percepita.
  - Conclusione: estetica e usabilità si influenzano a vicenda, ma l'estetica non "compra" tolleranza agli errori.
- **Significati culturali** (Madden, Hewett & Roth 2000, 8 paesi) [Ricerca limitata]:
  - Il blu è associato a qualità e affidabilità in modo abbastanza trasversale.
  - Altri colori cambiano significato: il rosso è pericolo/errore in Occidente e fortuna in Cina; in Cina i mercati finanziari usano il rosso per i rialzi.
- **"Psicologia del colore" del marketing** ("il rosso aumenta le conversioni", "l'arancione fa venire fame") [Ricerca limitata o assente].
  - Gli effetti del rosso studiati in laboratorio (Elliot & Maier) si sono molto ridimensionati nelle meta-analisi successive (es. Lehmann et al. 2018).
  - Nei test A/B vince quasi sempre il bottone che **risalta** rispetto al resto della pagina, non una tinta in sé.

---

## 7. Costruire il sistema: procedura

### 7.1 Scala accento (brand) [Pratica, valori di questa guida]

`colorboss.py scale` usa questi target in OKLCH:

| Step | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L | .975 | .945 | .895 | .825 | .730 | .630 | .545 | .475 | .400 | .330 | .260 |
| C (× chroma del brand) | .10 | .22 | .42 | .68 | .90 | 1 | 1 | .92 | .80 | .66 | .52 |

- **Gamut.** La chroma viene poi ridotta al massimo possibile in sRGB per quella L e tinta.
- **Brand esatto.** Il colore del brand viene fissato sullo step con la L più vicina, così resta identico.
- **Regola utile.** Con queste L, il **600** porta testo bianco con circa 5:1 per quasi ogni tinta ed è il bottone primario in light. Il **300** porta testo quasi nero ed è il bottone primario in dark.
  - Su 8 tinte di prova (rosso, arancio, giallo, verde, teal, azzurro, viola, rosa) il 600 sta fra 4.6:1 e 5.7:1 con testo bianco.
  - Verdi e teal sono i più vicini al limite. Il valore esatto è nel commento "bianco x:1" generato dallo script.

### 7.2 Scala neutri

| Step | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L | .985 | .965 | .925 | .870 | .715 | .555 | .460 | .375 | .285 | .225 | .180 |

- **Chroma.** Circa 0.008 con la tinta del brand (0.005 nei due step più chiari).
- **Perché questa curva.** La curva è più fitta agli estremi perché gli sfondi e le superfici, in light e in dark, vivono lì.
- **Step di riferimento.** Il **500** passa 4.5:1 su bianco (4.7:1): è il primo grigio che si può usare come testo su bianco.

### 7.3 Mappatura semantica (light → dark)

| Token | Light | Dark | Ruolo |
|---|---|---|---|
| `--bg-page` | neutral-50 | neutral-950 | Sfondo pagina |
| `--bg-surface` | white | neutral-900 | Card, pannelli |
| `--bg-raised` | white (+ ombra) | neutral-800 | Modali, menu |
| `--bg-subtle` / `--bg-hover` | neutral-100 | neutral-900 / 800 | Zone tenui, hover |
| `--border` | neutral-300 | neutral-700 | Divisori (decor) |
| `--border-strong` | neutral-500 | neutral-400 | Input, controlli (≥ 3:1) |
| `--text` | neutral-900 | neutral-50 | Testo principale |
| `--text-muted` | neutral-600 | neutral-300 | Testo secondario |
| `--text-subtle` | neutral-400 | neutral-400 | Placeholder, disabilitati |
| `--accent` / `--on-accent` | brand-600 / white | brand-300 / neutral-950 | Bottone primario |
| `--accent-hover` | brand-700 | brand-200 | Hover del primario |
| `--accent-text` | brand-700 | brand-300 | Link |
| `--accent-soft` / `--on-accent-soft` | brand-100 / brand-800 | brand-950 / brand-200 | Badge, selezione |
| `--focus-ring` | brand-500 | brand-400 | Anello di focus |
| `--success` | green-700 | green-200 | Testo e icona di successo |
| `--warning` | amber-800 | amber-300 | Testo e icona di avviso |
| `--danger` / `--danger-solid` | red-600 | red-300 | Errore, bottone distruttivo |

**Perché le scelte dark sono quelle** (verificato con `check`):
- **Testo secondario.** In dark `neutral-400` dà WCAG 6.8:1 ma solo Lc 51, quindi serve `neutral-300` (Lc 79).
- **Bottone primario.** Il primario dark su `brand-400` con testo scuro dà Lc 56, quindi si sale a `brand-300`. È lo stesso approccio di Material 3 (primary = tone 80 in dark).
- **Colori di stato.** In dark gli stati iniziali con la stessa L davano ΔE 0.7 sotto deuteranopia. Con luminosità diverse (green-200, amber-300, red-300) il valore sale a 5.4.

### 7.4 Stati di interazione [Pratica]

| Stato | Regola |
|---|---|
| **Hover** | Uno step "verso il testo": più scuro in light (600 → 700), più chiaro in dark (300 → 200). Per le superfici, usa `--bg-hover` |
| **Active** | Due step, oppure `oklch(from var(--accent) calc(l - 0.08) c h)` |
| **Focus** | `outline: 2px solid var(--focus-ring); outline-offset: 2px;`, sempre visibile con `:focus-visible` |
| **Selected** | `--accent-soft` con testo `--on-accent-soft`, più un indicatore non cromatico (check, bordo, peso del font) |
| **Disabled** | `--bg-subtle` con `--text-subtle`. **Non** usare `opacity` sul testo: rende il contrasto imprevedibile |

### 7.5 Dark mode: checklist specifica [Pratica]

- Sfondo con L 0.17–0.22 e una leggera tinta. Mai `#000` puro per la pagina principale.
- L'elevazione si ottiene con la luminosità: ogni livello è circa +0.05 di L (950 → 900 → 800).
- Le ombre sono quasi invisibili: usa superfici più chiare ed eventualmente un bordo sottile.
- Gli accenti si spostano verso step più chiari e meno saturi (600 → 300).
- Ricontrolla tutto con APCA: in dark WCAG è troppo permissivo.
- Immagini e illustrazioni: valuta un `filter: brightness(.9)` o versioni dedicate.

### 7.6 Quanti colori

- **Un brand.** Opzionalmente un secondo accento, ma raro.
- **Una scala di neutri.** Fa il 90% del lavoro.
- **3–4 colori di stato**, usati solo per comunicare uno stato.
- **Per i grafici**, una palette dati separata (Okabe-Ito o Tol), non la palette UI.

---

## 8. Perché le palette generate dalle IA sembrano "strane" [Opinione + misure]

1. **Default ricorrenti.** Indigo/viola `#6366F1`, gradienti viola → blu, glow neon su nero. Vengono da una stagione di template ripetuti all'infinito nei dati di training. Bianco su `#6366F1` fa **4.47:1** e non passa AA, per un soffio.
2. **Grigi muted illeggibili.** `#9CA3AF` su bianco fa **2.5:1**. Il 400 dei grigi Tailwind non è un colore per il testo.
3. **Grigi mischiati.** `slate`, `zinc`, `gray` e `neutral` nello stesso progetto, con tinte leggermente diverse che si notano senza sapere perché.
4. **Troppi accenti saturi insieme.** Ogni card ha un colore diverso, quindi nessuna gerarchia. È l'opposto di quello che dice la ricerca sulle combinazioni (poche tinte, molta luminosità).
5. **Dark mode = inversione.** Sfondo `#000`, testo `#FFF`, stesso blu del light. Il blu `#3B82F6` su nero passa WCAG (5.7:1) ma vale Lc 38: sembra "spento" e affatica.
6. **Hex scritti a mano nei componenti** invece di token. Ogni modifica crea nuove incoerenze.
7. **Contrasti dichiarati ma mai calcolati.** È il problema più grave, perché sembra tutto verificato.

**Regole anti-"palette da IA":**
- Niente gradienti come stile di default.
- Un solo accento.
- Neutri da un'unica scala.
- In dark mode, accento chiaro e poco saturo.
- Tutto passa da `tokens.css` + `check`.

---

## 9. Istruzioni per agenti (Claude Code, Codex)

**Quando lavori sui colori di questo repo:**

1. **Leggi `tokens.css`.** Usa i token semantici esistenti prima di crearne di nuovi.
2. **Nei componenti:** solo `var(--token-semantico)`. Vietati hex, `rgb()`, `hsl()` e i colori Tailwind di default (`bg-indigo-500`, `text-gray-400`, ecc.).
3. **Nuovo bisogno = nuovo token semantico**, in quattro passi:
   - aggiungi `--nome: light-dark(var(--prim-x), var(--prim-y));`;
   - aggiungi la riga `@check --nome on --sfondo : livello` per ogni sfondo su cui comparirà;
   - lancia `check`;
   - se fallisce, sposta lo step (in light più scuro, in dark più chiaro) e ripeti.
4. **Nuovo brand:** usa `colorboss.py scale "<colore>" --name brand` e sostituisci il blocco `brand`. Non modificare a mano le L delle primitive.
5. **Grafici:** usa Okabe-Ito o Tol, aggiungi etichette dirette e verifica con `colorboss.py cvd`.
6. **Nel resoconto finale, riporta l'output di `check`** (righe fail/warning e il totale). Non inventare valori di contrasto.
7. **Non introdurre:** `#000` come sfondo dark, testo `--text-subtle` per contenuto informativo, `opacity` per i disabilitati, gradienti decorativi non richiesti, più di un accento.
8. **Se l'utente chiede un colore specifico che fallisce il contrasto**, usalo dove è decorativo e proponi lo step più vicino che passa per testo e controlli. Mostra i numeri.

### 9.1 Integrazione Tailwind v4

```css
@import "tailwindcss";
@import "./color-boss/tokens.css";

@theme inline {
  --color-page: var(--bg-page);
  --color-surface: var(--bg-surface);
  --color-raised: var(--bg-raised);
  --color-subtle: var(--bg-subtle);
  --color-fg: var(--text);
  --color-muted: var(--text-muted);
  --color-faint: var(--text-subtle);
  --color-line: var(--border);
  --color-line-strong: var(--border-strong);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-on-accent: var(--on-accent);
  --color-link: var(--accent-text);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
}
```

Uso: `bg-surface text-fg border-line`, `bg-accent text-on-accent hover:bg-accent-hover`. Non servono le varianti `dark:`, perché `light-dark()` cambia i valori da solo.

### 9.2 CSS puro

```css
body { background: var(--bg-page); color: var(--text); }
.card { background: var(--bg-surface); border: 1px solid var(--border); }
.btn-primary { background: var(--accent); color: var(--on-accent); }
.btn-primary:hover { background: var(--accent-hover); }
:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.input { border: 1px solid var(--border-strong); background: var(--bg-surface); }
.input::placeholder { color: var(--text-subtle); }
```

**Tema forzato.** Imposta `<html data-theme="dark">`, oppure `"light"`. Senza attributo il tema segue il sistema.

---

## 10. Il token set di riferimento

Il file è `tokens.css`. Brand di default: blu cobalto `oklch(55% 0.19 258)`, da sostituire con quello del progetto.

<!-- SWATCHES -->

**Risultato di `colorboss.py check tokens.css`:** 27 coppie × 2 temi, **0 fail, 0 warning**. Tutte le primitive sono in gamut sRGB.

---

## 11. Checklist prima del rilascio

- [ ] `colorboss.py check tokens.css` → 0 fail. Nessun warning non motivato.
- [ ] Nessun colore letterale nei componenti: `grep -rE "#[0-9a-fA-F]{3,6}\b|rgb\(|hsl\(" src/` restituisce solo eccezioni giustificate.
- [ ] Testo principale ≥ 4.5:1 e |Lc| ≥ 75 in **entrambi** i temi.
- [ ] Bordi degli input, focus ring e icone informative ≥ 3:1.
- [ ] Il focus è visibile su tutti gli elementi interattivi, in entrambi i temi.
- [ ] Gli stati (errore, successo, avviso) hanno un'icona o un testo, non solo il colore.
- [ ] `colorboss.py cvd` sui colori di stato e sulla palette dei grafici → nessuna coppia sotto 5 (protan e deutan).
- [ ] Dark mode verificato a schermo: sfondo non nero, elevazione leggibile, accenti non "al neon".
- [ ] Controllo a vista in Chrome DevTools → Rendering → Emulate vision deficiencies.
- [ ] Testato con zoom al 200% e con `forced-colors` (Windows High Contrast): gli elementi restano visibili.

---

## 12. Miti vs evidenza

| Affermazione | Verdetto | Perché |
|---|---|---|
| "APCA è lo standard WCAG 3" | **Falso** | È stato rimosso dalle bozze nel 2023 e il metodo di WCAG 3 è da definire. APCA resta un buon strumento in più |
| "WCAG 2 AA basta per essere leggibili" | **Parziale** | È il minimo legale. In dark mode e con colori saturi può far passare coppie poco leggibili |
| "Il dark mode fa male agli occhi" / "il light è sempre meglio" | **Esagerato** | C'è un vantaggio di laboratorio della polarità positiva sulla lettura. Non ci sono prove di danni. Offri entrambi |
| "Mai bianco puro" | **Falso come regola** | `#FFF` come sfondo è standard. Da evitare è il binomio `#000` + `#FFF` in dark |
| "Mai nero puro in dark" | **Pratica sensata** | Halation (evidenza limitata), smearing sugli OLED, niente spazio per l'elevazione |
| "HSL va bene per generare scale" | **Falso** | La L di HSL non è percettiva. Usa OKLCH |
| "OKLCH: stessa L = stessa luminosità percepita" | **Approssimativo** | È molto meglio di HSL, ma non modella l'effetto H-K e non garantisce lo stesso contrasto WCAG |
| "Il rosso aumenta le conversioni" | **Non supportato** | Vince ciò che risalta nel contesto, non la tinta |
| "Il blu comunica fiducia ovunque" | **In parte vero** | È l'associazione più stabile tra culture (studi limitati). Il blu è anche il colore più preferito in media |
| "Le interfacce belle fanno perdonare gli errori" | **Incerto** | L'effetto percepito esiste, ma le repliche mostrano anche la direzione inversa |
| "I temi da editor amati hanno basso contrasto" | **Falso** | Il testo principale sta fra 7:1 e 16:1 nella maggior parte dei casi. Il contrasto basso è riservato ai commenti |
| "Neutri tinti = migliori" | **Opinione** | Sono comuni nei sistemi curati e rendono la UI più coesa, ma non c'è uno studio che lo dimostri |
| "60-30-10 è una regola scientifica" | **Falso** | È una convenzione. Funziona perché limita gli accenti |

---

## 13. Strumenti

| Strumento | Per |
|---|---|
| `colorboss.py` (questo pacchetto) | Contrasto WCAG+APCA, scale, check dei token, CVD, senza dipendenze |
| **oklch.com** (Evil Martians) | Picker OKLCH con visualizzazione del gamut sRGB/P3 |
| **Huetone** | Costruire scale con controllo APCA/WCAG su tutte le tinte insieme |
| **Adobe Leonardo** (leonardocolor.io) | Generare scale a partire da un contrasto target |
| **Material Theme Builder** | Temi HCT da un colore seed |
| **Radix Colors**, custom palette | Scale a 12 step con ruoli, dal tuo brand |
| **apcacontrast.com** | Calcolatore APCA di riferimento |
| **WebAIM Contrast Checker** | Controllo WCAG 2 rapido |
| **Chrome DevTools** | Picker con le linee AA/AAA, Rendering → Emulate vision deficiencies |
| **Polypane** | Browser per sviluppatori con simulazioni e audit di contrasto |
| **Color.js**, **culori** (JS), **ColorAide** (Python) | Librerie per gamut mapping e conversioni nelle pipeline |
| **ColorBrewer**, **viridis** | Palette per dati e mappe |

---

## 14. Fonti

**Standard e specifiche**
- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*. https://www.w3.org/TR/WCAG22/
- W3C, *Understanding SC 1.4.3 Contrast (Minimum)*, *1.4.11 Non-text Contrast*, *1.4.1 Use of Color*. https://www.w3.org/WAI/WCAG22/Understanding/
- W3C, *WCAG 3.0 Working Draft*. https://www.w3.org/TR/wcag-3.0/
- W3C, *CSS Color Module Level 4* e *Level 5*. https://www.w3.org/TR/css-color-4/ · https://www.w3.org/TR/css-color-5/
- MDN, `light-dark()`. https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark
- CSSWG mailing list, discussione sul clipping del gamut nei browser (giugno 2025). https://lists.w3.org/Archives/Public/public-css-archive/2025Jun/0124.html

**Contrasto e APCA**
- A. Somers, *APCA in a Nutshell*. https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html
- APCA-W3 (implementazione di riferimento, 0.0.98G-4g). https://github.com/Myndex/apca-w3
- A. Roselli, *WCAG3 Contrast as of April 2026*. https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html

**Scienza del colore**
- B. Ottosson (2020), *A perceptual color space for image processing* (Oklab). https://bottosson.github.io/posts/oklab/
- Material Design, *The Science of Color & Design* (HCT). https://m3.material.io/blog/science-of-color-design
- material-color-utilities. https://github.com/material-foundation/material-color-utilities

**Lettura e polarità**
- Buchner, A., & Baumgartner, N. (2007). Text–background polarity affects performance irrespective of ambient illumination and colour contrast. *Ergonomics*, 50(7).
- Piepenbrock, C., Mayr, S., Mund, I., & Buchner, A. (2013). Positive display polarity is advantageous for both younger and older adults. *Ergonomics*, 56(7).
- Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Smaller pupil size and better proofreading performance with positive than with negative polarity displays. *Ergonomics*, 57(11).

**Daltonismo e palette per dati**
- Birch, J. (2012). Worldwide prevalence of red-green color deficiency. *JOSA A*, 29(3).
- Machado, G. M., Oliveira, M. M., & Fernandes, L. A. F. (2009). A physiologically-based model for simulation of color vision deficiency. *IEEE TVCG*, 15(6).
- Okabe, M., & Ito, K. *Color Universal Design*. https://jfly.uni-koeln.de/color/
- Tol, P. *Colour schemes*. https://sronpersonalpages.nl/~pault/
- Nuñez, J. R., Anderton, C. R., & Renslow, R. S. (2018). Optimizing colormaps with consideration for color vision deficiency… *PLOS ONE*, 13(7).
- Harrower, M., & Brewer, C. A. (2003). ColorBrewer.org. *The Cartographic Journal*, 40(1). https://colorbrewer2.org
- van der Walt, S., & Smith, N. (2015). viridis / matplotlib colormaps. https://bids.github.io/colormap/

**Preferenze ed estetica**
- Palmer, S. E., & Schloss, K. B. (2010). An ecological valence theory of human color preference. *PNAS*, 107(19).
- Schloss, K. B., & Palmer, S. E. (2011). Aesthetic response to color combinations: preference, harmony, and similarity. *Attention, Perception, & Psychophysics*, 73(2).
- Hurlbert, A. C., & Ling, Y. (2007). Biological components of sex differences in color preference. *Current Biology*, 17(16).
- Kurosu, M., & Kashimura, K. (1995). Apparent usability vs. inherent usability. *CHI '95 Companion*.
- Tractinsky, N., Katz, A. S., & Ikar, D. (2000). What is beautiful is usable. *Interacting with Computers*, 13(2).
- Tuch, A. N., Roth, S. P., Hornbæk, K., Opwis, K., & Bargas-Avila, J. A. (2012). Is beautiful really usable? *Computers in Human Behavior*, 28(5).
- Madden, T. J., Hewett, K., & Roth, M. S. (2000). Managing images in different cultures: a cross-national study of color meanings and preferences. *Journal of International Marketing*, 8(4).
- Lehmann, G. K., Elliot, A. J., & Calin-Jageman, R. J. (2018). Meta-analysis of the effect of red on perceived attractiveness. *Evolutionary Psychology*, 16(4).

**Design system**
- Tailwind CSS, Colors. https://tailwindcss.com/docs/colors
- Radix Colors, Understanding the scale. https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- Material Design 3, Color. https://m3.material.io/styles/color/system/overview
- IBM Carbon, Color. https://carbondesignsystem.com/elements/color/overview/
- GitHub Primer, Color. https://primer.style/foundations/color
- Apple, Human Interface Guidelines, Color. https://developer.apple.com/design/human-interface-guidelines/color
- U.S. Web Design System, Color. https://designsystem.digital.gov/design-tokens/color/overview/
- Open Color. https://yeun.github.io/open-color/

# Vakantieapp

Een blogachtige website waarmee je je vrienden laat zien wat de beste vakantieplek, vlucht, overnachting en andere keuzes zijn.

## Functies

- **🗺️ De kaart is de startpagina.** Zoek bovenaan een stad, eiland of land, of tik ergens op de kaart: er komt meteen een genummerde pin met de plaatsnaam. Naast de kaart (op mobiel eronder) staat de lijst met bestemmingen. Per bestemming zie je in één oogopslag of datum, vlucht en hotel al geregeld zijn.
- **Snel prikken.** Tik je in het lege zoekveld, dan zie je populaire bestemmingen die je met één tik op de kaart zet. Een per ongeluk geprikte pin haal je weg met *Ongedaan maken* in de melding. Dubbelklikken zoomt in en prikt geen pin. Zoek je een land of regio, dan past die in beeld.
- **Kaartknoppen.** Rechtsonder staan *Toon alle pinnen* (⤢) en een knop voor satellietbeeld (🛰️); je keuze wordt onthouden. Ver uitgezoomd verdwijnen de datums en daarna de namen bij de pinnen, zodat de kaart rustig blijft.
- **Plannen vanuit een pin.** Tik op een pin of een bestemming in de lijst en het planpaneel opent, op een breed scherm naast de kaart zodat de kaart bruikbaar blijft. Het paneel heeft vijf stappen:
  - **📅 Wanneer**: kies een van de beste periodes uit de datumprikker of vul zelf datums in. Je ziet direct wie er dan niet kan.
  - **✈️ Vlucht**: vliegvelden in de buurt met geschatte vliegtijd. De links naar Google Flights en Skyscanner zoeken al op jullie reisdatums.
  - **🏨 Overnachting**: hotels binnen 5 km, met een Booking-link waarin de datums al staan.
  - **🎉 Activiteiten** en **🍽️ Eten & drinken**: bezienswaardigheden, stranden en restaurants in de buurt.
  - Met één tik voeg je een suggestie toe. Na de eerste keuze voor datum, vlucht of hotel gaat het paneel vanzelf door naar de volgende stap die nog open staat. Hotels, activiteiten en restaurants verschijnen als gekleurde stipjes rond de pin, en een gekozen vlucht vliegt als animatie vanuit Nederland naar de pin.
- **De reis wordt automatisch bijgehouden.** Zodra je een datum, vlucht of hotel kiest, maakt de app een reis voor die bestemming aan of werkt hem bij. Die reis staat in **🧳 Reizen**, waar je kunt vergelijken en hartjes geven.
- **📅 Datumprikker**: iedereen vinkt in een kalender aan wanneer hij of zij kan. Wie je bent kies je met één tik uit de bekende namen (of je typt één keer een nieuwe naam). Met *Ik kan de hele periode* of *Ik kan de hele maand* vink je alles in één keer aan en tik je daarna de dagen weg waarop je niet kunt. Je kunt ook met je vinger of muis over een rij dagen vegen. De beste periodes staan bovenaan. Met *Plan reis* kies je voor welke bestemming die periode is, en daarna ga je verder op de kaart. Vanuit een pin kom je met één tik in de datumprikker en weer terug.
- **🧭 Ideeën** (voor een vriendengroep): vul in met hoeveel personen jullie zijn, wanneer (de beste periode uit de datumprikker of zelf een maand), hoeveel dagen en eventueel een budget per persoon. Tik daarna aan waar jullie zin in hebben: feesten & clubs, strand & beachclubs, zon, stedentrip, goedkoop bier & eten, actie & avontuur, watersport & surfen, eiland, natuur & hiken, all-inclusive, wintersport & après-ski, een beetje cultuur, korte vlucht of verre reis.
  - De app rangschikt 143 bestemmingen vanaf Schiphol, van Zuid-Italië tot Azië en Amerika, op jullie wensen, het weer in die maand (inclusief regenseizoen) en het budget. Er zitten typische vriendengroep-plekken bij, zoals Sunny Beach, Magaluf, Zrće, Malia, Kavos, Ayia Napa, Mykonos, Hvar, Berlijn, Tarifa en Sölden.
  - Bovenaan elk pakket staat de prijs per persoon *inclusief* de schatting voor het verblijf; het budget p.p. telt ook het verblijf mee.
  - Per bestemming zie je alleen de vlucht: naar het dichtstbijzijnde vliegveld, met vliegtijd, een prijs per persoon en voor de hele groep, en links naar Google Flights en naar Skyscanner (voor het aantal personen).
  - Je ziet ook een schatting van het verblijf voor de hele groep (voordelig, middenklasse of luxe, afhankelijk van het budget), met een Booking-zoekopdracht voor dat aantal personen. Met meer mensen deel je een appartement of villa, dus per persoon wordt het goedkoper.
  - Met *Zet op de kaart* wordt het in één tik een pin, met de vlucht en een reis. De schatting voor het verblijf komt in de toelichting van de reis.
  - Prijzen zijn een indicatie (`public/data/bestemmingen.json`); de echte prijs zie je via de links.
- **Snellere hotels** (planpaneel): eerst de snelle lijst van Photon, daarna op de achtergrond Overpass voor sterren, websites en extra hotels. Beide worden samengevoegd in de cache.
- **📤 Reis delen in WhatsApp**: in het planpaneel van een bestemming en op elke reis in Reizen staat *Deel reis via WhatsApp*. De link (`/reis/…`) opent een overzicht om alleen te bekijken, zonder knoppen om iets te veranderen. Daarin staan:
  - een kaart met de bestemming, het hotel en de gekozen plekken
  - de datums, en wie er wel en niet kan
  - de vlucht met een zoeklink op jullie datums, en het hotel met een Booking-link
  - de activiteiten, het eten en de toelichting

  In WhatsApp verschijnt een voorbeeld met een plaatje van de reis. Elke reis heeft een eigen, onraadbare link. Valt een reis buiten de periode van de datumprikker, dan staat er niet dat iedereen "niet kan", maar dat het buiten de periode valt.
- **🗳️ Stemronde**: laat de groep kiezen tussen bestemmingen.
  - Elke ronde heeft een eigen link (`/stem/…`). Deel je die in WhatsApp, dan verschijnt er een voorbeeld met de vraag, de keuzes en de tussenstand, als plaatje dat de server zelf maakt.
  - Iedereen stemt met zijn of haar naam en kan de stem later nog wijzigen.
  - *Herinneren* maakt een WhatsApp-bericht met wie er nog niet heeft gestemd. Na het sluiten deel je de uitslag op dezelfde manier. De winnaar wordt de beste keuze op de kaart (rode pin).
  - De app kan zelf geen WhatsApp-berichten versturen: de knoppen openen WhatsApp met het bericht al ingevuld, en jij tikt op versturen.
- **Mobiel**: de tabs staan als balk onderaan, binnen bereik van je duim, en er is geen titel meer die ruimte inneemt.
  - De kaart vult het hele scherm. De bestemmingen liggen als kaartjes onderaan: veeg opzij naar een andere bestemming en de pin licht op; ligt die buiten beeld, dan schuift de kaart erheen. Veeg het greepje omhoog (of tik erop) voor de hele lijst.
  - De panelen volgen je vinger tijdens het vegen en klikken bij loslaten vast in de dichtstbijzijnde stand.
  - Het planpaneel van een pin bedekt maar de helft van het scherm, zodat je de pin en de stipjes van hotels en activiteiten blijft zien. Veeg omhoog voor het hele scherm, omlaag om te sluiten.
  - Ligt er een paneel over de kaart, dan sluit een tik op de kaart dat paneel eerst; zo prik je niet per ongeluk een pin.
- **Stijl**: strak en zakelijk: wit met grijstinten, één roze-rode accentkleur, het lettertype Inter, ronde hoeken en lijn-iconen. Waarschuwingen ("kan niet") hebben een eigen oranjerode kleur. Het voorbeeldplaatje voor WhatsApp gebruikt dezelfde stijl.
- **Toegankelijk.** Zoeken werkt helemaal met het toetsenbord (pijltjes en Enter). Pinnen bereik je met Tab en open je met Enter. De nummers op de pinnen komen overeen met de lijst. Het paneel sluit met Escape, de app werkt op mobiel en heeft een automatische dark mode.
- **Tabs**: naast Kaart, Datum, Reizen en Stemmen kun je zelf tabs toevoegen (＋) en aanpassen (naam, icoon, intro, prijs tonen, volgorde). Activiteiten en Eten & drinken kun je ook als lijst bekijken.
- **Foto's** bij een suggestie of bestemming: uploaden vanaf je telefoon (automatisch verkleind) of een link plakken.

Kaartgegevens, plaatsnamen en plekken in de buurt komen gratis en zonder API-sleutel van OpenStreetMap (tegels, Nominatim, Photon en Overpass). Het satellietbeeld komt van Esri World Imagery. Hotels en eten komen eerst van Photon (één snelle vraag naar de dichtstbijzijnde plekken) en pas als dat niets oplevert van Overpass; activiteiten andersom. Vliegvelden staan in een vaste lijst in `src/airports.json` (OurAirports, publiek domein), zodat vluchtsuggesties meteen verschijnen, ook als Overpass druk is. Bijwerken kan met `node scripts/vliegvelden.js`. De server bewaart de zoekresultaten voor plekken in de buurt 14 dagen, zodat de groep niet steeds hoeft te wachten.

## Starten

```bash
npm install
npm start          # http://localhost:4000
```

Of met Docker: `docker compose up -d --build`.

De data (SQLite-database en geüploade foto's) staat in `data/`, of in de map die je met de variabele `DATA_DIR` opgeeft.

## Testen

```bash
npm test
```

Start de app met een lege tijdelijke database en test o.a. inloggen (en de rem op wachtwoorden raden), het afschermen van groepen, uploads, het ophalen van links (geen interne adressen), account verwijderen en de health-check. GitHub draait dezelfde tests bij elke push en pull request (`.github/workflows/test.yml`).

## Productie

- **Health-check:** `GET /healthz` (app en database). Docker gebruikt hem als `healthcheck`. `GET /healthz?backup=1` geeft 503 als de laatste back-up ouder is dan 30 uur; de NAS controleert dat elk kwartier.
- **Back-ups:** `/usr/local/sbin/vakantieplanner-backup.sh` draait elke nacht om 02:30 (`/etc/cron.d/vakantieplanner-backup`). Hij maakt een consistente kopie van de database (SQLite online backup + `integrity_check`) en pakt die in met de uploads: 30 dagelijkse back-ups in `/srv/backups/vakantieplanner/daily`, één per maand een half jaar in `monthly/`, en de laatste 30 ook op de NAS (`backups/vakantieplanner`). Log: `/var/log/vakantieplanner-backup.log`.
- **Terugzetten:**
  ```bash
  cd /srv/docker/vakantieplanner && sudo docker compose stop
  V=/var/lib/docker/volumes/vakantieplanner_vakantie_data/_data
  sudo rm -f $V/vakantieplanner.db-wal $V/vakantieplanner.db-shm
  sudo tar -xzf /srv/backups/vakantieplanner/daily/vakantieplanner-JJJJMMDD-UUMM.tar.gz -C $V
  sudo docker compose start
  ```
- **Beveiliging:** wachtwoorden met scrypt, sessiecookie `HttpOnly`/`SameSite=Lax`/`Secure`, max. 10 mislukte inlogpogingen per kwartier per naam en per IP (alleen Caddy mag het echte IP doorgeven), beveiligingsheaders (o.a. `X-Frame-Options`, `nosniff`, HSTS), uploads worden gecontroleerd op echte afbeeldingen, en het ophalen van links weigert interne adressen.
- **Privacy:** `/privacy` legt uit wat er bewaard wordt. Leden kunnen hun account zelf verwijderen (Groep → Account). Het lettertype (Inter) en Leaflet komen van de eigen server, niet van Google.
- **DNS:** de container gebruikt 1.1.1.1/9.9.9.9, omdat de DNS van de server (NetBird) 2,5 s per opzoeking kost.

## Voorbeeldreis Turkije

`scripts/reis-turkije.js` zet een complete all-inclusive reis naar Side (Turkije) in de database: een locatie met pin op de kaart, een vlucht (Corendon AMS → AYT), een hotel (Side Crown Palace) en een reis die ze bundelt. Prijzen zijn opgezocht op 3 oktober 2026.

```bash
docker compose exec vakantieplanner node scripts/reis-turkije.js
```

Je kunt het script veilig vaker draaien; bestaat de reis al, dan wordt er niets toegevoegd.

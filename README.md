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
- **📅 Datumprikker**: iedereen vinkt in een kalender aan wanneer hij of zij kan. De beste periodes staan bovenaan. Met *Plan reis* kies je voor welke bestemming die periode is, en daarna ga je verder op de kaart. Vanuit een pin kom je met één tik in de datumprikker en weer terug.
- **🗳️ Stemronde**: laat de groep kiezen tussen bestemmingen.
  - Elke ronde heeft een eigen link (`/stem/…`). Deel je die in WhatsApp, dan verschijnt er een voorbeeld met de vraag, de keuzes en de tussenstand, als plaatje dat de server zelf maakt.
  - Iedereen stemt met zijn of haar naam en kan de stem later nog wijzigen.
  - *Herinneren* maakt een WhatsApp-bericht met wie er nog niet heeft gestemd. Na het sluiten deel je de uitslag op dezelfde manier. De winnaar wordt de beste keuze op de kaart (rode pin).
  - De app kan zelf geen WhatsApp-berichten versturen: de knoppen openen WhatsApp met het bericht al ingevuld, en jij tikt op versturen.
- **Toegankelijk.** Zoeken werkt helemaal met het toetsenbord (pijltjes en Enter). Pinnen bereik je met Tab en open je met Enter. De nummers op de pinnen komen overeen met de lijst. Het paneel sluit met Escape, de app werkt op mobiel en heeft een automatische dark mode.
- **Tabs**: naast Kaart, Datum, Reizen en Stemmen kun je zelf tabs toevoegen (＋) en aanpassen (naam, icoon, intro, prijs tonen, volgorde). Activiteiten en Eten & drinken kun je ook als lijst bekijken.
- **Foto's** bij een suggestie of bestemming: uploaden vanaf je telefoon (automatisch verkleind) of een link plakken.

Kaartgegevens, plaatsnamen en plekken in de buurt komen gratis en zonder API-sleutel van OpenStreetMap (tegels, Nominatim, Photon en Overpass). Het satellietbeeld komt van Esri World Imagery. Vliegvelden staan in een vaste lijst in `src/airports.json` (OurAirports, publiek domein), zodat vluchtsuggesties meteen verschijnen, ook als Overpass druk is. Bijwerken kan met `node scripts/vliegvelden.js`. De server bewaart de zoekresultaten voor plekken in de buurt 14 dagen, zodat de groep niet steeds hoeft te wachten.

## Starten

```bash
npm install
npm start          # http://localhost:4000
```

Of met Docker: `docker compose up -d --build`.

De data (SQLite-database en geüploade foto's) staat in `data/`, of in de map die je met de variabele `DATA_DIR` opgeeft.

## Voorbeeldreis Turkije

`scripts/reis-turkije.js` zet een complete all-inclusive reis naar Side (Turkije) in de database: een locatie met pin op de kaart, een vlucht (Corendon AMS → AYT), een hotel (Side Crown Palace) en een reis die ze bundelt. Prijzen zijn opgezocht op 3 oktober 2026.

```bash
docker compose exec vakantieplanner node scripts/reis-turkije.js
```

Je kunt het script veilig vaker draaien; bestaat de reis al, dan wordt er niets toegevoegd.

# Vakantieapp

Een blogachtige website waarmee je je vrienden laat zien wat de beste vakantieplek, vlucht, overnachting en andere keuzes zijn.

## Functies

- **Tabs** per onderdeel (Locatie, Vlucht, Overnachting, Activiteiten, Eten & drinken, Budget). Met ＋ voeg je een tab toe, met ⚙️ pas je hem aan (naam, icoon, intro, prijs tonen, volgorde, verwijderen).
- **Suggesties toevoegen**: onder elke tab staat een knop (bijv. "Voeg locatie toe") waarmee iedereen direct iets kan voorstellen, met optioneel een naam.
- **Tik op een kaart** om hem aan te passen, als 🏆 *beste keuze* te markeren of te verwijderen. Er is geen aparte bewerkmodus.
- **Prijs** wordt alleen getoond bij tabs waar dat aanstaat (standaard Vlucht en Overnachting).
- **Alles via de kaart**: tik op een pin voor een paneel met de dichtstbijzijnde vliegvelden (met geschatte vliegtijd vanaf Amsterdam en links naar Google Flights/Skyscanner) en hotels binnen 5 km. Met één tik voeg je ze toe; ze worden aan de pin gekoppeld. Gegevens komen gratis en zonder API-sleutel van OpenStreetMap (Overpass). De tabs Vlucht en Overnachting worden daarom niet meer in de tabbalk getoond.
- **Kaart** in de tab Locatie: tik op de kaart om een pin te prikken (de plaatsnaam wordt automatisch ingevuld). Tik op een pin om er een vlucht of overnachting aan te koppelen; een gekoppelde vlucht vliegt met een animatie vanuit Nederland naar de pin. Pinnen kun je verslepen.
- **🧳 Reizen**: combineer suggesties uit de tabs (bijv. een locatie, vlucht en overnachting) tot één reisvoorstel.
- **Foto's** bij een suggestie: uploaden vanaf je telefoon (automatisch verkleind) of een link plakken.
- **Hartjes** op suggesties en reizen.
- Gebouwd voor mobiel, met automatische dark mode.

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

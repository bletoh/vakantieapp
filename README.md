# Vakantieapp

Een blogachtige website waarmee je je vrienden laat zien wat de beste vakantieplek, vlucht, overnachting en andere keuzes zijn.

## Functies

- **Tabs** per onderdeel (Locatie, Vlucht, Overnachting, Activiteiten, Eten & drinken, Budget). Met ＋ voeg je een tab toe, met ⚙️ pas je hem aan (naam, icoon, intro, prijs tonen, volgorde, verwijderen).
- **Suggesties toevoegen**: onder elke tab staat een knop (bijv. "Voeg locatie toe") waarmee iedereen direct iets kan voorstellen, met optioneel een naam.
- **Tik op een kaart** om hem aan te passen, als 🏆 *beste keuze* te markeren of te verwijderen. Er is geen aparte bewerkmodus.
- **Prijs** wordt alleen getoond bij tabs waar dat aanstaat (standaard Vlucht en Overnachting).
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

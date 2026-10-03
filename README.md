# Vakantieapp

Een blogachtige website waarmee je je vrienden laat zien wat de beste vakantieplek, vlucht, overnachting en andere keuzes zijn.

## Functies

- **Tabs** per onderdeel (Locatie, Vlucht, Overnachting, Activiteiten, Eten & drinken, Budget). Je kunt tabs toevoegen, hernoemen, verplaatsen en verwijderen.
- **Overzicht**: per tab in één oogopslag de beste keuze.
- **Opties** per tab met foto, titel, ondertitel, prijs, score, beschrijving, plus- en minpunten en een link. Eén optie per tab kan als 🏆 *Beste keuze* worden gemarkeerd.
- **Live bewerken**: tik rechtsboven op *Bewerken* en tik daarna op een tekst om die aan te passen. Wijzigingen worden direct opgeslagen.
- **Foto's** uploaden vanaf je telefoon (ze worden automatisch verkleind) of een link naar een afbeelding plakken.
- **Hartjes**: vrienden kunnen opties liken.
- Gebouwd voor mobiel, met automatische dark mode.

## Starten

```bash
npm install
npm start          # http://localhost:4000
```

Of met Docker: `docker compose up -d --build`.

De data (SQLite-database en geüploade foto's) staat in `data/`, of in de map die je met de variabele `DATA_DIR` opgeeft.

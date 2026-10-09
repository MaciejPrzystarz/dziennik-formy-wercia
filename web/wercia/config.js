/* Skąd strona bierze dane: plik w tym (publicznym) repozytorium. Czytanie działa bez tokenu,
   więc każdy z linkiem widzi dziennik. Zapis z telefonu: token wklejony raz w ustawieniach strony.
   Tokenu tu NIE wpisuj: ten plik jest publiczny. */
window.WERCIA_CONFIG = {
  owner: 'MaciejPrzystarz',
  repo: 'dziennik-formy-wercia',
  branch: 'main',
  dataPath: 'data/wercia.json',
  staging: 'bufor' // tu zapisuje strona i Claude; do main co niedzielę o 10:00 (.github/workflows/weekly.yml)
};

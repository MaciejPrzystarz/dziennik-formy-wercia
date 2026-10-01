# Dziennik formy Wercii: zasady dla Claude'a

Dane: `data/wercia.json`. To jedyne źródło prawdy dla strony w `web/wercia/`
(https://maciejprzystarz.github.io/dziennik-formy-wercia/, repo i plik ustawione w `web/wercia/config.js`).
Strona zapisuje ten sam plik przez GitHub API, więc przed każdą zmianą pobierz jego aktualną wersję.

Repo jest publiczne celowo: GitHub Actions i Claude mogą wtedy czytać i aktualizować dane bez dodatkowych kluczy.
Wercia się na to zgodziła, każdy z linkiem widzi dziennik. Czytanie działa bez tokenu, a Wercia zapisuje wpisy
z telefonu tokenem wklejonym w ustawieniach strony.

Ten plik nie dotyczy dziennika Maćka: ten leży w repo `dziennik-formy` (`data/health.json`) i ma własny `CLAUDE.md`.

## Gdy użytkownik podaje dane dnia

Przykłady: „dziś 62,4, 1850 kcal, FBW A, 4/5”, „wczoraj rower 40 km, samopoczucie bestia”, „spałam 7,5 h, sen 82”,
„makro 120/55/240”, „białko 125, tłuszcze 50, węgle 230”, „dostałam okres”.

1. Ustal datę (dziś, wczoraj, konkretny dzień; strefa Europe/Warsaw). Jeśli nie wynika z wiadomości, zapytaj.
2. Znajdź wpis z tą datą. Jest: zmień tylko pola podane teraz, resztę zostaw. Nie ma: dodaj nowy wpis.
3. Zapisz plik, zrób commit i push (albo PUT przez API, niżej).
4. Odpowiedz jedną linią: co zapisano. Na prośbę policz średnią z 7 dni lub zmianę z pliku.

## Format

- `entries` posortowane rosnąco po `date`, jeden wpis na dzień, każdy wpis w jednej linii:
  `    {"date": "2026-09-28", "weight": 62.4, "kcal": 1850, "protein": 120, "fat": 55, "carbs": 240, "training": "FBW A", "mood": 4, "sleep": 7.5, "sleepScore": 82, "period": true, "note": "..."}`
- Kolejność kluczy: `date`, `weight`, `kcal`, `protein`, `fat`, `carbs`, `training`, `mood`, `sleep`, `sleepScore`, `period`, `note`.
  Brak wartości = brak klucza (bez `null`, `false` i pustych napisów).
- `date`: `RRRR-MM-DD`.
- `weight`: kg, liczba z kropką, maks. 2 miejsca po przecinku („62,4” → `62.4`).
- `kcal`: liczba całkowita.
- `protein`, `fat`, `carbs`: białko, tłuszcze, węglowodany w gramach, liczby całkowite 0–1000. Trzy liczby bez nazw
  („makro 120/55/240”, „B/T/W 120 55 240”) to zawsze kolejność białko, tłuszcze, węgle. Gdy podano wszystkie trzy,
  a kalorii nie, wpisz `kcal` = 4 × białko + 9 × tłuszcze + 4 × węgle (tak liczy aplikacja). Podane kalorie zostaw, nawet
  jeśli różnią się od wyliczonych.
- `training`: dokładnie nazwa z `settings.trainings` (teraz: „FBW A”, „FBW B”, „Rower”, „Bieganie”, „Inne Cardio”).
  Mapuj opisowe nazwy („rower” → `"Rower"`, „bieg” → `"Bieganie"`, „orbitrek”, „basen” → `"Inne Cardio"`). Gdy nic nie
  pasuje, zapytaj. Dzień bez treningu: pomiń pole.
- `mood`: 1 dramat, 2 meh, 3 OK, 4 dobrze, 5 bestia. Słowa i oceny typu „4/5” zamieniaj na liczbę.
- `sleep`: ile godzin snu: liczba z kropką, 0–24, maks. 2 miejsca po przecinku („7,5 h” → `7.5`, „7 h 20 min” → `7.33`).
- `sleepScore`: ocena snu 0–100, liczba całkowita („sen 82/100”, „ocena snu 82” → `82`).
- `period`: `true` w każdy dzień miesiączki („okres”, „dostałam okres”, „miesiączka”, „2. dzień okresu”). Dzień bez
  okresu: brak klucza. Pierwszy dzień z `period` po co najmniej 10 dniach bez niego to początek cyklu; strona liczy z tego
  dzień cyklu, średnią długość i przewidywany termin.
- `note`: krótko, maks. 280 znaków (np. rekord, dystans roweru).
- `settings` (cele) zmieniaj tylko na wyraźną prośbę. Nie usuwaj pól, których nie znasz. Cele makro są opcjonalne:
  `proteinTarget`, `fatTarget`, `carbsTarget` (gramy dziennie, liczby całkowite), zaraz po `kcalTarget`. Brak celu = brak klucza.
- Plik musi zostać poprawnym JSON-em. Przy błędzie składni aplikacja przechodzi w tryb tylko do odczytu.

## Seria dni

Licznik w górnym pasku liczy dni z rzędu z wpisanymi kaloriami (`kcal`). Brak wagi nie przerywa serii (można zapomnieć
zważyć się rano), brak kalorii przerywa. Dzisiejszy dzień nie przerywa serii, dopóki się nie skończy.

## Commit

- Wpis: `log: 2026-09-28 (62.4 kg, 1850 kcal, B 120 g, T 55 g, W 240 g, FBW A, 4/5, 7.5 h snu, sen 82/100, okres)`: pola,
  które ma wpis, w tej kolejności.
- Usunięcie: `log: usuń 2026-09-28`
- Cele: `settings: cel 59 kg do 2027-03-18, 1950 kcal, B 122 g, T 54 g, W 244 g, 3 treningi/tydz.` (cele makro tylko te, które są).
- Gałąź `main`. Zmieniaj tylko `data/wercia.json`, chyba że użytkownik prosi o zmiany w aplikacji.
- Przy zmianach w `web/wercia/js/` uruchom testy: `tests/index.html` w przeglądarce albo `node tests/run.mjs`.

## Cotygodniowe podsumowanie

Zaplanowane zadania „Dziennik formy: podsumowanie tygodnia” (niedziela 20:00 i ponowienia w poniedziałek) dotyczą
dziennika Maćka: czytają repo `dziennik-formy` i jego `data/health.json`, nie to repo. Dla Wercii nie ma teraz
takiego zadania. Gdyby powstało, ma czytać `data/wercia.json` z repo `dziennik-formy-wercia` i liczyć kodem
z `web/wercia/js/` (jak `tests/run.mjs`). Tylko czyta dane, nic nie zapisuje w repo.

## Zapis przez GitHub API (bez lokalnego repo)

Wymaga tokenu fine-grained z uprawnieniem Contents: Read and write do tego repozytorium.

```bash
OWNER=MaciejPrzystarz REPO=dziennik-formy-wercia TOKEN=<token>
API="https://api.github.com/repos/$OWNER/$REPO/contents/data/wercia.json"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

# 1. aktualny plik i sha, zawsze tuż przed zapisem
curl -s "${H[@]}" "$API?ref=main" > resp.json
SHA=$(jq -r .sha resp.json)
jq -r .content resp.json | base64 -d > wercia.json

# 2. edycja wercia.json według zasad wyżej

# 3. zapis
jq -n --arg message "log: 2026-09-28 (62.4 kg, 1850 kcal)" --arg sha "$SHA" \
      --arg content "$(base64 -w0 wercia.json)" \
      '{message: $message, content: $content, sha: $sha, branch: "main"}' |
  curl -s -X PUT "${H[@]}" "$API" -d @- | jq -r '.commit.html_url // .message'
```

409 lub 422 z informacją o `sha` oznacza, że plik zmienił się w międzyczasie: powtórz od kroku 1.

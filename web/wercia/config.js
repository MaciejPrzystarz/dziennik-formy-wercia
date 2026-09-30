/* Opcjonalna synchronizacja z GitHubem. Domyślnie dane Wercii zostają w jej przeglądarce.
   Jeśli uzupełnisz owner i repo, wystarczy potem wkleić token w ustawieniach strony.
   Zalecane: osobne, prywatne repozytorium na dane. Tokenu tu NIE wpisuj: ten plik jest publiczny. */
window.WERCIA_CONFIG = {
  owner: '',
  repo: '',
  branch: 'main',
  dataPath: 'data/wercia.json'
};

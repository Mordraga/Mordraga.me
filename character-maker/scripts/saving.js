// saving.js

function saveCharacter(character) {
  const savedCharacters = getSavedCharacters();
  savedCharacters.push(character);
  localStorage.setItem("savedCharacters", JSON.stringify(savedCharacters));
}

function getSavedCharacters() {
  const saved = localStorage.getItem("savedCharacters");
  return saved ? JSON.parse(saved) : [];
}

function deleteCharacter(index) {
  const savedCharacters = getSavedCharacters();
  savedCharacters.splice(index, 1);
  localStorage.setItem("savedCharacters", JSON.stringify(savedCharacters));
}

export { saveCharacter, getSavedCharacters, deleteCharacter };
